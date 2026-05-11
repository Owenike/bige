# xtac Auth/Profile Bootstrap Plan

Date: 2026-05-10

Target project ref: `xtacrcqosjobaqxvibvi`

Target project URL: `https://xtacrcqosjobaqxvibvi.supabase.co`

This document is a planning checklist only. It does not create Auth users, profiles, tenants, branches, members, or any other data.

## Purpose

Bootstrap the minimum xtac Auth and profile data needed for a future Production Supabase cutover, especially so an authorized operator can log in and manage first-time trial bookings at `/admin/trial-bookings`.

## Current Read-Only Check

Read-only checks were performed against xtac using the local `.env.local` Supabase URL and service role key. Secrets and full personal data were not printed or recorded.

| Item | Count / status | Notes |
|---|---:|---|
| Auth users | 1 | Checked through `auth.admin.listUsers`; no full email or phone stored here |
| `profiles` rows | 1 | One active profile exists |
| Role distribution | `frontdesk: 1` | No `platform_admin`, `manager`, manager-equivalent, `member`, or `customer` profile found |
| `tenants` rows | 2 | Tenant parity with production still needs confirmation |
| `branches` rows | 2 | Branch mapping still needs confirmation |
| `members` rows | 5 | Member rows exist, but no member/customer profile was found |
| `store_booking_settings` | not exposed through REST count | Verify manually if booking/storefront settings are needed |

## Platform Admin Email Readiness Check

Read-only check date: 2026-05-10

Target email was checked in masked form only: `b***@g***.com`.

| Check | Result | Notes |
|---|---|---|
| Auth user exists | yes | User id exists, but the id is not recorded here |
| Email confirmed | yes | `email_confirmed_at` exists |
| Last sign-in | yes | `last_sign_in_at` exists |
| Auth user created at | 2026-02-12T12:18:06.715694Z | Non-sensitive timestamp only |
| Matching profile exists | yes | Queried by Auth user id |
| Current profile role | `frontdesk` | Not currently eligible for `/admin/trial-bookings` |
| Profile active | yes | `is_active = true` |
| Tenant scope | present | `tenant_id` exists |
| Branch scope | present | `branch_id` exists |
| Display name | present | Value not recorded |

Result: this is situation B. The Auth user exists and has an active profile, but the profile role is `frontdesk`, not `platform_admin`, `manager`, or a manager-equivalent role. The next step is to decide whether to carefully change this existing profile role to `platform_admin`, or keep it as frontdesk and create a separate platform admin Auth user/profile.

Do not change the role until confirming whether this account must continue to serve the frontdesk flow.

Follow-up on 2026-05-10: the intended account split was corrected in xtac.

| Account purpose | Masked email | Auth user | Profile | Role | Active | Notes |
|---|---|---|---|---|---|---|
| Platform admin | `b***69@g***.com` | exists | exists | `platform_admin` | yes | Can satisfy the `/admin/trial-bookings` `platform_admin` guard |
| Frontdesk | `b***90@g***.com` | invited | exists | `frontdesk` | yes | Invite created the Auth user; email confirmation is pending until the invite is accepted |

The previous role mismatch was resolved by changing only the intended platform admin profile from `frontdesk` to `platform_admin` and creating a separate frontdesk Auth user/profile. No other users or profiles were intentionally modified.

## `profiles` Column Structure

Source: Supabase REST OpenAPI metadata for xtac. The `Required by REST metadata` column indicates fields listed in the OpenAPI `required` array. The `Nullable` and `Default` values are reported by metadata and should still be verified in Supabase Dashboard before manual inserts.

