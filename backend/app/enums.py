"""Domain enums, workflow transition matrix and configuration defaults.

Stored as plain strings in the database (portable across SQLite/PostgreSQL);
validated at the API layer with these constant sets.
"""

from __future__ import annotations

# --- Roles -------------------------------------------------------------------
ROLE_ADMIN = "admin"                # System Administrator
ROLE_OFFICER = "officer"            # AICTE Officer
ROLE_INSTITUTION = "institution"    # Institution User
ROLE_AUDITOR = "auditor"            # Read-Only Auditor

ROLES = (ROLE_ADMIN, ROLE_OFFICER, ROLE_INSTITUTION, ROLE_AUDITOR)
ROLE_LABELS = {
    ROLE_ADMIN: "System Administrator",
    ROLE_OFFICER: "AICTE Officer",
    ROLE_INSTITUTION: "Institution User",
    ROLE_AUDITOR: "Read-Only Auditor",
}

# --- FDR ---------------------------------------------------------------------
FDR_VERIFICATION_UNVERIFIED = "unverified"
FDR_VERIFICATION_PENDING = "pending_review"
FDR_VERIFICATION_VERIFIED = "verified"
FDR_VERIFICATION_DISCREPANCY = "discrepancies_found"
FDR_VERIFICATION_MANUAL = "manual_review"
FDR_VERIFICATION_STATUSES = (
    FDR_VERIFICATION_UNVERIFIED,
    FDR_VERIFICATION_PENDING,
    FDR_VERIFICATION_VERIFIED,
    FDR_VERIFICATION_DISCREPANCY,
    FDR_VERIFICATION_MANUAL,
)

LIFECYCLE_ACTIVE = "active"
LIFECYCLE_MATURED = "matured"
LIFECYCLE_RENEWED = "renewed"
LIFECYCLE_REPLACED = "replaced"
LIFECYCLE_RELEASED = "released"
LIFECYCLE_ON_HOLD = "on_hold"
LIFECYCLE_ARCHIVED = "archived"
LIFECYCLE_STATUSES = (
    LIFECYCLE_ACTIVE,
    LIFECYCLE_MATURED,
    LIFECYCLE_RENEWED,
    LIFECYCLE_REPLACED,
    LIFECYCLE_RELEASED,
    LIFECYCLE_ON_HOLD,
    LIFECYCLE_ARCHIVED,
)

# Active deposits: counted as "one deposit" for monitoring / dashboards.
ACTIVE_LIFECYCLE_STATUSES = (LIFECYCLE_ACTIVE, LIFECYCLE_MATURED, LIFECYCLE_ON_HOLD)

REL_RELEASE_NONE = "none"
REL_RELEASE_SUBMITTED = "submitted"
REL_RELEASE_UNDER_VERIFICATION = "under_verification"
REL_RELEASE_AWAITING_CLEARANCE = "awaiting_clearance"
REL_RELEASE_AWAITING_AUTHORITY = "awaiting_authority"
REL_RELEASE_PROCESSING = "release_processing"
REL_RELEASE_COMPLETED = "completed"
REL_RELEASE_REJECTED = "rejected"
REL_RELEASE_ON_HOLD = "on_hold"
REL_RELEASE_STATUSES = (
    REL_RELEASE_NONE,
    REL_RELEASE_SUBMITTED,
    REL_RELEASE_UNDER_VERIFICATION,
    REL_RELEASE_AWAITING_CLEARANCE,
    REL_RELEASE_AWAITING_AUTHORITY,
    REL_RELEASE_PROCESSING,
    REL_RELEASE_COMPLETED,
    REL_RELEASE_REJECTED,
    REL_RELEASE_ON_HOLD,
)

# --- Documents ---------------------------------------------------------------
DOCUMENT_TYPES = (
    "fdr_receipt",          # the deposit receipt / certificate
    "application_form",     # release application form
    "bank_confirmation",
    "institution_approval",
    "id_proof",
    "supporting",           # any other supporting document
)

DOC_UPLOAD_PENDING = "pending"
DOC_UPLOAD_UPLOADED = "uploaded"
DOC_UPLOAD_FAILED = "failed"

