/**
 * Honest performance baseline for FDR Sentinel.
 *
 * Times the real REST queries behind the dashboard, registry, maturity queue,
 * notifications and audit pages against the configured Supabase project.
 * Runs each probe N times and reports min/median/max in milliseconds.
 *
 *   node scripts/measure.mjs
 *
 * No values are invented: every number printed here was observed live.
 */
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const get = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(env)?.[1]?.trim();

const URL_ = get('VITE_SUPABASE_URL') ?? get('SUPABASE_URL');
const PUB = get('VITE_SUPABASE_PUBLISHABLE_KEY');
const SEC = get('SUPABASE_SECRET_KEY');
if (!URL_ || !PUB) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in .env');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const SELECT_FDR =
  'id,institution_id,fdr_reference_number,issuing_bank,branch_name,deposit_amount,issue_date,maturity_date,validity_status,renewal_status,administrative_status,verification_status,notes,submitted_at,last_verified_at,archived_at,is_demo,created_by,created_at,updated_at,institutions(id,institution_name,institution_code),release_applications(id,application_type,status)';

const rest = async (path, init = {}, key = PUB) => {
  const started = performance.now();
  const response = await fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();
  const ms = performance.now() - started;
  if (!response.ok && response.status !== 206) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${body.slice(0, 160)}`);
  }
  return { ms, bytes: body.length };
};

const probes = [
  {
    name: 'dashboard aggregate (fn_dashboard_summary)',
    run: () => rest('/rest/v1/rpc/fn_dashboard_summary', { method: 'POST', body: JSON.stringify({ p_today: today }) }),
  },
  {
    name: 'registry page (12 rows, count=exact)',
    run: () =>
      rest(
        `/rest/v1/fdr_records?select=${encodeURIComponent(SELECT_FDR)}&archived_at=is.null&order=updated_at.desc&offset=0&limit=12`,
      ),
  },
  {
    name: 'registry search (reference/bank ilike)',
    run: () =>
      rest(
        `/rest/v1/fdr_records?select=id,fdr_reference_number&archived_at=is.null&or=(fdr_reference_number.ilike.%25DMO%25,issuing_bank.ilike.%25bank%25)&limit=12`,
      ),
  },
  {
    name: 'maturity queue (upcoming window, 500 rows max)',
    run: () =>
      rest(
        `/rest/v1/fdr_records?select=${encodeURIComponent(SELECT_FDR)}&archived_at=is.null&validity_status=eq.active&maturity_date=gte.${today}&order=maturity_date.asc&limit=500`,
      ),
  },
  {
    name: 'dashboard attention (matured, limit 60)',
    run: () =>
      rest(
        `/rest/v1/fdr_records?select=id,fdr_reference_number,maturity_date&archived_at=is.null&validity_status=eq.active&maturity_date=lte.${today}&order=maturity_date.asc&limit=60`,
      ),
  },
  {
    name: 'notifications (current user, newest 20)',
    run: () => rest('/rest/v1/notifications?select=id,is_read,created_at&order=created_at.desc&limit=20'),
  },
  {
    name: 'audit page (newest 25)',
    run: () => rest('/rest/v1/audit_events?select=id,action,created_at&order=created_at.desc&offset=0&limit=25'),
  },
  {
    name: 'system settings (all rows)',
    run: () => rest('/rest/v1/system_settings?select=key,value'),
  },
];

const ROUNDS = Number(process.env.MEASURE_ROUNDS ?? 5);
const results = [];

for (const probe of probes) {
  const samples = [];
  let bytes = 0;
  for (let i = 0; i < ROUNDS; i += 1) {
    try {
      const { ms, bytes: size } = await probe.run();
      samples.push(ms);
      bytes = size;
    } catch (error) {
      console.error(`✗ ${probe.name}: ${error.message}`);
      samples.push(null);
    }
  }
  const ok = samples.filter((value) => value !== null).sort((a, b) => a - b);
  if (ok.length === 0) {
    results.push({ name: probe.name, ok: false });
    continue;
  }
  const median = ok[Math.floor(ok.length / 2)];
  results.push({
    name: probe.name,
    ok: true,
    min: ok[0],
    median,
    max: ok[ok.length - 1],
    bytes,
    failures: samples.length - ok.length,
  });
}

console.log(`\nFDR Sentinel query latency — ${ROUNDS} round(s) each, ${new Date().toISOString()}`);
console.log('supabase project:', URL_.replace('https://', ''));
console.log('');
for (const result of results) {
  if (!result.ok) continue;
  console.log(
    `${result.name.padEnd(46)} min ${result.min.toFixed(1).padStart(6)}ms  ` +
      `median ${result.median.toFixed(1).padStart(6)}ms  max ${result.max.toFixed(1).padStart(6)}ms  ` +
      `(${result.bytes} B${result.failures ? `, ${result.failures} failed` : ''})`,
  );
}
