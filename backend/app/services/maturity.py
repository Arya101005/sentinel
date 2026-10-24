"""Maturity & non-applicant intelligence (Module C).

Pure classification rules + query helpers feeding the dashboard, the maturity
queues and the notification scheduler. Nothing here ever declares an FDR
"eligible for release" — a matured FDR without a recorded application is
*flagged for review* only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable, Optional, Sequence

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from .. import enums as e
from ..models import (
    DiscrepancyFlag,
    FdrRecord,
    Institution,
    ReleaseApplication,
    User,
)
from .settings_service import int_setting, maturity_thresholds

# FDR lifecycle states that are no longer monitored as active deposits.
EXCLUDED_LIFECYCLE = (e.LIFECYCLE_ARCHIVED, e.LIFECYCLE_RENEWED, e.LIFECYCLE_REPLACED)

_APPLICATION_CATEGORY_MAP = {
    e.WF_DRAFT: e.CAT_APP_SUBMITTED,
    e.WF_SUBMITTED: e.CAT_APP_SUBMITTED,
    e.WF_NEEDS_CORRECTION: e.CAT_APP_SUBMITTED,
    e.WF_DOCUMENT_CHECKS: e.CAT_APP_VERIFICATION,
    e.WF_OFFICER_VERIFICATION: e.CAT_APP_VERIFICATION,
    e.WF_BANK_VERIFICATION: e.CAT_APP_VERIFICATION,
    e.WF_CLEARANCE: e.CAT_APP_CLEARANCE,
    e.WF_AUTHORITY: e.CAT_APP_AUTHORITY,
    e.WF_APPROVED: e.CAT_APP_AUTHORITY,
    e.WF_RELEASE_PROCESSING: e.CAT_RELEASE_PROCESSING,
    e.WF_COMPLETED: e.CAT_COMPLETED,
    e.WF_REJECTED: None,  # terminal-rejected: treated as "no active application"
    e.WF_ON_HOLD: e.CAT_ON_HOLD,
}


@dataclass
class Classification:
    category: str
    days_to_maturity: Optional[int]
    days_since_maturity: Optional[int]
    application: Optional[ReleaseApplication]
    reason: str


def days_until(target: date, today: date) -> int:
    return (target - today).days


def classify_fdr(
    fdr: FdrRecord,
    applications: Sequence[ReleaseApplication],
    today: date,
    data_complete: bool = True,  # noqa: ARG001 - reserved for coverage reporting
) -> Classification:
    """Classify one FDR against maturity date + recorded application state.

    Business rules (documented in README):
      1. Archived / renewed / replaced records are excluded from monitoring so a
         renewal pair never counts as two active deposits.
      2. If an open (non-terminal) release application exists, the application's
         workflow stage decides the category.
      3. A completed application (or released lifecycle) is 'completed'.
      4. Otherwise maturity date decides: future -> upcoming (within thresholds)
         or plain active; today/past -> matured without an active application.
      5. Recorded hold/eligibility information yields 'on hold or ineligible'.
    """
    days_to: Optional[int] = None
    days_since: Optional[int] = None
    if fdr.maturity_date is not None:
        days_to = days_until(fdr.maturity_date, today)
        days_since = -days_to

    open_apps = [
        a for a in applications if a.application_status not in e.TERMINAL_APPLICATION_STATES
    ]
    completed_apps = [a for a in applications if a.application_status == e.WF_COMPLETED]
    latest_app = max(applications, key=lambda a: a.updated_at) if applications else None

    if fdr.lifecycle_status in EXCLUDED_LIFECYCLE:
        return Classification(e.CAT_EXCLUDED, days_to, days_since, latest_app,
                              f"lifecycle={fdr.lifecycle_status}")

    if fdr.lifecycle_status == e.LIFECYCLE_RELEASED or completed_apps:
        app = completed_apps[0] if completed_apps else latest_app
        return Classification(e.CAT_COMPLETED, days_to, days_since, app, "release completed")

    if open_apps:
        # Use the most advanced open application.
        def _rank(app: ReleaseApplication) -> int:
            states: tuple = e.WORKFLOW_STATES
            return states.index(app.application_status) if app.application_status in states else 0

        app = max(open_apps, key=_rank)
        category = _APPLICATION_CATEGORY_MAP.get(app.application_status) or e.CAT_APP_SUBMITTED
        return Classification(category, days_to, days_since, app,
                              f"application {app.application_reference} = {app.application_status}")

    # No active application from here on.
    if fdr.lifecycle_status == e.LIFECYCLE_ON_HOLD or (fdr.eligibility_notes or "").strip():
        return Classification(e.CAT_ON_HOLD, days_to, days_since, latest_app,
                              "recorded hold / eligibility note")

    if fdr.maturity_date is None:
        return Classification(e.CAT_ACTIVE, None, None, latest_app, "no maturity date recorded")

    if days_to is not None and days_to <= 0:
        return Classification(e.CAT_MATURED_NO_APP, days_to, days_since, latest_app,
                              "matured with no active release application")

    thresholds = [90, 30, 7]
    max_threshold = max(thresholds) if thresholds else 90
    if days_to is not None and days_to <= max_threshold:
        return Classification(e.CAT_UPCOMING, days_to, days_since, latest_app, "within alert window")

    return Classification(e.CAT_ACTIVE, days_to, days_since, latest_app, "not near maturity")


def classify_with_thresholds(
    fdr: FdrRecord,
    applications: Sequence[ReleaseApplication],
    today: date,
    thresholds: Sequence[int],
) -> Classification:
    """Same as classify_fdr but using configured thresholds (scheduler path)."""
    result = classify_fdr(fdr, applications, today)
    if result.category == e.CAT_ACTIVE and fdr.maturity_date is not None and thresholds:
        days_to = days_until(fdr.maturity_date, today)
        if 0 < days_to <= max(thresholds):
            return Classification(e.CAT_UPCOMING, days_to, result.days_since_maturity,
                                  result.application, "within configured alert window")
    return result


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------
def institution_scope(user: User) -> Optional[int]:
    """Institution users only ever see their own institution's records."""
    return user.institution_id if user.role == e.ROLE_INSTITUTION else None


