# Supabase Custom SMTP Setup Guide

## Current Assessment

- Auth Users already contains the tested account.
- Supabase Auth Logs show the `/recover` request completed.
- Supabase Auth Logs show `mail.send`.
- Gmail did not receive the reset email.
- Initial conclusion: the frontend forgot-password flow is calling Supabase successfully. The next likely issue is email deliverability or the limits/reputation of Supabase default SMTP, so production should use Custom SMTP.
- This checklist does not configure Supabase Dashboard, Resend, DNS, Vercel Domains, `.env.local`, or any secret.

## Current Domain Context

- Current production URL: `https://www.olinextech.com`
- Current Vercel preview/test URL: `https://bige-nu.vercel.app`
- Future apex domain: `https://bigefitness.com`
- Future www domain: `https://www.bigefitness.com`

Current recommendation:

- Configure Custom SMTP against the current production sender domain first.
- Use `olinextech.com` for sender verification before the domain cutover.
- Use `bigefitness.com` only after the new domain, DNS, SSL, Vercel Primary Domain, and Supabase redirect settings are ready.

## Code Check Summary

- `app/forgot-password/page.tsx` calls `supabase.auth.resetPasswordForEmail`.
- The password recovery `redirectTo` is built from `NEXT_PUBLIC_APP_URL` when present, otherwise from the current browser origin.
- `app/reset-password/page.tsx` supports Supabase recovery links through `code`, URL hash session tokens, `token_hash&type=recovery`, and an existing browser session.
- No SMTP-specific application code change is needed before configuring Custom SMTP.
- Do not use the Supabase service role key for forgot-password or reset-password pages.

## Recommended SMTP Providers

- Resend
- Brevo
- SendGrid
- Mailgun

For this project, Resend or Brevo are the preferred first choices because they are straightforward for transactional email and domain verification.

## Required Supabase Custom SMTP Inputs

Prepare these values from the SMTP provider:

- SMTP Host
- SMTP Port
- SMTP Username
- SMTP Password
- Sender Name
- Sender Email

Never commit the SMTP password, provider API key, Supabase anon key, Supabase service role key, session token, recovery token, or any real password.

## Resend SMTP Field Mapping

If using Resend, use this mapping in Supabase Custom SMTP after the Resend domain is verified:

| Supabase SMTP field | Resend value |
|---|---|
| SMTP Host | `smtp.resend.com` |
| SMTP Port | `465` first; if connection fails, try `587` |
| SMTP Username | `resend` |
| SMTP Password | Resend API Key. Do not write the actual key in this repo or any docs. |
| Sender Name | `BIGE` |
| Sender Email | `no-reply@olinextech.com` before domain cutover |

Notes:

- Create the Resend API Key in the Resend dashboard.
- Paste the API Key only into Supabase Dashboard's SMTP password field.
- Do not paste the API Key into terminal output, docs, `.env.local`, screenshots, or commits.
- If Resend rejects the sender, verify the sender domain and DNS records first.

## Recommended Sender Information

Current production domain:

```text
https://www.olinextech.com
```

If sending from the current domain first:

```text
Sender Name: BIGE
Sender Email: no-reply@olinextech.com
```

After the future domain cutover:

```text
Sender Name: BIGE
Sender Email: no-reply@bigefitness.com
```

Do not switch to `no-reply@bigefitness.com` until `bigefitness.com` has completed provider DNS verification and the site is ready to use the new domain.

## Supabase Dashboard Setup Location

Configure this manually in Supabase Dashboard:

```text
Authentication -> Email -> SMTP Settings / Custom SMTP
```

Do not configure SMTP from the repository. Do not store SMTP credentials in docs or source files.

## DNS Verification Reminder

Depending on the SMTP provider, add the provider's required DNS records in the domain DNS dashboard:

- SPF
- DKIM
- Return-Path / bounce domain
- TXT records
- CNAME records

Use exactly the records provided by Resend, Brevo, SendGrid, or Mailgun. DNS propagation can take time, so verify provider status before retesting password recovery.

For Resend specifically:

- Add only the DNS records shown in the Resend dashboard.
- Do not guess SPF, DKIM, Return-Path, TXT, or CNAME values.
- Wait until Resend marks the domain as verified.
- If the DNS host already has SPF, merge provider requirements into the existing SPF record rather than creating multiple competing SPF TXT records.
- Keep a note of which domain is verified: `olinextech.com` now, `bigefitness.com` after future cutover.

## Manual Resend + Supabase Setup Checklist

1. Open Resend.
2. Add the sender domain, currently `olinextech.com`.
3. Copy the DNS records Resend provides.
4. Add those DNS records in the domain DNS dashboard.
5. Wait for Resend domain verification to complete.
6. Create a Resend API Key for SMTP use.
7. Open Supabase Dashboard.
8. Go to `Authentication -> Email -> SMTP Settings / Custom SMTP`.
9. Enable Custom SMTP.
10. Enter the Resend SMTP field mapping from this document.
11. Save the Supabase SMTP settings.
12. Do not change Supabase Auth users, profiles, database schema, Vercel Domains, or DNS beyond the provider-required DNS records.

## Post-Setup Acceptance Flow

1. Open `https://www.olinextech.com/forgot-password`.
2. Enter the target admin email.
3. Wait 1 to 5 minutes.
4. Check Gmail Inbox, Spam, Promotions, and All Mail.
5. Search Gmail for `BIGE`, `no-reply@olinextech.com`, and `reset password`.
6. Open the newest password reset email.
7. Confirm the link opens `/reset-password`.
8. Set a new password.
9. Return to `/login` and sign in with the new password.
10. Confirm `/admin/trial-bookings` is accessible for the expected admin role.

## Failure Triage

If the email still does not arrive:

- Check Supabase Auth Logs for `/recover request completed`.
- Check Supabase Auth Logs for `mail.send`.
- Check Supabase Auth Logs for SMTP, mailer, rate limit, invalid sender, or DNS verification errors.
- Check Resend Logs for `delivered`, `bounced`, `rejected`, or provider-level errors.
- Confirm Gmail Spam, Promotions, and All Mail were checked.
- Confirm Gmail search was attempted for `BIGE`, `no-reply@olinextech.com`, and `reset password`.
- Confirm the sender email belongs to a verified domain in Resend.
- Confirm the DNS records in Resend are marked verified.
- Confirm the Supabase Custom SMTP password uses the Resend API Key and has no extra spaces.
- Avoid repeatedly sending password recovery emails in a short window, because rate limits can mask the real delivery issue.
- If using port `465` fails, test `587` in Supabase SMTP settings.

## Do Not Put These In This File

- SMTP Password
- Provider API Key
- Supabase service role key
- Supabase anon key
- Recovery token
- Session token
- Refresh token
- Any real password

## Related Domain Checklist

Before changing production domains, also follow:

```text
docs/domain-auth-cutover-checklist.md
docs/vercel-production-supabase-xtac-cutover.md
```

The current recommendation remains:

- Keep Supabase Site URL on the current stable production domain until the new domain, DNS, SSL, and Vercel Primary Domain are ready.
- Pre-add future `/login`, `/forgot-password`, and `/reset-password` URLs to Supabase Redirect URLs when preparing a domain cutover.
- Re-test password recovery after any Site URL or Redirect URL change.
