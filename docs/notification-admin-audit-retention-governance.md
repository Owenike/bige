# Notification Admin Audit Retention Governance

## Keep vs not keep

## Must keep
- action (`preference_upsert`, `template_upsert`, `retry_dry_run`, `retry_execute`)
- actor (`actor_user_id`, `actor_role`)
- tenant scope (`tenant_id`, `scope`)
- resource (`target_type`, `target_id`)
- timestamp (`created_at`)
- minimal operation context (`metadata` summary-safe fields)
- `before_data` / `after_data` / `diff` for management write actions

## Must not keep
- secrets/tokens/credentials
- provider auth headers
- full unrelated payload blobs
- PII beyond required operation trace scope

## Suggested retention policy
- hot window: 30-90 days in primary DB for ops investigation
- warm archive: 6-12 months (storage tier / export)
- older data: summarize + purge by policy

## Cleanup strategy
1. export rows to archive target
2. verify row count checksum
3. delete by time partition/window
4. run post-cleanup validation query

## Operational notes
- audit write failure must not block management write operation (already non-blocking in API integration)
- retention jobs should be out-of-band and never modify notification runtime tables
- cleanup should be tenant-safe and reversible via archive restore
