import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import { createDefaultDependencies } from "../../src/orchestrator";
import { startWebhookHosting } from "../../src/webhook-hosting";

test("webhook hosting shutdown returns a summary and closes the listener", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-webhook-shutdown-"));
  const configPath = path.join(root, "actor-policy.json");
  await writeFile(
    configPath,
    `${JSON.stringify({ version: "shutdown-v1", runActors: ["orchestrator-runner"] }, null, 2)}\n`,
    "utf8",
  );
  const dependencies = createDefaultDependencies({
    repoPath: process.cwd(),
    storageRoot: root,
    backendType: "file",
    backendFallbackType: "blocked",
    executorMode: "mock",
    workspaceRoot: path.join(root, "workspaces"),
  });
  const hosting = await startWebhookHosting({
    repoPath: process.cwd(),
    dependencies,
    outputRoot: path.join(root, "status"),
    options: {
      port: 8795,
      webhookSecret: "secret",
      actorPolicyConfigPath: configPath,
    },
  });

  const summary = await hosting.shutdown("test_shutdown");
  assert.equal(summary.reason, "test_shutdown");
  assert.ok(summary.closedAt);

  const target = new URL(hosting.healthUrl);
  await assert.rejects(
    () =>
      new Promise((resolve, reject) => {
        const request = http.request(
          {
            method: "GET",
            hostname: target.hostname,
            port: target.port,
            path: target.pathname,
          },
          resolve,
        );
        request.on("error", reject);
        request.end();
      }),
  );
});
