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
import {
  buildNotificationAggregationMetadata,
  buildNotificationAggregationResolutionReason,
  describeNotificationReadApiResponseSchemaIssues,
  describeNotificationAggregationMetadataContractIssues,
  buildTrendRollupEligibilityMetadata,
  formatNotificationAggregationDataSourceLabel,
  getNotificationAggregationMetadata,
  getNotificationAggregationWindowType,
  listMissingNotificationAggregationMetadataFields,
  normalizeNotificationReadApiRegressionFixture,
  NOTIFICATION_AGGREGATION_CORE_METADATA_FIELDS,
  NOTIFICATION_AGGREGATION_EXPLAINABILITY_FIELDS,
  NOTIFICATION_AGGREGATION_METADATA_FIELDS,
  notificationAggregationMetadataSchema,
  validateNotificationAggregationMetadataSchema,
  validateNotificationReadApiResponseSchema,
} from "../lib/notification-aggregation-contract";
import {
  NotificationReadApiConsumerError,
  getTenantDrilldownRecentAnomaliesSupportNote,
  parseNotificationReadApiPayload,
} from "../lib/notification-read-api-client";
import {
  NotificationReadApiOrchestrationError,
  buildNotificationOverviewPagePaths,
  buildNotificationReadApiRequestKey,
  buildNotificationTenantDrilldownQueryFingerprint,
  buildNotificationTenantDrilldownPath,
  classifyNotificationReadApiOrchestrationError,
  loadNotificationOverviewPageData,
  loadNotificationTenantDrilldownPageData,
  prefetchNotificationTenantDrilldownFromOverviewState,
  prefetchNotificationTenantDrilldownPageData,
} from "../lib/notification-read-api-hooks";
import {
  buildNotificationOverviewPageHrefFromQueryState,
  createNotificationOverviewQueryStateDefaults,
  createNotificationTenantDrilldownQueryStateDefaults,
  hydrateNotificationOverviewQueryStateFromSearchParams,
  hydrateNotificationTenantDrilldownQueryStateFromSearchParams,
  normalizeNotificationOverviewQueryState,
  normalizeNotificationTenantDrilldownQueryState,
  serializeNotificationOverviewQueryParams,
  serializeNotificationTenantDrilldownQueryParams,
} from "../lib/notification-read-api-query-state";
import {
  buildNotificationOverviewHrefFromTenantDrilldownState,
  buildNotificationOverviewPageUrl,
  buildNotificationTenantDrilldownStateFromOverviewState,
  buildNotificationTenantDrilldownHrefFromOverviewState,
  buildNotificationTenantDrilldownPageUrl,
} from "../lib/notification-read-api-url-state";
import {
  clearNotificationReadApiResultCache,
  inspectNotificationReadApiResultCache,
  invalidateNotificationReadApiResultCache,
  NOTIFICATION_READ_API_RESULT_CACHE_EXPIRED_MS,
  NOTIFICATION_READ_API_RESULT_CACHE_MAX_ENTRIES,
  NOTIFICATION_READ_API_RESULT_CACHE_TTL_MS,
  NotificationReadApiRequestLifecycleController,
  pruneNotificationReadApiResultCache,
  shouldRevalidateNotificationReadApiOnVisible,
} from "../lib/notification-read-api-request-state";
import { canUseDailyRollupWindow } from "../lib/notification-rollup";
import {
  canUseOverviewDailyRollupWindow,
  canUseTenantDrilldownDailyRollupWindow,
  TENANT_DRILLDOWN_RECENT_ANOMALIES_DATA_SOURCE,
  TENANT_DRILLDOWN_RECENT_ANOMALIES_RAW_REASON,
} from "../lib/notification-overview-query";
import { canUseAnalyticsDailyRollupWindow } from "../lib/notification-delivery-analytics";
import {
  getNotificationRuntimeSimulationScenario,
  listNotificationRuntimeSimulationScenarios,
} from "../lib/notification-runtime-simulation-fixtures";
import { validateNotificationRuntimeReadiness } from "../lib/notification-runtime-readiness-validator";
import { NOTIFICATION_READ_API_REGRESSION_CASES } from "./notification-read-api-regression-fixtures";

function buildConsumerReadApiPayload(
  api: "overview" | "analytics" | "trends" | "tenant_drilldown",
  metadata: ReturnType<typeof buildNotificationAggregationMetadata>,
  options?: {
    snapshotOverrides?: Record<string, unknown>;
  },
) {
  if (api === "overview" || api === "analytics") {
    const snapshot = {
      from: "2026-03-10T00:00:00.000Z",
      to: "2026-03-10T23:59:59.999Z",
      tenantId: null,
      channel: null,
      dataSource: metadata.dataSource,
      totalRows: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      retrying: 0,
      deadLetter: 0,
      opened: 0,
      clicked: 0,
      conversion: 0,
      successRate: 0,
      failRate: 0,
      openRate: 0,
      clickRate: 0,
      conversionRate: 0,
      rateDefinitions: {
        successFailDenominator: "sent_plus_failed" as const,
        engagementDenominator: "sent" as const,
      },
      daily: [],
      byChannel: [],
      byTenant: [],
      ...(options?.snapshotOverrides || {}),
    };
    return {
      ok: true,
      data: {
        snapshot,
        ...metadata,
      },
      snapshot,
      ...metadata,
    };
  }

  if (api === "trends") {
    const snapshot = {
      tenantId: null,
      channel: null,
      dataSource: metadata.dataSource,
      currentWindow: {
        from: "2026-03-10T08:00:00.000Z",
        to: "2026-03-10T20:00:00.000Z",
        durationMinutes: 720,
        totalDeliveries: 0,
        anomalyCount: 0,
        anomalyRate: 0,
      },
      previousWindow: {
        from: "2026-03-09T08:00:00.000Z",
        to: "2026-03-09T20:00:00.000Z",
        durationMinutes: 720,
        totalDeliveries: 0,
        anomalyCount: 0,
        anomalyRate: 0,
      },
      overall: {
        currentCount: 0,
        previousCount: 0,
        countDelta: 0,
        currentRate: 0,
        previousRate: 0,
        rateDelta: 0,
        direction: "flat" as const,
      },
      byTenant: [],
      byAnomalyType: [],
      byChannel: [],
      topWorseningTenants: [],
      topWorseningAnomalyTypes: [],
      topWorseningChannels: [],
      rateDefinitions: {
        anomalyRateDenominator: "total_deliveries_in_window" as const,
      },
      ...(options?.snapshotOverrides || {}),
    };
    return {
      ok: true,
      data: {
        snapshot,
        ...metadata,
      },
      snapshot,
      ...metadata,
    };
  }

  const snapshot = {
    from: "2026-03-10T00:00:00.000Z",
    to: "2026-03-10T23:59:59.999Z",
    tenantId: "11111111-1111-4111-8111-111111111111",
    channel: null,
    dataSource: metadata.dataSource,
    totalRows: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    retrying: 0,
    deadLetter: 0,
    opened: 0,
    clicked: 0,
    conversion: 0,
    successRate: 0,
    failRate: 0,
    openRate: 0,
    clickRate: 0,
    conversionRate: 0,
    rateDefinitions: {
      successFailDenominator: "sent_plus_failed" as const,
      engagementDenominator: "sent" as const,
    },
    daily: [],
    byChannel: [],
    recentAnomalies: [],
    anomalySummary: {
      total: 0,
      failed: 0,
      deadLetter: 0,
      retrying: 0,
    },
    ...(options?.snapshotOverrides || {}),
  };
  return {
    ok: true,
    data: {
      snapshot,
      ...metadata,
    },
    snapshot,
    ...metadata,
  };
}

