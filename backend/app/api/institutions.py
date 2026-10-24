"""Institution endpoints (list, detail, admin create/update)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..database import get_db
from ..models import DiscrepancyFlag, FdrRecord, Institution, ReleaseApplication, User
from ..schemas.common import Page, paginate
from ..schemas.core import InstitutionCreate, InstitutionDetail, InstitutionOut, InstitutionUpdate
from ..security import require_admin, require_any, require_officer
from ..services.audit import record_audit
from .deps import bad_request, not_found, pagination

router = APIRouter(prefix="/institutions", tags=["institutions"])


@router.get("", response_model=Page[InstitutionOut])
def list_institutions(
    db: Session = Depends(get_db),
    user: User = Depends(require_any),
    page_info: tuple[int, int] = Depends(pagination),
    q: str | None = Query(None),
    region: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
):
    page, page_size = page_info
    stmt = select(Institution)
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(Institution.id == user.institution_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            (Institution.institution_name.ilike(like)) | (Institution.institution_code.ilike(like))
        )
    if region:
        stmt = stmt.where(Institution.region == region)
    if status_filter:
        stmt = stmt.where(Institution.status == status_filter)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = (
        db.execute(
            stmt.order_by(Institution.institution_name).offset((page - 1) * page_size).limit(page_size)
        )
        .scalars()
        .all()
    )
    return paginate([InstitutionOut.model_validate(r).model_dump() for r in rows], total, page, page_size)


@router.get("/regions", response_model=list[str])
def list_regions(db: Session = Depends(get_db), user: User = Depends(require_any)):
    stmt = select(Institution.region).where(Institution.region != "").distinct()
    if user.role == e.ROLE_INSTITUTION:
        stmt = stmt.where(Institution.id == user.institution_id)
    return sorted(db.execute(stmt).scalars().all())


@router.get("/{institution_id}", response_model=InstitutionDetail)
def institution_detail(
    institution_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_any),
):
    if user.role == e.ROLE_INSTITUTION and user.institution_id != institution_id:
        raise not_found("Institution")
    inst = db.get(Institution, institution_id)
    if inst is None:
        raise not_found("Institution")

    fdr_ids = select(FdrRecord.id).where(FdrRecord.institution_id == institution_id)
    active_fdrs = db.execute(
        select(func.count(FdrRecord.id)).where(
            FdrRecord.institution_id == institution_id,
            FdrRecord.lifecycle_status.in_(list(e.ACTIVE_LIFECYCLE_STATUSES)),
        )
    ).scalar_one()
    open_disc = db.execute(
        select(func.count(DiscrepancyFlag.id))
        .join(FdrRecord, DiscrepancyFlag.fdr_id == FdrRecord.id)
        .where(
            FdrRecord.institution_id == institution_id,
            DiscrepancyFlag.status.in_(list(e.OPEN_DISCREPANCY_STATUSES)),
        )
    ).scalar_one()
    open_apps = db.execute(
        select(func.count(ReleaseApplication.id)).where(
            ReleaseApplication.institution_id == institution_id,
            ReleaseApplication.application_status.in_(list(e.ACTIVE_APPLICATION_STATES)),
        )
    ).scalar_one()
    matured_no_app = 0
    # Count matured FDRs without an open application using the shared rules.
    from ..services.maturity import enrich_rows
    from ..services.settings_service import maturity_thresholds
    from datetime import date

    fdrs = db.execute(
        select(FdrRecord).where(FdrRecord.institution_id == institution_id)
    ).scalars().all()
    from ..services.maturity import classify_with_thresholds

    today = date.today()
    thresholds = maturity_thresholds(db)
    apps_by_fdr: dict[int, list] = {}
    for app in db.execute(
        select(ReleaseApplication).where(ReleaseApplication.institution_id == institution_id)
    ).scalars().all():
        apps_by_fdr.setdefault(app.fdr_id, []).append(app)
    for rec in fdrs:
        cls = classify_with_thresholds(rec, apps_by_fdr.get(rec.id, []), today, thresholds)
        if cls.category == e.CAT_MATURED_NO_APP:
            matured_no_app += 1

    payload = InstitutionOut.model_validate(inst).model_dump()
    payload.update(
        {
            "active_fdr_count": active_fdrs,
            "matured_without_application": matured_no_app,
            "open_discrepancies": open_disc,
            "open_applications": open_apps,
        }
    )
    return payload


@router.post("", response_model=InstitutionOut, status_code=status.HTTP_201_CREATED)
def create_institution(
    payload: InstitutionCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    exists = db.execute(
        select(Institution).where(Institution.institution_code == payload.institution_code)
    ).scalar_one_or_none()
    if exists:
        raise bad_request("An institution with that code already exists.", "duplicate_code")
    inst = Institution(**payload.model_dump())
    db.add(inst)
    db.flush()
    record_audit(
        db,
        actor_user_id=admin.id,
        action="institution.created",
        entity_type="institution",
        entity_id=inst.id,
        metadata={"code": inst.institution_code},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(inst)
    return InstitutionOut.model_validate(inst)


@router.patch("/{institution_id}", response_model=InstitutionOut)
def update_institution(
    institution_id: int,
    payload: InstitutionUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    inst = db.get(Institution, institution_id)
    if inst is None:
        raise not_found("Institution")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(inst, field, value)
    record_audit(
        db,
        actor_user_id=admin.id,
        action="institution.updated",
        entity_type="institution",
        entity_id=inst.id,
        metadata={"fields": sorted(payload.model_dump(exclude_unset=True).keys())},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(inst)
    return InstitutionOut.model_validate(inst)