EXTRACTION_PENDING = "pending"
EXTRACTION_EXTRACTED = "extracted"
EXTRACTION_PARTIAL = "partial"
EXTRACTION_FAILED = "failed"
EXTRACTION_MANUAL = "manual_review_required"

REVIEW_PENDING = "pending"
REVIEW_IN_REVIEW = "in_review"
REVIEW_COMPLETED = "reviewed"

EXTRACTION_STATUSES = (
    EXTRACTION_PENDING,
    EXTRACTION_EXTRACTED,
    EXTRACTION_PARTIAL,
    EXTRACTION_FAILED,
    EXTRACTION_MANUAL,
)

# --- Extracted fields --------------------------------------------------------
FIELD_REVIEW_PENDING = "pending"
FIELD_REVIEW_NEEDS_REVIEW = "needs_review"
FIELD_REVIEW_CONFIRMED = "confirmed"
FIELD_REVIEW_CORRECTED = "corrected"
FIELD_REVIEW_STATUSES = (
    FIELD_REVIEW_PENDING,
    FIELD_REVIEW_NEEDS_REVIEW,
    FIELD_REVIEW_CONFIRMED,
    FIELD_REVIEW_CORRECTED,
)

# --- Discrepancies -----------------------------------------------------------
DISC_MISSING_FIELD = "missing_field"
DISC_AMOUNT_MISMATCH = "amount_mismatch"
DISC_DATE_MISMATCH = "date_mismatch"
DISC_REFERENCE_MISMATCH = "reference_mismatch"
DISC_BANK_MISMATCH = "bank_mismatch"
DISC_INSTITUTION_MISMATCH = "institution_mismatch"
DISC_POTENTIAL_DUPLICATE = "potential_duplicate"
DISC_EXTRACTION_FAILED = "extraction_failed"
DISCREPANCY_TYPES = (
    DISC_MISSING_FIELD,
    DISC_AMOUNT_MISMATCH,
    DISC_DATE_MISMATCH,
    DISC_REFERENCE_MISMATCH,
    DISC_BANK_MISMATCH,
    DISC_INSTITUTION_MISMATCH,
    DISC_POTENTIAL_DUPLICATE,
    DISC_EXTRACTION_FAILED,
)

SEVERITY_LOW = "low"
SEVERITY_MEDIUM = "medium"
SEVERITY_HIGH = "high"
SEVERITY_CRITICAL = "critical"
SEVERITIES = (SEVERITY_LOW, SEVERITY_MEDIUM, SEVERITY_HIGH, SEVERITY_CRITICAL)

DISC_OPEN = "open"
DISC_CONFIRMED = "confirmed"
DISC_DISMISSED = "dismissed"
DISC_RESOLVED = "resolved"
DISC_CORRECTION_REQUESTED = "correction_requested"
DISCREPANCY_STATUSES = (
    DISC_OPEN,
    DISC_CONFIRMED,
    DISC_DISMISSED,
    DISC_RESOLVED,
    DISC_CORRECTION_REQUESTED,
)
OPEN_DISCREPANCY_STATUSES = (DISC_OPEN, DISC_CONFIRMED, DISC_CORRECTION_REQUESTED)

# --- Release applications / workflow ----------------------------------------
WF_DRAFT = "draft"
WF_SUBMITTED = "submitted"
WF_DOCUMENT_CHECKS = "document_checks_pending"
WF_NEEDS_CORRECTION = "needs_correction"
WF_OFFICER_VERIFICATION = "under_officer_verification"
WF_BANK_VERIFICATION = "awaiting_bank_verification"
WF_CLEARANCE = "awaiting_clearance"
WF_AUTHORITY = "awaiting_authority_decision"
WF_APPROVED = "approved"
WF_REJECTED = "rejected"
WF_RELEASE_PROCESSING = "release_processing"
WF_COMPLETED = "completed"
WF_ON_HOLD = "on_hold"

WORKFLOW_STATES = (
    WF_DRAFT,
    WF_SUBMITTED,
    WF_DOCUMENT_CHECKS,
    WF_NEEDS_CORRECTION,
    WF_OFFICER_VERIFICATION,
    WF_BANK_VERIFICATION,
    WF_CLEARANCE,
    WF_AUTHORITY,
    WF_APPROVED,
    WF_REJECTED,
    WF_RELEASE_PROCESSING,
    WF_COMPLETED,
    WF_ON_HOLD,
)

