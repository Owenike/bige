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
  retryRequestSchema,
  uuidLikeSchema,
} from "../lib/notification-productization";
import {
  clampRetryLimit,
  buildTemplateKeyPreview,
  mapPreferenceFormToApiPayload,
  mapRetryFilterPayload,
  mapTemplateFormToApiPayload,
  parseChannelQueryValue,
  normalizeTemplatePayload,
  parseEventQueryValue,
  parseCsvInput,
  parseJsonObjectText,
  parseRoleQueryValue,
  resolveSelectedChannelState,
} from "../lib/notification-productization-ui";
import { RETRY_BLOCKED_REASON_CODES, RETRY_DECISION_CODES, evaluateRetryDecision } from "../lib/notification-retry-policy";
import {
  parseRetryFilterQuery,
  resolvePreferencePrecedence,
  selectTemplateWithFallback,
} from "../lib/notification-productization-resolution";
import {
  computePreferenceCoverageFromRows,
  computeScheduledHealthFromRows,
  computeTemplateCoverageFromRows,
} from "../lib/notification-platform-ops-query";
import { buildNotificationAdminDiff, writeNotificationAdminAuditNonBlocking } from "../lib/notification-admin-audit";
import { parseNotificationOpsApiQuery, resolveManagerOpsScope, resolvePlatformOpsScope } from "../lib/notification-ops-api";
import type { ProfileContext } from "../lib/auth-context";
import {
  buildOpsDashboardSearchParams,
  buildOpsDashboardViewModel,
  computeCoveragePercent,
  getScheduledHealthTone,
  parseOpsDashboardQuery,
} from "../lib/notification-ops-dashboard-ui";
import { resolveNotificationPreference } from "../lib/notification-preference-resolution-service";
import { resolveNotificationTemplate } from "../lib/notification-template-resolution-service";
import { buildNotificationDeliveryPlanningDraft } from "../lib/notification-delivery-planning-draft-service";
import {
  computeNotificationCoverageGaps,
  computeTenantNotificationConfigIntegrity,
} from "../lib/notification-config-integrity";
import { parseNotificationAdminAuditQuery } from "../lib/notification-admin-audit-query";
import {
  buildNotificationAuditUiSearchParams,
  buildNotificationPreflightUiSearchParams,
  buildNotificationRuntimeReadinessUiSearchParams,
  formatIsoToLocalDateTimeInput,
  parseDateTimeInputToIso,
  parseNotificationAuditUiQuery,
  parseNotificationConfigIntegrityUiQuery,
  parseNotificationPreflightUiQuery,
  parseNotificationRuntimeReadinessUiQuery,
} from "../lib/notification-governance-read-ui";
import { parseNotificationPreflightQuery } from "../lib/notification-preflight-query";
import {
  buildConfigIntegrityViewModel,
  buildPreflightViewModel,
  buildRuntimeReadinessViewModel,
  formatDeliveryPlanningSkeletonPreview,
  formatPreferenceTraceLine,
  formatPreflightSkippedReason,
  formatPreflightTemplateResolution,
  formatRuntimeTemplateFallbackLine,
  resolveNotificationGovernanceTone,
  truncateDisplayValue,
} from "../lib/notification-governance-view-model";
import { getNotificationGovernanceNavItems } from "../lib/notification-governance-navigation";
import { getNotificationGovernanceRouteFileMap } from "../lib/notification-governance-route-map";
import {
  toRuntimeEventInputContract,
  toRuntimeTemplateResolutionContract,
} from "../lib/notification-runtime-integration-contracts";
import {
  buildNotificationAlertDiffSummary,
  getNotificationAlertAssignmentChange,
  isNotificationAlertTransitionAllowed,
} from "../lib/notification-alert-workflow";
import {
  buildNotificationTrendComparisonItem,
  resolveNotificationTrendDirection,
} from "../lib/notification-alert-trends";
import { canUseDailyRollupWindow } from "../lib/notification-rollup";
import { canUseOverviewDailyRollupWindow } from "../lib/notification-overview-query";
import { canUseAnalyticsDailyRollupWindow } from "../lib/notification-delivery-analytics";
import {
  getNotificationRuntimeSimulationScenario,
  listNotificationRuntimeSimulationScenarios,
} from "../lib/notification-runtime-simulation-fixtures";
import { validateNotificationRuntimeReadiness } from "../lib/notification-runtime-readiness-validator";

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

test("template payload normalize trims content and sets defaults", () => {
  const normalized = normalizeTemplatePayload({
    eventType: "opportunity_due",
    channel: "email",
    titleTemplate: "  Title  ",
    messageTemplate: "  Message  ",
    locale: "",
    emailSubject: "  Subject ",
    actionUrl: "  /manager/opportunities ",
    priority: "warning",
    channelPolicy: {},
    isActive: true,
  });
  assert.equal(normalized.locale, "zh-TW");
  assert.equal(normalized.titleTemplate, "Title");
  assert.equal(normalized.messageTemplate, "Message");
  assert.equal(normalized.emailSubject, "Subject");
  assert.equal(normalized.actionUrl, "/manager/opportunities");
});

