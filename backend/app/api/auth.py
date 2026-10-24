"""Authentication endpoints (local provider — no external service required)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..config import settings
from ..database import get_db
from ..models import User
from ..schemas.core import LoginRequest, LoginResponse, UserOut
from ..security import create_access_token, get_current_user, hash_password, verify_password
from ..services.audit import record_audit
from .deps import bad_request, user_out

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.execute(
        select(User).where(
            or_(User.username == payload.username, User.email == payload.username)
        )
    ).scalar_one_or_none()

    if user is None or not verify_password(payload.password, user.password_hash):
        # Audit the attempt without recording any credential material.
        record_audit(
            db,
            actor_user_id=user.id if user else None,
            action="auth.login_failed",
            entity_type="user",
            entity_id=user.id if user else None,
            reason="invalid credentials",
            request_id=request.headers.get("X-Request-ID"),
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials", "message": "Incorrect username or password."},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "inactive_user", "message": "This account has been deactivated."},
        )

    user.last_login_at = datetime.utcnow()
    record_audit(
        db,
        actor_user_id=user.id,
        action="auth.login",
        entity_type="user",
        entity_id=user.id,
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()

    token = create_access_token(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": user_out(user),
    }


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user_out(user)


@router.post("/change-password")
def change_password(
    payload: dict,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current = str(payload.get("current_password") or "")
    new_password = str(payload.get("new_password") or "")
    if len(new_password) < 8:
        raise bad_request("The new password must be at least 8 characters long.", "weak_password")
    if not verify_password(current, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials", "message": "Current password is incorrect."},
        )
    user.password_hash = hash_password(new_password)
    record_audit(
        db,
        actor_user_id=user.id,
        action="auth.password_changed",
        entity_type="user",
        entity_id=user.id,
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    return {"message": "Password updated."}