function buildAnomalyInsightsPayload() {
  const snapshot = {
    from: "2026-03-10T00:00:00.000Z",
    to: "2026-03-10T23:59:59.999Z",
    tenantId: null,
    channel: null,
    totalAnomalies: 1,
    reasonClusters: [
      {
        key: "provider_timeout",
        label: "Provider Timeout",
        sample: "timeout",
        count: 1,
        deadLetter: 0,
        failed: 1,
        retrying: 0,
        tenantCount: 1,
        channelCount: 1,
      },
    ],
    tenantPriorities: [
      {
        tenantId: "tenant-1",
        priority: "P2" as const,
        severity: "high" as const,
        score: 42,
        deadLetter: 0,
        failedRate: 12.5,
        retrying: 1,
        anomalyTotal: 3,
        recentAnomalies: 2,
        previousAnomalies: 1,
        surgeRatio: 2,
        summary: "High retry spike.",
      },
    ],
    priorityRule: {
      scoreFormula: "deadLetter*5 + failed*2 + retrying",
      weights: {
        deadLetter: 5,
        failed: 2,
        retrying: 1,
        failedRateBands: [{ threshold: 10, bonus: 5 }],
        surgeBands: [{ condition: "ratio >= 2", bonus: 3 }],
      },
      severityBands: [{ severity: "high" as const, minScore: 30 }],
    },
  };

  return {
    ok: true,
    data: { snapshot },
    snapshot,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createAbortError(message = "The operation was aborted.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

test("tenant drilldown rollup guard only allows whole-day UTC windows", () => {
  assert.equal(canUseTenantDrilldownDailyRollupWindow("2026-03-10T00:00:00.000Z", "2026-03-10T23:59:59.999Z"), true);
  assert.equal(canUseTenantDrilldownDailyRollupWindow("2026-03-10T08:00:00.000Z", "2026-03-10T20:00:00.000Z"), false);
});

test("analytics rollup guard only allows whole-day UTC windows", () => {
  assert.equal(canUseAnalyticsDailyRollupWindow("2026-03-10T00:00:00.000Z", "2026-03-10T23:59:59.999Z"), true);
  assert.equal(canUseAnalyticsDailyRollupWindow("2026-03-10T08:00:00.000Z", "2026-03-10T20:00:00.000Z"), false);
});

test("aggregation metadata contract guardrail covers overview, analytics, trends, and tenant drilldown", () => {
  const cases = [
    {
      label: "overview auto(non-day)",
      metadata: buildNotificationAggregationMetadata({
        aggregationModeRequested: "auto",
        dataSource: "raw",
        isWholeUtcDayWindow: false,
        rollupEligible: false,
      }),
    },
    {
      label: "analytics auto(whole-day)",
      metadata: buildNotificationAggregationMetadata({
        aggregationModeRequested: "auto",
        dataSource: "rollup",
        isWholeUtcDayWindow: true,
        rollupEligible: true,
      }),
    },
    {
      label: "trends auto(non-day)",
      metadata: buildNotificationAggregationMetadata({
        aggregationModeRequested: "auto",
        dataSource: "raw",
        isWholeUtcDayWindow: false,
        rollupEligible: false,
        reasonScope: "trends",
      }),
    },
    {
      label: "tenant drilldown auto(whole-day)",
      metadata: buildNotificationAggregationMetadata({
        aggregationModeRequested: "auto",
        dataSource: "rollup",
        isWholeUtcDayWindow: true,
        rollupEligible: true,
      }),
    },
  ];

  for (const item of cases) {
    const payload = {
      ok: true,
      data: {
        snapshot: { dataSource: item.metadata.dataSource },
        ...item.metadata,
      },
      ...item.metadata,
    };
    assert.deepEqual(listMissingNotificationAggregationMetadataFields(payload), [], `${item.label} missing fields`);
    assert.deepEqual(
      describeNotificationAggregationMetadataContractIssues({ payload, expected: item.metadata }),
      [],
      `${item.label} contract issues`,
    );
    assert.deepEqual(getNotificationAggregationMetadata(payload), item.metadata, `${item.label} extracted metadata`);
  }
});

test("aggregation metadata contract guardrail reports field drift and resolved/source mismatch", () => {
  const missingPayload = {
    ok: true,
    data: {
      snapshot: { dataSource: "raw" },
      aggregationModeRequested: "auto",
      dataSource: "raw",
    },
  };
  assert.deepEqual(listMissingNotificationAggregationMetadataFields(missingPayload), [
    "aggregationModeResolved",
    "isWholeUtcDayWindow",
    "rollupEligible",
    "resolutionReason",
    "requestedWindowType",
    "snapshotWindowType",
  ]);

  const driftPayload = {
    ok: true,
    aggregationModeRequested: "auto",
    aggregationModeResolved: "rollup",
    dataSource: "raw",
    isWholeUtcDayWindow: false,
    rollupEligible: false,
    resolutionReason:
      "aggregationMode=auto fell back to raw query aggregation because the requested window is not a whole UTC-day window.",
    requestedWindowType: "partial_utc_window",
    snapshotWindowType: "partial_utc_window",
  };
  const issues = describeNotificationAggregationMetadataContractIssues({
    payload: driftPayload,
    expected: {
      aggregationModeRequested: "auto",
      aggregationModeResolved: "raw",
      dataSource: "raw",
      isWholeUtcDayWindow: false,
      rollupEligible: false,
      resolutionReason:
        "aggregationMode=auto fell back to raw query aggregation because the requested window is not a whole UTC-day window.",
      requestedWindowType: "partial_utc_window",
      snapshotWindowType: "partial_utc_window",
    },
  });
  assert.equal(issues.some((item) => item.includes("aggregationModeResolved/dataSource mismatch")), true);
  assert.equal(issues.some((item) => item.includes("aggregationModeResolved expected raw, got rollup")), true);
  assert.equal(NOTIFICATION_AGGREGATION_CORE_METADATA_FIELDS.length, 5);
  assert.equal(NOTIFICATION_AGGREGATION_EXPLAINABILITY_FIELDS.length, 3);
  assert.equal(NOTIFICATION_AGGREGATION_METADATA_FIELDS.length, 8);
});

test("aggregation metadata schema validates types and emits structured guardrail issues", () => {
  const validPayload = {
    ok: true,
    ...buildNotificationAggregationMetadata({
      aggregationModeRequested: "auto",
      dataSource: "raw",
      isWholeUtcDayWindow: false,
      rollupEligible: false,
    }),
  };
  const validMetadata = getNotificationAggregationMetadata(validPayload);
  assert.equal(Boolean(validMetadata), true);
  assert.equal(notificationAggregationMetadataSchema.safeParse(validMetadata).success, true);
  assert.deepEqual(validateNotificationAggregationMetadataSchema({ payload: validPayload }), []);

  const invalidPayload = {
    ok: true,
    aggregationModeRequested: "auto",
    aggregationModeResolved: "raw",
    dataSource: "raw",
    isWholeUtcDayWindow: "false",
    rollupEligible: false,
    resolutionReason: "",
    requestedWindowType: "partial_utc_window",
    snapshotWindowType: "partial_utc_window",
  };
  const issues = validateNotificationAggregationMetadataSchema({ payload: invalidPayload as never });
  assert.equal(issues.some((item) => item.kind === "type_mismatch" && item.path === "isWholeUtcDayWindow"), true);
  assert.equal(issues.some((item) => item.kind === "type_mismatch" && item.path === "resolutionReason"), true);
});

test("read API schema and fixture regression stay locked for overview, analytics, trends, and tenant drilldown", () => {
  for (const item of NOTIFICATION_READ_API_REGRESSION_CASES) {
    assert.deepEqual(
      validateNotificationReadApiResponseSchema({
        api: item.api,
        scenario: item.scenario,
        payload: item.payload,
        expectedMetadata: item.expectedMetadata,
        expectedFixture: item.expectedFixture,
      }),
      [],
      `${item.scenario} schema issues`,
    );
    assert.deepEqual(
      normalizeNotificationReadApiRegressionFixture({
        api: item.api,
        scenario: item.scenario,
        payload: item.payload,
      }),
      item.expectedFixture,
      `${item.scenario} normalized fixture`,
    );
  }
});

test("read API schema guardrail reports schema drift, rule mismatch, and fixture drift clearly", () => {
  const caseItem = NOTIFICATION_READ_API_REGRESSION_CASES.find((item) => item.scenario === "overview_auto_non_day");
  assert.equal(Boolean(caseItem), true);
  if (!caseItem) return;

  const driftPayload = {
    ...caseItem.payload,
    snapshot: {
      ...(caseItem.payload.snapshot as Record<string, unknown>),
      byTenant: "broken-shape",
    },
    data: {
      ...(caseItem.payload.data as Record<string, unknown>),
      snapshot: {
        ...((caseItem.payload.data as Record<string, unknown>).snapshot as Record<string, unknown>),
        byTenant: "broken-shape",
      },
      aggregationModeResolved: "rollup",
      dataSource: "raw",
    },
    aggregationModeResolved: "rollup",
    dataSource: "raw",
  };

  const issues = validateNotificationReadApiResponseSchema({
    api: "overview",
    scenario: caseItem.scenario,
    payload: driftPayload,
    expectedMetadata: caseItem.expectedMetadata,
    expectedFixture: caseItem.expectedFixture,
  });
  assert.equal(issues.some((item) => item.kind === "rule_mismatch" && item.path === "aggregationModeResolved"), true);
  assert.equal(issues.some((item) => item.kind === "type_mismatch" && item.path === "snapshot.byTenant"), true);

  const described = describeNotificationReadApiResponseSchemaIssues({
    api: "overview",
    scenario: caseItem.scenario,
    payload: driftPayload,
    expectedMetadata: caseItem.expectedMetadata,
    expectedFixture: caseItem.expectedFixture,
  });
  assert.equal(described.some((item) => item.includes("rule_mismatch: aggregationModeResolved/dataSource mismatch")), true);
  assert.equal(described.some((item) => item.includes("type_mismatch: snapshot.byTenant")), true);

  const fixtureIssues = validateNotificationReadApiResponseSchema({
    api: "overview",
    scenario: caseItem.scenario,
    payload: caseItem.payload,
    expectedMetadata: caseItem.expectedMetadata,
    expectedFixture: {
      ...caseItem.expectedFixture,
      snapshot: {
        ...caseItem.expectedFixture.snapshot,
        hasByTenant: false,
      },
    },
  });
  assert.equal(fixtureIssues.some((item) => item.kind === "fixture_drift" && item.path === "fixture.snapshot.hasByTenant"), true);
});

test("read API consumer adapter parses overview, analytics, trends, and tenant drilldown fixtures", () => {
  for (const item of NOTIFICATION_READ_API_REGRESSION_CASES) {
    const parsed = parseNotificationReadApiPayload(item.api, buildConsumerReadApiPayload(item.api, item.expectedMetadata));
    assert.equal(parsed.api, item.api);
    assert.deepEqual(parsed.aggregation, item.expectedMetadata, `${item.scenario} aggregation`);
    assert.equal(parsed.snapshot.dataSource, item.expectedMetadata.dataSource, `${item.scenario} snapshot source`);
  }
});

test("read API consumer adapter raises explicit contract drift errors", () => {
  const caseItem = NOTIFICATION_READ_API_REGRESSION_CASES.find((item) => item.scenario === "trends_auto_non_day");
  assert.equal(Boolean(caseItem), true);
  if (!caseItem) return;

  const brokenPayload = {
    ...caseItem.payload,
    resolutionReason: "",
    data: {
      ...(caseItem.payload.data as Record<string, unknown>),
      resolutionReason: "",
    },
  };

  assert.throws(
    () => parseNotificationReadApiPayload("trends", brokenPayload),
    (error: unknown) => {
      assert.equal(error instanceof NotificationReadApiConsumerError, true);
      if (!(error instanceof NotificationReadApiConsumerError)) return false;
      assert.equal(error.api, "trends");
      assert.equal(error.message.includes("type_mismatch"), true);
      assert.equal(error.message.includes("resolutionReason"), true);
      return true;
    },
  );
});

test("tenant drilldown consumer adapter exposes raw-backed anomaly support note by design", () => {
  const caseItem = NOTIFICATION_READ_API_REGRESSION_CASES.find((item) => item.scenario === "tenant_drilldown_auto_whole_day");
  assert.equal(Boolean(caseItem), true);
  if (!caseItem) return;

  const parsed = parseNotificationReadApiPayload(
    "tenant_drilldown",
    buildConsumerReadApiPayload("tenant_drilldown", caseItem.expectedMetadata),
  );
  assert.equal(parsed.recentAnomaliesRawBacked, true);
  assert.equal(parsed.recentAnomaliesDataSource, "raw");
  assert.equal(parsed.recentAnomaliesReason, getTenantDrilldownRecentAnomaliesSupportNote());
});

test("read API orchestration builds overview and tenant drilldown request URLs centrally", () => {
  const expectedFrom = encodeURIComponent(new Date("2026-03-10T08:00").toISOString());
  const expectedTo = encodeURIComponent(new Date("2026-03-10T20:00").toISOString());

  assert.deepEqual(
    buildNotificationOverviewPagePaths({
      tenantId: "tenant-1",
      channel: "email",
      from: "2026-03-10T08:00",
      to: "2026-03-10T20:00",
      limit: 500,
    }),
    {
      overviewPath:
        `/api/platform/notifications/overview?tenantId=tenant-1&channel=email&from=${expectedFrom}&to=${expectedTo}&limit=500&aggregationMode=auto`,
      anomaliesPath:
        `/api/platform/notifications/anomalies?tenantId=tenant-1&channel=email&from=${expectedFrom}&to=${expectedTo}&limit=500`,
      trendsPath:
        `/api/platform/notifications/trends?tenantId=tenant-1&channel=email&from=${expectedFrom}&to=${expectedTo}&limit=500&topLimit=8`,
    },
  );

  assert.equal(
    buildNotificationTenantDrilldownPath("tenant-1", {
      channel: "email",
      aggregationMode: "auto",
      from: "2026-03-10T08:00",
      to: "2026-03-10T20:00",
      limit: 500,
      anomalyLimit: 40,
    }),
    `/api/platform/notifications/overview/tenants/tenant-1?channel=email&aggregationMode=auto&from=${expectedFrom}&to=${expectedTo}&limit=500&anomalyLimit=40`,
  );
});

test("overview read API orchestration loads parsed overview, anomalies, and trends together", async () => {
  const metadata = buildNotificationAggregationMetadata({
    aggregationModeRequested: "auto",
    dataSource: "raw",
    isWholeUtcDayWindow: false,
    rollupEligible: false,
  });
  const overview = parseNotificationReadApiPayload(
    "overview",
    buildConsumerReadApiPayload("overview", metadata, {
      snapshotOverrides: { totalRows: 12, byChannel: [{ channel: "email", total: 12, sent: 10, failed: 2, pending: 0, retrying: 0, deadLetter: 0, opened: 4, clicked: 1, conversion: 1, successRate: 83.33, failRate: 16.67, openRate: 40, clickRate: 10, conversionRate: 10 }] },
    }),
  );
  const trends = parseNotificationReadApiPayload("trends", buildConsumerReadApiPayload("trends", metadata));

  const result = await loadNotificationOverviewPageData(
    {
      tenantId: "",
      channel: "",
      from: "2026-03-10T08:00",
      to: "2026-03-10T20:00",
      limit: 2000,
    },
    {
      fetchOverview: async () => overview,
      fetchTrends: async () => trends,
      fetchImpl: async () => jsonResponse(buildAnomalyInsightsPayload()),
    },
  );

  assert.equal(result.overview.snapshot.totalRows, 12);
  assert.equal(result.overview.aggregation.aggregationModeResolved, "raw");
  assert.equal(result.insights.totalAnomalies, 1);
  assert.equal(result.trends.aggregation.dataSource, "raw");
  assert.equal(result.isEmpty, false);
});

test("read API orchestration classifies network, api, contract, and empty failures clearly", async () => {
  const metadata = buildNotificationAggregationMetadata({
    aggregationModeRequested: "auto",
    dataSource: "raw",
    isWholeUtcDayWindow: false,
    rollupEligible: false,
  });
  const overview = parseNotificationReadApiPayload("overview", buildConsumerReadApiPayload("overview", metadata));
  const trends = parseNotificationReadApiPayload("trends", buildConsumerReadApiPayload("trends", metadata));

  await assert.rejects(
    () =>
      loadNotificationOverviewPageData(
        {
          tenantId: "",
          channel: "",
          from: "2026-03-10T08:00",
          to: "2026-03-10T20:00",
          limit: 2000,
        },
        {
          fetchOverview: async () => {
            throw new TypeError("fetch failed");
          },
          fetchTrends: async () => trends,
          fetchImpl: async () => jsonResponse(buildAnomalyInsightsPayload()),
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof NotificationReadApiOrchestrationError, true);
      if (!(error instanceof NotificationReadApiOrchestrationError)) return false;
      assert.equal(error.kind, "network");
      assert.equal(error.source, "overview");
      assert.equal(error.message.includes("network request failed"), true);
      return true;
    },
  );

  await assert.rejects(
    () =>
      loadNotificationOverviewPageData(
        {
          tenantId: "",
          channel: "",
          from: "2026-03-10T08:00",
          to: "2026-03-10T20:00",
          limit: 2000,
        },
        {
          fetchOverview: async () => overview,
          fetchTrends: async () => trends,
          fetchImpl: async () => jsonResponse({ message: "missing snapshot" }),
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof NotificationReadApiOrchestrationError, true);
      if (!(error instanceof NotificationReadApiOrchestrationError)) return false;
      assert.equal(error.kind, "empty");
      assert.equal(error.source, "anomalies");
      assert.equal(error.message.includes("payload is empty"), true);
      return true;
    },
  );

  await assert.rejects(
    () =>
      loadNotificationOverviewPageData(
        {
          tenantId: "",
          channel: "",
          from: "2026-03-10T08:00",
          to: "2026-03-10T20:00",
          limit: 2000,
        },
        {
          fetchOverview: async () => {
            throw new NotificationReadApiConsumerError({
              api: "overview",
              status: 500,
              message: "overview request failed (500): boom",
              issues: ["boom"],
            });
          },
          fetchTrends: async () => trends,
          fetchImpl: async () => jsonResponse(buildAnomalyInsightsPayload()),
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof NotificationReadApiOrchestrationError, true);
      if (!(error instanceof NotificationReadApiOrchestrationError)) return false;
      assert.equal(error.kind, "api");
      assert.equal(error.source, "overview");
      assert.equal(error.status, 500);
      return true;
    },
  );

  await assert.rejects(
    () =>
      loadNotificationOverviewPageData(
        {
          tenantId: "",
          channel: "",
          from: "2026-03-10T08:00",
          to: "2026-03-10T20:00",
          limit: 2000,
        },
        {
          fetchOverview: async () => overview,
          fetchTrends: async () => {
            throw new NotificationReadApiConsumerError({
              api: "trends",
              status: null,
              message: "trends response contract drift: type_mismatch: resolutionReason",
              issues: ["type_mismatch: resolutionReason"],
            });
          },
          fetchImpl: async () => jsonResponse(buildAnomalyInsightsPayload()),
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof NotificationReadApiOrchestrationError, true);
      if (!(error instanceof NotificationReadApiOrchestrationError)) return false;
      assert.equal(error.kind, "contract");
      assert.equal(error.source, "trends");
      assert.equal(error.message.includes("contract drift"), true);
      return true;
    },
  );
});

test("tenant drilldown orchestration keeps raw-backed support note visible to consumers", async () => {
  const metadata = buildNotificationAggregationMetadata({
    aggregationModeRequested: "auto",
    dataSource: "rollup",
    isWholeUtcDayWindow: true,
    rollupEligible: true,
  });

  const drilldown = parseNotificationReadApiPayload(
    "tenant_drilldown",
    buildConsumerReadApiPayload("tenant_drilldown", metadata, {
      snapshotOverrides: {
        totalRows: 7,
        recentAnomalies: [
          {
            id: "anomaly-1",
            channel: "email",
            status: "failed",
            errorCode: "PROVIDER_TIMEOUT",
            errorMessage: "timeout",
            lastError: "timeout",
            attempts: 1,
            retryCount: 1,
            maxAttempts: 5,
            nextRetryAt: null,
            occurredAt: "2026-03-10T09:00:00.000Z",
          },
        ],
      },
    }),
  );

  const result = await loadNotificationTenantDrilldownPageData(
    "tenant-1",
    {
      channel: "",
      aggregationMode: "auto",
      from: "2026-03-10T00:00",
      to: "2026-03-10T23:59",
      limit: 2000,
      anomalyLimit: 40,
    },
    {
      fetchDrilldown: async () => drilldown,
    },
  );

  assert.equal(result.drilldown.aggregation.aggregationModeResolved, "rollup");
  assert.equal(result.drilldown.recentAnomaliesRawBacked, true);
  assert.equal(result.recentAnomaliesSupportNote, getTenantDrilldownRecentAnomaliesSupportNote());
  assert.equal(result.isEmpty, false);
});

test("read API lifecycle controller keeps only the latest response when requests resolve out of order", async () => {
  clearNotificationReadApiResultCache();
  const states: Array<{
    data: string | null;
    loading: boolean;
    error: NotificationReadApiOrchestrationError | null;
    phase: string;
  }> = [];
  const first = createDeferredPromise<string>();
  const second = createDeferredPromise<string>();
  const controller = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: (state) => {
      states.push({
        data: state.data,
        loading: state.loading,
        error: state.error,
        phase: state.phase,
      });
    },
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  controller.start({
    requestKey: "overview:first",
    cause: "query",
    loader: async () => first.promise,
  });
  controller.start({
    requestKey: "overview:second",
    cause: "query",
    loader: async () => second.promise,
  });
  await flushAsyncWork();

  first.resolve("stale");
  await first.promise;
  await flushAsyncWork();
  assert.equal(controller.getState().data, null);

  second.resolve("fresh");
  await second.promise;
  await flushAsyncWork();

  assert.equal(controller.getState().data, "fresh");
  assert.equal(controller.getState().error, null);
  assert.equal(states.some((state) => state.data === "stale"), false);
  assert.equal(states[states.length - 1]?.phase, "idle");
});

test("read API lifecycle controller dedupes same in-flight query and distinguishes refresh from initial load", async () => {
  clearNotificationReadApiResultCache();
  const shared = createDeferredPromise<string>();
  let loaderCalls = 0;
  const overviewController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });
  const drilldownController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  const loader = async () => {
    loaderCalls += 1;
    return shared.promise;
  };

  overviewController.start({
    requestKey: "shared:key",
    cause: "query",
    loader,
  });
  drilldownController.start({
    requestKey: "shared:key",
    cause: "query",
    loader,
  });
  await flushAsyncWork();

  assert.equal(loaderCalls, 1);
  shared.resolve("shared-result");
  await shared.promise;
  await flushAsyncWork();

  assert.equal(overviewController.getState().data, "shared-result");
  assert.equal(drilldownController.getState().data, "shared-result");

  const refresh = createDeferredPromise<string>();
  overviewController.start({
    requestKey: "shared:key|refresh:1",
    cause: "refresh",
    loader: async () => refresh.promise,
  });
  assert.equal(overviewController.getState().phase, "refreshing");
  refresh.resolve("shared-refresh");
  await refresh.promise;
  await flushAsyncWork();
  assert.equal(overviewController.getState().data, "shared-refresh");
});

test("read API lifecycle controller treats cancelled requests as non-errors and ignores unmount writes", async () => {
  clearNotificationReadApiResultCache();
  const states: Array<{
    loading: boolean;
    errorKind: NotificationReadApiOrchestrationError["kind"] | null;
  }> = [];
  const cancelledController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: (state) => {
      states.push({
        loading: state.loading,
        errorKind: state.error?.kind ?? null,
      });
    },
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  cancelledController.start({
    requestKey: "cancelled:key",
    cause: "query",
    loader: async () => {
      throw createAbortError();
    },
  });
  await flushAsyncWork();

  assert.equal(cancelledController.getState().error, null);
  assert.equal(cancelledController.getState().loading, false);
  assert.equal(states.some((state) => state.errorKind === "cancelled"), false);

  const pending = createDeferredPromise<string>();
  let writes = 0;
  const unmountController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {
      writes += 1;
    },
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  unmountController.start({
    requestKey: "tenant:pending",
    cause: "query",
    loader: async () => pending.promise,
  });
  unmountController.dispose();
  pending.resolve("ignored");
  await pending.promise;
  await flushAsyncWork();

  assert.equal(writes, 1);
});

test("read API result cache reuses same query results without refetching within TTL", async () => {
  clearNotificationReadApiResultCache();
  let nowMs = 1_000;
  let loaderCalls = 0;

  const firstController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  firstController.start({
    requestKey: "overview:key|refresh:0",
    cacheKey: "overview:key",
    cause: "query",
    now: () => nowMs,
    loader: async () => {
      loaderCalls += 1;
      return "cached-overview";
    },
  });
  await flushAsyncWork();
  assert.equal(firstController.getState().data, "cached-overview");
  assert.equal(loaderCalls, 1);

  const secondController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  secondController.start({
    requestKey: "overview:key|refresh:0",
    cacheKey: "overview:key",
    cause: "query",
    now: () => nowMs + 5_000,
    loader: async () => {
      loaderCalls += 1;
      return "should-not-run";
    },
  });
  await flushAsyncWork();

  assert.equal(secondController.getState().data, "cached-overview");
  assert.equal(secondController.getState().cacheStatus, "hit");
  assert.equal(secondController.getState().loading, false);
  assert.equal(loaderCalls, 1);
});

test("read API result cache expires after TTL and revalidates stale entries", async () => {
  clearNotificationReadApiResultCache();
  let nowMs = 1_000;

  const seedController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  seedController.start({
    requestKey: "tenant:key|refresh:0",
    cacheKey: "tenant:key",
    cause: "query",
    cacheTtlMs: 100,
    now: () => nowMs,
    loader: async () => "warm-cache",
  });
  await flushAsyncWork();

  const staleStates: string[] = [];
  const staleDeferred = createDeferredPromise<string>();
  let loaderCalls = 0;
  nowMs += 500;

  const staleController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: (state) => {
      staleStates.push(`${state.cacheStatus}:${state.phase}:${state.data ?? "null"}`);
    },
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  staleController.start({
    requestKey: "tenant:key|refresh:0",
    cacheKey: "tenant:key",
    cause: "query",
    cacheTtlMs: 100,
    now: () => nowMs,
    loader: async () => {
      loaderCalls += 1;
      return staleDeferred.promise;
    },
  });
  await flushAsyncWork();

  assert.equal(staleController.getState().data, "warm-cache");
  assert.equal(staleController.getState().cacheStatus, "stale");
  assert.equal(staleController.getState().phase, "reloading");
  assert.equal(loaderCalls, 1);

  staleDeferred.resolve("fresh-cache");
  await staleDeferred.promise;
  await flushAsyncWork();

  assert.equal(staleController.getState().data, "fresh-cache");
  assert.equal(staleController.getState().cacheStatus, "hit");
  assert.equal(staleStates.some((value) => value === "stale:reloading:warm-cache"), true);
});

test("read API result cache bypasses cached entries on manual refresh and preserves refresh semantics", async () => {
  clearNotificationReadApiResultCache();
  let loaderCalls = 0;
  const values = ["initial", "refreshed"];
  const controller = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  controller.start({
    requestKey: "overview:refresh|refresh:0",
    cacheKey: "overview:refresh",
    cause: "query",
    loader: async () => values[loaderCalls++]!,
  });
  await flushAsyncWork();

  controller.start({
    requestKey: "overview:refresh|refresh:1",
    cacheKey: "overview:refresh",
    cause: "refresh",
    loader: async () => values[loaderCalls++]!,
  });
  await flushAsyncWork();

  assert.equal(loaderCalls, 2);
  assert.equal(controller.getState().data, "refreshed");
  assert.equal(controller.getState().cacheStatus, "hit");
  assert.equal(controller.getState().isRefreshing, false);
});

test("read API result cache does not write failed or cancelled responses and does not bleed old query data into a new cache miss", async () => {
  clearNotificationReadApiResultCache();
  let loaderCalls = 0;
  const controller = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  controller.start({
    requestKey: "overview:good|refresh:0",
    cacheKey: "overview:good",
    cause: "query",
    loader: async () => {
      loaderCalls += 1;
      return "good";
    },
  });
  await flushAsyncWork();

  controller.start({
    requestKey: "overview:bad|refresh:0",
    cacheKey: "overview:bad",
    cause: "query",
    loader: async () => {
      loaderCalls += 1;
      throw new TypeError("fetch failed");
    },
  });
  await flushAsyncWork();

  assert.equal(controller.getState().data, null);
  assert.equal(controller.getState().error?.kind, "network");

  const cancelledController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  cancelledController.start({
    requestKey: "tenant:cancelled|refresh:0",
    cacheKey: "tenant:cancelled",
    cause: "query",
    loader: async () => {
      loaderCalls += 1;
      throw createAbortError();
    },
  });
  await flushAsyncWork();

  const retryController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  retryController.start({
    requestKey: "tenant:cancelled|refresh:0",
    cacheKey: "tenant:cancelled",
    cause: "query",
    loader: async () => {
      loaderCalls += 1;
      return "tenant-fresh";
    },
  });
  await flushAsyncWork();

  assert.equal(retryController.getState().data, "tenant-fresh");
  assert.equal(loaderCalls, 4);

  invalidateNotificationReadApiResultCache("overview:good");
  const afterInvalidate = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });
  let invalidateCalls = 0;
  afterInvalidate.start({
    requestKey: "overview:good|refresh:0",
    cacheKey: "overview:good",
    cause: "query",
    cacheTtlMs: NOTIFICATION_READ_API_RESULT_CACHE_TTL_MS,
    loader: async () => {
      invalidateCalls += 1;
      return "good-again";
    },
  });
  await flushAsyncWork();

  assert.equal(afterInvalidate.getState().data, "good-again");
  assert.equal(invalidateCalls, 1);
});