test("manager tenant scope cannot cross tenant", () => {
  assert.equal(isManagerTenantScopeAllowed("11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isManagerTenantScopeAllowed("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"), false);
  assert.equal(isManagerTenantScopeAllowed("11111111-1111-4111-8111-111111111111", null), true);
});

test("platform tenant id validation uses uuid schema", () => {
  const validTenant = "11111111-1111-4111-8111-111111111111";
  assert.equal(uuidLikeSchema.parse(validTenant), validTenant);
  assert.throws(() => uuidLikeSchema.parse("tenant-not-uuid"));
});

test("retry request schema validates filters", () => {
  const parsed = retryRequestSchema.parse({
    action: "dry_run",
    tenantId: "11111111-1111-4111-8111-111111111111",
    statuses: ["failed", "retrying"],
    channels: ["email", "webhook"],
    eventType: "member_contract_expiring",
    limit: 120,
  });
  assert.equal(parsed.statuses?.length, 2);
  assert.equal(parsed.channels?.length, 2);
  assert.equal(parsed.limit, 120);
  assert.throws(() => retryRequestSchema.parse({ action: "dry_run", statuses: ["unknown"] }));
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

test("retry decision and blocked reason constants stay aligned", () => {
  assert.equal(RETRY_DECISION_CODES.includes("RETRYABLE"), true);
  assert.equal((RETRY_BLOCKED_REASON_CODES as readonly string[]).includes("RETRYABLE"), false);
  assert.equal(RETRY_BLOCKED_REASON_CODES.includes("IN_APP_NOT_RETRYABLE"), true);
});

test("shared UI helpers normalize csv, json object and retry limit", () => {
  assert.deepEqual(parseCsvInput("failed,retrying, ,failed"), ["failed", "retrying", "failed"]);
  assert.deepEqual(parseCsvInput(null), []);

  const policy = parseJsonObjectText('{"allowExternal":true}', "channel_policy");
  assert.equal(policy.allowExternal, true);
  assert.throws(() => parseJsonObjectText("[]", "channel_policy"));

  assert.equal(clampRetryLimit("0"), 1);
  assert.equal(clampRetryLimit("999"), 500);
  assert.equal(clampRetryLimit("100"), 100);
  assert.equal(clampRetryLimit("bad"), 200);
});

test("query parser helpers validate role/channel/event keys", () => {
  assert.equal(parseRoleQueryValue("manager", { includePlatformAdmin: false }), "manager");
  assert.equal(parseRoleQueryValue("platform_admin", { includePlatformAdmin: false }), null);
  assert.equal(parseRoleQueryValue("platform_admin", { includePlatformAdmin: true }), "platform_admin");
  assert.equal(parseChannelQueryValue("email"), "email");
  assert.equal(parseChannelQueryValue("fax"), null);
  assert.equal(parseEventQueryValue("opportunity_due"), "opportunity_due");
  assert.equal(parseEventQueryValue("unknown"), null);
});

test("selected channel helper resolves first enabled channel", () => {
  const stateA = resolveSelectedChannelState({ in_app: false, email: true });
  assert.equal(stateA.channel, "email");
  assert.equal(stateA.enabled, true);

  const stateB = resolveSelectedChannelState({ in_app: false, email: false });
  assert.equal(stateB.channel, "in_app");
  assert.equal(stateB.enabled, true);
});

test("form to payload mapping keeps fields normalized", () => {
  const prefPayload = mapPreferenceFormToApiPayload({
    tenantId: "11111111-1111-4111-8111-111111111111",
    mode: "role",
    eventType: "opportunity_due",
    role: "manager",
    channel: "email",
    channelEnabled: true,
    ruleEnabled: true,
    note: "  hello  ",
    source: "custom",
  });
  assert.equal(prefPayload.channels.email, true);
  assert.equal(prefPayload.channels.in_app, true);
  assert.equal(prefPayload.note, "hello");

  const templatePayload = mapTemplateFormToApiPayload({
    tenantId: null,
    eventType: "opportunity_due",
    channel: "webhook",
    locale: "",
    titleTemplate: "  title ",
    messageTemplate: " msg ",
    emailSubject: "  ",
    actionUrl: " /manager ",
    priority: "warning",
    channelPolicy: { allowExternal: true },
    isActive: true,
    version: 2,
  });
  assert.equal(templatePayload.locale, "zh-TW");
  assert.equal(templatePayload.titleTemplate, "title");
  assert.equal(templatePayload.emailSubject, null);
  assert.equal(templatePayload.actionUrl, "/manager");

  const retryPayload = mapRetryFilterPayload({
    action: "dry_run",
    tenantId: null,
    statuses: ["failed", "bad-status"],
    channels: ["email", "pager"],
    eventType: "opportunity_due",
    limit: 9999,
  });
  assert.deepEqual(retryPayload.statuses, ["failed"]);
  assert.deepEqual(retryPayload.channels, ["email"]);
  assert.equal(retryPayload.limit, 500);

  assert.equal(
    buildTemplateKeyPreview({
      tenantId: null,
      eventType: "opportunity_due",
      channel: "email",
      locale: "zh-TW",
    }),
    "global:opportunity_due:email:zh-TW",
  );
});

test("preference precedence applies user > role > tenant_default > platform_default", () => {
  const resolved = resolvePreferencePrecedence({
    platformDefault: {
      source: "platform_default",
      isEnabled: true,
      channels: { email: false, line: false },
    },
    tenantDefault: {
      source: "tenant_default",
      isEnabled: true,
      channels: { email: true, line: false },
    },
    rolePreference: {
      source: "role_preference",
      isEnabled: true,
      channels: { email: false, line: true },
    },
    userPreference: {
      source: "user_preference",
      isEnabled: false,
      channels: { email: true },
    },
  });

  assert.equal(resolved.source, "user_preference");
  assert.equal(resolved.isEnabled, false);
  assert.equal(Object.values(resolved.channels).some(Boolean), false);
  assert.deepEqual(resolved.trace, ["system_default", "platform_default", "tenant_default", "role_preference", "user_preference"]);
});

test("template fallback chooses tenant first then global by locale chain", () => {
  const rows = [
    {
      id: "1",
      tenant_id: null,
      event_type: "opportunity_due",
      channel: "email",
      locale: "zh-TW",
      is_active: true,
      version: 1,
      updated_at: "2026-03-10T12:00:00.000Z",
    },
    {
      id: "2",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      event_type: "opportunity_due",
      channel: "email",
      locale: "en-US",
      is_active: true,
      version: 2,
      updated_at: "2026-03-10T13:00:00.000Z",
    },
  ];

  const tenantHit = selectTemplateWithFallback({
    templates: rows,
    tenantId: "11111111-1111-4111-8111-111111111111",
    eventType: "opportunity_due",
    channel: "email",
    locale: "en-US",
  });
  assert.equal(tenantHit.selected?.id, "2");
  assert.equal(tenantHit.strategy, "tenant_locale");

  const globalFallback = selectTemplateWithFallback({
    templates: rows,
    tenantId: "11111111-1111-4111-8111-111111111111",
    eventType: "opportunity_due",
    channel: "email",
    locale: "zh-TW",
  });
  assert.equal(globalFallback.selected?.id, "1");
  assert.equal(globalFallback.strategy, "global_locale");
});

test("retry filter parser normalizes query params", () => {
  const params = new URLSearchParams({
    eventType: "opportunity_due",
    channels: "email,line,bad",
    statuses: "failed,retrying",
    deliveryId: "11111111-1111-4111-8111-111111111111",
    limit: "700",
  });
  const parsed = parseRetryFilterQuery(params);
  assert.equal(parsed.eventType, "opportunity_due");
  assert.deepEqual(parsed.channels, ["email", "line"]);
  assert.deepEqual(parsed.statuses, ["failed", "retrying"]);
  assert.equal(parsed.deliveryId, "11111111-1111-4111-8111-111111111111");
  assert.equal(parsed.limit, 500);
});

test("platform ops coverage helpers summarize missing template and preference pairs", () => {
  const templateCoverage = computeTemplateCoverageFromRows({
    tenantId: "11111111-1111-4111-8111-111111111111",
    rows: [
      {
        id: "1",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        event_type: "opportunity_due",
        channel: "email",
        locale: "zh-TW",
        is_active: true,
        version: 1,
        updated_at: "2026-03-10T12:00:00.000Z",
      },
    ],
  });
  assert.equal(templateCoverage.expectedCombinations > templateCoverage.coveredCombinations, true);
  assert.equal(templateCoverage.missingCombinations > 0, true);

  const preferenceCoverage = computePreferenceCoverageFromRows({
    roleRows: [
      {
        role: "manager",
        event_type: "opportunity_due",
        channels: { in_app: true, email: true, line: false, sms: false, webhook: false },
      },
    ],
    userRowsCount: 3,
  });
  assert.equal(preferenceCoverage.userPreferenceRows, 3);
  assert.equal(preferenceCoverage.channelEnabledCount.email, 1);
  assert.equal(preferenceCoverage.missingRoleEventPairs > 0, true);
});

test("scheduled health helper classifies stale/degraded correctly", () => {
  const stale = computeScheduledHealthFromRows({
    rows: [
      {
        id: "1",
        created_at: "2025-01-01T00:00:00.000Z",
        status: "success",
        job_type: "notification_sweep",
        error_count: 0,
      },
    ],
    staleAfterMinutes: 10,
  });
  assert.equal(stale.healthStatus, "stale");

  const degraded = computeScheduledHealthFromRows({
    rows: [
      {
        id: "2",
        created_at: new Date().toISOString(),
        status: "failed",
        job_type: "delivery_dispatch",
        error_count: 1,
      },
    ],
    staleAfterMinutes: 1000,
  });
  assert.equal(degraded.healthStatus, "degraded");
});

test("notification admin diff only includes changed keys", () => {
  const diff = buildNotificationAdminDiff({
    before: {
      channels: { email: false },
      note: "before",
      unchanged: true,
    },
    after: {
      channels: { email: true },
      note: "after",
      unchanged: true,
    },
  });
  assert.equal(Object.keys(diff).length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(diff, "channels"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(diff, "note"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(diff, "unchanged"), false);
});

test("ops api query parser and platform scope resolver normalize values", () => {
  const params = new URLSearchParams({
    tenantId: "11111111-1111-4111-8111-111111111111",
    limit: "99999",
    staleAfterMinutes: "0",
    defaultLocale: " ",
  });
  const parsed = parseNotificationOpsApiQuery(params);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.query.limit, 3000);
  assert.equal(parsed.query.staleAfterMinutes, 1);
  assert.equal(parsed.query.defaultLocale, "zh-TW");
  const scope = resolvePlatformOpsScope(parsed.query);
  assert.deepEqual(scope, {
    scope: "tenant",
    tenantId: "11111111-1111-4111-8111-111111111111",
  });
});

test("ops api manager scope guard blocks cross-tenant query", () => {
  const context: ProfileContext = {
    userId: "11111111-1111-4111-8111-111111111111",
    role: "manager",
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    branchId: null,
    tenantStatus: "active",
    subscriptionStatus: "active",
    subscriptionStartsAt: null,
    subscriptionEndsAt: null,
    subscriptionGraceEndsAt: null,
    subscriptionPlanCode: null,
    subscriptionPlanName: null,
    tenantAccessWarning: null,
    tenantRemainingDays: null,
  };
  const denied = resolveManagerOpsScope({
    context,
    query: {
      tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      limit: 100,
      staleAfterMinutes: 120,
      defaultLocale: "zh-TW",
    },
  });
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.code, "BRANCH_SCOPE_DENIED");

  const allowed = resolveManagerOpsScope({
    context,
    query: {
      tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      limit: 100,
      staleAfterMinutes: 120,
      defaultLocale: "zh-TW",
    },
  });
  assert.equal(allowed.ok, true);
});

test("notification admin audit non-blocking write does not throw on insert failure", async () => {
  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  const failingSupabase = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                maybeSingle: async () => ({
                  data: null,
                  error: { message: "audit insert failed" },
                }),
              };
            },
          };
        },
      };
    },
  };

  try {
    const result = await writeNotificationAdminAuditNonBlocking({
      supabase: failingSupabase as never,
      scope: "tenant",
      action: "retry_execute",
      tenantId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "22222222-2222-4222-8222-222222222222",
      actorRole: "manager",
      targetType: "notification_retry_operation",
      targetId: null,
      beforeData: { requested: 2 },
      afterData: { retried: 1 },
      metadata: {},
      logContext: "unit-test",
    });
    assert.equal(result.ok, false);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test("ops dashboard query parsing keeps manager tenant scope local and syncs search params", () => {
  const params = new URLSearchParams({
    tenantId: "11111111-1111-4111-8111-111111111111",
    limit: "9999",
    staleAfterMinutes: "0",
    status: "retrying",
  });
  const managerQuery = parseOpsDashboardQuery(params, "manager");
  assert.equal(managerQuery.tenantId, null);
  assert.equal(managerQuery.limit, 3000);
  assert.equal(managerQuery.staleAfterMinutes, 1);
  assert.equal(managerQuery.status, "retrying");

  const platformQuery = parseOpsDashboardQuery(params, "platform");
  assert.equal(platformQuery.tenantId, "11111111-1111-4111-8111-111111111111");
  const search = buildOpsDashboardSearchParams(platformQuery, "platform");
  assert.equal(search.get("tenantId"), "11111111-1111-4111-8111-111111111111");
  assert.equal(search.get("status"), "retrying");
});

test("ops dashboard view model mapping summarizes coverage and status focus", () => {
  const viewModel = buildOpsDashboardViewModel({
    query: {
      tenantId: null,
      limit: 500,
      staleAfterMinutes: 1440,
      status: "failed",
    },
    bundle: {
      scope: "platform",
      tenantId: null,
      warnings: ["sample warning"],
      summary: {
        scope: "platform",
        tenantId: null,
        warning: "sample warning",
        snapshot: {
          scope: "platform",
          tenantId: null,
          notificationHealth: {
            total: 10,
            sent: 6,
            failed: 2,
            retrying: 1,
            skipped: 1,
            pending: 0,
            channelNotConfigured: 1,
            byStatus: { sent: 6, failed: 2, retrying: 1, skipped: 1 },
            byChannel: { in_app: 5, email: 5 },
            providerErrorCodes: { PROVIDER_TIMEOUT: 2 },
          },
          scheduledHealth: {
            latestRun: {
              id: "1",
              createdAt: "2026-03-11T10:00:00.000Z",
              status: "success",
              jobType: "notification_sweep",
              errorCount: 0,
            },
            lastScheduledAt: "2026-03-11T10:00:00.000Z",
            minutesSinceLastScheduled: 5,
            healthStatus: "healthy",
            byJobTypeLatest: {
              notification_sweep: {
                id: "1",
                status: "success",
                createdAt: "2026-03-11T10:00:00.000Z",
                errorCount: 0,
              },
            },
          },
          templateCoverage: {
            expectedCombinations: 20,
            coveredCombinations: 10,
            missingCombinations: 10,
            missing: [{ eventType: "opportunity_due", channel: "email" }],
          },
          preferenceCoverage: {
            expectedRoleEventPairs: 30,
            configuredRoleEventPairs: 12,
            missingRoleEventPairs: 18,
            missing: [{ role: "manager", eventType: "opportunity_due" }],
            channelEnabledCount: { in_app: 12 },
            userPreferenceRows: 3,
          },
          retryOperations: {
            executeRuns: 4,
            executeByStatus: { success: 3, failed: 1 },
            auditRows: 8,
            dryRunActions: 3,
            executeActions: 5,
            blockedReasons: { MAX_ATTEMPTS_REACHED: 2 },
          },
        },
      },
      health: {
        scope: "platform",
        tenantId: null,
        notificationHealth: {
          total: 10,
          sent: 6,
          failed: 2,
          retrying: 1,
          skipped: 1,
          pending: 0,
          channelNotConfigured: 1,
          byStatus: { sent: 6, failed: 2, retrying: 1, skipped: 1 },
          byChannel: { in_app: 5, email: 5 },
          providerErrorCodes: { PROVIDER_TIMEOUT: 2 },
        },
        scheduledHealth: {
          latestRun: {
            id: "1",
            createdAt: "2026-03-11T10:00:00.000Z",
            status: "success",
            jobType: "notification_sweep",
            errorCount: 0,
          },
          lastScheduledAt: "2026-03-11T10:00:00.000Z",
          minutesSinceLastScheduled: 5,
          healthStatus: "healthy",
          byJobTypeLatest: {
            notification_sweep: {
              id: "1",
              status: "success",
              createdAt: "2026-03-11T10:00:00.000Z",
              errorCount: 0,
            },
          },
        },
      },
      coverage: {
        scope: "platform",
        tenantId: null,
        warning: null,
        templateCoverage: {
          expectedCombinations: 20,
          coveredCombinations: 10,
          missingCombinations: 10,
          missing: [{ eventType: "opportunity_due", channel: "email" }],
        },
        preferenceCoverage: {
          expectedRoleEventPairs: 30,
          configuredRoleEventPairs: 12,
          missingRoleEventPairs: 18,
          missing: [{ role: "manager", eventType: "opportunity_due" }],
          channelEnabledCount: { in_app: 12 },
          userPreferenceRows: 3,
        },
        retryOperations: {
          executeRuns: 4,
          executeByStatus: { success: 3, failed: 1 },
          auditRows: 8,
          dryRunActions: 3,
          executeActions: 5,
          blockedReasons: { MAX_ATTEMPTS_REACHED: 2 },
        },
      },
    },
  });

  assert.equal(viewModel.cards.failed, 2);
  assert.equal(viewModel.coverage.templatePercent, 50);
  assert.equal(viewModel.coverage.preferencePercent, 40);
  assert.equal(viewModel.retry.focusedStatusCount, 2);
  assert.equal(viewModel.retry.blockedReasons[0]?.[0], "MAX_ATTEMPTS_REACHED");
  assert.equal(viewModel.warnings.length, 1);
});

test("ops dashboard stale helpers return stable status tokens", () => {
  assert.equal(computeCoveragePercent(0, 0), 0);
  assert.equal(computeCoveragePercent(5, 10), 50);
  assert.equal(getScheduledHealthTone("healthy"), "good");
  assert.equal(getScheduledHealthTone("degraded"), "warn");
  assert.equal(getScheduledHealthTone("stale"), "danger");
  assert.equal(getScheduledHealthTone("no_runs"), "muted");
});

test("preference resolution service resolves precedence and explain", () => {
  const resolved = resolveNotificationPreference({
    platformDefault: {
      enabled: true,
      channels: { email: false, in_app: true },
    },
    tenantDefault: {
      enabled: true,
      channels: { email: true, in_app: true },
      reason: "tenant baseline",
    },
    rolePreference: {
      enabled: true,
      channels: { email: false, line: true, in_app: true },
    },
    userPreference: {
      enabled: false,
      channels: { email: true },
      reason: "user muted notifications",
    },
  });

  assert.equal(resolved.source, "user");
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.channels.in_app, false);
  assert.equal(resolved.reason, "explicitly_disabled");
  assert.equal(resolved.trace.some((item) => item.applied), true);
});

