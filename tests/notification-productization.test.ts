import assert from "node:assert/strict";
import test from "node:test";
import {
  appRoleSchema,
  channelPreferencesSchema,
  isManagerTenantScopeAllowed,
  normalizeChannels,
  normalizeTemplatePolicy,
  notificationChannelSchema,
  notificationEventKeySchema,
  notificationPrioritySchema,
} from "../lib/notification-productization";
import { evaluateRetryDecision } from "../lib/notification-retry-policy";

test("preference payload validation accepts known event/role/channel", () => {
  const eventKey = notificationEventKeySchema.parse("member_contract_expiring");
  const role = appRoleSchema.parse("manager");
  const channel = notificationChannelSchema.parse("email");
  assert.equal(eventKey, "member_contract_expiring");
  assert.equal(role, "manager");
  assert.equal(channel, "email");
});

test("preference payload validation rejects unknown event", () => {
  assert.throws(() => notificationEventKeySchema.parse("unknown_event"));
});

test("channel normalize keeps in_app true by default and respects overrides", () => {
  const parsed = channelPreferencesSchema.parse({ email: true, webhook: true });
  const normalized = normalizeChannels(parsed);
  assert.equal(normalized.in_app, true);
  assert.equal(normalized.email, true);
  assert.equal(normalized.webhook, true);
  assert.equal(normalized.line, false);
});

test("template payload validation handles priority and policy", () => {
  const priority = notificationPrioritySchema.parse("critical");
  const policy = normalizeTemplatePolicy({
    allowExternal: true,
    suppressInApp: false,
    maxRetries: 2,
    throttleMinutes: 15,
  });
  assert.equal(priority, "critical");
  assert.equal(policy.allowExternal, true);
  assert.equal(policy.maxRetries, 2);
});

test("manager tenant scope cannot cross tenant", () => {
  assert.equal(isManagerTenantScopeAllowed("tenant-a", "tenant-a"), true);
  assert.equal(isManagerTenantScopeAllowed("tenant-a", "tenant-b"), false);
  assert.equal(isManagerTenantScopeAllowed("tenant-a", null), true);
});

test("retry eligibility returns blocked reasons and retryable path", () => {
  const blockedInApp = evaluateRetryDecision({
    id: "1",
    tenant_id: "t",
    channel: "in_app",
    status: "failed",
    attempts: 0,
    max_attempts: 3,
    error_code: null,
    error_message: null,
    next_retry_at: null,
    created_at: new Date().toISOString(),
  });
  assert.equal(blockedInApp.eligible, false);
  assert.equal(blockedInApp.code, "IN_APP_NOT_RETRYABLE");

  const blockedMaxAttempts = evaluateRetryDecision({
    id: "2",
    tenant_id: "t",
    channel: "email",
    status: "failed",
    attempts: 3,
    max_attempts: 3,
    error_code: "PROVIDER_5XX",
    error_message: "error",
    next_retry_at: null,
    created_at: new Date().toISOString(),
  });
  assert.equal(blockedMaxAttempts.eligible, false);
  assert.equal(blockedMaxAttempts.code, "MAX_ATTEMPTS_REACHED");

  const retryable = evaluateRetryDecision({
    id: "3",
    tenant_id: "t",
    channel: "email",
    status: "failed",
    attempts: 1,
    max_attempts: 3,
    error_code: "PROVIDER_TIMEOUT",
    error_message: "timeout",
    next_retry_at: null,
    created_at: new Date().toISOString(),
  });
  assert.equal(retryable.eligible, true);
  assert.equal(retryable.code, "RETRYABLE");
});
