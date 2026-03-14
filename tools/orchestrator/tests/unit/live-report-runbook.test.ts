import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile } from "node:fs/promises";

test("live report runbook documents sandbox profiles and live success smoke workflow", async () => {
  const runbookPath = path.resolve(process.cwd(), "docs", "orchestrator-runbook.md");
  const runbook = await readFile(runbookPath, "utf8");

  assert.match(runbook, /sandbox target registry/i);
  assert.match(runbook, /sandbox profile/i);
  assert.match(runbook, /sandbox:create/i);
  assert.match(runbook, /sandbox:set-default/i);
  assert.match(runbook, /reporting:precheck/i);
  assert.match(runbook, /reporting:run-live-smoke/i);
  assert.match(runbook, /reporting:live-success-smoke/i);
  assert.match(runbook, /create/i);
  assert.match(runbook, /update/i);
  assert.match(runbook, /manual_required|blocked/i);
  assert.match(runbook, /evidence/i);
});
