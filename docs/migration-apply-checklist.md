# Migration Apply Checklist

This runbook is for applying the current SQL migrations to Supabase and verifying that critical functions/tables are live.

## 1) Migration Order

Apply in filename order:

1. `supabase/migrations/20260205_entry_checkin.sql`
2. `supabase/migrations/20260207_core_platform.sql`
3. `supabase/migrations/20260207_integrations_and_cron.sql`
4. `supabase/migrations/20260207_transaction_hardening.sql`
5. `supabase/migrations/20260207_entry_verify_transaction.sql`

Note:
- `20260207_transaction_hardening.sql` must be the fixed version (no leading `+` before `return;` in `member_modify_booking`).
- `20260207_entry_verify_transaction.sql` must exist; this provides transactional entry verification (`verify_entry_scan`).

## 2) Apply Migrations

### Option A: Supabase CLI (recommended)

Run in project root:

```powershell
supabase link --project-ref <your-project-ref>
supabase db push
```

If you need local reset first:

```powershell
supabase db reset
```

### Option B: Supabase SQL Editor

Run each SQL file in the order above.

## 3) Post-Migration Verification

Run:

```sql
\i supabase/post_migration_checks.sql
```

If your SQL editor does not support `\i`, copy/paste the file content and execute directly.

Expected:
- All checks return `ok = true`.
- `verify_entry_scan`, `member_modify_booking`, `redeem_session`, `apply_newebpay_webhook` are present.

## 4) App Smoke Checks

After deployment/migration, verify:

1. Member QR issue: `POST /api/entry/issue` (member auth)
2. Frontdesk verify: `POST /api/entry/verify` (frontdesk/manager auth)
3. Coach redemption: `POST /api/session-redemptions`
4. Member reschedule/cancel: `PATCH /api/member/bookings/:id`
5. NewebPay webhook flow: `POST /api/payments/newebpay/webhook`

## 5) Rollback Strategy

Current SQL migrations are forward-only. If a migration fails in production:

1. Stop traffic to affected API endpoints.
2. Fix SQL in a new migration file (do not edit applied files in-place).
3. Re-apply with `supabase db push`.
4. Re-run `supabase/post_migration_checks.sql`.

## 6) One-Click Script (PowerShell)

You can run migration + post-checks in one command:

```powershell
npm run db:migrate:apply
```

With explicit project ref (links first):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/apply-migrations.ps1 -ProjectRef <your-project-ref>
```

With explicit DB URL for post-check SQL:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/apply-migrations.ps1 -DbUrl "<postgres-connection-url>"
```

Optional flags:

- `-SkipLink`: skip `supabase link`
- `-SkipChecks`: skip `post_migration_checks.sql`

Note:
- Post-check execution requires `psql` available in PATH.
- If `-DbUrl` is not passed, script uses `SUPABASE_DB_URL` then `DATABASE_URL`.