test("read API cache policy evicts least-recently-used entries and prunes expired results", async () => {
  clearNotificationReadApiResultCache();
  let nowMs = 10_000;

  for (let index = 0; index < NOTIFICATION_READ_API_RESULT_CACHE_MAX_ENTRIES + 2; index += 1) {
    const controller = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
      onStateChange: () => {},
      classifyError: (error) =>
        classifyNotificationReadApiOrchestrationError(error, {
          source: "overview",
          message: "Load overview page failed",
        }),
      isCancelledError: (error) => error.kind === "cancelled",
    });

    controller.start({
      requestKey: `overview:lru:${index}|refresh:0`,
      cacheKey: `overview:lru:${index}`,
      cause: "query",
      now: () => nowMs,
      loader: async () => `value-${index}`,
    });
    await flushAsyncWork();
    nowMs += 1;
  }

  const evictedSnapshot = inspectNotificationReadApiResultCache({ now: () => nowMs });
  assert.equal(evictedSnapshot.length, NOTIFICATION_READ_API_RESULT_CACHE_MAX_ENTRIES);
  assert.equal(evictedSnapshot.some((entry) => entry.cacheKey === "overview:lru:0"), false);
  assert.equal(evictedSnapshot.some((entry) => entry.cacheKey === "overview:lru:1"), false);
  assert.equal(
    evictedSnapshot.some((entry) => entry.cacheKey === `overview:lru:${NOTIFICATION_READ_API_RESULT_CACHE_MAX_ENTRIES + 1}`),
    true,
  );

  pruneNotificationReadApiResultCache({
    now: () => nowMs + NOTIFICATION_READ_API_RESULT_CACHE_EXPIRED_MS + 1,
  });
  assert.equal(inspectNotificationReadApiResultCache({ now: () => nowMs + NOTIFICATION_READ_API_RESULT_CACHE_EXPIRED_MS + 1 }).length, 0);
});

