-- ============================================================================
-- FDR Sentinel — 0000 one-time legacy cleanup
-- ----------------------------------------------------------------------------
-- The repository previously contained a FastAPI prototype that had already
-- pushed an incompatible, integer-keyed schema into this Supabase project:
-- public.users held password hashes, no table had any RLS policy, and there
-- were zero Supabase Auth users. That schema cannot be used with Supabase Auth
-- and stored only synthetic demo rows (a JSON backup of every legacy table was
-- taken before running this file; see README "Legacy schema migration").
--
-- The guard below makes the file idempotent: it only removes objects when the
-- legacy marker (users.password_hash) is still present.
-- ============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'password_hash'
  ) then
    drop table if exists public.clearance_records cascade;
    drop table if exists public.application_events cascade;
    drop table if exists public.fdr_lifecycle_events cascade;
    drop table if exists public.extracted_fdr_fields cascade;
    drop table if exists public.notification_preferences cascade;
    drop table if exists public.notification_events cascade;
    drop table if exists public.discrepancy_flags cascade;
    drop table if exists public.release_applications cascade;
    drop table if exists public.documents cascade;
    drop table if exists public.audit_events cascade;
    drop table if exists public.system_settings cascade;
    drop table if exists public.fdr_records cascade;
    drop table if exists public.institutions cascade;
    drop table if exists public.users cascade;
    drop function if exists public.rls_auto_enable() cascade;
    raise notice 'FDR Sentinel: removed legacy prototype schema.';
  end if;
end $$;