WORKFLOW_STATE_LABELS = {
    WF_DRAFT: "Draft",
    WF_SUBMITTED: "Submitted",
    WF_DOCUMENT_CHECKS: "Document checks pending",
    WF_NEEDS_CORRECTION: "Needs correction",
    WF_OFFICER_VERIFICATION: "Under officer verification",
    WF_BANK_VERIFICATION: "Awaiting external / bank verification",
    WF_CLEARANCE: "Awaiting required clearances",
    WF_AUTHORITY: "Awaiting competent-authority decision",
    WF_APPROVED: "Approved",
    WF_REJECTED: "Rejected",
    WF_RELEASE_PROCESSING: "Release processing",
    WF_COMPLETED: "Completed",
    WF_ON_HOLD: "On hold",
}

# Which roles may initiate a transition out of each state.
WORKFLOW_TRANSITIONS: dict[str, tuple[str, ...]] = {
    WF_DRAFT: (WF_SUBMITTED, WF_ON_HOLD),
    WF_SUBMITTED: (WF_DOCUMENT_CHECKS, WF_OFFICER_VERIFICATION, WF_NEEDS_CORRECTION, WF_REJECTED, WF_ON_HOLD),
    WF_DOCUMENT_CHECKS: (WF_OFFICER_VERIFICATION, WF_NEEDS_CORRECTION, WF_ON_HOLD, WF_REJECTED),
    WF_NEEDS_CORRECTION: (WF_SUBMITTED, WF_REJECTED, WF_ON_HOLD),
    WF_OFFICER_VERIFICATION: (
        WF_BANK_VERIFICATION,
        WF_CLEARANCE,
        WF_NEEDS_CORRECTION,
        WF_REJECTED,
        WF_ON_HOLD,
    ),
    WF_BANK_VERIFICATION: (WF_OFFICER_VERIFICATION, WF_CLEARANCE, WF_NEEDS_CORRECTION, WF_ON_HOLD),
    WF_CLEARANCE: (WF_AUTHORITY, WF_NEEDS_CORRECTION, WF_REJECTED, WF_ON_HOLD, WF_OFFICER_VERIFICATION),
    WF_AUTHORITY: (WF_APPROVED, WF_REJECTED, WF_ON_HOLD, WF_CLEARANCE),
    WF_APPROVED: (WF_RELEASE_PROCESSING, WF_ON_HOLD),
    WF_RELEASE_PROCESSING: (WF_COMPLETED, WF_ON_HOLD),
    WF_COMPLETED: (),
    WF_REJECTED: (),
    WF_ON_HOLD: (WF_SUBMITTED, WF_OFFICER_VERIFICATION, WF_NEEDS_CORRECTION, WF_REJECTED, WF_AUTHORITY),
}

# States that only the competent authority (not institutions, not plain officers) may leave.
AUTHORITY_ONLY_TRANSITIONS = {(WF_AUTHORITY, WF_APPROVED), (WF_AUTHORITY, WF_REJECTED)}

# States a non-admin institution user is allowed to move an application to.
INSTITUTION_ALLOWED_TRANSITIONS = {
    (WF_DRAFT, WF_SUBMITTED),
    (WF_NEEDS_CORRECTION, WF_SUBMITTED),
    (WF_DRAFT, WF_ON_HOLD),
}

# States requiring a free-text reason.
REASON_REQUIRED_TRANSITIONS = {
    (WF_SUBMITTED, WF_REJECTED),
    (WF_DOCUMENT_CHECKS, WF_REJECTED),
    (WF_OFFICER_VERIFICATION, WF_REJECTED),
    (WF_CLEARANCE, WF_REJECTED),
    (WF_AUTHORITY, WF_REJECTED),
    (WF_OFFICER_VERIFICATION, WF_NEEDS_CORRECTION),
    (WF_DOCUMENT_CHECKS, WF_NEEDS_CORRECTION),
    (WF_BANK_VERIFICATION, WF_NEEDS_CORRECTION),
    (WF_CLEARANCE, WF_NEEDS_CORRECTION),
    (WF_SUBMITTED, WF_ON_HOLD),
    (WF_OFFICER_VERIFICATION, WF_ON_HOLD),
    (WF_CLEARANCE, WF_ON_HOLD),
    (WF_AUTHORITY, WF_ON_HOLD),
    (WF_APPROVED, WF_ON_HOLD),
    (WF_RELEASE_PROCESSING, WF_ON_HOLD),
    (WF_NEEDS_CORRECTION, WF_ON_HOLD),
    (WF_DOCUMENT_CHECKS, WF_ON_HOLD),
    (WF_BANK_VERIFICATION, WF_ON_HOLD),
}

