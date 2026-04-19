-- Free-tier cron setup for Mail Automation.
-- Runs INSIDE Supabase (free) instead of Vercel Cron (requires Pro for 1-min schedules).
--
-- BEFORE RUNNING:
--  1. Deploy the app first so you have a real URL.
--  2. Replace <APP_URL>  with e.g. https://your-app.vercel.app  (no trailing slash)
--  3. Replace <CRON_SECRET> with the value in your Vercel / .env.local
--
-- Run this in the Supabase SQL Editor. Idempotent — safe to re-run.

create extension if not exists pg_cron   with schema extensions;
create extension if not exists pg_net    with schema extensions;

-- Remove any previous schedules with the same names
select cron.unschedule('mail-automation-tick')         where exists (select 1 from cron.job where jobname = 'mail-automation-tick');
select cron.unschedule('mail-automation-check-replies') where exists (select 1 from cron.job where jobname = 'mail-automation-check-replies');

-- Tick every minute
select cron.schedule(
  'mail-automation-tick',
  '* * * * *',
  $$
    select net.http_get(
      url := '<APP_URL>/api/tick',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
    );
  $$
);

-- Reply check every 5 minutes
select cron.schedule(
  'mail-automation-check-replies',
  '*/5 * * * *',
  $$
    select net.http_get(
      url := '<APP_URL>/api/check-replies',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
    );
  $$
);

-- To see scheduled jobs:
--   select jobname, schedule, active from cron.job;
-- To see recent runs:
--   select * from cron.job_run_details order by start_time desc limit 20;
-- To pause:
--   update cron.job set active = false where jobname = 'mail-automation-tick';
