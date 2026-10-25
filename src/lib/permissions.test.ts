import { describe, expect, it } from 'vitest';
import { can, homeRoute, isReviewer, isStaff } from './permissions';

describe('role capability matrix', () => {
  it('grants administrators every capability', () => {
    expect(can('system_admin', 'manage_users')).toBe(true);
    expect(can('system_admin', 'manage_institutions')).toBe(true);
    expect(can('system_admin', 'manage_settings')).toBe(true);
    expect(can('system_admin', 'verify_fdr')).toBe(true);
  });

  it('lets officers review but not administer', () => {
    expect(can('aicte_officer', 'verify_fdr')).toBe(true);
    expect(can('aicte_officer', 'review_discrepancy')).toBe(true);
    expect(can('aicte_officer', 'decide_application')).toBe(true);
    expect(can('aicte_officer', 'manage_users')).toBe(false);
    expect(can('aicte_officer', 'manage_settings')).toBe(false);
    expect(can('aicte_officer', 'archive_fdr')).toBe(false);
  });

  it('restricts institution users to their own submissions', () => {
    expect(can('institution_user', 'create_fdr')).toBe(true);
    expect(can('institution_user', 'upload_document')).toBe(true);
    expect(can('institution_user', 'submit_application')).toBe(true);
    expect(can('institution_user', 'verify_fdr')).toBe(false);
    expect(can('institution_user', 'decide_application')).toBe(false);
    expect(can('institution_user', 'view_all_records')).toBe(false);
    expect(can('institution_user', 'manage_users')).toBe(false);
  });

  it('never lets auditors modify anything', () => {
    expect(can('read_only_auditor', 'export_reports')).toBe(true);
    expect(can('read_only_auditor', 'view_audit_all')).toBe(true);
    expect(can('read_only_auditor', 'edit_fdr')).toBe(false);
    expect(can('read_only_auditor', 'verify_fdr')).toBe(false);
    expect(can('read_only_auditor', 'seed_demo_data')).toBe(false);
  });

  it('denies everything when no role is known', () => {
    expect(can(null, 'view_all_records')).toBe(false);
    expect(can(undefined, 'export_reports')).toBe(false);
  });
});

describe('role grouping helpers', () => {
  it('identifies staff and reviewers', () => {
    expect(isStaff('read_only_auditor')).toBe(true);
    expect(isStaff('institution_user')).toBe(false);
    expect(isReviewer('aicte_officer')).toBe(true);
    expect(isReviewer('read_only_auditor')).toBe(false);
  });

  it('sends institution users to the registry', () => {
    expect(homeRoute('institution_user')).toBe('/fdrs');
    expect(homeRoute('system_admin')).toBe('/');
  });
});