# Application → FDR release_application_status mapping.
APPLICATION_TO_FDR_RELEASE_STATUS = {
    WF_DRAFT: REL_RELEASE_SUBMITTED,
    WF_SUBMITTED: REL_RELEASE_SUBMITTED,
    WF_DOCUMENT_CHECKS: REL_RELEASE_UNDER_VERIFICATION,
    WF_NEEDS_CORRECTION: REL_RELEASE_SUBMITTED,
    WF_OFFICER_VERIFICATION: REL_RELEASE_UNDER_VERIFICATION,
    WF_BANK_VERIFICATION: REL_RELEASE_UNDER_VERIFICATION,
    WF_CLEARANCE: REL_RELEASE_AWAITING_CLEARANCE,
    WF_AUTHORITY: REL_RELEASE_AWAITING_AUTHORITY,
    WF_APPROVED: REL_RELEASE_AWAITING_AUTHORITY,
    WF_RELEASE_PROCESSING: REL_RELEASE_PROCESSING,
    WF_COMPLETED: REL_RELEASE_COMPLETED,
    WF_REJECTED: REL_RELEASE_REJECTED,
    WF_ON_HOLD: REL_RELEASE_ON_HOLD,
}

# States considered "active work" for queue purposes.
ACTIVE_APPLICATION_STATES = (
    WF_DRAFT,
    WF_SUBMITTED,
    WF_DOCUMENT_CHECKS,
    WF_NEEDS_CORRECTION,
    WF_OFFICER_VERIFICATION,
    WF_BANK_VERIFICATION,
    WF_CLEARANCE,
    WF_AUTHORITY,
    WF_APPROVED,
    WF_RELEASE_PROCESSING,
    WF_ON_HOLD,
)
TERMINAL_APPLICATION_STATES = (WF_COMPLETED, WF_REJECTED)

# --- Clearances --------------------------------------------------------------
CLEARANCE_TYPES = (
    "bank_verification",
    "finance_concurrence",
    "audit_clearance",
    "legal_review",
    "competent_authority_approval",
)
CLEARANCE_LABELS = {
    "bank_verification": "Bank / deposit-holder verification",
    "finance_concurrence": "Finance concurrence",
    "audit_clearance": "Audit clearance",
    "legal_review": "Legal review",
    "competent_authority_approval": "Competent-authority approval",
}
CLEARANCE_PENDING = "pending"
CLEARANCE_IN_PROGRESS = "in_progress"
CLEARANCE_CLEARED = "cleared"
CLEARANCE_NOT_CLEARED = "not_cleared"
CLEARANCE_WAIVED = "waived"
CLEARANCE_NOT_REQUIRED = "not_required"
CLEARANCE_STATUSES = (
    CLEARANCE_PENDING,
    CLEARANCE_IN_PROGRESS,
    CLEARANCE_CLEARED,
    CLEARANCE_NOT_CLEARED,
    CLEARANCE_WAIVED,
    CLEARANCE_NOT_REQUIRED,
)

# --- Notifications -----------------------------------------------------------
NOTIFICATION_TYPES = (
    "maturity_upcoming",
    "matured_no_application",
    "application_overdue",
    "clearance_overdue",
    "escalation",
    "discrepancy_flagged",
    "document_missing",
    "application_assigned",
    "application_status_change",
    "correction_requested",
)

CHANNEL_IN_APP = "in_app"
CHANNEL_EMAIL = "email"

DELIVERY_PENDING = "pending"
DELIVERY_SENT = "sent"
DELIVERY_FAILED = "failed"
DELIVERY_IN_APP_ONLY = "in_app_only"
DELIVERY_STATUSES = (DELIVERY_PENDING, DELIVERY_SENT, DELIVERY_FAILED, DELIVERY_IN_APP_ONLY)

