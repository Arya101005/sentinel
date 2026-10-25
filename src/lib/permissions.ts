import type { Role } from './types';

/**
 * UI capability matrix. This is *presentation only* — every capability is also
 * enforced by RLS policies, database triggers, or SECURITY DEFINER functions.
 * A user who bypasses the UI gains nothing.
 */
export type Capability =
  | 'view_all_records'
  | 'view_audit_all'
  | 'manage_institutions'
  | 'manage_users'
  | 'manage_settings'
  | 'create_fdr'
  | 'edit_fdr'
  | 'archive_fdr'
  | 'upload_document'
  | 'verify_fdr'
  | 'review_discrepancy'
  | 'submit_application'
  | 'decide_application'
  | 'export_reports'
  | 'run_maturity_scan'
  | 'seed_demo_data';

const MATRIX: Record<Role, Capability[]> = {
  system_admin: [
    'view_all_records',
    'view_audit_all',
    'manage_institutions',
    'manage_users',
    'manage_settings',
    'create_fdr',
    'edit_fdr',
    'archive_fdr',
    'upload_document',
    'verify_fdr',
    'review_discrepancy',
    'submit_application',
    'decide_application',
    'export_reports',
    'run_maturity_scan',
    'seed_demo_data',
  ],
  aicte_officer: [
    'view_all_records',
    'create_fdr',
    'edit_fdr',
    'upload_document',
    'verify_fdr',
    'review_discrepancy',
    'decide_application',
    'export_reports',
  ],
  institution_user: ['create_fdr', 'edit_fdr', 'upload_document', 'submit_application', 'export_reports'],
  read_only_auditor: ['view_all_records', 'view_audit_all', 'export_reports'],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[role].includes(capability);
}

export function isStaff(role: Role | null | undefined): boolean {
  return role === 'system_admin' || role === 'aicte_officer' || role === 'read_only_auditor';
}

export function isReviewer(role: Role | null | undefined): boolean {
  return role === 'system_admin' || role === 'aicte_officer';
}

/** Landing route per role, so a fresh account never hits a dead end. */
export function homeRoute(role: Role | null | undefined): string {
  if (role === 'institution_user') return '/fdrs';
  return '/';
}
