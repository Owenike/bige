import {
  channelPreferencesSchema,
  normalizeChannels,
  NOTIFICATION_CHANNEL_KEYS,
  type NotificationChannelKey,
} from "./notification-productization";

export type NotificationPreferenceResolutionSource =
  | "system_default"
  | "platform_default"
  | "tenant_default"
  | "role"
  | "user";

export type NotificationPreferenceRuleInput = {
  enabled: boolean;
  channels?: unknown;
  reason?: string | null;
};

export type NotificationPreferenceResolutionInput = {
  platformDefault?: NotificationPreferenceRuleInput | null;
  tenantDefault?: NotificationPreferenceRuleInput | null;
  rolePreference?: NotificationPreferenceRuleInput | null;
  userPreference?: NotificationPreferenceRuleInput | null;
};

export type NotificationPreferenceResolutionTraceItem = {
  source: Exclude<NotificationPreferenceResolutionSource, "system_default">;
  enabled: boolean;
  applied: boolean;
  reason: string;
};

export type NotificationPreferenceResolution = {
  enabled: boolean;
  channels: Record<NotificationChannelKey, boolean>;
  source: NotificationPreferenceResolutionSource;
  reason: string;
  explain: string;
  trace: NotificationPreferenceResolutionTraceItem[];
};

const EMPTY_CHANNELS = NOTIFICATION_CHANNEL_KEYS.reduce<Record<NotificationChannelKey, boolean>>((acc, channel) => {
  acc[channel] = false;
  return acc;
}, {} as Record<NotificationChannelKey, boolean>);

const SYSTEM_DEFAULT_CHANNELS = normalizeChannels(channelPreferencesSchema.parse({}));

function normalizeRuleChannels(raw: unknown) {
  return normalizeChannels(channelPreferencesSchema.parse(raw || {}));
}

function buildRuleExplain(source: Exclude<NotificationPreferenceResolutionSource, "system_default">, rule: NotificationPreferenceRuleInput) {
  const base = `${source} preference`;
  if (rule.enabled === false) return `${base} disabled notification delivery`;
  if (rule.reason && rule.reason.trim()) return `${base}: ${rule.reason.trim()}`;
  return `${base} is enabled`;
}

function chooseWinningRule(input: NotificationPreferenceResolutionInput) {
  const chain: Array<{
    source: Exclude<NotificationPreferenceResolutionSource, "system_default">;
    rule: NotificationPreferenceRuleInput | null | undefined;
  }> = [
    { source: "platform_default", rule: input.platformDefault },
    { source: "tenant_default", rule: input.tenantDefault },
    { source: "role", rule: input.rolePreference },
    { source: "user", rule: input.userPreference },
  ];

  let winner: { source: Exclude<NotificationPreferenceResolutionSource, "system_default">; rule: NotificationPreferenceRuleInput } | null = null;
  const trace: NotificationPreferenceResolutionTraceItem[] = [];

  for (const item of chain) {
    if (!item.rule) continue;
    winner = { source: item.source, rule: item.rule };
    trace.push({
      source: item.source,
      enabled: item.rule.enabled !== false,
      applied: false,
      reason: buildRuleExplain(item.source, item.rule),
    });
  }

  if (winner) {
    const index = trace.findIndex((item) => item.source === winner?.source);
    if (index >= 0) trace[index].applied = true;
  }

  return { winner, trace };
}

export function resolveNotificationPreference(input: NotificationPreferenceResolutionInput): NotificationPreferenceResolution {
  const { winner, trace } = chooseWinningRule(input);

  if (!winner) {
    return {
      enabled: true,
      channels: { ...SYSTEM_DEFAULT_CHANNELS },
      source: "system_default",
      reason: "no_preference_rule",
      explain: "No platform/tenant/role/user preference found; using system default.",
      trace,
    };
  }

  if (winner.rule.enabled === false) {
    return {
      enabled: false,
      channels: { ...EMPTY_CHANNELS },
      source: winner.source,
      reason: "explicitly_disabled",
      explain: buildRuleExplain(winner.source, winner.rule),
      trace,
    };
  }

  return {
    enabled: true,
    channels: normalizeRuleChannels(winner.rule.channels),
    source: winner.source,
    reason: "enabled_by_preference_rule",
    explain: buildRuleExplain(winner.source, winner.rule),
    trace,
  };
}
