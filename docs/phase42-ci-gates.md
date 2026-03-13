# Phase42 CI Gates

`phase42` has two validation paths:

- Stable PR gate:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:unit`
  - `npm run test:phase42:contract:unit`
  - `npm run test:phase42:schema`
  - `npm run test:phase42:fixtures`
  - Convenience alias: `npm run test:phase42:stable`
- Live acceptance gate:
  - `npm run test:phase42:contract:blackbox`
  - Runs in CI only on `push` to `main` or `workflow_dispatch`
  - Intended for real deployment verification, not every PR

Live blackbox inputs:

- Required:
  - `PHASE42_BASE_URL` or manual workflow input `phase42_base_url`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Optional:
  - `PHASE42_VERCEL_BYPASS_SECRET`

CI behavior:

- Pull requests always run the stable phase42 gate.
- Live blackbox is skipped with an explicit message when:
  - the workflow is not running on `main` or `workflow_dispatch`
  - required live env or secrets are missing
