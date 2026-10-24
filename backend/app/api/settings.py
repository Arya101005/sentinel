"""System settings endpoints (config thresholds, not hardcoded in the frontend)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from .. import enums as e
from ..database import get_db
from ..models import User
from ..security import require_admin
from ..services.audit import record_audit
from ..services.settings_service import get_all_settings, set_setting
from .deps import bad_request

router = APIRouter(prefix="/settings", tags=["settings"])

_VALIDATORS = {
    e.SETTING_MATURITY_THRESHOLDS: lambda v: (
        isinstance(v, list) and all(isinstance(x, int) and 1 <= x <= 3650 for x in v) and len(v) <= 6
    ),
    e.SETTING_ESCALATION_AFTER_MATURITY: lambda v: isinstance(v, int) and 0 <= v <= 3650,
    e.SETTING_CLEARANCE_ESCALATION_DAYS: lambda v: isinstance(v, int) and 0 <= v <= 3650,
    e.SETTING_REMINDER_FREQUENCY_DAYS: lambda v: isinstance(v, int) and 0 <= v <= 3650,
    e.SETTING_ALLOWED_FILE_TYPES: lambda v: isinstance(v, list) and all(isinstance(x, str) for x in v),
    e.SETTING_MAX_UPLOAD_MB: lambda v: isinstance(v, int) and 1 <= v <= 100,
    e.SETTING_OVERDUE_STAGE_DAYS: lambda v: isinstance(v, int) and 1 <= v <= 3650,
    e.SETTING_TIMEZONE: lambda v: isinstance(v, str) and len(v) <= 64,
}


@router.get("")
def list_settings(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return {"settings": get_all_settings(db)}


@router.put("/{key}")
def update_setting(
    key: str,
    request: Request,
    payload: dict,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if key not in _VALIDATORS:
        raise bad_request(f"Unknown setting '{key}'.", "unknown_setting")
    value: Any = payload.get("value")
    if not _VALIDATORS[key](value):
        raise bad_request(f"Invalid value for setting '{key}'.", "invalid_setting_value")
    set_setting(db, key, value, updated_by=admin.id)
    record_audit(
        db,
        actor_user_id=admin.id,
        action="settings.updated",
        entity_type="setting",
        entity_id=key,
        metadata={"value": value},
        request_id=request.headers.get("X-Request-ID"),
    )
    db.commit()
    return {"key": key, "value": value, "message": "Setting updated."}