def base_fdr_query(user: User) -> Select:
    stmt = select(FdrRecord).join(Institution, FdrRecord.institution_id == Institution.id)
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(FdrRecord.institution_id == user.institution_id)
    return stmt


def apply_fdr_filters(
    stmt: Select,
    *,
    institution_id: Optional[int] = None,
    region: Optional[str] = None,
    bank_name: Optional[str] = None,
    lifecycle_status: Optional[str] = None,
    verification_status: Optional[str] = None,
    release_status: Optional[str] = None,
    maturity_from: Optional[date] = None,
    maturity_to: Optional[date] = None,
    application_status: Optional[str] = None,
    assigned_officer_id: Optional[int] = None,
    discrepancy_status: Optional[str] = None,
    q: Optional[str] = None,
) -> Select:
    if institution_id is not None:
        stmt = stmt.where(FdrRecord.institution_id == institution_id)
    if region:
        stmt = stmt.where(Institution.region == region)
    if bank_name:
        stmt = stmt.where(FdrRecord.bank_name == bank_name)
    if lifecycle_status:
        stmt = stmt.where(FdrRecord.lifecycle_status == lifecycle_status)
    if verification_status:
        stmt = stmt.where(FdrRecord.verification_status == verification_status)
    if release_status:
        stmt = stmt.where(FdrRecord.release_application_status == release_status)
    if maturity_from is not None:
        stmt = stmt.where(FdrRecord.maturity_date >= maturity_from)
    if maturity_to is not None:
        stmt = stmt.where(FdrRecord.maturity_date <= maturity_to)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                FdrRecord.fdr_reference_number.ilike(like),
                FdrRecord.bank_name.ilike(like),
                Institution.institution_name.ilike(like),
            )
        )
    if application_status:
        stmt = stmt.where(
            FdrRecord.id.in_(
                select(ReleaseApplication.fdr_id).where(
                    ReleaseApplication.application_status == application_status
                )
            )
        )
    if assigned_officer_id is not None:
        stmt = stmt.where(
            FdrRecord.id.in_(
                select(ReleaseApplication.fdr_id).where(
                    ReleaseApplication.assigned_officer_id == assigned_officer_id
                )
            )
        )
    if discrepancy_status:
        stmt = stmt.where(
            FdrRecord.id.in_(
                select(DiscrepancyFlag.fdr_id).where(
                    DiscrepancyFlag.status == discrepancy_status
                )
            )
        )
    return stmt