test("read API cache policy distinguishes stale versus expired visibility revalidation", async () => {
  clearNotificationReadApiResultCache();
  let nowMs = 1_000;
  const controller = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "overview",
        message: "Load overview page failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  controller.start({
    requestKey: "overview:visible|refresh:0",
    cacheKey: "overview:visible",
    cause: "query",
    now: () => nowMs,
    cacheTtlMs: 100,
    cacheExpireMs: 300,
    loader: async () => "visible-seed",
  });
  await flushAsyncWork();

  assert.equal(
    shouldRevalidateNotificationReadApiOnVisible({
      cacheKey: "overview:visible",
      loading: false,
      now: () => nowMs + 50,
      cacheTtlMs: 100,
      cacheExpireMs: 300,
    }),
    false,
  );
  assert.equal(
    shouldRevalidateNotificationReadApiOnVisible({
      cacheKey: "overview:visible",
      loading: false,
      now: () => nowMs + 150,
      cacheTtlMs: 100,
      cacheExpireMs: 300,
    }),
    true,
  );
  assert.equal(
    shouldRevalidateNotificationReadApiOnVisible({
      cacheKey: "overview:visible",
      loading: true,
      now: () => nowMs + 150,
      cacheTtlMs: 100,
      cacheExpireMs: 300,
    }),
    false,
  );
  assert.equal(
    shouldRevalidateNotificationReadApiOnVisible({
      cacheKey: "overview:visible",
      loading: false,
      now: () => nowMs + 350,
      cacheTtlMs: 100,
      cacheExpireMs: 300,
    }),
    true,
  );
});

