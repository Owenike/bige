# Notification Runtime Readiness UI

## Pages
- Platform: `/platform-admin/notifications-runtime-readiness`
- Manager: `/manager/notifications-runtime-readiness`

## Purpose
Read-only readiness report for future runtime integration.  
This page does not send notifications and does not execute retry/run actions.

## Query conditions
- `tenantId` (platform live mode required; manager tenant is enforced by API guard)
- `eventKey`
- `roleKey`
- `userId`
- `channelHint`
- `locale`
- `defaultLocale`
- `recipientLimit`
- `scenarioId` (optional fixture mode)

## Display sections
1. Preference resolution:
- enabled/disabled
- source
- explain
- trace

2. Template resolution:
- found/missing
- source (`tenant/global/none`)
- strategy
- fallback reason
- missing reason

3. Delivery planning draft:
- planned recipients/channels
- content skeleton (summary + expandable JSON)
- skipped reasons

4. Readiness summary:
- ready / not ready
- warnings
- missing preferences
- missing templates
- unavailable channels
- fallbacks

## Interpretation guide
- `ready=true` means simulated inputs have enough preference/template/planning data.
- `fallback` means runtime would rely on non-primary template strategy.
- `skipped` means delivery planning would skip part/all channels/recipients.
- `missing` means explicit configuration gap exists for current query scope.

## Boundary
- All outputs are simulation/planning results, not actual notification execution.
