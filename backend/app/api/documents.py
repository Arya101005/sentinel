"""Document endpoints: secure upload, private download, processing, extraction review."""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt as pyjwt
from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..config import settings
from ..database import get_db
from ..models import Document, ExtractedFdrField, FdrRecord, User
from ..schemas.common import Message, Page, paginate
from ..schemas.docs import (
    DocumentOut,
    DocumentReviewRequest,
    ExtractedFieldOut,
    ExtractedFieldReview,
)
from ..security import get_current_user, require_editor
from ..services.audit import record_audit
from ..services.discrepancy import compare_extraction, flag_duplicates, refresh_fdr_verification
from ..services.extraction import process_document, read_document_bytes, store_upload
from ..services.notifications import notify_discrepancy
from .deps import bad_request, forbidden, not_found, pagination

router = APIRouter(prefix="/documents", tags=["documents"])


def _document_out(document: Document) -> dict:
    return {
        "id": document.id,
        "institution_id": document.institution_id,
        "fdr_id": document.fdr_id,
        "document_type": document.document_type,
        "original_filename": document.original_filename,
        "mime_type": document.mime_type,
        "file_size": document.file_size,
        "checksum": document.checksum,
        "upload_status": document.upload_status,
        "uploaded_by": document.uploaded_by,
        "uploader_name": document.uploader.display_name if document.uploader else None,
        "uploaded_at": document.uploaded_at,
        "version_number": document.version_number,
        "extraction_status": document.extraction_status,
        "extraction_error": document.extraction_error,
        "extraction_completed_at": document.extraction_completed_at,
        "review_status": document.review_status,
        "reviewed_by": document.reviewed_by,
        "reviewed_at": document.reviewed_at,
        "is_demo": document.is_demo,
        "download_url": f"{settings.api_prefix}/documents/{document.id}/download",
    }


def _can_access(user: User, document: Document) -> bool:
    if user.role == e.ROLE_INSTITUTION:
        return document.institution_id == user.institution_id
    return True


def _can_edit(user: User, document: Document) -> bool:
    if user.role in (e.ROLE_ADMIN, e.ROLE_OFFICER):
        return True
    if user.role == e.ROLE_INSTITUTION:
        return document.institution_id == user.institution_id
    return False


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    request: Request,
    file: UploadFile = File(..., description="PDF, PNG or JPEG (content-validated)"),
    document_type: str = Form(...),
    fdr_id: Optional[int] = Form(None),
    institution_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    if document_type not in e.DOCUMENT_TYPES:
        raise bad_request(f"Unsupported document type '{document_type}'.", "invalid_document_type")

    target_institution = institution_id
    if fdr_id is not None:
        fdr = db.get(FdrRecord, fdr_id)
        if fdr is None:
            raise not_found("FDR record")
        target_institution = fdr.institution_id
    if target_institution is None:
        target_institution = user.institution_id
    if target_institution is None:
        raise bad_request("institution_id is required for this upload.", "institution_required")
    if user.role == e.ROLE_INSTITUTION and target_institution != user.institution_id:
        raise forbidden("You may only upload documents for your own institution.")

    data = await file.read()
    try:
        document = store_upload(
            db,
            data=data,
            original_filename=file.filename or "upload",
            document_type=document_type,
            institution_id=target_institution,
            fdr_id=fdr_id,
            uploaded_by=user.id,
        )
    except ValueError as exc:
        db.rollback()
        raise bad_request(str(exc), "invalid_upload")

    record_audit(
        db,
        actor_user_id=user.id,
        action="document.uploaded",
        entity_type="document",
        entity_id=document.id,
        metadata={
            "fdr_id": document.fdr_id,
            "mime_type": document.mime_type,
            "size": document.file_size,
            "checksum": document.checksum[:16],
        },
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(document)
    return _document_out(document)


@router.get("", response_model=Page[DocumentOut])
def list_documents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    fdr_id: Optional[int] = Query(None),
    institution_id: Optional[int] = Query(None),
    document_type: Optional[str] = Query(None),
    extraction_status: Optional[str] = Query(None),
    review_status: Optional[str] = Query(None),
):
    page, page_size = page_info
    stmt = select(Document)
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(Document.institution_id == user.institution_id)
    elif institution_id is not None:
        stmt = stmt.where(Document.institution_id == institution_id)
    if fdr_id is not None:
        stmt = stmt.where(Document.fdr_id == fdr_id)
    if document_type:
        stmt = stmt.where(Document.document_type == document_type)
    if extraction_status:
        stmt = stmt.where(Document.extraction_status == extraction_status)
    if review_status:
        stmt = stmt.where(Document.review_status == review_status)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    docs = (
        db.execute(stmt.order_by(Document.uploaded_at.desc()).offset((page - 1) * page_size).limit(page_size))
        .scalars()
        .all()
    )
    return paginate([_document_out(d) for d in docs], total, page, page_size)


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    document = db.get(Document, document_id)
    if document is None or not _can_access(user, document):
        raise not_found("Document")
    return _document_out(document)


