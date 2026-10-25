export type Role = 'system_admin' | 'aicte_officer' | 'institution_user' | 'read_only_auditor';

export const ROLE_LABELS: Record<Role, string> = {
  system_admin: 'System Administrator',
  aicte_officer: 'AICTE Officer',
  institution_user: 'Institution User',
  read_only_auditor: 'Read-only Auditor',
};

export type VerificationStatus = 'pending' | 'in_review' | 'verified' | 'flagged' | 'rejected';
export type AdministrativeStatus =
  | 'registered'
  | 'under_review'
  | 'verified'
  | 'release_pending'
  | 'released'
  | 'renewed'
  | 'archived';
export type RenewalStatus = 'not_required' | 'due' | 'requested' | 'in_progress' | 'completed';
export type ValidityStatus = 'active' | 'closed' | 'cancelled';

export interface Institution {
  id: string;
  institution_code: string;
  institution_name: string;
  institution_type: string;
  region: string | null;
  address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: 'active' | 'inactive';
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  institution_id: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FdrRecord {
  id: string;
  institution_id: string;
  fdr_reference_number: string;
  issuing_bank: string;
  branch_name: string | null;
  deposit_amount: number;
  issue_date: string;
  maturity_date: string;
  validity_status: ValidityStatus;
  renewal_status: RenewalStatus;
  administrative_status: AdministrativeStatus;
  verification_status: VerificationStatus;
  notes: string | null;
  submitted_at: string;
  last_verified_at: string | null;
  archived_at: string | null;
  is_demo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  institutions?: Pick<Institution, 'id' | 'institution_name' | 'institution_code'> | null;
}

export type DocumentType = 'fdr_receipt' | 'renewal_receipt' | 'release_proof' | 'other';
export type OcrStatus = 'not_processed' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface FdrDocument {
  id: string;
  fdr_id: string;
  institution_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  document_type: DocumentType;
  is_current: boolean;
  ocr_status: OcrStatus;
  uploaded_by: string | null;
  uploaded_at: string;
  replaced_at: string | null;
}

export interface OcrExtraction {
  id: string;
  document_id: string;
  fdr_id: string;
  engine: string;
  status: 'completed' | 'failed';
  raw_text: string | null;
  fields: Record<string, string | null>;
  field_confidence: Record<string, number>;
  average_confidence: number | null;
  error_message: string | null;
  processed_by: string | null;
  created_at: string;
}

export type DiscrepancyStatus = 'open' | 'under_review' | 'resolved' | 'accepted';
export type Severity = 'info' | 'warning' | 'critical';

export interface DiscrepancyFlag {
  id: string;
  fdr_id: string;
  institution_id: string;
  rule_code: string;
  field_name: string;
  severity: Severity;
  submitted_value: string | null;
  compared_value: string | null;
  explanation: string;
  status: DiscrepancyStatus;
  reviewer_id: string | null;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  detected_at: string;
  created_at: string;
  updated_at: string;
  fdr_records?: Pick<FdrRecord, 'id' | 'fdr_reference_number' | 'issuing_bank'> & {
    institutions?: Pick<Institution, 'institution_name' | 'institution_code'> | null;
  };
}

export interface VerificationEvent {
  id: string;
  fdr_id: string;
  institution_id: string;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  observations: string | null;
  actor_id: string | null;
  created_at: string;
}

export type ApplicationType = 'release' | 'renewal';
export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'info_required'
  | 'resubmitted'
  | 'approved'
  | 'rejected'
  | 'completed';

export interface ReleaseApplication {
  id: string;
  application_no: string;
  fdr_id: string;
  institution_id: string;
  application_type: ApplicationType;
  status: ApplicationStatus;
  reason: string | null;
  amount_claimed: number | null;
  supporting_notes: string | null;
  requested_by: string | null;
  submitted_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  fdr_records?: Pick<FdrRecord, 'id' | 'fdr_reference_number' | 'issuing_bank' | 'maturity_date' | 'deposit_amount'> & {
    institutions?: Pick<Institution, 'institution_name' | 'institution_code'> | null;
  };
}

export interface ApplicationEvent {
  id: string;
  application_id: string;
  previous_status: string | null;
  new_status: string;
  note: string | null;
  actor_id: string | null;
  actor_role: string | null;
  created_at: string;
}

export type NotificationCategory =
  | 'maturity_upcoming'
  | 'maturity_today'
  | 'matured_no_application'
  | 'discrepancy'
  | 'missing_document'
  | 'renewal_deadline'
  | 'application_status'
  | 'verification';

export interface AppNotification {
  id: string;
  recipient_id: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  link: string | null;
  fdr_id: string | null;
  dedupe_key: string;
  is_read: boolean;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SystemSetting {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface DashboardSummary {
  today: string;
  warning_days: number[];
  total_records: number;
  active: number;
  approaching: number;
  maturing_today: number;
  matured: number;
  matured_no_release: number;
  pending_verification: number;
  flagged_records: number;
  open_flags: number;
  renewals_in_progress: number;
  releases_in_progress: number;
  applications_awaiting_review: number;
  unread_notifications: number;
  institutions: number;
  verification_breakdown: Record<string, number>;
  institution_breakdown: Array<{
    id: string;
    institution_code: string;
    institution_name: string;
    active: number;
    matured: number;
    flagged: number;
  }>;
  maturity_buckets: Array<{ bucket: string; c: number }>;
}
