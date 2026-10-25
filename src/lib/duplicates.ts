import type { Severity } from './types.js';

/**
 * Duplicate *detection* only. Nothing here merges or deletes: a human decides
 * whether two instruments are genuinely the same. Exact reference duplicates
 * are also blocked by a per-institution unique index in the database.
 */

export interface DuplicateTarget {
  id?: string;
  fdr_reference_number: string;
  issuing_bank: string;
  deposit_amount: number | string | null;
  issue_date?: string | null;
  maturity_date?: string | null;
}

export interface DuplicateCandidate {
  record: DuplicateTarget;
  reason: string;
  severity: Severity;
  score: number;
}

const REFERENCE_NOISE = /[^A-Z0-9]/g;

export function normalizeReference(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(REFERENCE_NOISE, '');
}

function normalizeBank(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\b(limited|ltd|bank|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
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

function amountOf(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Compares a candidate record against already-registered records of the same
 * institution and explains each match.
 */
export function findLikelyDuplicates(
  target: DuplicateTarget,
  existing: DuplicateTarget[],
): DuplicateCandidate[] {
  const targetReference = normalizeReference(target.fdr_reference_number);
  const targetBank = normalizeBank(target.issuing_bank);
  const targetAmount = amountOf(target.deposit_amount);
  const candidates: DuplicateCandidate[] = [];

  for (const record of existing) {
    if (record.id && target.id && record.id === target.id) continue;
    const reference = normalizeReference(record.fdr_reference_number);
    if (!reference) continue;
    const recordBank = normalizeBank(record.issuing_bank);
    const recordAmount = amountOf(record.deposit_amount);

    if (targetReference && reference === targetReference) {
      candidates.push({
        record,
        reason: 'An FDR with the same reference number already exists for this institution.',
        severity: 'critical',
        score: 1,
      });
      continue;
    }

    const distance = targetReference ? editDistance(targetReference, reference) : Number.POSITIVE_INFINITY;
    if (targetReference && distance > 0 && distance <= 2 && reference.length > 5) {
      candidates.push({
        record,
        reason: `The reference number differs by ${distance} character${distance === 1 ? '' : 's'} from an existing record.`,
        severity: 'warning',
        score: 1 - distance / Math.max(reference.length, targetReference.length),
      });
      continue;
    }

    const sameBank = !!targetBank && targetBank === recordBank;
    const sameAmount = targetAmount !== null && recordAmount !== null && Math.abs(targetAmount - recordAmount) < 0.01;
    const sameMaturity = !!target.maturity_date && target.maturity_date === record.maturity_date;
    if (sameBank && sameAmount && (sameMaturity || (!!target.issue_date && target.issue_date === record.issue_date))) {
      candidates.push({
        record,
        reason: 'An existing record has the same bank, amount and date. This may be the same instrument registered twice.',
        severity: 'warning',
        score: 0.8,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}