test("read API visibility revalidation keeps existing data, avoids duplicate in-flight requests, and refreshes stale cache", async () => {
  clearNotificationReadApiResultCache();
  let nowMs = 1_000;
  let loaderCalls = 0;
  const deferred = createDeferredPromise<string>();
  const controller = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });

  controller.start({
    requestKey: "tenant:visible|refresh:0",
    cacheKey: "tenant:visible",
    cause: "query",
    now: () => nowMs,
    cacheTtlMs: 100,
    cacheExpireMs: 300,
    loader: async () => {
      loaderCalls += 1;
      return "seed";
    },
  });
  await flushAsyncWork();

  nowMs += 150;
  controller.start({
    requestKey: "tenant:visible|refresh:0",
    cacheKey: "tenant:visible",
    cause: "visibility",
    now: () => nowMs,
    cacheTtlMs: 100,
    cacheExpireMs: 300,
    loader: async () => {
      loaderCalls += 1;
      return deferred.promise;
    },
  });
  controller.start({
    requestKey: "tenant:visible|refresh:0",
    cacheKey: "tenant:visible",
    cause: "visibility",
    now: () => nowMs,
    cacheTtlMs: 100,
    cacheExpireMs: 300,
    loader: async () => {
      loaderCalls += 1;
      return "duplicate";
    },
  });
  await flushAsyncWork();

  assert.equal(loaderCalls, 2);
  assert.equal(controller.getState().data, "seed");
  assert.equal(controller.getState().phase, "refreshing");
  assert.equal(controller.getState().cacheStatus, "stale");

  deferred.resolve("revalidated");
  await deferred.promise;
  await flushAsyncWork();

  assert.equal(controller.getState().data, "revalidated");
  assert.equal(controller.getState().phase, "idle");
  assert.equal(controller.getState().cacheStatus, "hit");
});