test("template resolution service falls back from tenant miss to global", () => {
  const resolved = resolveNotificationTemplate({
    templates: [
      {
        id: "g1",
        tenant_id: null,
        event_type: "opportunity_due",
        channel: "email",
        locale: "zh-TW",
        title_template: "Global title",
        message_template: "Global message",
        email_subject: "Global subject",
        action_url: "/manager/opportunities",
        priority: "warning",
        channel_policy: {},
        is_active: true,
        version: 2,
        updated_at: "2026-03-11T10:00:00.000Z",
      },
    ],
    tenantId: "11111111-1111-4111-8111-111111111111",
    eventType: "opportunity_due",
    channel: "email",
    locale: "zh-TW",
  });

  assert.equal(resolved.found, true);
  assert.equal(resolved.source, "global");
  assert.equal(resolved.strategy, "global_locale");
  assert.equal(resolved.template?.titleTemplate, "Global title");
});

test("delivery planning draft service emits skipped reasons when template missing", () => {
  const draft = buildNotificationDeliveryPlanningDraft({
    eventKey: "opportunity_due",
    tenantId: "11111111-1111-4111-8111-111111111111",
    recipients: [
      {
        userId: "u1",
        role: "manager",
      },
    ],
    preferenceResolution: {
      enabled: true,
      channels: { in_app: true, email: true, line: false, sms: false, webhook: false },
      source: "role",
      reason: "enabled_by_preference_rule",
      explain: "role preference is enabled",
      trace: [],
    },
    templateResolutionsByChannel: {
      in_app: {
        found: true,
        source: "tenant",
        strategy: "tenant_locale",
        template: {
          id: "t1",
          tenantId: "11111111-1111-4111-8111-111111111111",
          locale: "zh-TW",
          priority: "info",
          titleTemplate: "Title",
          messageTemplate: "Message",
          emailSubject: null,
          actionUrl: null,
          channelPolicy: {},
          version: 1,
        },
        missingReason: null,
        tried: [],
      },
      email: {
        found: false,
        source: "none",
        strategy: "none",
        template: null,
        missingReason: "missing",
        tried: [],
      },
    },
  });

  assert.equal(draft.ready, true);
  assert.equal(draft.plannedChannels.includes("in_app"), true);
  assert.equal(draft.plannedChannels.includes("email"), false);
  assert.equal(draft.skippedReasons.some((item) => item.code === "CHANNEL_TEMPLATE_MISSING"), true);
});