def enrich_rows(
    db: Session,
    records: Iterable[FdrRecord],
    today: date,
    thresholds: Sequence[int],
) -> list[dict[str, Any]]:
    """Attach classification + counters to a page of FDR records."""
    records = list(records)
    fdr_ids = [r.id for r in records]
    apps_by_fdr: dict[int, list[ReleaseApplication]] = {}
    disc_by_fdr: dict[int, int] = {}
    if fdr_ids:
        apps = (
            db.execute(
                select(ReleaseApplication).where(ReleaseApplication.fdr_id.in_(fdr_ids))
            )
            .scalars()
            .all()
        )
        for a in apps:
            apps_by_fdr.setdefault(a.fdr_id, []).append(a)
        open_counts = (
            db.execute(
                select(DiscrepancyFlag.fdr_id, func.count(DiscrepancyFlag.id))
                .where(
                    DiscrepancyFlag.fdr_id.in_(fdr_ids),
                    DiscrepancyFlag.status.in_(e.OPEN_DISCREPANCY_STATUSES),
                )
                .group_by(DiscrepancyFlag.fdr_id)
            )
            .all()
        )
        disc_by_fdr = dict(open_counts)

    rows: list[dict[str, Any]] = []
    for rec in records:
        cls = classify_with_thresholds(rec, apps_by_fdr.get(rec.id, []), today, thresholds)
        rows.append(
            {
                "record": rec,
                "classification": cls,
                "open_discrepancies": disc_by_fdr.get(rec.id, 0),
            }
        )
    return rows


def fdr_ids_in_category(
    db: Session,
    user: User,
    category: str,
    today: date,
    filters: Optional[dict] = None,
) -> set[int]:
    """IDs of monitored FDRs whose computed monitoring category == `category`."""
    stmt = base_fdr_query(user)
    stmt = apply_fdr_filters(stmt, **(filters or {}))
    records = db.execute(stmt).scalars().unique().all()
    thresholds = maturity_thresholds(db)
    wanted: set[int] = set()
    for row in enrich_rows(db, records, today, thresholds):
        if row["classification"].category == category:
            wanted.add(row["record"].id)
    return wanted


def monitoring_rows(
    db: Session,
    user: User,
    categories: Sequence[str],
    *,
    page: int = 1,
    page_size: int = 25,
    filters: Optional[dict] = None,
    sort_by: Optional[str] = None,
    sort_dir: str = "asc",
) -> tuple[list[dict[str, Any]], int]:
    """Paginated queue rows restricted to the requested monitoring categories."""
    stmt = apply_fdr_filters(base_fdr_query(user), **(filters or {}))
    records = db.execute(stmt).scalars().unique().all()
    today = date.today()
    thresholds = maturity_thresholds(db)
    rows = enrich_rows(db, records, today, thresholds)
    rows = [r for r in rows if r["classification"].category in categories]

    sort_key = sort_by or "maturity_date"
    reverse = sort_dir.lower() == "desc"

    def _sort_value(r: dict) -> Any:
        rec: FdrRecord = r["record"]
        if sort_key == "deposit_amount":
            return float(rec.deposit_amount)
        if sort_key == "days_to_maturity":
            cls = r["classification"]
            return cls.days_to_maturity if cls.days_to_maturity is not None else 10**6
        if sort_key == "institution_name":
            return (rec.institution.institution_name if rec.institution else "").lower()
        if sort_key == "fdr_reference_number":
            return rec.fdr_reference_number.lower()
        return getattr(rec, sort_key, None) or date.max

    rows.sort(key=_sort_value, reverse=reverse)
    total = len(rows)
    start = (page - 1) * page_size
    return rows[start : start + page_size], total


