"""Health checks."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import text

from ..config import settings
from ..database import engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {
        "status": "ok",
        "service": settings.app_name,
        "time": datetime.now(timezone.utc).isoformat(),
        "environment": settings.app_env,
        "ocr_available": False,
        "email_configured": bool(settings.smtp_enabled and settings.smtp_host),
    }


@router.get("/health/db")
def database_health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "database": "reachable"}
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "database": "unreachable", "reason": type(exc).__name__}
