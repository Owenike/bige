# Domain Auth Cutover Checklist

Date: 2026-05-11

Project: `bige`

This checklist is for future domain cutover planning only. It does not change DNS, Vercel Domains, Supabase Dashboard settings, environment variables, Auth users, profiles, or database data.

## Current Domain Context

- Current production URL: `https://www.olinextech.com`
- Current Vercel preview/test URL: `https://bige-nu.vercel.app`
- Future apex domain: `https://bigefitness.com`
- Future www domain: `https://www.bigefitness.com`

## Current Code Findings

- `/forgot-password` uses `NEXT_PUBLIC_APP_URL` when configured, otherwise it uses the current browser origin.
- `/forgot-password` sends Supabase recovery emails with `redirectTo: <origin>/reset-password`.
- `/reset-password` supports Supabase recovery links with:
  - `code` via `exchangeCodeForSession`
  - hash `access_token` / `refresh_token` via `setSession`
  - `token_hash&type=recovery` via `verifyOtp`
  - an existing valid browser session via `getSession`
- `/reset-password` updates the password with the public browser Supabase client and `supabase.auth.updateUser({ password })`.
- `/reset-password` does not use the service role key.
- `/login` accepts a relative `redirect` query and does not hardcode a domain for admin redirection.
- No root `middleware.ts` or `proxy.ts` file was found during this check.
- Admin trial booking access is guarded in the page/API flow, not through a domain-specific middleware rule.

## Hardcoded Domain Scan

Code paths checked:

- `app/forgot-password/page.tsx`
- `app/reset-password/page.tsx`
- `app/login/page.tsx`
- `app/admin`
- `lib/supabase`

Result:

- No runtime code hardcoding `https://bige-nu.vercel.app`.
- No runtime code hardcoding `https://www.olinextech.com`.
- No runtime code hardcoding `https://bigefitness.com` or `https://www.bigefitness.com`.
- Existing references to `https://www.olinextech.com` are documentation/runbook references.

## Current Recommended Supabase Site URL

Keep the Supabase Site URL as:

```text
https://www.olinextech.com
```

Do not switch the Supabase Site URL to `bigefitness.com` yet.

## Recommended Supabase Redirect URLs

Keep current production URLs:

```text
https://www.olinextech.com/login
https://www.olinextech.com/forgot-password
https://www.olinextech.com/reset-password
```

Keep current Vercel URL:

```text
https://bige-nu.vercel.app/login
https://bige-nu.vercel.app/forgot-password
https://bige-nu.vercel.app/reset-password
```

Add future apex domain URLs before cutover:

```text
https://bigefitness.com/login
https://bigefitness.com/forgot-password
https://bigefitness.com/reset-password
```

Add future www domain URLs before cutover:

```text
https://www.bigefitness.com/login
https://www.bigefitness.com/forgot-password
https://www.bigefitness.com/reset-password
```

For local testing, also keep the active local dev URL, commonly:

```text
http://localhost:3000/reset-password
```

If the local dev server runs on another port, add that port-specific `/reset-password` URL too.

## Future Manual Cutover Steps

1. Add `bigefitness.com` to Vercel Domains for the `bige` project.
2. Add `www.bigefitness.com` to Vercel Domains for the `bige` project.
3. Configure DNS records as instructed by Vercel.
4. Wait for DNS propagation.
5. Confirm Vercel SSL certificates are issued and valid for both domains.
6. Choose the final Primary Domain in Vercel.
7. Keep `https://www.olinextech.com` and `https://bige-nu.vercel.app` active during the transition window.
8. In Supabase Dashboard, add the future `bigefitness.com` and `www.bigefitness.com` Redirect URLs listed above.
9. After Vercel domain, DNS, and SSL are confirmed, change Supabase Site URL to the final Vercel Primary Domain.
10. Keep old production, Vercel, and new domain Redirect URLs for a transition period.
11. Re-test `/login`.
12. Re-test `/forgot-password`.
13. Re-test `/reset-password` from an actual Supabase password recovery email.
14. Re-test `/admin/trial-bookings` with a `platform_admin` account.
15. Re-test `/api/admin/trial-bookings` with a valid `platform_admin` session.
16. Re-test logout and a fresh login from the final Primary Domain.

## Current Recommendation

- Do not switch the Supabase Site URL to `bigefitness.com` yet.
- Do not make `bigefitness.com` the production Primary Domain until Vercel domain binding, DNS, and SSL are all complete.
- It is safe to pre-add `bigefitness.com` and `www.bigefitness.com` to Supabase Redirect URLs before the domain becomes primary.
- Keep `www.olinextech.com`, `bige-nu.vercel.app`, `bigefitness.com`, and `www.bigefitness.com` Redirect URLs during the transition window to avoid breaking password recovery and login redirects.

## Post-Cutover Auth Test Checklist

- Open `/login` on the final Primary Domain.
- Sign in with a `platform_admin` account.
- Confirm `/admin/trial-bookings` can load.
- Confirm `/api/admin/trial-bookings` returns `200` with `ok: true`.
- Sign out.
- Use `/forgot-password` on the final Primary Domain.
- Confirm the Supabase email recovery link opens `/reset-password` on an allowed domain.
- Complete password reset.
- Sign in again with the new password.

## Rollback Notes

If login or recovery breaks after domain cutover:

1. Do not delete the old Redirect URLs.
2. Confirm the recovery link domain is present in Supabase Redirect URLs.
3. Confirm the Supabase Site URL matches the intended Primary Domain.
4. Temporarily set the Vercel Primary Domain back to the known-good domain if needed.
5. Re-test password recovery from the known-good domain before attempting another cutover.
