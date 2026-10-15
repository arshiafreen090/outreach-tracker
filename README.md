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
| 3 | Gmail forwarder + parsers for accepts and job alerts, tested on your real emails, plus the Unknown accepts page. Still to do on your side: apply migration 0004, deploy, install the script. Reply emails need a sample. No Telegram: alerts are badges in the dashboard | built, not yet live |
| 4 | Replies, follow-ups (derived from your settings), status picker, and the Google Sheet mirror | built; needs migration 0005 and the Sheet script installed |
| 5 | Jobs feed | |
| 6 | Companies page, find-people links, company discovery and blurbs | |

## Accounts you need (all free)

| Account | Needed from | For |
|---|---|---|
| [Supabase](https://supabase.com) | Phase 1 | Database + login |
| GitHub (private repo) | Phase 2 | Code, and Vercel deploys from it |
| [Vercel](https://vercel.com) (Hobby) | Phase 2 | Hosting the dashboard |
| Personal Google account (@gmail.com) | Phase 3 | Gmail Apps Script, Google Sheet |

## Phase 1 setup

Developed and tested on Node 24 and npm 11.

1. **Create a Supabase project** (free plan) in your organisation. The form asks for a database password: save it in a password manager; this app never uses it. Then open the project's API Keys page and note the project URL, the *publishable* key (`sb_publishable_...`) and the *secret* key (`sb_secret_...`). The secret key bypasses RLS: it goes only into `.env.local`, never into chat, a commit or a `NEXT_PUBLIC_` variable.
2. **Create the schema.** Run `npm run sql:copy` (Windows: puts both migrations, in order, on your clipboard), open the project's SQL Editor, paste and run. Without `clip`, run the files by hand in order: [`0001_init.sql`](supabase/migrations/0001_init.sql), [`0002_actions.sql`](supabase/migrations/0002_actions.sql), then [`0003_owner_only.sql`](supabase/migrations/0003_owner_only.sql). If you already applied the earlier ones, `npm run sql:copy:latest` copies only the newest.
3. **Lock down login.** In Authentication, turn **off** "Allow new users to sign up", then create one user with your email and a password. If the form offers "Auto Confirm User", tick it, otherwise sign-in fails until the email is confirmed. I haven't verified the exact labels in the current dashboard; `npm run doctor` (step 5) tells you if anything is off.
4. **Configure env.** `.env.local` already exists (git-ignored, with a generated `INGEST_SHARED_SECRET` for Phase 3). Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and `ALLOWED_EMAIL` (the email of the user from step 3).
5. **Check and seed.**
   ```bash
   npm install
   npm run doctor            # read-only: env, schema, auth user, sign-ups off, anonymous lock-down
   npm run seed:templates    # then run doctor once more
   npm run smoke             # optional: end-to-end test of the real flow as the owner; removes its own test rows
   ```
   `doctor` prints OK / WARN / FAIL per check and exits non-zero on any FAIL. It also catches the classic mistake of pasting the secret key into the `NEXT_PUBLIC_` variable. `seed:templates` ends with `OK: 4 templates verified.`: it inserts each template and its version 1, reads version 1 back and fails loudly unless it is byte-identical to `templates/seed.md`, then registers `ALLOWED_EMAIL` as the database's one owner. It is safe to re-run and never modifies existing templates.
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

## Phase 3: Gmail forwarder

A small, read-only Google Apps Script runs every 10 minutes in your Gmail, finds recent LinkedIn emails and sends each one, untouched, to your dashboard's `/api/ingest`. The server stores it in `email_ingest_log` (raw, idempotent per Gmail message id) and, once the parsers exist, turns accepts and replies into dashboard updates. It never touches LinkedIn.

Why it is safe: `apps-script/appsscript.json` limits the script to the `gmail.readonly` scope, so it cannot send, label, archive or delete mail. The endpoint requires `Authorization: Bearer <INGEST_SHARED_SECRET>` (compared in constant time, closed if the secret is unset) and never echoes database errors. Google's quotas are far above what this needs: 6 minutes per run, 90 minutes per day of trigger time, 20,000 fetches and 20,000 email reads per day ([quotas](https://developers.google.com/apps-script/guides/services/quotas)).

### A. Deploy the dashboard (the script runs on Google's servers, so it can't reach localhost)

1. Put the repo on a **private** GitHub repository and push. `.env.local` and `samples/` are git-ignored.
2. In Vercel, import that repository (framework: Next.js, nothing else to change).
3. Add these environment variables, copying the values from your `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ALLOWED_EMAIL`, `INGEST_SHARED_SECRET`. Mark the secret key and the ingest secret as sensitive if Vercel offers it.
4. Deploy, then check the live endpoint (it stores one synthetic email in your database and deletes it again):
   ```bash
   npm run ingest:check -- https://YOUR-APP.vercel.app
   ```
   Vercel limits request bodies to 4.5 MB ([limits](https://vercel.com/docs/functions/limitations)), which is why the script sends small batches.

### B. Install the script (signed in to the Gmail account that receives LinkedIn mail)

1. Open https://script.google.com and create a **New project**.
2. Project Settings: tick "Show appsscript.json manifest file in editor". Replace the manifest's contents with [`apps-script/appsscript.json`](apps-script/appsscript.json), and the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. Project Settings, **Script Properties**: add `INGEST_BASE_URL` (`https://YOUR-APP.vercel.app`, no trailing slash) and `INGEST_SECRET` (the value of `INGEST_SHARED_SECRET` from `.env.local`).
4. Run `testConnection` once. Google asks for permission: reading mail (read-only), connecting to an external service, and managing triggers. For a script you wrote yourself it may show a "Google hasn't verified this app" screen; that is expected.
5. Run `installTrigger` once.
6. After a few minutes, `npm run doctor` shows a **Gmail ingest** line with how many emails reached the server.

### C. What LinkedIn's emails contain (read from your real samples)

LinkedIn labels each email with `X-LinkedIn-Class` and `X-LinkedIn-Template` headers, and Gmail records whether LinkedIn's DKIM signature verified. The parser trusts an email only if it is from `@linkedin.com` **and** that signature passed; a forged "LinkedIn" email is stored but ignored.

| Email | Contains | Does not contain |
|---|---|---|
| **Accepted invitation, one person** (`INVITE-ACCEPT`, `email_accept_invite_single_01`) | name, headline, profile link, photo, time | company or role as separate fields (a company is *guessed* from the headline, only as a suggestion); when you sent the request |
| **Accepted invitations, digest** (`email_accept_invite_digest_02`, "You have 2 new connections") | the same, for each person | the same |
| **Job alert** (`SAVEDSEARCH`, `email_job_alert_digest_01`) | per job: id, title, company, location, work mode, badges ("Easy Apply"), which saved search | posting date, description, salary, an apply link other than LinkedIn's |
| **New-message email** | no sample yet | send me one when a reply arrives, and I'll write its parser |

Notes: a long headline can be cut off by LinkedIn with an ellipsis. Photo links are signed and expire, so the dashboard falls back to initials. The "people you may know" block inside an accepted-invitation email is ignored.

### D. How an accepted invitation reaches your dashboard

1. The Apps Script forwards the email; `/api/ingest` stores it raw and reads who accepted.
2. Each person is matched to a request you logged: first by profile URL, then by name, but only when exactly one open request has that name. A match moves them to **Accepted** with their photo and headline.
3. Anyone it can't match with certainty appears under **Unknown accepts**, where you link them to a pending request, add them as a new person (company prefilled from the guess, for you to check), or dismiss them.
4. Run `npm run reparse` after a parser improves, to re-read stored emails. Matching is idempotent, so repeating it is safe.

Apply migration 0004 once for this (`npm run sql:copy:latest`, paste into the SQL Editor, Run). Then `npm run ingest:check` exercises the whole accept flow with fake people and removes them again.
## Phase 4: follow-ups and the Google Sheet

### Follow-ups

The **Messaged** page groups everyone you have messaged: **Follow-up due**, **Waiting for a reply**, **Replied**, **Referral, interview or offer**, and **Dead**. The nav badge counts follow-ups due.

- **Follow-up due is derived, not stored:** you messaged them, they haven't replied since, and `follow_up_days` (Settings, default 5) have passed. Logging a follow-up restarts the clock, so it is always current and needs no scheduler. Setting a person's status to "Follow-up due" by hand also counts.
- **They replied** records the reply and moves them to Replied (never back from referral, interview or offer). **I followed up** logs that you sent a follow-up (outside this app) and restarts the clock. It only works while you are waiting on a reply.
- **Status** can be set by hand to any of the ten: new, requested, accepted, messaged, replied, follow-up due, referral, interview, offer, dead.
- **Replies are marked by you for now.** Automatic detection needs a sample of LinkedIn's new-message email; when one arrives, drop it in `samples/`.
- The follow-up message itself is yours to write: your templates cover first messages only, and I don't invent others.

Apply migration 0005 for this: `npm run sql:copy:latest`, paste into the SQL Editor, Run.

### Google Sheet mirror

Three tabs, **Accepted connections**, **Messaged** (one row per message: who, which template and version, when, plus status, reply date and whether a follow-up is due) and **Pending requests** (with days pending and the nudge flag), refreshed every 15 minutes. It is a read-only mirror: keep your own notes and charts in other tabs.

**Why this design:** the Sheet's own Apps Script *pulls* from your dashboard's `/api/sheet` with the same shared secret the Gmail forwarder uses. The alternatives were pushing through the Google Sheets API (needs a Google Cloud project and a service-account key stored as a secret) or an inbound Apps Script web app (a second public endpoint). Pulling needs neither: no new account, no new secret, nothing exposed, and everything runs as you.

**Safety:** the Sheet's script is a separate Apps Script project from the Gmail forwarder, so neither can see the other's data. Its manifest asks only for `spreadsheets.currentonly` (this one Sheet), outbound requests and triggers; no Gmail, no Drive. Names and headlines come from emails, and a Sheet cell starting with `=` is a formula that could read other cells or call the internet. So the server prefixes any such text with an apostrophe (tested) and the script also writes every cell as plain text.

**Setup** (after the dashboard is deployed):

1. In your personal Google account create a new Google Sheet (any name).
2. **Extensions > Apps Script.** In Project Settings tick "Show appsscript.json manifest file in editor". Replace the manifest with [`apps-script-sheet/appsscript.json`](apps-script-sheet/appsscript.json) and the code with [`apps-script-sheet/Code.gs`](apps-script-sheet/Code.gs).
3. Project Settings, **Script Properties**: add `INGEST_BASE_URL` (`https://YOUR-APP.vercel.app`) and `INGEST_SECRET` (the `INGEST_SHARED_SECRET` value from `.env.local`).
4. Run `syncSheet` once and accept the permissions, then run `installTrigger` once. Reload the Sheet to get an **Outreach Tracker > Sync now** menu.
5. Check the endpoint any time with `npm run sheet:check` (or `npm run sheet:check -- https://YOUR-APP.vercel.app`).

Not verified: Google's docs I could read don't spell out `spreadsheets.currentonly` (third-party sources and Google's add-on docs list it). If the editor rejects it, replace it in the manifest with `https://www.googleapis.com/auth/spreadsheets` (all your spreadsheets), which Google documents.
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

**Security.** RLS is enabled on every table. The only policy requires the caller's signed-token email to be the single row in `app_owner` (migration 0003, filled from `ALLOWED_EMAIL`), so even if public sign-ups were left on, a stranger who signs up can read and write nothing; `anon` has no access; the views use `security_invoker` so they can't leak what the tables hide. Server-only code (seed script, later the ingest API route) uses the secret key.

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
supabase/migrations/0005_followups.sql  mark_replied, mark_followed_up, set_person_status
apps-script-sheet/                  the Google Sheet mirror script (bound to your Sheet)
src/lib/sheet/                     builds the three tabs (formula-safe) for /api/sheet
src/lib/followups.ts               follow-up due logic and grouping
src/proxy.ts                       session refresh + redirect to /login
src/app/actions.ts                 server actions (each re-checks the signed-in user)
src/app/(app)/                     Accepted, Pending, Messaged, Log, Templates, Settings pages
src/app/login/                     sign-in page
src/app/dev/preview/               fixture-only UI preview (dev builds only)
src/components/                    AcceptedCard, PendingCard, forms, avatar
src/lib/categories.ts              category enum + labels
src/lib/templates/                 seed-parser, engine, seed, default-template selection
src/lib/{urls,settings,time,auth*}.ts  profile-URL keys, settings, dates, allowlist
scripts/seed-templates.mts         seeds version 1 into Supabase and verifies it
scripts/doctor.mts                 read-only health check of the live setup (npm run doctor)
scripts/print-sql.mjs              all migrations in one paste (npm run sql:copy)
tests/                             templates, schema + RPC (real migrations in PGlite), components (jsdom)
```
