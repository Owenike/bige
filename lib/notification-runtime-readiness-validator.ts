import {
  computeNotificationCoverageGaps,
  type NotificationRolePreferenceIntegrityRow,
} from "./notification-config-integrity";
import {
  buildNotificationDeliveryPlanningDraft,
  type NotificationDeliveryPlanningDraftInput,
} from "./notification-delivery-planning-draft-service";
import { NOTIFICATION_CHANNEL_KEYS, type NotificationChannelKey } from "./notification-productization";
import {
  resolveNotificationPreference,
  type NotificationPreferenceResolutionInput,
} from "./notification-preference-resolution-service";
import { resolveNotificationTemplate, type NotificationTemplateResolutionRow } from "./notification-template-resolution-service";
import {
  toRuntimeDeliveryPlanningContract,
  toRuntimeEventInputContract,
  toRuntimePreferenceResolutionContract,
  toRuntimeTemplateResolutionContract,
  type NotificationRuntimeReadinessReportContract,
  type NotificationRuntimeEventInputContract,
  type NotificationRuntimeWarningContract,
} from "./notification-runtime-integration-contracts";

export type NotificationRuntimeReadinessValidationInput = {
  eventInput: NotificationRuntimeEventInputContract;
  preferenceInput: NotificationPreferenceResolutionInput;
  templates: NotificationTemplateResolutionRow[];
  recipients: NonNullable<NotificationDeliveryPlanningDraftInput["recipients"]>;
  rolePreferenceRows?: NotificationRolePreferenceIntegrityRow[];
  requiredRoles?: readonly string[];
  requiredEvents?: readonly string[];
  requiredChannels?: readonly NotificationChannelKey[];
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

function uniqueByChannel(items: Array<{ channel: NotificationChannelKey; reason: string }>) {
  const map = new Map<string, { channel: NotificationChannelKey; reason: string }>();
  for (const item of items) {
    const key = `${item.channel}:${item.reason}`;
    if (map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
}

function resolveChannelsToEvaluate(params: {
  channelHint: NotificationChannelKey | null;
  enabledChannels: NotificationChannelKey[];
}) {
  if (params.channelHint) return [params.channelHint];
  if (params.enabledChannels.length > 0) return params.enabledChannels;
  return ["in_app"] as NotificationChannelKey[];
}

export function validateNotificationRuntimeReadiness(
  input: NotificationRuntimeReadinessValidationInput,
): NotificationRuntimeReadinessReportContract {
  const eventInput = toRuntimeEventInputContract(input.eventInput);
  const preference = resolveNotificationPreference(input.preferenceInput);
  const preferenceContract = toRuntimePreferenceResolutionContract(preference);
  const enabledChannels = (Object.keys(preference.channels) as NotificationChannelKey[]).filter(
    (channel) => preference.channels[channel],
  );
  const channelsToEvaluate = resolveChannelsToEvaluate({
    channelHint: eventInput.channelHint,
    enabledChannels,
  });

  const templateResolutionMap: Partial<Record<NotificationChannelKey, ReturnType<typeof resolveNotificationTemplate>>> = {};
  for (const channel of channelsToEvaluate) {
    templateResolutionMap[channel] = resolveNotificationTemplate({
      templates: input.templates,
      tenantId: eventInput.tenantId,
      eventType: eventInput.eventKey,
      channel,
      locale: eventInput.locale,
      defaultLocale: eventInput.defaultLocale,
    });
  }

  const templateContracts = channelsToEvaluate.map((channel) =>
    toRuntimeTemplateResolutionContract({
      channel,
      resolution: templateResolutionMap[channel]!,
    }),
  );

  const draft = buildNotificationDeliveryPlanningDraft({
    eventKey: eventInput.eventKey,
    tenantId: eventInput.tenantId,
    targetHints: {
      roleKeys: eventInput.roleKey ? [eventInput.roleKey] : [],
      userIds: eventInput.userId ? [eventInput.userId] : [],
    },
    recipients: input.recipients,
    preferenceResolution: preference,
    templateResolutionsByChannel: templateResolutionMap,
  });
  const deliveryPlanningContract = toRuntimeDeliveryPlanningContract(draft);

  const missingTemplates = templateContracts
    .filter((item) => item.found === false)
    .map((item) => ({
      channel: item.channel,
      reason: item.missingReason || "template_missing",
    }));

  const unavailableChannels = uniqueByChannel([
    ...channelsToEvaluate
      .filter((channel) => !preference.channels[channel])
      .map((channel) => ({
        channel,
        reason: "disabled_by_preference",
      })),
    ...missingTemplates.map((item) => ({
      channel: item.channel,
      reason: "template_missing",
    })),
  ]);

  const missingPreferences: NotificationRuntimeReadinessReportContract["readiness"]["missingPreferences"] = [];
  if (eventInput.roleKey && !input.preferenceInput.rolePreference) {
    missingPreferences.push({
      roleKey: eventInput.roleKey,
      eventKey: eventInput.eventKey,
      reason: "role_preference_not_configured",
    });
  }
  if (eventInput.userId && !input.preferenceInput.userPreference) {
    missingPreferences.push({
      roleKey: eventInput.roleKey,
      eventKey: eventInput.eventKey,
      reason: "user_preference_not_configured",
    });
  }
  if (preference.source === "system_default") {
    missingPreferences.push({
      roleKey: eventInput.roleKey,
      eventKey: eventInput.eventKey,
      reason: "no_preference_rule_fallback_to_system_default",
    });
  }

  const fallbacks = templateContracts
    .filter(
      (item): item is typeof item & {
        strategy: "tenant_default_locale" | "global_locale" | "global_default_locale";
        fallbackReason: "TENANT_DEFAULT_LOCALE_FALLBACK" | "GLOBAL_LOCALE_FALLBACK" | "GLOBAL_DEFAULT_LOCALE_FALLBACK";
      } =>
        item.found === true &&
        (item.strategy === "tenant_default_locale" ||
          item.strategy === "global_locale" ||
          item.strategy === "global_default_locale") &&
        Boolean(item.fallbackReason),
    )
    .map((item) => ({
      channel: item.channel,
      strategy: item.strategy,
      reason: item.fallbackReason,
    }));

  if (input.rolePreferenceRows && input.rolePreferenceRows.length >= 0) {
    const coverage = computeNotificationCoverageGaps({
      tenantId: eventInput.tenantId,
      rolePreferenceRows: input.rolePreferenceRows,
      templateRows: input.templates,
      defaultLocale: eventInput.defaultLocale,
      requiredRoles: input.requiredRoles,
      requiredEvents: input.requiredEvents,
      requiredChannels: input.requiredChannels || NOTIFICATION_CHANNEL_KEYS,
    });
    if (eventInput.roleKey) {
      const roleEventMissing = coverage.missingRoleEventPairs.find(
        (item) => item.role === eventInput.roleKey && item.eventType === eventInput.eventKey,
      );
      if (roleEventMissing) {
        missingPreferences.push({
          roleKey: roleEventMissing.role,
          eventKey: roleEventMissing.eventType as NotificationRuntimeEventInputContract["eventKey"],
          reason: "coverage_gap_missing_role_event_preference",
        });
      }
    }
  }

  const warningItems: NotificationRuntimeWarningContract[] = [];
  if (preference.source === "system_default") {
    warningItems.push({
      code: "PREFERENCE_RULE_MISSING",
      message: "No explicit preference rule found; system default is used.",
    });
  }
  if (!preference.enabled) {
    warningItems.push({
      code: "PREFERENCE_DISABLED",
      message: "Resolved preference is disabled.",
    });
  }
  if (input.recipients.length === 0) {
    warningItems.push({
      code: "RECIPIENTS_EMPTY",
      message: "No recipients are provided for simulation.",
    });
  }
  for (const item of unavailableChannels) {
    warningItems.push({
      code: "CHANNEL_DISABLED",
      message: `${item.channel} is not available (${item.reason}).`,
    });
  }
  for (const item of missingTemplates) {
    warningItems.push({
      code: "TEMPLATE_MISSING",
      message: `${item.channel} template is missing (${item.reason}).`,
    });
  }
  for (const item of fallbacks) {
    warningItems.push({
      code: "FALLBACK_APPLIED",
      message: `${item.channel} uses ${item.strategy}.`,
    });
  }

  const warnings = dedupeWarnings(warningItems);

  const readiness = {
    ready:
      deliveryPlanningContract.ready &&
      missingTemplates.length === 0 &&
      unavailableChannels.filter((item) => item.reason !== "disabled_by_preference").length === 0,
    missingPreferences,
    missingTemplates,
    unavailableChannels,
    fallbacks,
  };

  return {
    eventInput,
    preference: preferenceContract,
    templates: templateContracts,
    deliveryPlanning: deliveryPlanningContract,
    readiness,
    warnings,
  };
}