test("read API warm navigation prefetch shares drilldown fingerprint and serves a fresh cache hit on navigation", async () => {
  clearNotificationReadApiResultCache();
  const overviewState = {
    tenantId: "",
    channel: "email" as const,
    from: "2026-03-10T00:00",
    to: "2026-03-10T23:59",
    limit: 2000,
  };
  const drilldownState = buildNotificationTenantDrilldownStateFromOverviewState(overviewState, {
    now: () => new Date("2026-03-13T12:00:00.000Z"),
  });
  let loaderCalls = 0;
  const fetchDrilldown = async () => {
    loaderCalls += 1;
    return parseNotificationReadApiPayload(
      "tenant_drilldown",
      buildConsumerReadApiPayload(
        "tenant_drilldown",
        buildNotificationAggregationMetadata({
          aggregationModeRequested: "auto",
          dataSource: "rollup",
          isWholeUtcDayWindow: true,
          rollupEligible: true,
        }),
      ),
    );
  };

  const prefetched = await prefetchNotificationTenantDrilldownFromOverviewState(
    "tenant-prefetch",
    overviewState,
    {
      fetchDrilldown,
    },
    {
      referenceNow: () => new Date("2026-03-13T12:00:00.000Z"),
      now: () => 1_000,
    },
  );

  const directPrefetch = await prefetchNotificationTenantDrilldownPageData(
    "tenant-prefetch",
    drilldownState,
    {
      fetchDrilldown,
    },
    {
      now: () => 1_000,
    },
  );

  assert.equal(prefetched.filters.aggregationMode, "auto");
  assert.equal(prefetched.queryFingerprint, buildNotificationTenantDrilldownQueryFingerprint("tenant-prefetch", drilldownState));
  assert.equal(directPrefetch.queryFingerprint, prefetched.queryFingerprint);
  assert.equal(directPrefetch.requestKey, buildNotificationReadApiRequestKey(prefetched.queryFingerprint, 0));
  assert.equal(loaderCalls, 1);

  const controller = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });
  let navigationLoaderCalls = 0;
  controller.start({
    requestKey: directPrefetch.requestKey,
    cacheKey: directPrefetch.queryFingerprint,
    cause: "query",
    now: () => 1_050,
    loader: async () => {
      navigationLoaderCalls += 1;
      return "should-not-run";
    },
  });
  await flushAsyncWork();

  assert.equal(controller.getState().cacheStatus, "hit");
  assert.equal(controller.getState().loading, false);
  assert.equal(controller.getState().isInitialLoading, false);
  assert.equal(navigationLoaderCalls, 0);
});

