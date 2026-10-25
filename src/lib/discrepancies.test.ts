import { describe, expect, it } from 'vitest';
import { detectDiscrepancies, textSimilarity, type FdrSnapshot } from './discrepancies';

const TODAY = '2026-03-15';

const base: FdrSnapshot = {
  id: 'fdr-1',
  fdr_reference_number: 'SBI/FDR/2024/00123',
  issuing_bank: 'State Bank of India',
  branch_name: 'Hauz Khas',
  deposit_amount: 1500000,
  issue_date: '2025-03-01',
  maturity_date: '2026-03-01',
  has_current_document: true,
  candidates: [],
  institution_id: 'inst-1',
};

function codes(input: FdrSnapshot) {
  return detectDiscrepancies(input, TODAY).map((flag) => `${flag.rule_code}:${flag.field_name}`);
}

describe('required fields and amounts', () => {
  it('produces no flags for a clean record', () => {
    expect(detectDiscrepancies(base, TODAY)).toHaveLength(0);
  });

  it('flags missing required values', () => {
    const flags = detectDiscrepancies({ ...base, fdr_reference_number: '', issuing_bank: '   ' }, TODAY);
    expect(flags.map((flag) => flag.field_name)).toEqual(
      expect.arrayContaining(['fdr_reference_number', 'issuing_bank']),
    );
    expect(flags.every((flag) => flag.severity === 'warning')).toBe(true);
  });

  it('flags a non-positive amount as critical', () => {
    const flags = detectDiscrepancies({ ...base, deposit_amount: 0 }, TODAY);
    expect(flags[0]).toMatchObject({ rule_code: 'INVALID_AMOUNT', severity: 'critical' });
  });
});

describe('date rules', () => {
  it('flags maturity before issue date', () => {
    const flags = detectDiscrepancies({ ...base, issue_date: '2026-03-10', maturity_date: '2026-03-01' }, TODAY);
    expect(codes({ ...base, issue_date: '2026-03-10', maturity_date: '2026-03-01' })).toContain('DATE_ORDER:maturity_date');
    expect(flags[0].severity).toBe('critical');
  });

  it('flags an implausible tenure', () => {
    const flags = detectDiscrepancies({ ...base, issue_date: '2025-01-01', maturity_date: '2050-01-01' }, TODAY);
    expect(flags[0].rule_code).toBe('TENURE_IMPLAUSIBLE');
    expect(flags[0].severity).toBe('info');
  });
});

describe('OCR comparison rules', () => {
  it('flags an amount mismatch between the submission and the document', () => {
    const flags = detectDiscrepancies(
      {
        ...base,
        ocr: {
          fields: {
            fdr_reference_number: base.fdr_reference_number,
            issuing_bank: base.issuing_bank,
            deposit_amount: '5100000.00',
            issue_date: base.issue_date,
            maturity_date: base.maturity_date,
          },
          average_confidence: 72.6,
        },
      },
      TODAY,
    );
    const amountFlag = flags.find((flag) => flag.rule_code === 'OCR_AMOUNT_MISMATCH');
    expect(amountFlag).toBeDefined();
    expect(amountFlag?.severity).toBe('critical');
    expect(amountFlag?.submitted_value).toBe('1500000.00');
    expect(amountFlag?.compared_value).toBe('5100000.00');
    expect(amountFlag?.explanation).toMatch(/differs/i);
  });

  it('does not flag a matching OCR value', () => {
    const flags = detectDiscrepancies(
      {
        ...base,
        ocr: {
          fields: {
            fdr_reference_number: 'sbi/fdr/2024/00123',
            issuing_bank: 'State Bank of India',
            deposit_amount: '1,500,000.00',
            issue_date: base.issue_date,
            maturity_date: base.maturity_date,
          },
          average_confidence: 91,
        },
      },
      TODAY,
    );
    expect(flags).toHaveLength(0);
  });

  it('flags a reference mismatch', () => {
    const flags = detectDiscrepancies(
      { ...base, ocr: { fields: { fdr_reference_number: 'SBI/FDR/2024/9912' }, average_confidence: 80 } },
      TODAY,
    );
    const referenceFlag = flags.find((flag) => flag.rule_code === 'OCR_REFERENCE_MISMATCH');
    expect(referenceFlag).toBeDefined();
    expect(referenceFlag?.field_name).toBe('fdr_reference_number');
    expect(referenceFlag?.explanation).toContain('differs from the submitted value');
  });

  it('flags a mismatched date', () => {
    const flags = detectDiscrepancies(
      { ...base, ocr: { fields: { maturity_date: '2026-03-02' }, average_confidence: 80 } },
      TODAY,
    );
    expect(flags.map((flag) => flag.rule_code)).toContain('OCR_DATE_MISMATCH');
  });

  it('reports low confidence and unread fields as information, not conclusions', () => {
    const flags = detectDiscrepancies(
      { ...base, ocr: { fields: { fdr_reference_number: base.fdr_reference_number }, average_confidence: 41 } },
      TODAY,
    );
    const ruleCodes = flags.map((flag) => flag.rule_code);
    expect(ruleCodes).toContain('OCR_LOW_CONFIDENCE');
    expect(ruleCodes).toContain('OCR_FIELDS_MISSING');
    expect(flags.every((flag) => flag.severity === 'info')).toBe(true);
  });
});

describe('evidence and duplicates', () => {
  it('flags a missing supporting document', () => {
    const flags = detectDiscrepancies({ ...base, has_current_document: false }, TODAY);
    expect(flags[0]).toMatchObject({ rule_code: 'MISSING_DOCUMENT', severity: 'warning' });
  });

  it('surfaces likely duplicates without merging them', () => {
    const flags = detectDiscrepancies(
      {
        ...base,
        candidates: [
          {
            record: {
              id: 'fdr-2',
              fdr_reference_number: 'SBI/FDR/2024/00123',
              issuing_bank: 'State Bank of India',
              deposit_amount: 1500000,
              issue_date: '2025-03-01',
              maturity_date: '2026-03-01',
            },
            reason: 'An FDR with the same reference number already exists for this institution.',
            severity: 'critical',
            score: 1,
          },
        ],
      },
      TODAY,
    );
    expect(flags[0].rule_code).toBe('DUPLICATE_SUSPECT');
    expect(flags[0].explanation).toMatch(/never merged/i);
  });

  it('keeps one flag per rule and field', () => {
    const flags = detectDiscrepancies({ ...base, has_current_document: false, ocr: { fields: {} } }, TODAY);
    const keys = flags.map((flag) => `${flag.rule_code}:${flag.field_name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('text similarity', () => {
  it('treats punctuation and case as irrelevant', () => {
    expect(textSimilarity('State Bank of India', 'state bank of india')).toBe(1);
    expect(textSimilarity('HDFC Bank', 'HDFC Bank Ltd')).toBeGreaterThan(0.7);
    expect(textSimilarity('HDFC Bank', 'Punjab National Bank')).toBeLessThan(0.5);
  });
});
