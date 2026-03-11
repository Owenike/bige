# Tenant Notification Defaults Strategy

## Layering model
Resolution order (low to high priority):
1. system default
2. platform default
3. tenant default
4. role preference
5. user preference

Later layer overrides earlier layer.

## Governance guidance

### Platform default
- define baseline enablement/channel posture for all tenants
- avoid tenant-specific assumptions

### Tenant default
- per-tenant policy adaptation (compliance/business model)
- keep stable for predictable behavior

### Role preference
- operational tuning by role responsibilities
- manager/frontdesk/sales/member personas should be explicit

### User preference
- only personal override where product allows
- must not break mandatory compliance notifications

## Operational rules
- always keep explicit source tagging
- preserve explainable decision trace
- use preflight integrity checks before runtime activation
- never write back runtime decisions into product config tables

## Current implementation status
- resolution service exists as pure service:
  - [notification-preference-resolution-service.ts](/c:/Users/User/bige/lib/notification-preference-resolution-service.ts)
- runtime chain remains intentionally disconnected in this phase
