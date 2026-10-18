# Outreach Leads Tracker

A personal outreach dashboard for tracking LinkedIn connection requests, accepted contacts, sent messages, follow-ups, and job opportunities without paid APIs or LinkedIn automation.

## What this project does

- Track pending outreach requests and flag overdue follow-ups
- Manage accepted connections and personalize templates
- Track messaged contacts and follow-up status
- Store job opportunities from alerts and public board sources
- Keep the workflow focused on a single user with Supabase auth and row-level security

## Tech stack

- Next.js 16
- React 19 + TypeScript
- Supabase for auth and database
- Google Apps Script for Gmail and Sheet automation
- Vitest for automated tests

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a local environment file:
   ```bash
   copy .env.example .env.local
   ```
   Then fill in the required values:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `ALLOWED_EMAIL`
   - `INGEST_SHARED_SECRET`

3. Run project checks and seed templates:
   ```bash
   npm run doctor
   npm run seed:templates
   ```

4. Start the app:
   ```bash
   npm run dev
   ```

5. Open the app in your browser at:
   ```text
   http://localhost:3000
   ```

## Common scripts

```bash
npm run dev
npm run build
npm run test
npm run typecheck
npm run doctor
npm run smoke
npm run seed:templates
```

## Repository structure

```text
src/                 App logic, pages, components, and shared libs
supabase/            SQL migrations and schema
templates/           template seed files
apps-script/         Gmail Apps Script project
apps-script-sheet/   Google Sheet sync script
scripts/             local checks and setup scripts
tests/               automated test suite
```

## Notes

- Secrets stay in `.env.local` and are ignored by git
- This project is designed around free-tier services only
- It is optimized for a single owner and private use

## License

This project is provided as-is for personal use.
