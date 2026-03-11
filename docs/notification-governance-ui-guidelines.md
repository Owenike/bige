# Notification Governance UI Guidelines

## Read-Only Contract
- Governance pages are read-only.
- No execute/retry/run/fix button.
- No write mutation from governance UI.

## Status and Severity Rules
- `healthy`/`success`/`ready`: green tone.
- `degraded`/`warning`/`partial`: amber tone.
- `stale`/`failed`/`missing`/`error`: red tone.
- `no_runs`/unknown: neutral tone.
- Use shared helpers:
  - [notification-governance-view-model.ts](/c:/Users/User/bige/lib/notification-governance-view-model.ts)

## Badge and Label Rules
- Always render state with concise badge text (`formatStatusLabel`).
- Keep warning and stale labels visible at section top.
- For dense sections, keep one summary line before detail rows.

## Filter and Query Param Rules
- Keep filters in URL query params (`router.replace`).
- Provide explicit `Apply` and `Reset`.
- If cursor exists, provide a next-page cursor action.
- Platform pages may include `tenantId`; manager pages cannot cross tenant.

## Loading / Empty / Error Rules
- Loading: section-level loading text.
- Empty: explicit "no rows in current filters/scope".
- Error: single visible error panel.
- Distinguish:
  - no data,
  - stale data,
  - partial data with warnings.

## Metadata and Long Text Rules
- Use truncated preview for long IDs/strings.
- Provide `details` expand area for metadata JSON summary.
- Offer copy action for key identifiers when practical.

## Preflight Presentation Rules
- Explicitly state "read-only simulation".
- Show:
  - preference source/reason,
  - template fallback source/strategy,
  - skipped reasons,
  - warnings,
  - content skeleton preview + expandable JSON.

## Runtime Readiness Presentation Rules
- Explicitly state "read-only readiness report".
- Separate:
  - missing preferences,
  - missing templates,
  - unavailable channels,
  - fallbacks,
  - warnings.
- Show readiness status with one primary badge (`ready` / `not ready`).
