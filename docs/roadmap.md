# BIGE Implementation Roadmap

## Phase 1 (Operational MVP)

- Member
  - Dynamic QR: `/member/entry-qr` + `/api/entry/issue`
  - Basic profile & pass summary: `/member` (next: add API-backed widgets)
- Frontdesk
  - Check-in scan + verify: `/frontdesk/checkin` + `/api/entry/verify`
  - Member search/create: `/frontdesk/member-search` + `/api/members`
  - Walk-in order/payment: `/frontdesk/orders/new` + `/api/orders` + `/api/payments`
  - Handover closeout: `/frontdesk/handover` + `/api/frontdesk/handover`
- Manager
  - Member/booking/order/payment operations via `/api/*` base modules
- Data
  - Core schema + RLS in `supabase/migrations/20260207_core_platform.sql`

## Phase 2 (Coach Loop)

- Coach timetable and notes UI on `/coach`
- Session redemption API/table wiring (`session_redemptions`)
- Booking policy engine (reschedule/cancel/no-show)
- Notification adapters (`/api/notify`) for LINE OA + SMS/email fallback

## Phase 3 (SaaS Platform)

- Tenant provisioning and suspension workflows
- Feature flag management UI and audit playback
- Cross-tenant analytics and compliance dashboards

## Technical Guardrails

- Sensitive flows must stay server-side Route Handlers (`/api/*`).
- One-time check-in token must be enforced by unique `jti`.
- All tenant data access must pass through role + tenant checks.
