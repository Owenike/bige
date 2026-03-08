# Phase 5.5 E2E Validation Runbook

## A. Platform / Tenant lifecycle
1. Set tenant status to `active`, subscription status `active`: verify manager/frontdesk/member routes all work.
2. Set tenant status to `suspended`: verify non-platform roles are blocked.
3. Set tenant status to `disabled`: verify non-platform roles are blocked.
4. Keep tenant active, set subscription to `grace` with future `grace_ends_at`: verify tenant still usable and warning appears.
5. Keep tenant active, set subscription to `expired` (or grace past): verify manager/frontdesk/member blocked.
6. Verify platform admin can still access `/platform-admin/*` and repair tenant state.

## B. Account / RBAC
7. Manager creates `frontdesk`, `coach`, `sales`, `supervisor` on `/manager/staff`.
8. Validate created staff can login and profile has correct tenant + branch scope.
9. Validate non-manager role cannot create staff.
10. Validate frontdesk/coach/sales cannot pass `staff.*` API checks.

## C. Member plan lifecycle
11. Create plan in `/manager/plans`.
12. Assign plan to member in `/manager/members/:id`.
13. Create order + payment; confirm entitlement fulfillment and ledger grant.
14. Redeem a session; confirm remaining sessions and ledger redeem are updated.
15. Run pass adjustment; confirm pass remaining and contract remaining update together.
16. Run refund / void; confirm entitlement reversal and contract cancellation.

## D. Unified eligibility
17. Check same member on:
- `POST /api/member/bookings`
- `POST /api/bookings`
- `POST /api/session-redemptions`
- `POST /api/entry/verify`
Confirm eligibility decision and reason are consistent.
18. Use expired entitlement: all relevant entry/booking/redemption paths must deny.
19. Use exhausted entitlement: all relevant entry/booking/redemption paths must deny.
20. Use canceled entitlement: all relevant entry/booking/redemption paths must deny.

## E. Tenant/branch boundary
21. Cross-tenant API access attempt must fail.
22. Frontdesk cross-branch member/order access attempt must fail.
23. Unauthenticated requests to guarded routes must fail with unauthorized response.

## F. Consistency and monitoring checks
24. Run `GET /api/platform/consistency` as platform admin and review anomalies.
25. Run `GET /api/manager/consistency` as manager and review tenant anomalies.
26. Verify high-risk failures emit audit events (`*_failed` actions).
