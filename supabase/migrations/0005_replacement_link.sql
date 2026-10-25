-- ---------------------------------------------------------------------------
-- 0005 — Renewal / replacement lineage
-- ---------------------------------------------------------------------------
-- A renewed or replaced instrument is registered as its OWN new FDR row; the
-- original record is never overwritten. This column records the lineage so the
-- original history, documents and audit trail stay intact while both sides of
-- the renewal remain navigable in the interface.
--
-- Safe to re-run: every statement is idempotent.
-- ---------------------------------------------------------------------------

alter table public.fdr_records
  add column if not exists replaces_fdr_id uuid references public.fdr_records(id) on delete set null;

create index if not exists fdr_records_replaces_idx
  on public.fdr_records (replaces_fdr_id)
  where replaces_fdr_id is not null;

-- A record can never replace itself.
do $$
begin
  alter table public.fdr_records
    add constraint fdr_records_replaces_not_self
    check (replaces_fdr_id is null or replaces_fdr_id <> id);
exception
  when duplicate_object then null;
end $$;

comment on column public.fdr_records.replaces_fdr_id is
  'Set on a renewal/replacement instrument: the earlier FDR it succeeds. The referenced record is preserved, never edited or merged.';
