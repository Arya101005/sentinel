-- ============================================================================
-- FDR Sentinel — 0001 application schema
-- ----------------------------------------------------------------------------
-- Target: Supabase / PostgreSQL 15+
-- Re-runnable: every object uses IF NOT EXISTS.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table if not exists public.institutions (
  id                uuid primary key default gen_random_uuid(),
  institution_code  text not null unique,
  institution_name  text not null,
  institution_type  text not null default 'Engineering'
                    check (institution_type in ('Engineering','Management','Pharmacy','Architecture','Hotel Management','Applied Arts','Other')),
  region            text,
  address           text,
  contact_email     text,
  contact_phone     text,
  status            text not null default 'active' check (status in ('active','inactive')),
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One profile per Supabase Auth user. Roles are only ever changed by a
-- privileged server-side process (service role) — enforced by trigger 0002.
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  full_name      text not null default '',
  role           text not null default 'institution_user'
                 check (role in ('system_admin','aicte_officer','institution_user','read_only_auditor')),
  institution_id uuid references public.institutions(id) on delete set null,
  phone          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists profiles_email_key on public.profiles (lower(email));
create index if not exists profiles_institution_idx on public.profiles (institution_id);

-- ---------------------------------------------------------------------------
-- FDR registry
-- ---------------------------------------------------------------------------
create table if not exists public.fdr_records (
  id                      uuid primary key default gen_random_uuid(),
  institution_id          uuid not null references public.institutions(id) on delete restrict,
  fdr_reference_number    text not null check (length(trim(fdr_reference_number)) >= 3),
  issuing_bank            text not null check (length(trim(issuing_bank)) >= 2),
  branch_name             text,
  deposit_amount          numeric(14,2) not null check (deposit_amount > 0),
  issue_date              date not null,
  maturity_date           date not null,
  -- instrument validity (maturity itself is always derived from maturity_date)
  validity_status         text not null default 'active' check (validity_status in ('active','closed','cancelled')),
  renewal_status          text not null default 'not_required'
                          check (renewal_status in ('not_required','due','requested','in_progress','completed')),
  administrative_status   text not null default 'registered'
                          check (administrative_status in ('registered','under_review','verified','release_pending','released','renewed','archived')),
  verification_status     text not null default 'pending'
                          check (verification_status in ('pending','in_review','verified','flagged','rejected')),
  notes                   text,
  submitted_at            timestamptz not null default now(),
  last_verified_at        timestamptz,
  archived_at             timestamptz,
  is_demo                 boolean not null default false,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint fdr_maturity_after_issue check (maturity_date > issue_date)
);

-- An FDR reference number is unique per institution among live records.
-- Likely-duplicate detection for *similar* (not identical) references is a
-- review flag, never an automatic merge.
create unique index if not exists fdr_records_ref_unique
  on public.fdr_records (institution_id, lower(fdr_reference_number))
  where archived_at is null;
create index if not exists fdr_records_institution_idx on public.fdr_records (institution_id);
create index if not exists fdr_records_maturity_idx on public.fdr_records (maturity_date);
create index if not exists fdr_records_verification_idx on public.fdr_records (verification_status);
create index if not exists fdr_records_admin_status_idx on public.fdr_records (administrative_status);
create index if not exists fdr_records_bank_idx on public.fdr_records (lower(issuing_bank));

-- ---------------------------------------------------------------------------
-- Documents + OCR
-- ---------------------------------------------------------------------------
create table if not exists public.fdr_documents (
  id             uuid primary key default gen_random_uuid(),
  fdr_id         uuid not null references public.fdr_records(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete restrict,
  storage_path   text not null unique,
  file_name      text not null,
  mime_type      text not null
                 check (mime_type in ('application/pdf','image/png','image/jpeg','image/webp')),
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  document_type  text not null default 'fdr_receipt'
                 check (document_type in ('fdr_receipt','renewal_receipt','release_proof','other')),
  is_current     boolean not null default true,
  ocr_status     text not null default 'not_processed'
                 check (ocr_status in ('not_processed','processing','completed','failed','skipped')),
  uploaded_by    uuid references public.profiles(id) on delete set null,
  uploaded_at    timestamptz not null default now(),
  replaced_at    timestamptz
);
create index if not exists fdr_documents_fdr_idx on public.fdr_documents (fdr_id);
create index if not exists fdr_documents_institution_idx on public.fdr_documents (institution_id);

create table if not exists public.ocr_extractions (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references public.fdr_documents(id) on delete cascade,
  fdr_id            uuid not null references public.fdr_records(id) on delete cascade,
  engine            text not null default 'tesseract.js',
  status            text not null default 'completed' check (status in ('completed','failed')),
  raw_text          text,
  fields            jsonb not null default '{}'::jsonb,
  field_confidence  jsonb not null default '{}'::jsonb,
  average_confidence numeric(5,2),
  error_message     text,
  processed_by      uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists ocr_extractions_fdr_idx on public.ocr_extractions (fdr_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Verification & discrepancy review
-- ---------------------------------------------------------------------------
create table if not exists public.discrepancy_flags (
  id               uuid primary key default gen_random_uuid(),
  fdr_id           uuid not null references public.fdr_records(id) on delete cascade,
  institution_id   uuid not null references public.institutions(id) on delete restrict,
  rule_code        text not null,
  field_name       text not null,
  severity         text not null default 'warning' check (severity in ('info','warning','critical')),
  submitted_value  text,
  compared_value   text,
  explanation      text not null,
  status           text not null default 'open'
                   check (status in ('open','under_review','resolved','accepted')),
  reviewer_id      uuid references public.profiles(id) on delete set null,
  reviewer_notes   text,
  reviewed_at      timestamptz,
  detected_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint discrepancy_flags_unique_rule unique (fdr_id, rule_code, field_name)
);
create index if not exists discrepancy_flags_fdr_idx on public.discrepancy_flags (fdr_id);
create index if not exists discrepancy_flags_status_idx on public.discrepancy_flags (status);

create table if not exists public.verification_events (
  id               uuid primary key default gen_random_uuid(),
  fdr_id           uuid not null references public.fdr_records(id) on delete cascade,
  institution_id   uuid not null references public.institutions(id) on delete restrict,
  action           text not null,
  previous_status  text,
  new_status       text,
  observations     text,
  actor_id         uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists verification_events_fdr_idx on public.verification_events (fdr_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Release / renewal applications
-- ---------------------------------------------------------------------------
create table if not exists public.release_applications (
  id               uuid primary key default gen_random_uuid(),
  application_no   text not null unique
                   default ('APP-' || to_char(now(), 'YYYY') || '-' ||
                            upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  fdr_id           uuid not null references public.fdr_records(id) on delete cascade,
  institution_id   uuid not null references public.institutions(id) on delete restrict,
  application_type text not null check (application_type in ('release','renewal')),
  status           text not null default 'submitted'
                   check (status in ('draft','submitted','under_review','info_required','resubmitted','approved','rejected','completed')),
  reason           text,
  amount_claimed   numeric(14,2) check (amount_claimed is null or amount_claimed > 0),
  supporting_notes text,
  requested_by     uuid references public.profiles(id) on delete set null,
  submitted_at     timestamptz not null default now(),
  decided_by       uuid references public.profiles(id) on delete set null,
  decided_at       timestamptz,
  decision_note    text,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists release_applications_fdr_idx on public.release_applications (fdr_id);
create index if not exists release_applications_institution_idx on public.release_applications (institution_id);
create index if not exists release_applications_status_idx on public.release_applications (status);

create table if not exists public.application_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.release_applications(id) on delete cascade,
  previous_status text,
  new_status     text not null,
  note           text,
  actor_id       uuid references public.profiles(id) on delete set null,
  actor_role     text,
  created_at     timestamptz not null default now()
);
create index if not exists application_events_app_idx on public.application_events (application_id, created_at);

-- ---------------------------------------------------------------------------
-- Notifications, audit, settings
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  category     text not null
               check (category in ('maturity_upcoming','maturity_today','matured_no_application','discrepancy','missing_document','renewal_deadline','application_status','verification')),
  title        text not null,
  body         text,
  link         text,
  fdr_id       uuid references public.fdr_records(id) on delete cascade,
  dedupe_key   text not null unique,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

create table if not exists public.audit_events (
  id          bigserial primary key,
  actor_id    uuid,
  actor_email text,
  actor_role  text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  summary     text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_events_created_idx on public.audit_events (created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index if not exists audit_events_actor_idx on public.audit_events (actor_id);

create table if not exists public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
