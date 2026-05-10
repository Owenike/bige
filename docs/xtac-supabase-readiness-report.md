# xtac Supabase Readiness Report

Date: 2026-05-10

Target project ref: `xtacrcqosjobaqxvibvi`

Target project URL: `https://xtacrcqosjobaqxvibvi.supabase.co`

Local env status: `.env.local` points `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` to xtac. Secrets were only checked for presence and were not printed.

## Conclusion

xtac is not ready for a full Vercel Production cutover yet.

The code scan found 72 Supabase table references and all 72 responded to read-only existence/count checks through the xtac service role. This is good schema coverage for tables, including `trial_bookings`.

Production cutover is still blocked because:

- xtac Auth/profile data is not production-ready: only 1 auth user/profile was detected, and the only detected profile role is `frontdesk`;
- no `platform_admin`, `manager`, or `member` profile data was found;
- 7 runtime RPC functions are used by the code; 6 exist in xtac metadata, but `manage_booking_package_usage` is missing;
- several business-critical tables exist but have no production data, so schema exists does not mean the full site will behave like production.

Update on 2026-05-10: `storefront-assets` was created in xtac and verified with `public: true`, `file_size_limit: 5242880`, and allowed MIME types `image/jpeg`, `image/png`, and `image/webp`.

Update on 2026-05-10: RPC metadata was checked through the Supabase REST OpenAPI schema without calling any RPC functions. Six of seven runtime RPC functions are present. `manage_booking_package_usage` is missing.

Update on 2026-05-10: Auth/profile readiness was checked read-only. xtac currently has 1 Auth user and 1 active `profiles` row with role `frontdesk`. No `platform_admin`, `manager`, manager-equivalent, `member`, or `customer` profile was detected.

Update on 2026-05-10: An auth/profile bootstrap plan was added at `docs/xtac-auth-profile-bootstrap-plan.md`. The blocker is not resolved yet; xtac still needs at least one active `platform_admin` or `manager` / manager-equivalent profile before the trial booking admin can be used after Production cutover.

Update on 2026-05-10: The intended platform admin email was checked in masked form (`b***@g***.com`). At that time the Auth user existed and had an active `frontdesk` profile, which prompted the account split correction recorded below.

Update on 2026-05-10: xtac role bootstrap was corrected for the two intended accounts. The masked platform admin account `b***69@g***.com` now has an active `platform_admin` profile. The masked frontdesk account `b***90@g***.com` was invited and has an active `frontdesk` profile; its email confirmation remains pending until the invite is accepted.

## Resource Summary

| Resource type | Scanned count | Critical count | Exists in xtac | Missing / unverified |
|---|---:|---:|---:|---:|
| Tables | 72 | 36 | 72 | 0 missing |
| Storage buckets | 1 | 1 | 1 | 0 missing |
| RPC functions | 7 | 4 | 6 verified | 1 missing |
| Auth users | 2 users detected after bootstrap | critical for admin/member/manager | platform admin and frontdesk present | manager/member roles still missing |

## Tables Check

Read-only method: `.select("*", { count: "exact", head: true })`.

All scanned table references responded without a missing-table error. Counts are approximate current row counts from xtac where PostgREST returned a count.

