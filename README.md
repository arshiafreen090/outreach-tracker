# Outreach Tracker

A personal dashboard for managing LinkedIn internship outreach: who accepted, which message to send, who replied, who needs a follow-up. Single user, free tiers only.

## Hard rules this project follows

1. **Nothing here ever touches LinkedIn.** No scraping, no automation, no extension, no unofficial API, no auto-sending. You click links and send everything yourself. The only contact with LinkedIn's servers is your own browser following links you click, plus (if you leave the setting on) loading profile photos from the image URLs in your own emails.
2. **$0.** Free tiers only. No paid APIs and no AI calls at runtime. Template choice and name/company substitution are plain deterministic code.
3. **Templates are sacred.** The originals live in [`templates/seed.md`](templates/seed.md), byte-for-byte. Only `{{first_name}}`, `{{Company}}` and `{{COMPANY_UPPER}}` are ever substituted.
4. **No secrets in git.** Use `.env.local` (git-ignored); `.env.example` lists every key.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Repo, Supabase schema, template seed + engine + tests, company categories | **done** |
| 2 | Dashboard: login, accepted/pending/messaged cards, template dropdown, copy, mark-sent, log-request form, settings, template editor | **done** (not yet exercised against a live Supabase project) |
| 3 | Gmail Apps Script parser + Telegram alerts (needs your sample emails) | |
| 4 | Google Sheet sync + follow-up tracking | |
| 5 | Jobs feed | |
| 6 | Companies page, find-people links, company discovery and blurbs | |

## Accounts you need (all free)

