# Customer Data Portal

A live, access-controlled status portal for Zyte's **Data on Demand (DOD)** engagements.
Each DOD **Epic = one customer engagement**; this app reads them live from Jira and presents:

- **Portfolio** (landing + showcase) — every engagement the signed-in user may see, with health,
  phase, PM and feed-delivery progress.
- **Customer Data Status report** (`#/report/DOD-####`) — a professional one-pager per engagement:
  health light, project details, stakeholders, a phase stepper, the data-feed status table, and
  scope / out-of-scope / project-update panels. Exportable to PDF.

Customers sign in with **their own email** (magic link) and see **only** the engagement(s) granted
to them. Internal Zyte staff (`@zyte.com`) see everything.

## Stack

- **Vite + React 18** SPA, hash-routed (`#/`, `#/report/DOD-14209`), single CSS design system.
- **Vercel serverless functions** (`api/*`) read Jira with a server-side Atlassian token — never
  exposed to the browser — mirroring the sibling `asmt-status-app` / `capacity-planner` apps.
- **Supabase Auth** (email magic-link) + a `report_access` allow-list table for authorization.

```
api/_access.js   token verification + allow-list scope + Jira fetch helpers
api/_map.js      pure Jira→report mapping (unit-tested in _map.test.mjs)
api/portfolio.js scoped list of engagements
api/epic.js      one engagement's full report (403 if not authorized)
src/App.jsx      shell: auth gate, router, design system
src/lib/         auth.js (Supabase), router.js, ui.js
src/views/       SignIn, Portfolio, Report, AccessDenied
supabase/schema.sql  report_access table + RLS
```

## Commands

```bash
npm install
npm run dev:full     # = vercel dev — app + /api functions (needs env vars). Use this.
npm run dev          # plain Vite — UI only, /api not served
npm run build        # production build (the correctness gate — no linter)
npm run test:mapping # pure-logic tests for api/_map.js (plain Node)
```

Local dev needs the Vercel CLI (`npm i -g vercel`) because the data layer is serverless.

## Configuration

Copy `.env.example` → `.env` (or set in Vercel). **Server-side** (never bundled to the browser):

| Var | Purpose |
|---|---|
| `JIRA_BASE_URL` `JIRA_EMAIL` `JIRA_API_TOKEN` | Atlassian API access (read-only) |
| `JIRA_PROJECT` | defaults to `DOD` |
| `SUPABASE_URL` `SUPABASE_ANON_KEY` | verify the caller's JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | read `report_access` (bypasses RLS) |
| `INTERNAL_DOMAINS` | comma-separated full-access domains (default `zyte.com`) |

**Client-side** (safe, anon only): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Supabase setup

1. Create a project; run `supabase/schema.sql` in the SQL editor.
2. **Auth → URL Configuration:** add your deployed origin (and `http://localhost:3000` for dev)
   to **Redirect URLs**, so the magic link returns to the app.
3. **Grant a customer access** — add a row per engagement:
   ```sql
   insert into report_access (email, epic_key, note) values
     ('marilia.rosa@oboticario.com.br', 'DOD-14209', 'Grupo Boticario - Jun 2026');
   ```
   Emails are matched case-insensitively; store them lower-case. Internal `@zyte.com` users need
   no rows.

## Access model (how sharing stays safe)

Every `/api/*` call requires the caller's Supabase JWT. The server verifies it, derives the email,
and resolves scope: **internal domain → all engagements; otherwise → only the `epic_key`s in
`report_access` for that email.** `api/epic.js` returns **403** for anything out of scope, so a
shared `#/report/DOD-####` link can never expose another customer's report — the check is on the
server, not in the browser. To share, send the customer the report link; they sign in with the
allow-listed email and land straight on their report.

## Field mapping (DOD Jira → report)

Confirmed against live data (`expand=names`). Key custom fields:
`13305` Start date · `13553` Planned Finish · `13534` RAG Status (health light) · `15692` Effort RAG ·
`13550` Account Owner (AM) · `13689/90` Customer Project Contact · `13691/92` Customer Technical
Contact · `15128` Salesforce Account Name (customer) · `13590` Scope & Assumptions · `13591` Out of
Scope · `13671` Project Status (updates). Feed rows are child `Crawling-Component`s; the phase
stepper is derived from child `Task`s + feed statuses; feed **1st Sample Sent / Sample Approved**
dates come from each feed's status-change **changelog** (the dedicated date fields are empty on DOD).
**Financial / margin fields are intentionally never rendered** (customer-safe).

## Deploy

New GitHub repo → import to Vercel (Vite preset auto-detected). Set all env vars above. Configure the
Supabase redirect URL to the production origin. Keep the Jira token as a read-only service account
where possible.

## Roadmap

- In-app admin UI (internal-only) to manage the allow-list and resend invites.
- Optional internal-only financial card.
- Salesforce integration for real MRR / commercial milestones.
- Domain-based auto-access as an alternative to the per-email allow-list.
