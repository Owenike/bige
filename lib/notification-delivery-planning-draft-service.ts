import type { NotificationChannelKey, NotificationEventKey } from "./notification-productization";
import type { NotificationPreferenceResolution } from "./notification-preference-resolution-service";
import type { NotificationTemplateResolution } from "./notification-template-resolution-service";

export type NotificationDeliveryPlanningSkippedCode =
  | "PREFERENCE_DISABLED"
  | "NO_CHANNEL_ENABLED"
  | "NO_RECIPIENTS"
  | "TEMPLATE_MISSING"
  | "CHANNEL_TEMPLATE_MISSING";

export type NotificationDeliveryPlanningDraftInput = {
  eventKey: NotificationEventKey | string;
  tenantId: string | null;
  targetHints?: {
    roleKeys?: string[];
    userIds?: string[];
  };
  recipients?: Array<{
    userId: string;
    role?: string | null;
  }>;
  preferenceResolution: NotificationPreferenceResolution;
  templateResolutionsByChannel?: Partial<Record<NotificationChannelKey, NotificationTemplateResolution>>;
  defaultTemplateResolution?: NotificationTemplateResolution | null;
};

export type NotificationDeliveryPlanningDraft = {
  eventKey: string;
  tenantId: string | null;
  plannedRecipients: Array<{
    userId: string;
    role: string | null;
    plannedChannels: NotificationChannelKey[];
  }>;
  plannedChannels: NotificationChannelKey[];
  plannedContentSkeleton: {
    byChannel: Partial<
      Record<
        NotificationChannelKey,
        {
          titleTemplate: string;
          messageTemplate: string;
          emailSubject: string | null;
          actionUrl: string | null;
          priority: string;
          source: string;
        }
      >
    >;
  };
  skippedReasons: Array<{ code: NotificationDeliveryPlanningSkippedCode; message: string }>;
  ready: boolean;
};

function dedupeByUserId(items: Array<{ userId: string; role?: string | null }>) {
  const map = new Map<string, { userId: string; role: string | null }>();
  for (const item of items) {
    const key = String(item.userId || "").trim();
    if (!key) continue;
    const existing = map.get(key);
    if (existing) continue;
    map.set(key, { userId: key, role: item.role || null });
  }
  return Array.from(map.values());
}

function enabledChannelsFromPreference(preference: NotificationPreferenceResolution) {
  return (Object.keys(preference.channels) as NotificationChannelKey[]).filter((channel) => preference.channels[channel]);
}

export function buildNotificationDeliveryPlanningDraft(
  input: NotificationDeliveryPlanningDraftInput,
): NotificationDeliveryPlanningDraft {
  const skippedReasons: NotificationDeliveryPlanningDraft["skippedReasons"] = [];
  const recipients = dedupeByUserId(input.recipients || []);

  if (!input.preferenceResolution.enabled) {
    skippedReasons.push({
      code: "PREFERENCE_DISABLED",
      message: `Preference resolved as disabled from source=${input.preferenceResolution.source}`,
    });
  }

  const enabledChannels = input.preferenceResolution.enabled ? enabledChannelsFromPreference(input.preferenceResolution) : [];
  if (enabledChannels.length === 0) {
    skippedReasons.push({
      code: "NO_CHANNEL_ENABLED",
      message: "No notification channel enabled by resolved preference.",
    });
  }

  if (recipients.length === 0) {
    skippedReasons.push({
      code: "NO_RECIPIENTS",
      message: "No recipients in draft input.",
    });
  }

  const templateByChannel: NotificationDeliveryPlanningDraft["plannedContentSkeleton"]["byChannel"] = {};
  const channelsWithTemplates: NotificationChannelKey[] = [];

  for (const channel of enabledChannels) {
    const specific = input.templateResolutionsByChannel?.[channel] || null;
    const fallback = input.defaultTemplateResolution || null;
    const resolved = specific || fallback;
    if (!resolved || !resolved.found || !resolved.template) {
      skippedReasons.push({
        code: specific ? "CHANNEL_TEMPLATE_MISSING" : "TEMPLATE_MISSING",
        message: `Template is missing for channel=${channel}.`,
      });
      continue;
    }
    channelsWithTemplates.push(channel);
    templateByChannel[channel] = {
      titleTemplate: resolved.template.titleTemplate,
      messageTemplate: resolved.template.messageTemplate,
      emailSubject: resolved.template.emailSubject,
      actionUrl: resolved.template.actionUrl,
      priority: resolved.template.priority,
      source: resolved.source,
    };
  }

  const plannedRecipients = recipients
    .map((recipient) => ({
      userId: recipient.userId,
      role: recipient.role || null,
      plannedChannels: channelsWithTemplates,
    }))
    .filter((recipient) => recipient.plannedChannels.length > 0);

  const ready =
    input.preferenceResolution.enabled &&
    enabledChannels.length > 0 &&
    channelsWithTemplates.length > 0 &&
    plannedRecipients.length > 0;

  return {
    eventKey: input.eventKey,
    tenantId: input.tenantId || null,
    plannedRecipients,
    plannedChannels: channelsWithTemplates,
    plannedContentSkeleton: {
      byChannel: templateByChannel,
    },
    skippedReasons,
    ready,
  };
}