# --- Monitoring categories ---------------------------------------------------
CAT_UPCOMING = "upcoming_maturity"
CAT_MATURED_NO_APP = "matured_no_application"
CAT_APP_SUBMITTED = "application_submitted"
CAT_APP_VERIFICATION = "application_under_verification"
CAT_APP_CLEARANCE = "application_awaiting_clearance"
CAT_APP_AUTHORITY = "application_awaiting_authority"
CAT_RELEASE_PROCESSING = "release_processing"
CAT_COMPLETED = "completed"
CAT_ON_HOLD = "on_hold_or_ineligible"
CAT_ACTIVE = "active_not_near_maturity"
CAT_EXCLUDED = "excluded_inactive"

MONITORING_CATEGORIES = (
    CAT_UPCOMING,
    CAT_MATURED_NO_APP,
    CAT_APP_SUBMITTED,
    CAT_APP_VERIFICATION,
    CAT_APP_CLEARANCE,
    CAT_APP_AUTHORITY,
    CAT_RELEASE_PROCESSING,
    CAT_COMPLETED,
    CAT_ON_HOLD,
    CAT_ACTIVE,
    CAT_EXCLUDED,
)

MONITORING_LABELS = {
    CAT_UPCOMING: "Upcoming maturity",
    CAT_MATURED_NO_APP: "Matured, no release application recorded",
    CAT_APP_SUBMITTED: "Release application submitted",
    CAT_APP_VERIFICATION: "Application under verification",
    CAT_APP_CLEARANCE: "Application awaiting required clearance",
    CAT_APP_AUTHORITY: "Application awaiting competent-authority decision",
    CAT_RELEASE_PROCESSING: "Release processing",
    CAT_COMPLETED: "Completed / resolved",
    CAT_ON_HOLD: "On hold or ineligible (recorded requirements)",
    CAT_ACTIVE: "Active, not near maturity",
    CAT_EXCLUDED: "Excluded (archived, renewed or replaced)",
}

# --- System settings keys ----------------------------------------------------
SETTING_MATURITY_THRESHOLDS = "maturity_threshold_days"
SETTING_ESCALATION_AFTER_MATURITY = "escalation_days_after_maturity"
SETTING_CLEARANCE_ESCALATION_DAYS = "clearance_escalation_days"
SETTING_REMINDER_FREQUENCY_DAYS = "reminder_frequency_days"
SETTING_ALLOWED_FILE_TYPES = "allowed_file_types"
SETTING_MAX_UPLOAD_MB = "max_upload_mb"
SETTING_OVERDUE_STAGE_DAYS = "overdue_stage_days"
SETTING_TIMEZONE = "timezone"

DEFAULT_SYSTEM_SETTINGS: dict[str, object] = {
    SETTING_MATURITY_THRESHOLDS: [90, 30, 7],
    SETTING_ESCALATION_AFTER_MATURITY: 7,
    SETTING_CLEARANCE_ESCALATION_DAYS: 10,
    SETTING_REMINDER_FREQUENCY_DAYS: 7,
    SETTING_ALLOWED_FILE_TYPES: ["application/pdf", "image/png", "image/jpeg"],
    SETTING_MAX_UPLOAD_MB: 10,
    SETTING_OVERDUE_STAGE_DAYS: 15,
    SETTING_TIMEZONE: "Asia/Kolkata",
}

SETTING_DESCRIPTIONS: dict[str, str] = {
    SETTING_MATURITY_THRESHOLDS: "Days before maturity at which reminders are generated (demonstration defaults).",
    SETTING_ESCALATION_AFTER_MATURITY: "Days after maturity before a non-applicant case is escalated.",
    SETTING_CLEARANCE_ESCALATION_DAYS: "Days a clearance may remain pending before escalation.",
    SETTING_REMINDER_FREQUENCY_DAYS: "Minimum days between repeated reminders for the same FDR.",
    SETTING_ALLOWED_FILE_TYPES: "MIME types accepted for document upload.",
    SETTING_MAX_UPLOAD_MB: "Maximum upload size in megabytes.",
    SETTING_OVERDUE_STAGE_DAYS: "Days in a workflow stage before a case counts as overdue.",
    SETTING_TIMEZONE: "Application timezone used for all scheduled jobs.",
}
