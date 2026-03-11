import {
  channelPreferencesSchema,
  normalizeChannels,
  NOTIFICATION_CHANNEL_KEYS,
  type NotificationChannelKey,
  type NotificationEventKey,
} from "./notification-productization";
import {
  parseChannelQueryValue,
  parseCsvQueryParam,
  parseEventQueryValue,
  parseUuidQueryValue,
} from "./notification-productization-contracts";

export type NotificationPreferenceSource =
  | "platform_default"
  | "tenant_default"
  | "role_preference"
  | "user_preference"
  | "system_default";

export type NotificationPreferenceRule = {
  source: Exclude<NotificationPreferenceSource, "system_default">;
  isEnabled: boolean;
  channels: unknown;
};

export type NotificationEffectivePreference = {
  source: NotificationPreferenceSource;
  isEnabled: boolean;
  channels: Record<NotificationChannelKey, boolean>;
  trace: NotificationPreferenceSource[];
};

export type NotificationTemplateFallbackInput = {
  id: string;
  tenant_id: string | null;
  event_type: string;
  channel: string;
  locale: string;
  is_active: boolean;
  version: number;
  updated_at: string;
};

export type NotificationTemplateFallbackResult = {
  selected: NotificationTemplateFallbackInput | null;
  strategy: "tenant_locale" | "tenant_default_locale" | "global_locale" | "global_default_locale" | "none";
  tried: Array<{
    tenantId: string | null;
    locale: string;
    strategy: "tenant_locale" | "tenant_default_locale" | "global_locale" | "global_default_locale";
  }>;
};

export type NotificationRetryFilterQuery = {
  eventType: NotificationEventKey | null;
  channels: NotificationChannelKey[];
  statuses: string[];
  deliveryId: string | null;
  limit: number;
};

const DEFAULT_CHANNELS = normalizeChannels(channelPreferencesSchema.parse({}));
const EMPTY_CHANNELS = NOTIFICATION_CHANNEL_KEYS.reduce<Record<NotificationChannelKey, boolean>>((acc, channel) => {
  acc[channel] = false;
  return acc;
}, {} as Record<NotificationChannelKey, boolean>);

function normalizeRuleChannels(input: unknown) {
  return normalizeChannels(channelPreferencesSchema.parse(input || {}));
}

function rankTemplateRow(row: NotificationTemplateFallbackInput) {
  const updatedAt = new Date(row.updated_at).getTime();
  return {
    version: Number.isFinite(row.version) ? row.version : 1,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

function pickNewestTemplate(rows: NotificationTemplateFallbackInput[]) {
  if (rows.length === 0) return null;
  return rows
    .slice()
    .sort((a, b) => {
      const rankA = rankTemplateRow(a);
      const rankB = rankTemplateRow(b);
      if (rankB.version !== rankA.version) return rankB.version - rankA.version;
      return rankB.updatedAt - rankA.updatedAt;
    })[0];
}

export function resolvePreferencePrecedence(params: {
  platformDefault?: NotificationPreferenceRule | null;
  tenantDefault?: NotificationPreferenceRule | null;
  rolePreference?: NotificationPreferenceRule | null;
  userPreference?: NotificationPreferenceRule | null;
}): NotificationEffectivePreference {
  const ruleOrder: Array<NotificationPreferenceRule | null | undefined> = [
    params.platformDefault,
    params.tenantDefault,
    params.rolePreference,
    params.userPreference,
  ];
  const trace: NotificationPreferenceSource[] = ["system_default"];
  let winner: NotificationPreferenceRule | null = null;

  for (const rule of ruleOrder) {
    if (!rule) continue;
    winner = rule;
    trace.push(rule.source);
  }

  if (!winner) {
    return {
      source: "system_default",
      isEnabled: true,
      channels: { ...DEFAULT_CHANNELS },
      trace,
    };
  }

  if (winner.isEnabled === false) {
    return {
      source: winner.source,
      isEnabled: false,
      channels: { ...EMPTY_CHANNELS },
      trace,
    };
  }

  return {
    source: winner.source,
    isEnabled: true,
    channels: normalizeRuleChannels(winner.channels),
    trace,
  };
}

export function selectTemplateWithFallback(params: {
  templates: NotificationTemplateFallbackInput[];
  tenantId: string | null;
  eventType: string;
  channel: string;
  locale: string;
  defaultLocale?: string;
}) : NotificationTemplateFallbackResult {
  const locale = (params.locale || "zh-TW").trim() || "zh-TW";
  const defaultLocale = (params.defaultLocale || "zh-TW").trim() || "zh-TW";
  const activeRows = params.templates.filter((row) =>
    row.is_active !== false &&
    row.event_type === params.eventType &&
    row.channel === params.channel,
  );

  const strategies: NotificationTemplateFallbackResult["tried"] = [
    { tenantId: params.tenantId || null, locale, strategy: "tenant_locale" },
    { tenantId: params.tenantId || null, locale: defaultLocale, strategy: "tenant_default_locale" },
    { tenantId: null, locale, strategy: "global_locale" },
    { tenantId: null, locale: defaultLocale, strategy: "global_default_locale" },
  ];

  for (const step of strategies) {
    if (!step.tenantId && (step.strategy === "tenant_locale" || step.strategy === "tenant_default_locale")) continue;
    const matched = activeRows.filter((row) => row.tenant_id === step.tenantId && row.locale === step.locale);
    const selected = pickNewestTemplate(matched);
    if (selected) {
      return {
        selected,
        strategy: step.strategy,
        tried: strategies,
      };
    }
  }

  return {
    selected: null,
    strategy: "none",
    tried: strategies,
  };
}

export function parseRetryFilterQuery(params: URLSearchParams): NotificationRetryFilterQuery {
  const channels = parseCsvQueryParam(params.get("channels"))
    .map((value) => parseChannelQueryValue(value))
    .filter((value): value is NotificationChannelKey => Boolean(value));

  const statuses = parseCsvQueryParam(params.get("statuses"));
  const eventType = parseEventQueryValue(params.get("eventType"));
  const deliveryId = parseUuidQueryValue(params.get("deliveryId"));
  const limitRaw = Number(params.get("limit") || 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 200;

  return {
    eventType,
    channels,
    statuses,
    deliveryId,
    limit,
  };
}