test("config integrity helper returns score and missing gaps", () => {
  const integrity = computeTenantNotificationConfigIntegrity({
    tenantId: "11111111-1111-4111-8111-111111111111",
    defaultLocale: "zh-TW",
    rolePreferenceRows: [
      {
        role: "manager",
        event_type: "opportunity_due",
        is_enabled: true,
        channels: { in_app: true, email: true, line: false, sms: false, webhook: false },
      },
    ],
    templateRows: [
      {
        id: "g1",
        tenant_id: null,
        event_type: "opportunity_due",
        channel: "in_app",
        locale: "zh-TW",
        title_template: "Global title",
        message_template: "Global message",
        email_subject: null,
        action_url: null,
        priority: "info",
        channel_policy: {},
        is_active: true,
        version: 1,
        updated_at: "2026-03-11T10:00:00.000Z",
      },
    ],
    requiredRoles: ["manager"],
    requiredEvents: ["opportunity_due"],
    requiredChannels: ["in_app", "email"],
  });

  assert.equal(integrity.summary.expectedRoleEventPairs, 1);
  assert.equal(integrity.summary.expectedTemplatePairs, 2);
  assert.equal(integrity.missingItems.missingTemplatePairs.length, 1);
  assert.equal(integrity.score < 100, true);

  const gaps = computeNotificationCoverageGaps({
    tenantId: "11111111-1111-4111-8111-111111111111",
    defaultLocale: "zh-TW",
    rolePreferenceRows: [
      {
        role: "manager",
        event_type: "opportunity_due",
        is_enabled: true,
        channels: { in_app: true, email: true, line: false, sms: false, webhook: false },
      },
    ],
    templateRows: [],
    requiredRoles: ["manager"],
    requiredEvents: ["opportunity_due"],
    requiredChannels: ["email"],
  });
  assert.equal(gaps.enabledChannelsWithoutTemplate.length, 1);
});

