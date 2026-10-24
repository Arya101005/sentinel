"""Monitoring endpoints: KPI summary, charts, maturity queues, manual job trigger."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..config import settings
from ..database import get_db
from ..models import ClearanceRecord, ReleaseApplication, User
from ..schemas.common import Page, paginate
from ..schemas.workflow import DashboardCharts, DashboardSummary, MonitoringRunResult
from ..security import get_current_user, require_officer
from ..services.analytics import charts, kpi_cards
from ..services.maturity import monitoring_rows
from ..services.scheduler import run_monitoring_job
from ..services.settings_service import int_setting, maturity_thresholds
from ..services.audit import record_audit
from .deps import monitoring_row, pagination

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


def _queue(
    db: Session,
    user: User,
    categories: tuple[str, ...],
    page: int,
    page_size: int,
    filters: dict,
    sort_by: Optional[str],
    sort_dir: str,
) -> Page[dict]:
    rows, total = monitoring_rows(
        db, user, categories, page=page, page_size=page_size, filters=filters,
        sort_by=sort_by, sort_dir=sort_dir,
    )
    items = [monitoring_row(db, item) for item in rows]
    return paginate(items, total, page, page_size)


@router.get("/summary", response_model=DashboardSummary)
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    payload = kpi_cards(db, user)
    return {
        "generated_at": datetime.utcnow(),
        "cards": payload["cards"],
        "data_coverage_warning": payload["data_coverage_warning"],
    }


@router.get("/charts", response_model=DashboardCharts)
def dashboard_charts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return charts(db, user)


def _common_filters(
    institution_id: Optional[int],
    region: Optional[str],
    bank: Optional[str],
    maturity_from: Optional[date],
    maturity_to: Optional[date],
    user: User,
) -> dict:
    filters = {
        "institution_id": institution_id if user.role != e.ROLE_INSTITUTION else user.institution_id,
        "region": region,
        "bank_name": bank,
        "maturity_from": maturity_from,
        "maturity_to": maturity_to,
    }
    return filters


@router.get("/upcoming-maturity", response_model=Page[dict])
def upcoming_maturity(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    institution_id: Optional[int] = Query(None),
    region: Optional[str] = Query(None),
    bank: Optional[str] = Query(None),
    maturity_from: Optional[date] = Query(None),
    maturity_to: Optional[date] = Query(None),
    threshold: Optional[int] = Query(None, description="Restrict to one configured threshold"),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("asc"),
):
    page, page_size = page_info
    filters = _common_filters(institution_id, region, bank, maturity_from, maturity_to, user)
    if threshold is not None:
        filters["maturity_to"] = date.today() + timedelta(days=threshold)
    rows, total = monitoring_rows(
        db, user, (e.CAT_UPCOMING,), page=1, page_size=100000,
        filters=filters, sort_by=sort_by, sort_dir=sort_dir,
    )
    start = (page - 1) * page_size
    page_rows = rows[start : start + page_size]
    return paginate([monitoring_row(db, item) for item in page_rows], total, page, page_size)


@router.get("/matured-no-application", response_model=Page[dict])
def matured_no_application(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    institution_id: Optional[int] = Query(None),
    region: Optional[str] = Query(None),
    bank: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("desc"),
):
    """Matured FDRs with no active release application recorded (review trigger)."""
    page, page_size = page_info
    filters = _common_filters(institution_id, region, bank, None, None, user)
    return _queue(db, user, (e.CAT_MATURED_NO_APP,), page, page_size, filters, sort_by, sort_dir)


@router.get("/pending-verification", response_model=Page[dict])
def pending_verification(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    institution_id: Optional[int] = Query(None),
    region: Optional[str] = Query(None),
    bank: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("asc"),
):
    page, page_size = page_info
    filters = _common_filters(institution_id, region, bank, None, None, user)
    return _queue(
        db, user, (e.CAT_APP_VERIFICATION, e.CAT_APP_SUBMITTED), page, page_size, filters, sort_by, sort_dir
    )


@router.get("/pending-clearance", response_model=Page[dict])
def pending_clearance(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    institution_id: Optional[int] = Query(None),
):
    """Cases whose required clearances are outstanding, with elapsed time."""
    page, page_size = page_info
    now = datetime.utcnow()
    threshold = int_setting(db, e.SETTING_CLEARANCE_ESCALATION_DAYS, 10)
    stmt = (
        select(ClearanceRecord, ReleaseApplication)
        .join(ReleaseApplication, ClearanceRecord.application_id == ReleaseApplication.id)
        .where(ClearanceRecord.status.in_([e.CLEARANCE_PENDING, e.CLEARANCE_IN_PROGRESS]))
    )
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(ReleaseApplication.institution_id == user.institution_id)
    elif institution_id is not None:
        stmt = stmt.where(ReleaseApplication.institution_id == institution_id)
    pairs = db.execute(stmt.order_by(ClearanceRecord.requested_at)).all()
    total = len(pairs)
    start = (page - 1) * page_size
    items = []
    for clearance, app in pairs[start : start + page_size]:
        start_at = clearance.requested_at or clearance.created_at
        days = (now - start_at).days
        items.append(
            {
                "clearance_id": clearance.id,
                "application_id": app.id,
                "application_reference": app.application_reference,
                "institution_id": app.institution_id,
                "institution_name": app.institution.institution_name if app.institution else "",
                "fdr_id": app.fdr_id,
                "fdr_reference_number": app.fdr.fdr_reference_number if app.fdr else "",
                "clearance_type": clearance.clearance_type,
                "clearance_label": e.CLEARANCE_LABELS.get(
                    clearance.clearance_type, clearance.clearance_type
                ),
                "status": clearance.status,
                "assigned_unit": clearance.assigned_unit,
                "requested_at": start_at,
                "days_pending": days,
                "is_overdue": days >= threshold,
                "escalation_threshold_days": threshold,
            }
        )
    return paginate(items, total, page, page_size)


@router.get("/overdue", response_model=Page[dict])
def overdue(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    institution_id: Optional[int] = Query(None),
):
    """Active cases longer than the configured stage threshold."""
    page, page_size = page_info
    now = datetime.utcnow()
    overdue_days = int_setting(db, e.SETTING_OVERDUE_STAGE_DAYS, 15)
    stmt = select(ReleaseApplication).where(
        ReleaseApplication.application_status.in_(list(e.ACTIVE_APPLICATION_STATES))
    )
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(ReleaseApplication.institution_id == user.institution_id)
    elif institution_id is not None:
        stmt = stmt.where(ReleaseApplication.institution_id == institution_id)
    apps = db.execute(stmt.order_by(ReleaseApplication.current_stage_started_at)).scalars().all()
    rows = []
    for app in apps:
        days = (now - app.current_stage_started_at).days
        if days <= overdue_days:
            continue
        rows.append(
            {
                "application_id": app.id,
                "application_reference": app.application_reference,
                "institution_id": app.institution_id,
                "institution_name": app.institution.institution_name if app.institution else "",
                "fdr_id": app.fdr_id,
                "fdr_reference_number": app.fdr.fdr_reference_number if app.fdr else "",
                "application_status": app.application_status,
                "status_label": e.WORKFLOW_STATE_LABELS.get(
                    app.application_status, app.application_status
                ),
                "assigned_officer_name": (
                    app.assigned_officer.display_name if app.assigned_officer else None
                ),
                "current_stage_started_at": app.current_stage_started_at,
                "days_in_stage": days,
                "overdue_threshold_days": overdue_days,
            }
        )
    total = len(rows)
    start = (page - 1) * page_size
    return paginate(rows[start : start + page_size], total, page, page_size)


@router.post("/run-checks", response_model=MonitoringRunResult)
def run_checks(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_officer),
):
    """Manually run one monitoring pass (demo/testing); idempotent."""
    result = run_monitoring_job(db)
    record_audit(
        db,
        actor_user_id=user.id,
        action="monitoring.run",
        entity_type="monitoring",
        metadata={
            "checked": result["checked"],
            "created": result["notifications_created"],
            "escalations": result["escalations_created"],
        },
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    return result


@router.get("/cron")
def run_monitoring_cron(request: Request, db: Session = Depends(get_db)):
    """Scheduled-job entry point (e.g. Vercel Cron) for the maturity/escalation pass.

    The in-process APScheduler job cannot run in a serverless function, so on
    Vercel a Cron hits this route instead. When ``CRON_SECRET`` is configured,
    the request must carry ``Authorization: Bearer ${CRON_SECRET}``; with no
    secret set (local development) the trigger is open.
    """
    secret = settings.cron_secret
    if secret:
        provided = request.headers.get("authorization", "")
        if provided != f"Bearer {secret}":
            raise HTTPException(status_code=401, detail="Invalid or missing cron secret.")
    result = run_monitoring_job(db)
    record_audit(
        db,
        actor_user_id=None,
        action="cron.monitoring_run",
        entity_type="monitoring",
        metadata={
            "checked": result["checked"],
            "created": result["notifications_created"],
            "escalations": result["escalations_created"],
        },
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    return result
