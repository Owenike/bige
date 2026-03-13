import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies } from "../../src/orchestrator";
import { SupabaseBackendProvider } from "../../src/backend";
import { MemorySupabaseDocumentStore } from "./supabase.fixture";

test("supabase backend init and migrate can report manual-required or success", async () => {
  const backend = new SupabaseBackendProvider({
    store: new MemorySupabaseDocumentStore({ manualMigration: true }),
  });

  const initialized = await backend.initialize();
  const migrated = await backend.migrate();

  assert.equal(initialized.status, "manual_required");
  assert.equal(migrated.status, "manual_required");
  assert.equal(Boolean(initialized.migrationPath), true);
});

test("backend selection can fall back from supabase to file when env is missing", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-backend-fallback-"));
  const originalUrl = process.env.ORCHESTRATOR_SUPABASE_URL;
  const originalKey = process.env.ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ORCHESTRATOR_SUPABASE_URL;
  delete process.env.ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY;

  try {
    const dependencies = createDefaultDependencies({
      repoPath: process.cwd(),
      storageRoot,
      backendType: "supabase",
      backendFallbackType: "file",
    });
    assert.equal(dependencies.backend.backendType, "file");
  } finally {
    if (originalUrl) {
      process.env.ORCHESTRATOR_SUPABASE_URL = originalUrl;
    }
    if (originalKey) {
      process.env.ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  }
});
