# Notification Governance Operator Guide

## Roles
- Platform admin: can review cross-tenant governance pages and specify tenant in platform pages.
- Manager: can review tenant-scoped governance pages only.

## Read-only governance pages
- `notifications-ops`
- `notifications-audit`
- `notifications-config-integrity`
- `notifications-preflight`
- `notifications-runtime-readiness`

## Recommended operator flow
1. Start from `notifications-ops`
- check stale/warning/missing coverage trend
- confirm scheduled health summary and high-level reliability state

2. Go to `notifications-audit`
- verify recent admin changes (preferences/templates/retry operations)
- confirm whether config changes happened before issue window

3. Go to `notifications-config-integrity`
- check coverage completeness
- identify missing role/event preference pairs and template gaps

4. Go to `notifications-preflight`
- simulate current selected event/role/user/channel
- inspect skipped reasons and fallback strategy

5. Go to `notifications-runtime-readiness`
- evaluate ready/not-ready summary
- identify missing preferences/templates/unavailable channels/fallbacks

## Platform vs manager usage
- Platform:
  - pick tenant in page query filters
  - compare multiple tenants with same event/filter
- Manager:
  - tenant scope fixed by auth context
  - focus on local tenant configuration and readiness

## What operators must not do in governance pages
- do not execute retries/runs/sends from governance pages
- do not treat readiness/preflight output as execution result
- do not skip cron/jobs acceptance checks when runtime-chain issue is suspected
