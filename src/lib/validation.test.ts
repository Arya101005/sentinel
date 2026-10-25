import { describe, expect, it } from 'vitest';
import {
  applicationSchema,
  fdrFormSchema,
  institutionSchema,
  MAX_DOCUMENT_BYTES,
  signupSchema,
  validateDocumentFile,
  warningDaysSchema,
} from './validation';

const validFdr = {
  institution_id: '2f1c4b9e-6a1a-4d6f-8a01-1b2c3d4e5f60',
  fdr_reference_number: 'SBI/FDR/2024/00123',
  issuing_bank: 'State Bank of India',
  branch_name: 'Hauz Khas',
  deposit_amount: '1500000.50',
  issue_date: '2025-03-01',
  maturity_date: '2026-03-01',
  notes: '',
};

describe('FDR form validation', () => {
  it('accepts a complete record and converts the amount to a number', () => {
    const parsed = fdrFormSchema.safeParse(validFdr);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deposit_amount).toBe(1500000.5);
      expect(parsed.data.branch_name).toBe('Hauz Khas');
      expect(parsed.data.notes).toBeUndefined();
    }
  });

  it('rejects a maturity date on or before the issue date', () => {
    const parsed = fdrFormSchema.safeParse({ ...validFdr, maturity_date: '2025-03-01' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['maturity_date']);
      expect(parsed.error.issues[0].message).toMatch(/after the issue date/);
    }
  });

  it('rejects non-positive and missing amounts', () => {
    expect(fdrFormSchema.safeParse({ ...validFdr, deposit_amount: '0' }).success).toBe(false);
    expect(fdrFormSchema.safeParse({ ...validFdr, deposit_amount: '' }).success).toBe(false);
    expect(fdrFormSchema.safeParse({ ...validFdr, deposit_amount: 'abc' }).success).toBe(false);
  });

  it('rejects a missing institution and malformed reference', () => {
    expect(fdrFormSchema.safeParse({ ...validFdr, institution_id: '' }).success).toBe(false);
    expect(fdrFormSchema.safeParse({ ...validFdr, fdr_reference_number: 'A' }).success).toBe(false);
    expect(fdrFormSchema.safeParse({ ...validFdr, fdr_reference_number: 'SBI#123' }).success).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    const parsed = fdrFormSchema.safeParse({ ...validFdr, issue_date: '2025-02-31' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an issue date far in the future', () => {
    const farFuture = `${new Date().getUTCFullYear() + 3}-01-01`;
    const parsed = fdrFormSchema.safeParse({ ...validFdr, issue_date: farFuture, maturity_date: `${new Date().getUTCFullYear() + 4}-01-01` });
    expect(parsed.success).toBe(false);
  });
});

describe('application validation', () => {
  it('requires a meaningful reason', () => {
    const base = { fdr_id: validFdr.institution_id, application_type: 'release' as const, reason: 'too short' };
    expect(applicationSchema.safeParse(base).success).toBe(false);
    expect(
      applicationSchema.safeParse({ ...base, reason: 'Deposit matured and the sponsored project has closed.' }).success,
    ).toBe(true);
  });

  it('accepts a blank optional amount', () => {
    const parsed = applicationSchema.safeParse({
      fdr_id: validFdr.institution_id,
      application_type: 'renewal',
      reason: 'Renewal requested because the deposit matured and must be continued.',
      amount_claimed: '',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.amount_claimed).toBeUndefined();
  });
});

describe('institution validation', () => {
  it('normalises nothing silently but validates codes and emails', () => {
    const base = {
      institution_code: 'NIT-TRICHY',
      institution_name: 'National Institute of Technology, Tiruchirappalli',
      institution_type: 'Engineering' as const,
      status: 'active' as const,
    };
    expect(institutionSchema.safeParse(base).success).toBe(true);
    expect(institutionSchema.safeParse({ ...base, institution_code: 'nit' }).success).toBe(false);
    expect(institutionSchema.safeParse({ ...base, contact_email: 'not-an-email' }).success).toBe(false);
    expect(institutionSchema.safeParse({ ...base, institution_type: 'Unknown' as never }).success).toBe(false);
  });
});

describe('account validation', () => {
  it('requires matching passwords', () => {
    const base = {
      full_name: 'Demo Officer',
      email: 'officer@aicte-india.org',
      password: 'strongpass1',
      confirm_password: 'different',
    };
    const parsed = signupSchema.safeParse(base);
    expect(parsed.success).toBe(false);
    expect(signupSchema.safeParse({ ...base, confirm_password: 'strongpass1' }).success).toBe(true);
  });
});

describe('warning interval validation', () => {
  it('rejects duplicates, out-of-range values and empty lists', () => {
    expect(warningDaysSchema.safeParse([30, 15, 7]).success).toBe(true);
    expect(warningDaysSchema.safeParse([30, 30]).success).toBe(false);
    expect(warningDaysSchema.safeParse([0]).success).toBe(false);
    expect(warningDaysSchema.safeParse([]).success).toBe(false);
    expect(warningDaysSchema.safeParse([500]).success).toBe(false);
  });
});

describe('document checks', () => {
  it('accepts supported types within the size limit', () => {
    expect(validateDocumentFile({ type: 'application/pdf', size: 1024, name: 'a.pdf' })).toBeNull();
    expect(validateDocumentFile({ type: 'image/jpeg', size: 1024, name: 'a.jpg' })).toBeNull();
  });

  it('rejects unsupported types, oversized files and empty files', () => {
    expect(validateDocumentFile({ type: 'text/plain', size: 1024, name: 'a.txt' })).toMatch(/Unsupported/);
    expect(validateDocumentFile({ type: 'application/pdf', size: MAX_DOCUMENT_BYTES + 1, name: 'a.pdf' })).toMatch(/10 MB/);
    expect(validateDocumentFile({ type: 'application/pdf', size: 0, name: 'a.pdf' })).toMatch(/empty/);
  });
});
