#!/usr/bin/env node
/**
 * Live integration checks for FDR Sentinel.
 *
 * Runs against a real Supabase project and a running application (local Vite dev
 * server or a deployed Vercel URL), using a throw-away set of accounts and one
 * throw-away FDR record. It verifies authentication, RLS isolation, database
 * constraints, privileged functions, the workflow guards and idempotent alerting.
 *
 *   VERIFY_BASE_URL=http://localhost:5173 npm run verify:live
 *
 * Required environment (never committed):
 *   VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
 *   SUPABASE_URL / SUPABASE_SECRET_KEY
 *   VERIFY_ADMIN_EMAIL / VERIFY_ADMIN_PASSWORD  (existing System Administrator)
 *   CRON_SECRET                                 (for the scan endpoint)
 */
import 'dotenv/config';

const BASE = (process.env.VERIFY_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ADMIN_EMAIL = process.env.VERIFY_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.VERIFY_ADMIN_PASSWORD;

if (!URL_ || !ANON || !SERVICE) {
  console.error('Missing Supabase configuration (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY).');
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Missing VERIFY_ADMIN_EMAIL / VERIFY_ADMIN_PASSWORD for the existing administrator account.');
  process.exit(1);
}

const results = [];
let cleanup = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  const icon = condition ? '✓' : '✗';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) process.exitCode = 1;
}

