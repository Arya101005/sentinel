"""System settings service: database-backed configuration with defaults."""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import enums as e
from ..models import SystemSetting


def get_setting(db: Session, key: str) -> Any:
    """Return a configured value, falling back to the shipped default."""
    row = db.execute(select(SystemSetting).where(SystemSetting.key == key)).scalar_one_or_none()
    if row is None:
        return e.DEFAULT_SYSTEM_SETTINGS.get(key)
    return row.value_json


def get_all_settings(db: Session) -> list[dict]:
    rows = db.execute(select(SystemSetting).order_by(SystemSetting.key)).scalars().all()
    found = {r.key: r for r in rows}
    out: list[dict] = []
    for key, default in e.DEFAULT_SYSTEM_SETTINGS.items():
        row = found.get(key)
        out.append(
            {
                "key": key,
                "value": row.value_json if row else default,
                "description": e.SETTING_DESCRIPTIONS.get(key),
                "updated_at": row.updated_at if row else None,
            }
        )
    return out


def set_setting(db: Session, key: str, value: Any, updated_by: Optional[int] = None) -> SystemSetting:
    if key not in e.DEFAULT_SYSTEM_SETTINGS:
        raise ValueError(f"Unknown setting: {key}")
    row = db.execute(select(SystemSetting).where(SystemSetting.key == key)).scalar_one_or_none()
    if row is None:
        row = SystemSetting(
            key=key,
            value_json=value,
            description=e.SETTING_DESCRIPTIONS.get(key),
            updated_by=updated_by,
        )
        db.add(row)
    else:
        row.value_json = value
        row.updated_by = updated_by
    db.flush()
    return row


def ensure_default_settings(db: Session) -> None:
    """Insert any missing default settings (idempotent)."""
    existing = set(db.execute(select(SystemSetting.key)).scalars().all())
    for key, default in e.DEFAULT_SYSTEM_SETTINGS.items():
        if key not in existing:
            db.add(
                SystemSetting(
                    key=key,
                    value_json=default,
                    description=e.SETTING_DESCRIPTIONS.get(key),
                )
            )
    db.flush()


def maturity_thresholds(db: Session) -> list[int]:
    raw = get_setting(db, e.SETTING_MATURITY_THRESHOLDS) or []
    try:
        values = sorted({int(v) for v in raw}, reverse=True)
    except (TypeError, ValueError):
        values = [90, 30, 7]
    return values or [90, 30, 7]


def int_setting(db: Session, key: str, fallback: int) -> int:
    try:
        return int(get_setting(db, key))
    except (TypeError, ValueError):
        return fallback
