"""Notification service (Module E).

Rules implemented here:
  * Notification records are created BEFORE any external delivery attempt.
  * Deduplication keys make scheduled runs idempotent (unique per recipient+channel).
  * Notification preferences are respected.
  * Email is only attempted when SMTP is configured — otherwise the in-app
    notification centre still works and nothing claims an email was delivered.
"""

from __future__ import annotations

import smtplib
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from typing import Iterable, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import enums as e
from ..config import settings
from ..models import (
    ClearanceRecord,
    FdrRecord,
    Institution,
    NotificationEvent,
    NotificationPreference,
    ReleaseApplication,
    User,
)
from .settings_service import int_setting

ESCALATION_MATURED = "escalation_matured_no_application"
ESCALATION_CLEARANCE = "escalation_clearance_overdue"


def _preference_allows(db: Session, user_id: int, event_type: str) -> bool:
    row = db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id,
            NotificationPreference.event_type == event_type,
        )
    ).scalar_one_or_none()
    if row is None:
        return True
    return bool(row.enabled)


def create_notification(
    db: Session,
    *,
    deduplication_key: str,
    title: str,
    message: str,
    notification_type: str,
    recipient_user_id: Optional[int],
    channel: str = e.CHANNEL_IN_APP,
    institution_id: Optional[int] = None,
    fdr_id: Optional[int] = None,
    application_id: Optional[int] = None,
    is_escalation: bool = False,
) -> tuple[bool, Optional[NotificationEvent]]:
    """Insert one notification, suppressing duplicates.

    Returns (created, event). Uses a SAVEPOINT so a duplicate key never
    aborts the surrounding transaction.
    """
    if recipient_user_id is not None and not _preference_allows(db, recipient_user_id, notification_type):
        return False, None

    existing = db.execute(
        select(NotificationEvent).where(
            NotificationEvent.deduplication_key == deduplication_key,
            NotificationEvent.channel == channel,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return False, existing

    event = NotificationEvent(
        recipient_user_id=recipient_user_id,
        institution_id=institution_id,
        fdr_id=fdr_id,
        application_id=application_id,
        notification_type=notification_type,
        channel=channel,
        title=title,
        message=message,
        scheduled_at=datetime.utcnow(),
        sent_at=datetime.utcnow() if channel == e.CHANNEL_IN_APP else None,
        delivery_status=e.DELIVERY_SENT if channel == e.CHANNEL_IN_APP else e.DELIVERY_PENDING,
        deduplication_key=deduplication_key,
        is_escalation=is_escalation,
    )
    try:
        with db.begin_nested():
            db.add(event)
            db.flush()
        return True, event
    except IntegrityError:
        # Race with a concurrent scheduler run — the SAVEPOINT was rolled back,
        # so the surrounding transaction stays usable: treat as already delivered.
        return False, None


def recipients_for_institution(db: Session, institution_id: int, roles: Sequence[str]) -> list[User]:
    return list(
        db.execute(
            select(User).where(
                User.institution_id == institution_id,
                User.role.in_(list(roles)),
                User.is_active.is_(True),
            )
        ).scalars().all()
    )


def officer_recipients(db: Session) -> list[User]:
    return list(
        db.execute(
            select(User).where(
                User.role.in_([e.ROLE_OFFICER, e.ROLE_ADMIN]),
                User.is_active.is_(True),
            )
        ).scalars().all()
    )


def _email_enabled() -> bool:
    return bool(settings.smtp_enabled and settings.smtp_host and settings.smtp_from)


def send_email_now(to_addr: str, subject: str, body: str) -> None:
    """Best-effort SMTP delivery. Raises on failure (caller records it)."""
    if not _email_enabled():
        raise RuntimeError("SMTP is not configured")
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg)


def deliver_email(db: Session, event: NotificationEvent, recipient: Optional[User]) -> None:
    """Attempt email delivery for an already-persisted email notification row."""
    if recipient is None or not recipient.email or not _email_enabled():
        event.delivery_status = e.DELIVERY_FAILED
        event.sent_at = datetime.utcnow()
        return
    try:
        send_email_now(recipient.email, event.title, event.message)
        event.delivery_status = e.DELIVERY_SENT
    except Exception:  # noqa: BLE001 - delivery failures must never crash the job
        event.delivery_status = e.DELIVERY_FAILED
    event.sent_at = datetime.utcnow()
    db.flush()


def ensure_email_copy(
    db: Session,
    *,
    base_event: NotificationEvent,
    recipient: User,
    deduplication_key: str,
) -> None:
    """Create the email twin of an in-app notification and try to deliver it."""
    if not _email_enabled():
        return
    created, event = create_notification(
        db,
        deduplication_key=deduplication_key,
        title=base_event.title,
        message=base_event.message,
        notification_type=base_event.notification_type,
        recipient_user_id=recipient.id,
        channel=e.CHANNEL_EMAIL,
        institution_id=base_event.institution_id,
        fdr_id=base_event.fdr_id,
        application_id=base_event.application_id,
        is_escalation=base_event.is_escalation,
    )
    if created and event is not None:
        deliver_email(db, event, recipient)


# ---------------------------------------------------------------------------
# Maturity / escalation evaluation (idempotent)
# ---------------------------------------------------------------------------
def evaluate_fdr_notifications(
    db: Session,
    fdr: FdrRecord,
    category: str,
    days_to_maturity: Optional[int],
    thresholds: Sequence[int],
) -> tuple[int, int, int]:
    """Create any due notifications for one FDR.

    Returns (created, suppressed, escalations_created).
    """
    created = suppressed = escalations = 0
    inst_users = recipients_for_institution(db, fdr.institution_id, (e.ROLE_INSTITUTION,))
    inst = db.get(Institution, fdr.institution_id)
    inst_name = inst.institution_name if inst else f"Institution #{fdr.institution_id}"
    ref = fdr.fdr_reference_number
    bank = fdr.bank_name

    def _send(user: User, ntype: str, key: str, title: str, message: str, escalation: bool = False):
        nonlocal created, suppressed
        ok, _ = create_notification(
            db,
            deduplication_key=key,
            title=title,
            message=message,
            notification_type=ntype,
            recipient_user_id=user.id,
            institution_id=fdr.institution_id,
            fdr_id=fdr.id,
            is_escalation=escalation,
        )
        if ok:
            created += 1
            # Email twin (only when SMTP is configured).
            if settings.smtp_enabled and user.email:
                pass  # email twin handled by caller-level helper below
        else:
            suppressed += 1
        return ok

    # 1) Upcoming-maturity reminders at configured thresholds.
    if category == e.CAT_UPCOMING and days_to_maturity is not None:
        for threshold in thresholds:
            if days_to_maturity <= threshold:
                mat = fdr.maturity_date.isoformat() if fdr.maturity_date else "unknown"
                for user in inst_users:
                    _send(
                        user,
                        "maturity_upcoming",
                        key=f"maturity:{threshold}:fdr:{fdr.id}:u:{user.id}",
                        title=f"FDR {ref} matures in {days_to_maturity} day(s)",
                        message=(
                            f"{inst_name}: deposit {ref} at {bank} matures on {mat} "
                            f"(in {days_to_maturity} days). This is a demonstration reminder "
                            f"generated at the {threshold}-day threshold."
                        ),
                    )
                break  # one threshold per evaluation run per FDR

    # 2) Matured without an active release application.
    if category == e.CAT_MATURED_NO_APP:
        days_over = abs(days_to_maturity) if days_to_maturity is not None else 0
        for user in inst_users:
            _send(
                user,
                "matured_no_application",
                key=f"matured:fdr:{fdr.id}:u:{user.id}",
                title=f"Action needed: FDR {ref} matured without a recorded application",
                message=(
                    f"{inst_name}: deposit {ref} at {bank} matured on "
                    f"{fdr.maturity_date.isoformat() if fdr.maturity_date else 'an earlier date'} "
                    f"({days_over} day(s) ago) and no active release application is recorded in "
                    f"FDR Sentinel. This flag requests review — it does not confirm eligibility "
                    f"or prove that no application exists outside this system."
                ),
            )
        # 3) Escalation after the configured post-maturity window (once only).
        escalation_days = int_setting(db, e.SETTING_ESCALATION_AFTER_MATURITY, 7)
        if days_over >= escalation_days:
            for user in officer_recipients(db):
                ok, _ = create_notification(
                    db,
                    deduplication_key=f"escalation:matured:fdr:{fdr.id}:u:{user.id}",
                    title=f"Escalation: matured FDR {ref} still awaiting a release application",
                    message=(
                        f"{inst_name}: deposit {ref} matured {days_over} day(s) ago with no "
                        f"active release application recorded, exceeding the configured "
                        f"{escalation_days}-day escalation threshold. Review required."
                    ),
                    notification_type="escalation",
                    recipient_user_id=user.id,
                    institution_id=fdr.institution_id,
                    fdr_id=fdr.id,
                    is_escalation=True,
                )
                if ok:
                    escalations += 1
                else:
                    suppressed += 1
    return created, suppressed, escalations


def evaluate_clearance_escalations(db: Session) -> tuple[int, int]:
    """Escalate clearances pending beyond the configured threshold — once each."""
    threshold = int_setting(db, e.SETTING_CLEARANCE_ESCALATION_DAYS, 10)
    created = suppressed = 0
    rows = db.execute(
        select(ClearanceRecord, ReleaseApplication)
        .join(ReleaseApplication, ClearanceRecord.application_id == ReleaseApplication.id)
        .where(ClearanceRecord.status.in_([e.CLEARANCE_PENDING, e.CLEARANCE_IN_PROGRESS]))
    ).all()
    now = datetime.utcnow()
    for clearance, application in rows:
        start = clearance.requested_at or clearance.created_at
        if (now - start).days < threshold:
            continue
        targets = officer_recipients(db)
        if application.assigned_officer_id:
            officer = db.get(User, application.assigned_officer_id)
            if officer:
                targets = [officer] + [t for t in targets if t.id != officer.id]
        for user in targets:
            ok, _ = create_notification(
                db,
                deduplication_key=f"escalation:clearance:{clearance.id}:u:{user.id}",
                title=f"Escalation: {e.CLEARANCE_LABELS.get(clearance.clearance_type, clearance.clearance_type)} pending {threshold}+ days",
                message=(
                    f"Clearance '{e.CLEARANCE_LABELS.get(clearance.clearance_type, clearance.clearance_type)}' "
                    f"for application {application.application_reference} has been pending since "
                    f"{start.date().isoformat()} ({(now - start).days} days), exceeding the "
                    f"configured {threshold}-day threshold."
                ),
                notification_type="escalation",
                recipient_user_id=user.id,
                institution_id=application.institution_id,
                application_id=application.id,
                is_escalation=True,
            )
            if ok:
                created += 1
            else:
                suppressed += 1
    return created, suppressed


def notify_application_status(db: Session, application: ReleaseApplication, actor_name: str) -> None:
    """In-app notification to the institution when a case changes stage."""
    ref = application.application_reference
    for user in recipients_for_institution(db, application.institution_id, (e.ROLE_INSTITUTION,)):
        create_notification(
            db,
            deduplication_key=f"app-status:{application.id}:{application.application_status}:u:{user.id}",
            title=f"Application {ref}: {e.WORKFLOW_STATE_LABELS.get(application.application_status, application.application_status)}",
            message=(
                f"Release application {ref} is now "
                f"'{e.WORKFLOW_STATE_LABELS.get(application.application_status, application.application_status)}'. "
                f"Updated by {actor_name}."
            ),
            notification_type="application_status_change",
            recipient_user_id=user.id,
            institution_id=application.institution_id,
            application_id=application.id,
            fdr_id=application.fdr_id,
        )


def notify_assignment(db: Session, application: ReleaseApplication, officer: Optional[User]) -> None:
    if officer is None:
        return
    create_notification(
        db,
        deduplication_key=f"assigned:{application.id}:u:{officer.id}",
        title=f"Case assigned: {application.application_reference}",
        message=(
            f"Release application {application.application_reference} has been assigned to you for "
            f"'{e.WORKFLOW_STATE_LABELS.get(application.application_status, application.application_status)}'."
        ),
        notification_type="application_assigned",
        recipient_user_id=officer.id,
        institution_id=application.institution_id,
        application_id=application.id,
        fdr_id=application.fdr_id,
    )


def notify_discrepancy(db: Session, fdr: FdrRecord, discrepancy_type: str) -> None:
    for user in recipients_for_institution(db, fdr.institution_id, (e.ROLE_INSTITUTION,)):
        create_notification(
            db,
            deduplication_key=f"discrepancy:{fdr.id}:{discrepancy_type}:u:{user.id}",
            title=f"Document discrepancy flagged for FDR {fdr.fdr_reference_number}",
            message=(
                f"A '{discrepancy_type.replace('_', ' ')}' discrepancy was detected between your "
                f"submitted record and an uploaded document for FDR {fdr.fdr_reference_number}. "
                f"Review the extracted values and respond if a correction is required."
            ),
            notification_type="discrepancy_flagged",
            recipient_user_id=user.id,
            institution_id=fdr.institution_id,
            fdr_id=fdr.id,
        )


def mark_read(db: Session, notification: NotificationEvent) -> None:
    if notification.read_at is None:
        notification.read_at = datetime.utcnow()
        db.flush()
