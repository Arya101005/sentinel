-- ---------------------------------------------------------------------------
-- 0008 — Indexes for the observed hot-path queries
-- ---------------------------------------------------------------------------
-- Every index below was justified with EXPLAIN (ANALYZE, BUFFERS) against a
-- 200,000-row synthetic copy of the real queries (scripts/explain.mjs), because
-- at demo-scale row counts the planner correctly prefers sequential scans and
-- an index decision would otherwise be guesswork. Measured results at 200k rows:
--
--   registry page  (order by updated_at desc, live only)  86.2ms -> 0.1ms
--   maturity window(active, maturity_date between, live)  33.5ms -> 0.9ms
--   institution queue (institution + maturity window)     34.8ms -> 0.0ms
--   unread notifications (recipient + is_read)            23.5ms -> 0.0ms
--
-- Partial indexes keep them small: archived records are excluded from every
-- monitoring query in the product, so they are excluded from the indexes too.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

create index if not exists fdr_records_live_updated_idx
  on public.fdr_records (updated_at desc)
  where archived_at is null;

create index if not exists fdr_records_live_maturity_idx
  on public.fdr_records (validity_status, maturity_date)
  where archived_at is null;

create index if not exists fdr_records_inst_maturity_idx
  on public.fdr_records (institution_id, maturity_date)
  where archived_at is null;

create index if not exists notifications_recipient_read_idx
  on public.notifications (recipient_id, is_read);
