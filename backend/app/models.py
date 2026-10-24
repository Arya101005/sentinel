"""SQLAlchemy 2.x ORM models for all FDR Sentinel entities.

Conventions
-----------
* Primary keys are integer surrogate keys.
* Timestamps are naive UTC (`created_at`, `updated_at`, ...).
* Monetary values use ``Numeric(14, 2)`` (decimal, never float).
* Large file binaries are NEVER stored here — only private storage paths,
  checksums and metadata.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from . import enums as e
from .database import Base


def utcnow() -> datetime:
    """Naive UTC timestamp (stored uniformly, interpreted as UTC)."""
    return datetime.utcnow()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


# ---------------------------------------------------------------------------
# Institutions
# ---------------------------------------------------------------------------
class Institution(TimestampMixin, Base):
    __tablename__ = "institutions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    institution_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    institution_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    institution_type: Mapped[str] = mapped_column(String(64), default="college", nullable=False)
    region: Mapped[str] = mapped_column(String(120), default="", nullable=False, index=True)
    address: Mapped[Optional[str]] = mapped_column(String(512))
    contact_email: Mapped[Optional[str]] = mapped_column(String(255))
    contact_phone: Mapped[Optional[str]] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    users: Mapped[list["User"]] = relationship(back_populates="institution")
    fdr_records: Mapped[list["FdrRecord"]] = relationship(back_populates="institution")


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    authentication_provider_id: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    auth_provider: Mapped[str] = mapped_column(String(32), default="local", nullable=False)
    username: Mapped[Optional[str]] = mapped_column(String(120), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    # Hashed password — only present for the local development/seed provider.
    password_hash: Mapped[Optional[str]] = mapped_column(String(512))
    role: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    institution_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("institutions.id", ondelete="SET NULL"), index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Designated competent authority — grants release approval rights.
    is_competent_authority: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    institution: Mapped[Optional[Institution]] = relationship(back_populates="users")


# ---------------------------------------------------------------------------
# FDR records
# ---------------------------------------------------------------------------
class FdrRecord(Base):
    __tablename__ = "fdr_records"
    __table_args__ = (
        CheckConstraint("deposit_amount > 0", name="ck_fdr_positive_amount"),
        CheckConstraint("issue_date IS NULL OR maturity_date IS NULL OR issue_date <= maturity_date",
                        name="ck_fdr_issue_before_maturity"),
        Index("ix_fdr_maturity_date", "maturity_date"),
        Index("ix_fdr_institution_maturity", "institution_id", "maturity_date"),
        Index("ix_fdr_reference", "fdr_reference_number"),
        Index("ix_fdr_bank_reference", "bank_name", "fdr_reference_number"),
        Index("ix_fdr_lifecycle", "lifecycle_status"),
        Index("ix_fdr_release_status", "release_application_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    institution_id: Mapped[int] = mapped_column(
        ForeignKey("institutions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    fdr_reference_number: Mapped[str] = mapped_column(String(64), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(160), nullable=False)
    branch_name: Mapped[Optional[str]] = mapped_column(String(160))
    deposit_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="INR", nullable=False)
    issue_date: Mapped[Optional[datetime]] = mapped_column(Date)
    maturity_date: Mapped[Optional[datetime]] = mapped_column(Date)
    verification_status: Mapped[str] = mapped_column(
        String(32), default=e.FDR_VERIFICATION_UNVERIFIED, nullable=False
    )
    lifecycle_status: Mapped[str] = mapped_column(
        String(32), default=e.LIFECYCLE_ACTIVE, nullable=False, index=True
    )
    release_application_status: Mapped[str] = mapped_column(
        String(32), default=e.REL_RELEASE_NONE, nullable=False
    )
    renewal_parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="SET NULL"), index=True
    )
    replacement_fdr_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="SET NULL"), index=True
    )
    link_type: Mapped[Optional[str]] = mapped_column(String(32))  # renewal | replacement
    eligibility_notes: Mapped[Optional[str]] = mapped_column(Text)  # recorded hold/eligibility info
    remarks: Mapped[Optional[str]] = mapped_column(Text)
    last_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    institution: Mapped[Institution] = relationship(
        back_populates="fdr_records", foreign_keys=[institution_id]
    )
    documents: Mapped[list["Document"]] = relationship(back_populates="fdr", cascade="all, delete-orphan")
    discrepancies: Mapped[list["DiscrepancyFlag"]] = relationship(
        back_populates="fdr", cascade="all, delete-orphan"
    )
    applications: Mapped[list["ReleaseApplication"]] = relationship(
        back_populates="fdr", cascade="all, delete-orphan"
    )
    lifecycle_events: Mapped[list["FdrLifecycleEvent"]] = relationship(
        back_populates="fdr", cascade="all, delete-orphan", order_by="FdrLifecycleEvent.created_at"
    )
    parent: Mapped[Optional["FdrRecord"]] = relationship(
        foreign_keys=[renewal_parent_id], remote_side="FdrRecord.id"
    )


class FdrLifecycleEvent(Base):
    """Readable history of an FDR record (never silently overwritten)."""

    __tablename__ = "fdr_lifecycle_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fdr_id: Mapped[int] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    previous_value: Mapped[Optional[str]] = mapped_column(String(512))
    new_value: Mapped[Optional[str]] = mapped_column(String(512))
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    comment: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False, index=True)

    fdr: Mapped[FdrRecord] = relationship(back_populates="lifecycle_events")


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------
class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_fdr", "fdr_id", "document_type"),
        Index("ix_documents_checksum", "checksum"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    institution_id: Mapped[int] = mapped_column(
        ForeignKey("institutions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    fdr_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="CASCADE"), index=True
    )
    document_type: Mapped[str] = mapped_column(String(64), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    private_storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    upload_status: Mapped[str] = mapped_column(String(32), default=e.DOC_UPLOAD_UPLOADED, nullable=False)
    uploaded_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    extracted_text: Mapped[Optional[str]] = mapped_column(Text)
    extraction_status: Mapped[str] = mapped_column(
        String(40), default=e.EXTRACTION_PENDING, nullable=False
    )
    extraction_error: Mapped[Optional[str]] = mapped_column(String(512))
    extraction_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    extraction_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    review_status: Mapped[str] = mapped_column(String(32), default=e.REVIEW_PENDING, nullable=False)
    reviewed_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    fdr: Mapped[Optional[FdrRecord]] = relationship(back_populates="documents")
    uploader: Mapped[Optional[User]] = relationship(foreign_keys=[uploaded_by])
    extractions: Mapped[list["ExtractedFdrField"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    discrepancies: Mapped[list["DiscrepancyFlag"]] = relationship(back_populates="document")


class ExtractedFdrField(Base):
    __tablename__ = "extracted_fdr_fields"
    __table_args__ = (
        UniqueConstraint("document_id", "field_name", name="uq_extraction_document_field"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_name: Mapped[str] = mapped_column(String(64), nullable=False)
    extracted_value: Mapped[Optional[str]] = mapped_column(String(512))
    normalized_value: Mapped[Optional[str]] = mapped_column(String(512))
    confidence_score: Mapped[Optional[float]] = mapped_column(Numeric(4, 3))
    review_status: Mapped[str] = mapped_column(
        String(32), default=e.FIELD_REVIEW_PENDING, nullable=False
    )
    reviewed_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    document: Mapped[Document] = relationship(back_populates="extractions")


# ---------------------------------------------------------------------------
# Discrepancy flags
# ---------------------------------------------------------------------------
class DiscrepancyFlag(Base):
    __tablename__ = "discrepancy_flags"
    __table_args__ = (
        Index("ix_discrepancy_status", "status", "severity"),
        Index("ix_discrepancy_fdr", "fdr_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fdr_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    field_name: Mapped[Optional[str]] = mapped_column(String(64))
    submitted_value: Mapped[Optional[str]] = mapped_column(String(512))
    extracted_value: Mapped[Optional[str]] = mapped_column(String(512))
    discrepancy_type: Mapped[str] = mapped_column(String(48), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), default=e.SEVERITY_MEDIUM, nullable=False)
    explanation: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default=e.DISC_OPEN, nullable=False)
    assigned_to: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolution_notes: Mapped[Optional[str]] = mapped_column(Text)
    resolved_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    fdr: Mapped[Optional[FdrRecord]] = relationship(back_populates="discrepancies")
    document: Mapped[Optional[Document]] = relationship(back_populates="discrepancies")


# ---------------------------------------------------------------------------
# Release applications, clearances, application events
# ---------------------------------------------------------------------------
class ReleaseApplication(Base):
    __tablename__ = "release_applications"
    __table_args__ = (
        Index("ix_application_status", "application_status"),
        Index("ix_application_institution_status", "institution_id", "application_status"),
        Index("ix_application_fdr", "fdr_id"),
        Index("ix_application_assigned", "assigned_officer_id"),
        # An open (non-terminal) application per FDR: only one case may be actively worked.
        Index(
            "uq_application_open_per_fdr",
            "fdr_id",
            unique=True,
            sqlite_where=text("application_status NOT IN ('completed','rejected')"),
            postgresql_where=text("application_status NOT IN ('completed','rejected')"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    application_reference: Mapped[str] = mapped_column(String(48), unique=True, nullable=False, index=True)
    institution_id: Mapped[int] = mapped_column(
        ForeignKey("institutions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    fdr_id: Mapped[int] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="RESTRICT"), nullable=False
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    application_status: Mapped[str] = mapped_column(
        String(48), default=e.WF_DRAFT, nullable=False
    )
    completeness_status: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False)
    assigned_officer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    pending_reason: Mapped[Optional[str]] = mapped_column(String(512))
    current_stage_started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    last_action_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    fdr: Mapped[FdrRecord] = relationship(back_populates="applications")
    institution: Mapped[Institution] = relationship()
    assigned_officer: Mapped[Optional[User]] = relationship(foreign_keys=[assigned_officer_id])
    clearances: Mapped[list["ClearanceRecord"]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )
    events: Mapped[list["ApplicationEvent"]] = relationship(
        back_populates="application", cascade="all, delete-orphan",
        order_by="ApplicationEvent.created_at",
    )


class ClearanceRecord(Base):
    __tablename__ = "clearance_records"
    __table_args__ = (
        UniqueConstraint("application_id", "clearance_type", name="uq_clearance_app_type"),
        Index("ix_clearance_status", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    application_id: Mapped[int] = mapped_column(
        ForeignKey("release_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    clearance_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default=e.CLEARANCE_PENDING, nullable=False)
    assigned_unit: Mapped[Optional[str]] = mapped_column(String(160))
    requested_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    remarks: Mapped[Optional[str]] = mapped_column(Text)
    updated_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    application: Mapped[ReleaseApplication] = relationship(back_populates="clearances")


class ApplicationEvent(Base):
    __tablename__ = "application_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    application_id: Mapped[int] = mapped_column(
        ForeignKey("release_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    previous_status: Mapped[Optional[str]] = mapped_column(String(48))
    new_status: Mapped[Optional[str]] = mapped_column(String(48))
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    comments: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False, index=True)

    application: Mapped[ReleaseApplication] = relationship(back_populates="events")


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
class NotificationEvent(Base):
    __tablename__ = "notification_events"
    __table_args__ = (
        # Idempotency: the scheduler can re-run safely — the same event/threshold
        # for the same recipient+channel is only ever created once.
        UniqueConstraint("deduplication_key", "channel", name="uq_notification_dedup_channel"),
        Index("ix_notification_recipient", "recipient_user_id", "read_at"),
        Index("ix_notification_type", "notification_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipient_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    institution_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("institutions.id", ondelete="CASCADE"), index=True
    )
    fdr_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="CASCADE"), index=True
    )
    application_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("release_applications.id", ondelete="CASCADE"), index=True
    )
    notification_type: Mapped[str] = mapped_column(String(64), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), default=e.CHANNEL_IN_APP, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    delivery_status: Mapped[str] = mapped_column(
        String(24), default=e.DELIVERY_PENDING, nullable=False
    )
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    deduplication_key: Mapped[str] = mapped_column(String(255), nullable=False)
    is_escalation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "event_type", name="uq_notification_pref_user_event"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    channel: Mapped[str] = mapped_column(String(16), default=e.CHANNEL_IN_APP, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
class AuditEvent(Base):
    """Append-only activity log. Never stores passwords, tokens or file contents."""

    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_timestamp", "timestamp"),
        Index("ix_audit_actor", "actor_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(96), nullable=False)
    entity_type: Mapped[Optional[str]] = mapped_column(String(64))
    entity_id: Mapped[Optional[str]] = mapped_column(String(64))
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    request_id: Mapped[Optional[str]] = mapped_column(String(64))
    reason: Mapped[Optional[str]] = mapped_column(String(512))
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON)

    actor_user: Mapped[Optional[User]] = relationship(foreign_keys=[actor_user_id])


# ---------------------------------------------------------------------------
# System settings
# ---------------------------------------------------------------------------
class SystemSetting(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(96), unique=True, nullable=False, index=True)
    value_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(512))
    updated_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
