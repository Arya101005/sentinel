/**
 * Evidence for the index migration (0008).
 *
 * The production table currently holds a demo-scale number of rows, where the
 * planner legitimately prefers sequential scans. To decide indexes honestly we
 * rebuild the REAL hot-path queries against a 200,000-row synthetic copy in a
 * temporary table (session-local — production rows are never modified), then
 * compare:
 *
 *   baseline : indexes absent / index scans disabled  -> seq scan + sort
 *   with idx : candidate indexes present               -> index scan
 *
 * Everything printed was measured by this script; nothing is estimated.
 *
 *   node scripts/explain.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const get = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(env)?.[1]?.trim();
const CONNECTION = get('SUPABASE_DB_URL');
if (!CONNECTION) {
  console.error('SUPABASE_DB_URL is not set in .env');
  process.exit(1);
}

const ROWS = Number(process.env.EXPLAIN_ROWS ?? 200_000);
const client = new pg.Client({ connectionString: CONNECTION, statement_timeout: 120_000 });

const stripTime = (text) => {
  const execution = /Execution Time: ([\d.]+) ms/.exec(text)?.[1];
  const planning = /Planning Time: ([\d.]+) ms/.exec(text)?.[1];
  return { execution: execution ? Number(execution) : null, planning: planning ? Number(planning) : null };
};

async function explain(label, sql, params = []) {
  const start = performance.now();
  const result = await client.query(`explain (analyze, buffers) ${sql}`, params);
  const wall = performance.now() - start;
  const text = result.rows.map((row) => row['QUERY PLAN']).join('\n');
  const { execution, planning } = stripTime(text);
  const usedIndex = /Index (Only )?(Scan|Backward Scan)/.test(text);
  return { label, execution, planning, wall, usedIndex, text };
}

function report(name, baseline, indexed) {
  const fmt = (value) => (value === null ? 'n/a' : `${value.toFixed(1)}ms`);
  const speedup =
    baseline.execution && indexed.execution && indexed.execution > 0
      ? `${(baseline.execution / indexed.execution).toFixed(1)}x`
      : 'n/a';
  console.log(`\n${name}`);
  console.log(`  baseline (no index / indexscan off): ${fmt(baseline.execution)}  plan: ${baseline.usedIndex ? 'index' : 'seq'}`);
  console.log(`  with candidate index              : ${fmt(indexed.execution)}  plan: ${indexed.usedIndex ? 'index' : 'seq'}`);
  console.log(`  speed-up                          : ${speedup}`);
}

try {
  await client.connect();
  console.log(`Building a ${ROWS}-row synthetic copy of fdr_records in a TEMPORARY table…`);
  const t0 = performance.now();
  await client.query('drop table if exists perf_fdr cascade');
  await client.query('drop table if exists perf_notifications cascade');
  await client.query(`
    create temp table perf_fdr (
      id uuid primary key,
      institution_id uuid not null,
      fdr_reference_number text not null,
      issuing_bank text not null,
      deposit_amount numeric(14,2) not null,
      issue_date date not null,
      maturity_date date not null,
      validity_status text not null default 'active',
      verification_status text not null default 'pending',
      archived_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await client.query(`
    insert into perf_fdr
    select
      gen_random_uuid(),
      gen_random_uuid(),
      'FDR/' || lpad(g::text, 8, '0'),
      (array['State Bank of India','HDFC Bank','ICICI Bank','Axis Bank','Bank of Baroda'])[1 + g % 5],
      100000 + (g % 900) * 25000,
      date '2023-01-01' + ((g % 1000)) * interval '1 day',
      date '2023-01-01' + ((g % 1000) + 365 + (g % 200)) * interval '1 day',
      (array['active','active','active','closed'])[1 + g % 4],
      (array['pending','in_review','verified','flagged'])[1 + g % 4],
      case when g % 17 = 0 then now() - interval '1 day' else null end,
      now() - ((g % 700) || ' days')::interval,
      now() - ((g % 365) || ' days')::interval
    from generate_series(1, ${ROWS}) as g
  `);
  await client.query('analyze perf_fdr');
  console.log(`temp table built in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const today = new Date().toISOString().slice(0, 10);

  // --- Probe 1: registry page (newest live records) ------------------------
  const q1 = `select id, fdr_reference_number from perf_fdr where archived_at is null order by updated_at desc limit 12`;
  await client.query('set enable_indexscan = off; set enable_bitmapscan = off;');
  const q1Base = await explain('registry page baseline', q1);
  await client.query('set enable_indexscan = on; set enable_bitmapscan = on;');
  await client.query('create index perf_fdr_live_updated_idx on perf_fdr (updated_at desc) where archived_at is null');
  const q1Idx = await explain('registry page with partial index', q1);
  report('Registry page — newest live records (order by updated_at desc limit 12)', q1Base, q1Idx);

  // --- Probe 2: maturity window (dashboard + maturity queue) ---------------
  const q2 = `select id, maturity_date from perf_fdr
              where archived_at is null and validity_status = 'active'
                and maturity_date between $1::date and $2::date
              order by maturity_date asc limit 500`;
  const params2 = [today, today];
  await client.query('set enable_indexscan = off; set enable_bitmapscan = off;');
  const q2Base = await explain('maturity window baseline', q2, params2);
  await client.query('set enable_indexscan = on; set enable_bitmapscan = on;');
  await client.query(
    'create index perf_fdr_live_maturity_idx on perf_fdr (validity_status, maturity_date) where archived_at is null',
  );
  const q2Idx = await explain('maturity window with partial composite index', q2, params2);
  report('Maturity window — active records maturing by today (matured queue)', q2Base, q2Idx);

  // --- Probe 3: institution + maturity (per-institution queue) -------------
  const q3 = `select id from perf_fdr
              where archived_at is null and institution_id = $1::uuid and maturity_date <= $2::date
              order by maturity_date asc limit 200`;
  const params3 = ['11111111-1111-4111-8111-111111111111', today];
  await client.query('set enable_indexscan = off; set enable_bitmapscan = off;');
  const q3Base = await explain('institution queue baseline', q3, params3);
  await client.query('set enable_indexscan = on; set enable_bitmapscan = on;');
  await client.query(
    'create index perf_fdr_inst_maturity_idx on perf_fdr (institution_id, maturity_date) where archived_at is null',
  );
  const q3Idx = await explain('institution queue with composite index', q3, params3);
  report('Institution queue — institution + maturity window', q3Base, q3Idx);

  // --- Probe 4: notifications unread count --------------------------------
  await client.query(`
    create temp table perf_notifications (
      id uuid primary key default gen_random_uuid(),
      recipient_id uuid not null,
      is_read boolean not null default false,
      created_at timestamptz not null default now()
    )
  `);
  await client.query(`
    insert into perf_notifications (recipient_id, is_read, created_at)
    select gen_random_uuid(), (g % 3) = 0, now() - ((g % 300) || ' hours')::interval
    from generate_series(1, ${ROWS}) as g
  `);
  await client.query('analyze perf_notifications');
  const q4 = `select id from perf_notifications where recipient_id = $1::uuid and is_read = false`;
  const params4 = ['22222222-2222-4222-8222-222222222222'];
  await client.query('set enable_indexscan = off; set enable_bitmapscan = off;');
  const q4Base = await explain('unread notifications baseline', q4, params4);
  await client.query('set enable_indexscan = on; set enable_bitmapscan = on;');
  await client.query('create index perf_notif_recipient_read_idx on perf_notifications (recipient_id, is_read)');
  const q4Idx = await explain('unread notifications with composite index', q4, params4);
  report('Unread notification count — recipient + is_read', q4Base, q4Idx);

  console.log('\nNote: temp tables live only for this session; no production row was read or written.');
} finally {
  await client.end();
}
