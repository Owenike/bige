import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies } from "../../src/orchestrator";
import { ingestGitHubWebhook } from "../../src/webhook";

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

test("webhook intake accepts valid GitHub issue payloads and creates an orchestrator task", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-webhook-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot: root,
    backendType: "file",
    backendFallbackType: "blocked",
    executorMode: "mock",
    workspaceRoot: path.join(root, "workspaces"),
  });
  const rawBody = JSON.stringify({
    action: "opened",
    issue: {
      id: 101,
      number: 44,
      title: "Investigate webhook intake",
      body: "Make webhook intake work",
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

  const result = await ingestGitHubWebhook({
    rawBody,
    headers: {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-1",
      "x-hub-signature-256": sign(rawBody, "secret"),
    },
    secret: "secret",
    dependencies,
    repoPath,
    enqueue: true,
    reportStatus: false,
    statusAdapter: null,
    statusOutputRoot: path.join(root, "status"),
  });

  assert.equal(result.status, "created");
  assert.equal(result.signatureStatus, "verified");
  assert.equal(result.state?.webhookEventType, "issues");
  assert.equal(result.state?.webhookDeliveryId, "delivery-1");
  assert.equal(result.state?.sourceEventType, "issue_opened");
  assert.equal(result.state?.actorIdentity?.login, "orchestrator-runner");
});
