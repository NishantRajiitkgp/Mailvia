-- Run in Supabase SQL Editor. Idempotent — safe to re-run.

create extension if not exists pgcrypto;

create table if not exists senders (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  email text not null unique,
  app_password text not null,
  from_name text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  template text not null,
  from_name text,
  status text not null default 'draft' check (status in ('draft', 'running', 'paused', 'done')),
  daily_cap int not null default 300,
  gap_seconds int not null default 120,
  window_start_hour int not null default 8,
  window_end_hour int not null default 18,
  timezone text not null default 'Asia/Kolkata',
  sender_id uuid references senders(id) on delete set null,
  schedule jsonb,
  follow_ups_enabled boolean not null default false,
  retry_enabled boolean not null default false,
  max_retries int not null default 2,
  attachment_path text,
  attachment_filename text,
  tracking_enabled boolean not null default true,
  unsubscribe_enabled boolean not null default false,
  start_at timestamptz,
  known_vars text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table campaigns
  add column if not exists sender_id uuid references senders(id) on delete set null,
  add column if not exists schedule jsonb,
  add column if not exists follow_ups_enabled boolean not null default false,
  add column if not exists retry_enabled boolean not null default false,
  add column if not exists max_retries int not null default 2,
  add column if not exists attachment_path text,
  add column if not exists attachment_filename text,
  add column if not exists tracking_enabled boolean not null default false,
  add column if not exists unsubscribe_enabled boolean not null default true,
  add column if not exists start_at timestamptz,
  add column if not exists known_vars text[] not null default array[]::text[],
  add column if not exists archived_at timestamptz;

create index if not exists campaigns_archived_idx on campaigns(archived_at);

create table if not exists recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  company text not null,
  email text not null,
  vars jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'replied', 'unsubscribed', 'bounced')),
  sent_at timestamptz,
  last_sent_at timestamptz,
  follow_up_count int not null default 0,
  next_follow_up_at timestamptz,
  replied_at timestamptz,
  retry_count int not null default 0,
  next_retry_at timestamptz,
  error text,
  row_index int not null default 0,
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);

alter table recipients
  add column if not exists vars jsonb not null default '{}'::jsonb,
  add column if not exists last_sent_at timestamptz,
  add column if not exists follow_up_count int not null default 0,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists retry_count int not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists message_id text,
  add column if not exists domain text generated always as (lower(split_part(email, '@', 2))) stored;

create index if not exists recipients_campaign_status_idx on recipients(campaign_id, status);
create index if not exists recipients_row_idx on recipients(campaign_id, row_index);
create index if not exists recipients_next_retry_idx on recipients(next_retry_at) where next_retry_at is not null;
create index if not exists recipients_next_follow_up_idx on recipients(next_follow_up_at) where next_follow_up_at is not null;
create index if not exists recipients_domain_idx on recipients(campaign_id, domain);
create index if not exists campaigns_sender_idx on campaigns(sender_id);
create index if not exists campaigns_status_idx on campaigns(status);

create table if not exists follow_up_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step_number int not null,
  delay_days numeric not null default 4,
  subject text,
  template text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, step_number)
);

create table if not exists send_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  recipient_id uuid not null references recipients(id) on delete cascade,
  kind text not null default 'initial' check (kind in ('initial', 'follow_up', 'retry')),
  step_number int,
  sent_at timestamptz not null default now(),
  day date not null default ((now() at time zone 'Asia/Kolkata')::date)
);

alter table send_log
  add column if not exists kind text not null default 'initial',
  add column if not exists step_number int;

create index if not exists send_log_day_idx on send_log(day);
create index if not exists send_log_sent_at_idx on send_log(sent_at desc);
create index if not exists send_log_campaign_kind_idx on send_log(campaign_id, kind);

create table if not exists tracking_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references recipients(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  kind text not null check (kind in ('open', 'click')),
  url text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists tracking_events_recipient_idx on tracking_events(recipient_id);
create index if not exists tracking_events_campaign_idx on tracking_events(campaign_id, kind);

create table if not exists unsubscribes (
  email text primary key,
  campaign_id uuid references campaigns(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references recipients(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete cascade,
  from_email text not null,
  subject text,
  snippet text,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, received_at)
);

create index if not exists replies_recipient_idx on replies(recipient_id);
create index if not exists replies_received_at_idx on replies(received_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists campaigns_set_updated_at on campaigns;
create trigger campaigns_set_updated_at
before update on campaigns
for each row execute function set_updated_at();

-- storage bucket for attachments (idempotent)
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;
