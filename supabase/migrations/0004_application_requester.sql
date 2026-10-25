-- ============================================================================
-- FDR Sentinel — 0004 application requester guard
-- ----------------------------------------------------------------------------
-- Every application must record who submitted it (module F: "Record the actor,
-- timestamp, previous status, new status"). The browser can create a row, so
-- the value is forced server-side: an institution user cannot claim somebody
-- else submitted their request, and an omitted value becomes the caller.
-- ============================================================================
create or replace function public.fn_set_application_requester()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if new.requested_by is null then
    new.requested_by := auth.uid();
  elsif public.current_profile_role() in ('institution_user') then
    new.requested_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_application_requester on public.release_applications;
create trigger trg_application_requester
  before insert on public.release_applications
  for each row execute function public.fn_set_application_requester();
