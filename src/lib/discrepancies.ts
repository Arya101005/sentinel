/**
 * Deterministic verification rules (Module D).
 *
 * Every rule is explainable: it names the field, the submitted value, the
 * comparison value and a plain-language reason. Rules never claim that an FDR
 * is authentic — they only describe inconsistencies a human should review.
 */

import { daysUntil, todayInPolicyZone } from './maturity';
import { findLikelyDuplicates, type DuplicateCandidate, type DuplicateTarget } from './duplicates';

export type Severity = 'info' | 'warning' | 'critical';

export interface OcrFields {
  fdr_reference_number?: string | null;
  issuing_bank?: string | null;
  branch_name?: string | null;
  deposit_amount?: string | null;
  issue_date?: string | null;
  maturity_date?: string | null;
  institution_name?: string | null;
}

export interface OcrSnapshot {
  fields: OcrFields;
  average_confidence?: number | null;
  engine?: string;
}

export interface FdrSnapshot extends DuplicateTarget {
  institution_id?: string;
  institution_name?: string;
  branch_name?: string | null;
  has_current_document: boolean;
  ocr?: OcrSnapshot | null;
  candidates?: DuplicateCandidate[];
}

export interface DetectedFlag {
  rule_code: string;
  field_name: string;
  severity: Severity;
  submitted_value: string | null;
  compared_value: string | null;
  explanation: string;
}

