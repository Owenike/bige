import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemAuditRecord, sanitizeAuditValue } from "../lib/system-audit";

test("sanitizeAuditValue redacts secrets and preserves useful audit fields", () => {
  assert.deepEqual(
    sanitizeAuditValue({
      bookingId: "booking-1",
      password: "do-not-store",
      nested: { accessToken: "secret", status: "completed" },
    }),
    {
      bookingId: "booking-1",
      password: "[REDACTED]",
      nested: { accessToken: "[REDACTED]", status: "completed" },
    },
  );
});

test("buildSystemAuditRecord captures request identity without credentials", () => {
  const request = new Request("https://bigefitness.com/api/auth/login", {
    method: "POST",
    headers: {
      "x-forwarded-for": "203.0.113.20, 10.0.0.1",
      "x-request-id": "request-123",
      "user-agent": "Audit Browser/1.0",
      "sec-ch-ua-platform": '"iPadOS"',
    },
  });

  const record = buildSystemAuditRecord({
    request,
    eventCategory: "authentication",
    action: "auth.login",
    outcome: "failure",
    accountType: "staff",
    accountIdentifier: "E000001",
    metadata: { password: "never", statusCode: 401 },
  });

  assert.equal(record.ip_address, "203.0.113.20");
  assert.equal(record.user_agent, "Audit Browser/1.0");
  assert.equal(record.request_id, "request-123");
  assert.equal(record.account_identifier, "E000001");
  assert.deepEqual(record.metadata, {
    method: "POST",
    path: "/api/auth/login",
    platform: "iPadOS",
    password: "[REDACTED]",
    statusCode: 401,
  });
});