test("audit query parser validates tenant/action/time/cursor", () => {
  const ok = parseNotificationAdminAuditQuery(
    new URLSearchParams({
      tenantId: "11111111-1111-4111-8111-111111111111",
      action: "retry_execute",
      from: "2026-03-10T00:00:00.000Z",
      to: "2026-03-11T00:00:00.000Z",
      cursor: "2026-03-12T00:00:00.000Z",
      limit: "999",
    }),
  );
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.query.limit, 200);
  assert.equal(ok.query.action, "retry_execute");
  assert.equal(ok.query.tenantId, "11111111-1111-4111-8111-111111111111");

  const bad = parseNotificationAdminAuditQuery(new URLSearchParams({ from: "bad-date" }));
  assert.equal(bad.ok, false);
});

test("governance UI query helpers parse and build audit/config/preflight params", () => {
  const auditQuery = parseNotificationAuditUiQuery(
    new URLSearchParams({
      tenantId: "11111111-1111-4111-8111-111111111111",
      action: "template_upsert",
      resourceType: "notification_template",
      actorUserId: "22222222-2222-4222-8222-222222222222",
      from: "2026-03-11T00:00:00.000Z",
      to: "2026-03-11T12:00:00.000Z",
      limit: "999",
    }),
    "platform",
  );
  assert.equal(auditQuery.tenantId, "11111111-1111-4111-8111-111111111111");
  assert.equal(auditQuery.action, "template_upsert");
  assert.equal(auditQuery.limit, 200);

  const auditSearch = buildNotificationAuditUiSearchParams(auditQuery, "platform");
  assert.equal(auditSearch.get("action"), "template_upsert");
  assert.equal(auditSearch.get("tenantId"), "11111111-1111-4111-8111-111111111111");

  const integrityQuery = parseNotificationConfigIntegrityUiQuery(
    new URLSearchParams({
      tenantId: "11111111-1111-4111-8111-111111111111",
      defaultLocale: "en-US",
    }),
    "platform",
  );
  assert.equal(integrityQuery.tenantId, "11111111-1111-4111-8111-111111111111");
  assert.equal(integrityQuery.defaultLocale, "en-US");

  const preflightQuery = parseNotificationPreflightUiQuery(
    new URLSearchParams({
      tenantId: "11111111-1111-4111-8111-111111111111",
      eventKey: "opportunity_due",
      roleKey: "manager",
      channelHint: "email",
      recipientLimit: "500",
    }),
    "platform",
  );
  assert.equal(preflightQuery.roleKey, "manager");
  assert.equal(preflightQuery.channelHint, "email");
  assert.equal(preflightQuery.recipientLimit, 100);

  const preflightSearch = buildNotificationPreflightUiSearchParams(preflightQuery, "platform");
  assert.equal(preflightSearch.get("eventKey"), "opportunity_due");
  assert.equal(preflightSearch.get("channelHint"), "email");
});

test("preflight query parser validates event/role/user/channel and tenant", () => {
  const parsed = parseNotificationPreflightQuery(
    new URLSearchParams({
      tenantId: "11111111-1111-4111-8111-111111111111",
      eventKey: "opportunity_due",
      roleKey: "manager",
      userId: "22222222-2222-4222-8222-222222222222",
      channelHint: "email",
      locale: "zh-TW",
      recipientLimit: "42",
    }),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.query.tenantId, "11111111-1111-4111-8111-111111111111");
  assert.equal(parsed.query.eventKey, "opportunity_due");
  assert.equal(parsed.query.roleKey, "manager");
  assert.equal(parsed.query.userId, "22222222-2222-4222-8222-222222222222");
  assert.equal(parsed.query.channelHint, "email");
  assert.equal(parsed.query.recipientLimit, 42);

  const bad = parseNotificationPreflightQuery(new URLSearchParams({ eventKey: "bad-event" }));
  assert.equal(bad.ok, false);
});