test("read API warm navigation keeps stale drilldown data visible, treats expired cache as miss, and preserves manual refresh bypass", async () => {
  clearNotificationReadApiResultCache();
  let nowMs = 1_000;
  let loaderCalls = 0;
  const filters = buildNotificationTenantDrilldownStateFromOverviewState(
    {
      tenantId: "",
      channel: "",
      from: "2026-03-10T00:00",
      to: "2026-03-10T23:59",
      limit: 2000,
    },
    {
      now: () => new Date("2026-03-13T12:00:00.000Z"),
    },
  );

  await prefetchNotificationTenantDrilldownPageData(
    "tenant-stale",
    filters,
    {
      fetchDrilldown: async () => {
        loaderCalls += 1;
        return parseNotificationReadApiPayload(
          "tenant_drilldown",
          buildConsumerReadApiPayload(
            "tenant_drilldown",
            buildNotificationAggregationMetadata({
              aggregationModeRequested: "auto",
              dataSource: "rollup",
              isWholeUtcDayWindow: true,
              rollupEligible: true,
            }),
          ),
        );
      },
    },
    {
      now: () => nowMs,
      cacheTtlMs: 100,
      cacheExpireMs: 300,
    },
  );

  const queryFingerprint = buildNotificationTenantDrilldownQueryFingerprint("tenant-stale", filters);
  const requestKey = buildNotificationReadApiRequestKey(queryFingerprint, 0);

  const staleDeferred = createDeferredPromise<string>();
  const staleController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });
  nowMs += 150;
  staleController.start({
    requestKey,
    cacheKey: queryFingerprint,
    cause: "query",
    now: () => nowMs,
    cacheTtlMs: 100,
    cacheExpireMs: 300,
    loader: async () => {
      loaderCalls += 1;
      return staleDeferred.promise;
    },
  });
  await flushAsyncWork();
  assert.equal(staleController.getState().cacheStatus, "stale");
  assert.equal(staleController.getState().phase, "reloading");
  assert.equal(staleController.getState().data !== null, true);

  staleDeferred.resolve("fresh-after-stale");
  await staleDeferred.promise;
  await flushAsyncWork();

  const expiredController = new NotificationReadApiRequestLifecycleController<string, NotificationReadApiOrchestrationError>({
    onStateChange: () => {},
    classifyError: (error) =>
      classifyNotificationReadApiOrchestrationError(error, {
        source: "tenant_drilldown",
        message: "Load tenant drilldown failed",
      }),
    isCancelledError: (error) => error.kind === "cancelled",
  });
  nowMs += 500;
  const expiredDeferred = createDeferredPromise<string>();
  expiredController.start({
    requestKey,
    cacheKey: queryFingerprint,
    cause: "query",
    now: () => nowMs,
    cacheTtlMs: 100,
    cacheExpireMs: 300,
    loader: async () => {
      loaderCalls += 1;
      return expiredDeferred.promise;
    },
  });
  await flushAsyncWork();
  assert.equal(expiredController.getState().phase, "initial_loading");
  assert.equal(expiredController.getState().data, null);

  expiredDeferred.resolve("expired-refetch");
  await expiredDeferred.promise;
  await flushAsyncWork();

  expiredController.start({
    requestKey: buildNotificationReadApiRequestKey(queryFingerprint, 1),
    cacheKey: queryFingerprint,
    cause: "refresh",
    now: () => nowMs + 1,
    cacheTtlMs: 100,
    cacheExpireMs: 300,
    loader: async () => {
      loaderCalls += 1;
      return "manual-refresh";
    },
  });
  await flushAsyncWork();

  assert.equal(expiredController.getState().data, "manual-refresh");
  assert.equal(loaderCalls >= 4, true);
});

test("read API warm navigation prefetch failure does not poison drilldown navigation or raw-backed support note", async () => {
  clearNotificationReadApiResultCache();
  const filters = buildNotificationTenantDrilldownStateFromOverviewState(
    {
      tenantId: "",
      channel: "",
      from: "2026-03-10T00:00",
      to: "2026-03-10T23:59",
      limit: 2000,
    },
    {
      now: () => new Date("2026-03-13T12:00:00.000Z"),
    },
  );

  const failedPrefetch = await prefetchNotificationTenantDrilldownPageData(
    "tenant-failure",
    filters,
    {
      fetchDrilldown: async () => {
        throw new TypeError("prefetch failed");
      },
    },
    {
      now: () => 1_000,
    },
  );

  assert.equal(failedPrefetch.status, "failed");

  const recovered = await loadNotificationTenantDrilldownPageData(
    "tenant-failure",
    filters,
    {
      fetchDrilldown: async () =>
        parseNotificationReadApiPayload(
          "tenant_drilldown",
          buildConsumerReadApiPayload(
            "tenant_drilldown",
            buildNotificationAggregationMetadata({
              aggregationModeRequested: "auto",
              dataSource: "raw",
              isWholeUtcDayWindow: false,
              rollupEligible: false,
            }),
          ),
        ),
    },
  );

  assert.equal(recovered.recentAnomaliesSupportNote, getTenantDrilldownRecentAnomaliesSupportNote());
  assert.equal(recovered.drilldown.recentAnomaliesRawBacked, true);
});

test("read API query-state defaults and search-param hydration stay aligned for overview and drilldown", () => {
  const now = () => new Date("2026-03-13T12:00:00.000Z");

  const overviewDefaults = createNotificationOverviewQueryStateDefaults(now);
  assert.equal(overviewDefaults.tenantId, "");
  assert.equal(overviewDefaults.limit, 2000);

  const drilldownDefaults = createNotificationTenantDrilldownQueryStateDefaults(now);
  assert.equal(drilldownDefaults.aggregationMode, "auto");
  assert.equal(drilldownDefaults.anomalyLimit, 40);

  const overviewHydrated = hydrateNotificationOverviewQueryStateFromSearchParams(
    new URLSearchParams("tenantId=tenant-1&channel=email&from=2026-03-10T00:00:00.000Z&to=2026-03-10T23:59:59.999Z&limit=5000"),
    now,
  );
  assert.equal(overviewHydrated.state.tenantId, "tenant-1");
  assert.equal(overviewHydrated.state.channel, "email");
  assert.equal(overviewHydrated.state.limit, 5000);

  const drilldownHydrated = hydrateNotificationTenantDrilldownQueryStateFromSearchParams(
    new URLSearchParams(
      "channel=sms&aggregationMode=rollup&from=2026-03-10T00:00:00.000Z&to=2026-03-10T23:59:59.999Z&limit=4000&anomalyLimit=80",
    ),
    now,
  );
  assert.equal(drilldownHydrated.state.channel, "sms");
  assert.equal(drilldownHydrated.state.aggregationMode, "rollup");
  assert.equal(drilldownHydrated.state.limit, 4000);
  assert.equal(drilldownHydrated.state.anomalyLimit, 80);
});

test("read API query-state normalization handles invalid dates, inverted ranges, and aggregation mode drift consistently", () => {
  const now = () => new Date("2026-03-13T12:00:00.000Z");

  const overview = normalizeNotificationOverviewQueryState(
    {
      tenantId: " tenant-1 ",
      channel: "email",
      from: "not-a-date",
      to: "2026-03-10T09:00",
      limit: 999999,
    },
    now,
  );
  assert.equal(overview.state.tenantId, "tenant-1");
  assert.equal(overview.state.limit, 50000);
  assert.equal(overview.issues.some((issue) => issue.kind === "invalid_datetime" && issue.field === "from"), true);
  assert.equal(overview.issues.some((issue) => issue.kind === "invalid_number" && issue.field === "limit"), true);

  const drilldown = normalizeNotificationTenantDrilldownQueryState(
    {
      channel: "email",
      aggregationMode: "broken" as never,
      from: "2026-03-11T10:00",
      to: "2026-03-10T09:00",
      limit: 50,
      anomalyLimit: 999,
    },
    now,
  );
  assert.equal(drilldown.state.aggregationMode, "auto");
  assert.equal(drilldown.state.limit, 200);
  assert.equal(drilldown.state.anomalyLimit, 120);
  assert.equal(drilldown.issues.some((issue) => issue.kind === "invalid_aggregation_mode"), true);
  assert.equal(drilldown.issues.some((issue) => issue.kind === "range_inverted"), true);
});