| Table | Required level | Code usage | Exists in xtac | Count | Risk | Action needed |
|---|---|---|---:|---:|---|---|
| `profiles` | critical | auth, role guard, staff, admin | yes | 1 | Only `frontdesk` role detected | Add/verify production admin, manager, member, and platform admin profiles |
| `tenants` | critical | tenant scoping, platform admin, billing | yes | 2 | Tenant data may not match production | Verify production tenant rows |
| `tenant_subscriptions` | critical | tenant access guard, billing | yes | 2 | Subscription state affects access | Verify active/current subscriptions |
| `branches` | critical | booking, manager, frontdesk | yes | 2 | Branch scope affects staff/frontdesk | Verify production branch data |
| `services` | critical | booking and manager services | yes | 1 | Booking needs correct service catalog | Verify complete production services |
| `members` | critical | login, member portal, bookings | yes | 5 | Auth/member linkage may be incomplete | Verify member records and auth_user_id links |
| `bookings` | critical | booking, manager, member, payments | yes | 0 | No booking data | Verify acceptable for cutover or migrate production bookings |
| `orders` | critical | payments, POS, reports | yes | 1 | Sparse order data | Verify/migrate production order data |
| `payments` | critical | payments, refunds, reports | yes | 2 | Sparse payment data | Verify/migrate production payment data |
| `trial_bookings` | critical | public trial booking and admin | yes | 0 | Ready structurally; currently no rows | OK for fresh submissions after cutover |
| `audit_logs` | critical | auth/manager/platform audit | yes | 6 | Sparse audit history | Verify retention/migration needs |
| `entry_passes` | critical | member entry, entitlements | yes | 0 | Member entry may fail without passes | Verify/migrate passes |
| `checkins` | critical | entry and progress | yes | 5 | Sparse check-in history | Verify if history is needed |
| `session_redemptions` | critical | entitlement use | yes | 0 | Redemption history absent | Verify/migrate if needed |
| `member_plan_catalog` | critical | manager/member plans | yes | 3 | Plan catalog present but must be verified | Confirm active plans/prices |
| `member_plan_contracts` | critical | member entitlements | yes | 0 | Members may have no active contracts | Verify/migrate contracts |
| `member_plan_ledger` | critical | plan adjustments/history | yes | 0 | Ledger history absent | Verify/migrate if needed |
| `member_device_sessions` | critical | member login session tracking | yes | 0 | Expected to grow after login | No blocker if fresh sessions are acceptable |
| `member_activation_tokens` | critical | member activation | yes | 0 | Expected empty unless activations pending | No blocker if no pending tokens |
| `member_identities` | critical | notifications/member identity | yes | 0 | Notifications may lack recipients | Verify/migrate identities |
| `member_notification_reads` | critical | member notifications | yes | 0 | Read state absent | Verify if needed |
| `member_progress_entries` | critical | progress tracking | yes | 0 | Progress history absent | Verify/migrate if needed |
| `member_progress_events` | critical | progress events | yes | 0 | Progress event history absent | Verify/migrate if needed |
| `notification_templates` | critical | notification runtime | yes | 0 | Notification rendering may fail or fallback | Seed/verify templates before enabling notifications |
| `notification_role_preferences` | critical | notification routing | yes | 0 | Preferences missing | Seed/verify preferences |
| `notification_user_preferences` | critical | user notification preferences | yes | 0 | Preferences missing | Verify acceptable defaults |
| `notification_logs` | critical | notification audit/history | yes | 0 | History absent | Verify if needed |
| `notification_deliveries` | critical | notification delivery queue | yes | 0 | No delivery history | Verify runtime seed/config |
| `notification_delivery_events` | critical | notification analytics | yes | 0 | No analytics events | Verify if needed |
| `notification_delivery_daily_rollups` | critical | notification analytics | yes | 0 | Rollup data absent | Verify/rebuild after data exists |
| `notification_delivery_anomaly_daily_rollups` | critical | notification anomaly analytics | yes | 0 | Rollup data absent | Verify/rebuild after data exists |
| `notification_admin_audit_logs` | critical | notification admin audit | yes | 0 | Audit history absent | Verify if needed |
| `notification_alert_workflows` | critical | notification ops | yes | 0 | Alert workflow config absent | Seed/verify if ops pages are used |
| `notification_job_runs` | critical | cron/jobs/notifications | yes | 34 | Job history exists | Verify job config and current state |
| `notification_job_execution_locks` | critical | cron/job locking | yes | 0 | Expected empty unless jobs running | No blocker if jobs initialize correctly |
| `storefront_brand_contents` | important | storefront manager config | yes | count unavailable | Storefront content may be missing | Verify storefront data |
| `storefront_brand_assets` | important | storefront image metadata | yes | count unavailable | Bucket missing blocks upload/storage | Create/verify bucket before upload use |
| `products` | important | POS/member purchase | yes | 3 | Product catalog present but sparse | Verify catalog |
| `order_items` | important | orders/inventory | yes | 0 | No order item history | Verify/migrate if needed |
| `payment_webhooks` | important | payment observability | yes | 0 | No webhook history | Verify payment callback setup later |
| `feature_flags` | important | platform flags | yes | 0 | Defaults may differ | Verify desired flags |
| `operation_idempotency_keys` | important | idempotent operations | yes | 0 | Expected empty | No blocker |
| `booking_waitlist` | important | waitlist | yes | 0 | No waitlist data | Verify if feature is used |
| `booking_sync_jobs` | important | booking sync | yes | 0 | No sync jobs | Verify if feature is used |
| `booking_status_logs` | important | booking audit | yes | count unavailable | History may be absent | Verify if needed |
| `booking_package_logs` | important | package booking usage | yes | count unavailable | History may be absent | Verify if needed |
| `coach_slots` | important | coach availability | yes | 0 | Availability missing | Seed/verify if scheduler is used |
| `coach_blocks` | important | blocked time | yes | 0 | No blocks | Verify if needed |
| `coach_recurring_schedules` | important | therapist scheduling | yes | count unavailable | Recurring schedule data may be missing | Verify schedules |
| `coach_branch_links` | important | coach/branch scope | yes | count unavailable | Coach branch mapping may be incomplete | Verify mappings |
| `crm_leads` | important | CRM | yes | 0 | CRM data absent | Verify if CRM is used |
| `crm_lead_followups` | important | CRM followups | yes | 0 | CRM followups absent | Verify if CRM is used |
| `crm_opportunities` | important | CRM opportunities | yes | 0 | CRM opportunity data absent | Verify if used |
| `crm_opportunity_logs` | important | CRM audit | yes | 0 | Logs absent | Verify if needed |
| `cron_probe_runs` | important | cron health | yes | 15 | Cron probe history exists | Verify Production cron after cutover |
| `daily_settlements` | important | settlement cron | yes | 0 | No settlements | Verify if POS/payment is live |
| `frontdesk_shifts` | important | frontdesk shift | yes | 14 | Shift data exists | Verify current open/closed state |
| `frontdesk_shift_items` | important | handover/shift items | yes | 0 | No shift item data | Verify if used |
| `frontdesk_locker_rentals` | important | lockers | yes | 2 | Some data exists | Verify if feature is used |
| `frontdesk_product_inventory` | important | inventory | yes | 0 | Inventory missing | Seed/verify before POS inventory use |
| `frontdesk_product_inventory_moves` | important | inventory audit | yes | 0 | History absent | Verify if needed |
| `high_risk_action_requests` | important | approval workflows | yes | 0 | No pending approvals | No blocker if expected |
| `in_app_notifications` | important | in-app notifications | yes | 0 | No notifications | Verify if used |
| `subscriptions` | important | member subscriptions | yes | 0 | No member subscription data | Verify/migrate if member portal is used |
| `store_booking_settings` | important | booking/storefront settings | yes | count unavailable | Settings may be incomplete | Verify settings |
| `saas_plans` | important | platform billing plans | yes | 3 | Plans exist | Verify plan contents |
| `schema_migrations` | important | migration tracking | yes | count unavailable | Confirms migration table exists | Compare migrations if needed |
| `pg_indexes` | important | consistency checks | yes | count unavailable | Catalog access responded | No action |
| `tenant_delivery_channel_settings` | optional | scripts/e2e | yes | 0 | Test/support table | No production blocker unless used |
| `tenant_job_settings` | optional | scripts/e2e | yes | 0 | Test/support table | No production blocker unless used |
| `tenant_notification_settings` | optional | scripts/e2e | yes | 0 | Test/support table | No production blocker unless used |