test("audit datetime parser handles cursor/local datetime safely", () => {
  const iso = parseDateTimeInputToIso("2026-03-11T10:30");
  assert.equal(Boolean(iso), true);
  assert.equal(parseDateTimeInputToIso("not-a-date"), null);
  assert.equal(parseDateTimeInputToIso(""), null);

  const local = formatIsoToLocalDateTimeInput("2026-03-11T10:30:00.000Z");
  assert.equal(local.length, 16);
  assert.equal(formatIsoToLocalDateTimeInput("bad"), "");
});

test("config integrity view model maps score/completeness/severity", () => {
  const view = buildConfigIntegrityViewModel({
    scope: "tenant",
    tenantId: "11111111-1111-4111-8111-111111111111",
    integrity: {
      score: 78,
      healthStatus: "degraded",
      summary: {
        expectedRoleEventPairs: 20,
        configuredRoleEventPairs: 15,
        expectedTemplatePairs: 30,
        coveredTemplatePairs: 21,
        channelReadinessRate: 0.6,
      },
      missingItems: {
        missingRoleEventPairs: [{ role: "manager", eventType: "opportunity_due" }],
        missingTemplatePairs: [{ eventType: "opportunity_due", channel: "email" }],
        enabledChannelsWithoutTemplate: [{ channel: "email", eventTypes: ["opportunity_due"] }],
      },
      warnings: ["sample warning"],
    },
  });

  assert.equal(view.score, 78);
  assert.equal(view.templateCompleteness, 70);
  assert.equal(view.preferenceCompleteness, 75);
  assert.equal(view.totalMissing, 3);
  assert.equal(view.tone, "warning");
});

test("preflight helper formats skipped reason and template fallback summary", () => {
  assert.equal(
    formatPreflightSkippedReason({ code: "CHANNEL_TEMPLATE_MISSING", message: "No active template." }),
    "CHANNEL TEMPLATE MISSING: No active template.",
  );
  assert.equal(
    formatPreflightTemplateResolution({
      channel: "email",
      found: true,
      source: "global",
      strategy: "global_locale",
      missingReason: null,
    }),
    "email global (global locale)",
  );
  assert.equal(
    formatPreflightTemplateResolution({
      channel: "line",
      found: false,
      source: "none",
      strategy: "none",
      missingReason: "template_not_found",
    }),
    "line missing (template_not_found)",
  );
});

test("preflight view model summarizes warnings/skips/channels", () => {
  const view = buildPreflightViewModel({
    scope: "tenant",
    tenantId: "11111111-1111-4111-8111-111111111111",
    preflight: {
      scope: "tenant",
      tenantId: "11111111-1111-4111-8111-111111111111",
      input: {
        eventKey: "opportunity_due",
        roleKey: "manager",
        userId: null,
        channelHint: null,
        locale: "zh-TW",
        defaultLocale: "zh-TW",
        recipientLimit: 20,
      },
      preference: {
        enabled: true,
        channels: { in_app: true, email: true, line: false },
        source: "role",
        reason: "enabled_by_preference_rule",
        explain: "role enabled",
        trace: [],
      },
      templates: {
        channelsEvaluated: ["in_app", "email"],
        resolutions: [],
      },
      deliveryPlanning: {
        ready: true,
        plannedChannels: ["in_app", "email"],
        plannedRecipientsCount: 1,
        plannedRecipientsPreview: [{ userId: "u1", role: "manager" }],
        skippedReasons: [{ code: "CHANNEL_TEMPLATE_MISSING", message: "missing email template" }],
        contentSkeleton: {},
      },
      coverage: {
        integrityScore: 90,
        integrityHealthStatus: "healthy",
        missingRoleEventPairs: 0,
        missingTemplatePairs: 1,
        enabledChannelsWithoutTemplate: 1,
        missingForSelectedEvent: [],
      },
      warnings: ["global fallback used"],
    },
  });

  assert.equal(view.skippedCount, 1);
  assert.equal(view.warningCount, 1);
  assert.equal(view.coverageTone, "healthy");
  assert.deepEqual(view.selectedChannels, ["in_app", "email"]);
});

test("governance route map keeps platform/manager symmetry", () => {
  const routeMap = getNotificationGovernanceRouteFileMap();
  assert.equal(routeMap.length, 5);
  for (const item of routeMap) {
    assert.equal(item.platformPagePath.startsWith("/platform-admin/"), true);
    assert.equal(item.managerPagePath.startsWith("/manager/"), true);
    assert.equal(item.platformPageFile.startsWith("app/platform-admin/"), true);
    assert.equal(item.managerPageFile.startsWith("app/manager/"), true);
    assert.equal(item.componentFile.startsWith("components/notification-"), true);
    assert.equal(item.platformApiFiles.length > 0, true);
    assert.equal(item.managerApiFiles.length > 0, true);
  }
});

test("governance navigation items respect mode boundaries", () => {
  const platformItems = getNotificationGovernanceNavItems("platform");
  const managerItems = getNotificationGovernanceNavItems("manager");
  assert.equal(platformItems.length, 5);
  assert.equal(managerItems.length, 5);
  assert.equal(platformItems.every((item) => item.pagePath.startsWith("/platform-admin/")), true);
  assert.equal(managerItems.every((item) => item.pagePath.startsWith("/manager/")), true);
  assert.equal(platformItems.every((item) => item.readOnly), true);
  assert.equal(managerItems.every((item) => item.readOnly), true);
  assert.equal(platformItems.some((item) => item.key === "runtime-readiness"), true);
  assert.equal(managerItems.some((item) => item.key === "runtime-readiness"), true);
});

test("governance tone and truncation helpers stay stable", () => {
  assert.equal(resolveNotificationGovernanceTone("healthy"), "healthy");
  assert.equal(resolveNotificationGovernanceTone("degraded"), "warning");
  assert.equal(resolveNotificationGovernanceTone("stale"), "danger");
  assert.equal(resolveNotificationGovernanceTone("no_runs"), "neutral");
  assert.equal(truncateDisplayValue("1234567890", 6).includes("…"), true);
});

test("alert workflow transition guard keeps state machine boundaries", () => {
  assert.equal(isNotificationAlertTransitionAllowed("open", "acknowledged"), true);
  assert.equal(isNotificationAlertTransitionAllowed("acknowledged", "resolved"), true);
  assert.equal(isNotificationAlertTransitionAllowed("resolved", "open"), true);
  assert.equal(isNotificationAlertTransitionAllowed("dismissed", "resolved"), false);
  assert.equal(isNotificationAlertTransitionAllowed("resolved", "dismissed"), false);
});

