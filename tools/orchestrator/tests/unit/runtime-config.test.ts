import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { loadWebhookHostingConfig, buildWebhookRoute } from "../../src/runtime-config";

test("runtime config normalizes host, port, base path, and webhook route", () => {
  const config = loadWebhookHostingConfig({
    repoPath: process.cwd(),
    env: {
      ORCHESTRATOR_WEBHOOK_HOST: "0.0.0.0",
      ORCHESTRATOR_WEBHOOK_PORT: "9010",
      ORCHESTRATOR_WEBHOOK_BASE_PATH: "hooks/internal/",
      ORCHESTRATOR_WEBHOOK_PATH: "github/events",
      GITHUB_WEBHOOK_SECRET: "secret",
      ORCHESTRATOR_ACTOR_POLICY_CONFIG: "actor-policy.json",
    } as unknown as NodeJS.ProcessEnv,
  });

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 9010);
  assert.equal(config.basePath, "/hooks/internal");
  assert.equal(config.webhookPath, "/github/events");
  assert.equal(config.webhookSecret, "secret");
  assert.equal(config.actorPolicyConfigPath, "actor-policy.json");
  assert.equal(
    config.outputRoot,
    path.join(process.cwd(), ".tmp", "orchestrator-status-report"),
  );
  assert.equal(buildWebhookRoute(config.basePath, config.webhookPath), "/hooks/internal/github/events");
});

test("runtime config rejects invalid ports", () => {
  assert.throws(
    () =>
      loadWebhookHostingConfig({
        repoPath: process.cwd(),
        env: {
          ORCHESTRATOR_WEBHOOK_PORT: "99999",
        } as unknown as NodeJS.ProcessEnv,
      }),
    /Invalid webhook port/,
  );
});