## Storage Buckets Check

Read-only method: `storage.listBuckets()`.

| Bucket | Code usage | Exists in xtac | Risk | Action needed |
|---|---|---:|---|---|
| `storefront-assets` | `lib/storage/storefront-assets.ts`, manager storefront upload | yes | Bucket exists and settings match code expectations | No action needed for bucket existence; still verify storefront data and auth before cutover |

Verified settings on 2026-05-10:

- `public`: `true`
- `file_size_limit`: `5242880`
- `allowed_mime_types`: `image/jpeg`, `image/png`, `image/webp`

## RPC Functions Check

Read-only method: Supabase REST OpenAPI metadata from `/rest/v1/`. No RPC functions were called, and no SQL DDL or data mutation was performed.

This verifies that the function is exposed through the public PostgREST RPC path. It does not prove the function's runtime behavior or business-flow correctness.

| Function | Code usage | Exists in xtac | Schema / metadata | Risk | Action needed |
|---|---|---:|---|---|---|
| `member_modify_booking` | `app/api/member/bookings/[id]/route.ts` | yes | `public`, POST `/rpc/member_modify_booking`, body `args` object | Member booking changes still need functional testing | Test member booking modification after auth/data readiness |
| `verify_entry_scan` | `app/api/entry/verify/route.ts` | yes | `public`, POST `/rpc/verify_entry_scan`, body `args` object | QR/entry flow still needs functional testing | Test entry scan after auth/member/pass data readiness |
| `rebuild_notification_daily_rollups` | `lib/notification-rollup.ts` | yes | `public`, POST `/rpc/rebuild_notification_daily_rollups`, body `args` object | Notification rollup rebuild still needs controlled testing | Test notification rollup jobs after notification seed data exists |
| `refresh_notification_daily_rollups_incremental` | `lib/notification-rollup.ts` | yes | `public`, POST `/rpc/refresh_notification_daily_rollups_incremental`, body `args` object | Notification rollup incremental refresh still needs controlled testing | Test notification rollup jobs after notification seed data exists |
| `manage_booking_package_usage` | `lib/booking-commerce.ts` | no | Not present in REST OpenAPI metadata | Booking/package usage accounting may fail | Add or migrate the missing function before full cutover if booking/package flow is used |
| `redeem_session` | `lib/entitlement-consumption.ts` | yes | `public`, POST `/rpc/redeem_session`, body `args` object | Session redemption still needs functional testing | Test redemption after member/pass data readiness |
| `refund_payment` | `lib/high-risk-actions.ts` | yes | `public`, POST `/rpc/refund_payment`, body `args` object | Refund workflow still needs functional testing | Test refund workflow only in controlled payment testing |

