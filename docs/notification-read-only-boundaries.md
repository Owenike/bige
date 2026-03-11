# Notification Read-Only Boundaries

## Purpose
Define hard boundaries for the current notification governance/read-only layer.

## Read-Only Pages
- Platform:
  - `/platform-admin/notifications-ops`
  - `/platform-admin/notifications-audit`
  - `/platform-admin/notifications-config-integrity`
  - `/platform-admin/notifications-preflight`
  - `/platform-admin/notifications-runtime-readiness`
- Manager:
  - `/manager/notifications-ops`
  - `/manager/notifications-audit`
  - `/manager/notifications-config-integrity`
  - `/manager/notifications-preflight`
  - `/manager/notifications-runtime-readiness`

## Read-Only APIs
- Ops summary/health/coverage:
  - `/api/platform/notifications/ops/summary`
  - `/api/platform/notifications/ops/health`
  - `/api/platform/notifications/ops/coverage`
  - `/api/manager/notifications/ops/summary`
  - `/api/manager/notifications/ops/health`
  - `/api/manager/notifications/ops/coverage`
- Audit:
  - `/api/platform/notifications/audit`
  - `/api/manager/notifications/audit`
- Config integrity:
  - `/api/platform/notifications/config-integrity`
  - `/api/manager/notifications/config-integrity`
- Preflight:
  - `/api/platform/notifications/preflight`
  - `/api/manager/notifications/preflight`
- Runtime readiness:
  - `/api/platform/notifications/runtime-readiness`
  - `/api/manager/notifications/runtime-readiness`

## Explicitly Not Allowed in This Layer
- No changes to `/api/jobs/run`.
- No changes to `vercel.json`.
- No mutation wiring into `createInAppNotifications` or dispatch runtime chain.
- No retry/execute trigger from governance UI.
- No write operation from audit/config-integrity/preflight dashboards.
- No pollution to `notification_job_runs` for governance debugging.

## Why Runtime Is Still Not Wired
- Cron/runtime chain is validated separately and must remain stable.
- Governance and preflight layers are for visibility and pre-check only.
- Runtime integration should happen only after dedicated acceptance criteria are passed.

## Runtime Integration Gate (Future)
- Keep scope guard and permission guard unchanged.
- Complete cron acceptance and production stability window first.
- Then wire preferences/templates/retry into runtime in controlled phases.
