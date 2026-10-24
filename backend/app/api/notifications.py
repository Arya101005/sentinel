"""In-app notification centre endpoints."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import enums as e
from ..config import settings as app_settings
from ..database import get_db
from ..models import FdrRecord, NotificationEvent, NotificationPreference, User
from ..schemas.common import Message, Page, paginate
from ..schemas.workflow import NotificationOut, NotificationPrefOut, NotificationPrefUpdate
from ..security import get_current_user
from ..services.notifications import mark_read
from .deps import not_found, pagination

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _out(event: NotificationEvent, ref: Optional[str] = None) -> dict:
    return {
        "id": event.id,
        "recipient_user_id": event.recipient_user_id,
        "institution_id": event.institution_id,
        "fdr_id": event.fdr_id,
        "application_id": event.application_id,
        "notification_type": event.notification_type,
        "channel": event.channel,
        "title": event.title,
        "message": event.message,
        "scheduled_at": event.scheduled_at,
        "sent_at": event.sent_at,
        "delivery_status": event.delivery_status,
        "read_at": event.read_at,
        "is_escalation": event.is_escalation,
        "created_at": event.created_at,
        "fdr_reference_number": ref,
    }


@router.get("", response_model=Page[NotificationOut])
def list_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page_info: tuple[int, int] = Depends(pagination),
    unread_only: bool = Query(False),
    notification_type: Optional[str] = Query(None),
    include_email: bool = Query(False, description="Include email-channel delivery records"),
):
    page, page_size = page_info
    stmt = select(NotificationEvent).where(NotificationEvent.recipient_user_id == user.id)
    if not include_email:
        stmt = stmt.where(NotificationEvent.channel == e.CHANNEL_IN_APP)
    if unread_only:
        stmt = stmt.where(NotificationEvent.read_at.is_(None))
    if notification_type:
        stmt = stmt.where(NotificationEvent.notification_type == notification_type)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    events = (
        db.execute(
            stmt.order_by(NotificationEvent.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
        .scalars()
        .all()
    )
    refs = {}
    fdr_ids = {ev.fdr_id for ev in events if ev.fdr_id}
    if fdr_ids:
        for rec in db.execute(select(FdrRecord).where(FdrRecord.id.in_(fdr_ids))).scalars().all():
            refs[rec.id] = rec.fdr_reference_number
    return paginate([_out(ev, refs.get(ev.fdr_id)) for ev in events], total, page, page_size)


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    count = db.execute(
        select(func.count(NotificationEvent.id)).where(
            NotificationEvent.recipient_user_id == user.id,
            NotificationEvent.read_at.is_(None),
            NotificationEvent.channel == e.CHANNEL_IN_APP,
        )
    ).scalar_one()
    return {
        "unread": count,
        "email_configured": bool(app_settings.smtp_enabled and app_settings.smtp_host),
        "email_delivery_note": (
            None
            if app_settings.smtp_enabled and app_settings.smtp_host
            else "Email delivery is not configured on this deployment; notifications are in-app only."
        ),
    }


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_as_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    event = db.get(NotificationEvent, notification_id)
    if event is None or event.recipient_user_id != user.id:
        raise not_found("Notification")
    mark_read(db, event)
    db.commit()
    db.refresh(event)
    return _out(event)


@router.post("/read-all")
def mark_all_read(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from datetime import datetime

    events = db.execute(
        select(NotificationEvent).where(
            NotificationEvent.recipient_user_id == user.id,
            NotificationEvent.read_at.is_(None),
        )
    ).scalars().all()
    now = datetime.utcnow()
    for event in events:
        event.read_at = now
    db.commit()
    return {"message": f"{len(events)} notification(s) marked as read."}


@router.get("/preferences", response_model=list[NotificationPrefOut])
def list_preferences(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.execute(
        select(NotificationPreference).where(NotificationPreference.user_id == user.id)
    ).scalars().all()
    return [NotificationPrefOut.model_validate(r) for r in rows]


@router.put("/preferences", response_model=NotificationPrefOut)
def upsert_preference(
    payload: NotificationPrefUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.event_type not in e.NOTIFICATION_TYPES:
        raise not_found("Notification type")
    row = db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user.id,
            NotificationPreference.event_type == payload.event_type,
        )
    ).scalar_one_or_none()
    if row is None:
        row = NotificationPreference(
            user_id=user.id,
            event_type=payload.event_type,
            enabled=payload.enabled,
            channel=payload.channel,
        )
        db.add(row)
    else:
        row.enabled = payload.enabled
        row.channel = payload.channel
    db.commit()
    db.refresh(row)
    return NotificationPrefOut.model_validate(row)