## Auth / Profiles Check

- `auth.admin.listUsers` succeeded.
- Detected auth user count estimate: 1.
- `profiles` table exists.
- Detected `profiles` count: 1.
- Detected profile roles: `frontdesk: 1`.
- Active profile roles: `frontdesk: 1`.
- Auth user metadata did not expose a reliable role value; application role readiness must be determined from `profiles.role`.
- No full email addresses or personal data were recorded in this report.

Role readiness:

| Role / area | Count | Readiness | Impact | Action needed |
|---|---:|---|---|---|
| `platform_admin` | 0 | not ready | Platform admin pages and platform-scoped operations | Create or migrate an active Auth user and `profiles` row with `platform_admin` |
| `manager` | 0 | not ready | Manager dashboard, staff, booking/admin operations | Create or migrate active manager or manager-equivalent profiles |
| manager-equivalent roles | 0 | not ready | `supervisor`, `branch_manager`, `store_owner`, `store_manager` also satisfy manager guards | Create or migrate at least one active manager-equivalent profile if this is the intended admin role |
| `member` / `customer` | 0 | not ready | Member portal, member bookings, member notifications | Create or migrate member/customer profiles linked to Auth users and member rows |
| `frontdesk` | 1 | ready for frontdesk only | Frontdesk flows may have a usable role; branch/tenant scope was present in this check | Still test frontdesk login and branch-scoped features |
| `/admin/trial-bookings` access | 0 eligible profiles | not ready | Trial booking admin requires `platform_admin` or `manager` guard; manager-equivalent roles also work through `requireProfile` | Add/migrate `platform_admin`, `manager`, or manager-equivalent active profile before Production admin use |

