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

-- -------------------------------------------------------------------------
-- Example seed (uncomment + edit). Keep emails lower-case.
-- -------------------------------------------------------------------------
-- insert into report_access (email, epic_key, note) values
--   ('marilia.rosa@oboticario.com.br', 'DOD-14209', 'Grupo Boticario - Jun 2026'),
--   ('thayze.menezes@grupoboticario.com.br', 'DOD-14209', 'Grupo Boticario - technical contact')
-- on conflict do nothing;
