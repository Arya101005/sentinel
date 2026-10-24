"""Dashboard analytics: KPI cards and chart aggregations (all DB-computed)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..models import (
    DiscrepancyFlag,
    FdrRecord,
    Institution,
    ReleaseApplication,
    User,
)
from .maturity import apply_fdr_filters, base_fdr_query, dashboard_counts, enrich_rows
from .settings_service import int_setting, maturity_thresholds

CARD_ROUTES = {
    "total_active_fdrs": "/fdrs?lifecycle=active",
    "matured_no_application": "/maturity/non-applicants",
    "awaiting_verification": "/fdrs?verification=pending_review",
    "open_discrepancies": "/discrepancies?status=open",
    "applications_awaiting_action": "/applications?scope=active",
    "overdue_cases": "/applications?scope=overdue",
    "completed_releases": "/applications?status=completed",
    "pending_clearances": "/clearances?status=pending",
}


def kpi_cards(db: Session, user: User) -> dict:
    counts = dashboard_counts(db, user)
    thresholds = maturity_thresholds(db)
    cards = [
        {
            "key": "total_active_fdrs",
            "label": "Active FDR records",
            "value": counts["total_active_fdrs"],
            "hint": f"Plus {counts['excluded_records']} archived / renewed / replaced records excluded from active counts.",
            "route": CARD_ROUTES["total_active_fdrs"],
        }
    ]
    for threshold in sorted(thresholds, reverse=True):
        cards.append(
            {
                "key": f"maturing_within_{threshold}_days",
                "label": f"Maturing within {threshold} days",
                "value": counts.get(f"maturing_within_{threshold}_days", 0),
                "hint": "Configurable threshold — demonstration default, not an AICTE-mandated interval.",
                "route": f"/maturity?threshold={threshold}",
            }
        )
    cards += [
        {
            "key": "matured_no_application",
            "label": "Matured, no release application recorded",
            "value": counts["matured_no_application"],
            "hint": "Review trigger only — absence here does not prove no application exists elsewhere.",
            "route": CARD_ROUTES["matured_no_application"],
            "severity": "high" if counts["matured_no_application"] else None,
        },
        {
            "key": "awaiting_verification",
            "label": "Awaiting document verification",
            "value": counts["awaiting_verification"],
            "route": CARD_ROUTES["awaiting_verification"],
        },
        {
            "key": "open_discrepancies",
            "label": "Open discrepancy flags",
            "value": counts["open_discrepancies"],
            "route": CARD_ROUTES["open_discrepancies"],
        },
        {
            "key": "pending_clearances",
            "label": "Pending clearances",
            "value": counts["pending_clearances"],
            "route": CARD_ROUTES["pending_clearances"],
        },
        {
            "key": "applications_awaiting_action",
            "label": "Release applications awaiting action",
            "value": counts["applications_awaiting_action"],
            "route": CARD_ROUTES["applications_awaiting_action"],
        },
        {
            "key": "overdue_cases",
            "label": "Overdue cases",
            "value": counts["overdue_cases"],
            "hint": f"Longer than {int_setting(db, e.SETTING_OVERDUE_STAGE_DAYS, 15)} days in the current stage.",
            "route": CARD_ROUTES["overdue_cases"],
            "severity": "high" if counts["overdue_cases"] else None,
        },
        {
            "key": "completed_releases",
            "label": "Completed releases",
            "value": counts["completed_releases"],
            "route": CARD_ROUTES["completed_releases"],
        },
    ]
    warnings = []
    if counts["missing_maturity_date"]:
        warnings.append(
            f"{counts['missing_maturity_date']} active record(s) have no recorded maturity date and "
            "are excluded from maturity monitoring until one is provided."
        )
    warnings.append(
        "Statistics are computed from this system's records only. Missing records may exist in "
        "other channels (e.g. the AICTE JFDR portal)."
    )
    return {"cards": cards, "data_coverage_warning": " ".join(warnings), "counts": counts}


def _series(key: str, title: str, buckets: list[tuple[str, int]]) -> dict:
    return {
        "key": key,
        "title": title,
        "buckets": [{"label": label, "value": int(value)} for label, value in buckets],
    }


def charts(db: Session, user: User) -> dict:
    today = date.today()
    thresholds = maturity_thresholds(db)
    records = db.execute(apply_fdr_filters(base_fdr_query(user))).scalars().unique().all()
    active = [r for r in records if r.lifecycle_status in e.ACTIVE_LIFECYCLE_STATUSES]

    # 1) Lifecycle distribution (all scoped records)
    lifecycle_counts: dict[str, int] = {s: 0 for s in e.LIFECYCLE_STATUSES}
    for rec in records:
        lifecycle_counts[rec.lifecycle_status] = lifecycle_counts.get(rec.lifecycle_status, 0) + 1
    lifecycle = _series(
        "lifecycle_status",
        "FDRs by lifecycle status",
        [(s, lifecycle_counts.get(s, 0)) for s in e.LIFECYCLE_STATUSES],
    )

    # 2) Upcoming maturity by month (next 6 months)
    buckets: list[tuple[str, int]] = []
    cursor = date(today.year, today.month, 1)
    for _ in range(6):
        if cursor.month == 12:
            nxt = date(cursor.year + 1, 1, 1)
        else:
            nxt = date(cursor.year, cursor.month + 1, 1)
        count = sum(
            1
            for r in active
            if r.maturity_date is not None and cursor <= r.maturity_date < nxt
        )
        buckets.append((cursor.strftime("%b %Y"), count))
        cursor = nxt
    upcoming = _series("upcoming_maturity_by_month", "Upcoming maturity by month", buckets)

    # 3) Active FDRs by region
    region_counts: dict[str, int] = {}
    for rec in active:
        region = (rec.institution.region if rec.institution else "") or "Unassigned"
        region_counts[region] = region_counts.get(region, 0) + 1
    by_region = _series(
        "by_region",
        "Active FDRs by region",
        sorted(region_counts.items(), key=lambda kv: (-kv[1], kv[0])),
    )

    # 4) Discrepancy categories
    disc_rows = db.execute(
        select(DiscrepancyFlag.discrepancy_type, func.count(DiscrepancyFlag.id)).group_by(
            DiscrepancyFlag.discrepancy_type
        )
    ).all()
    if user.role == e.ROLE_INSTITUTION:
        disc_rows = db.execute(
            select(DiscrepancyFlag.discrepancy_type, func.count(DiscrepancyFlag.id))
            .join(FdrRecord, DiscrepancyFlag.fdr_id == FdrRecord.id)
            .where(FdrRecord.institution_id == user.institution_id)
            .group_by(DiscrepancyFlag.discrepancy_type)
        ).all()
    discrepancies = _series(
        "discrepancy_categories",
        "Discrepancy flags by category",
        [(t.replace("_", " ").title(), c) for t, c in disc_rows],
    )

    # 5) Pending cases by workflow stage
    app_stmt = select(
        ReleaseApplication.application_status, func.count(ReleaseApplication.id)
    ).where(ReleaseApplication.application_status.in_(list(e.ACTIVE_APPLICATION_STATES)))
    if user.role == e.ROLE_INSTITUTION:
        app_stmt = app_stmt.where(ReleaseApplication.institution_id == user.institution_id)
    stage_rows = db.execute(app_stmt.group_by(ReleaseApplication.application_status)).all()
    pending_stage = _series(
        "pending_by_stage",
        "Pending cases by workflow stage",
        [
            (e.WORKFLOW_STATE_LABELS.get(s, s).replace("Awaiting ", ""), c)
            for s, c in sorted(stage_rows, key=lambda kv: e.WORKFLOW_STATES.index(kv[0]))
        ],
    )

    # 6) Application processing time (completed cases)
    done_stmt = select(ReleaseApplication).where(
        ReleaseApplication.application_status == e.WF_COMPLETED
    )
    if user.role == e.ROLE_INSTITUTION:
        done_stmt = done_stmt.where(ReleaseApplication.institution_id == user.institution_id)
    done = db.execute(done_stmt).scalars().all()
    buckets_map = {"0-7": 0, "8-15": 0, "16-30": 0, "31-60": 0, "61+": 0}
    for app in done:
        start = app.submitted_at or app.created_at
        days = max(0, (app.last_action_at - start).days)
        if days <= 7:
            buckets_map["0-7"] += 1
        elif days <= 15:
            buckets_map["8-15"] += 1
        elif days <= 30:
            buckets_map["16-30"] += 1
        elif days <= 60:
            buckets_map["31-60"] += 1
        else:
            buckets_map["61+"] += 1
    processing = _series(
        "application_processing_days",
        "Completed release processing time (days)",
        list(buckets_map.items()),
    )

    return {
        "lifecycle_status": lifecycle,
        "upcoming_maturity_by_month": upcoming,
        "by_region": by_region,
        "discrepancy_categories": discrepancies,
        "pending_by_stage": pending_stage,
        "application_processing_days": processing,
    }
