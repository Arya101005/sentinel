"""Configurable release workflow (Module D).

* Allowed transitions come from ``enums.WORKFLOW_TRANSITIONS`` (configurable set).
* Role rules: institutions may only submit / resubmit; only the designated
  competent authority may approve or reject at the authority stage; admins
  cannot bypass approval controls; auditors are read-only.
* Rejection / return / hold always require a reason.
* Every transition is recorded as an ApplicationEvent (+ audit event).
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .. import enums as e
from ..models import ApplicationEvent, ClearanceRecord, ReleaseApplication, User


class WorkflowError(HTTPException):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(
            status_code=status_code,
            detail={"code": code, "message": message},
        )


def validate_transition(
    db: Session,
    user: User,
    application: ReleaseApplication,
    new_status: str,
    reason: Optional[str],
) -> None:
    """Raise HTTPException (400/403) when the requested transition is not allowed."""
    current = application.application_status

    if new_status not in e.WORKFLOW_STATES:
        raise WorkflowError("unknown_status", f"Unknown workflow state '{new_status}'.")

    if new_status == current:
        raise WorkflowError("no_change", "The application is already in that state.")

    allowed = e.WORKFLOW_TRANSITIONS.get(current, ())
    if new_status not in allowed:
        raise WorkflowError(
            "invalid_transition",
            f"Transition '{e.WORKFLOW_STATE_LABELS.get(current, current)}' -> "
            f"'{e.WORKFLOW_STATE_LABELS.get(new_status, new_status)}' is not permitted.",
        )

    # --- role rules -------------------------------------------------------
    if user.role in (e.ROLE_INSTITUTION, e.ROLE_AUDITOR):
        if (current, new_status) not in e.INSTITUTION_ALLOWED_TRANSITIONS:
            raise WorkflowError(
                "insufficient_role",
                "Your role may only submit or resubmit an application for its own institution.",
                status.HTTP_403_FORBIDDEN,
            )
        if application.institution_id != user.institution_id:
            raise WorkflowError(
                "not_your_institution",
                "You may only act on applications belonging to your institution.",
                status.HTTP_403_FORBIDDEN,
            )
    if user.role == e.ROLE_AUDITOR:
        raise WorkflowError(
            "read_only", "Auditors cannot modify application state.", status.HTTP_403_FORBIDDEN
        )

    if (current, new_status) in e.AUTHORITY_ONLY_TRANSITIONS and not user.is_competent_authority:
        raise WorkflowError(
            "authority_required",
            "Only the designated competent authority may approve or reject at this stage. "
            "Administrators cannot bypass this control.",
            status.HTTP_403_FORBIDDEN,
        )

    # --- reason rules -----------------------------------------------------
    if (current, new_status) in e.REASON_REQUIRED_TRANSITIONS and not (reason or "").strip():
        raise WorkflowError(
            "reason_required",
            "A reason is required for rejection, return-for-correction or hold actions.",
        )

    # --- clearance gate ---------------------------------------------------
    if new_status == e.WF_AUTHORITY:
        blocking = [
            c
            for c in application.clearances
            if c.status in (e.CLEARANCE_PENDING, e.CLEARANCE_IN_PROGRESS, e.CLEARANCE_NOT_CLEARED)
            and c.clearance_type != "competent_authority_approval"
        ]
        if blocking:
            names = ", ".join(
                e.CLEARANCE_LABELS.get(c.clearance_type, c.clearance_type) for c in blocking
            )
            raise WorkflowError(
                "clearances_outstanding",
                f"Required clearances are still outstanding: {names}. The case cannot advance "
                "to the competent-authority stage until they are recorded as cleared or waived.",
            )


def apply_transition(
    db: Session,
    user: User,
    application: ReleaseApplication,
    new_status: str,
    reason: Optional[str] = None,
    comments: Optional[str] = None,
) -> ApplicationEvent:
    """Validate, apply and record a workflow transition (caller commits)."""
    validate_transition(db, user, application, new_status, reason)

    previous = application.application_status
    application.application_status = new_status
    application.current_stage_started_at = datetime.utcnow()
    application.last_action_at = datetime.utcnow()
    application.pending_reason = (reason or comments or None)

    if new_status == e.WF_SUBMITTED and application.submitted_at is None:
        application.submitted_at = datetime.utcnow()

    # Keep the FDR's denormalised release status in sync.
    application.fdr.release_application_status = e.APPLICATION_TO_FDR_RELEASE_STATUS.get(
        new_status, application.fdr.release_application_status
    )

    # Clearance bookkeeping: requesting authority approval implies all required
    # clearances were satisfied (enforced above); mark the seeded approval row.
    if new_status in (e.WF_APPROVED, e.WF_RELEASE_PROCESSING, e.WF_COMPLETED):
        for clearance in application.clearances:
            if clearance.clearance_type == "competent_authority_approval" and clearance.status in (
                e.CLEARANCE_PENDING,
                e.CLEARANCE_IN_PROGRESS,
            ):
                clearance.status = e.CLEARANCE_CLEARED
                clearance.completed_at = datetime.utcnow()
                clearance.updated_by = user.id

    event = ApplicationEvent(
        application_id=application.id,
        previous_status=previous,
        new_status=new_status,
        event_type="status_change",
        actor_user_id=user.id,
        comments=(comments or reason or "").strip() or None,
    )
    db.add(event)
    db.flush()
    return event


def completion_is_terminal(new_status: str) -> bool:
    return new_status in (e.WF_COMPLETED, e.WF_REJECTED)


def ensure_clearances(db: Session, application: ReleaseApplication) -> list[ClearanceRecord]:
    """Create the standard clearance set for a case entering clearance tracking.

    Illustrative types seeded from publicly described AICTE processes — not a
    claim that every case requires every clearance.
    """
    existing = {c.clearance_type for c in application.clearances}
    created: list[ClearanceRecord] = []
    for ctype in ("bank_verification", "finance_concurrence", "audit_clearance",
                  "competent_authority_approval"):
        if ctype in existing:
            continue
        row = ClearanceRecord(
            application=application,  # set the relationship (not just the FK) so the
            # in-memory application.clearances collection is updated immediately and
            # callers that iterate it right after this call see the new rows.
            clearance_type=ctype,
            status=e.CLEARANCE_PENDING,
            assigned_unit={
                "bank_verification": "Deposit-holder bank",
                "finance_concurrence": "Finance unit",
                "audit_clearance": "Audit unit",
                "competent_authority_approval": "Competent authority",
            }[ctype],
            requested_at=datetime.utcnow(),
        )
        db.add(row)
        created.append(row)
    db.flush()
    return created


def application_missing_documents(db: Session, application: ReleaseApplication) -> list[str]:
    """Required document types not yet uploaded for this case (informational)."""
    required = {"fdr_receipt", "application_form"}
    uploaded = {
        d.document_type
        for d in application.fdr.documents
        if d.upload_status == e.DOC_UPLOAD_UPLOADED
    }
    return sorted(required - uploaded)
