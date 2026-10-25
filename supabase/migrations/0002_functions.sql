-- ============================================================================
-- FDR Sentinel — 0002 helper functions, guards, audit triggers, RPCs
-- ----------------------------------------------------------------------------
-- All privileged business rules live here so they are enforced by PostgreSQL,
-- not by hidden buttons in the browser.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Identity helpers (SECURITY DEFINER so policies can read profiles without
-- recursive RLS evaluation).
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_role()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.current_institution_id()
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.institution_id from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.current_profile_role() = 'system_admin', false) $$;

create or replace function public.is_officer()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.current_profile_role() = 'aicte_officer', false) $$;

create or replace function public.is_auditor()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.current_profile_role() = 'read_only_auditor', false) $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.current_profile_role() in ('system_admin','aicte_officer','read_only_auditor'), false) $$;

-- Institution isolation for a row that carries institution_id.
create or replace function public.can_read_institution(p_institution_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    public.is_staff() or (public.current_profile_role() = 'institution_user' and p_institution_id = public.current_institution_id()),
    false)
$$;

create or replace function public.can_write_institution(p_institution_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    public.is_admin() or public.is_officer()
    or (public.current_profile_role() = 'institution_user' and p_institution_id = public.current_institution_id()),
    false)
$$;

-- ---------------------------------------------------------------------------
-- General triggers
-- ---------------------------------------------------------------------------
create or replace function public.fn_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.fn_block_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Audit events are append-only and cannot be modified or deleted'
    using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- Profile provisioning + privilege-change guard
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_institution uuid;
begin
  begin
    v_institution := nullif(new.raw_user_meta_data ->> 'institution_id', '')::uuid;
  exception when others then
    v_institution := null;
  end;
  if v_institution is not null and not exists (select 1 from public.institutions i where i.id = v_institution) then
    v_institution := null;
  end if;

  insert into public.profiles (id, email, full_name, role, institution_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, 'user'), '@', 1)),
    'institution_user',
    v_institution
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.fn_guard_profile_changes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not v_service then
    if new.role is distinct from old.role then
      raise exception 'Role changes must be performed by a System Administrator through the server API'
        using errcode = '42501';
    end if;
    if new.institution_id is distinct from old.institution_id and not public.is_admin() then
      raise exception 'Only a System Administrator can change a user''s institution'
        using errcode = '42501';
    end if;
    if new.is_active is distinct from old.is_active and not public.is_admin() then
      raise exception 'Only a System Administrator can activate or deactivate a user'
        using errcode = '42501';
    end if;
    if new.email is distinct from old.email and not public.is_admin() then
      raise exception 'Email can only be changed by the account owner through Supabase Auth'
        using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.fn_guard_profile_changes();

-- ---------------------------------------------------------------------------
-- Append-only audit trail (generic row trigger)
-- ---------------------------------------------------------------------------
create or replace function public.fn_audit_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_role  text;
  v_action text;
  v_entity_id text;
  v_changed jsonb;
  v_row jsonb;
  v_summary text;
