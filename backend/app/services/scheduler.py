"""Scheduled background jobs: maturity checks, reminders, escalation.

Uses APScheduler when running inside the API process. All jobs are idempotent:
re-running them never creates duplicate notifications (dedup keys) and never
changes FDR/application state beyond the documented monitoring fields.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import enums as e
from ..database import session_scope
from ..models import FdrRecord, Institution, ReleaseApplication
from . import notifications as notify
from .maturity import classify_with_thresholds, enrich_rows
from .settings_service import maturity_thresholds

_scheduler = None


def run_monitoring_job(db: Optional[Session] = None) -> dict:
    """One monitoring pass across all institutions.

    Returns counts for logging / the manual 'run checks' endpoint.
    """
    if db is not None:
        return _run(db)

    with session_scope() as scope_db:
        return _run(scope_db)


def _run(db: Session) -> dict:
    today = date.today()
    thresholds = maturity_thresholds(db)

    records = db.execute(select(FdrRecord)).scalars().unique().all()
    rows = enrich_rows(db, records, today, thresholds)

    categories: dict[str, int] = {}
    created = suppressed = escalations = 0
    for row in rows:
        rec: FdrRecord = row["record"]
        cls = row["classification"]
        categories[cls.category] = categories.get(cls.category, 0) + 1
        if cls.category in (
            e.CAT_UPCOMING,
            e.CAT_MATURED_NO_APP,
            e.CAT_ON_HOLD,
        ) and rec.lifecycle_status not in e.LIFECYCLE_ARCHIVED:
            c, s, esc = notify.evaluate_fdr_notifications(
                db, rec, cls.category, cls.days_to_maturity, thresholds
            )
            created += c
            suppressed += s
            escalations += esc

    clr_created, clr_suppressed = notify.evaluate_clearance_escalations(db)
    created += clr_created
    suppressed += clr_suppressed

    return {
        "checked": len(rows),
        "notifications_created": created,
        "duplicates_suppressed": suppressed,
        "escalations_created": escalations + clr_created,
        "categories": categories,
        "run_at": datetime.utcnow().isoformat(sep=" ", timespec="seconds"),
    }


def start_scheduler() -> None:
    """Start the in-process APScheduler (no-op when disabled or already running)."""
    global _scheduler
    from ..config import settings

    if not settings.scheduler_enabled or _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:  # pragma: no cover
        return

    _scheduler = BackgroundScheduler(timezone=settings.app_timezone)
    _scheduler.add_job(
        run_monitoring_job,
        "interval",
        minutes=max(5, settings.maturity_check_interval_minutes),
        id="maturity_monitoring",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:  # noqa: BLE001
            pass
        _scheduler = None