test("read API query-state serialization keeps overview and drilldown request params/window semantics consistent", () => {
  const overview = serializeNotificationOverviewQueryParams({
    tenantId: "tenant-1",
    channel: "email",
    from: "2026-03-10T08:00",
    to: "2026-03-10T20:00",
    limit: 500,
  });
  const drilldown = serializeNotificationTenantDrilldownQueryParams({
    channel: "email",
    aggregationMode: "auto",
    from: "2026-03-10T08:00",
    to: "2026-03-10T20:00",
    limit: 500,
    anomalyLimit: 40,
  });

  assert.equal(overview.windowType, "partial_utc_window");
  assert.equal(drilldown.windowType, "partial_utc_window");
  assert.equal(overview.params.get("channel"), "email");
  assert.equal(drilldown.params.get("aggregationMode"), "auto");

  const backHref = buildNotificationOverviewPageHrefFromQueryState("tenant-1", drilldown.state);
  assert.equal(backHref.includes("tenantId=tenant-1"), true);
  assert.equal(backHref.includes("aggregationMode=auto"), true);
  assert.equal(backHref.includes("anomalyLimit="), false);
});

test("read API url sync keeps overview and tenant drilldown links canonical and round-trippable", () => {
  const now = () => new Date("2026-03-13T12:00:00.000Z");
  const overviewDefaultUrl = buildNotificationOverviewPageUrl(
    "/platform-admin/notifications-overview",
    createNotificationOverviewQueryStateDefaults(now),
    { now },
  );
  assert.equal(overviewDefaultUrl, "/platform-admin/notifications-overview");

  const overviewUrl = buildNotificationOverviewPageUrl(
    "/platform-admin/notifications-overview",
    {
      tenantId: "tenant-1",
      channel: "email",
      from: "2026-03-10T08:00",
      to: "2026-03-10T20:00",
      limit: 500,
    },
    { now },
  );
  assert.equal(overviewUrl.includes("tenantId=tenant-1"), true);
  assert.equal(overviewUrl.includes("channel=email"), true);

  const drilldownUrl = buildNotificationTenantDrilldownPageUrl(
    "/platform-admin/notifications-overview/tenant-1",
    {
      channel: "email",
      aggregationMode: "raw",
      from: "2026-03-10T08:00",
      to: "2026-03-10T20:00",
      limit: 500,
      anomalyLimit: 80,
    },
    { now },
  );
  assert.equal(drilldownUrl.includes("aggregationMode=raw"), true);
  assert.equal(drilldownUrl.includes("anomalyLimit=80"), true);
});

test("read API url sync preserves overview to drilldown and drilldown back-link consistency", () => {
  const now = () => new Date("2026-03-13T12:00:00.000Z");
  const drilldownHref = buildNotificationTenantDrilldownHrefFromOverviewState(
    "tenant-1",
    {
      tenantId: "",
      channel: "sms",
      from: "2026-03-10T08:00",
      to: "2026-03-10T20:00",
      limit: 5000,
    },
    { now },
  );
  assert.equal(drilldownHref.startsWith("/platform-admin/notifications-overview/tenant-1?"), true);
  assert.equal(drilldownHref.includes("channel=sms"), true);
  assert.equal(drilldownHref.includes("limit=5000"), true);
  assert.equal(drilldownHref.includes("aggregationMode=auto"), false);

  const backHref = buildNotificationOverviewHrefFromTenantDrilldownState(
    "tenant-1",
    {
      channel: "sms",
      aggregationMode: "rollup",
      from: "2026-03-10T00:00",
      to: "2026-03-10T23:59",
      limit: 5000,
      anomalyLimit: 120,
    },
    { now },
  );
  assert.equal(backHref.startsWith("/platform-admin/notifications-overview?"), true);
  assert.equal(backHref.includes("tenantId=tenant-1"), true);
  assert.equal(backHref.includes("aggregationMode="), false);
  assert.equal(backHref.includes("anomalyLimit="), false);
});

test("aggregation explainability describes explicit raw, explicit rollup, and auto window resolution", () => {
  const explicitRaw = buildNotificationAggregationMetadata({
    aggregationModeRequested: "raw",
    dataSource: "raw",
    isWholeUtcDayWindow: true,
    rollupEligible: true,
  });
  assert.equal(
    explicitRaw.resolutionReason,
    "aggregationMode=raw was explicitly requested, so raw query aggregation was used.",
  );
  assert.equal(explicitRaw.requestedWindowType, "whole_utc_day");
  assert.equal(explicitRaw.snapshotWindowType, "whole_utc_day");

  const explicitRollup = buildNotificationAggregationMetadata({
    aggregationModeRequested: "rollup",
    dataSource: "rollup",
    isWholeUtcDayWindow: true,
    rollupEligible: true,
  });
  assert.equal(
    explicitRollup.resolutionReason,
    "aggregationMode=rollup was explicitly requested, so daily rollup aggregation was used.",
  );

  const autoPartial = buildNotificationAggregationMetadata({
    aggregationModeRequested: "auto",
    dataSource: "raw",
    isWholeUtcDayWindow: false,
    rollupEligible: false,
  });
  assert.equal(
    autoPartial.resolutionReason,
    "aggregationMode=auto fell back to raw query aggregation because the requested window is not a whole UTC-day window.",
  );
  assert.equal(autoPartial.requestedWindowType, getNotificationAggregationWindowType(false));
  assert.equal(autoPartial.snapshotWindowType, "partial_utc_window");

  const autoWholeDay = buildNotificationAggregationMetadata({
    aggregationModeRequested: "auto",
    dataSource: "rollup",
    isWholeUtcDayWindow: true,
    rollupEligible: true,
  });
  assert.equal(
    autoWholeDay.resolutionReason,
    "aggregationMode=auto resolved to daily rollup aggregation because the requested window is a whole UTC-day window.",
  );
});

test("trend explainability keeps current-window and compare-window semantics readable", () => {
  const currentWholePreviousPartial = buildTrendRollupEligibilityMetadata({
    currentFromIso: "2026-03-10T00:00:00.000Z",
    currentToIso: "2026-03-10T23:59:59.999Z",
    previousFromIso: "2026-03-09T08:00:00.000Z",
    previousToIso: "2026-03-10T07:59:59.000Z",
  });
  const trendFallbackReason = buildNotificationAggregationResolutionReason({
    aggregationModeRequested: "auto",
    dataSource: "raw",
    isWholeUtcDayWindow: currentWholePreviousPartial.isWholeUtcDayWindow,
    rollupEligible: currentWholePreviousPartial.rollupEligible,
    reasonScope: "trends",
  });
  assert.equal(
    trendFallbackReason,
    "aggregationMode=auto fell back to raw query aggregation because trend rollups require both current and previous windows to be whole UTC-day windows.",
  );

  const trendRollupReason = buildNotificationAggregationResolutionReason({
    aggregationModeRequested: "auto",
    dataSource: "rollup",
    isWholeUtcDayWindow: true,
    rollupEligible: true,
    reasonScope: "trends",
  });
  assert.equal(
    trendRollupReason,
    "aggregationMode=auto resolved to daily rollup aggregation because both current and previous trend windows are whole UTC-day windows.",
  );
});

test("trend rollup eligibility metadata keeps whole-day and previous-window checks separate", () => {
  assert.deepEqual(
    buildTrendRollupEligibilityMetadata({
      currentFromIso: "2026-03-10T00:00:00.000Z",
      currentToIso: "2026-03-10T23:59:59.999Z",
      previousFromIso: "2026-03-09T08:00:00.000Z",
      previousToIso: "2026-03-10T07:59:59.000Z",
    }),
    {
      isWholeUtcDayWindow: true,
      rollupEligible: false,
    },
  );
});

test("aggregation data source labels are unified for overview and drilldown UI", () => {
  assert.equal(formatNotificationAggregationDataSourceLabel("raw"), "Aggregation source: raw query aggregation.");
  assert.equal(formatNotificationAggregationDataSourceLabel("rollup"), "Aggregation source: daily rollup aggregation.");
});

test("tenant drilldown recent anomalies stay raw-backed by design for latest retry and error context", () => {
  assert.equal(TENANT_DRILLDOWN_RECENT_ANOMALIES_DATA_SOURCE, "raw");
  assert.equal(TENANT_DRILLDOWN_RECENT_ANOMALIES_RAW_REASON.includes("rollups do not store"), true);
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

