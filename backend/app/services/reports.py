"""Report generation and export (Module E).

All rows come from live database queries. CSV export neutralises spreadsheet
formula injection. Sensitive exports are audit-logged by the caller.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime
from typing import Any, Callable, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..models import (
    ApplicationEvent,
    AuditEvent,
    ClearanceRecord,
    DiscrepancyFlag,
    FdrRecord,
    Institution,
    ReleaseApplication,
    User,
)
from .maturity import (
    apply_fdr_filters,
    base_fdr_query,
    classify_with_thresholds,
    enrich_rows,
)
from .settings_service import int_setting, maturity_thresholds

ReportBuilder = Callable[..., tuple[list[dict[str, str]], list[dict[str, Any]], Optional[str]]]

REPORT_TITLES: dict[str, str] = {
    "institution_register": "Institution-wise FDR register",
    "upcoming_maturity": "Upcoming maturity",
    "matured_no_application": "Matured FDRs without recorded applications",
    "discrepancies": "Potential discrepancies",
    "pending_verification": "Pending verification",
    "applications_by_status": "Release applications by status",
    "pending_clearance": "Pending clearances",
    "overdue_cases": "Overdue cases",
    "completed_releases": "Completed release cases",
    "audit_history": "Audit history",
}


def _scope_institution(user: User, institution_id: Optional[int]) -> Optional[int]:
    if user.role == e.ROLE_INSTITUTION:
        return user.institution_id
    return institution_id


def _fdr_row(rec: FdrRecord, extra: Optional[dict] = None) -> dict[str, Any]:
    row = {
        "fdr_reference_number": rec.fdr_reference_number,
        "institution": rec.institution.institution_name if rec.institution else "",
        "region": rec.institution.region if rec.institution else "",
        "bank_name": rec.bank_name,
        "branch_name": rec.branch_name or "",
        "deposit_amount": f"{rec.deposit_amount:.2f}",
        "currency": rec.currency,
        "issue_date": rec.issue_date.isoformat() if rec.issue_date else "",
        "maturity_date": rec.maturity_date.isoformat() if rec.maturity_date else "",
        "lifecycle_status": rec.lifecycle_status,
        "verification_status": rec.verification_status,
        "release_application_status": rec.release_application_status,
    }
    if extra:
        row.update(extra)
    return row


_FDR_COLUMNS = [
    {"key": "fdr_reference_number", "label": "FDR reference"},
    {"key": "institution", "label": "Institution"},
    {"key": "region", "label": "Region"},
    {"key": "bank_name", "label": "Bank"},
    {"key": "branch_name", "label": "Branch"},
    {"key": "deposit_amount", "label": "Deposit amount"},
    {"key": "currency", "label": "Currency"},
    {"key": "issue_date", "label": "Issue date"},
    {"key": "maturity_date", "label": "Maturity date"},
    {"key": "lifecycle_status", "label": "Lifecycle"},
    {"key": "verification_status", "label": "Verification"},
    {"key": "release_application_status", "label": "Release status"},
]


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------
def _build_institution_register(db: Session, user: User, f: dict):
    columns = [
        {"key": "institution_code", "label": "Code"},
        {"key": "institution_name", "label": "Institution"},
        {"key": "institution_type", "label": "Type"},
        {"key": "region", "label": "Region"},
        {"key": "active_fdrs", "label": "Active FDRs"},
        {"key": "matured_without_application", "label": "Matured w/o application"},
        {"key": "open_discrepancies", "label": "Open discrepancies"},
        {"key": "open_applications", "label": "Open applications"},
    ]
    today = date.today()
    thresholds = maturity_thresholds(db)
    stmt = select(Institution)
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(Institution.id == user.institution_id)
    if f.get("region"):
        stmt = stmt.where(Institution.region == f["region"])
    institutions = db.execute(stmt.order_by(Institution.institution_name)).scalars().all()

    rows = []
    for inst in institutions:
        fdrs = db.execute(
            select(FdrRecord).where(FdrRecord.institution_id == inst.id)
        ).scalars().all()
        enriched = enrich_rows(db, fdrs, today, thresholds)
        rows.append(
            {
                "institution_code": inst.institution_code,
                "institution_name": inst.institution_name,
                "institution_type": inst.institution_type,
                "region": inst.region,
                "active_fdrs": sum(
                    1 for r in fdrs if r.lifecycle_status in e.ACTIVE_LIFECYCLE_STATUSES
                ),
                "matured_without_application": sum(
                    1
                    for r in enriched
                    if r["classification"].category == e.CAT_MATURED_NO_APP
                ),
                "open_discrepancies": sum(r["open_discrepancies"] for r in enriched),
                "open_applications": db.execute(
                    select(func.count(ReleaseApplication.id)).where(
                        ReleaseApplication.institution_id == inst.id,
                        ReleaseApplication.application_status.in_(list(e.ACTIVE_APPLICATION_STATES)),
                    )
                ).scalar_one(),
            }
        )
    return columns, rows, None


def _fdr_category_report(categories: tuple[str, ...], include_app: bool = False) -> ReportBuilder:
    def _builder(db: Session, user: User, f: dict):
        stmt = apply_fdr_filters(
            base_fdr_query(user),
            institution_id=_scope_institution(user, f.get("institution_id")),
            region=f.get("region"),
            bank_name=f.get("bank_name"),
            maturity_from=f.get("date_from"),
            maturity_to=f.get("date_to"),
            lifecycle_status=f.get("status") if f.get("status") in e.LIFECYCLE_STATUSES else None,
        )
        records = db.execute(stmt).scalars().unique().all()
        today = date.today()
        thresholds = maturity_thresholds(db)
        rows = []
        for item in enrich_rows(db, records, today, thresholds):
            if item["classification"].category not in categories:
                continue
            rec = item["record"]
            cls = item["classification"]
            extra: dict[str, Any] = {
                "monitoring_category": e.MONITORING_LABELS.get(cls.category, cls.category),
                "days_to_maturity": cls.days_to_maturity if cls.days_to_maturity is not None else "",
                "open_discrepancies": item["open_discrepancies"],
            }
            if include_app and cls.application is not None:
                extra["application_reference"] = cls.application.application_reference
                extra["application_status"] = cls.application.application_status
            rows.append(_fdr_row(rec, extra))
        columns = list(_FDR_COLUMNS) + [
            {"key": "monitoring_category", "label": "Monitoring category"},
            {"key": "days_to_maturity", "label": "Days to maturity"},
            {"key": "open_discrepancies", "label": "Open discrepancies"},
        ]
        if include_app:
            columns += [
                {"key": "application_reference", "label": "Application"},
                {"key": "application_status", "label": "Application status"},
            ]
        warning = None
        if categories == (e.CAT_MATURED_NO_APP,):
            warning = (
                "Absence of a release application in this system does not prove the institution "
                "has not applied through other channels (e.g. the AICTE JFDR portal). Treat as a "
                "review trigger only."
            )
        return columns, rows, warning

    return _builder


def _build_discrepancies(db: Session, user: User, f: dict):
    columns = [
        {"key": "fdr_reference_number", "label": "FDR reference"},
        {"key": "institution", "label": "Institution"},
        {"key": "discrepancy_type", "label": "Type"},
        {"key": "field_name", "label": "Field"},
        {"key": "submitted_value", "label": "Submitted value"},
        {"key": "extracted_value", "label": "Extracted value"},
        {"key": "severity", "label": "Severity"},
        {"key": "status", "label": "Status"},
        {"key": "created_at", "label": "Raised at"},
    ]
    stmt = select(DiscrepancyFlag).join(
        FdrRecord, DiscrepancyFlag.fdr_id == FdrRecord.id, isouter=True
    ).join(Institution, FdrRecord.institution_id == Institution.id, isouter=True)
    if f.get("institution_id") and user.role != e.ROLE_INSTITUTION:
        stmt = stmt.where(FdrRecord.institution_id == f["institution_id"])
    if f.get("status"):
        stmt = stmt.where(DiscrepancyFlag.status == f["status"])
    flags = db.execute(stmt.order_by(DiscrepancyFlag.created_at.desc())).scalars().all()
    rows = []
    for flag in flags:
        rec = flag.fdr
        if user.role == e.ROLE_INSTITUTION and (rec is None or rec.institution_id != user.institution_id):
            continue
        rows.append(
            {
                "fdr_reference_number": rec.fdr_reference_number if rec else "",
                "institution": rec.institution.institution_name if rec and rec.institution else "",
                "discrepancy_type": flag.discrepancy_type,
                "field_name": flag.field_name or "",
                "submitted_value": flag.submitted_value or "",
                "extracted_value": flag.extracted_value or "",
                "severity": flag.severity,
                "status": flag.status,
                "created_at": flag.created_at.isoformat(sep=" ", timespec="seconds"),
            }
        )
    return columns, rows, None


def _build_applications(db: Session, user: User, f: dict, status_filter: Optional[tuple] = None):
    columns = [
        {"key": "application_reference", "label": "Application"},
        {"key": "institution", "label": "Institution"},
        {"key": "fdr_reference_number", "label": "FDR reference"},
        {"key": "bank_name", "label": "Bank"},
        {"key": "deposit_amount", "label": "Deposit amount"},
        {"key": "application_status", "label": "Status"},
        {"key": "completeness_status", "label": "Completeness"},
        {"key": "assigned_officer", "label": "Assigned officer"},
        {"key": "submitted_at", "label": "Submitted"},
        {"key": "days_in_stage", "label": "Days in stage"},
    ]
    stmt = select(ReleaseApplication).join(
        Institution, ReleaseApplication.institution_id == Institution.id
    )
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(ReleaseApplication.institution_id == user.institution_id)
    elif f.get("institution_id"):
        stmt = stmt.where(ReleaseApplication.institution_id == f["institution_id"])
    if status_filter:
        stmt = stmt.where(ReleaseApplication.application_status.in_(list(status_filter)))
    elif f.get("status"):
        stmt = stmt.where(ReleaseApplication.application_status == f["status"])
    apps = db.execute(stmt.order_by(ReleaseApplication.updated_at.desc())).scalars().all()
    overdue_days = int_setting(db, e.SETTING_OVERDUE_STAGE_DAYS, 15)
    rows = []
    for app in apps:
        days = (datetime.utcnow() - app.current_stage_started_at).days
        fdr = app.fdr
        rows.append(
            {
                "application_reference": app.application_reference,
                "institution": app.institution.institution_name if app.institution else "",
                "fdr_reference_number": fdr.fdr_reference_number if fdr else "",
                "bank_name": fdr.bank_name if fdr else "",
                "deposit_amount": f"{fdr.deposit_amount:.2f}" if fdr else "",
                "application_status": app.application_status,
                "completeness_status": app.completeness_status,
                "assigned_officer": (
                    app.assigned_officer.display_name if app.assigned_officer else "Unassigned"
                ),
                "submitted_at": (
                    app.submitted_at.isoformat(sep=" ", timespec="seconds") if app.submitted_at else ""
                ),
                "days_in_stage": days,
                "_overdue": days > overdue_days,
            }
        )
    for r in rows:
        r.pop("_overdue", None)
    return columns, rows, None


def _build_overdue(db: Session, user: User, f: dict):
    columns, rows, _ = _build_applications(db, user, f)
    overdue_days = int_setting(db, e.SETTING_OVERDUE_STAGE_DAYS, 15)
    rows = [r for r in rows if r.get("days_in_stage", 0) > overdue_days
            and r["application_status"] not in e.TERMINAL_APPLICATION_STATES]
    return columns, rows, f"Cases in the same workflow stage for more than {overdue_days} days."


def _build_pending_clearance(db: Session, user: User, f: dict):
    columns = [
        {"key": "application_reference", "label": "Application"},
        {"key": "institution", "label": "Institution"},
        {"key": "clearance_type", "label": "Clearance"},
        {"key": "assigned_unit", "label": "Assigned unit"},
        {"key": "status", "label": "Status"},
        {"key": "requested_at", "label": "Requested"},
        {"key": "days_pending", "label": "Days pending"},
    ]
    stmt = (
        select(ClearanceRecord, ReleaseApplication)
        .join(ReleaseApplication, ClearanceRecord.application_id == ReleaseApplication.id)
        .where(ClearanceRecord.status.in_([e.CLEARANCE_PENDING, e.CLEARANCE_IN_PROGRESS]))
    )
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(ReleaseApplication.institution_id == user.institution_id)
    elif f.get("institution_id"):
        stmt = stmt.where(ReleaseApplication.institution_id == f["institution_id"])
    now = datetime.utcnow()
    rows = []
    for clearance, app in db.execute(stmt.order_by(ClearanceRecord.requested_at)).all():
        start = clearance.requested_at or clearance.created_at
        rows.append(
            {
                "application_reference": app.application_reference,
                "institution": app.institution.institution_name if app.institution else "",
                "clearance_type": e.CLEARANCE_LABELS.get(
                    clearance.clearance_type, clearance.clearance_type
                ),
                "assigned_unit": clearance.assigned_unit or "",
                "status": clearance.status,
                "requested_at": start.isoformat(sep=" ", timespec="seconds"),
                "days_pending": (now - start).days,
            }
        )
    return columns, rows, "Clearance types are illustrative; not every case requires every clearance."


def _build_audit(db: Session, user: User, f: dict):
    columns = [
        {"key": "timestamp", "label": "Timestamp (UTC)"},
        {"key": "actor", "label": "Actor"},
        {"key": "action", "label": "Action"},
        {"key": "entity_type", "label": "Entity type"},
        {"key": "entity_id", "label": "Entity ID"},
        {"key": "reason", "label": "Reason"},
    ]
    stmt = select(AuditEvent).join(User, AuditEvent.actor_user_id == User.id, isouter=True)
    if f.get("date_from"):
        stmt = stmt.where(AuditEvent.timestamp >= datetime.combine(f["date_from"], datetime.min.time()))
    if f.get("date_to"):
        stmt = stmt.where(AuditEvent.timestamp <= datetime.combine(f["date_to"], datetime.max.time()))
    if f.get("status"):
        stmt = stmt.where(AuditEvent.action == f["status"])
    events = db.execute(stmt.order_by(AuditEvent.timestamp.desc()).limit(5000)).scalars().all()
    rows = [
        {
            "timestamp": ev.timestamp.isoformat(sep=" ", timespec="seconds"),
            "actor": ev.actor_user.display_name if ev.actor_user else "system",
            "action": ev.action,
            "entity_type": ev.entity_type or "",
            "entity_id": ev.entity_id or "",
            "reason": ev.reason or "",
        }
        for ev in events
    ]
    return columns, rows, None


REPORTS: dict[str, ReportBuilder] = {
    "institution_register": _build_institution_register,
    "upcoming_maturity": _fdr_category_report((e.CAT_UPCOMING,)),
    "matured_no_application": _fdr_category_report((e.CAT_MATURED_NO_APP,)),
    "discrepancies": _build_discrepancies,
    "pending_verification": None,  # filled below
    "applications_by_status": lambda db, user, f: _build_applications(db, user, f),
    "pending_clearance": _build_pending_clearance,
    "overdue_cases": _build_overdue,
    "completed_releases": lambda db, user, f: _build_applications(
        db, user, f, status_filter=(e.WF_COMPLETED,)
    ),
    "audit_history": _build_audit,
}


def _build_pending_verification(db: Session, user: User, f: dict):
    stmt = apply_fdr_filters(
        base_fdr_query(user),
        institution_id=_scope_institution(user, f.get("institution_id")),
        region=f.get("region"),
        bank_name=f.get("bank_name"),
    ).where(
        FdrRecord.verification_status.in_(
            [e.FDR_VERIFICATION_PENDING, e.FDR_VERIFICATION_MANUAL, e.FDR_VERIFICATION_DISCREPANCY]
        )
    )
    records = db.execute(stmt).scalars().unique().all()
    today = date.today()
    rows = []
    for item in enrich_rows(db, records, today, maturity_thresholds(db)):
        rec = item["record"]
        rows.append(
            _fdr_row(
                rec,
                {
                    "open_discrepancies": item["open_discrepancies"],
                },
            )
        )
    columns = list(_FDR_COLUMNS) + [{"key": "open_discrepancies", "label": "Open discrepancies"}]
    return columns, rows, None


REPORTS["pending_verification"] = _build_pending_verification

REPORT_ROLES = {
    "audit_history": (e.ROLE_ADMIN, e.ROLE_OFFICER, e.ROLE_AUDITOR),
}


def build_report(db: Session, key: str, user: User, filters: dict) -> dict:
    if key not in REPORTS:
        raise KeyError(key)
    allowed_roles = REPORT_ROLES.get(key)
    if allowed_roles and user.role not in allowed_roles:
        raise PermissionError(key)
    columns, rows, warning = REPORTS[key](db, user, filters)
    return {
        "report_key": key,
        "report_title": REPORT_TITLES.get(key, key),
        "generated_at": datetime.utcnow(),
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "filters": filters,
        "data_coverage_warning": warning,
    }


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _safe_cell(value: Any) -> str:
    """Neutralise CSV/spreadsheet formula injection."""
    text = "" if value is None else str(value)
    if text and text.lstrip().startswith(_FORMULA_PREFIXES):
        return "'" + text
    return text


def report_to_csv(report: dict) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow([report["report_title"]])
    writer.writerow([f"Generated (UTC): {report['generated_at'].isoformat(sep=' ', timespec='seconds')}"])
    if report.get("filters"):
        active = {k: v for k, v in report["filters"].items() if v not in (None, "")}
        if active:
            writer.writerow([f"Filters: {active}"])
    if report.get("data_coverage_warning"):
        writer.writerow([f"Note: {report['data_coverage_warning']}"])
    writer.writerow([])
    writer.writerow([col["label"] for col in report["columns"]])
    for row in report["rows"]:
        writer.writerow([_safe_cell(row.get(col["key"], "")) for col in report["columns"]])
    # UTF-8 BOM so Excel opens it correctly.
    return "\ufeff" + buffer.getvalue()


def report_to_pdf(report: dict) -> bytes:
    """Minimal table PDF generated with PyMuPDF (already a dependency)."""
    import fitz

    doc = fitz.open()
    page_width, page_height = fitz.paper_size("a4")
    margin = 36
    font_size = 8
    line_height = font_size + 4
    page = doc.new_page(width=page_width, height=page_height)
    y = margin

    def new_page():
        nonlocal page, y
        page = doc.new_page(width=page_width, height=page_height)
        y = margin

    def write(text: str, size: int = 9, bold: bool = False):
        nonlocal y
        if y > page_height - margin:
            new_page()
        page.insert_text(
            (margin, y),
            text[:110],
            fontsize=size,
            fontname="hebo" if bold else "helv",
            color=(0, 0, 0),
        )
        y += size + 5

    write(report["report_title"], size=13, bold=True)
    write(f"Generated (UTC): {report['generated_at'].isoformat(sep=' ', timespec='seconds')}", size=8)
    if report.get("data_coverage_warning"):
        write(f"Note: {report['data_coverage_warning']}", size=8)
    y += 6
    write(" | ".join(col["label"] for col in report["columns"]), size=8, bold=True)
    y += 2
    for row in report["rows"]:
        cells = [str(row.get(col["key"], "")) for col in report["columns"]]
        write(" | ".join(cells), size=font_size)
    doc.set_metadata({"title": report["report_title"], "producer": "FDR Sentinel"})
    data = doc.tobytes()
    doc.close()
    return data
