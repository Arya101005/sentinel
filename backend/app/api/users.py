"""User administration (System Administrator) + officer directory for assignment."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..database import get_db
from ..models import Institution, User
from ..schemas.common import Page, paginate
from ..schemas.core import UserCreate, UserOut, UserUpdate
from ..security import hash_password, require_admin, require_officer
from ..services.audit import record_audit
from .deps import bad_request, not_found, pagination, user_out

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=Page[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_officer),
    page_info: tuple[int, int] = Depends(pagination),
    role: str | None = Query(None),
    institution_id: int | None = Query(None),
    is_active: bool | None = Query(None),
    q: str | None = Query(None),
):
    page, page_size = page_info
    stmt = select(User)
    if role:
        stmt = stmt.where(User.role == role)
    if institution_id is not None:
        stmt = stmt.where(User.institution_id == institution_id)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            (User.display_name.ilike(like)) | (User.email.ilike(like)) | (User.username.ilike(like))
        )
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    users = (
        db.execute(stmt.order_by(User.display_name).offset((page - 1) * page_size).limit(page_size))
        .scalars()
        .all()
    )
    return paginate([user_out(u) for u in users], total, page, page_size)


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    exists = db.execute(
        select(User).where((User.username == payload.username) | (User.email == payload.email))
    ).scalar_one_or_none()
    if exists:
        raise bad_request("A user with that username or email already exists.", "duplicate_user")
    if payload.role == e.ROLE_INSTITUTION and payload.institution_id is None:
        raise bad_request("Institution users must be linked to an institution.", "institution_required")
    if payload.institution_id is not None and db.get(Institution, payload.institution_id) is None:
        raise not_found("Institution")

    user = User(
        display_name=payload.display_name,
        email=payload.email,
        username=payload.username,
        role=payload.role,
        institution_id=payload.institution_id,
        password_hash=hash_password(payload.password),
        is_competent_authority=payload.is_competent_authority,
        auth_provider="local",
    )
    db.add(user)
    db.flush()
    record_audit(
        db,
        actor_user_id=admin.id,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        metadata={"role": user.role, "institution_id": user.institution_id},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(user)
    return user_out(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = db.get(User, user_id)
    if target is None:
        raise not_found("User")
    data = payload.model_dump(exclude_unset=True)
    new_password = data.pop("password", None)

    if "email" in data or "username" in data:
        clash = db.execute(
            select(User).where(
                User.id != user_id,
                (User.email == data.get("email", target.email))
                | (User.username == data.get("username", target.username)),
            )
        ).scalar_one_or_none()
        if clash:
            raise bad_request("Another user already uses that username or email.", "duplicate_user")

    # A non-admin cannot silently grant themselves authority; admins may assign
    # the competent-authority designation but still cannot approve on its behalf
    # without acting as that designated user.
    for field, value in data.items():
        setattr(target, field, value)
    if new_password:
        target.password_hash = hash_password(new_password)

    record_audit(
        db,
        actor_user_id=admin.id,
        action="user.updated",
        entity_type="user",
        entity_id=target.id,
        metadata={"fields": sorted(payload.model_dump(exclude_unset=True).keys())},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    db.refresh(target)
    return user_out(target)
