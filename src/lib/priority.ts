/**
 * Deterministic record prioritisation.
 *
 * Every point a record scores comes from an explicit, auditable rule and is
 * reported back as a human-readable reason. There is no model, no hidden
 * weighting and no risk score that an officer cannot reconstruct by hand.
 *
 * The weights live in one place (POINTS) so an administrator can reason about
 * them, and every threshold is covered by priority.test.ts.
 */

export type PriorityLevel = 'urgent' | 'high' | 'normal' | 'low';

export interface PriorityInput {
  /** Calendar days until maturity; negative means already matured. */
  daysToMaturity: number;
  /** True when no release application is recorded for a matured instrument. */
  maturedWithoutApplication: boolean;
  /** Number of discrepancy flags not yet resolved or accepted. */
  unresolvedFlags: number;
  /** Whether the record currently has an uploaded supporting document. */
  hasDocument: boolean;
  /** Whether a release or renewal request is still moving through the workflow. */
  pendingApplication: boolean;
  /** Officer verification status on the record. */
  verificationStatus: 'pending' | 'in_review' | 'verified' | 'flagged' | 'rejected';
  /** Warning intervals in days, widest first (for example [30, 15, 7]). */
  warningDays?: number[];
}

export interface PriorityResult {
  level: PriorityLevel;
  score: number;
  /** Ordered, human-readable explanations of every point scored. */
  reasons: string[];
}

export const POINTS = {
  maturedNoApplication: 60,
  maturedWithApplication: 30,
  dueToday: 40,
  withinSeven: 30,
  withinFifteen: 22,
  withinWidest: 15,
  perUnresolvedFlag: 8,
  unresolvedFlagCap: 24,
  missingDocument: 10,
  pendingApplication: 12,
  pendingVerification: 6,
  flaggedVerification: 10,
} as const;

const LEVEL_THRESHOLDS: Array<{ level: PriorityLevel; min: number }> = [
  { level: 'urgent', min: 60 },
  { level: 'high', min: 35 },
  { level: 'normal', min: 15 },
  { level: 'low', min: 0 },
];

export function levelForScore(score: number): PriorityLevel {
  return LEVEL_THRESHOLDS.find((entry) => score >= entry.min)?.level ?? 'low';
}

export function prioritise(input: PriorityInput): PriorityResult {
  const warningDays = (input.warningDays ?? [30, 15, 7]).slice().sort((a, b) => a - b);
  const reasons: string[] = [];
  let score = 0;

  if (input.daysToMaturity < 0) {
    const daysOverdue = Math.abs(input.daysToMaturity);
    if (input.maturedWithoutApplication) {
      score += POINTS.maturedNoApplication;
      reasons.push(
        `Matured ${daysOverdue} day(s) ago with no release application recorded in Sentinel (+${POINTS.maturedNoApplication}).`,
      );
    } else {
      score += POINTS.maturedWithApplication;
      reasons.push(
        `Matured ${daysOverdue} day(s) ago; an application is recorded and awaiting completion (+${POINTS.maturedWithApplication}).`,
      );
    }
  } else if (input.daysToMaturity === 0) {
    score += POINTS.dueToday;
    reasons.push(`Matures today (+${POINTS.dueToday}).`);
  } else if (input.daysToMaturity <= 7) {
    score += POINTS.withinSeven;
    reasons.push(`Matures in ${input.daysToMaturity} day(s), inside the 7-day window (+${POINTS.withinSeven}).`);
  } else if (input.daysToMaturity <= 15) {
    score += POINTS.withinFifteen;
    reasons.push(`Matures in ${input.daysToMaturity} day(s), inside the 15-day window (+${POINTS.withinFifteen}).`);
  } else {
    const widest = warningDays[warningDays.length - 1] ?? 30;
    if (input.daysToMaturity <= widest) {
      score += POINTS.withinWidest;
      reasons.push(
        `Matures in ${input.daysToMaturity} day(s), inside the ${widest}-day warning window (+${POINTS.withinWidest}).`,
      );
    }
  }

  if (input.unresolvedFlags > 0) {
    const points = Math.min(input.unresolvedFlags * POINTS.perUnresolvedFlag, POINTS.unresolvedFlagCap);
    score += points;
    reasons.push(
      `${input.unresolvedFlags} unresolved discrepancy flag(s) awaiting officer review (+${points}${points === POINTS.unresolvedFlagCap ? ', capped' : ''}).`,
    );
  }

  if (!input.hasDocument) {
    score += POINTS.missingDocument;
    reasons.push(`No supporting document uploaded yet (+${POINTS.missingDocument}).`);
  }

  if (input.pendingApplication) {
    score += POINTS.pendingApplication;
    reasons.push(`A release or renewal request is still in progress (+${POINTS.pendingApplication}).`);
  }

  if (input.verificationStatus === 'flagged') {
    score += POINTS.flaggedVerification;
    reasons.push(`Verification status is flagged for review (+${POINTS.flaggedVerification}).`);
  } else if (input.verificationStatus === 'pending' || input.verificationStatus === 'in_review') {
    score += POINTS.pendingVerification;
    reasons.push(`Verification is ${input.verificationStatus === 'pending' ? 'pending' : 'in progress'} (+${POINTS.pendingVerification}).`);
  }

  if (reasons.length === 0) reasons.push('No follow-up conditions detected — routine monitoring only.');

  return { level: levelForScore(score), score, reasons };
}

/** Statuses of a release/renewal application that are still moving through the workflow. */
export const PENDING_APPLICATION_STATUSES = new Set([
  'draft',
  'submitted',
  'under_review',
  'info_required',
  'resubmitted',
]);
