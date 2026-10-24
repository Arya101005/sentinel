"""Authentication, password hashing and role-based access dependencies.

Local development provider (no external service required):
  * PBKDF2-HMAC-SHA256 password hashes (stdlib — no binary dependency),
  * short-lived JWT access tokens signed with ``JWT_SECRET``.

``authentication_provider_id`` remains the identity anchor so an external
provider (e.g. Supabase Auth) can be plugged in later without schema changes.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import enums as e
from .config import settings
from .database import get_db
from .models import User

bearer_scheme = HTTPBearer(auto_error=False)

PBKDF2_ITERATIONS = 390_000


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: Optional[str]) -> bool:
    if not stored:
        return False
    try:
        scheme, iterations, salt_hex, digest_hex = stored.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(candidate.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------
def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "institution_id": user.institution_id,
        "name": user.display_name,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
        "iss": "fdr-sentinel",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    return jwt.decode(
        token, settings.jwt_secret, algorithms=[settings.jwt_algorithm], issuer="fdr-sentinel"
    )


# ---------------------------------------------------------------------------
# Current user / role dependencies
# ---------------------------------------------------------------------------
def _unauthorized(detail: str, code: str = "not_authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": code, "message": detail},
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise _unauthorized("Authentication required.")
    try:
        payload = decode_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Your session has expired. Please sign in again.", "token_expired")
    except jwt.InvalidTokenError:
        raise _unauthorized("Invalid authentication token.", "invalid_token")

    user = db.get(User, int(payload.get("sub", 0)))
    if user is None or not user.is_active:
        raise _unauthorized("Account not found or deactivated.", "inactive_user")
    return user


def require_roles(*roles: str):
    """Dependency factory: reject users whose role is not in ``roles``."""

    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "insufficient_role",
                    "message": "You do not have permission to perform this action.",
                },
            )
        return user

    return _dep


# Convenience role guards used across routers.
require_admin = require_roles(e.ROLE_ADMIN)
require_officer = require_roles(e.ROLE_OFFICER, e.ROLE_ADMIN)
require_authority_or_officer = require_roles(e.ROLE_OFFICER, e.ROLE_ADMIN)
require_staff = require_roles(e.ROLE_ADMIN, e.ROLE_OFFICER, e.ROLE_AUDITOR)
require_any = require_roles(*e.ROLES)
require_editor = require_roles(e.ROLE_ADMIN, e.ROLE_OFFICER, e.ROLE_INSTITUTION)


def user_may_view_institution(user: User, institution_id: Optional[int]) -> bool:
    """Institution users see only their own institution; everyone else sees all."""
    if user.role == e.ROLE_INSTITUTION:
        return institution_id is not None and user.institution_id == institution_id
    return True


def user_may_edit_fdr(user: User, institution_id: int) -> bool:
    if user.role in (e.ROLE_ADMIN, e.ROLE_OFFICER):
        return True
    if user.role == e.ROLE_INSTITUTION:
        return user.institution_id == institution_id
    return False  # auditors are read-only


def user_may_edit(user: User) -> bool:
    return user.role in (e.ROLE_ADMIN, e.ROLE_OFFICER, e.ROLE_INSTITUTION)


def user_is_read_only(user: User) -> bool:
    return user.role == e.ROLE_AUDITOR


def ensure_officer_assigned_or_admin(user: User, application_officer_id: Optional[int]) -> bool:
    """Officers may act on any case; nothing is silently restricted to the assignee only,
    but assignment is exposed for workload filtering."""
    return user.role in (e.ROLE_ADMIN, e.ROLE_OFFICER, e.ROLE_AUDITOR) or (
        application_officer_id == user.id
    )


def client_request_id(request: Request) -> Optional[str]:
    return request.headers.get("X-Request-ID")


def roles_allowed(user: User, roles: Iterable[str]) -> bool:
    return user.role in set(roles)
