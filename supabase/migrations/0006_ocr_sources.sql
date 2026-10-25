-- ---------------------------------------------------------------------------
-- 0006 — OCR field provenance
-- ---------------------------------------------------------------------------
-- Stores, per extraction, the document text line each candidate value was read
-- from so a reviewer can see *where* an extracted value came from. This is
-- provenance for human review only: a stored source line never makes a value
-- "verified".
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

alter table public.ocr_extractions
  add column if not exists field_sources jsonb not null default '{}'::jsonb;

comment on column public.ocr_extractions.field_sources is
  'Map of extracted field name -> the source line of the document text the value was read from. Empty when unknown.';
