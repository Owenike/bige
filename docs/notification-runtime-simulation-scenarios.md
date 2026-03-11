# Notification Runtime Simulation Scenarios

## Scope
Reusable read-only simulation fixtures for preflight, tests, and docs.

## Source file
- [notification-runtime-simulation-fixtures.ts](/c:/Users/User/bige/lib/notification-runtime-simulation-fixtures.ts)

## Scenario list

1. `complete_tenant_ready`
- Normal complete tenant
- Role preference + templates available
- Expected: `ready=true`

2. `missing_template_tenant`
- Template gap scenario
- Preference enables channel but template is missing
- Expected: template-missing skipped path

3. `missing_preference_tenant`
- Preference gap scenario
- No explicit platform/tenant/role/user rule
- Expected: fallback to `system_default` with readiness warning

4. `user_override_disabled`
- User override scenario
- User preference disables delivery even when role enabled
- Expected: `PREFERENCE_DISABLED`

5. `role_fallback_tenant_default`
- Role fallback scenario
- Missing role preference, tenant default is applied
- Expected: readiness report shows fallback source

6. `skipped_disabled_scenario`
- Skipped/disabled scenario
- Disabled preference + no recipients
- Expected: multiple skipped reasons (`PREFERENCE_DISABLED`, `NO_CHANNEL_ENABLED`, `NO_RECIPIENTS`)

## Reuse entrypoints
- `listNotificationRuntimeSimulationScenarios()`
- `getNotificationRuntimeSimulationScenario(id)`

## Non-goals
- No direct runtime integration.
- No execute/retry/run operation.
- No write to runtime tables.
