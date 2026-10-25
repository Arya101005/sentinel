-- ============================================================================
-- FDR Sentinel — 0003 Row Level Security, storage policies, settings defaults
-- ----------------------------------------------------------------------------
-- Authorization is enforced here, in the database. Hiding a button is never the
-- only control. Every exposed table with application data has RLS enabled.
-- ============================================================================

alter table public.institutions        enable row level security;
alter table public.profiles            enable row level security;
alter table public.fdr_records         enable row level security;
alter table public.fdr_documents       enable row level security;
alter table public.ocr_extractions     enable row level security;
alter table public.discrepancy_flags   enable row level security;
alter table public.verification_events enable row level security;
alter table public.release_applications enable row level security;
alter table public.application_events  enable row level security;
alter table public.notifications       enable row level security;
alter table public.audit_events        enable row level security;
alter table public.system_settings     enable row level security;

-- ---------------------------------------------------------------------------
-- Institutions: reference data readable by any signed-in user, writable by admin
-- ---------------------------------------------------------------------------
drop policy if exists institutions_select on public.institutions;
create policy institutions_select on public.institutions
  for select to authenticated using (true);

drop policy if exists institutions_admin_insert on public.institutions;
create policy institutions_admin_insert on public.institutions
  for insert to authenticated with check (public.is_admin());

drop policy if exists institutions_admin_update on public.institutions;
create policy institutions_admin_update on public.institutions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists institutions_admin_delete on public.institutions;
create policy institutions_admin_delete on public.institutions
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_staff()
    or (public.current_profile_role() = 'institution_user'
        and institution_id = public.current_institution_id())
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Profile rows are created by the auth.users trigger, never by the browser.
-- Privilege columns are additionally guarded by fn_guard_profile_changes().

-- ---------------------------------------------------------------------------
-- FDR records
-- ---------------------------------------------------------------------------
drop policy if exists fdr_records_select on public.fdr_records;
create policy fdr_records_select on public.fdr_records
  for select to authenticated using (public.can_read_institution(institution_id));

drop policy if exists fdr_records_insert on public.fdr_records;
create policy fdr_records_insert on public.fdr_records
  for insert to authenticated with check (public.can_write_institution(institution_id));

drop policy if exists fdr_records_update on public.fdr_records;
create policy fdr_records_update on public.fdr_records
  for update to authenticated
  using (public.can_write_institution(institution_id))
  with check (public.can_write_institution(institution_id));

drop policy if exists fdr_records_delete on public.fdr_records;
create policy fdr_records_delete on public.fdr_records
  for delete to authenticated using (public.is_admin());

-- Institutions may maintain their own registry entries but may not touch
-- verification / administrative state, which belongs to AICTE staff.
create or replace function public.fn_guard_fdr_changes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  -- Trusted SECURITY DEFINER functions mark their internal writes explicitly.
  if coalesce(current_setting('fdr.trusted_write', true), '') = 'on' then
    return new;
  end if;
  if public.current_profile_role() = 'institution_user' then
    if new.institution_id is distinct from old.institution_id then
      raise exception 'An institution user cannot move an FDR to another institution' using errcode = '42501';
    end if;
    if new.verification_status is distinct from old.verification_status
       or new.administrative_status is distinct from old.administrative_status
       or new.last_verified_at is distinct from old.last_verified_at
       or new.archived_at is distinct from old.archived_at then
      raise exception 'Verification and administrative status can only be updated by AICTE staff'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_fdr_guard on public.fdr_records;
create trigger trg_fdr_guard before update on public.fdr_records
  for each row execute function public.fn_guard_fdr_changes();

-- ---------------------------------------------------------------------------
-- Documents, OCR results, verification events
-- ---------------------------------------------------------------------------
drop policy if exists fdr_documents_select on public.fdr_documents;
create policy fdr_documents_select on public.fdr_documents
  for select to authenticated using (public.can_read_institution(institution_id));

drop policy if exists fdr_documents_insert on public.fdr_documents;
create policy fdr_documents_insert on public.fdr_documents
  for insert to authenticated with check (public.can_write_institution(institution_id));

drop policy if exists fdr_documents_update on public.fdr_documents;
create policy fdr_documents_update on public.fdr_documents
  for update to authenticated
  using (public.can_write_institution(institution_id))
  with check (public.can_write_institution(institution_id));

drop policy if exists fdr_documents_delete on public.fdr_documents;
create policy fdr_documents_delete on public.fdr_documents
  for delete to authenticated using (public.is_admin());

drop policy if exists ocr_extractions_select on public.ocr_extractions;
create policy ocr_extractions_select on public.ocr_extractions
  for select to authenticated
  using (exists (select 1 from public.fdr_records f where f.id = fdr_id));

drop policy if exists ocr_extractions_insert on public.ocr_extractions;
create policy ocr_extractions_insert on public.ocr_extractions
  for insert to authenticated
  with check (exists (
    select 1 from public.fdr_records f
    where f.id = fdr_id and public.can_write_institution(f.institution_id)));

drop policy if exists ocr_extractions_update on public.ocr_extractions;
create policy ocr_extractions_update on public.ocr_extractions
  for update to authenticated
  using (exists (
    select 1 from public.fdr_records f
    where f.id = fdr_id and public.can_write_institution(f.institution_id)));

drop policy if exists verification_events_select on public.verification_events;
create policy verification_events_select on public.verification_events
  for select to authenticated using (public.can_read_institution(institution_id));

drop policy if exists verification_events_insert on public.verification_events;
create policy verification_events_insert on public.verification_events
  for insert to authenticated
  with check (public.is_admin() or public.is_officer());

