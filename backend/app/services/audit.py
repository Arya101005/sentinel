"""Append-only audit logging.

Audit events are created by the application and never updated or deleted
through the API. Metadata is restricted to non-sensitive fields: no passwords,
no tokens, no document contents.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import AuditEvent

# Keys never permitted inside audit metadata.
_FORBIDDEN_KEYS = {
    "password",
    "password_hash",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "authorization",
    "cookie",
    "content",
    "extracted_text",
}


def _scrub(metadata: Optional[dict]) -> Optional[dict]:
    if not metadata:
        return None
    clean = {
        k: v
        for k, v in metadata.items()
        if str(k).lower() not in _FORBIDDEN_KEYS and not str(k).lower().endswith("_password")
    }
    # Bound size so audit rows stay small.
    return clean if len(str(clean)) <= 4000 else {"note": "metadata omitted: too large"}


def record_audit(
    db: Session,
    *,
    actor_user_id: Optional[int],
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[Any] = None,
    reason: Optional[str] = None,
    metadata: Optional[dict] = None,
    request_id: Optional[str] = None,
) -> AuditEvent:
    """Append an audit event (caller is responsible for committing)."""
    event = AuditEvent(
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        reason=reason,
        metadata_json=_scrub(metadata),
        request_id=request_id,
    )
    db.add(event)
    db.flush()
    return event
