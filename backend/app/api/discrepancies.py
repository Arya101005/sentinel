"""Discrepancy queue endpoints (review, confirm, dismiss, resolve, request correction)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..database import get_db
from ..models import DiscrepancyFlag, FdrRecord, User
from ..schemas.common import Message, Page, paginate
from ..schemas.docs import CorrectionRequest, DiscrepancyAction, DiscrepancyOut
from ..security import get_current_user, require_editor, require_officer
from ..services.audit import record_audit
from ..services.discrepancy import refresh_fdr_verification
from .deps import bad_request, forbidden, not_found, pagination

router = APIRouter(prefix="/discrepancies", tags=["discrepancies"])


def _flag_out(flag: DiscrepancyFlag) -> dict:
    rec = flag.fdr
    return {
        "id": flag.id,
        "fdr_id": flag.fdr_id,
        "document_id": flag.document_id,
        "field_name": flag.field_name,
        "submitted_value": flag.submitted_value,
        "extracted_value": flag.extracted_value,
        "discrepancy_type": flag.discrepancy_type,
        "severity": flag.severity,
        "explanation": flag.explanation,
        "status": flag.status,
        "assigned_to": flag.assigned_to,
        "resolution_notes": flag.resolution_notes,
        "resolved_by": flag.resolved_by,
        "resolved_at": flag.resolved_at,
        "created_at": flag.created_at,
        "updated_at": flag.updated_at,
        "fdr_reference_number": rec.fdr_reference_number if rec else None,
        "bank_name": rec.bank_name if rec else None,
        "institution_id": rec.institution_id if rec else None,
        "institution_name": rec.institution.institution_name if rec and rec.institution else None,
    }


def _get_flag(db: Session, user: User, flag_id: int) -> DiscrepancyFlag:
    flag = db.get(DiscrepancyFlag, flag_id)
    if flag is None:
        raise not_found("Discrepancy")
    if user.role == e.ROLE_INSTITUTION:
        rec = db.get(FdrRecord, flag.fdr_id) if flag.fdr_id else None
        if rec is None or rec.institution_id != user.institution_id:
            raise not_found("Discrepancy")
    return flag


@router.get("", response_model=Page[DiscrepancyOut])
def list_discrepancies(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    fdr_id: Optional[int] = Query(None),
    document_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    discrepancy_type: Optional[str] = Query(None, alias="type"),
    institution_id: Optional[int] = Query(None),
    include_resolved: Optional[bool] = Query(None),
):
    page, page_size = page_info
    stmt = select(DiscrepancyFlag).join(
        FdrRecord, DiscrepancyFlag.fdr_id == FdrRecord.id, isouter=True
    )
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(FdrRecord.institution_id == user.institution_id)
    elif institution_id is not None:
        stmt = stmt.where(FdrRecord.institution_id == institution_id)
    if fdr_id is not None:
        stmt = stmt.where(DiscrepancyFlag.fdr_id == fdr_id)
    if document_id is not None:
        stmt = stmt.where(DiscrepancyFlag.document_id == document_id)
    if status_filter:
        stmt = stmt.where(DiscrepancyFlag.status == status_filter)
    elif include_resolved is not True:
        stmt = stmt.where(DiscrepancyFlag.status.in_(list(e.OPEN_DISCREPANCY_STATUSES)))
    if severity:
        stmt = stmt.where(DiscrepancyFlag.severity == severity)
    if discrepancy_type:
        stmt = stmt.where(DiscrepancyFlag.discrepancy_type == discrepancy_type)

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    flags = (
        db.execute(
            stmt.order_by(
                (DiscrepancyFlag.status == e.DISC_OPEN).desc(),
                DiscrepancyFlag.created_at.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return paginate([_flag_out(f) for f in flags], total, page, page_size)


@router.get("/{flag_id}", response_model=DiscrepancyOut)
def get_discrepancy(
    flag_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _flag_out(_get_flag(db, user, flag_id))


def _action(
    db: Session,
    user: User,
    flag: DiscrepancyFlag,
    new_status: str,
    reason: Optional[str],
    notes: Optional[str],
    request: Request,
    action_name: str,
) -> DiscrepancyFlag:
    if user.role == e.ROLE_AUDITOR:
        raise forbidden("Auditors have read-only access to the discrepancy queue.")
    if new_status in (e.DISC_DISMISSED, e.DISC_RESOLVED) and not (reason or notes or "").strip():
        raise bad_request(
            "A reason/notes are required to dismiss or resolve a discrepancy.",
            "reason_required",
        )
    previous = flag.status
    flag.status = new_status
    if new_status in (e.DISC_RESOLVED, e.DISC_DISMISSED):
        flag.resolved_by = user.id
        flag.resolved_at = datetime.utcnow()
        flag.resolution_notes = (notes or reason or "").strip()
    if notes:
        flag.resolution_notes = notes.strip()

    record_audit(
        db,
        actor_user_id=user.id,
        action=f"discrepancy.{action_name}",
        entity_type="discrepancy",
        entity_id=flag.id,
        metadata={
            "fdr_id": flag.fdr_id,
            "type": flag.discrepancy_type,
            "from": previous,
            "to": new_status,
        },
        reason=(reason or notes),
        request_id=request.headers.get("X-Request-ID"),
    )
    if flag.fdr_id:
        rec = db.get(FdrRecord, flag.fdr_id)
        if rec is not None:
            refresh_fdr_verification(db, rec)
    db.flush()
    return flag


@router.post("/{flag_id}/confirm", response_model=DiscrepancyOut)
def confirm_discrepancy(
    flag_id: int,
    payload: DiscrepancyAction,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_officer),
):
    flag = _get_flag(db, user, flag_id)
    _action(db, user, flag, e.DISC_CONFIRMED, payload.reason, payload.resolution_notes, request, "confirmed")
    db.commit()
    return _flag_out(flag)


@router.post("/{flag_id}/dismiss", response_model=DiscrepancyOut)
def dismiss_discrepancy(
    flag_id: int,
    payload: DiscrepancyAction,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_officer),
):
    """Dismiss a false positive — reason mandatory (audited)."""
    flag = _get_flag(db, user, flag_id)
    if not (payload.reason or "").strip():
        raise bad_request("Provide a reason for dismissing this flag.", "reason_required")
    _action(db, user, flag, e.DISC_DISMISSED, payload.reason, payload.resolution_notes, request, "dismissed")
    db.commit()
    return _flag_out(flag)


@router.post("/{flag_id}/resolve", response_model=DiscrepancyOut)
def resolve_discrepancy(
    flag_id: int,
    payload: DiscrepancyAction,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_officer),
):
    flag = _get_flag(db, user, flag_id)
    if not (payload.resolution_notes or payload.reason or "").strip():
        raise bad_request("Provide resolution notes after reviewing the evidence.", "reason_required")
    _action(db, user, flag, e.DISC_RESOLVED, payload.reason, payload.resolution_notes, request, "resolved")
    db.commit()
    return _flag_out(flag)


@router.post("/{flag_id}/request-correction", response_model=DiscrepancyOut)
def request_correction(
    flag_id: int,
    payload: CorrectionRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_officer),
):
    from ..services.notifications import create_notification, recipients_for_institution

    flag = _get_flag(db, user, flag_id)
    flag.status = e.DISC_CORRECTION_REQUESTED
    flag.resolution_notes = payload.requested_changes

    rec = db.get(FdrRecord, flag.fdr_id) if flag.fdr_id else None
    if rec is not None:
        for target in recipients_for_institution(db, rec.institution_id, (e.ROLE_INSTITUTION,)):
            create_notification(
                db,
                deduplication_key=f"correction:{flag.id}:u:{target.id}",
                title=f"Correction requested: FDR {rec.fdr_reference_number}",
                message=(
                    f"A correction was requested for the '{flag.discrepancy_type.replace('_', ' ')}' "
                    f"flag on FDR {rec.fdr_reference_number}: {payload.requested_changes}"
                ),
                notification_type="correction_requested",
                recipient_user_id=target.id,
                institution_id=rec.institution_id,
                fdr_id=rec.id,
            )

    record_audit(
        db,
        actor_user_id=user.id,
        action="discrepancy.correction_requested",
        entity_type="discrepancy",
        entity_id=flag.id,
        metadata={"fdr_id": flag.fdr_id, "type": flag.discrepancy_type},
        reason=payload.requested_changes,
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    return _flag_out(flag)