test("alert workflow diff summary tracks before/after changes", () => {
  const diff = buildNotificationAlertDiffSummary({
    before: {
      status: "open",
      note: "old",
      resolutionNote: null,
    },
    after: {
      status: "resolved",
      note: "old",
      resolutionNote: "fixed provider config",
    },
  });
  assert.equal(diff.changedCount, 2);
  assert.equal(diff.changedKeys.includes("status"), true);
  assert.equal(diff.changedKeys.includes("resolutionNote"), true);
});

test("alert workflow assignment change helper classifies assign/reassign/unassign", () => {
  const assigned = getNotificationAlertAssignmentChange({
    beforeAssigneeUserId: null,
    afterAssigneeUserId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(assigned.kind, "assigned");
  assert.equal(assigned.changed, true);

  const reassigned = getNotificationAlertAssignmentChange({
    beforeAssigneeUserId: "11111111-1111-4111-8111-111111111111",
    afterAssigneeUserId: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(reassigned.kind, "reassigned");
  assert.equal(reassigned.changed, true);

  const unassigned = getNotificationAlertAssignmentChange({
    beforeAssigneeUserId: "11111111-1111-4111-8111-111111111111",
    afterAssigneeUserId: null,
  });
  assert.equal(unassigned.kind, "unassigned");
  assert.equal(unassigned.changed, true);

  const unchanged = getNotificationAlertAssignmentChange({
    beforeAssigneeUserId: "11111111-1111-4111-8111-111111111111",
    afterAssigneeUserId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(unchanged.kind, "unchanged");
  assert.equal(unchanged.changed, false);
});

test("trend comparison helper computes count/rate delta with direction", () => {
  const compared = buildNotificationTrendComparisonItem({
    currentCount: 10,
    previousCount: 4,
    currentDenominator: 20,
    previousDenominator: 20,
  });
  assert.equal(compared.countDelta, 6);
  assert.equal(compared.currentRate, 50);
  assert.equal(compared.previousRate, 20);
  assert.equal(compared.rateDelta, 30);
  assert.equal(compared.direction, "up");

  const flat = buildNotificationTrendComparisonItem({
    currentCount: 3,
    previousCount: 3,
    currentDenominator: 10,
    previousDenominator: 10,
  });
  assert.equal(flat.direction, "flat");
});

test("trend direction helper classifies up/down/flat with epsilon", () => {
  assert.equal(resolveNotificationTrendDirection({ countDelta: 1, rateDelta: 0 }), "up");
  assert.equal(resolveNotificationTrendDirection({ countDelta: -1, rateDelta: 0 }), "down");
  assert.equal(resolveNotificationTrendDirection({ countDelta: 0, rateDelta: 0.01, epsilon: 0.05 }), "flat");
  assert.equal(resolveNotificationTrendDirection({ countDelta: 0, rateDelta: -0.2, epsilon: 0.05 }), "down");
});

test("daily rollup window guard only allows whole-day UTC windows", () => {
  assert.equal(
    canUseDailyRollupWindow({
      currentFromIso: "2026-03-10T00:00:00.000Z",
      currentToIso: "2026-03-10T23:59:59.999Z",
      previousFromIso: "2026-03-09T00:00:00.000Z",
      previousToIso: "2026-03-09T23:59:59.999Z",
    }),
    true,
  );

  assert.equal(
    canUseDailyRollupWindow({
      currentFromIso: "2026-03-10T08:00:00.000Z",
      currentToIso: "2026-03-11T07:59:59.000Z",
      previousFromIso: "2026-03-09T08:00:00.000Z",
      previousToIso: "2026-03-10T07:59:59.000Z",
    }),
    false,
  );
});

test("overview rollup guard only allows whole-day UTC windows", () => {
  assert.equal(canUseOverviewDailyRollupWindow("2026-03-10T00:00:00.000Z", "2026-03-10T23:59:59.999Z"), true);
  assert.equal(canUseOverviewDailyRollupWindow("2026-03-10T08:00:00.000Z", "2026-03-10T20:00:00.000Z"), false);
});

test("analytics rollup guard only allows whole-day UTC windows", () => {
  assert.equal(canUseAnalyticsDailyRollupWindow("2026-03-10T00:00:00.000Z", "2026-03-10T23:59:59.999Z"), true);
  assert.equal(canUseAnalyticsDailyRollupWindow("2026-03-10T08:00:00.000Z", "2026-03-10T20:00:00.000Z"), false);
});

test("runtime integration contracts normalize event input and template fallback reason", () => {
  const eventInput = toRuntimeEventInputContract({
    tenantId: "11111111-1111-4111-8111-111111111111",
    eventKey: "opportunity_due",
    roleKey: "manager",
    locale: "",
    defaultLocale: "",
    recipientLimit: 999,
  });
  assert.equal(eventInput.locale, "zh-TW");
  assert.equal(eventInput.defaultLocale, "zh-TW");
  assert.equal(eventInput.recipientLimit, 100);

  const templateContract = toRuntimeTemplateResolutionContract({
    channel: "email",
    resolution: {
      found: true,
      source: "global",
      strategy: "global_locale",
      template: {
        id: "tpl1",
        tenantId: null,
        locale: "zh-TW",
        priority: "info",
        titleTemplate: "Title",
        messageTemplate: "Message",
        emailSubject: "Subject",
        actionUrl: null,
        channelPolicy: {},
        version: 1,
      },
      missingReason: null,
      tried: [],
    },
  });
  assert.equal(templateContract.fallbackReason, "GLOBAL_LOCALE_FALLBACK");
});

test("runtime simulation fixtures expose required baseline scenarios", () => {
  const scenarios = listNotificationRuntimeSimulationScenarios();
  assert.equal(scenarios.length >= 6, true);
  assert.equal(Boolean(getNotificationRuntimeSimulationScenario("complete_tenant_ready")), true);
  assert.equal(Boolean(getNotificationRuntimeSimulationScenario("missing_template_tenant")), true);
  assert.equal(Boolean(getNotificationRuntimeSimulationScenario("missing_preference_tenant")), true);
  assert.equal(Boolean(getNotificationRuntimeSimulationScenario("user_override_disabled")), true);
  assert.equal(Boolean(getNotificationRuntimeSimulationScenario("role_fallback_tenant_default")), true);
  assert.equal(Boolean(getNotificationRuntimeSimulationScenario("skipped_disabled_scenario")), true);
});

test("runtime readiness validator reports missing template and readiness false", () => {
  const scenario = getNotificationRuntimeSimulationScenario("missing_template_tenant");
  assert.equal(Boolean(scenario), true);
  if (!scenario) return;

  const report = validateNotificationRuntimeReadiness({
    eventInput: scenario.eventInput,
    preferenceInput: scenario.preferenceInput,
    templates: scenario.templates,
    recipients: scenario.recipients,
    rolePreferenceRows: scenario.rolePreferenceRows,
    requiredRoles: ["manager"],
    requiredEvents: ["opportunity_due"],
    requiredChannels: ["email"],
  });

  assert.equal(report.readiness.ready, false);
  assert.equal(report.readiness.missingTemplates.some((item) => item.channel === "email"), true);
  assert.equal(report.warnings.some((item) => item.code === "TEMPLATE_MISSING"), true);
});

test("runtime readiness validator reports user disabled with skipped reasons", () => {
  const scenario = getNotificationRuntimeSimulationScenario("user_override_disabled");
  assert.equal(Boolean(scenario), true);
  if (!scenario) return;

  const report = validateNotificationRuntimeReadiness({
    eventInput: scenario.eventInput,
    preferenceInput: scenario.preferenceInput,
    templates: scenario.templates,
    recipients: scenario.recipients,
    rolePreferenceRows: scenario.rolePreferenceRows,
  });

  assert.equal(report.preference.enabled, false);
  assert.equal(report.deliveryPlanning.ready, false);
  assert.equal(report.deliveryPlanning.skippedReasons.some((item) => item.code === "PREFERENCE_DISABLED"), true);
  assert.equal(report.warnings.some((item) => item.code === "PREFERENCE_DISABLED"), true);
});

test("runtime readiness validator reports role fallback warning but ready state", () => {
  const scenario = getNotificationRuntimeSimulationScenario("role_fallback_tenant_default");
  assert.equal(Boolean(scenario), true);
  if (!scenario) return;

  const report = validateNotificationRuntimeReadiness({
    eventInput: scenario.eventInput,
    preferenceInput: scenario.preferenceInput,
    templates: scenario.templates,
    recipients: scenario.recipients,
    rolePreferenceRows: scenario.rolePreferenceRows,
  });

  assert.equal(report.readiness.ready, true);
  assert.equal(report.readiness.missingPreferences.some((item) => item.reason.includes("role_preference_not_configured")), true);
});

test("runtime readiness query parser enforces manager tenant scope and keeps scenario", () => {
  const managerQuery = parseNotificationRuntimeReadinessUiQuery(
    new URLSearchParams({
      tenantId: "11111111-1111-4111-8111-111111111111",
      eventKey: "opportunity_due",
      roleKey: "manager",
      channelHint: "email",
      recipientLimit: "500",
      scenarioId: "missing_template_tenant",
    }),
    "manager",
  );
  assert.equal(managerQuery.tenantId, null);
  assert.equal(managerQuery.recipientLimit, 100);
  assert.equal(managerQuery.scenarioId, "missing_template_tenant");

  const platformQuery = parseNotificationRuntimeReadinessUiQuery(
    new URLSearchParams({
      tenantId: "11111111-1111-4111-8111-111111111111",
      eventKey: "opportunity_due",
      scenarioId: "complete_tenant_ready",
    }),
    "platform",
  );
  assert.equal(platformQuery.tenantId, "11111111-1111-4111-8111-111111111111");
  const search = buildNotificationRuntimeReadinessUiSearchParams(platformQuery, "platform");
  assert.equal(search.get("tenantId"), "11111111-1111-4111-8111-111111111111");
  assert.equal(search.get("scenarioId"), "complete_tenant_ready");
});

test("runtime readiness view-model and formatter helpers produce stable output", () => {
  const payload: import("../lib/notification-governance-read-ui").NotificationRuntimeReadinessApiPayload = {
    scope: "tenant",
    tenantId: "11111111-1111-4111-8111-111111111111",
    source: "live",
    scenarioId: null,
    report: {
      eventInput: {
        tenantId: "11111111-1111-4111-8111-111111111111",
        eventKey: "opportunity_due",
        roleKey: "manager",
        userId: null,
        channelHint: null,
        locale: "zh-TW",
        defaultLocale: "zh-TW",
        recipientLimit: 20,
        payload: {},
      },
      preference: {
        enabled: true,
        channels: { in_app: true, email: true, line: false, sms: false, webhook: false },
        source: "role",
        reason: "enabled_by_preference_rule",
        explain: "role enabled",
        trace: [{ source: "role", enabled: true, applied: true, reason: "role enabled" }],
      },
      templates: [
        {
          channel: "email",
          found: true,
          source: "global",
          strategy: "global_locale",
          fallbackReason: "GLOBAL_LOCALE_FALLBACK",
          template: null,
          missingReason: null,
        },
      ],
      deliveryPlanning: {
        ready: true,
        plannedChannels: ["in_app", "email"],
        plannedRecipients: [{ userId: "u1", role: "manager", plannedChannels: ["in_app", "email"] }],
        plannedContentSkeleton: { in_app: { titleTemplate: "t" } },
        skippedReasons: [{ code: "CHANNEL_TEMPLATE_MISSING", message: "missing sms template" }],
      },
      readiness: {
        ready: true,
        missingPreferences: [],
        missingTemplates: [],
        unavailableChannels: [],
        fallbacks: [{ channel: "email", strategy: "global_locale", reason: "GLOBAL_LOCALE_FALLBACK" }],
      },
      warnings: [{ code: "FALLBACK_APPLIED", message: "email uses global_locale." }],
    },
  };

  const vm = buildRuntimeReadinessViewModel(payload);
  assert.equal(vm.ready, true);
  assert.equal(vm.fallbackCount, 1);
  assert.equal(vm.warningCount, 1);
  assert.equal(vm.tone, "warning");

  assert.equal(
    formatPreferenceTraceLine({
      source: "role",
      enabled: true,
      applied: true,
      reason: "role enabled",
    }),
    "role | enabled:true | applied:true | role enabled",
  );
  assert.equal(
    formatRuntimeTemplateFallbackLine({
      channel: "email",
      strategy: "global_locale",
      fallbackReason: "GLOBAL_LOCALE_FALLBACK",
      missingReason: null,
    }),
    "email -> global locale (GLOBAL_LOCALE_FALLBACK)",
  );
  assert.equal(
    formatDeliveryPlanningSkeletonPreview({ in_app: {}, email: {} }).includes("in_app"),
    true,
  );
});

