import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, todayInPolicyZone } from '../../src/lib/maturity.js';
import { detectDiscrepancies } from '../../src/lib/discrepancies.js';
import { findLikelyDuplicates } from '../../src/lib/duplicates.js';

type InstitutionSeed = {
  code: string;
  name: string;
  type: string;
  region: string;
  email: string;
  phone: string;
};

const INSTITUTIONS: InstitutionSeed[] = [
  { code: 'DMO-IITD', name: 'Demo Institute of Technology, Delhi', type: 'Engineering', region: 'Delhi', email: 'demo.iitd@example.edu.in', phone: '+91 11 0000 0001' },
  { code: 'DMO-NITW', name: 'Demo National Institute of Technology, Warangal', type: 'Engineering', region: 'Telangana', email: 'demo.nitw@example.edu.in', phone: '+91 87 0000 0002' },
  { code: 'DMO-VITP', name: 'Demo Institute of Technology, Pune', type: 'Engineering', region: 'Maharashtra', email: 'demo.vitp@example.edu.in', phone: '+91 20 0000 0003' },
  { code: 'DMO-SRISTI', name: 'Demo Sri Institute of Science and Technology', type: 'Engineering', region: 'Tamil Nadu', email: 'demo.sristi@example.edu.in', phone: '+91 44 0000 0004' },
  { code: 'DMO-IIMC', name: 'Demo Institute of Management, Chennai', type: 'Management', region: 'Tamil Nadu', email: 'demo.iimc@example.edu.in', phone: '+91 44 0000 0005' },
  { code: 'DMO-PHARM', name: 'Demo College of Pharmacy, Ahmedabad', type: 'Pharmacy', region: 'Gujarat', email: 'demo.pharm@example.edu.in', phone: '+91 79 0000 0006' },
  { code: 'DMO-ARCH', name: 'Demo School of Architecture, Bhopal', type: 'Architecture', region: 'Madhya Pradesh', email: 'demo.arch@example.edu.in', phone: '+91 75 0000 0007' },
  { code: 'DMO-HOTEL', name: 'Demo Institute of Hotel Management, Goa', type: 'Hotel Management', region: 'Goa', email: 'demo.hotel@example.edu.in', phone: '+91 83 0000 0008' },
];

interface RecordSeed {
  institution: string;
  reference: string;
  bank: string;
  branch: string | null;
  amount: number;
  issueOffset: number;
  maturityOffset: number;
  verification: 'pending' | 'in_review' | 'verified' | 'flagged' | 'rejected';
  administrative: 'registered' | 'under_review' | 'verified' | 'release_pending' | 'released' | 'renewed' | 'archived';
  renewal: 'not_required' | 'due' | 'requested' | 'in_progress' | 'completed';
  document: boolean;
  ocrAmount?: string;
  ocrReference?: string;
  notes?: string;
}

