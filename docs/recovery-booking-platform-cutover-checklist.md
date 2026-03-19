# recovery-booking-platform Cutover Checklist

This workspace has been separated locally from the legacy BIGE project and should now be finished against a new GitHub, Vercel, and Supabase stack.

## Current local state

- Package name is `recovery-booking-platform`.
- Git remote still points to `https://github.com/Owenike/bige.git`; remote cutover is still pending.
- Legacy local Vercel link file `.vercel/project.json` has been removed.
- Local Supabase link now points to project ref `njuytroremushglyifnz`.
- Local env snapshots have been switched away from BIGE Supabase refs.
- Blackbox scripts now require `NEXT_PUBLIC_APP_URL` or a phase-specific `*_BASE_URL`; they no longer default to BIGE deployment URLs.

## New cloud projects

- GitHub repo: `recovery-booking-platform`
- Vercel project: `recovery-booking-platform`
- Supabase project ref: `njuytroremushglyifnz`
- Supabase region: `ap-southeast-1`

## Manual steps still required

1. GitHub
- Re-authenticate `gh` on this machine.
- Create the repo `Owenike/recovery-booking-platform` if it does not already exist.
- Update this workspace remote away from `Owenike/bige`.
- Push the current branch to the new remote.

2. Vercel
- Log in with `vercel login`.
- Create a new Vercel project named `recovery-booking-platform`.
- Link this workspace to the new project.
- Add env vars from the new Supabase project plus payment/webhook settings.

3. Supabase
- Confirm the new project is healthy in dashboard: `njuytroremushglyifnz`.
- Apply migrations from this workspace to the new project.
- Recreate any required storage buckets, auth providers, and seed data if needed.

4. Payment and callback
- Set `NEWEBPAY_CHECKOUT_URL`
- Set `NEWEBPAY_WEBHOOK_URL`
- Set `NEWEBPAY_WEBHOOK_SECRET`
- Update provider console webhook target to the new Vercel deployment URL.

## Deployment verification

1. Set `NEXT_PUBLIC_APP_URL` to the new production URL.
2. Deploy to the new Vercel project.
3. Run:
- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm run check:deposit-payment-fixtures`
- `npm run check:deposit-payment-samples`
- `npm run check:deposit-payment-go-live`
4. Verify:
- `/booking`
- `/manager/bookings`
- `/api/payments/newebpay/initiate`
- `/api/payments/newebpay/webhook`

## Safety notes

- Do not point this workspace back to the BIGE Vercel or Supabase projects.
- Do not reuse BIGE production webhook URLs for this project.
- Do not run blackbox scripts until `NEXT_PUBLIC_APP_URL` or the phase-specific base URL is set to the new deployment.
