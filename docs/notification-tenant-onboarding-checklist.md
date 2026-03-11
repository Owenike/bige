# Tenant Notification Onboarding Checklist

## Goal
Validate tenant notification readiness before runtime integration.

## Checklist

1. Tenant scope baseline
- tenant profile exists and active
- notification management APIs reachable with tenant role permissions

2. Preferences setup
- core role/event preference rows created
- tenant defaults defined where needed
- critical events are not accidentally disabled

3. Templates setup
- active templates for core event/channel combinations
- tenant-specific templates verified
- global fallback coverage confirmed

4. Channel readiness
- enabled channels have usable template fallback
- unsupported channels are disabled in preference layer

5. Ops/audit readiness
- admin audit rows can be queried via read-only API
- platform ops dashboard shows non-error responses
- config integrity report available

6. Seed/demo safety
- production tenant not using demo/test seed by mistake
- demo-only data isolated from production tenant scope

7. Sign-off
- platform reviewer sign-off
- tenant owner sign-off
- rollback contact person recorded
