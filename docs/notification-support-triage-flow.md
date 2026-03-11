# Notification Support Triage Flow

## Goal
Provide a consistent read-only triage flow before touching runtime/cron acceptance chain.

## Triage order
1. `notifications-ops`
- check overall health/stale/warnings
- confirm whether issue is broad (tenant/system) or narrow (event/channel)

2. `notifications-audit`
- inspect recent preference/template/retry operation changes
- identify change timing and actor

3. `notifications-config-integrity`
- identify missing configuration coverage
- check whether issue is caused by missing preference/template setup

4. `notifications-preflight`
- simulate selected event/role/user/channel
- review skipped reasons and fallback source

5. `notifications-runtime-readiness`
- confirm readiness status
- isolate missing preferences/templates/unavailable channels/fallbacks

## When to go back to cron/jobs acceptance chain
- ops shows stale/no-runs scheduled health
- readiness/preflight indicate inputs are complete but delivery still not observed
- cron-related evidence is required for production schedule incident

In those cases, return to cron probe/jobs runbook and production runtime log verification.

## Platform vs manager responsibilities
- Platform:
  - cross-tenant incident correlation
  - governance config gap prioritization
- Manager:
  - tenant-level gap confirmation
  - provide tenant-specific filters/evidence to platform/support

## Boundary reminder
- This flow is read-only.
- No execute/retry/run/send actions should be triggered from governance triage pages.
