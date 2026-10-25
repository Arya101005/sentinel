import { describe, expect, it } from 'vitest';
import { buildMaturityAlerts, type ScanRecord, type ScanRecipient } from './alerts';

const TODAY = '2026-03-15';

function record(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    id: 'fdr-1',
    institution_id: 'inst-a',
    fdr_reference_number: 'SBI/FDR/2024/00123',
    issuing_bank: 'State Bank of India',
    deposit_amount: 1500000,
    maturity_date: '2026-04-01',
    validity_status: 'active',
    archived_at: null,
    verification_status: 'pending',
    release_statuses: [],
    ...overrides,
  };
}

const recipients: ScanRecipient[] = [
  { id: 'admin-1', role: 'system_admin', institution_id: null },
  { id: 'officer-1', role: 'aicte_officer', institution_id: null },
  { id: 'inst-a-user', role: 'institution_user', institution_id: 'inst-a' },
  { id: 'inst-b-user', role: 'institution_user', institution_id: 'inst-b' },
  { id: 'auditor-1', role: 'read_only_auditor', institution_id: null },
];

describe('recipient scoping', () => {
  it('alerts staff and the owning institution, never other institutions or auditors', () => {
    const alerts = buildMaturityAlerts([record({ maturity_date: '2026-03-18' })], recipients, TODAY, [30, 15, 7]);
    const recipientsAlerted = alerts.map((alert) => alert.recipient_id).sort();
    expect(recipientsAlerted).toEqual(['admin-1', 'inst-a-user', 'officer-1']);
    expect(recipientsAlerted).not.toContain('inst-b-user');
    expect(recipientsAlerted).not.toContain('auditor-1');
  });
});

describe('maturity alerts', () => {
  it('creates an upcoming alert inside the warning window', () => {
    const alerts = buildMaturityAlerts([record({ maturity_date: '2026-03-20' })], recipients, TODAY, [30, 15, 7]);
    expect(alerts).toHaveLength(3);
    expect(alerts[0].category).toBe('maturity_upcoming');
    expect(alerts[0].title).toMatch(/matures in 5 day/i);
    expect(alerts[0].dedupe_key).toContain('2026-03-20:7');
  });

  it('does not alert outside the window', () => {
    const alerts = buildMaturityAlerts([record({ maturity_date: '2026-09-01' })], recipients, TODAY, [30, 15, 7]);
    expect(alerts).toHaveLength(0);
  });

  it('creates a maturity-today alert', () => {
    const alerts = buildMaturityAlerts([record({ maturity_date: TODAY })], recipients, TODAY, [30, 15, 7]);
    expect(alerts[0].category).toBe('maturity_today');
    expect(alerts[0].dedupe_key).toContain('maturity-today');
  });

  it('creates a matured-without-application alert and says it is not a finding of non-compliance', () => {
    const alerts = buildMaturityAlerts([record({ maturity_date: '2026-02-01' })], recipients, TODAY, [30, 15, 7]);
    expect(alerts[0].category).toBe('matured_no_application');
    expect(alerts[0].body).toMatch(/not a finding of non-compliance/i);
  });

  it('stops alerting once a release application is recorded', () => {
    const alerts = buildMaturityAlerts(
      [record({ maturity_date: '2026-02-01', release_statuses: ['under_review'] })],
      recipients,
      TODAY,
      [30, 15, 7],
    );
    expect(alerts).toHaveLength(0);

    const upcoming = buildMaturityAlerts(
      [record({ maturity_date: '2026-03-20', release_statuses: ['submitted'] })],
      recipients,
      TODAY,
      [30, 15, 7],
    );
    expect(upcoming).toHaveLength(0);
  });

  it('ignores archived, closed and cancelled records', () => {
    expect(buildMaturityAlerts([record({ archived_at: '2026-01-01' })], recipients, TODAY, [30, 15, 7])).toHaveLength(0);
    expect(buildMaturityAlerts([record({ validity_status: 'closed' })], recipients, TODAY, [30, 15, 7])).toHaveLength(0);
  });
});

describe('idempotency', () => {
  it('produces identical dedupe keys on repeated runs', () => {
    const input = [record({ maturity_date: '2026-03-18' }), record({ id: 'fdr-2', maturity_date: '2026-02-01' })];
    const first = buildMaturityAlerts(input, recipients, TODAY, [30, 15, 7]);
    const second = buildMaturityAlerts(input, recipients, TODAY, [30, 15, 7]);
    expect(first.map((alert) => alert.dedupe_key)).toEqual(second.map((alert) => alert.dedupe_key));
    expect(new Set(first.map((alert) => alert.dedupe_key)).size).toBe(first.length);
  });

  it('uses a distinct key per warning interval', () => {
    const thirty = buildMaturityAlerts([record({ maturity_date: '2026-04-10' })], recipients, TODAY, [30, 15, 7]);
    const fifteen = buildMaturityAlerts([record({ maturity_date: '2026-03-27' })], recipients, TODAY, [15, 7]);
    expect(thirty[0].dedupe_key).not.toBe(fifteen[0].dedupe_key);
  });

  it('links every alert to the record', () => {
    const alerts = buildMaturityAlerts([record({ maturity_date: '2026-02-01' })], recipients, TODAY, [30, 15, 7]);
    for (const alert of alerts) {
      expect(alert.link).toBe('/fdrs/fdr-1');
      expect(alert.fdr_id).toBe('fdr-1');
    }
  });
});
