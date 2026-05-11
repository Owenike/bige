# Supabase Custom SMTP Setup Guide

## Current Assessment

- Auth Users already contains the tested account.
- Supabase Auth Logs show the `/recover` request completed.
- Supabase Auth Logs show `mail.send`.
- Gmail did not receive the reset email.
- Initial conclusion: the frontend forgot-password flow is calling Supabase successfully. The next likely issue is email deliverability or the limits/reputation of Supabase default SMTP, so production should use Custom SMTP.

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

## Post-Setup Acceptance Flow

1. Open `https://www.olinextech.com/forgot-password`.
2. Enter the target admin email.
3. Wait 1 to 5 minutes.
4. Check Gmail Inbox, Spam, and All Mail.
5. Open the newest password reset email.
6. Confirm the link opens `/reset-password`.
7. Set a new password.
8. Return to `/login` and sign in with the new password.
9. Confirm `/admin/trial-bookings` is accessible for the expected admin role.

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
```

The current recommendation remains:

- Keep Supabase Site URL on the current stable production domain until the new domain, DNS, SSL, and Vercel Primary Domain are ready.
- Pre-add future `/login`, `/forgot-password`, and `/reset-password` URLs to Supabase Redirect URLs when preparing a domain cutover.
- Re-test password recovery after any Site URL or Redirect URL change.