| Account | Needed from | For |
|---|---|---|
| [Supabase](https://supabase.com) | Phase 1 | Database + login |
| GitHub (private repo) | Phase 2 | Code, and Vercel deploys from it |
| [Vercel](https://vercel.com) (Hobby) | Phase 2 | Hosting the dashboard |
| Personal Google account (@gmail.com) | Phase 3 | Gmail Apps Script, Google Sheet |
| Telegram + [@BotFather](https://t.me/BotFather) | Phase 3 | Notifications |

## Phase 1 setup

Developed and tested on Node 24 and npm 11.

1. **Create a Supabase project** (free plan). Copy the project URL, the *publishable* key (`sb_publishable_...`) and the *secret* key (`sb_secret_...`) from the dashboard's API Keys page. The secret key bypasses RLS: keep it on your machine and server only.
2. **Create the schema.** Open the SQL Editor and run these two files, in order, one at a time: [`0001_init.sql`](supabase/migrations/0001_init.sql), then [`0002_actions.sql`](supabase/migrations/0002_actions.sql) (the atomic functions the dashboard calls).
3. **Lock down login.** In the dashboard's Auth settings, turn **off** "Allow new users to sign up". Then create one user with your email and a password (Authentication → Users). I haven't verified the exact button labels in the current dashboard, so look for the add-user option there.
4. **Configure env.** Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and `ALLOWED_EMAIL`. Leave the Phase 3 keys empty for now.
5. **Install and seed.**
   ```bash
   npm install
   npm run seed:templates
   ```
   Expected output ends with `OK: 4 templates verified.` The script inserts each template and its version 1, then reads version 1 back and fails loudly unless it is byte-identical to `templates/seed.md`. It is safe to re-run and never modifies existing rows.

6. **Run it.** `npm run dev`, open http://localhost:3000 and sign in with the user from step 3. Nothing can be read without that login: the proxy redirects everyone else to `/login`, every page re-checks, and every server action re-checks the signed-in email against `ALLOWED_EMAIL`.

Day to day:

```bash
npm test          # all tests; no Supabase needed
npm run typecheck
npm run dev
```

## Daily flow

1. **Log request** right after you send a connection request on LinkedIn: paste the profile URL and name (company and role optional; a new company asks for a category). The URL is recognised only if it looks like `linkedin.com/in/<name>`; duplicates are caught instantly.
2. **Pending** lists them oldest first, with a nudge badge after the configured number of days. Until Phase 3 reads accept emails, press **Mark accepted** yourself.
3. **Accepted** shows one card per person with the template auto-picked from the company's category, the message filled in and editable, a character count, **Copy**, **Open profile** and **Mark as sent**. You do the pasting and sending on LinkedIn.
4. **Mark as sent** records the exact text you copied, the template and its version, and moves the person to **Messaged**. A second send to the same person asks for confirmation first, and the database enforces it as well.
5. **Templates** edits create new versions (old ones are kept). **Settings** holds the follow-up days, the pending nudge days and the photo switch.

Dates are shown in India time (`Asia/Kolkata`, set in `src/lib/time.ts`).

**UI preview without Supabase:** with `npm run dev`, open http://localhost:3000/dev/preview for fixture cards (real templates, fake people). It is disabled in production builds.

## How the pieces work

**Templates.** `templates/seed.md` is parsed by `src/lib/templates/seed-parser.ts` (strict: unexpected input throws, nothing is trimmed). `src/lib/templates/engine.ts` substitutes the three placeholders in a single pass:
- A blank value leaves the placeholder visible so a missing name is obvious in the textarea.
- Names containing `$&`, `$1` or `{{...}}` come through verbatim.
- Placeholders are case-sensitive, so `{{company}}` stays as typed.

**Editing a template** means inserting a new row in `template_versions`. The DB blocks updates and deletes on that table, and `messages_sent` references the exact `(template, version)` used, so history is never lost.

**Category → template** lives in `templates.default_category` (one default per category), seeded from `seed.md`:

| Category | Default template |
|---|---|
| `quick_commerce` | Template 2 |
| `food_delivery` | Template 3 |
| `other_relevant` | Template 1 |
| `small_startup` | Template 4 (carries the "certified anime lover" warning; the line is never auto-edited) |

**Security.** RLS is enabled on every table with a single policy for the `authenticated` role; `anon` has no access; the views use `security_invoker` so they can't leak what the tables hide. Server-only code (seed script, later the ingest API route) uses the secret key.

## Verified facts and open items

Checked on 2026-10-16 against Supabase's official docs and pricing page (read through search excerpts and a page fetch, so re-check the live pages before relying on exact numbers):
- Supabase free plan: 500 MB database, 2 active projects, projects **pause after 1 week of inactivity** ([supabase.com/pricing](https://supabase.com/pricing)). Phase 3 adds a daily keepalive from the scheduled Apps Script so the project never idles.
- Supabase's built-in email sender allows **2 messages/hour and only to your project's team members** ([auth-smtp docs](https://supabase.com/docs/guides/auth/auth-smtp)), which is why login is email + password rather than magic link.
- Current key names are *publishable* and *secret* keys; the legacy `anon` and `service_role` keys still work but are being deprecated ([API keys docs](https://supabase.com/docs/guides/api/api-keys)).

- Next.js 16 renamed middleware to `proxy.ts`, and Supabase recommends `getClaims()` (signature-checked) rather than `getSession()` for server-side auth checks ([Next.js proxy docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), [Supabase SSR docs](https://supabase.com/docs/guides/auth/server-side/nextjs)). Next also notes that server actions aren't covered by the proxy, hence the per-action checks.
- LinkedIn profile URLs are `www.linkedin.com/in/<custom part>`, case-insensitive, with some members on country subdomains such as `ca.linkedin.com/in/...` ([LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a542685/manage-your-public-profile-url?lang=en)). A member can change their custom URL (the old one keeps working for about six months), so Phase 3 matching falls back to the name when a URL key doesn't match.

Not yet verified (will be checked before the phase that relies on them):
- A full round trip against a live Supabase project (sign-in, the server actions, the RPC calls through PostgREST). The SQL functions are tested in real Postgres (PGlite) and the cards in jsdom, but the supabase-js layer between them is only type-checked.
- LinkedIn people-search URL formats (Phase 6).
- Which fields LinkedIn's accept/message/job-alert emails really contain (Phase 3, from your sample emails).
- Vercel Hobby cron and Apps Script quota limits (Phases 3–4).

## Layout

```
templates/seed.md                  original template text (never edit)
supabase/migrations/0001_init.sql  schema, triggers, views, RLS
supabase/migrations/0002_actions.sql  atomic functions: log_request, mark_accepted, mark_message_sent, ...
src/proxy.ts                       session refresh + redirect to /login
src/app/actions.ts                 server actions (each re-checks the signed-in user)
src/app/(app)/                     Accepted, Pending, Messaged, Log, Templates, Settings pages
src/app/login/                     sign-in page
src/app/dev/preview/               fixture-only UI preview (dev builds only)
src/components/                    AcceptedCard, PendingCard, forms, avatar
src/lib/categories.ts              category enum + labels
src/lib/templates/                 seed-parser, engine, seed, default-template selection
src/lib/{urls,settings,time,auth*}.ts  profile-URL keys, settings, dates, allowlist
scripts/seed-templates.ts          seeds version 1 into Supabase and verifies it
tests/                             templates, schema + RPC (real migrations in PGlite), components (jsdom)
```
