import type { SupabaseClient } from "@supabase/supabase-js";
import { buildNotificationPreflightReport } from "./notification-preflight-report";
import {
  mapTemplateStrategyToFallbackReason,
  toRuntimeDeliveryPlanningContract,
  toRuntimeEventInputContract,
  toRuntimePreferenceResolutionContract,
  type NotificationRuntimeReadinessReportContract,
  type NotificationRuntimeWarningContract,
} from "./notification-runtime-integration-contracts";
import type { NotificationChannelKey, NotificationEventKey, NotificationRoleKey } from "./notification-productization";
import {
  getNotificationRuntimeSimulationScenario,
  type NotificationRuntimeSimulationScenarioId,
} from "./notification-runtime-simulation-fixtures";
import { validateNotificationRuntimeReadiness } from "./notification-runtime-readiness-validator";

export type NotificationRuntimeReadinessSource = "live" | "fixture";

export type NotificationRuntimeReadinessReportResult = {
  source: NotificationRuntimeReadinessSource;
  scenarioId: NotificationRuntimeSimulationScenarioId | null;
  report: NotificationRuntimeReadinessReportContract;
};

function dedupeWarnings(input: NotificationRuntimeWarningContract[]) {
  const map = new Map<string, NotificationRuntimeWarningContract>();
  for (const item of input) {
    const key = `${item.code}:${item.message}`;
    if (map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
}

function mapPreflightWarningToCode(message: string): NotificationRuntimeWarningContract["code"] {
  const normalized = message.toLowerCase();
  if (normalized.includes("fallback")) return "FALLBACK_APPLIED";
  if (normalized.includes("template")) return "TEMPLATE_MISSING";
  if (normalized.includes("preference")) return "PREFERENCE_RULE_MISSING";
  if (normalized.includes("recipient")) return "RECIPIENTS_EMPTY";
  return "FALLBACK_APPLIED";
}

export async function buildNotificationRuntimeReadinessLiveReport(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  eventKey: NotificationEventKey;
  roleKey: NotificationRoleKey | null;
  userId: string | null;
  channelHint: NotificationChannelKey | null;
  locale?: string;
  defaultLocale?: string;
  recipientLimit?: number;
}) {
  const eventInput = toRuntimeEventInputContract({
    tenantId: params.tenantId,
    eventKey: params.eventKey,
    roleKey: params.roleKey,
    userId: params.userId,
    channelHint: params.channelHint,
    locale: params.locale,
    defaultLocale: params.defaultLocale,
    recipientLimit: params.recipientLimit,
    payload: {},
  });

  const preflight = await buildNotificationPreflightReport({
    supabase: params.supabase,
    tenantId: eventInput.tenantId,
    eventKey: eventInput.eventKey,
    roleKey: eventInput.roleKey,
    userId: eventInput.userId,
    channelHint: eventInput.channelHint,
    locale: eventInput.locale,
    defaultLocale: eventInput.defaultLocale,
    recipientLimit: eventInput.recipientLimit,
  });
  if (!preflight.ok) return { ok: false as const, error: preflight.error };

  const preference = toRuntimePreferenceResolutionContract(preflight.report.preference);
  const templates = preflight.report.templates.resolutions.map((item) => ({
    channel: item.channel,
    found: item.found,
    source: item.source,
    strategy: item.strategy as
      | "tenant_locale"
      | "tenant_default_locale"
      | "global_locale"
      | "global_default_locale"
      | "none",
    fallbackReason: mapTemplateStrategyToFallbackReason(
      item.strategy as "tenant_locale" | "tenant_default_locale" | "global_locale" | "global_default_locale" | "none",
    ),
    template: item.templateId
      ? {
          id: item.templateId,
          tenantId: item.source === "tenant" ? eventInput.tenantId : null,
          locale: item.locale || eventInput.defaultLocale,
          priority: item.priority || "info",
          titleTemplate: "",
          messageTemplate: "",
          emailSubject: null,
          actionUrl: null,
          channelPolicy: {},
          version: 1,
        }
      : null,
    missingReason: item.missingReason,
  }));

  const deliveryPlanning = toRuntimeDeliveryPlanningContract({
    eventKey: eventInput.eventKey,
    tenantId: eventInput.tenantId,
    plannedRecipients: preflight.report.deliveryPlanning.plannedRecipientsPreview.map((item) => ({
      userId: item.userId,
      role: item.role,
      plannedChannels: preflight.report.deliveryPlanning.plannedChannels,
    })),
    plannedChannels: preflight.report.deliveryPlanning.plannedChannels,
    plannedContentSkeleton: {
      byChannel: preflight.report.deliveryPlanning.contentSkeleton as Record<
        NotificationChannelKey,
        {
          titleTemplate: string;
          messageTemplate: string;
          emailSubject: string | null;
          actionUrl: string | null;
          priority: string;
          source: string;
        }
      >,
    },
    skippedReasons: preflight.report.deliveryPlanning.skippedReasons.map((item) => ({
      code: item.code as
        | "PREFERENCE_DISABLED"
        | "NO_CHANNEL_ENABLED"
        | "NO_RECIPIENTS"
        | "TEMPLATE_MISSING"
        | "CHANNEL_TEMPLATE_MISSING",
      message: item.message,
    })),
    ready: preflight.report.deliveryPlanning.ready,
  });

  const missingPreferences: NotificationRuntimeReadinessReportContract["readiness"]["missingPreferences"] = [];
  if (eventInput.roleKey && preference.source !== "role" && preference.source !== "user") {
    missingPreferences.push({
      roleKey: eventInput.roleKey,
      eventKey: eventInput.eventKey,
      reason: "role_preference_not_explicitly_configured_for_selected_event",
    });
  }
  if (eventInput.userId && preference.source !== "user") {
    missingPreferences.push({
      roleKey: eventInput.roleKey,
      eventKey: eventInput.eventKey,
      reason: "user_preference_not_explicitly_configured_for_selected_event",
    });
  }
  if (preference.source === "system_default") {
    missingPreferences.push({
      roleKey: eventInput.roleKey,
      eventKey: eventInput.eventKey,
      reason: "no_preference_rule_found_fallback_to_system_default",
    });
  }

  const missingTemplates = templates
    .filter((item) => !item.found)
    .map((item) => ({
      channel: item.channel,
      reason: item.missingReason || "template_missing",
    }));

  const unavailableChannels = [
    ...Object.entries(preference.channels)
      .filter(([, enabled]) => enabled === false)
      .map(([channel]) => ({
        channel: channel as NotificationChannelKey,
        reason: "disabled_by_preference",
      })),
    ...missingTemplates.map((item) => ({
      channel: item.channel,
      reason: "template_missing",
    })),
  ];

  const fallbacks = templates
    .filter(
      (item): item is typeof item & {
        strategy: "tenant_default_locale" | "global_locale" | "global_default_locale";
        fallbackReason: "TENANT_DEFAULT_LOCALE_FALLBACK" | "GLOBAL_LOCALE_FALLBACK" | "GLOBAL_DEFAULT_LOCALE_FALLBACK";
      } =>
        item.found &&
        Boolean(item.fallbackReason) &&
        (item.strategy === "tenant_default_locale" ||
          item.strategy === "global_locale" ||
          item.strategy === "global_default_locale"),
    )
    .map((item) => ({
      channel: item.channel,
      strategy: item.strategy,
      reason: item.fallbackReason,
    }));

  const warnings = dedupeWarnings([
    ...(preference.enabled
      ? []
      : [
          {
            code: "PREFERENCE_DISABLED" as const,
            message: "Preference is disabled and runtime delivery would be skipped.",
          },
        ]),
    ...preflight.report.warnings.map((message) => ({
      code: mapPreflightWarningToCode(message),
      message,
    })),
    ...missingTemplates.map((item) => ({
      code: "TEMPLATE_MISSING" as const,
      message: `${item.channel} template is missing (${item.reason}).`,
    })),
    ...fallbacks.map((item) => ({
      code: "FALLBACK_APPLIED" as const,
      message: `${item.channel} uses ${item.strategy}.`,
    })),
  ]);

  const report: NotificationRuntimeReadinessReportContract = {
    eventInput,
    preference,
    templates,
    deliveryPlanning,
    readiness: {
      ready: deliveryPlanning.ready && missingTemplates.length === 0,
      missingPreferences,
      missingTemplates,
      unavailableChannels,
      fallbacks,
    },
    warnings,
  };

  return {
    ok: true as const,
    result: {
      source: "live" as const,
      scenarioId: null,
      report,
    },
  };
}

export function buildNotificationRuntimeReadinessFixtureReport(params: {
  scenarioId: NotificationRuntimeSimulationScenarioId;
  tenantIdOverride?: string | null;
  eventKeyOverride?: NotificationEventKey | null;
  roleKeyOverride?: NotificationRoleKey | null;
  userIdOverride?: string | null;
  channelHintOverride?: NotificationChannelKey | null;
  localeOverride?: string | null;
  defaultLocaleOverride?: string | null;
  recipientLimitOverride?: number | null;
}) {
  const scenario = getNotificationRuntimeSimulationScenario(params.scenarioId);
  if (!scenario) return { ok: false as const, error: `Unknown scenario: ${params.scenarioId}` };

  const eventInput = toRuntimeEventInputContract({
    ...scenario.eventInput,
    tenantId: params.tenantIdOverride || scenario.eventInput.tenantId,
    eventKey: params.eventKeyOverride || scenario.eventInput.eventKey,
    roleKey: params.roleKeyOverride === undefined ? scenario.eventInput.roleKey : params.roleKeyOverride,
    userId: params.userIdOverride === undefined ? scenario.eventInput.userId : params.userIdOverride,
    channelHint: params.channelHintOverride === undefined ? scenario.eventInput.channelHint : params.channelHintOverride,
    locale: params.localeOverride || scenario.eventInput.locale,
    defaultLocale: params.defaultLocaleOverride || scenario.eventInput.defaultLocale,
    recipientLimit: params.recipientLimitOverride || scenario.eventInput.recipientLimit,
  });

  const report = validateNotificationRuntimeReadiness({
    eventInput,
    preferenceInput: scenario.preferenceInput,
    templates: scenario.templates,
    recipients: scenario.recipients,
    rolePreferenceRows: scenario.rolePreferenceRows,
  });

  return {
    ok: true as const,
    result: {
      source: "fixture" as const,
      scenarioId: scenario.id,
      report,
    },
  };
}