@router.get("/{document_id}/download-url")
def create_download_url(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Short-lived signed URL (120 s) for private document download."""
    document = db.get(Document, document_id)
    if document is None or not _can_access(user, document):
        raise not_found("Document")
    exp = datetime.now(timezone.utc) + timedelta(seconds=120)
    token = pyjwt.encode(
        {"doc": document.id, "uid": user.id, "exp": exp, "iss": "fdr-sentinel"},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return {
        "url": f"{settings.api_prefix}/documents/{document.id}/download?token={token}",
        "expires_in_seconds": 120,
    }


@router.get("/{document_id}/download")
def download_document(
    document_id: int,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    document = db.get(Document, document_id)
    if document is None:
        raise not_found("Document")

    if token is not None:
        # Signed-URL path: the token identifies the authorised user.
        try:
            payload = pyjwt.decode(
                token, settings.jwt_secret, algorithms=[settings.jwt_algorithm], issuer="fdr-sentinel"
            )
            if int(payload.get("doc", -1)) != document.id:
                raise ValueError("wrong document")
            token_user = db.get(User, int(payload.get("uid", 0)))
            if token_user is None or not token_user.is_active:
                raise ValueError("unknown user")
            viewer = token_user
        except Exception:  # noqa: BLE001
            raise forbidden("The download link is invalid or has expired.")
    else:
        viewer = user

    if not _can_access(viewer, document):
        raise not_found("Document")

    try:
        data = read_document_bytes(document)
    except ValueError:
        raise not_found("Document file")

    record_audit(
        db,
        actor_user_id=viewer.id,
        action="document.downloaded",
        entity_type="document",
        entity_id=document.id,
        metadata={"fdr_id": document.fdr_id},
    )
    db.commit()
    return StreamingResponse(
        io.BytesIO(data),
        media_type=document.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{document.original_filename}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )


@router.post("/{document_id}/process")
def process(
    document_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    """Run extraction + discrepancy comparison for one document (never crashes)."""
    document = db.get(Document, document_id)
    if document is None or not _can_access(user, document):
        raise not_found("Document")
    if not _can_edit(user, document):
        raise forbidden()

    document = process_document(db, document)
    created_flags = []
    if document.fdr_id is not None:
        created_flags = compare_extraction(db, document)
        fdr = db.get(FdrRecord, document.fdr_id)
        if fdr is not None:
            flag_duplicates(db, fdr)
            if created_flags:
                fdr.verification_status = e.FDR_VERIFICATION_DISCREPANCY

    record_audit(
        db,
        actor_user_id=user.id,
        action="document.processed",
        entity_type="document",
        entity_id=document.id,
        metadata={
            "extraction_status": document.extraction_status,
            "flags_created": len(created_flags),
            "flag_types": sorted({f.discrepancy_type for f in created_flags}),
        },
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(document)
    return {
        "document": _document_out(document),
        "flags_created": [f.id for f in created_flags],
        "extracted_text_preview": (document.extracted_text or "")[:1500],
    }


@router.get("/{document_id}/extractions", response_model=list[ExtractedFieldOut])
def list_extractions(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    document = db.get(Document, document_id)
    if document is None or not _can_access(user, document):
        raise not_found("Document")
    fields = (
        db.execute(
            select(ExtractedFdrField)
            .where(ExtractedFdrField.document_id == document_id)
            .order_by(ExtractedFdrField.field_name)
        )
        .scalars()
        .all()
    )
    return [ExtractedFieldOut.model_validate(f) for f in fields]


@router.patch("/{document_id}/extractions/{field_id}", response_model=ExtractedFieldOut)
def review_field(
    document_id: int,
    field_id: int,
    payload: ExtractedFieldReview,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    document = db.get(Document, document_id)
    if document is None or not _can_access(user, document):
        raise not_found("Document")
    if not _can_edit(user, document):
        raise forbidden()
    field = db.get(ExtractedFdrField, field_id)
    if field is None or field.document_id != document_id:
        raise not_found("Extracted field")

    previous = field.normalized_value
    field.review_status = payload.review_status
    field.reviewed_by = user.id
    field.reviewed_at = datetime.utcnow()
    if payload.corrected_value is not None:
        field.extracted_value = payload.corrected_value
        field.normalized_value = payload.corrected_value

    record_audit(
        db,
        actor_user_id=user.id,
        action="document.extraction_reviewed",
        entity_type="extracted_field",
        entity_id=field.id,
        metadata={
            "field": field.field_name,
            "review_status": field.review_status,
            "changed": previous != field.normalized_value,
        },
        reason=payload.review_status,
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(field)
    return ExtractedFieldOut.model_validate(field)


@router.post("/{document_id}/review", response_model=DocumentOut)
def review_document(
    document_id: int,
    payload: DocumentReviewRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    document = db.get(Document, document_id)
    if document is None or not _can_access(user, document):
        raise not_found("Document")
    if user.role == e.ROLE_INSTITUTION and document.institution_id != user.institution_id:
        raise forbidden()

    previous = document.review_status
    document.review_status = payload.review_status
    if payload.review_status == e.REVIEW_COMPLETED:
        document.reviewed_by = user.id
        document.reviewed_at = datetime.utcnow()
        if document.fdr_id is not None:
            fdr = db.get(FdrRecord, document.fdr_id)
            if fdr is not None:
                refresh_fdr_verification(db, fdr)
                if fdr.verification_status != e.FDR_VERIFICATION_DISCREPANCY:
                    fdr.verification_status = e.FDR_VERIFICATION_VERIFIED
                    fdr.last_verified_at = datetime.utcnow()

    record_audit(
        db,
        actor_user_id=user.id,
        action="document.review_status_changed",
        entity_type="document",
        entity_id=document.id,
        metadata={"from": previous, "to": document.review_status},
        reason=payload.comments,
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(document)
    return _document_out(document)
