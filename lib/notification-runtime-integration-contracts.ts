import type { NotificationChannelKey, NotificationEventKey, NotificationRoleKey } from "./notification-productization";
import type {
  NotificationPreferenceResolution,
  NotificationPreferenceResolutionSource,
  NotificationPreferenceResolutionTraceItem,
} from "./notification-preference-resolution-service";
import type {
  NotificationTemplateResolution,
  NotificationTemplateResolutionStrategy,
} from "./notification-template-resolution-service";
import type {
  NotificationDeliveryPlanningDraft,
  NotificationDeliveryPlanningSkippedCode,
} from "./notification-delivery-planning-draft-service";

export type NotificationRuntimeFallbackReasonCode =
  | "TENANT_DEFAULT_LOCALE_FALLBACK"
  | "GLOBAL_LOCALE_FALLBACK"
  | "GLOBAL_DEFAULT_LOCALE_FALLBACK"
  | "NO_TEMPLATE_FOUND";

export type NotificationRuntimeWarningCode =
  | "PREFERENCE_RULE_MISSING"
  | "PREFERENCE_DISABLED"
  | "CHANNEL_DISABLED"
  | "TEMPLATE_MISSING"
  | "RECIPIENTS_EMPTY"
  | "FALLBACK_APPLIED";

export type NotificationRuntimeSkippedReasonCode = NotificationDeliveryPlanningSkippedCode;

export type NotificationRuntimeEventInputContract = {
  tenantId: string;
  eventKey: NotificationEventKey;
  roleKey: NotificationRoleKey | null;
  userId: string | null;
  channelHint: NotificationChannelKey | null;
  locale: string;
  defaultLocale: string;
  recipientLimit: number;
  payload: Record<string, unknown>;
};

export type NotificationRuntimePreferenceResolutionContract = {
  enabled: boolean;
  channels: Record<NotificationChannelKey, boolean>;
  source: NotificationPreferenceResolutionSource;
  reason: string;
  explain: string;
  trace: NotificationPreferenceResolutionTraceItem[];
};

export type NotificationRuntimeTemplateResolutionContract = {
  channel: NotificationChannelKey;
  found: boolean;
  source: "tenant" | "global" | "none";
  strategy: NotificationTemplateResolutionStrategy;
  fallbackReason: NotificationRuntimeFallbackReasonCode | null;
  template: {
    id: string;
    tenantId: string | null;
    locale: string;
    priority: string;
    titleTemplate: string;
    messageTemplate: string;
    emailSubject: string | null;
    actionUrl: string | null;
    channelPolicy: Record<string, unknown>;
    version: number;
  } | null;
  missingReason: string | null;
};

export type NotificationRuntimeSkippedReasonContract = {
  code: NotificationRuntimeSkippedReasonCode;
  message: string;
};

export type NotificationRuntimeWarningContract = {
  code: NotificationRuntimeWarningCode;
  message: string;
};

export type NotificationRuntimeDeliveryPlanningContract = {
  ready: boolean;
  plannedChannels: NotificationChannelKey[];
  plannedRecipients: Array<{
    userId: string;
    role: string | null;
    plannedChannels: NotificationChannelKey[];
  }>;
  plannedContentSkeleton: NotificationDeliveryPlanningDraft["plannedContentSkeleton"];
  skippedReasons: NotificationRuntimeSkippedReasonContract[];
};

export type NotificationRuntimeReadinessSummaryContract = {
  ready: boolean;
  missingPreferences: Array<{ roleKey: string | null; eventKey: NotificationEventKey; reason: string }>;
  missingTemplates: Array<{ channel: NotificationChannelKey; reason: string }>;
  unavailableChannels: Array<{ channel: NotificationChannelKey; reason: string }>;
  fallbacks: Array<{
    channel: NotificationChannelKey;
    strategy: Exclude<NotificationTemplateResolutionStrategy, "none" | "tenant_locale">;
    reason: NotificationRuntimeFallbackReasonCode;
  }>;
};

