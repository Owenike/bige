import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import { createDefaultDependencies } from "../../src/orchestrator";
import { startWebhookServer } from "../../src/webhook-server";

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function postJson(url: string, body: string, headers: Record<string, string>) {
  const target = new URL(url);
  return await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const request = http.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body).toString(),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

test("webhook server accepts valid signed GitHub payloads and persists orchestrator state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-webhook-server-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot: root,
    backendType: "file",
    backendFallbackType: "blocked",
    executorMode: "mock",
    workspaceRoot: path.join(root, "workspaces"),
  });
  const server = await startWebhookServer({
    port: 8791,
    secret: "secret",
    dependencies,
    repoPath,
    outputRoot: path.join(root, "status"),
  });
  try {
    const rawBody = JSON.stringify({
      action: "opened",
      issue: {
        id: 41,
        number: 41,
        title: "Server-backed webhook intake",
        body: "serve webhooks",
      },
      repository: {
        full_name: "example/bige",
        name: "bige",
        default_branch: "main",
      },
      sender: {
        login: "orchestrator-runner",
        id: 1,
        type: "User",
      },
    });
    const response = await postJson(server.url, rawBody, {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-server-1",
      "x-hub-signature-256": sign(rawBody, "secret"),
    });
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body) as { status: string; inboundAuditId: string | null };
    assert.equal(payload.status, "created");
    assert.equal(typeof payload.inboundAuditId, "string");
  } finally {
    await server.close();
  }
});

test("webhook server rejects invalid signatures without enqueuing a task", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-webhook-server-invalid-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot: root,
    backendType: "file",
    backendFallbackType: "blocked",
    executorMode: "mock",
    workspaceRoot: path.join(root, "workspaces"),
  });
  const server = await startWebhookServer({
    port: 8792,
    secret: "secret",
    dependencies,
    repoPath,
    outputRoot: path.join(root, "status"),
  });
  try {
    const rawBody = JSON.stringify({
      action: "opened",
      issue: {
        id: 42,
        number: 42,
        title: "Invalid signature",
      },
      repository: {
        full_name: "example/bige",
        name: "bige",
        default_branch: "main",
      },
      sender: {
        login: "orchestrator-runner",
        id: 1,
        type: "User",
      },
    });
    const response = await postJson(server.url, rawBody, {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-server-2",
      "x-hub-signature-256": "sha256=deadbeef",
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await server.close();
  }
});
