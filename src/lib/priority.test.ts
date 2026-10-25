import { describe, expect, it } from 'vitest';
import { levelForScore, POINTS, PENDING_APPLICATION_STATUSES, prioritise } from './priority';

const base = {
  daysToMaturity: 90,
  maturedWithoutApplication: false,
  unresolvedFlags: 0,
  hasDocument: true,
  pendingApplication: false,
  verificationStatus: 'verified' as const,
  warningDays: [30, 15, 7],
};

describe('prioritise', () => {
  it('scores a matured record without an application as urgent with a reason', () => {
    const result = prioritise({ ...base, daysToMaturity: -12, maturedWithoutApplication: true });
    expect(result.level).toBe('urgent');
    expect(result.score).toBeGreaterThanOrEqual(POINTS.maturedNoApplication);
    expect(result.reasons[0]).toContain('Matured 12 day(s) ago');
    expect(result.reasons[0]).toContain('no release application recorded in Sentinel');
  });

  it('scores a matured record with an application lower than one without', () => {
    const without = prioritise({ ...base, daysToMaturity: -5, maturedWithoutApplication: true, verificationStatus: 'pending' });
    const withApp = prioritise({ ...base, daysToMaturity: -5, maturedWithoutApplication: false, verificationStatus: 'pending' });
    expect(withApp.score).toBeLessThan(without.score);
    expect(withApp.reasons.join(' ')).toContain('application is recorded');
  });

  it('applies the documented warning-window points in order', () => {
    expect(prioritise({ ...base, daysToMaturity: 0 }).score).toBeGreaterThanOrEqual(POINTS.dueToday);
    expect(prioritise({ ...base, daysToMaturity: 3 }).score).toBeGreaterThanOrEqual(POINTS.withinSeven);
    expect(prioritise({ ...base, daysToMaturity: 10 }).score).toBeGreaterThanOrEqual(POINTS.withinFifteen);
    expect(prioritise({ ...base, daysToMaturity: 25 }).score).toBeGreaterThanOrEqual(POINTS.withinWidest);
    const far = prioritise({ ...base, daysToMaturity: 200 });
    expect(far.score).toBe(0);
    expect(far.level).toBe('low');
  });

  it('respects a custom widest warning interval', () => {
    const custom = prioritise({ ...base, daysToMaturity: 40, warningDays: [60, 45, 15] });
    expect(custom.score).toBeGreaterThanOrEqual(POINTS.withinWidest);
    expect(custom.reasons.join(' ')).toContain('60-day warning window');
  });

  it('caps unresolved-flag points at the documented maximum', () => {
    const two = prioritise({ ...base, unresolvedFlags: 2, verificationStatus: 'flagged' });
    const ten = prioritise({ ...base, unresolvedFlags: 10, verificationStatus: 'flagged' });
    expect(two.score - (two.score - 2 * POINTS.perUnresolvedFlag)).toBe(2 * POINTS.perUnresolvedFlag);
    expect(ten.reasons.join(' ')).toContain('capped');
    expect(ten.score - (ten.score - POINTS.unresolvedFlagCap)).toBeLessThanOrEqual(POINTS.unresolvedFlagCap);
  });

  it('adds points for a missing document, a pending application and verification state', () => {
    const nothing = prioritise(base);
    const missing = prioritise({ ...base, hasDocument: false });
    expect(missing.score - nothing.score).toBe(POINTS.missingDocument);

    const withApp = prioritise({ ...base, pendingApplication: true });
    expect(withApp.score - nothing.score).toBe(POINTS.pendingApplication);

    const pending = prioritise({ ...base, verificationStatus: 'pending' });
    expect(pending.score - nothing.score).toBe(POINTS.pendingVerification);

    const flagged = prioritise({ ...base, verificationStatus: 'flagged' });
    expect(flagged.score - nothing.score).toBe(POINTS.flaggedVerification);
  });

  it('always returns at least one reason', () => {
    const result = prioritise(base);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('maps scores to levels at the documented thresholds', () => {
    expect(levelForScore(100)).toBe('urgent');
    expect(levelForScore(60)).toBe('urgent');
    expect(levelForScore(59)).toBe('high');
    expect(levelForScore(35)).toBe('high');
    expect(levelForScore(34)).toBe('normal');
    expect(levelForScore(15)).toBe('normal');
    expect(levelForScore(14)).toBe('low');
    expect(levelForScore(0)).toBe('low');
  });

  it('classifies in-flight application statuses as pending', () => {
    expect(PENDING_APPLICATION_STATUSES.has('submitted')).toBe(true);
    expect(PENDING_APPLICATION_STATUSES.has('under_review')).toBe(true);
    expect(PENDING_APPLICATION_STATUSES.has('info_required')).toBe(true);
    expect(PENDING_APPLICATION_STATUSES.has('completed')).toBe(false);
    expect(PENDING_APPLICATION_STATUSES.has('rejected')).toBe(false);
  });
});
