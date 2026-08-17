# Codex Execution Preferences

## Default Execution Style
- Unless the action is high-risk or destructive, execute commands and code changes directly without asking for per-change confirmation.
- Consider high-risk actions as destructive file operations, irreversible data changes, credential/security-impacting changes, or forceful git history rewrites.
- For high-risk actions only, request explicit confirmation before proceeding.

## Deployment
- After completing and verifying user-facing application changes, deploy the current version to production and verify the live deployment unless the user explicitly asks not to deploy.
- Treat a user-facing change as incomplete until the production deployment and post-deploy check have succeeded.

## Mandatory Regression-Prevention Workflow
- Treat regression prevention as part of every change. A task is not complete merely because the requested behavior works in isolation.
- Before editing, use repository search to identify the changed code's callers, consumers, shared components, API routes, database dependencies, CSS/layout rules, authentication paths, and adjacent user flows. Write down the requested flow and the related flows that must remain working.
- Preserve existing behavior unless the user explicitly requests a change. Never fix one page, role, entry type, or device by disabling shared behavior required by another.
- Prefer the smallest scoped fix. When practical, add or update an automated regression test that fails for the reported bug and passes with the fix.
- After code changes, run the targeted tests plus the repository-wide gates: `npm run test:unit`, `npm run typecheck`, `npm run lint`, and `npm run build`. For changed user-facing routes, also run `npm run test:smoke` or a more specific end-to-end suite when available.
- For user-facing workflows, verify the complete real flow through browser, API, database, admin processing, and the resulting client state. Also exercise every related flow identified in the impact review, including success, rejection/error, empty/loading, and refresh/update behavior where applicable.
- For member entry or notification changes, the minimum regression matrix is: regular member entry and 50 TWD drop-in entry; both admin entry pages; exactly one visible popup; queue advancement; approve/reject handling; member-side automatic status update; mobile viewport; and no raw HTML or backend error body rendered to users.
- Use controlled test records only. Record the original state before testing, never operate on real pending member records, restore changed fixture state, and remove temporary requests/accounts after verification.
- After deployment, repeat the critical end-to-end flow on the production domain and inspect production errors. If any requested or related flow fails, keep working and do not report completion.
- The final handoff must list the exact checks and flows run, their results, the production deployment status, and test-data cleanup. Never claim "fixed" or "no problem" based only on code inspection, compilation, or a single happy-path check.

## Protected UX and Performance Baselines
- The BIG E daily schedule must prefetch the ten dates before and the ten dates after the selected date, and its in-memory LRU must retain at least 61 daily boards so rapid navigation and late background responses cannot evict nearby dates.
- Do not reduce, delay, serialize, or disable that warm window; shrink its cache headroom; or add automatic refetches for already-cached dates without the user's explicit approval.
- Before materially changing an established user-facing workflow, visual behavior, loading strategy, cache policy, permission rule, or operational default, first report the current behavior, why a change is proposed, every affected role/device/related flow, measured before-and-after evidence, and the rollback plan. Obtain explicit user confirmation before implementing the behavior change.
- A bug fix that restores an already agreed baseline may proceed without a separate confirmation, but it must add or update a regression test that encodes the preserved behavior.
- Before production deployment, identify the exact task-scoped files and diff. Keep user-facing releases traceable to a Git commit when repository state allows; if unrelated uncommitted work prevents an isolated commit, report that traceability gap explicitly instead of implying the deployment maps cleanly to one commit.

## Communication
- Keep updates short and action-focused.
- Continue execution end-to-end once a task is clear, without pausing for routine confirmations.
