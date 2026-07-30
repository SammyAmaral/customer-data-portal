-- =========================================================================
-- Customer Data Portal — Supabase schema
--
-- One table: the explicit allow-list mapping a customer email to the exact
-- DOD engagement(s) they may view. The serverless API reads it with the
-- SERVICE ROLE key (which bypasses RLS); customers never query it directly.
--
-- Internal Zyte staff are NOT listed here — they're recognised by email
-- domain (INTERNAL_DOMAINS env, default zyte.com) and see everything.
--
-- Apply in the Supabase SQL editor, then grant access with rows like:
--   insert into report_access (email, epic_key) values
--     ('marilia.rosa@oboticario.com.br', 'DOD-14209');
-- =========================================================================

create table if not exists report_access (
  id          bigint generated always as identity primary key,
  email       text not null,
  epic_key    text not null,
  note        text,                              -- optional: who/why granted
  created_at  timestamptz not null default now()
);

-- Emails are matched case-insensitively by the API (ilike); store lower-case.
create unique index if not exists report_access_email_epic_uidx
  on report_access (lower(email), upper(epic_key));

create index if not exists report_access_email_idx
  on report_access (lower(email));

-- Lock the table down. RLS ON with NO policies means anon/authenticated
-- clients can read NOTHING; only the service role (used server-side by the
-- API) can read it. This is deliberate — the allow-list is a server secret.
alter table report_access enable row level security;

-- (No policies created on purpose. Manage rows via the Supabase dashboard or
--  the service role.)

-- =========================================================================
-- sow_pricing — cache of per-feed prices parsed from each engagement's SOW
-- PDF (see api/sow.js). One row per Epic; refreshed at most once a day.
-- Read/written only by the service role (server-side); RLS locked down.
-- =========================================================================
create table if not exists sow_pricing (
  epic_key    text primary key,
  ok          boolean not null default false,
  currency    text,
  by_domain   jsonb not null default '{}'::jsonb,  -- { "bigy.com": {subscriptionFee, setupFee, recordLimit}, ... }
  fetched_at  timestamptz not null default now()
);
alter table sow_pricing enable row level security;
-- (No policies — service-role only, same as report_access.)

-- =========================================================================
-- scrapy_jobs — cache of a feed's resolved Scrapy Cloud telemetry, so the
-- report doesn't hit the jobs API on every load (see api/scrapy.js).
-- One row per (epic:feed); `data` holds the computed summary (records, recent
-- volume, run count, state, errors, source prod/dev, latest job key).
-- Refreshed hourly. Service-role only.
--
-- NOTE: if you created the earlier version of this table (scalar columns keyed
-- by "{project}:{spider}"), drop it first so the new shape applies:
--   drop table if exists scrapy_jobs;
-- =========================================================================
create table if not exists scrapy_jobs (
  key           text primary key,          -- "{epicKey}:{feedKey}"
  epic_key      text,
  spider        text,
  data          jsonb,
  fetched_at    timestamptz not null default now()
);
alter table scrapy_jobs enable row level security;
-- (No policies — service-role only.)

-- -------------------------------------------------------------------------
-- Example seed (uncomment + edit). Keep emails lower-case.
-- -------------------------------------------------------------------------
-- insert into report_access (email, epic_key, note) values
--   ('marilia.rosa@oboticario.com.br', 'DOD-14209', 'Grupo Boticario - Jun 2026'),
--   ('thayze.menezes@grupoboticario.com.br', 'DOD-14209', 'Grupo Boticario - technical contact')
-- on conflict do nothing;
