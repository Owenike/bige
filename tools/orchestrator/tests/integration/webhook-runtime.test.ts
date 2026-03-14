import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import { createDefaultDependencies } from "../../src/orchestrator";
import { startWebhookServer } from "../../src/webhook-server";
import { evaluateWebhookRuntime } from "../../src/webhook-runtime";

async function getJson(url: string) {
  const target = new URL(url);
  return await new Promise<{ statusCode: number; body: unknown }>((resolve, reject) => {
    const request = http.request(
      {
        method: "GET",
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

test("webhook runtime reports degraded readiness when token is missing but secret/config/backend are present", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-webhook-runtime-"));
  const configPath = path.join(root, "actor-policy.json");
  await writeFile(
    configPath,
    `${JSON.stringify({ version: "runtime-v1", runActors: ["orchestrator-runner"] }, null, 2)}\n`,
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

  const summary = await evaluateWebhookRuntime({
    dependencies,
    webhookSecret: "secret",
    actorPolicyConfigPath: configPath,
    liveReportingEnabled: true,
  });
  assert.equal(summary.readinessStatus, "degraded");
  assert.equal(summary.actorPolicy?.version, "runtime-v1");
});

test("webhook server exposes health and readiness endpoints", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-webhook-runtime-server-"));
  const configPath = path.join(root, "actor-policy.json");
  await writeFile(
    configPath,
    `${JSON.stringify({ version: "runtime-v2", runActors: ["orchestrator-runner"] }, null, 2)}\n`,
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

  const server = await startWebhookServer({
    port: 8793,
    secret: "secret",
    actorPolicyConfigPath: configPath,
    dependencies,
    repoPath: process.cwd(),
    outputRoot: path.join(root, "status"),
  });
  try {
    const health = await getJson(server.healthUrl);
    const ready = await getJson(server.readinessUrl);
    assert.equal(health.statusCode, 200);
    assert.equal(ready.statusCode, 200);
    assert.equal((health.body as { healthStatus: string }).healthStatus === "ready" || (health.body as { healthStatus: string }).healthStatus === "degraded", true);
    assert.equal((ready.body as { readinessStatus: string }).readinessStatus === "ready" || (ready.body as { readinessStatus: string }).readinessStatus === "degraded", true);
  } finally {
    await server.close();
  }
});

test("webhook runtime blocks readiness when actor policy config path is unreadable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-webhook-runtime-blocked-"));
  const dependencies = createDefaultDependencies({
    repoPath: process.cwd(),
    storageRoot: root,
    backendType: "file",
    backendFallbackType: "blocked",
    executorMode: "mock",
    workspaceRoot: path.join(root, "workspaces"),
  });

  const summary = await evaluateWebhookRuntime({
    dependencies,
    webhookSecret: "secret",
    actorPolicyConfigPath: path.join(root, "missing.json"),
    liveReportingEnabled: true,
  });
  assert.equal(summary.readinessStatus, "blocked");
});
