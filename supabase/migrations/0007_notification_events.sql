-- ---------------------------------------------------------------------------
-- 0007 — Per-event notification preferences
-- ---------------------------------------------------------------------------
-- Lets an administrator choose which maturity events generate in-app
-- notifications. A missing key or a missing entry means "enabled", so the
-- default behaviour is unchanged until someone edits it.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

insert into public.system_settings (key, value, description)
values (
  'notification_events',
  '{"maturity_upcoming": true, "maturity_today": true, "matured_no_application": true}'::jsonb,
  'Which maturity events generate in-app notifications during the scheduled scan.'
)
on conflict (key) do nothing;
