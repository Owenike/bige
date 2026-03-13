import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseBackendProvider } from "../../src/backend";
import { buildDiagnosticsSummary } from "../../src/diagnostics";
import { enqueueStateRun } from "../../src/queue";
import { createInitialState } from "../../src/orchestrator";
import { MemorySupabaseDocumentStore } from "./supabase.fixture";

test("backend status and diagnostics expose remote backend type and queue summary", async () => {
  const backend = new SupabaseBackendProvider({
    store: new MemorySupabaseDocumentStore(),
  });
  const state = createInitialState({
    id: "remote-diagnostics",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Inspect remote backend",
    objective: "Show remote backend health",
    subtasks: ["supabase", "diagnostics", "queue", "tests"],
    successCriteria: ["operator can read backend and diagnostics summary"],
    backendType: "supabase",
  });

  await enqueueStateRun({
    backend,
    state,
    priority: 2,
  });

  const status = await backend.status();
  const diagnostics = buildDiagnosticsSummary(state);

  assert.equal(status.backendType, "supabase");
  assert.equal(status.inspection.queueDepth, 1);
  assert.equal(diagnostics.artifactSummary.backendType, "supabase");
});
