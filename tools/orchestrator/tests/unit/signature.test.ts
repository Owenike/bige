import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { verifyGitHubWebhookSignature } from "../../src/webhook";

test("signature verification accepts valid GitHub signatures", () => {
  const rawBody = JSON.stringify({ hello: "world" });
  const secret = "top-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const result = verifyGitHubWebhookSignature({
    rawBody,
    signature,
    secret,
  });
  assert.equal(result.status, "verified");
  assert.equal(result.blockedReason, null);
});

test("signature verification rejects missing secret and invalid signatures clearly", () => {
  const rawBody = JSON.stringify({ hello: "world" });
  const missingSecret = verifyGitHubWebhookSignature({
    rawBody,
    signature: "sha256=abc",
    secret: null,
  });
  assert.equal(missingSecret.status, "missing_secret");

  const invalid = verifyGitHubWebhookSignature({
    rawBody,
    signature: "sha256=deadbeef",
    secret: "top-secret",
  });
  assert.equal(invalid.status, "invalid_signature");
  assert.equal(invalid.blockedReason?.code, "invalid_webhook_signature");
});