| Column | Type | Nullable | Default | Required by REST metadata | Usage judgment |
|---|---|---:|---|---:|---|
| `id` | `uuid` | no | none | yes | Must match `auth.users.id`; primary key |
| `tenant_id` | `uuid` | no | none | no | Required by `requireProfile` for every non-`platform_admin` role |
| `branch_id` | `uuid` | no | none | no | Required by `frontdesk`; recommended for branch-scoped staff |
| `role` | `public.app_role` | no | none | yes | App role used by `requireProfile` |
| `display_name` | `text` | no | none | no | Human-readable staff/member name |
| `is_active` | `boolean` | no | `true` | yes | Inactive profiles are blocked by `requireProfile` |
| `created_at` | `timestamptz` | no | `now()` | yes | Created timestamp |
| `updated_at` | `timestamptz` | no | `now()` | yes | Updated timestamp |
| `invited_by` | `uuid` | no | none | no | Optional audit link to inviter profile, if used |
| `created_by` | `uuid` | no | none | no | Optional audit link to creator profile, if used |
| `updated_by` | `uuid` | no | none | no | Optional audit link to updater profile, if used |
| `last_login_at` | `timestamptz` | no | none | no | Login tracking, not needed for initial profile creation |
| `service_assignment_mode` | `text` | no | `branch` | yes | Staff service assignment mode |

## Role and Auth Linkage

Code inspection summary:

- `profiles.id` is the user id field and is matched to `auth.users.id`.
- `profiles.role` is normalized by `lib/auth-context.ts`.
- `profiles.is_active` must be truthy because `TEMP_DISABLE_ROLE_GUARD` is currently `false`.
- `tenant_id` is required by `requireProfile` for all roles except `platform_admin`.
- `branch_id` is required by `requireProfile` for the `frontdesk` role.
- `platform_admin` can pass role checks without tenant scope in the current code.
- `/admin/trial-bookings` allows `platform_admin` and `manager`; manager-equivalent roles also pass because `requireProfile` treats `supervisor`, `branch_manager`, `store_owner`, and `store_manager` as manager equivalents.
- Member areas use `member` and `customer` equivalents.

## Minimum Roles to Bootstrap

| Role | Minimum count | Why it is needed | Required linked data |
|---|---:|---|---|
| `platform_admin` | 1 | Platform-wide emergency/admin access and trial booking admin access | Auth user, profile with `role = 'platform_admin'`, active profile |
| `manager` | 1 | Manager operations and `/admin/trial-bookings` access | Auth user, active profile, valid `tenant_id`, usually a valid `branch_id` |
| `frontdesk` | 1 | Frontdesk flow | Already has one active profile; still confirm login and branch scope |
| `member` or `customer` | 1 test user if member portal is enabled | Member portal/login testing | Auth user, active profile, valid `tenant_id`, member row linkage as required by member APIs |

## Per-Role Data Requirements

| Role | Auth user required | Profile fields | Tenant required | Branch required | Notes |
|---|---|---|---|---|---|
| `platform_admin` | yes | `id`, `role`, `display_name`, `is_active` | no by current guard logic | no by current guard logic | Use for platform/admin recovery and cutover validation |
| `manager` | yes | `id`, `tenant_id`, `role`, `display_name`, `is_active` | yes | recommended | Branch scope may affect manager-visible data and operations |
| `supervisor` / `branch_manager` / `store_owner` / `store_manager` | yes | `id`, `tenant_id`, `role`, `display_name`, `is_active` | yes | recommended | These roles pass manager-equivalent checks |
| `frontdesk` | yes | `id`, `tenant_id`, `branch_id`, `role`, `display_name`, `is_active` | yes | yes | Current xtac profile has this role, but login still needs to be tested |
| `member` / `customer` | yes | `id`, `tenant_id`, `role`, `display_name`, `is_active` | yes | depends on member flow | Usually also needs a corresponding `members` row or linkage expected by member APIs |

## Recommended Bootstrap Methods

### Method A: Supabase Dashboard Manual Setup

1. Open the xtac Supabase project.
2. Go to `Authentication > Users`.
3. Create or invite the intended admin user.
4. Copy the created Auth user id.
5. Go to `Table Editor > profiles`.
6. Create a profile row using the Auth user id as `profiles.id`.
7. Choose the correct `role` value, such as `platform_admin` or `manager`.
8. Set `is_active` to `true`.
9. For non-`platform_admin` roles, select the correct `tenant_id`.
10. For `frontdesk` and branch-scoped staff, select the correct `branch_id`.
11. Save and then test login against the local xtac environment before any Production cutover.

Important:

- Do not create a `profiles` row with an id that does not exist in Supabase Auth.
- Do not reuse the njuy Auth user id unless that exact Auth user has been migrated into xtac.
- Confirm tenant and branch ids belong to the intended xtac tenant/branch.

