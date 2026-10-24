"""FDR registry endpoints (Module A + lifecycle management)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..database import get_db
from ..models import DiscrepancyFlag, FdrLifecycleEvent, FdrRecord, Institution, User
from ..schemas.common import Page, paginate
from ..schemas.core import FdrCreate, FdrLifecycleEventOut, FdrLinkRequest, FdrOut, FdrUpdate
from ..security import get_current_user, require_editor
from ..services.audit import record_audit
from ..services.discrepancy import flag_duplicates
from ..services.maturity import apply_fdr_filters, base_fdr_query, enrich_rows
from ..services.settings_service import maturity_thresholds
from .deps import bad_request, forbidden, not_found, pagination

router = APIRouter(prefix="/fdr-records", tags=["fdr records"])


def _lifecycle(
    db: Session,
    fdr: FdrRecord,
    event_type: str,
    actor: Optional[User],
    previous: Optional[str] = None,
    new: Optional[str] = None,
    comment: Optional[str] = None,
) -> None:
    db.add(
        FdrLifecycleEvent(
            fdr_id=fdr.id,
            event_type=event_type,
            previous_value=previous,
            new_value=new,
            actor_user_id=actor.id if actor else None,
            comment=comment,
        )
    )


def _filter_kwargs_from_query(
    institution_id: Optional[int],
    region: Optional[str],
    bank: Optional[str],
    lifecycle: Optional[str],
    verification: Optional[str],
    release_status: Optional[str],
    maturity_from: Optional[date],
    maturity_to: Optional[date],
    application_status: Optional[str],
    assigned_officer_id: Optional[int],
    discrepancy_status: Optional[str],
    q: Optional[str],
) -> dict:
    return {
        "institution_id": institution_id,
        "region": region,
        "bank_name": bank,
        "lifecycle_status": lifecycle,
        "verification_status": verification,
        "release_status": release_status,
        "maturity_from": maturity_from,
        "maturity_to": maturity_to,
        "application_status": application_status,
        "assigned_officer_id": assigned_officer_id,
        "discrepancy_status": discrepancy_status,
        "q": q,
    }


@router.get("", response_model=Page[FdrOut])
def list_fdrs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    institution_id: Optional[int] = Query(None),
    region: Optional[str] = Query(None),
    bank: Optional[str] = Query(None),
    lifecycle: Optional[str] = Query(None, description="lifecycle_status"),
    verification: Optional[str] = Query(None, description="verification_status"),
    release_status: Optional[str] = Query(None),
    maturity_from: Optional[date] = Query(None),
    maturity_to: Optional[date] = Query(None),
    application_status: Optional[str] = Query(None),
    assigned_officer_id: Optional[int] = Query(None),
    discrepancy_status: Optional[str] = Query(None),
    monitoring_category: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Search reference / bank / institution"),
    sort_by: str = Query("maturity_date"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
):
    filters = _filter_kwargs_from_query(
        institution_id, region, bank, lifecycle, verification, release_status,
        maturity_from, maturity_to, application_status, assigned_officer_id,
        discrepancy_status, q,
    )
    if user.role == e.ROLE_INSTITUTION:
        filters["institution_id"] = user.institution_id  # hard scope

    stmt = apply_fdr_filters(base_fdr_query(user), **filters)
    records = db.execute(stmt).scalars().unique().all()
    today = date.today()
    thresholds = maturity_thresholds(db)
    rows = enrich_rows(db, records, today, thresholds)

    if monitoring_category:
        rows = [r for r in rows if r["classification"].category == monitoring_category]

    sort_key = sort_by if sort_by in {
        "maturity_date", "deposit_amount", "fdr_reference_number",
        "institution_name", "days_to_maturity", "created_at", "bank_name",
    } else "maturity_date"
    reverse = sort_dir == "desc"

    def _key(row):
        rec = row["record"]
        if sort_key == "deposit_amount":
            return float(rec.deposit_amount)
        if sort_key == "days_to_maturity":
            d = row["classification"].days_to_maturity
            return d if d is not None else 10**6
        if sort_key == "institution_name":
            return (rec.institution.institution_name if rec.institution else "").lower()
        if sort_key == "fdr_reference_number":
            return rec.fdr_reference_number.lower()
        if sort_key == "bank_name":
            return rec.bank_name.lower()
        return getattr(rec, sort_key, None) or date.max

    rows.sort(key=_key, reverse=reverse)
    total = len(rows)
    page, page_size = page_info
    start = (page - 1) * page_size
    page_rows = rows[start : start + page_size]

    items = []
    for row in page_rows:
        rec = row["record"]
        cls = row["classification"]
        payload = {
            "id": rec.id,
            "institution_id": rec.institution_id,
            "institution_name": rec.institution.institution_name if rec.institution else None,
            "institution_code": rec.institution.institution_code if rec.institution else None,
            "region": rec.institution.region if rec.institution else None,
            "fdr_reference_number": rec.fdr_reference_number,
            "bank_name": rec.bank_name,
            "branch_name": rec.branch_name,
            "deposit_amount": rec.deposit_amount,
            "currency": rec.currency,
            "issue_date": rec.issue_date,
            "maturity_date": rec.maturity_date,
            "verification_status": rec.verification_status,
            "lifecycle_status": rec.lifecycle_status,
            "release_application_status": rec.release_application_status,
            "renewal_parent_id": rec.renewal_parent_id,
            "replacement_fdr_id": rec.replacement_fdr_id,
            "link_type": rec.link_type,
            "eligibility_notes": rec.eligibility_notes,
            "remarks": rec.remarks,
            "last_verified_at": rec.last_verified_at,
            "archived_at": rec.archived_at,
            "created_at": rec.created_at,
            "updated_at": rec.updated_at,
            "is_demo": rec.is_demo,
            "monitoring_category": cls.category,
            "days_to_maturity": cls.days_to_maturity,
            "open_discrepancies": row["open_discrepancies"],
        }
        items.append(payload)
    return paginate(items, total, page, page_size)


@router.post("", response_model=FdrOut, status_code=status.HTTP_201_CREATED)
def create_fdr(
    payload: FdrCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    if user.role == e.ROLE_INSTITUTION and payload.institution_id != user.institution_id:
        raise forbidden("You may only create records for your own institution.")
    if db.get(Institution, payload.institution_id) is None:
        raise not_found("Institution")

    data = payload.model_dump()
    if data["issue_date"] and data["maturity_date"] and data["issue_date"] > data["maturity_date"]:
        raise bad_request("Issue date cannot be after the maturity date.", "invalid_dates")

    # Flag suspicious backdating: maturity more than 20 years out.
    if data["maturity_date"] and data["issue_date"]:
        span = (data["maturity_date"] - data["issue_date"]).days
        if span > 365 * 20:
            raise bad_request(
                "The maturity date is more than 20 years after the issue date; please verify.",
                "implausible_dates",
            )

    fdr = FdrRecord(**data, created_by=user.id)
    db.add(fdr)
    db.flush()
    _lifecycle(db, fdr, "created", user, new=f"Reference {fdr.fdr_reference_number}")
    duplicates = flag_duplicates(db, fdr)
    record_audit(
        db,
        actor_user_id=user.id,
        action="fdr.created",
        entity_type="fdr",
        entity_id=fdr.id,
        metadata={
            "institution_id": fdr.institution_id,
            "reference": fdr.fdr_reference_number,
            "potential_duplicates": len(duplicates),
        },
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(fdr)
    from .deps import fdr_out

    return fdr_out(db, fdr)


@router.get("/meta/banks", response_model=list[str])
def list_banks(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from ..services.extraction import BANK_NAMES

    stored = db.execute(select(FdrRecord.bank_name).distinct()).scalars().all()
    return sorted(set(BANK_NAMES) | set(stored))


@router.get("/{fdr_id}", response_model=FdrOut)
def get_fdr(
    fdr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    fdr = db.get(FdrRecord, fdr_id)
    if fdr is None or (user.role == e.ROLE_INSTITUTION and fdr.institution_id != user.institution_id):
        raise not_found("FDR record")
    from .deps import fdr_out

    return fdr_out(db, fdr)


@router.patch("/{fdr_id}", response_model=FdrOut)
def update_fdr(
    fdr_id: int,
    payload: FdrUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    fdr = db.get(FdrRecord, fdr_id)
    if fdr is None or (user.role == e.ROLE_INSTITUTION and fdr.institution_id != user.institution_id):
        raise not_found("FDR record")
    if fdr.archived_at is not None:
        raise bad_request("Archived records cannot be edited. Restore/replace instead.", "archived")

    data = payload.model_dump(exclude_unset=True)
    issue = data.get("issue_date", fdr.issue_date)
    maturity = data.get("maturity_date", fdr.maturity_date)
    if issue and maturity and issue > maturity:
        raise bad_request("Issue date cannot be after the maturity date.", "invalid_dates")

    changes: dict[str, dict] = {}
    for field, value in data.items():
        old = getattr(fdr, field)
        if old != value:
            changes[field] = {"from": str(old), "to": str(value)}
            setattr(fdr, field, value)
            _lifecycle(
                db,
                fdr,
                f"updated.{field}",
                user,
                previous=str(old),
                new=str(value),
                comment=payload.remarks if field == "remarks" else None,
            )

    if "maturity_date" in changes or "deposit_amount" in changes:
        # Dates/amounts changed: re-check duplicates and monitoring state.
        flag_duplicates(db, fdr)

    record_audit(
        db,
        actor_user_id=user.id,
        action="fdr.updated",
        entity_type="fdr",
        entity_id=fdr.id,
        metadata={"fields": sorted(changes.keys())},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(fdr)
    from .deps import fdr_out

    return fdr_out(db, fdr)


@router.post("/{fdr_id}/archive", response_model=FdrOut)
def archive_fdr(
    fdr_id: int,
    request: Request,
    payload: Optional[dict] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    fdr = db.get(FdrRecord, fdr_id)
    if fdr is None or (user.role == e.ROLE_INSTITUTION and fdr.institution_id != user.institution_id):
        raise not_found("FDR record")
    if fdr.archived_at is not None:
        raise bad_request("This record is already archived.", "already_archived")

    reason = (payload or {}).get("reason")
    fdr.archived_at = datetime.utcnow()
    previous = fdr.lifecycle_status
    fdr.lifecycle_status = e.LIFECYCLE_ARCHIVED
    _lifecycle(db, fdr, "archived", user, previous=previous, new=e.LIFECYCLE_ARCHIVED, comment=reason)
    record_audit(
        db,
        actor_user_id=user.id,
        action="fdr.archived",
        entity_type="fdr",
        entity_id=fdr.id,
        reason=reason,
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(fdr)
    from .deps import fdr_out

    return fdr_out(db, fdr)


@router.post("/{fdr_id}/link", response_model=FdrOut)
def link_fdr(
    fdr_id: int,
    payload: FdrLinkRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    """Link a renewal / replacement record, preserving both records intact."""
    old = db.get(FdrRecord, fdr_id)
    if old is None or (user.role == e.ROLE_INSTITUTION and old.institution_id != user.institution_id):
        raise not_found("FDR record")

    successor: Optional[FdrRecord] = None
    if payload.linked_fdr_id is not None:
        successor = db.get(FdrRecord, payload.linked_fdr_id)
        if successor is None:
            raise not_found("Linked FDR record")
        if user.role == e.ROLE_INSTITUTION and successor.institution_id != user.institution_id:
            raise forbidden("You may only link records belonging to your institution.")
    elif payload.new_fdr:
        create_payload = FdrCreate(**{**payload.new_fdr, "institution_id": old.institution_id})
        if create_payload.issue_date and create_payload.maturity_date and create_payload.issue_date > create_payload.maturity_date:
            raise bad_request("Issue date cannot be after the maturity date.", "invalid_dates")
        successor = FdrRecord(**create_payload.model_dump(), created_by=user.id)
        db.add(successor)
        db.flush()
        _lifecycle(db, successor, "created", user, new=f"Linked as {payload.link_type} of FDR #{old.id}")
    else:
        raise bad_request("Provide linked_fdr_id or new_fdr to link.", "missing_target")

    if successor.id == old.id:
        raise bad_request("An FDR cannot be linked to itself.", "self_link")

    successor.renewal_parent_id = old.id
    successor.link_type = payload.link_type
    successor.lifecycle_status = e.LIFECYCLE_ACTIVE

    # The previous record is preserved: never overwritten, never double-counted.
    previous_state = old.lifecycle_status
    if payload.link_type == "renewal":
        old.lifecycle_status = e.LIFECYCLE_RENEWED
    else:
        old.lifecycle_status = e.LIFECYCLE_REPLACED
    old.replacement_fdr_id = successor.id if payload.link_type == "replacement" else old.replacement_fdr_id

    _lifecycle(
        db, old, f"linked.{payload.link_type}", user,
        previous=previous_state, new=old.lifecycle_status,
        comment=f"{payload.link_type.title()} -> FDR #{successor.id}: {payload.comment or 'no comment'}",
    )
    _lifecycle(
        db, successor, f"linked_as.{payload.link_type}", user,
        previous=None, new=f"successor of FDR #{old.id}",
        comment=payload.comment,
    )

    record_audit(
        db,
        actor_user_id=user.id,
        action=f"fdr.link_{payload.link_type}",
        entity_type="fdr",
        entity_id=old.id,
        metadata={"linked_fdr_id": successor.id, "new_state": old.lifecycle_status},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(old)
    from .deps import fdr_out

    return fdr_out(db, old)


@router.get("/{fdr_id}/lifecycle-history", response_model=list[FdrLifecycleEventOut])
def lifecycle_history(
    fdr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    fdr = db.get(FdrRecord, fdr_id)
    if fdr is None or (user.role == e.ROLE_INSTITUTION and fdr.institution_id != user.institution_id):
        raise not_found("FDR record")
    events = (
        db.execute(
            select(FdrLifecycleEvent)
            .where(FdrLifecycleEvent.fdr_id == fdr_id)
            .order_by(FdrLifecycleEvent.created_at.desc())
        )
        .scalars()
        .all()
    )
    actor_ids = {ev.actor_user_id for ev in events if ev.actor_user_id}
    names = {}
    if actor_ids:
        from ..models import User as U

        for u in db.execute(select(U).where(U.id.in_(actor_ids))).scalars().all():
            names[u.id] = u.display_name
    return [
        {
            "id": ev.id,
            "fdr_id": ev.fdr_id,
            "event_type": ev.event_type,
            "previous_value": ev.previous_value,
            "new_value": ev.new_value,
            "actor_user_id": ev.actor_user_id,
            "actor_name": names.get(ev.actor_user_id),
            "comment": ev.comment,
            "created_at": ev.created_at,
        }
        for ev in events
    ]
