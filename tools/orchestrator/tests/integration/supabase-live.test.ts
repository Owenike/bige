import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { runSupabaseBackendLiveSmoke } from "../../src/supabase-live";
import { MemorySupabaseDocumentStore } from "../unit/supabase.fixture";

test("supabase live backend smoke skips cleanly when env is missing", async () => {
  const originalUrl = process.env.ORCHESTRATOR_SUPABASE_URL;
  const originalKey = process.env.ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ORCHESTRATOR_SUPABASE_URL;
  delete process.env.ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY;

  try {
    const result = await runSupabaseBackendLiveSmoke({
      repoPath: process.cwd(),
    });
    assert.equal(result.status, "skipped");
  } finally {
    if (originalUrl) {
      process.env.ORCHESTRATOR_SUPABASE_URL = originalUrl;
    }
    if (originalKey) {
      process.env.ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  }
});

test("supabase live backend smoke can run against a provided remote store", async () => {
  const result = await runSupabaseBackendLiveSmoke({
    repoPath: process.cwd(),
    outputRoot: path.join(process.cwd(), ".tmp", "orchestrator-supabase-live-test"),
    store: new MemorySupabaseDocumentStore(),
  });

  assert.equal(result.backendType, "supabase");
  assert.equal(result.status, "passed");
  assert.equal(Boolean(result.evidencePath), true);
});
