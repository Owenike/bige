# Vercel Production Supabase xtac Cutover Checklist

## Goal

Move the Vercel Production Supabase configuration for the `bige` project from the current legacy project to:

`https://xtacrcqosjobaqxvibvi.supabase.co`

This checklist is for preparation and manual production cutover only. Do not use it as an automated migration script.

## Current Status

- Local env has been temporarily pointed at xtac.
- xtac project URL: `https://xtacrcqosjobaqxvibvi.supabase.co`
- `docs/trial-bookings-table.sql` has been executed successfully in xtac.
- `/api/trial-booking/create` has been tested locally against xtac.
- Test rows created during local verification were cleaned up.
- `/admin/trial-bookings` has been added for reviewing trial booking submissions.
- `/api/admin/trial-bookings` is protected by the existing profile role guard.
- `/admin/trial-bookings` supports `booking_status` updates.
- Vercel Production env has not been switched to xtac yet.
- `.env.production.current` still points at `njuytroremushglyifnz.supabase.co`.

## Completed Before Cutover

- `trial_bookings` table has been created in xtac.
- Local API writes to xtac were successful.
- Trial booking test data was cleaned up.
- Admin list view is available at `/admin/trial-bookings`.
- Admin view and API permission protection are in place.
- Admin `booking_status` update flow is in place.

## Must Confirm Before Cutover

- Detailed readiness findings are documented in `docs/xtac-supabase-readiness-report.md`.
- Do not switch Vercel Production env to xtac unless the readiness report shows critical resources are ready.
- If critical resources are missing, first complete the needed schema, storage, auth, and seed-data work in xtac.
- xtac has every production table required by the rest of the site, not only `trial_bookings`.
- xtac has the `storefront-assets` storage bucket if storefront media upload or rendering depends on it. This bucket was created and verified on 2026-05-10 with public access, 5MB file size limit, and JPG/PNG/WEBP MIME restrictions.
- xtac RPC readiness has been checked in `docs/xtac-supabase-readiness-report.md`. Six of seven runtime RPC functions exist; `manage_booking_package_usage` is missing. Do not full-cutover if the booking/package flow needs this RPC.
- xtac has the required Supabase Auth users.
- xtac has the required `profiles` rows and role values for manager, member, admin, frontdesk, and platform admin flows.
- xtac must have at least one active `platform_admin`, `manager`, or manager-equivalent profile before `/admin/trial-bookings` can be used after Production cutover. The current readiness check found only one active `frontdesk` profile.
- Before Production cutover, follow `docs/xtac-auth-profile-bootstrap-plan.md` to create or migrate the minimum `platform_admin`, `manager`, and member/customer Auth/profile data. Without a `platform_admin` or `manager` / manager-equivalent profile, Production should not be switched to xtac.
- The masked platform admin candidate previously mapped to a `frontdesk` profile; this was corrected during the xtac role bootstrap recorded in `docs/xtac-auth-profile-bootstrap-plan.md`.
- xtac now has a masked `platform_admin` account (`b***69@g***.com`) and a separate masked `frontdesk` account (`b***90@g***.com`). Before cutover, still test platform admin login, `/admin/trial-bookings`, and frontdesk login; the frontdesk invite must be accepted before frontdesk login is considered ready.
- As of 2026-05-11, unauthenticated admin API checks return `401`, and the platform admin profile is present and active. Full platform admin login still requires an actual password/session or an explicitly approved email-link/reset flow before Production cutover.
- After the platform admin password was set, Code App still did not complete a credentialed login because no password or local browser session was provided to the agent. Before Production cutover, complete a real browser login test for the masked platform admin account and confirm `/admin/trial-bookings` plus `/api/admin/trial-bookings` return the authorized view/data.
- xtac has manager, member, admin, booking, storefront, payment, cron, and notification related data and schema.
- Vercel Production `NEXT_PUBLIC_SUPABASE_ANON_KEY` belongs to xtac.
- Vercel Production `SUPABASE_SERVICE_ROLE_KEY` belongs to xtac.
- Vercel Production env changes are followed by a new Production deployment.

## Vercel Production Env Keys

| Env key | Target value or source | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xtacrcqosjobaqxvibvi.supabase.co` | Public frontend Supabase URL. |
| `SUPABASE_URL` | `https://xtacrcqosjobaqxvibvi.supabase.co` | Server/API Supabase URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | xtac project's anon key | Must not be copied from njuy. |
| `SUPABASE_SERVICE_ROLE_KEY` | xtac project's service role key | High sensitivity. Production env only. |

Do not mix njuy keys with the xtac URL. Do not update only the URL while leaving old keys in place. Vercel env changes require a Production redeploy before the running site uses them.

## Manual Cutover Steps

1. Open the Vercel project `bige`.
2. Go to `Settings > Environment Variables`.
3. Filter to the `Production` environment.
4. Update these four Supabase env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Confirm all four values belong to the xtac project.
6. Save the env changes.
7. Redeploy Production.
8. After the deployment is live, run the post-cutover test checklist below.

## Post-Cutover Test Checklist

- Open `https://www.olinextech.com/`.
- Open `https://www.olinextech.com/trial-booking`.
- Submit `/trial-booking` with `cash_on_site` and confirm success.
- Submit `/trial-booking` with `online_payment` and confirm success.
- Confirm unauthenticated users cannot view `/admin/trial-bookings`.
- Log in as an allowed admin or manager and confirm `/admin/trial-bookings` can show submissions.
- Update `booking_status` from the admin page and confirm it persists.
- Open `/booking` and confirm the existing booking page still works.
- Check manager, member, frontdesk, and platform-admin login or at least confirm the pages do not crash.
- Confirm storefront images still render.
- If LINE, payment, or cron flows are active in Production, check for obvious runtime errors after cutover.

## Rollback Steps

1. Return to Vercel project `bige`.
2. Open `Settings > Environment Variables`.
3. Filter to `Production`.
4. Restore the previous njuy Supabase values:
   - njuy `NEXT_PUBLIC_SUPABASE_URL`
   - njuy `SUPABASE_URL`
   - njuy `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - njuy `SUPABASE_SERVICE_ROLE_KEY`
5. Save the env changes.
6. Redeploy Production.
7. Re-test the homepage and core pages.
8. Confirm the production error is resolved before attempting another cutover.

## Risks

- xtac has only been confirmed for the trial booking flow and `trial_bookings`.
- Other schema, storage buckets, auth users, profiles, tenant data, and role data have not been fully verified in xtac.
- Switching Production can affect login, members, bookings, manager/admin tools, storefront uploads, payment flows, cron jobs, and notifications.
- RPC metadata existence is not a substitute for functional testing; after cutover, test booking/package, entry, rollup, redemption, and refund related flows in a controlled way.
- APIs using `SUPABASE_SERVICE_ROLE_KEY` depend on the Production secret being correct and protected.
- Test data and production data must remain clearly separated during and after cutover.

## Recommended Strategy

- Do not cut the whole Production site to xtac until xtac schema, storage, auth users, profiles, and required business data are verified.
- If the immediate goal is only `/trial-booking`, avoid a full Supabase env cutover unless admin access to `/admin/trial-bookings` is also available in xtac.
- If the cutover must happen before full parity is proven, schedule it during a low-traffic window.
- Keep the previous njuy env values available as rollback material.
- Redeploy immediately after env changes.
- Test the public trial booking flow and admin review flow first, then check login, manager, member, booking, storefront, payment, cron, and notification flows.