begin
  select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_actor;

  if tg_op = 'INSERT' then
    v_action := tg_table_name || '.created';
    v_row := to_jsonb(new);
    v_summary := initcap(replace(tg_table_name, '_', ' ')) || ' created';
  elsif tg_op = 'UPDATE' then
    v_action := tg_table_name || '.updated';
    select coalesce(jsonb_agg(k), '[]'::jsonb) into v_changed
    from jsonb_object_keys(to_jsonb(new)) k
    where (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k);
    v_row := to_jsonb(new);
    if v_changed = '[]'::jsonb then
      return new;
    end if;
    v_summary := initcap(replace(tg_table_name, '_', ' ')) || ' updated';
  else
    v_action := tg_table_name || '.deleted';
    v_row := to_jsonb(old);
    v_summary := initcap(replace(tg_table_name, '_', ' ')) || ' deleted';
  end if;

  v_entity_id := coalesce(v_row ->> 'id', v_row ->> 'key', '');
  insert into public.audit_events
    (actor_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
  values (
    v_actor, v_email, v_role, v_action, tg_table_name, v_entity_id, v_summary,
    jsonb_build_object('op', tg_op, 'changed_fields', coalesce(v_changed, '[]'::jsonb))
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_events_append_only on public.audit_events;
create trigger trg_audit_events_append_only before update or delete on public.audit_events
  for each row execute function public.fn_block_audit_mutation();

do $$
declare
  t text;
  tables text[] := array['institutions','fdr_records','fdr_documents','discrepancy_flags',
                         'release_applications','profiles','verification_events','system_settings'];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.fn_audit_row()', t);
  end loop;
end $$;

-- updated_at maintenance
do $$
declare
  t text;
  tables text[] := array['institutions','fdr_records','discrepancy_flags','release_applications','system_settings'];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$I
                    for each row execute function public.fn_touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Client-callable audit helper (report exports, OCR runs, downloads)
-- ---------------------------------------------------------------------------
create or replace function public.fn_log_event(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_summary text default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if p_action is null or length(trim(p_action)) = 0 then
    raise exception 'action is required' using errcode = '22023';
  end if;
  insert into public.audit_events (actor_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
  values (v_uid, v_profile.email, v_profile.role, p_action, p_entity_type,
          nullif(p_entity_id, ''), nullif(p_summary, ''), coalesce(p_metadata, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Discrepancy flags: deterministic rules computed client-side, persisted and
-- reviewed through these RPCs so a flag can never be fabricated for an FDR the
-- caller cannot access, nor silently edited after review.
-- ---------------------------------------------------------------------------
create or replace function public.fn_upsert_discrepancy_flags(
  p_fdr_id uuid,
  p_flags jsonb
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_fdr public.fdr_records;
  v_flag jsonb;
  v_count integer := 0;
  v_keep text[] := array[]::text[];
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_fdr from public.fdr_records where id = p_fdr_id;
  if not found then
    raise exception 'FDR record not found' using errcode = 'P0002';
  end if;
  if not public.can_write_institution(v_fdr.institution_id) then
    raise exception 'Not authorized to record verification findings for this FDR' using errcode = '42501';
  end if;
  if p_flags is null or jsonb_typeof(p_flags) <> 'array' then
    raise exception 'p_flags must be a JSON array' using errcode = '22023';
  end if;

  -- Trusted-write marker: the record's verification_status is maintained by
  -- this SECURITY DEFINER function, not by the institution's own UPDATE grant.
  perform set_config('fdr.trusted_write', 'on', true);

  for v_flag in select * from jsonb_array_elements(p_flags) loop
    if coalesce(v_flag ->> 'rule_code', '') = '' or coalesce(v_flag ->> 'field_name', '') = '' then
      continue;
    end if;
    insert into public.discrepancy_flags
      (fdr_id, institution_id, rule_code, field_name, severity, submitted_value,
       compared_value, explanation, status, detected_at)
    values (
      p_fdr_id, v_fdr.institution_id, v_flag ->> 'rule_code', v_flag ->> 'field_name',
      coalesce(nullif(v_flag ->> 'severity', ''), 'warning'),
      nullif(v_flag ->> 'submitted_value', ''),
      nullif(v_flag ->> 'compared_value', ''),
      coalesce(nullif(v_flag ->> 'explanation', ''), 'Detected by an automated rule.'),
      'open', now()
    )
    on conflict on constraint discrepancy_flags_unique_rule do update
      set submitted_value = excluded.submitted_value,
          compared_value  = excluded.compared_value,
          explanation     = excluded.explanation,
          severity        = excluded.severity,
          detected_at     = now(),
          updated_at      = now()
      where public.discrepancy_flags.status = 'open';
    v_keep := v_keep || (v_flag ->> 'rule_code' || '::' || (v_flag ->> 'field_name'));
    v_count := v_count + 1;
  end loop;

  -- Retire open flags produced by earlier runs whose condition no longer holds.
  delete from public.discrepancy_flags
  where fdr_id = p_fdr_id
    and status = 'open'
    and (rule_code || '::' || field_name) <> all (v_keep);

  update public.fdr_records
    set verification_status = case
          when verification_status in ('pending','in_review')
               and exists (select 1 from public.discrepancy_flags f where f.fdr_id = p_fdr_id and f.status in ('open','under_review'))
            then 'flagged' else verification_status end
    where id = p_fdr_id;

  perform set_config('fdr.trusted_write', 'off', true);
  return v_count;
end $$;

create or replace function public.fn_review_discrepancy(
  p_flag_id uuid,
  p_status text,
  p_note text default null
) returns public.discrepancy_flags
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_profile_role();
  v_flag public.discrepancy_flags;
  v_prev text;
  v_fdr public.fdr_records;
begin
  if v_role not in ('system_admin','aicte_officer') then
    raise exception 'Only an AICTE Officer or System Administrator may review discrepancy flags' using errcode = '42501';
  end if;
  if p_status not in ('under_review','resolved','accepted') then
    raise exception 'Invalid review status: %', p_status using errcode = '22023';
  end if;
  select * into v_flag from public.discrepancy_flags where id = p_flag_id for update;
  if not found then raise exception 'Discrepancy flag not found' using errcode = 'P0002'; end if;
  v_prev := v_flag.status;

  update public.discrepancy_flags
    set status = p_status,
        reviewer_id = v_uid,
        reviewer_notes = p_note,
        reviewed_at = now(),
        updated_at = now()
    where id = p_flag_id
    returning * into v_flag;

  select * into v_fdr from public.fdr_records where id = v_flag.fdr_id;

  insert into public.notifications (recipient_id, category, title, body, link, fdr_id, dedupe_key)
  select p.id, 'discrepancy',
         'Discrepancy ' || replace(p_status, '_', ' '),
         'A verification flag on ' || v_fdr.fdr_reference_number || ' was marked ' || replace(p_status, '_', ' ') || '.',
         '/fdrs/' || v_fdr.id,
         v_fdr.id,
         'discrepancy:' || v_flag.id || ':' || p_status
  from public.profiles p
  where p.institution_id = v_fdr.institution_id and p.role = 'institution_user' and p.is_active
  on conflict (dedupe_key) do nothing;

  insert into public.audit_events (actor_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
  select v_uid, p.email, p.role, 'discrepancy.' || p_status, 'discrepancy_flags', v_flag.id::text,
         'Discrepancy ' || v_prev || ' -> ' || p_status,
         jsonb_build_object('previous_status', v_prev, 'new_status', p_status, 'fdr_id', v_fdr.id)
  from public.profiles p where p.id = v_uid;

  return v_flag;
end $$;

-- ---------------------------------------------------------------------------
-- Officer verification decision
-- ---------------------------------------------------------------------------
create or replace function public.fn_verify_fdr(
  p_fdr_id uuid,
  p_decision text,
  p_observations text default null
) returns public.fdr_records
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_profile_role();
  v_fdr public.fdr_records;
  v_prev text;
  v_open_flags integer;
begin
  if v_role not in ('system_admin','aicte_officer') then
    raise exception 'Only an AICTE Officer or System Administrator may record verification decisions' using errcode = '42501';
  end if;
  if p_decision not in ('in_review','verified','rejected') then
    raise exception 'Invalid verification decision: %', p_decision using errcode = '22023';
  end if;
  select * into v_fdr from public.fdr_records where id = p_fdr_id for update;
  if not found then raise exception 'FDR record not found' using errcode = 'P0002'; end if;
  v_prev := v_fdr.verification_status;

  select count(*) into v_open_flags from public.discrepancy_flags
    where fdr_id = p_fdr_id and status in ('open','under_review');
  if p_decision = 'verified' and v_open_flags > 0 then
    raise exception 'Resolve or accept all unresolved discrepancy flags before marking this FDR verified'
      using errcode = '22023';
  end if;

  update public.fdr_records
    set verification_status = p_decision,
        last_verified_at = case when p_decision = 'verified' then now() else last_verified_at end,
        administrative_status = case
          when p_decision = 'verified' and administrative_status = 'registered' then 'verified'
          else administrative_status end
    where id = p_fdr_id
    returning * into v_fdr;

  insert into public.verification_events (fdr_id, institution_id, action, previous_status, new_status, observations, actor_id)
  values (p_fdr_id, v_fdr.institution_id, 'verification_' || p_decision, v_prev, p_decision, p_observations, v_uid);

  insert into public.notifications (recipient_id, category, title, body, link, fdr_id, dedupe_key)
  select p.id, 'verification',
         'Verification status updated',
         v_fdr.fdr_reference_number || ' is now marked "' || replace(p_decision, '_', ' ') || '" after officer review.',
         '/fdrs/' || v_fdr.id, v_fdr.id,
         'verification:' || v_fdr.id || ':' || p_decision || ':' || extract(epoch from now())::bigint
  from public.profiles p
  where p.institution_id = v_fdr.institution_id and p.role = 'institution_user' and p.is_active
  on conflict (dedupe_key) do nothing;

  insert into public.audit_events (actor_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
  select v_uid, p.email, p.role, 'fdr.verification_' || p_decision, 'fdr_records', v_fdr.id::text,
         'Verification ' || v_prev || ' -> ' || p_decision,
         jsonb_build_object('previous_status', v_prev, 'new_status', p_decision, 'observations', p_observations)
  from public.profiles p where p.id = v_uid;

  return v_fdr;
end $$;

-- ---------------------------------------------------------------------------
-- Release / renewal workflow transitions
-- ---------------------------------------------------------------------------
create or replace function public.fn_transition_application(
  p_application_id uuid,
  p_new_status text,
  p_note text default null
) returns public.release_applications
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_profile_role();
  v_app public.release_applications;
  v_prev text;
  v_allowed text[];
  v_allow_self boolean := false;
  v_fdr public.fdr_records;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  select * into v_app from public.release_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;

  if not (v_role in ('system_admin','aicte_officer')
          or (v_role = 'institution_user' and v_app.institution_id = public.current_institution_id())) then
    raise exception 'Not authorized for this application' using errcode = '42501';
  end if;

  v_prev := v_app.status;
  v_allowed := case v_prev
    when 'draft' then array['submitted']
    when 'submitted' then array['under_review','info_required','rejected']
    when 'under_review' then array['info_required','approved','rejected']
    when 'info_required' then array['resubmitted']
    when 'resubmitted' then array['under_review','approved','rejected']
    when 'approved' then array['completed']
    else array[]::text[] end;

  if not (p_new_status = any (v_allowed)) then
    raise exception 'Invalid workflow transition: % -> %', v_prev, p_new_status using errcode = '22023';
  end if;

  if p_new_status in ('under_review','info_required','approved','rejected','completed')
     and v_role not in ('system_admin','aicte_officer') then
    raise exception 'Only an AICTE Officer or System Administrator may perform that action' using errcode = '42501';
  end if;

  if p_new_status in ('submitted','resubmitted')
     and v_role not in ('institution_user','system_admin') then
    raise exception 'Only the submitting institution may submit or resubmit an application' using errcode = '42501';
  end if;

  if p_new_status in ('approved','completed') and v_app.requested_by = v_uid then
    select coalesce((value ->> 'allow_self_approval')::boolean, false) into v_allow_self
      from public.system_settings where key = 'workflow';
    if not coalesce(v_allow_self, false) then
      raise exception 'You cannot approve or complete an application you submitted'
        using errcode = '42501';
    end if;
  end if;

  update public.release_applications
    set status = p_new_status,
        decided_by = case when p_new_status in ('approved','rejected') then v_uid else decided_by end,
        decided_at = case when p_new_status in ('approved','rejected') then now() else decided_at end,
        decision_note = case when p_new_status in ('approved','rejected') then coalesce(p_note, decision_note) else decision_note end,
        completed_at = case when p_new_status = 'completed' then now() else completed_at end,
        updated_at = now()
    where id = p_application_id
    returning * into v_app;

  insert into public.application_events (application_id, previous_status, new_status, note, actor_id, actor_role)
  values (p_application_id, v_prev, p_new_status, p_note, v_uid, v_role);

  select * into v_fdr from public.fdr_records where id = v_app.fdr_id;
  if v_fdr.id is not null then
    if p_new_status = 'approved' then
      update public.fdr_records
        set administrative_status = case when v_app.application_type = 'release' then 'release_pending' else 'under_review' end,
            renewal_status = case when v_app.application_type = 'renewal' then 'in_progress' else renewal_status end
        where id = v_fdr.id;
    elsif p_new_status = 'rejected' then
      update public.fdr_records
        set renewal_status = case when v_app.application_type = 'renewal' then 'due' else renewal_status end
        where id = v_fdr.id;
    elsif p_new_status = 'completed' then
      update public.fdr_records
        set administrative_status = case when v_app.application_type = 'release' then 'released' else 'renewed' end,
            validity_status = case when v_app.application_type = 'release' then 'closed' else validity_status end,
            renewal_status = case when v_app.application_type = 'renewal' then 'completed' else renewal_status end,
            last_verified_at = now()
        where id = v_fdr.id;
    end if;
  end if;

  insert into public.notifications (recipient_id, category, title, body, link, fdr_id, dedupe_key)
  select v_app.requested_by, 'application_status',
         'Application ' || v_app.application_no || ' ' || replace(p_new_status, '_', ' '),
         coalesce(p_note, 'Status changed to ' || replace(p_new_status, '_', ' ') || '.'),
         '/applications/' || v_app.id, v_app.fdr_id,
         'application:' || v_app.id || ':' || p_new_status
  where v_app.requested_by is not null
  on conflict (dedupe_key) do nothing;

  insert into public.audit_events (actor_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
  select v_uid, p.email, p.role, 'application.' || p_new_status, 'release_applications', v_app.id::text,
         'Application ' || v_app.application_no || ': ' || v_prev || ' -> ' || p_new_status,
         jsonb_build_object('previous_status', v_prev, 'new_status', p_new_status,
                            'application_type', v_app.application_type, 'note', p_note)
  from public.profiles p where p.id = v_uid;

  return v_app;
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard aggregate (SECURITY INVOKER: RLS scopes it to the caller's role)
-- ---------------------------------------------------------------------------
create or replace function public.fn_dashboard_summary(p_today date default null)
returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Kolkata')::date);
  v_warn int[] := array[30,15,7];
  v_result jsonb;
begin
  select coalesce(array_agg(x::int order by x::int), v_warn) into v_warn
  from public.system_settings s, jsonb_array_elements_text(coalesce(s.value, '[]'::jsonb)) x
  where s.key = 'maturity_warning_days';

  with live as (
    select f.*,
           (f.maturity_date - v_today) as days_to_maturity
    from public.fdr_records f
    where f.archived_at is null
  ),
  recorded_release as (
    select distinct a.fdr_id from public.release_applications a
    where a.application_type = 'release'
      and a.status in ('submitted','under_review','info_required','resubmitted','approved','completed')
  ),
  open_flags as (
    select distinct d.fdr_id from public.discrepancy_flags d where d.status in ('open','under_review')
  )
  select jsonb_build_object(
    'today', v_today,
    'warning_days', to_jsonb(v_warn),
    'total_records', (select count(*) from live),
    'active', (select count(*) from live where validity_status = 'active' and days_to_maturity > 0),
    'approaching', (select count(*) from live where validity_status = 'active' and days_to_maturity >= 0 and days_to_maturity <= v_warn[1]),
    'maturing_today', (select count(*) from live where validity_status = 'active' and days_to_maturity = 0),
    'matured', (select count(*) from live where validity_status = 'active' and days_to_maturity < 0),
    'matured_no_release', (select count(*) from live l
       where l.validity_status = 'active' and l.days_to_maturity < 0
         and not exists (select 1 from recorded_release r where r.fdr_id = l.id)),
    'pending_verification', (select count(*) from live where verification_status in ('pending','in_review')),
    'flagged_records', (select count(*) from live l
       where l.verification_status = 'flagged' or exists (select 1 from open_flags o where o.fdr_id = l.id)),
    'open_flags', (select count(*) from public.discrepancy_flags where status in ('open','under_review')),
    'renewals_in_progress', (select count(*) from public.release_applications a
       where a.application_type = 'renewal' and a.status in ('submitted','under_review','info_required','resubmitted')),
    'releases_in_progress', (select count(*) from public.release_applications a
       where a.application_type = 'release' and a.status in ('submitted','under_review','info_required','resubmitted')),
    'applications_awaiting_review', (select count(*) from public.release_applications a
       where a.status in ('submitted','resubmitted')),
    'unread_notifications', (select count(*) from public.notifications n
       where n.recipient_id = auth.uid() and not n.is_read),
    'institutions', (select count(*) from public.institutions),
    'verification_breakdown', coalesce((select jsonb_object_agg(verification_status, c) from (
        select verification_status, count(*) c from live group by 1) s), '{}'::jsonb),
    'institution_breakdown', coalesce((select jsonb_agg(row_to_json(t)) from (
        select i.id, i.institution_code, i.institution_name,
               count(l.id) filter (where l.validity_status = 'active' and l.days_to_maturity >= 0) as active,
               count(l.id) filter (where l.validity_status = 'active' and l.days_to_maturity < 0) as matured,
               count(l.id) filter (where l.verification_status = 'flagged') as flagged
        from public.institutions i
        left join live l on l.institution_id = i.id
        group by i.id, i.institution_code, i.institution_name
        order by i.institution_name) t), '[]'::jsonb),
    'maturity_buckets', coalesce((select jsonb_agg(row_to_json(b)) from (
        select bucket, count(*) c from (
          select case
            when validity_status <> 'active' then 'closed'
            when days_to_maturity < 0 then 'matured'
            when days_to_maturity = 0 then 'today'
            when days_to_maturity <= 7 then '0-7 days'
            when days_to_maturity <= 15 then '8-15 days'
            when days_to_maturity <= 30 then '16-30 days'
            when days_to_maturity <= 90 then '31-90 days'
            else 'over 90 days' end as bucket
          from live) x
        group by bucket) b), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Setup status (callable before sign-in so /bootstrap can decide what to show)
-- ---------------------------------------------------------------------------
create or replace function public.fn_setup_status()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'admins', (select count(*) from public.profiles where role = 'system_admin' and is_active),
    'profiles', (select count(*) from public.profiles),
    'institutions', (select count(*) from public.institutions)
  )
$$;

grant execute on function public.fn_setup_status() to anon, authenticated;
grant execute on function public.fn_dashboard_summary(date) to authenticated;
grant execute on function public.fn_log_event(text, text, text, text, jsonb) to authenticated;
grant execute on function public.fn_upsert_discrepancy_flags(uuid, jsonb) to authenticated;
grant execute on function public.fn_review_discrepancy(uuid, text, text) to authenticated;
grant execute on function public.fn_verify_fdr(uuid, text, text) to authenticated;
grant execute on function public.fn_transition_application(uuid, text, text) to authenticated;
