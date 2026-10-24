"""Release application and clearance endpoints (Module D)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..database import get_db
from ..models import (
    ApplicationEvent,
    ClearanceRecord,
    FdrLifecycleEvent,
    FdrRecord,
    ReleaseApplication,
    User,
)
from ..schemas.common import Message, Page, paginate
from ..schemas.workflow import (
    ApplicationAssign,
    ApplicationCreate,
    ApplicationEventOut,
    ApplicationOut,
    ApplicationStatusChange,
    ClearanceCreate,
    ClearanceOut,
    ClearanceUpdate,
)
from ..security import get_current_user, require_editor, require_officer
from ..services.audit import record_audit
from ..services.notifications import notify_application_status, notify_assignment
from ..services.settings_service import int_setting
from ..services.workflow import (
    WorkflowError,
    application_missing_documents,
    apply_transition,
    ensure_clearances,
    validate_transition,
)
from .deps import bad_request, forbidden, not_found, pagination

router = APIRouter(prefix="/applications", tags=["applications"])
clearances_router = APIRouter(prefix="/clearances", tags=["clearances"])


def _next_reference(db: Session) -> str:
    year = datetime.utcnow().year
    prefix = f"REL-{year}-"
    last = db.execute(
        select(func.max(ReleaseApplication.application_reference))
        .where(ReleaseApplication.application_reference.like(f"{prefix}%"))
    ).scalar_one_or_none()
    sequence = 1
    if last:
        try:
            sequence = int(last.rsplit("-", 1)[1]) + 1
        except ValueError:  # pragma: no cover
            sequence = 1
    while True:
        candidate = f"{prefix}{sequence:04d}"
        clash = db.execute(
            select(ReleaseApplication.id).where(ReleaseApplication.application_reference == candidate)
        ).scalar_one_or_none()
        if clash is None:
            return candidate
        sequence += 1


def _app_out(db: Session, app: ReleaseApplication) -> dict:
    now = datetime.utcnow()
    days_in_stage = (now - app.current_stage_started_at).days
    overdue_days = int_setting(db, e.SETTING_OVERDUE_STAGE_DAYS, 15)
    open_clearances = sum(
        1 for c in app.clearances if c.status in (e.CLEARANCE_PENDING, e.CLEARANCE_IN_PROGRESS)
    )
    fdr = app.fdr
    return {
        "id": app.id,
        "application_reference": app.application_reference,
        "institution_id": app.institution_id,
        "institution_name": app.institution.institution_name if app.institution else None,
        "fdr_id": app.fdr_id,
        "fdr_reference_number": fdr.fdr_reference_number if fdr else None,
        "bank_name": fdr.bank_name if fdr else None,
        "deposit_amount": f"{fdr.deposit_amount:.2f}" if fdr else None,
        "maturity_date": fdr.maturity_date if fdr else None,
        "submitted_at": app.submitted_at,
        "application_status": app.application_status,
        "completeness_status": app.completeness_status,
        "assigned_officer_id": app.assigned_officer_id,
        "assigned_officer_name": app.assigned_officer.display_name if app.assigned_officer else None,
        "pending_reason": app.pending_reason,
        "current_stage_started_at": app.current_stage_started_at,
        "last_action_at": app.last_action_at,
        "created_at": app.created_at,
        "updated_at": app.updated_at,
        "days_in_current_stage": days_in_stage,
        "is_overdue": days_in_stage > overdue_days
        and app.application_status in e.ACTIVE_APPLICATION_STATES,
        "open_clearance_count": open_clearances,
        "missing_document_count": len(application_missing_documents(db, app)),
    }


def _get_scoped_app(db: Session, user: User, app_id: int) -> ReleaseApplication:
    app = db.get(ReleaseApplication, app_id)
    if app is None:
        raise not_found("Release application")
    if user.role == e.ROLE_INSTITUTION and app.institution_id != user.institution_id:
        raise not_found("Release application")
    return app


@router.get("", response_model=Page[ApplicationOut])
def list_applications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    institution_id: Optional[int] = Query(None),
    fdr_id: Optional[int] = Query(None),
    application_status: Optional[str] = Query(None),
    assigned_officer_id: Optional[int] = Query(None),
    scope: Optional[str] = Query(None, description="active | overdue | all"),
    q: Optional[str] = Query(None),
):
    page, page_size = page_info
    stmt = select(ReleaseApplication)
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(ReleaseApplication.institution_id == user.institution_id)
    elif institution_id is not None:
        stmt = stmt.where(ReleaseApplication.institution_id == institution_id)
    if fdr_id is not None:
        stmt = stmt.where(ReleaseApplication.fdr_id == fdr_id)
    if application_status:
        stmt = stmt.where(ReleaseApplication.application_status == application_status)
    if assigned_officer_id is not None:
        stmt = stmt.where(ReleaseApplication.assigned_officer_id == assigned_officer_id)
    if q:
        stmt = stmt.where(ReleaseApplication.application_reference.ilike(f"%{q.strip()}%"))

    apps = db.execute(stmt.order_by(ReleaseApplication.updated_at.desc())).scalars().all()
    overdue_days = int_setting(db, e.SETTING_OVERDUE_STAGE_DAYS, 15)
    now = datetime.utcnow()
    filtered = []
    for app in apps:
        days = (now - app.current_stage_started_at).days
        is_overdue = days > overdue_days and app.application_status in e.ACTIVE_APPLICATION_STATES
        if scope == "active" and app.application_status not in e.ACTIVE_APPLICATION_STATES:
            continue
        if scope == "overdue" and not is_overdue:
            continue
        filtered.append(app)

    total = len(filtered)
    start = (page - 1) * page_size
    return paginate([_app_out(db, a) for a in filtered[start : start + page_size]], total, page, page_size)


@router.post("", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(
    payload: ApplicationCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_editor),
):
    fdr = db.get(FdrRecord, payload.fdr_id)
    if fdr is None:
        raise not_found("FDR record")
    if user.role == e.ROLE_INSTITUTION and fdr.institution_id != user.institution_id:
        raise forbidden("You may only raise applications for your own institution's FDRs.")
    if fdr.archived_at is not None:
        raise bad_request("Archived FDR records cannot have release applications.", "archived")

    open_app = db.execute(
        select(ReleaseApplication).where(
            ReleaseApplication.fdr_id == fdr.id,
            ReleaseApplication.application_status.notin_(list(e.TERMINAL_APPLICATION_STATES)),
        )
    ).scalar_one_or_none()
    if open_app is not None:
        raise bad_request(
            f"An open application ({open_app.application_reference}) already exists for this FDR.",
            "open_application_exists",
        )

    app = ReleaseApplication(
        application_reference=_next_reference(db),
        institution_id=fdr.institution_id,
        fdr_id=fdr.id,
        application_status=e.WF_DRAFT,
        completeness_status=payload.completeness_status,
        assigned_officer_id=payload.assigned_officer_id,
        current_stage_started_at=datetime.utcnow(),
        last_action_at=datetime.utcnow(),
    )
    db.add(app)
    db.flush()
    db.add(
        ApplicationEvent(
            application_id=app.id,
            previous_status=None,
            new_status=e.WF_DRAFT,
            event_type="created",
            actor_user_id=user.id,
            comments=payload.comments,
        )
    )
    fdr.release_application_status = e.REL_RELEASE_SUBMITTED
    record_audit(
        db,
        actor_user_id=user.id,
        action="application.created",
        entity_type="application",
        entity_id=app.id,
        metadata={"fdr_id": fdr.id, "reference": app.application_reference},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(app)
    return _app_out(db, app)


@router.get("/{application_id}", response_model=ApplicationOut)
def get_application(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _app_out(db, _get_scoped_app(db, user, application_id))


@router.patch("/{application_id}/status", response_model=ApplicationOut)
def change_status(
    application_id: int,
    payload: ApplicationStatusChange,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Validated, role-enforced, reason-required workflow transition."""
    app = _get_scoped_app(db, user, application_id)
    try:
        apply_transition(db, user, app, payload.new_status, reason=payload.reason, comments=payload.comments)
    except WorkflowError:
        raise

    if payload.new_status in (e.WF_CLEARANCE, e.WF_AUTHORITY):
        ensure_clearances(db, app)
    notify_application_status(db, app, user.display_name)
    record_audit(
        db,
        actor_user_id=user.id,
        action="application.status_changed",
        entity_type="application",
        entity_id=app.id,
        metadata={"from": None, "to": payload.new_status, "fdr_id": app.fdr_id},
        reason=payload.reason or payload.comments,
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(app)
    return _app_out(db, app)


@router.post("/{application_id}/assign", response_model=ApplicationOut)
def assign_application(
    application_id: int,
    payload: ApplicationAssign,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_officer),
):
    app = _get_scoped_app(db, user, application_id)
    officer = None
    if payload.officer_id is not None:
        officer = db.get(User, payload.officer_id)
        if officer is None or officer.role not in (e.ROLE_OFFICER, e.ROLE_ADMIN):
            raise bad_request("Target user is not an officer.", "invalid_officer")
    app.assigned_officer_id = payload.officer_id
    app.last_action_at = datetime.utcnow()
    db.add(
        ApplicationEvent(
            application_id=app.id,
            previous_status=app.application_status,
            new_status=app.application_status,
            event_type="assigned",
            actor_user_id=user.id,
            comments=payload.comments,
        )
    )
    notify_assignment(db, app, officer)
    record_audit(
        db,
        actor_user_id=user.id,
        action="application.assigned",
        entity_type="application",
        entity_id=app.id,
        metadata={"officer_id": payload.officer_id},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(app)
    return _app_out(db, app)


@router.get("/{application_id}/timeline", response_model=list[ApplicationEventOut])
def timeline(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    app = _get_scoped_app(db, user, application_id)
    events = (
        db.execute(
            select(ApplicationEvent)
            .where(ApplicationEvent.application_id == app.id)
            .order_by(ApplicationEvent.created_at.desc())
        )
        .scalars()
        .all()
    )
    actor_ids = {ev.actor_user_id for ev in events if ev.actor_user_id}
    names = {}
    if actor_ids:
        for u in db.execute(select(User).where(User.id.in_(actor_ids))).scalars().all():
            names[u.id] = u.display_name
    return [
        {
            "id": ev.id,
            "application_id": ev.application_id,
            "previous_status": ev.previous_status,
            "new_status": ev.new_status,
            "event_type": ev.event_type,
            "actor_user_id": ev.actor_user_id,
            "actor_name": names.get(ev.actor_user_id),
            "comments": ev.comments,
            "created_at": ev.created_at,
        }
        for ev in events
    ]


@router.get("/{application_id}/allowed-transitions", response_model=list[str])
def allowed_transitions(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Which states *this* user may move the case to (drives the UI honestly)."""
    app = _get_scoped_app(db, user, application_id)
    results = []
    for target in e.WORKFLOW_TRANSITIONS.get(app.application_status, ()):
        try:
            validate_transition(db, user, app, target, reason="probe")
        except WorkflowError:
            continue
        results.append(target)
    return results


# ---------------------------------------------------------------------------
# Clearances
# ---------------------------------------------------------------------------
def _clearance_out(db: Session, clearance: ClearanceRecord) -> dict:
    now = datetime.utcnow()
    start = clearance.requested_at or clearance.created_at
    days = (now - start).days if clearance.status in (e.CLEARANCE_PENDING, e.CLEARANCE_IN_PROGRESS) else None
    threshold = int_setting(db, e.SETTING_CLEARANCE_ESCALATION_DAYS, 10)
    return {
        "id": clearance.id,
        "application_id": clearance.application_id,
        "clearance_type": clearance.clearance_type,
        "clearance_label": e.CLEARANCE_LABELS.get(clearance.clearance_type, clearance.clearance_type),
        "status": clearance.status,
        "assigned_unit": clearance.assigned_unit,
        "requested_at": clearance.requested_at,
        "completed_at": clearance.completed_at,
        "remarks": clearance.remarks,
        "updated_by": clearance.updated_by,
        "created_at": clearance.created_at,
        "updated_at": clearance.updated_at,
        "days_pending": days,
        "is_overdue": days is not None and days >= threshold,
    }


@clearances_router.get("", response_model=Page[ClearanceOut])
def list_clearances(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    application_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
):
    page, page_size = page_info
    stmt = select(ClearanceRecord).join(
        ReleaseApplication, ClearanceRecord.application_id == ReleaseApplication.id
    )
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(ReleaseApplication.institution_id == user.institution_id)
    if application_id is not None:
        stmt = stmt.where(ClearanceRecord.application_id == application_id)
    if status_filter:
        stmt = stmt.where(ClearanceRecord.status == status_filter)
    rows = db.execute(stmt.order_by(ClearanceRecord.created_at.desc())).scalars().all()
    total = len(rows)
    start = (page - 1) * page_size
    return paginate(
        [_clearance_out(db, c) for c in rows[start : start + page_size]], total, page, page_size
    )


@clearances_router.post("/{clearance_id}", response_model=ClearanceOut)
def update_clearance(
    clearance_id: int,
    payload: ClearanceUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_officer),
):
    clearance = db.get(ClearanceRecord, clearance_id)
    if clearance is None:
        raise not_found("Clearance")
    if payload.status not in e.CLEARANCE_STATUSES:
        raise bad_request("Unknown clearance status.", "invalid_status")
    if payload.status in (e.CLEARANCE_NOT_CLEARED, e.CLEARANCE_WAIVED) and not (payload.remarks or "").strip():
        raise bad_request("Remarks are required when a clearance is not cleared or waived.", "reason_required")

    previous = clearance.status
    clearance.status = payload.status
    clearance.updated_by = user.id
    if payload.remarks:
        clearance.remarks = payload.remarks
    if payload.status in (e.CLEARANCE_CLEARED, e.CLEARANCE_NOT_CLEARED, e.CLEARANCE_WAIVED):
        clearance.completed_at = datetime.utcnow()

    app = db.get(ReleaseApplication, clearance.application_id)
    if app is not None:
        app.last_action_at = datetime.utcnow()
        db.add(
            ApplicationEvent(
                application_id=app.id,
                previous_status=app.application_status,
                new_status=app.application_status,
                event_type=f"clearance.{payload.status}",
                actor_user_id=user.id,
                comments=f"{e.CLEARANCE_LABELS.get(clearance.clearance_type, clearance.clearance_type)}: "
                f"{previous} -> {payload.status}. {payload.remarks or ''}".strip(),
            )
        )
    record_audit(
        db,
        actor_user_id=user.id,
        action="clearance.updated",
        entity_type="clearance",
        entity_id=clearance.id,
        metadata={"from": previous, "to": payload.status, "application_id": clearance.application_id},
        reason=payload.remarks,
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(clearance)
    return _clearance_out(db, clearance)


@clearances_router.post("/from-application/{application_id}", response_model=ClearanceOut, status_code=201)
def create_clearance(
    application_id: int,
    payload: ClearanceCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_officer),
):
    app = db.get(ReleaseApplication, application_id)
    if app is None:
        raise not_found("Release application")
    if payload.clearance_type not in e.CLEARANCE_TYPES:
        raise bad_request(
            f"Unknown clearance type '{payload.clearance_type}'.",
            "invalid_clearance_type",
        )
    existing = db.execute(
        select(ClearanceRecord).where(
            ClearanceRecord.application_id == app.id,
            ClearanceRecord.clearance_type == payload.clearance_type,
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise bad_request("That clearance type already exists for this case.", "duplicate_clearance")
    clearance = ClearanceRecord(
        application_id=app.id,
        clearance_type=payload.clearance_type,
        status=e.CLEARANCE_PENDING,
        assigned_unit=payload.assigned_unit,
        requested_at=datetime.utcnow(),
        remarks=payload.remarks,
    )
    db.add(clearance)
    db.flush()
    record_audit(
        db,
        actor_user_id=user.id,
        action="clearance.created",
        entity_type="clearance",
        entity_id=clearance.id,
        metadata={"application_id": app.id, "type": payload.clearance_type},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(clearance)
    return _clearance_out(db, clearance)
