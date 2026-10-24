"""Report endpoints: preview (paginated) + CSV / PDF export."""

from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import enums as e
from ..database import get_db
from ..models import User
from ..security import get_current_user
from ..services.audit import record_audit
from ..services.reports import REPORTS, REPORT_ROLES, REPORT_TITLES, build_report, report_to_csv, report_to_pdf
from .deps import forbidden, pagination

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("")
def list_reports(user: User = Depends(get_current_user)):
    available = []
    for key, title in REPORT_TITLES.items():
        allowed_roles = REPORT_ROLES.get(key)
        if allowed_roles and user.role not in allowed_roles:
            continue
        available.append(
            {
                "report_key": key,
                "report_title": title,
                "export_csv": True,
                "export_pdf": True,
            }
        )
    return {"reports": available}


def _filters(
    date_from: Optional[date],
    date_to: Optional[date],
    institution_id: Optional[int],
    region: Optional[str],
    status: Optional[str],
    bank: Optional[str],
    category: Optional[str],
) -> dict:
    return {
        "date_from": date_from,
        "date_to": date_to,
        "institution_id": institution_id,
        "region": region,
        "status": status,
        "bank_name": bank,
        "category": category,
    }


def _build(db: Session, key: str, user: User, filters: dict) -> dict:
    try:
        return build_report(db, key, user, filters)
    except KeyError:
        raise HTTPException(
            status_code=404, detail={"code": "not_found", "message": f"Unknown report '{key}'."}
        )
    except PermissionError:
        raise forbidden("You are not authorised to run this report.")


@router.get("/{report_key}")
def preview_report(
    report_key: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    institution_id: Optional[int] = Query(None),
    region: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    bank: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
):
    page, page_size = page_info
    report = _build(db, report_key, user, _filters(date_from, date_to, institution_id, region, status, bank, category))
    start = (page - 1) * page_size
    return {
        **report,
        "rows": report["rows"][start : start + page_size],
        "page": page,
        "page_size": page_size,
        "pages": max(1, -(-report["row_count"] // page_size)),
    }


@router.get("/{report_key}/csv")
def export_csv(
    report_key: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    institution_id: Optional[int] = Query(None),
    region: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    bank: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
):
    report = _build(db, report_key, user, _filters(date_from, date_to, institution_id, region, status, bank, category))
    csv_text = report_to_csv(report)
    # Exports of report data are audit-logged (sensitive exports).
    record_audit(
        db,
        actor_user_id=user.id,
        action="report.exported",
        entity_type="report",
        entity_id=report_key,
        metadata={"format": "csv", "rows": report["row_count"]},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    filename = f"fdr_sentinel_{report_key}_{report['generated_at'].strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{report_key}/pdf")
def export_pdf(
    report_key: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    institution_id: Optional[int] = Query(None),
    region: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    bank: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
):
    report = _build(db, report_key, user, _filters(date_from, date_to, institution_id, region, status, bank, category))
    pdf_bytes = report_to_pdf(report)
    record_audit(
        db,
        actor_user_id=user.id,
        action="report.exported",
        entity_type="report",
        entity_id=report_key,
        metadata={"format": "pdf", "rows": report["row_count"]},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    filename = f"fdr_sentinel_{report_key}_{report['generated_at'].strftime('%Y%m%d_%H%M%S')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