### Method B: Future Code App Safe Bootstrap Script/API

This can be built in a later round if manual Dashboard work is too risky or repetitive.

Requirements:

- Use the xtac service role key only at runtime.
- Never write passwords, service role keys, or temporary credentials into the repo.
- The user should provide the admin email out of band in the current session.
- Prefer an invite or temporary password flow that forces reset.
- Script/API should be idempotent and should check for existing Auth users and profiles before creating anything.
- Script/API must print only masked emails and non-sensitive ids/status summaries.

## Draft SQL / Pseudo SQL

Do not run this without manually confirming the actual Auth user id, tenant id, branch id, nullable constraints, role enum values, and whether Dashboard creation is preferred.

```sql
-- DRAFT ONLY. Do not execute until reviewed.
-- Auth user must already exist in xtac Authentication > Users.

insert into public.profiles (
  id,
  tenant_id,
  branch_id,
  role,
  display_name,
  is_active,
  service_assignment_mode
) values (
  '<AUTH_USER_ID>',
  '<TENANT_ID_OR_NULL_IF_PLATFORM_ADMIN_ALLOWED>',
  '<BRANCH_ID_OR_NULL>',
  '<ROLE: platform_admin | manager | member | frontdesk>',
  '<DISPLAY_NAME>',
  true,
  'branch'
);
```

Example manager bootstrap shape:

```sql
-- DRAFT ONLY. Replace placeholders and verify constraints before execution.
insert into public.profiles (
  id,
  tenant_id,
  branch_id,
  role,
  display_name,
  is_active,
  service_assignment_mode
) values (
  '<AUTH_USER_ID>',
  '<TENANT_ID>',
  '<BRANCH_ID>',
  'manager',
  '<MANAGER_DISPLAY_NAME>',
  true,
  'branch'
);
```

Example member bootstrap shape:

```sql
-- DRAFT ONLY. A matching member row/link may also be required by member APIs.
insert into public.profiles (
  id,
  tenant_id,
  branch_id,
  role,
  display_name,
  is_active,
  service_assignment_mode
) values (
  '<AUTH_USER_ID>',
  '<TENANT_ID>',
  '<BRANCH_ID_OR_NULL>',
  'member',
  '<MEMBER_DISPLAY_NAME>',
  true,
  'branch'
);
```

## Minimum Acceptable Conditions Before Production Cutover

- At least one `platform_admin` or `manager` / manager-equivalent user can log in.
- `/admin/trial-bookings` can load as an authorized user.
- `booking_status` can be updated by the authorized user.
- If manager features are part of the cutover, at least one manager or manager-equivalent profile exists with valid tenant/branch scope.
- If member features are part of the cutover, member/customer Auth users, profiles, and member data linkage exist.
- If frontdesk features are part of the cutover, the existing frontdesk user can log in and has valid tenant/branch scope.

## Password Recovery / Reset Page

The site now has a shared `/reset-password` page for Supabase password recovery links.

- The page uses the public Supabase browser client only.
- It supports recovery links that return with `code`, `token_hash`, or hash session tokens.
- It never uses the service role key.
- It lets staff/admin users set a new password and then return to `/login`.

For the platform admin account, send the password recovery email from Supabase Dashboard or an approved admin flow. The recovery link should redirect to `/reset-password`.

## Risks

- A manually inserted profile without a matching xtac Auth user will not allow login.
- A typo in `role` can block access or fail enum validation.
- Wrong `tenant_id` or `branch_id` can make the user see no data or the wrong data.
- Production env cutover does not migrate njuy users into xtac.
- Creating only a `platform_admin` may unblock `/admin/trial-bookings`, but it does not prove manager/member/frontdesk parity.
- Direct SQL bypasses app-level validation and should be used only after review.

## Next Steps

1. Test login for the platform admin account and confirm `/admin/trial-bookings` can load.
2. Have the frontdesk user accept the invite, then test frontdesk login and branch-scoped flows.
3. Create at least one manager and one member/customer test account if those features are included in the cutover.
4. Re-run the readiness report after manager/member bootstrap.
