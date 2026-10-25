import { describe, expect, it } from 'vitest';
import {
  addDays,
  assertIsoDate,
  classifyMaturity,
  daysUntil,
  hasRecordedApplication,
  maturityBucket,
  normalizeWarningDays,
  todayInPolicyZone,
  warningThresholdFor,
} from './maturity';

const TODAY = '2026-03-15';

describe('policy timezone', () => {
  it('returns the IST calendar date, not the UTC date', () => {
    // 2026-03-15T20:00:00Z is 01:30 on 16 March in Asia/Kolkata.
    expect(todayInPolicyZone(new Date('2026-03-15T20:00:00Z'))).toBe('2026-03-16');
    // 2026-03-15T18:29:00Z is 23:59 on 15 March in Asia/Kolkata.
    expect(todayInPolicyZone(new Date('2026-03-15T18:29:00Z'))).toBe('2026-03-15');
  });

  it('rejects malformed date strings instead of silently coercing them', () => {
    expect(() => assertIsoDate('15-03-2026')).toThrow();
    expect(() => assertIsoDate('2026-02-31')).toThrow();
    expect(assertIsoDate('2026-02-28')).toBe('2026-02-28');
  });

  it('computes whole-day differences', () => {
    expect(daysUntil('2026-03-15', TODAY)).toBe(0);
    expect(daysUntil('2026-03-20', TODAY)).toBe(5);
    expect(daysUntil('2026-03-10', TODAY)).toBe(-5);
    expect(addDays(TODAY, 30)).toBe('2026-04-14');
    expect(addDays(TODAY, -1)).toBe('2026-03-14');
  });
});

describe('classifyMaturity', () => {
  const base = { maturity_date: TODAY, validity_status: 'active' as const, archived_at: null };

  it('classifies an approaching maturity inside the widest window', () => {
    const result = classifyMaturity({ ...base, maturity_date: '2026-03-25' }, TODAY, [30, 15, 7]);
    expect(result.state).toBe('approaching');
    expect(result.daysToMaturity).toBe(10);
    expect(result.requiresFollowUp).toBe(true);
  });

  it('classifies records outside the window as active', () => {
    const result = classifyMaturity({ ...base, maturity_date: '2026-12-01' }, TODAY, [30, 15, 7]);
    expect(result.state).toBe('active');
    expect(result.requiresFollowUp).toBe(false);
  });

  it('flags maturity today', () => {
    const result = classifyMaturity(base, TODAY, [30, 15, 7]);
    expect(result.state).toBe('due_today');
    expect(result.severity).toBe('warning');
  });

  it('flags a matured record without a recorded release application', () => {
    const result = classifyMaturity(
      { ...base, maturity_date: '2026-02-01', release_application_statuses: [] },
      TODAY,
    );
    expect(result.state).toBe('matured_no_application');
    expect(result.severity).toBe('danger');
    expect(result.requiresFollowUp).toBe(true);
  });

  it('does not flag a matured record that has a recorded application', () => {
    const result = classifyMaturity(
      { ...base, maturity_date: '2026-02-01', release_application_statuses: ['under_review'] },
      TODAY,
    );
    expect(result.state).toBe('matured_with_application');
    expect(result.requiresFollowUp).toBe(false);
  });

  it('ignores archived and closed instruments', () => {
    expect(classifyMaturity({ ...base, archived_at: '2026-01-01T00:00:00Z' }, TODAY).state).toBe('archived');
    expect(classifyMaturity({ ...base, validity_status: 'closed' }, TODAY).state).toBe('closed');
    expect(classifyMaturity({ ...base, validity_status: 'cancelled' }, TODAY).state).toBe('closed');
  });

  it('honours configurable warning windows', () => {
    const record = { ...base, maturity_date: '2026-04-20' }; // 36 days
    expect(classifyMaturity(record, TODAY, [30, 15, 7]).state).toBe('active');
    expect(classifyMaturity(record, TODAY, [60, 30, 7]).state).toBe('approaching');
  });
});

describe('warning windows and buckets', () => {
  it('normalises configured intervals', () => {
    expect(normalizeWarningDays([15, 30, 7, 30])).toEqual([30, 15, 7]);
    expect(normalizeWarningDays('nonsense')).toEqual([30, 15, 7]);
    expect(normalizeWarningDays([0, -5, 999])).toEqual([30, 15, 7]);
  });

  it('chooses the tightest applicable threshold', () => {
    expect(warningThresholdFor(6, [30, 15, 7])).toBe(7);
    expect(warningThresholdFor(10, [30, 15, 7])).toBe(15);
    expect(warningThresholdFor(25, [30, 15, 7])).toBe(30);
    expect(warningThresholdFor(45, [30, 15, 7])).toBeNull();
  });

  it('builds chart buckets', () => {
    expect(maturityBucket({ maturity_date: '2026-03-01', validity_status: 'active' }, TODAY)).toBe('matured');
    expect(maturityBucket({ maturity_date: TODAY, validity_status: 'active' }, TODAY)).toBe('today');
    expect(maturityBucket({ maturity_date: '2026-03-20', validity_status: 'active' }, TODAY)).toBe('0-7 days');
    expect(maturityBucket({ maturity_date: '2026-03-28', validity_status: 'active' }, TODAY)).toBe('8-15 days');
    expect(maturityBucket({ maturity_date: '2026-04-10', validity_status: 'active' }, TODAY)).toBe('16-30 days');
    expect(maturityBucket({ maturity_date: '2026-05-10', validity_status: 'active' }, TODAY)).toBe('31-90 days');
    expect(maturityBucket({ maturity_date: '2027-05-10', validity_status: 'active' }, TODAY)).toBe('over 90 days');
    expect(maturityBucket({ maturity_date: '2027-05-10', validity_status: 'closed' }, TODAY)).toBe('closed');
  });

  it('treats only real release applications as recorded', () => {
    expect(hasRecordedApplication(['submitted'])).toBe(true);
    expect(hasRecordedApplication(['completed'])).toBe(true);
    expect(hasRecordedApplication([])).toBe(false);
    expect(hasRecordedApplication(['withdrawn'])).toBe(false);
  });
});
