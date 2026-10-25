/**
 * Maturity / monitoring classification (Module E).
 *
 * Policy: every "today" is the calendar date in Asia/Kolkata (IST), as stored
 * in system_settings.timezone. Dates in the database are DATE values with no
 * time component, so comparisons are made on ISO yyyy-mm-dd strings converted
 * to UTC midnights — never on local-time Date objects.
 *
 * Nothing here decides that an FDR is authentic, eligible for release, or that
 * an institution is in violation. It only classifies timing and paperwork so a
 * human can act.
 */

export const POLICY_TIMEZONE = 'Asia/Kolkata';
export const DEFAULT_WARNING_DAYS = [30, 15, 7];

export class DateFormatError extends Error {
  constructor(value: string) {
    super(`Invalid date: ${value}`);
    this.name = 'DateFormatError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string): string {
  if (!ISO_DATE.test(value)) throw new DateFormatError(value);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DateFormatError(value);
  }
  return value;
}

/** Today's date in the policy timezone as yyyy-mm-dd. */
export function todayInPolicyZone(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: POLICY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole days from `today` to `target` (negative when the target has passed). */
export function daysUntil(target: string, today: string): number {
  const targetMs = Date.parse(`${assertIsoDate(target)}T00:00:00Z`);
  const todayMs = Date.parse(`${assertIsoDate(today)}T00:00:00Z`);
  return Math.round((targetMs - todayMs) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${assertIsoDate(date)}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export type MaturityState =
  | 'archived'
  | 'closed'
  | 'matured_no_application'
  | 'matured_with_application'
  | 'due_today'
  | 'approaching'
  | 'active';

export interface MaturityInput {
  maturity_date: string;
  validity_status: 'active' | 'closed' | 'cancelled';
  archived_at?: string | null;
  /** Any release-type application that counts as "recorded". */
  release_application_statuses?: string[];
}

export interface MaturityResult {
  state: MaturityState;
  daysToMaturity: number;
  severity: 'neutral' | 'success' | 'warning' | 'danger';
  label: string;
  requiresFollowUp: boolean;
}

/** Applications that count as a recorded release application. */
export const RECORDED_RELEASE_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'info_required',
  'resubmitted',
  'approved',
  'completed',
];

export function hasRecordedApplication(statuses: string[] = []): boolean {
  return statuses.some((status) => RECORDED_RELEASE_STATUSES.includes(status));
}

export function normalizeWarningDays(input: unknown): number[] {
  if (!Array.isArray(input)) return [...DEFAULT_WARNING_DAYS];
  const days = input
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 365);
  if (days.length === 0) return [...DEFAULT_WARNING_DAYS];
  return [...new Set(days)].sort((a, b) => b - a);
}

export function classifyMaturity(
  input: MaturityInput,
  today: string,
  warningDays: number[] = DEFAULT_WARNING_DAYS,
): MaturityResult {
  const days = daysUntil(input.maturity_date, today);
  const warnings = normalizeWarningDays(warningDays);
  const widest = warnings[0] ?? 30;

  if (input.archived_at) {
    return {
      state: 'archived',
      daysToMaturity: days,
      severity: 'neutral',
      label: 'Archived',
      requiresFollowUp: false,
    };
  }

  if (input.validity_status !== 'active') {
    return {
      state: 'closed',
      daysToMaturity: days,
      severity: 'neutral',
      label: input.validity_status === 'cancelled' ? 'Cancelled' : 'Closed',
      requiresFollowUp: false,
    };
  }

  if (days < 0) {
    const recorded = hasRecordedApplication(input.release_application_statuses);
    return {
      state: recorded ? 'matured_with_application' : 'matured_no_application',
      daysToMaturity: days,
      severity: recorded ? 'neutral' : 'danger',
      label: recorded ? 'Matured — application recorded' : 'Matured — no release application',
      requiresFollowUp: !recorded,
    };
  }

  if (days === 0) {
    return {
      state: 'due_today',
      daysToMaturity: 0,
      severity: 'warning',
      label: 'Maturing today',
      requiresFollowUp: true,
    };
  }

  if (days <= widest) {
    return {
      state: 'approaching',
      daysToMaturity: days,
      severity: days <= Math.min(...warnings) ? 'warning' : 'success',
      label: `Matures in ${days} day${days === 1 ? '' : 's'}`,
      requiresFollowUp: days <= widest,
    };
  }

  return {
    state: 'active',
    daysToMaturity: days,
    severity: 'success',
    label: `Matures in ${days} days`,
    requiresFollowUp: false,
  };
}

export type MaturityBucket = 'matured' | 'today' | '0-7 days' | '8-15 days' | '16-30 days' | '31-90 days' | 'over 90 days' | 'closed';

export function maturityBucket(input: MaturityInput, today: string): MaturityBucket {
  if (input.archived_at || input.validity_status !== 'active') return 'closed';
  const days = daysUntil(input.maturity_date, today);
  if (days < 0) return 'matured';
  if (days === 0) return 'today';
  if (days <= 7) return '0-7 days';
  if (days <= 15) return '8-15 days';
  if (days <= 30) return '16-30 days';
  if (days <= 90) return '31-90 days';
  return 'over 90 days';
}

/** The highest warning threshold a given day falls into (for alerting). */
export function warningThresholdFor(days: number, warningDays: number[] = DEFAULT_WARNING_DAYS): number | null {
  const thresholds = normalizeWarningDays(warningDays).filter((d) => days <= d).sort((a, b) => a - b);
  return thresholds.length > 0 ? thresholds[0] : null;
}