const RECORDS: RecordSeed[] = [
  {
    institution: 'DMO-IITD', reference: 'DMO/SBI/2024/0001', bank: 'State Bank of India', branch: 'Hauz Khas, New Delhi',
    amount: 2500000, issueOffset: -120, maturityOffset: 608, verification: 'verified', administrative: 'verified',
    renewal: 'not_required', document: true, notes: 'Scenario 1 — active FDR with valid dates and a verified document set.',
  },
  {
    institution: 'DMO-NITW', reference: 'DMO/HDFC/2024/0002', bank: 'HDFC Bank', branch: 'Hanamkonda, Warangal',
    amount: 1200000, issueOffset: -700, maturityOffset: 18, verification: 'pending', administrative: 'registered',
    renewal: 'due', document: true, notes: 'Scenario 2 — approaching maturity inside the warning window.',
  },
  {
    institution: 'DMO-VITP', reference: 'DMO/ICICI/2024/0003', bank: 'ICICI Bank', branch: 'Kothrud, Pune',
    amount: 750000, issueOffset: -365, maturityOffset: 0, verification: 'pending', administrative: 'registered',
    renewal: 'due', document: true, notes: 'Scenario 3 — matures today; follow-up required today.',
  },
  {
    institution: 'DMO-IITD', reference: 'DMO/AXIS/2023/0004', bank: 'Axis Bank', branch: 'Saket, New Delhi',
    amount: 500000, issueOffset: -1000, maturityOffset: -42, verification: 'pending', administrative: 'registered',
    renewal: 'due', document: true, notes: 'Scenario 4 — matured with no recorded release application.',
  },
  {
    institution: 'DMO-NITW', reference: 'DMO/BOI/2023/0005', bank: 'Bank of India', branch: 'Kazipet, Warangal',
    amount: 900000, issueOffset: -1200, maturityOffset: -75, verification: 'in_review', administrative: 'under_review',
    renewal: 'not_required', document: true, notes: 'Scenario 5 — matured with a release application under review.',
  },
  {
    institution: 'DMO-VITP', reference: 'DMO/PNB/2024/0006', bank: 'Punjab National Bank', branch: 'Camp, Pune',
    amount: 1500000, issueOffset: -160, maturityOffset: 200, verification: 'flagged', administrative: 'registered',
    renewal: 'not_required', document: true, ocrAmount: '5100000.00',
    notes: 'Scenario 6 — OCR-extracted amount differs from the submitted amount.',
  },
  {
    institution: 'DMO-SRISTI', reference: 'DMO/CANARA/2024/0007', bank: 'Canara Bank', branch: null,
    amount: 300000, issueOffset: -200, maturityOffset: 165, verification: 'pending', administrative: 'registered',
    renewal: 'not_required', document: false,
    notes: 'Scenario 7 — incomplete record: no document, no branch and no supporting evidence.',
  },
  {
    institution: 'DMO-IITD', reference: 'DMO/SBIN/2023/0008', bank: 'State Bank of India', branch: 'Dwarka, New Delhi',
    amount: 1800000, issueOffset: -1100, maturityOffset: -10, verification: 'in_review', administrative: 'under_review',
    renewal: 'in_progress', document: true, notes: 'Scenario 8 — renewal request in progress after maturity.',
  },
  {
    institution: 'DMO-NITW', reference: 'DMO/KOTAK/2024/0009', bank: 'Kotak Mahindra Bank', branch: 'Madhapur, Hyderabad',
    amount: 2200000, issueOffset: -500, maturityOffset: 45, verification: 'in_review', administrative: 'release_pending',
    renewal: 'requested', document: true, notes: 'Scenario 9 — release request awaiting officer review.',
  },
  {
    institution: 'DMO-VITP', reference: 'DMO/IDBI/2024/0010', bank: 'IDBI Bank', branch: 'Deccan Gymkhana, Pune',
    amount: 625000, issueOffset: -240, maturityOffset: 125, verification: 'flagged', administrative: 'registered',
    renewal: 'not_required', document: true, ocrReference: 'DMO/IDBI/2024/9912',
    notes: 'Scenario 10 — OCR reference differs from the submitted reference number.',
  },
  {
    institution: 'DMO-SRISTI', reference: 'DMO/UCO/2024/0011', bank: 'UCO Bank', branch: 'Adyar, Chennai',
    amount: 450000, issueOffset: -90, maturityOffset: 275, verification: 'verified', administrative: 'verified',
    renewal: 'not_required', document: true, notes: 'Scenario 11 — officer-verified against the uploaded document.',
  },
  {
    institution: 'DMO-IITD', reference: 'DMO/BOB/2024/7781', bank: 'Bank of Baroda', branch: 'Connaught Place, New Delhi',
    amount: 1100000, issueOffset: -60, maturityOffset: 400, verification: 'pending', administrative: 'registered',
    renewal: 'not_required', document: true, notes: 'Scenario 12 — first of a likely-duplicate pair.',
  },
  {
    institution: 'DMO-IITD', reference: 'DMO/BOB/2024/7782', bank: 'Bank of Baroda', branch: 'Connaught Place, New Delhi',
    amount: 1100000, issueOffset: -60, maturityOffset: 400, verification: 'flagged', administrative: 'registered',
    renewal: 'not_required', document: true, notes: 'Scenario 12 — second of a likely-duplicate pair (never merged automatically).',
  },
  {
    institution: 'DMO-NITW', reference: 'DMO/HDFC/2022/0013', bank: 'HDFC Bank', branch: 'Hanamkonda, Warangal',
    amount: 300000, issueOffset: -1600, maturityOffset: -230, verification: 'pending', administrative: 'registered',
    renewal: 'due', document: true, notes: 'Scenario 4b — long-overdue matured record without a release application.',
  },
];

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Minimal valid single-page PDF used as synthetic supporting evidence. */
export function buildDemoPdf(lines: string[]): Buffer {
  const content = `BT /F1 11 Tf 50 800 Td 16 TL ${lines
    .map((line) => `(${escapePdfText(line)}) Tj T*`)
    .join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function documentLines(seed: RecordSeed): string[] {
  return [
    'DEMONSTRATION DOCUMENT — NOT A REAL BANK INSTRUMENT',
    'Synthetic Fixed Deposit Receipt generated for FDR Sentinel testing.',
    seed.bank,
    `Branch: ${seed.branch ?? 'Not stated'}`,
    `FDR No: ${seed.ocrReference ?? seed.reference}`,
    `Deposit Amount: Rs. ${(seed.ocrAmount ? Number(seed.ocrAmount) : seed.amount).toLocaleString('en-IN')}`,
    `Date of Issue: ${seed.issueOffset <= 0 ? 'see record' : 'see record'}`,
    'Maturity Date: as printed on the original receipt',
    'This file contains no real banking information.',
  ];
}

export async function removeDemoData(admin: SupabaseClient): Promise<Record<string, number>> {
  const removed: Record<string, number> = {
    institutions: 0,
    fdr_records: 0,
    fdr_documents: 0,
    discrepancy_flags: 0,
    release_applications: 0,
    notifications: 0,
  };

  const { data: demoFdrs } = await admin.from('fdr_records').select('id').eq('is_demo', true).limit(5000);
  const fdrIds = (demoFdrs ?? []).map((row) => row.id);

  if (fdrIds.length > 0) {
    const { data: documents } = await admin
      .from('fdr_documents')
      .select('storage_path')
      .in('fdr_id', fdrIds)
      .limit(5000);
    const paths = (documents ?? []).map((row) => row.storage_path);
    if (paths.length > 0) {
      const { error } = await admin.storage.from('fdr-documents').remove(paths);
      if (error) console.error('[seed] Could not remove demo documents from storage:', error.message);
    }

    const { count: flagCount } = await admin
      .from('discrepancy_flags')
      .select('id', { count: 'exact', head: true })
      .in('fdr_id', fdrIds);
    const { count: appCount } = await admin
      .from('release_applications')
      .select('id', { count: 'exact', head: true })
      .in('fdr_id', fdrIds);
    const { count: documentCount } = await admin
      .from('fdr_documents')
      .select('id', { count: 'exact', head: true })
      .in('fdr_id', fdrIds);

    removed.discrepancy_flags = flagCount ?? 0;
    removed.release_applications = appCount ?? 0;
    removed.fdr_documents = documentCount ?? 0;

    const { error: deleteError, count } = await admin
      .from('fdr_records')
      .delete({ count: 'exact' })
      .in('id', fdrIds);
    if (deleteError) throw new Error(`Could not delete demo FDR records: ${deleteError.message}`);
    removed.fdr_records = count ?? fdrIds.length;
  }

  const { count: notificationCount } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .like('dedupe_key', 'demo:%');
  await admin.from('notifications').delete().like('dedupe_key', 'demo:%');
  removed.notifications = notificationCount ?? 0;

  const { error: institutionError, count: institutionCount } = await admin
    .from('institutions')
    .delete({ count: 'exact' })
    .eq('is_demo', true);
  if (institutionError) {
    // An institution still referenced by non-demo records must not be removed.
    console.warn('[seed] Demo institutions were not removed:', institutionError.message);
  } else {
    removed.institutions = institutionCount ?? 0;
  }

  return removed;
}

export async function seedDemoData(
  admin: SupabaseClient,
  actor: { id: string; email: string },
): Promise<Record<string, number>> {
  await removeDemoData(admin);

  const today = todayInPolicyZone();
  const runId = Date.now().toString(36);
  const counts: Record<string, number> = {};

  const { data: institutionRows, error: institutionError } = await admin
    .from('institutions')
    .upsert(
      INSTITUTIONS.map((institution) => ({
        institution_code: institution.code,
        institution_name: institution.name,
        institution_type: institution.type,
        region: institution.region,
        contact_email: institution.email,
        contact_phone: institution.phone,
        status: 'active',
        is_demo: true,
      })),
      { onConflict: 'institution_code' },
    )
    .select('id, institution_code');
  if (institutionError) throw new Error(`Could not create demo institutions: ${institutionError.message}`);
  counts.institutions = (institutionRows ?? []).length;
  const institutionByCode = new Map((institutionRows ?? []).map((row) => [row.institution_code, row.id as string]));

  const recordsPayload = RECORDS.map((seed) => ({
    institution_id: institutionByCode.get(seed.institution),
    fdr_reference_number: seed.reference,
    issuing_bank: seed.bank,
    branch_name: seed.branch,
    deposit_amount: seed.amount,
    issue_date: addDays(today, seed.issueOffset),
    maturity_date: addDays(today, seed.maturityOffset),
    validity_status: 'active',
    renewal_status: seed.renewal,
    administrative_status: seed.administrative,
    verification_status: seed.verification,
    notes: seed.notes,
    submitted_at: new Date(Date.now() - Math.abs(seed.issueOffset) * 86_400_000).toISOString(),
    last_verified_at: seed.verification === 'verified' ? new Date(Date.now() - 7 * 86_400_000).toISOString() : null,
    is_demo: true,
    created_by: actor.id,
  })).filter((row) => Boolean(row.institution_id));

  const { data: recordRows, error: recordError } = await admin
    .from('fdr_records')
    .insert(recordsPayload)
    .select('id, fdr_reference_number, institution_id, issuing_bank, branch_name, deposit_amount, issue_date, maturity_date, verification_status');
  if (recordError) throw new Error(`Could not create demo FDR records: ${recordError.message}`);
  counts.fdr_records = (recordRows ?? []).length;

  const byReference = new Map((recordRows ?? []).map((row) => [row.fdr_reference_number, row]));

  // --- Documents + OCR extractions ----------------------------------------
  const ocrSnapshots = new Map<string, { fields: Record<string, string | null>; confidence: Record<string, number | null>; average: number }>();
  let documentCount = 0;

  for (const seed of RECORDS) {
    if (!seed.document) continue;
    const record = byReference.get(seed.reference);
    if (!record) continue;

    const path = `${record.institution_id}/${record.id}/${runId}-${documentCount + 1}.pdf`;
    const pdf = buildDemoPdf(documentLines(seed));
    const { error: uploadError } = await admin.storage.from('fdr-documents').upload(path, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (uploadError) {
      console.error('[seed] Document upload failed for', seed.reference, uploadError.message);
      continue;
    }

    const { data: document, error: documentError } = await admin
      .from('fdr_documents')
      .insert({
        fdr_id: record.id,
        institution_id: record.institution_id,
        storage_path: path,
        file_name: `${seed.reference.replace(/\//g, '-')}-demo-receipt.pdf`,
        mime_type: 'application/pdf',
        size_bytes: pdf.byteLength,
        document_type: 'fdr_receipt',
        is_current: true,
        ocr_status: 'completed',
        uploaded_by: actor.id,
      })
      .select('id')
      .single();
    if (documentError) {
      console.error('[seed] Document metadata failed for', seed.reference, documentError.message);
      continue;
    }
    documentCount += 1;

    if (seed.ocrAmount || seed.ocrReference) {
      const fields = {
        fdr_reference_number: seed.ocrReference ?? seed.reference,
        issuing_bank: seed.bank,
        branch_name: seed.branch,
        deposit_amount: seed.ocrAmount ?? seed.amount.toFixed(2),
        issue_date: record.issue_date,
        maturity_date: record.maturity_date,
        institution_name: null,
      };
      const confidence = {
        fdr_reference_number: 78.4,
        issuing_bank: 88.1,
        branch_name: 71.2,
        deposit_amount: 66.9,
        issue_date: 74.5,
        maturity_date: 72.8,
        institution_name: null,
      };
      ocrSnapshots.set(seed.reference, { fields, confidence, average: 72.6 });
      await admin.from('ocr_extractions').insert({
        document_id: document.id,
        fdr_id: record.id,
        engine: 'tesseract.js',
        status: 'completed',
        raw_text: `${seed.bank}\nFDR No: ${fields.fdr_reference_number}\nDeposit Amount: Rs. ${Number(fields.deposit_amount).toLocaleString('en-IN')}\nSynthetic demonstration document.`,
        fields,
        field_confidence: confidence,
        average_confidence: 72.6,
        processed_by: actor.id,
      });
    }
  }
  counts.fdr_documents = documentCount;

  // --- Deterministic flags -------------------------------------------------
  const recordList = recordRows ?? [];
  let flagCount = 0;
  for (const record of recordList) {
    const seed = RECORDS.find((entry) => entry.reference === record.fdr_reference_number);
    if (!seed) continue;
    const ocr = ocrSnapshots.get(seed.reference);
    const candidates = findLikelyDuplicates(
      {
        id: record.id,
        fdr_reference_number: record.fdr_reference_number,
        issuing_bank: record.issuing_bank,
        deposit_amount: record.deposit_amount,
        issue_date: record.issue_date,
        maturity_date: record.maturity_date,
      },
      recordList.filter((other) => other.institution_id === record.institution_id).map((other) => ({
        id: other.id,
        fdr_reference_number: other.fdr_reference_number,
        issuing_bank: other.issuing_bank,
        deposit_amount: other.deposit_amount,
        issue_date: other.issue_date,
        maturity_date: other.maturity_date,
      })),
    );

    const flags = detectDiscrepancies(
      {
        ...record,
        has_current_document: seed.document,
        ocr: ocr
          ? { fields: ocr.fields, average_confidence: ocr.average, engine: 'tesseract.js' }
          : null,
        candidates,
      },
      today,
    );

    if (flags.length > 0) {
      const { error: flagError } = await admin.from('discrepancy_flags').insert(
        flags.map((flag) => ({
          fdr_id: record.id,
          institution_id: record.institution_id,
          rule_code: flag.rule_code,
          field_name: flag.field_name,
          severity: flag.severity,
          submitted_value: flag.submitted_value,
          compared_value: flag.compared_value,
          explanation: flag.explanation,
          status: 'open',
        })),
      );
      if (flagError) console.error('[seed] Could not insert flags for', seed.reference, flagError.message);
      else flagCount += flags.length;
    }
  }
  counts.discrepancy_flags = flagCount;

  // --- Applications --------------------------------------------------------
  const applicationsPayload: Array<Record<string, unknown>> = [];
  const releaseUnderReview = byReference.get('DMO/BOI/2023/0005');
  const renewalInProgress = byReference.get('DMO/SBIN/2023/0008');
  const releaseSubmitted = byReference.get('DMO/KOTAK/2024/0009');

  if (releaseUnderReview) {
    applicationsPayload.push({
      fdr_id: releaseUnderReview.id,
      institution_id: releaseUnderReview.institution_id,
      application_type: 'release',
      status: 'under_review',
      reason: 'Demo: institution requested release after maturity; officer review in progress.',
      amount_claimed: 900000,
      requested_by: null,
      submitted_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      supporting_notes: 'Synthetic demonstration application. No real funds are involved.',
    });
  }
  if (renewalInProgress) {
    applicationsPayload.push({
      fdr_id: renewalInProgress.id,
      institution_id: renewalInProgress.institution_id,
      application_type: 'renewal',
      status: 'under_review',
      reason: 'Demo: renewal requested because the deposit matured and the institution intends to continue the FD.',
      requested_by: null,
      submitted_at: new Date(Date.now() - 12 * 86_400_000).toISOString(),
    });
  }
  if (releaseSubmitted) {
    applicationsPayload.push({
      fdr_id: releaseSubmitted.id,
      institution_id: releaseSubmitted.institution_id,
      application_type: 'release',
      status: 'submitted',
      reason: 'Demo: early release requested following closure of the sponsored project.',
      amount_claimed: 2200000,
      requested_by: null,
      submitted_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
  }

  let applicationCount = 0;
  if (applicationsPayload.length > 0) {
    const { data: applications, error: applicationError } = await admin
      .from('release_applications')
      .insert(applicationsPayload)
      .select('id, status');
    if (applicationError) throw new Error(`Could not create demo applications: ${applicationError.message}`);
    applicationCount = (applications ?? []).length;
    for (const application of applications ?? []) {
      await admin.from('application_events').insert({
        application_id: application.id,
        previous_status: null,
        new_status: 'submitted',
        note: 'Demonstration application submitted.',
        actor_id: null,
        actor_role: 'system',
      });
      if (application.status !== 'submitted') {
        await admin.from('application_events').insert({
          application_id: application.id,
          previous_status: 'submitted',
          new_status: application.status,
          note: 'Demonstration workflow advanced for review by AICTE staff.',
          actor_id: null,
          actor_role: 'system',
        });
      }
    }
  }
  counts.release_applications = applicationCount;

  // --- Verification history ------------------------------------------------
  const verifiedRecord = byReference.get('DMO/UCO/2024/0011');
  let verificationEvents = 0;
  if (verifiedRecord) {
    const { error } = await admin.from('verification_events').insert({
      fdr_id: verifiedRecord.id,
      institution_id: verifiedRecord.institution_id,
      action: 'verification_verified',
      previous_status: 'in_review',
      new_status: 'verified',
      observations:
        'Demo observation: receipt values compared with the submitted record. No independent bank confirmation was performed.',
      actor_id: actor.id,
    });
    if (!error) verificationEvents += 1;
  }
  counts.verification_events = verificationEvents;

  // --- Sample in-app notifications ----------------------------------------
  const matured = byReference.get('DMO/AXIS/2023/0004');
  const approaching = byReference.get('DMO/HDFC/2024/0002');
  const notifications = [
    {
      recipient_id: actor.id,
      category: 'maturity_upcoming',
      title: 'Demonstration data loaded',
      body: 'Synthetic institutions, FDRs, documents, OCR results, flags and applications were created. Every row is labelled demonstration data.',
      link: '/fdrs',
      dedupe_key: `demo:${runId}:welcome`,
    },
  ];
  if (matured) {
    notifications.push({
      recipient_id: actor.id,
      category: 'matured_no_application',
      title: `Matured FDR with no recorded release application: ${matured.fdr_reference_number}`,
      body: 'Demonstration alert: confirm the current status with the institution. This is not a finding of non-compliance.',
      link: `/fdrs/${matured.id}`,
      dedupe_key: `demo:${runId}:matured`,
    });
  }
  if (approaching) {
    notifications.push({
      recipient_id: actor.id,
      category: 'maturity_upcoming',
      title: `FDR matures soon: ${approaching.fdr_reference_number}`,
      body: 'Demonstration alert inside the configured warning window.',
      link: `/fdrs/${approaching.id}`,
      dedupe_key: `demo:${runId}:upcoming`,
    });
  }

  const { error: notificationError, data: insertedNotifications } = await admin
    .from('notifications')
    .insert(notifications)
    .select('id');
  if (notificationError) console.error('[seed] Could not insert demo notifications:', notificationError.message);
  counts.notifications = (insertedNotifications ?? []).length;

  await admin.from('audit_events').insert({
    actor_id: null,
    actor_email: actor.email,
    actor_role: 'system_admin',
    action: 'demo_data.loaded',
    entity_type: 'system_settings',
    entity_id: 'demo_data',
    summary: `Synthetic demonstration dataset generated (${counts.fdr_records} FDRs across ${counts.institutions} institutions)`,
    metadata: { ...counts, run_id: runId, synthetic: true },
  });

  return counts;
}
