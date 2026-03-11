# Notification Migration / Seed Governance

## Classification

## Product migrations
- schema needed for productized notification features
- examples:
  - preference/template foundations
  - audit log foundation

## Ops migrations
- schema for observability and support operations
- examples:
  - ops query support columns/indexes

## Debug migrations
- temporary validation tables for infrastructure checks
- examples:
  - `cron_probe_runs`

## Seed policy

### Test/staging seed only
- synthetic test seed SQL
- demo seed JSON used by manual demo pages

### Production-safe seed
- explicit tenant-scoped seed only
- must be reviewed and idempotent

## Cleanup policy
- debug tables can be archived then removed after validation closes
- test/demo seed rows must not remain in production tenants
- cleanup runs must be logged and reversible

## Safety checks before apply
1. migration type tagged (`product|ops|debug`)
2. rollback note documented
3. tenant scope impact documented
4. post-migration checks updated