function header(token, extra = {}) {
  return {
    apikey: token === SERVICE ? SERVICE : ANON,
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function rest(path, { token = ANON, method = 'GET', body, prefer, headers = {} } = {}) {
  const response = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: header(token, {
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data };
}

async function rpc(name, args, token = ANON) {
  return rest(`rpc/${name}`, { token, method: 'POST', body: args });
}

async function callApi(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data };
}

async function signIn(email, password) {
  const response = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Sign-in failed for ${email}: ${data.error_description ?? data.msg ?? response.status}`);
  }
  return data.access_token;
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

async function main() {
  const suffix = uniqueSuffix();
  const password = `Verify#${suffix}A1`;
  const officerEmail = `verify.officer.${suffix}@example.com`;
  const instAEmail = `verify.insta.${suffix}@example.com`;
  const instBEmail = `verify.instb.${suffix}@example.com`;
  const createdUserIds = [];
  const createdFdrIds = [];
  const createdPaths = [];

  console.log(`\nFDR Sentinel live verification\n  app: ${BASE}\n  db:  ${URL_}\n`);

  // ---------------------------------------------------------------- admin ---
  const adminToken = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  check('administrator can sign in', Boolean(adminToken));

  const adminProfile = await rest('profiles?select=id,role,email&limit=1', { token: adminToken });
  check(
    'administrator profile is a system administrator',
    adminProfile.ok && adminProfile.data?.[0]?.role === 'system_admin',
    adminProfile.data?.[0]?.role ?? String(adminProfile.status),
  );

  const diagnostics = await callApi('/api/diagnostics', { token: adminToken });
  check('privileged diagnostics endpoint authorises the administrator', diagnostics.status === 200, String(diagnostics.status));
  check('server-only configuration is present', diagnostics.data?.ok === true, JSON.stringify(diagnostics.data?.checks ?? []).slice(0, 200));

  // ------------------------------------------------------------- demo data ---
  const seed = await callApi('/api/admin/demo-data', { method: 'POST', token: adminToken });
  check('administrator can load demonstration data', seed.status === 200, `${seed.data?.counts?.fdr_records ?? 0} demo FDRs`);

  const institutions = await rest('institutions?select=id,institution_code&institution_code=in.(DMO-IITD,DMO-NITW)', {
    token: adminToken,
  });
  const instA = institutions.data?.find((row) => row.institution_code === 'DMO-IITD');
  const instB = institutions.data?.find((row) => row.institution_code === 'DMO-NITW');
  check('demo institutions exist', Boolean(instA && instB), institutions.status);

  // -------------------------------------------------------------- accounts ---
  async function createUser(email, role, institutionId) {
    const response = await callApi('/api/admin/users', {
      method: 'POST',
      token: adminToken,
      body: { email, full_name: `Verify ${role}`, role, institution_id: institutionId, password },
    });
    if (response.data?.user?.id) createdUserIds.push(response.data.user.id);
    return response;
  }

  const officerCreate = await createUser(officerEmail, 'aicte_officer');
  const userACreate = await createUser(instAEmail, 'institution_user', instA?.id);
  const userBCreate = await createUser(instBEmail, 'institution_user', instB?.id);
  check(
    'administrator can provision officer and institution users',
    officerCreate.status === 201 && userACreate.status === 201 && userBCreate.status === 201,
    [officerCreate, userACreate, userBCreate].map((r) => r.status).join('/'),
  );

  const officerToken = await signIn(officerEmail, password);
  const instAToken = await signIn(instAEmail, password);
  const instBToken = await signIn(instBEmail, password);
  check('provisioned users can sign in', Boolean(officerToken && instAToken && instBToken));

  const unauthorizedUsers = await callApi('/api/admin/users', { token: instAToken });
  check('institution user cannot use the administrator API', unauthorizedUsers.status === 403, String(unauthorizedUsers.status));
  const anonymousScan = await callApi('/api/monitoring/scan', { method: 'POST' });
  check('scheduled scan endpoint rejects anonymous callers', anonymousScan.status === 401, String(anonymousScan.status));

  // ----------------------------------------------------------- RLS scoping ---
  const visibleToA = await rest('fdr_records?select=id,institution_id&limit=200', { token: instAToken });
  const foreignRows = (visibleToA.data ?? []).filter((row) => row.institution_id !== instA?.id);
  check(
    'institution user sees only their own institution',
    visibleToA.ok && foreignRows.length === 0 && (visibleToA.data ?? []).length > 0,
    `${visibleToA.data?.length ?? 0} rows, ${foreignRows.length} foreign`,
  );

  const visibleToOfficer = await rest('fdr_records?select=institution_id&limit=500', { token: officerToken });
  const officerInstitutions = new Set((visibleToOfficer.data ?? []).map((row) => row.institution_id));
  check('officer can see records across institutions', officerInstitutions.size > 1, `${officerInstitutions.size} institutions`);

  const otherAudit = await rest(`audit_events?select=id&actor_id=eq.${createdUserIds[0]}&limit=5`, { token: instAToken });
  check(
    'institution user cannot read another actor’s audit events',
    otherAudit.ok && (otherAudit.data ?? []).length === 0,
    `${otherAudit.data?.length ?? 0} rows`,
  );

  // ------------------------------------------------- privilege escalation ---
  const escalate = await rest(`profiles?id=eq.${createdUserIds[1]}`, {
    token: instAToken,
    method: 'PATCH',
    body: { role: 'system_admin' },
    prefer: 'return=representation',
  });
  check('a user cannot promote themselves to administrator', !escalate.ok, `${escalate.status} ${escalate.data?.message ?? ''}`);

  const selfAuditInsert = await rest('audit_events', {
    token: instAToken,
    method: 'POST',
    body: { action: 'hacked', entity_type: 'audit_events' },
  });
  check('audit trail rejects direct inserts from the browser', !selfAuditInsert.ok, String(selfAuditInsert.status));

  const forgeNotification = await rest('notifications', {
    token: instAToken,
    method: 'POST',
    body: { recipient_id: createdUserIds[1], category: 'maturity_today', title: 'forged', dedupe_key: `forged-${suffix}` },
  });
  check('notifications cannot be forged by a browser client', !forgeNotification.ok, String(forgeNotification.status));

  // ------------------------------------------------------------ FDR writes ---
  const reference = `VERIFY/${suffix}/0001`;
  const createFdr = await rest('fdr_records', {
    token: instAToken,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      institution_id: instA?.id,
      fdr_reference_number: reference,
      issuing_bank: 'State Bank of India',
      branch_name: 'Verification Branch',
      deposit_amount: 750000.5,
      issue_date: '2025-01-10',
      maturity_date: '2026-01-10',
    },
  });
  const fdr = createFdr.data?.[0];
  if (fdr?.id) createdFdrIds.push(fdr.id);
  check('institution user can register an FDR', createFdr.status === 201 && Boolean(fdr?.id), String(createFdr.status));
  check('amounts are stored exactly', Number(fdr?.deposit_amount) === 750000.5, String(fdr?.deposit_amount));

  const duplicate = await rest('fdr_records', {
    token: instAToken,
    method: 'POST',
    body: {
      institution_id: instA?.id,
      fdr_reference_number: reference,
      issuing_bank: 'State Bank of India',
      deposit_amount: 1000,
      issue_date: '2025-01-10',
      maturity_date: '2026-01-10',
    },
  });
  check('duplicate reference for the same institution is rejected', !duplicate.ok, `${duplicate.status}`);

  const invalidDates = await rest('fdr_records', {
    token: instAToken,
    method: 'POST',
    body: {
      institution_id: instA?.id,
      fdr_reference_number: `VERIFY/${suffix}/DATES`,
      issuing_bank: 'State Bank of India',
      deposit_amount: 1000,
      issue_date: '2025-06-01',
      maturity_date: '2025-05-01',
    },
  });
  check('maturity before issue date is rejected by the database', !invalidDates.ok, String(invalidDates.status));

  const crossInstitution = await rest('fdr_records', {
    token: instAToken,
    method: 'POST',
    body: {
      institution_id: instB?.id,
      fdr_reference_number: `VERIFY/${suffix}/CROSS`,
      issuing_bank: 'State Bank of India',
      deposit_amount: 1000,
      issue_date: '2025-01-10',
      maturity_date: '2026-01-10',
    },
  });
  check('institution user cannot register records for another institution', !crossInstitution.ok, String(crossInstitution.status));

  const selfVerify = await rest(`fdr_records?id=eq.${fdr?.id}`, {
    token: instAToken,
    method: 'PATCH',
    body: { verification_status: 'verified' },
  });
  check('institution user cannot set verification status', !selfVerify.ok, String(selfVerify.status));

  const crossRead = await rest(`fdr_records?select=id&id=eq.${fdr?.id}`, { token: instBToken });
  check('another institution cannot read the record', crossRead.ok && (crossRead.data ?? []).length === 0, `${crossRead.data?.length ?? 0} rows`);

  if (!fdr?.id) throw new Error('Cannot continue without a created FDR record.');

  // ------------------------------------------------------------- documents ---
  const storagePath = `${instA?.id}/${fdr.id}/verify-${suffix}.pdf`;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
  const upload = await fetch(`${URL_}/storage/v1/object/fdr-documents/${storagePath}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${instAToken}`,
      'content-type': 'application/pdf',
    },
    body: pdf,
  });
  if (upload.ok) createdPaths.push(storagePath);
  check('institution user can upload into the private bucket', upload.ok, String(upload.status));

  const documentInsert = await rest('fdr_documents', {
    token: instAToken,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      fdr_id: fdr.id,
      institution_id: instA?.id,
      storage_path: storagePath,
      file_name: 'verification.pdf',
      mime_type: 'application/pdf',
      size_bytes: pdf.byteLength,
      ocr_status: 'completed',
    },
  });
  const document = documentInsert.data?.[0];
  check('document metadata is persisted', documentInsert.status === 201 && Boolean(document?.id), String(documentInsert.status));

  const foreignDownload = await fetch(`${URL_}/storage/v1/object/fdr-documents/${storagePath}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${instBToken}` },
  });
  check('another institution cannot download the document', !foreignDownload.ok, String(foreignDownload.status));

  const ownDownload = await fetch(`${URL_}/storage/v1/object/fdr-documents/${storagePath}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${instAToken}` },
  });
  check('owning institution can download its document', ownDownload.ok, String(ownDownload.status));

  // --------------------------------------------------------------- OCR data ---
  const extraction = await rest('ocr_extractions', {
    token: instAToken,
    method: 'POST',
    body: {
      document_id: document?.id,
      fdr_id: fdr.id,
      engine: 'tesseract.js',
      status: 'completed',
      raw_text: 'FDR No: VERIFY/BANK/9912 Amount: Rs. 9,99,999',
      fields: { fdr_reference_number: 'VERIFY/BANK/9912', deposit_amount: '999999.00' },
      field_confidence: { fdr_reference_number: 82.4, deposit_amount: 71.2 },
      average_confidence: 76.8,
    },
  });
  check('OCR extraction results are stored', extraction.status === 201, String(extraction.status));

  // ---------------------------------------------------- discrepancy review ---
  const flag = await rpc(
    'fn_upsert_discrepancy_flags',
    {
      p_fdr_id: fdr.id,
      p_flags: [
        {
          rule_code: 'OCR_AMOUNT_MISMATCH',
          field_name: 'deposit_amount',
          severity: 'critical',
          submitted_value: '750000.50',
          compared_value: '999999.00',
          explanation: 'Live verification: the document amount differs from the submitted amount.',
        },
        {
          rule_code: 'OCR_REFERENCE_MISMATCH',
          field_name: 'fdr_reference_number',
          severity: 'critical',
          submitted_value: reference,
          compared_value: 'VERIFY/BANK/9912',
          explanation: 'Live verification: the document reference differs from the submitted reference.',
        },
      ],
    },
    instAToken,
  );
  check('institution user can persist deterministic findings', flag.ok && flag.data >= 2, String(flag.data ?? flag.status));

  const flagsList = await rest(`discrepancy_flags?select=id,status,severity&fdr_id=eq.${fdr.id}`, { token: instAToken });
  check('flags are readable by the owning institution', (flagsList.data ?? []).length >= 2, `${flagsList.data?.length ?? 0} flags`);

  const institutionReview = await rpc('fn_review_discrepancy', { p_flag_id: flagsList.data?.[0]?.id, p_status: 'resolved' }, instAToken);
  check('institution user cannot review their own flags', !institutionReview.ok, String(institutionReview.status));

  for (const row of flagsList.data ?? []) {
    const review = await rpc('fn_review_discrepancy', { p_flag_id: row.id, p_status: 'resolved', p_note: 'Resolved during live verification.' }, officerToken);
    check(`officer resolves flag ${row.id.slice(0, 8)}`, review.ok, String(review.status));
  }

  const flaggedVerify = await rpc('fn_verify_fdr', { p_fdr_id: fdr.id, p_decision: 'verified', p_observations: 'Verified during live checks.' }, officerToken);
  check('officer can record a verification decision after resolving flags', flaggedVerify.ok, String(flaggedVerify.status));

  const recordAfterVerify = await rest(`fdr_records?select=verification_status,last_verified_at&id=eq.${fdr.id}`, { token: officerToken });
  check(
    'verification status and timestamp are persisted',
    recordAfterVerify.data?.[0]?.verification_status === 'verified' && Boolean(recordAfterVerify.data?.[0]?.last_verified_at),
    recordAfterVerify.data?.[0]?.verification_status,
  );

  // -------------------------------------------------------------- workflow ---
  const applicationCreate = await rest('release_applications', {
    token: instAToken,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      fdr_id: fdr.id,
      institution_id: instA?.id,
      application_type: 'release',
      reason: 'Live verification: deposit matured and the project has closed.',
      amount_claimed: 750000.5,
      status: 'submitted',
    },
  });
  const application = applicationCreate.data?.[0];
  check('institution user can submit a release application', applicationCreate.status === 201, String(applicationCreate.status));

  check(
    'application records the requester',
    application?.requested_by === createdUserIds[1],
    application?.requested_by ?? 'requested_by not set',
  );

  const officerReview = await rpc('fn_transition_application', { p_application_id: application?.id, p_new_status: 'under_review', p_note: 'Review started.' }, officerToken);
  check('officer can start review', officerReview.ok, String(officerReview.status));

  const skipStep = await rpc('fn_transition_application', { p_application_id: application?.id, p_new_status: 'completed', p_note: 'Skipping steps' }, officerToken);
  check('workflow refuses to skip steps', !skipStep.ok, String(skipStep.status));

  const institutionApprove = await rpc('fn_transition_application', { p_application_id: application?.id, p_new_status: 'approved', p_note: 'Self approve' }, instAToken);
  check('institution user cannot approve', !institutionApprove.ok, String(institutionApprove.status));

  const approve = await rpc('fn_transition_application', { p_application_id: application?.id, p_new_status: 'approved', p_note: 'Recommended for release by the competent authority.' }, officerToken);
  check('officer can approve', approve.ok, String(approve.status));

  const complete = await rpc('fn_transition_application', { p_application_id: application?.id, p_new_status: 'completed', p_note: 'Recorded as released.' }, officerToken);
  check('approved application can be completed', complete.ok, String(complete.status));

  const events = await rest(`application_events?select=id,new_status&application_id=eq.${application?.id}`, { token: instAToken });
  check('every workflow transition is recorded', (events.data ?? []).length >= 3, `${events.data?.length ?? 0} events`);

  const audit = await rest(`audit_events?select=action,summary&entity_id=eq.${application?.id}&limit=20`, { token: officerToken });
  check('workflow transitions appear in the audit trail', (audit.data ?? []).length >= 2, `${audit.data?.length ?? 0} audit rows`);

  // Self-approval guard
  const selfApp = await rest('release_applications', {
    token: officerToken,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      fdr_id: fdr.id,
      institution_id: instA?.id,
      application_type: 'renewal',
      reason: 'Live verification: officer-created application to test segregation of duties.',
      status: 'submitted',
      requested_by: createdUserIds[0],
    },
  });
  if (selfApp.data?.[0]?.id) {
    await rpc('fn_transition_application', { p_application_id: selfApp.data[0].id, p_new_status: 'under_review', p_note: 'review' }, officerToken);
    const selfApprove = await rpc('fn_transition_application', { p_application_id: selfApp.data[0].id, p_new_status: 'approved', p_note: 'self' }, officerToken);
    check('self-approval is blocked by the database function', !selfApprove.ok, String(selfApprove.status));
  }

  // ---------------------------------------------------------- notifications ---
  const notifications = await rest('notifications?select=id,recipient_id,is_read&limit=200', { token: instAToken });
  check(
    'notifications are scoped to the signed-in user',
    notifications.ok && (notifications.data ?? []).every((row) => row.recipient_id === createdUserIds[1]),
    `${notifications.data?.length ?? 0} rows`,
  );
  const notification = notifications.data?.[0];
  if (notification) {
    const markRead = await rest(`notifications?id=eq.${notification.id}`, { token: instAToken, method: 'PATCH', body: { is_read: true } });
    check('recipient can mark a notification as read', markRead.ok, String(markRead.status));
  }

  // -------------------------------------------------------------- scanning ---
  if (CRON_SECRET) {
    const firstScan = await callApi(`/api/monitoring/scan?secret=${encodeURIComponent(CRON_SECRET)}`, { method: 'POST' });
    const secondScan = await callApi(`/api/monitoring/scan?secret=${encodeURIComponent(CRON_SECRET)}`, { method: 'POST' });
    check('scheduled scan runs without a user session', firstScan.status === 200, String(firstScan.status));
    check(
      'scan is idempotent for the same event/recipient',
      secondScan.ok && secondScan.data?.summary?.notifications_created === 0,
      `${secondScan.data?.summary?.notifications_created ?? 'n/a'} created on the second run`,
    );
  } else {
    check('scheduled scan skipped (CRON_SECRET not set)', true);
  }

  // ---------------------------------------------------------------- cleanup ---
  try {
    for (const id of createdFdrIds) {
      await rest(`release_applications?fdr_id=eq.${id}`, { token: SERVICE, method: 'DELETE' });
      await rest(`discrepancy_flags?fdr_id=eq.${id}`, { token: SERVICE, method: 'DELETE' });
      await rest(`ocr_extractions?fdr_id=eq.${id}`, { token: SERVICE, method: 'DELETE' });
      await rest(`notifications?fdr_id=eq.${id}`, { token: SERVICE, method: 'DELETE' });
      await rest(`fdr_documents?fdr_id=eq.${id}`, { token: SERVICE, method: 'DELETE' });
      await rest(`fdr_records?id=eq.${id}`, { token: SERVICE, method: 'DELETE' });
    }
    if (createdPaths.length > 0) {
      await fetch(`${URL_}/storage/v1/object/fdr-documents`, {
        method: 'DELETE',
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: createdPaths }),
      });
    }
    for (const id of createdUserIds) {
      await fetch(`${URL_}/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
    }
    cleanup.push('removed verification users, record, documents and storage objects');
  } catch (error) {
    cleanup.push(`cleanup warning: ${error.message}`);
    process.exitCode = 1;
  }

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} live checks passed.`);
  if (cleanup.length) console.log(cleanup.join('\n'));
  if (process.exitCode) {
    console.log('\nFailures:');
    for (const result of results.filter((entry) => !entry.ok)) console.log(` - ${result.name}: ${result.detail}`);
  }
}

main().catch((error) => {
  console.error('\nLive verification aborted:', error.message);
  process.exitCode = 1;
});
