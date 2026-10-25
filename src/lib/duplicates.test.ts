import { describe, expect, it } from 'vitest';
import { findLikelyDuplicates, normalizeReference } from './duplicates';

const existing = [
  {
    id: 'a',
    fdr_reference_number: 'SBI/FDR/2024/00123',
    issuing_bank: 'State Bank of India',
    deposit_amount: 1500000,
    issue_date: '2025-03-01',
    maturity_date: '2026-03-01',
  },
  {
    id: 'b',
    fdr_reference_number: 'HDFC/2024/7781',
    issuing_bank: 'HDFC Bank',
    deposit_amount: 500000,
    issue_date: '2025-04-01',
    maturity_date: '2026-04-01',
  },
];

describe('duplicate detection', () => {
  it('normalises punctuation and case', () => {
    expect(normalizeReference('sbi/fdr 2024-00123')).toBe('SBIFDR202400123');
  });

  it('detects an identical reference as critical', () => {
    const result = findLikelyDuplicates(
      { fdr_reference_number: 'SBI/FDR/2024/00123', issuing_bank: 'State Bank of India', deposit_amount: 1500000 },
      existing,
    );
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('critical');
    expect(result[0].record.id).toBe('a');
  });

  it('detects a one-character reference typo as a warning', () => {
    const result = findLikelyDuplicates(
      { fdr_reference_number: 'SBI/FDR/2024/00124', issuing_bank: 'State Bank of India', deposit_amount: 1500000 },
      existing,
    );
    expect(result[0].severity).toBe('warning');
    expect(result[0].reason).toMatch(/differs by 1 character/);
  });

  it('detects the same bank, amount and date as a possible re-registration', () => {
    const result = findLikelyDuplicates(
      {
        fdr_reference_number: 'HDFC/NEW/0001',
        issuing_bank: 'HDFC Bank Ltd',
        deposit_amount: 500000,
        maturity_date: '2026-04-01',
      },
      existing,
    );
    expect(result[0].record.id).toBe('b');
    expect(result[0].reason).toMatch(/same bank, amount and date/);
  });

  it('ignores the record itself when editing', () => {
    const result = findLikelyDuplicates(
      {
        id: 'a',
        fdr_reference_number: 'SBI/FDR/2024/00123',
        issuing_bank: 'State Bank of India',
        deposit_amount: 1500000,
      },
      existing,
    );
    expect(result).toHaveLength(0);
  });

  it('returns no candidate for a genuinely new instrument', () => {
    const result = findLikelyDuplicates(
      { fdr_reference_number: 'ICICI/2026/9999', issuing_bank: 'ICICI Bank', deposit_amount: 750000 },
      existing,
    );
    expect(result).toHaveLength(0);
  });
});
