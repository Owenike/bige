import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import { createDefaultDependencies } from "../../src/orchestrator";
import { startWebhookHosting } from "../../src/webhook-hosting";

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

test("webhook hosting starts on configured host, port, and base path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-webhook-hosting-"));
  const configPath = path.join(root, "actor-policy.json");
  await writeFile(
    configPath,
    `${JSON.stringify({ version: "hosting-v1", runActors: ["orchestrator-runner"] }, null, 2)}\n`,
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
      host: "127.0.0.1",
      port: 8794,
      basePath: "/hooks/runtime",
      webhookPath: "/github",
      webhookSecret: "secret",
      actorPolicyConfigPath: configPath,
    },
  });

  try {
    assert.match(hosting.url, /\/hooks\/runtime\/github$/);
    assert.match(hosting.healthUrl, /\/hooks\/runtime\/healthz$/);
    assert.match(hosting.readinessUrl, /\/hooks\/runtime\/readyz$/);
    assert.match(hosting.startupText, /Webhook hosting ready/);

    const health = await getJson(hosting.healthUrl);
    const readiness = await getJson(hosting.readinessUrl);
    assert.equal(health.statusCode, 200);
    assert.equal(readiness.statusCode, 200);
    assert.equal((health.body as { basePath: string }).basePath, "/hooks/runtime");
    assert.equal((readiness.body as { webhookPath: string }).webhookPath, "/github");
  } finally {
    await hosting.close();
  }
});
