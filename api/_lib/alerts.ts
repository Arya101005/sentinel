import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyMaturity,
  hasRecordedApplication,
  normalizeWarningDays,
  todayInPolicyZone,
  warningThresholdFor,
} from '../../src/lib/maturity.js';

export interface ScanRecord {
  id: string;
  institution_id: string;
  fdr_reference_number: string;
  issuing_bank: string;
  deposit_amount: number | string;
  maturity_date: string;
  validity_status: string;
  archived_at: string | null;
  verification_status: string;
  release_statuses: string[];
}

export interface ScanRecipient {
  id: string;
  role: string;
  institution_id: string | null;
}

export interface AlertCandidate {
  recipient_id: string;
  category: 'maturity_upcoming' | 'maturity_today' | 'matured_no_application';
  title: string;
  body: string;
  link: string;
  fdr_id: string;
  dedupe_key: string;
}

/**
 * Pure alert builder, unit tested. One alert per record/recipient/interval, with
 * a deterministic dedupe key so running the scan repeatedly never duplicates.
 */
export function buildMaturityAlerts(
  records: ScanRecord[],
  recipients: ScanRecipient[],
  today: string,
  warningDays: number[],
): AlertCandidate[] {
  const thresholds = normalizeWarningDays(warningDays);
  const alerts: AlertCandidate[] = [];

  for (const record of records) {
    if (record.archived_at || record.validity_status !== 'active') continue;

    const classification = classifyMaturity(
      {
        maturity_date: record.maturity_date,
        validity_status: 'active',
        archived_at: null,
        release_application_statuses: record.release_statuses,
      },
      today,
      thresholds,
    );

    const eligibleRecipients = recipients.filter(
      (recipient) =>
        (recipient.role === 'system_admin' || recipient.role === 'aicte_officer') ||
        (recipient.role === 'institution_user' && recipient.institution_id === record.institution_id),
    );

    for (const recipient of eligibleRecipients) {
      if (classification.state === 'matured_no_application') {
        alerts.push({
          recipient_id: recipient.id,
          category: 'matured_no_application',
          title: `Matured FDR with no recorded release application: ${record.fdr_reference_number}`,
          body: `${record.issuing_bank} · matured ${record.maturity_date}. No release application is recorded in FDR Sentinel. Confirm the current status with the institution; this is not a finding of non-compliance.`,
          link: `/fdrs/${record.id}`,
          fdr_id: record.id,
          dedupe_key: `matured-no-app:${record.id}:${recipient.id}:${record.maturity_date}`,
        });
        continue;
      }

      if (classification.state === 'due_today') {
        alerts.push({
          recipient_id: recipient.id,
          category: 'maturity_today',
          title: `FDR matures today: ${record.fdr_reference_number}`,
          body: `${record.issuing_bank} · maturity date ${record.maturity_date}. Record the release, renewal or replacement status when known.`,
          link: `/fdrs/${record.id}`,
          fdr_id: record.id,
          dedupe_key: `maturity-today:${record.id}:${recipient.id}:${record.maturity_date}`,
        });
        continue;
      }

      if (classification.state === 'approaching') {
        const threshold =
          warningThresholdFor(classification.daysToMaturity, thresholds) ?? thresholds[thresholds.length - 1];
        if (!hasRecordedApplication(record.release_statuses)) {
          alerts.push({
            recipient_id: recipient.id,
            category: 'maturity_upcoming',
            title: `FDR matures in ${classification.daysToMaturity} day(s): ${record.fdr_reference_number}`,
            body: `${record.issuing_bank} · maturity date ${record.maturity_date}. Inside the ${threshold}-day warning window.`,
            link: `/fdrs/${record.id}`,
            fdr_id: record.id,
            dedupe_key: `maturity-upcoming:${record.id}:${recipient.id}:${record.maturity_date}:${threshold}`,
          });
        }
      }
    }
  }

  return alerts;
}

export interface ScanSummary {
  evaluated: number;
  recipients: number;
  candidates: number;
  notifications_created: number;
  duplicates_skipped: number;
}

export async function runMaturityScan(admin: SupabaseClient, today = todayInPolicyZone()): Promise<ScanSummary> {
  const { data: settingsRow } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'maturity_warning_days')
    .maybeSingle();
  const warningDays = normalizeWarningDays(settingsRow?.value ?? [30, 15, 7]);

  const { data: fdrRows, error: fdrError } = await admin
    .from('fdr_records')
    .select(
      'id, institution_id, fdr_reference_number, issuing_bank, deposit_amount, maturity_date, validity_status, archived_at, verification_status, release_applications(application_type, status)',
    )
    .is('archived_at', null)
    .eq('validity_status', 'active')
    .limit(5000);
  if (fdrError) throw new Error(`Could not read FDR records: ${fdrError.message}`);

  const records: ScanRecord[] = (fdrRows ?? []).map((row) => {
    const applications = (row.release_applications ?? []) as Array<{ application_type: string; status: string }>;
    return {
      id: row.id,
      institution_id: row.institution_id,
      fdr_reference_number: row.fdr_reference_number,
      issuing_bank: row.issuing_bank,
      deposit_amount: row.deposit_amount,
      maturity_date: row.maturity_date,
      validity_status: row.validity_status,
      archived_at: row.archived_at,
      verification_status: row.verification_status,
      release_statuses: applications
        .filter((application) => application.application_type === 'release')
        .map((application) => application.status),
    };
  });

  const { data: profileRows, error: profileError } = await admin
    .from('profiles')
    .select('id, role, institution_id, is_active')
    .eq('is_active', true)
    .limit(5000);
  if (profileError) throw new Error(`Could not read profiles: ${profileError.message}`);

  const recipients: ScanRecipient[] = (profileRows ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    institution_id: row.institution_id,
  }));

  const candidates = buildMaturityAlerts(records, recipients, today, warningDays);

  let created = 0;
  if (candidates.length > 0) {
    // Insert in batches; unique dedupe_key makes the operation idempotent.
    for (let index = 0; index < candidates.length; index += 200) {
      const batch = candidates.slice(index, index + 200);
      const { data: inserted, error: insertError } = await admin
        .from('notifications')
        .upsert(
          batch.map((alert) => ({
            recipient_id: alert.recipient_id,
            category: alert.category,
            title: alert.title,
            body: alert.body,
            link: alert.link,
            fdr_id: alert.fdr_id,
            dedupe_key: alert.dedupe_key,
          })),
          { onConflict: 'dedupe_key', ignoreDuplicates: true },
        )
        .select('id');
      if (insertError) throw new Error(`Could not create notifications: ${insertError.message}`);
      created += (inserted ?? []).length;
    }
  }

  return {
    evaluated: records.length,
    recipients: recipients.length,
    candidates: candidates.length,
    notifications_created: created,
    duplicates_skipped: Math.max(0, candidates.length - created),
  };
}
