"""Shared FastAPI dependencies, pagination and serialization helpers."""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import enums as e
from ..models import DiscrepancyFlag, FdrRecord, User
from ..services.maturity import classify_with_thresholds
from ..services.settings_service import maturity_thresholds


def pagination(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(25, ge=1, le=200, description="Items per page"),
) -> tuple[int, int]:
    return page, page_size


def not_found(entity: str = "Record") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "not_found", "message": f"{entity} not found."},
    )


def forbidden(message: str = "You do not have permission to perform this action.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"code": "forbidden", "message": message},
    )


def bad_request(message: str, code: str = "invalid_request") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"code": code, "message": message},
    )


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------
def user_out(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "display_name": user.display_name,
        "email": user.email,
        "username": user.username,
        "role": user.role,
        "institution_id": user.institution_id,
        "institution_name": user.institution.institution_name if user.institution else None,
        "is_active": user.is_active,
        "is_competent_authority": user.is_competent_authority,
        "created_at": user.created_at,
    }


def fdr_out(db: Session, rec: FdrRecord, today: Optional[date] = None) -> dict[str, Any]:
    """FDR payload including computed monitoring fields (real, DB-derived)."""
    today = today or date.today()
    thresholds = maturity_thresholds(db)
    apps = list(rec.applications) if "applications" in getattr(rec, "__dict__", {}) else None
    if apps is None:
        from sqlalchemy import select

        from ..models import ReleaseApplication

        apps = list(
            db.execute(
                select(ReleaseApplication).where(ReleaseApplication.fdr_id == rec.id)
            ).scalars().all()
        )
    cls = classify_with_thresholds(rec, apps, today, thresholds)
    open_disc = sum(1 for d in rec.discrepancies if d.status in e.OPEN_DISCREPANCY_STATUSES)
    return {
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
        "monitoring_reason": cls.reason,
        "days_to_maturity": cls.days_to_maturity,
        "days_since_maturity": cls.days_since_maturity,
        "open_discrepancies": open_disc,
    }


def monitoring_row(db: Session, item: dict) -> dict[str, Any]:
    rec: FdrRecord = item["record"]
    cls = item["classification"]
    app = cls.application
    return {
        "fdr_id": rec.id,
        "fdr_reference_number": rec.fdr_reference_number,
        "bank_name": rec.bank_name,
        "institution_id": rec.institution_id,
        "institution_name": rec.institution.institution_name if rec.institution else "",
        "region": rec.institution.region if rec.institution else "",
        "deposit_amount": f"{rec.deposit_amount:.2f}",
        "currency": rec.currency,
        "maturity_date": rec.maturity_date,
        "days_to_maturity": cls.days_to_maturity,
        "days_since_maturity": cls.days_since_maturity,
        "lifecycle_status": rec.lifecycle_status,
        "verification_status": rec.verification_status,
        "release_application_status": rec.release_application_status,
        "monitoring_category": cls.category,
        "monitoring_label": e.MONITORING_LABELS.get(cls.category, cls.category),
        "monitoring_reason": cls.reason,
        "application_reference": app.application_reference if app else None,
        "application_status": app.application_status if app else None,
        "open_discrepancies": item["open_discrepancies"],
        "is_demo": rec.is_demo,
    }