export type NotificationRuntimeReadinessReportContract = {
  eventInput: NotificationRuntimeEventInputContract;
  preference: NotificationRuntimePreferenceResolutionContract;
  templates: NotificationRuntimeTemplateResolutionContract[];
  deliveryPlanning: NotificationRuntimeDeliveryPlanningContract;
  readiness: NotificationRuntimeReadinessSummaryContract;
  warnings: NotificationRuntimeWarningContract[];
};

export function normalizeRuntimeContractLocale(input: string | null | undefined) {
  const value = String(input || "").trim();
  return value || "zh-TW";
}

export function toRuntimeEventInputContract(
  input: Partial<NotificationRuntimeEventInputContract> & Pick<NotificationRuntimeEventInputContract, "tenantId" | "eventKey">,
): NotificationRuntimeEventInputContract {
  return {
    tenantId: input.tenantId,
    eventKey: input.eventKey,
    roleKey: input.roleKey || null,
    userId: input.userId || null,
    channelHint: input.channelHint || null,
    locale: normalizeRuntimeContractLocale(input.locale),
    defaultLocale: normalizeRuntimeContractLocale(input.defaultLocale || "zh-TW"),
    recipientLimit: Math.min(100, Math.max(1, Math.floor(Number(input.recipientLimit || 20)))),
    payload: input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {},
  };
}

export function toRuntimePreferenceResolutionContract(
  resolution: NotificationPreferenceResolution,
): NotificationRuntimePreferenceResolutionContract {
  return {
    enabled: resolution.enabled,
    channels: resolution.channels,
    source: resolution.source,
    reason: resolution.reason,
    explain: resolution.explain,
    trace: resolution.trace,
  };
}

export function mapTemplateStrategyToFallbackReason(
  strategy: NotificationTemplateResolutionStrategy,
): NotificationRuntimeFallbackReasonCode | null {
  if (strategy === "tenant_default_locale") return "TENANT_DEFAULT_LOCALE_FALLBACK";
  if (strategy === "global_locale") return "GLOBAL_LOCALE_FALLBACK";
  if (strategy === "global_default_locale") return "GLOBAL_DEFAULT_LOCALE_FALLBACK";
  if (strategy === "none") return "NO_TEMPLATE_FOUND";
  return null;
}

export function toRuntimeTemplateResolutionContract(params: {
  channel: NotificationChannelKey;
  resolution: NotificationTemplateResolution;
}): NotificationRuntimeTemplateResolutionContract {
  const fallbackReason = mapTemplateStrategyToFallbackReason(params.resolution.strategy);
  return {
    channel: params.channel,
    found: params.resolution.found,
    source: params.resolution.source,
    strategy: params.resolution.strategy,
    fallbackReason,
    template: params.resolution.template
      ? {
          id: params.resolution.template.id,
          tenantId: params.resolution.template.tenantId,
          locale: params.resolution.template.locale,
          priority: params.resolution.template.priority,
          titleTemplate: params.resolution.template.titleTemplate,
          messageTemplate: params.resolution.template.messageTemplate,
          emailSubject: params.resolution.template.emailSubject,
          actionUrl: params.resolution.template.actionUrl,
          channelPolicy: params.resolution.template.channelPolicy,
          version: params.resolution.template.version,
        }
      : null,
    missingReason: params.resolution.missingReason,
  };
}

export function toRuntimeDeliveryPlanningContract(
  draft: NotificationDeliveryPlanningDraft,
): NotificationRuntimeDeliveryPlanningContract {
  return {
    ready: draft.ready,
    plannedChannels: draft.plannedChannels,
    plannedRecipients: draft.plannedRecipients,
    plannedContentSkeleton: draft.plannedContentSkeleton,
    skippedReasons: draft.skippedReasons.map((item) => ({
      code: item.code,
      message: item.message,
    })),
  };
}