export const RULE_LABELS: Record<string, string> = {
  REQUIRED_FIELD: 'Required field missing',
  INVALID_AMOUNT: 'Invalid deposit amount',
  DATE_ORDER: 'Maturity before issue date',
  TENURE_IMPLAUSIBLE: 'Implausible tenure',
  DUPLICATE_SUSPECT: 'Possibly duplicate record',
  MISSING_DOCUMENT: 'Supporting document missing',
  OCR_REFERENCE_MISMATCH: 'OCR reference does not match submission',
  OCR_BANK_MISMATCH: 'OCR bank does not match submission',
  OCR_AMOUNT_MISMATCH: 'OCR amount does not match submission',
  OCR_DATE_MISMATCH: 'OCR date does not match submission',
  OCR_BRANCH_MISMATCH: 'OCR branch does not match submission',
  OCR_LOW_CONFIDENCE: 'Low OCR confidence',
  OCR_FIELDS_MISSING: 'OCR could not read required fields',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\b(limited|ltd|pvt|private|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeReference(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export function textSimilarity(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function money(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatAmount(value: number | null): string | null {
  if (value === null) return null;
  return value.toFixed(2);
}

/**
 * Runs every deterministic rule and returns flags in a stable order.
 */
export function detectDiscrepancies(input: FdrSnapshot, today = todayInPolicyZone()): DetectedFlag[] {
  const flags: DetectedFlag[] = [];
  const push = (flag: DetectedFlag) => flags.push(flag);

  // --- Required fields -----------------------------------------------------
  const required: Array<[keyof FdrSnapshot, string, string]> = [
    ['fdr_reference_number', 'fdr_reference_number', 'FDR reference number'],
    ['issuing_bank', 'issuing_bank', 'Issuing bank'],
    ['issue_date', 'issue_date', 'Issue date'],
    ['maturity_date', 'maturity_date', 'Maturity date'],
    ['institution_id', 'institution_id', 'Institution'],
  ];
  for (const [key, field, label] of required) {
    const raw = input[key];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (!value) {
      push({
        rule_code: 'REQUIRED_FIELD',
        field_name: field,
        severity: 'warning',
        submitted_value: null,
        compared_value: null,
        explanation: `${label} is required before this record can be verified.`,
      });
    }
  }
  if (input.deposit_amount === null || input.deposit_amount === undefined || Number.isNaN(Number(input.deposit_amount))) {
    push({
      rule_code: 'REQUIRED_FIELD',
      field_name: 'deposit_amount',
      severity: 'warning',
      submitted_value: null,
      compared_value: null,
      explanation: 'Deposit amount is required before this record can be verified.',
    });
  } else if (Number(input.deposit_amount) <= 0) {
    push({
      rule_code: 'INVALID_AMOUNT',
      field_name: 'deposit_amount',
      severity: 'critical',
      submitted_value: String(input.deposit_amount),
      compared_value: '> 0',
      explanation: 'A security deposit amount must be greater than zero.',
    });
  }

  // --- Dates ---------------------------------------------------------------
  const submittedIssue = input.issue_date ?? null;
  const submittedMaturity = input.maturity_date ?? null;
  const issueValid = !!submittedIssue && ISO_DATE.test(submittedIssue);
  const maturityValid = !!submittedMaturity && ISO_DATE.test(submittedMaturity);
  if (issueValid && maturityValid && submittedIssue && submittedMaturity) {
    const tenureDays = daysUntil(submittedMaturity, submittedIssue);
    if (tenureDays <= 0) {
      push({
        rule_code: 'DATE_ORDER',
        field_name: 'maturity_date',
        severity: 'critical',
        submitted_value: submittedMaturity,
        compared_value: submittedIssue,
        explanation: 'The maturity date must fall after the issue date.',
      });
    } else if (tenureDays > 365 * 20) {
      push({
        rule_code: 'TENURE_IMPLAUSIBLE',
        field_name: 'maturity_date',
        severity: 'info',
        submitted_value: submittedMaturity,
        compared_value: submittedIssue,
        explanation: `The implied tenure is ${Math.round(tenureDays / 365)} years, which is unusually long for an FDR. Please confirm the dates.`,
      });
    } else if (tenureDays < 7) {
      push({
        rule_code: 'TENURE_IMPLAUSIBLE',
        field_name: 'maturity_date',
        severity: 'info',
        submitted_value: submittedMaturity,
        compared_value: submittedIssue,
        explanation: `The implied tenure is only ${tenureDays} day(s). Bank FDR tenures are normally longer; please confirm the dates.`,
      });
    }
    if (submittedIssue > today) {
      push({
        rule_code: 'TENURE_IMPLAUSIBLE',
        field_name: 'issue_date',
        severity: 'info',
        submitted_value: submittedIssue,
        compared_value: today,
        explanation: 'The issue date is in the future. Confirm this is not a tentative renewal date.',
      });
    }
  }

  // --- Duplicate / similar records ----------------------------------------
  const candidates = input.candidates ?? [];
  for (const candidate of candidates) {
    push({
      rule_code: 'DUPLICATE_SUSPECT',
      field_name: 'fdr_reference_number',
      severity: candidate.severity,
      submitted_value: input.fdr_reference_number ?? null,
      compared_value: candidate.record.fdr_reference_number,
      explanation: `${candidate.reason} (record ${candidate.record.fdr_reference_number}, ${candidate.record.issuing_bank}). Records are never merged automatically — confirm whether these are the same instrument.`,
    });
  }

  // --- Supporting document -------------------------------------------------
  if (!input.has_current_document) {
    push({
      rule_code: 'MISSING_DOCUMENT',
      field_name: 'document',
      severity: 'warning',
      submitted_value: null,
      compared_value: null,
      explanation: 'No current FDR document is attached. Upload the receipt before an officer can verify the instrument.',
    });
  }

  // --- OCR comparisons -----------------------------------------------------
  if (input.ocr) {
    const fields = input.ocr.fields ?? {};
    const reference = fields.fdr_reference_number;
    if (reference && normalizeReference(reference) !== normalizeReference(input.fdr_reference_number)) {
      push({
        rule_code: 'OCR_REFERENCE_MISMATCH',
        field_name: 'fdr_reference_number',
        severity: 'critical',
        submitted_value: input.fdr_reference_number ?? null,
        compared_value: reference,
        explanation: 'The reference number read from the document differs from the submitted value. Compare the document and correct whichever value is wrong.',
      });
    }

    const bank = fields.issuing_bank;
    if (bank && textSimilarity(bank, input.issuing_bank) < 0.75) {
      push({
        rule_code: 'OCR_BANK_MISMATCH',
        field_name: 'issuing_bank',
        severity: 'warning',
        submitted_value: input.issuing_bank ?? null,
        compared_value: bank,
        explanation: 'The bank name read from the document does not closely match the submitted bank. Check the receipt letterhead.',
      });
    }

    const ocrAmount = money(fields.deposit_amount);
    const submittedAmount = money(input.deposit_amount);
    if (ocrAmount !== null && submittedAmount !== null && Math.abs(ocrAmount - submittedAmount) > 0.5) {
      push({
        rule_code: 'OCR_AMOUNT_MISMATCH',
        field_name: 'deposit_amount',
        severity: 'critical',
        submitted_value: formatAmount(submittedAmount),
        compared_value: formatAmount(ocrAmount),
        explanation: 'The deposit amount read from the document differs from the submitted amount by more than ₹0.50.',
      });
    }

    const datePairs: Array<[keyof OcrFields, keyof FdrSnapshot, string]> = [
      ['issue_date', 'issue_date', 'Issue date'],
      ['maturity_date', 'maturity_date', 'Maturity date'],
    ];
    for (const [ocrKey, fdrKey, label] of datePairs) {
      const ocrValue = fields[ocrKey];
      const submitted = input[fdrKey];
      if (ocrValue && submitted && ocrValue !== submitted) {
        push({
          rule_code: 'OCR_DATE_MISMATCH',
          field_name: String(fdrKey),
          severity: 'warning',
          submitted_value: String(submitted),
          compared_value: ocrValue,
          explanation: `The ${label.toLowerCase()} read from the document differs from the submitted value. A transposed day/month is the usual cause.`,
        });
      }
    }

    const branch = fields.branch_name;
    if (branch && input.branch_name && textSimilarity(branch, input.branch_name) < 0.7) {
      push({
        rule_code: 'OCR_BRANCH_MISMATCH',
        field_name: 'branch_name',
        severity: 'info',
        submitted_value: input.branch_name,
        compared_value: branch,
        explanation: 'The branch read from the document differs from the submitted branch.',
      });
    }

    const confidence = input.ocr.average_confidence ?? null;
    if (confidence !== null && confidence < 60) {
      push({
        rule_code: 'OCR_LOW_CONFIDENCE',
        field_name: 'document',
        severity: 'info',
        submitted_value: String(Math.round(confidence)),
        compared_value: '60',
        explanation: 'Average OCR confidence is below 60%. Treat every extracted value as unconfirmed and check the document image itself.',
      });
    }

    const missingOcrFields = ['fdr_reference_number', 'deposit_amount', 'maturity_date'].filter(
      (key) => !fields[key as keyof OcrFields],
    );
    if (missingOcrFields.length > 0) {
      push({
        rule_code: 'OCR_FIELDS_MISSING',
        field_name: 'document',
        severity: 'info',
        submitted_value: missingOcrFields.join(', '),
        compared_value: null,
        explanation:
          'OCR could not read every core field. Enter the missing values manually and confirm them against the document; the upload itself is preserved.',
      });
    }
  }

  return dedupeFlags(flags);
}

function dedupeFlags(flags: DetectedFlag[]): DetectedFlag[] {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    const key = `${flag.rule_code}::${flag.field_name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countBySeverity(flags: DetectedFlag[]): Record<Severity, number> {
  return flags.reduce(
    (accumulator, flag) => ({ ...accumulator, [flag.severity]: accumulator[flag.severity] + 1 }),
    { info: 0, warning: 0, critical: 0 } as Record<Severity, number>,
  );
}

/** Re-export so callers can run duplicate detection and rules in one pass. */
export { findLikelyDuplicates };