Related table counts:

| Table | Count | Readiness note |
|---|---:|---|
| `tenants` | 2 | Exists, but production tenant parity still needs confirmation |
| `branches` | 2 | Exists, but branch mapping for staff/member flows still needs confirmation |
| `tenant_subscriptions` | 2 | Exists, but current active subscription state should be verified |
| `store_booking_settings` | count unavailable | Exists, but settings completeness should be verified |
| `members` | 5 | Exists, but no member/customer profiles were detected |
| `profiles` | 1 | Insufficient for production roles |

Risk:

- `platform_admin` and `frontdesk` profiles now exist in xtac after the bootstrap correction.
- Manager and member/customer profiles are still missing.
- `/admin/trial-bookings` requires an allowed admin/manager role, so Production admin access may be blocked after cutover unless the correct auth user and profile rows exist.
- Member and manager portals may not function correctly without matching Supabase Auth users, `profiles`, `members`, tenant scope, and role data.
- Frontdesk has one active profile, but this alone does not make the whole production role model ready.

## Auth / Service Role Usage

Runtime code uses:

- `createSupabaseServerClient` for cookie/session based auth.
- `createSupabaseAdminClient` for service-role operations.
- `auth.admin` for user creation, user updates, password reset flows, staff/member activation, coach/user listing, and admin platform user operations.

Implication:

- Production `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must both belong to xtac.
- The service role key must remain server-only in Vercel Production env.
- Auth users and profile rows must be migrated or recreated before switching the whole site.

## Cutover Blockers

| Blocker | Reason | How to fix |
|---|---|---|
| Missing manager/member auth/profile coverage | Platform admin and frontdesk are now present, but no `manager`, manager-equivalent, `member`, or `customer` roles were verified | Create or migrate required manager/member profiles, then test role-specific login flows |
| Missing RPC function | `manage_booking_package_usage` is referenced by runtime code but was not present in xtac REST OpenAPI metadata | Add or migrate `manage_booking_package_usage` before full cutover if booking/package flow is used |
| Production data parity not proven | Tables exist, but several critical tables are empty or sparse | Decide whether xtac is a fresh-start production DB or migrate/seed required production data before cutover |

Resolved blocker:

| Resolved blocker | Result |
|---|---|
| Missing `storefront-assets` bucket | Resolved on 2026-05-10. Bucket exists in xtac with public access, 5MB limit, and JPG/PNG/WEBP MIME restrictions. |
| RPC metadata unverified | Resolved on 2026-05-10. Metadata check completed without calling RPC functions; 6 of 7 runtime RPC functions exist. |

## Safe Next Steps

If the goal is a full Production cutover:

1. Add or migrate the missing `manage_booking_package_usage` RPC if booking/package flow is required for production.
2. Add or migrate required Auth users and `profiles` for `manager`, `member`, and remaining operational staff.
   Use `docs/xtac-auth-profile-bootstrap-plan.md` as the manual planning checklist before creating or changing any users/profiles.
3. Verify tenant, branch, services, plans, products, storefront settings, booking settings, notification templates, and payment-related seed data.
4. Re-run this readiness report.
5. Only then switch Vercel Production env to xtac and redeploy.

If the goal is only trial booking first:

1. Keep full Production Supabase on njuy for now.
2. Consider a narrowly scoped architecture for `/trial-booking` only if dual-project operation is acceptable.
3. Avoid switching the entire Vercel Production Supabase env until the blockers above are resolved.