# ---------------------------------------------------------------------------
# Dashboard counts (all values computed from the database)
# ---------------------------------------------------------------------------
def dashboard_counts(db: Session, user: User) -> dict[str, int]:
    today = date.today()
    thresholds = maturity_thresholds(db)
    stmt = apply_fdr_filters(base_fdr_query(user))
    records = db.execute(stmt).scalars().unique().all()
    rows = enrich_rows(db, records, today, thresholds)

    active_statuses = set(e.ACTIVE_LIFECYCLE_STATUSES)
    counts = {
        "total_active_fdrs": 0,
        "matured_no_application": 0,
        "awaiting_verification": 0,
        "open_discrepancies": 0,
        "applications_awaiting_action": 0,
        "overdue_cases": 0,
        "completed_releases": 0,
        "pending_clearances": 0,
        "excluded_records": 0,
        "missing_maturity_date": 0,
    }
    for threshold in thresholds:
        counts[f"maturing_within_{threshold}_days"] = 0

    overdue_days = int_setting(db, e.SETTING_OVERDUE_STAGE_DAYS, 15)
    for row in rows:
        rec: FdrRecord = row["record"]
        cls: Classification = row["classification"]
        if rec.lifecycle_status in active_statuses:
            counts["total_active_fdrs"] += 1
        else:
            counts["excluded_records"] += 1
        if rec.maturity_date is None and rec.lifecycle_status in active_statuses:
            counts["missing_maturity_date"] += 1
        if cls.category == e.CAT_MATURED_NO_APP:
            counts["matured_no_application"] += 1
        if rec.lifecycle_status in active_statuses and rec.verification_status in (
            e.FDR_VERIFICATION_PENDING,
            e.FDR_VERIFICATION_MANUAL,
            e.FDR_VERIFICATION_DISCREPANCY,
        ):
            counts["awaiting_verification"] += 1
        if rec.lifecycle_status in active_statuses and cls.category in (
            e.CAT_APP_SUBMITTED,
            e.CAT_APP_VERIFICATION,
        ):
            counts["awaiting_verification"] += 1 if cls.category == e.CAT_APP_VERIFICATION else 0
        if rec.lifecycle_status in active_statuses:
            for threshold in thresholds:
                if (
                    cls.days_to_maturity is not None
                    and 0 < cls.days_to_maturity <= threshold
                    and cls.category in (e.CAT_UPCOMING, e.CAT_ACTIVE)
                ):
                    counts[f"maturing_within_{threshold}_days"] += 1
        counts["open_discrepancies"] += row["open_discrepancies"]
        if cls.category == e.CAT_COMPLETED:
            counts["completed_releases"] += 1

    # Application-side counts (respecting institution scope).
    app_stmt = select(ReleaseApplication)
    if user.role == e.ROLE_INSTITUTION:
        app_stmt = app_stmt.where(ReleaseApplication.institution_id == user.institution_id)
    apps = db.execute(app_stmt).scalars().all()
    for app in apps:
        if app.application_status in e.ACTIVE_APPLICATION_STATES:
            counts["applications_awaiting_action"] += 1
            stage_days = (datetime.utcnow() - app.current_stage_started_at).days
            if stage_days > overdue_days:
                counts["overdue_cases"] += 1

    clr = select(ReleaseApplication.id).where(
        ReleaseApplication.application_status.in_(
            [e.WF_CLEARANCE, e.WF_AUTHORITY, e.WF_APPROVED]
        )
    )
    if user.role == e.ROLE_INSTITUTION:
        clr = clr.where(ReleaseApplication.institution_id == user.institution_id)
    clr_ids = list(db.execute(clr).scalars().all())
    if clr_ids:
        from ..models import ClearanceRecord

        counts["pending_clearances"] = (
            db.execute(
                select(func.count(ClearanceRecord.id)).where(
                    ClearanceRecord.application_id.in_(clr_ids),
                    ClearanceRecord.status.in_([e.CLEARANCE_PENDING, e.CLEARANCE_IN_PROGRESS]),
                )
            )
            .scalar_one()
            or 0
        )
    return counts
