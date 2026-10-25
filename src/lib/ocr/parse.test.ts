import { describe, expect, it } from 'vitest';
import { normalizeDate, parseAmount, parseOcrText } from './parse';

describe('date normalisation', () => {
  it('handles Indian day-first formats', () => {
    expect(normalizeDate('12/03/2025')).toBe('2025-03-12');
    expect(normalizeDate('12-03-2025')).toBe('2025-03-12');
    expect(normalizeDate('12.03.25')).toBe('2025-03-12');
  });

  it('handles named months in both orders', () => {
    expect(normalizeDate('12 Mar 2025')).toBe('2025-03-12');
    expect(normalizeDate('12 March, 2025')).toBe('2025-03-12');
    expect(normalizeDate('Mar 12, 2025')).toBe('2025-03-12');
  });

  it('handles ISO dates', () => {
    expect(normalizeDate('2025-03-12')).toBe('2025-03-12');
  });

  it('swaps only when the day cannot come first', () => {
    expect(normalizeDate('03/25/2025')).toBe('2025-03-25');
    expect(normalizeDate('01/03/2025')).toBe('2025-03-01');
  });

  it('rejects impossible dates and junk', () => {
    expect(normalizeDate('31/02/2025')).toBeNull();
    expect(normalizeDate('not a date')).toBeNull();
    expect(normalizeDate('')).toBeNull();
  });
});

describe('amount parsing', () => {
  it('parses Indian digit grouping and currency prefixes', () => {
    expect(parseAmount('Rs. 15,00,000.00')).toBe('1500000.00');
    expect(parseAmount('₹ 5,10,000')).toBe('510000.00');
    expect(parseAmount('INR 2,500')).toBe('2500.00');
  });

  it('understands lakh and crore', () => {
    expect(parseAmount('1.5 lakh')).toBe('150000.00');
    expect(parseAmount('2 crore')).toBe('20000000.00');
  });

  it('returns null for junk or zero', () => {
    expect(parseAmount('no amount')).toBeNull();
    expect(parseAmount('Rs. 0')).toBeNull();
  });
});

describe('receipt parsing', () => {
  const text = [
    'STATE BANK OF INDIA',
    'Hauz Khas Branch, New Delhi',
    'FIXED DEPOSIT RECEIPT',
    'FDR No: SBI/FDR/2024/00123',
    'Deposit Amount: Rs. 15,00,000.00',
    'Date of Issue: 01/03/2025',
    'Maturity Date: 01/03/2026',
    'In favour of: Demo Institute of Technology, Delhi',
  ].join('\n');

  it('extracts the core fields', () => {
    const { fields } = parseOcrText(text);
    expect(fields.fdr_reference_number).toBe('SBI/FDR/2024/00123');
    expect(fields.issuing_bank).toMatch(/STATE BANK OF INDIA/);
    expect(fields.deposit_amount).toBe('1500000.00');
    expect(fields.issue_date).toBe('2025-03-01');
    expect(fields.maturity_date).toBe('2026-03-01');
    expect(fields.institution_name).toContain('Demo Institute of Technology');
  });

  it('computes per-field confidence from recognised words', () => {
    const { confidence } = parseOcrText(text, [
      { text: 'FDR', confidence: 90 },
      { text: 'No:', confidence: 80 },
      { text: 'SBI/FDR/2024/00123', confidence: 70 },
    ]);
    expect(confidence.fdr_reference_number).toBeGreaterThan(60);
  });

  it('leaves fields null instead of inventing values', () => {
    const { fields } = parseOcrText('A blurry scan with no useful values\nsecond line');
    expect(fields.fdr_reference_number).toBeNull();
    expect(fields.deposit_amount).toBeNull();
    expect(fields.maturity_date).toBeNull();
  });

  it('does not fabricate a maturity date earlier than the issue date', () => {
    const { fields } = parseOcrText('Date of Issue: 01/03/2026\nMaturity Date: 01/03/2025');
    expect(fields.issue_date).toBe('2025-03-01');
    expect(fields.maturity_date).toBe('2026-03-01');
  });

  it('extracts a reference that differs from the submitted value (candidate only)', () => {
    const { fields } = parseOcrText('FDR No: DMO/IDBI/2024/9912\nDeposit Amount: Rs. 6,25,000');
    expect(fields.fdr_reference_number).toBe('DMO/IDBI/2024/9912');
    expect(fields.deposit_amount).toBe('625000.00');
  });
});

describe('field provenance (source lines)', () => {
  const text = [
    'STATE BANK OF INDIA',
    'FIXED DEPOSIT RECEIPT',
    'FDR No: SBI/FDR/2024/00123',
    'Deposit Amount: Rs. 15,00,000.00',
    'Date of Issue: 01/03/2025',
    'Maturity Date: 01/03/2026',
  ].join('\n');

  it('records the document line each candidate value was read from', () => {
    const { sources } = parseOcrText(text);
    expect(sources.fdr_reference_number).toContain('FDR No');
    expect(sources.deposit_amount).toContain('Deposit Amount');
    expect(sources.issue_date).toContain('Date of Issue');
    expect(sources.maturity_date).toContain('Maturity Date');
  });

  it('keeps sources empty when nothing was extracted, instead of guessing', () => {
    const { sources, fields } = parseOcrText('a scan with no useful values at all');
    expect(fields.fdr_reference_number).toBeNull();
    expect(sources.fdr_reference_number).toBeNull();
    expect(sources.deposit_amount).toBeNull();
    expect(sources.maturity_date).toBeNull();
  });

  it('caps very long source lines so stored provenance stays readable', () => {
    const longLine = `FDR No: SBI/FDR/2024/00123 ${'word '.repeat(120)}`;
    const { sources } = parseOcrText(longLine);
    expect(sources.fdr_reference_number).not.toBeNull();
    expect((sources.fdr_reference_number as string).length).toBeLessThanOrEqual(240);
  });
});