-- ---------------------------------------------------------------------------
-- Discrepancy flags (review goes through fn_review_discrepancy)
-- ---------------------------------------------------------------------------
drop policy if exists discrepancy_flags_select on public.discrepancy_flags;
create policy discrepancy_flags_select on public.discrepancy_flags
  for select to authenticated using (public.can_read_institution(institution_id));

drop policy if exists discrepancy_flags_insert on public.discrepancy_flags;
create policy discrepancy_flags_insert on public.discrepancy_flags
  for insert to authenticated
  with check (public.can_write_institution(institution_id) and status = 'open');

drop policy if exists discrepancy_flags_update on public.discrepancy_flags;
create policy discrepancy_flags_update on public.discrepancy_flags
  for update to authenticated
  using (public.is_admin() or public.is_officer())
  with check (public.is_admin() or public.is_officer());

drop policy if exists discrepancy_flags_delete on public.discrepancy_flags;
create policy discrepancy_flags_delete on public.discrepancy_flags
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Release / renewal applications
-- ---------------------------------------------------------------------------
drop policy if exists release_applications_select on public.release_applications;
create policy release_applications_select on public.release_applications
  for select to authenticated using (public.can_read_institution(institution_id));

drop policy if exists release_applications_insert on public.release_applications;
create policy release_applications_insert on public.release_applications
  for insert to authenticated
  with check (public.can_write_institution(institution_id) and status in ('draft','submitted'));

-- Only AICTE staff may update an application row directly. Institutions move
-- their own applications through fn_transition_application().
drop policy if exists release_applications_update on public.release_applications;
create policy release_applications_update on public.release_applications
  for update to authenticated
  using (public.is_admin() or public.is_officer())
  with check (public.is_admin() or public.is_officer());

drop policy if exists release_applications_delete on public.release_applications;
create policy release_applications_delete on public.release_applications
  for delete to authenticated using (public.is_admin());

drop policy if exists application_events_select on public.application_events;
create policy application_events_select on public.application_events
  for select to authenticated
  using (exists (
    select 1 from public.release_applications a
    where a.id = application_id and public.can_read_institution(a.institution_id)));

-- ---------------------------------------------------------------------------
-- Notifications (own rows only; created by trusted server-side processes)
-- ---------------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated using (recipient_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated using (recipient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Audit trail: readable by authorised roles, writable only by triggers and
-- SECURITY DEFINER functions. No INSERT/UPDATE/DELETE policy is defined.
-- ---------------------------------------------------------------------------
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.is_staff() or actor_id = auth.uid());

revoke insert, update, delete on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
revoke insert, update, delete on public.application_events from anon, authenticated;
revoke insert, update, delete on public.notifications from anon, authenticated;
grant update, delete on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- System settings
-- ---------------------------------------------------------------------------
drop policy if exists system_settings_select on public.system_settings;
create policy system_settings_select on public.system_settings
  for select to authenticated using (true);

drop policy if exists system_settings_admin_insert on public.system_settings;
create policy system_settings_admin_insert on public.system_settings
  for insert to authenticated with check (public.is_admin());

drop policy if exists system_settings_admin_update on public.system_settings;
create policy system_settings_admin_update on public.system_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists system_settings_admin_delete on public.system_settings;
create policy system_settings_admin_delete on public.system_settings
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Private document bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fdr-documents', 'fdr-documents', false, 10485760,
        array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fdr_documents_storage_read on storage.objects;
create policy fdr_documents_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fdr-documents'
    and (public.is_staff()
         or (storage.foldername(name))[1] = public.current_institution_id()::text)
  );

drop policy if exists fdr_documents_storage_write on storage.objects;
create policy fdr_documents_storage_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fdr-documents'
    and (public.is_staff()
         or (storage.foldername(name))[1] = public.current_institution_id()::text)
  );

drop policy if exists fdr_documents_storage_update on storage.objects;
create policy fdr_documents_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fdr-documents'
    and (public.is_staff()
         or (storage.foldername(name))[1] = public.current_institution_id()::text)
  )
  with check (bucket_id = 'fdr-documents');

drop policy if exists fdr_documents_storage_delete on storage.objects;
create policy fdr_documents_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'fdr-documents' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Default configuration
-- ---------------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
  ('maturity_warning_days', '[30, 15, 7]'::jsonb,
   'Days before maturity at which an FDR enters the warning window.'),
  ('notification_channels', '{"in_app": true, "email": false}'::jsonb,
   'Notification channels. Email requires a configured provider; the UI states clearly when it is unavailable.'),
  ('workflow', '{"allow_self_approval": false}'::jsonb,
   'Workflow policy flags. Self-approval is disabled by default.'),
  ('timezone', '"Asia/Kolkata"'::jsonb,
   'Policy timezone used for all maturity "today" calculations.'),
  ('organization', '{"name": "AICTE", "department": "Regulation Bureau", "tagline": "Monitor Smarter. Verify Better. Act on Time."}'::jsonb,
   'Regulator identity shown in the interface.'),
  ('demo_data', '{"enabled": true, "label": "DEMONSTRATION DATA"}'::jsonb,
   'Marks synthetic demonstration records. Never mix demo rows into real data without authorisation.'),
  ('verification_policy', '{"external_bank_api": false, "note": "No bank or AICTE verification service is connected. OCR output is a candidate value for human review, never proof of authenticity."}'::jsonb,
   'Describes the limits of automated verification.')
on conflict (key) do nothing;

-- Explicit grants for policy helper functions.
grant execute on function
  public.current_profile_role(),
  public.current_institution_id(),
  public.is_admin(),
  public.is_officer(),
  public.is_auditor(),
  public.is_staff(),
  public.can_read_institution(uuid),
  public.can_write_institution(uuid)
to anon, authenticated;
