"""Audit trail endpoints (read-only, permission-filtered)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..database import get_db
from ..models import AuditEvent, User
from ..schemas.common import Page
from ..schemas.workflow import AuditOut
from ..security import require_staff
from .deps import forbidden, pagination

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=Page[AuditOut])
def list_audit_events(
    db: Session = Depends(get_db),
    actor: User = Depends(require_staff),
    page_info: tuple[int, int] = Depends(pagination),
    actor_user_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    q: Optional[str] = Query(None),
):
    """Append-only log. Officers see everything; auditors everything read-only;
    institutions have no access (403)."""
    if actor.role == e.ROLE_INSTITUTION:
        raise forbidden("Audit access is restricted to officers, auditors and administrators.")

    page, page_size = page_info
    stmt = select(AuditEvent)
    if actor_user_id is not None:
        stmt = stmt.where(AuditEvent.actor_user_id == actor_user_id)
    if action:
        stmt = stmt.where(AuditEvent.action.ilike(f"%{action}%"))
    if entity_type:
        stmt = stmt.where(AuditEvent.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditEvent.entity_id == str(entity_id))
    if date_from:
        stmt = stmt.where(AuditEvent.timestamp >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        stmt = stmt.where(AuditEvent.timestamp <= datetime.combine(date_to, datetime.max.time()))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            (AuditEvent.action.ilike(like))
            | (AuditEvent.reason.ilike(like))
            | (AuditEvent.entity_type.ilike(like))
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    events = (
        db.execute(
            stmt.order_by(AuditEvent.timestamp.desc()).offset((page - 1) * page_size).limit(page_size)
        )
        .scalars()
        .all()
    )
    names = {}
    actor_ids = {ev.actor_user_id for ev in events if ev.actor_user_id}
    if actor_ids:
        for u in db.execute(select(User).where(User.id.in_(actor_ids))).scalars().all():
            names[u.id] = u.display_name
    items = []
    for ev in events:
        items.append(
            {
                "id": ev.id,
                "actor_user_id": ev.actor_user_id,
                "actor_name": names.get(ev.actor_user_id, "system" if ev.actor_user_id is None else None),
                "action": ev.action,
                "entity_type": ev.entity_type,
                "entity_id": ev.entity_id,
                "timestamp": ev.timestamp,
                "request_id": ev.request_id,
                "reason": ev.reason,
                "metadata_json": ev.metadata_json,
            }
        )
    return Page(items=items, total=total, page=page, page_size=page_size,
                pages=max(1, -(-total // page_size)))
