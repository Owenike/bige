import type { NotificationChannelKey, NotificationEventKey, NotificationPriorityKey } from "./notification-productization";

export type NotificationTemplateResolutionRow = {
  id: string;
  tenant_id: string | null;
  event_type: string;
  channel: string;
  locale: string;
  title_template: string;
  message_template: string;
  email_subject: string | null;
  action_url: string | null;
  priority: string;
  channel_policy: Record<string, unknown> | null;
  is_active: boolean;
  version: number;
  updated_at: string;
};

export type NotificationTemplateResolutionStrategy =
  | "tenant_locale"
  | "tenant_default_locale"
  | "global_locale"
  | "global_default_locale"
  | "none";

export type NotificationTemplateResolution = {
  found: boolean;
  source: "tenant" | "global" | "none";
  strategy: NotificationTemplateResolutionStrategy;
  template: {
    id: string;
    tenantId: string | null;
    locale: string;
    priority: NotificationPriorityKey | "info";
    titleTemplate: string;
    messageTemplate: string;
    emailSubject: string | null;
    actionUrl: string | null;
    channelPolicy: Record<string, unknown>;
    version: number;
  } | null;
  missingReason: string | null;
  tried: Array<{
    tenantId: string | null;
    locale: string;
    strategy: Exclude<NotificationTemplateResolutionStrategy, "none">;
  }>;
};

function normalizeLocale(input: string | null | undefined) {
  const value = String(input || "").trim();
  return value || "zh-TW";
}

function normalizePriority(input: string | null | undefined): NotificationPriorityKey | "info" {
  if (input === "warning" || input === "critical" || input === "info") return input;
  return "info";
}

function rankTemplateRow(row: NotificationTemplateResolutionRow) {
  const updatedAt = new Date(row.updated_at).getTime();
  return {
    version: Number.isFinite(row.version) ? row.version : 1,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

function pickNewestTemplate(rows: NotificationTemplateResolutionRow[]) {
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

function toResolvedTemplate(row: NotificationTemplateResolutionRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    locale: normalizeLocale(row.locale),
    priority: normalizePriority(row.priority),
    titleTemplate: String(row.title_template || ""),
    messageTemplate: String(row.message_template || ""),
    emailSubject: row.email_subject || null,
    actionUrl: row.action_url || null,
    channelPolicy:
      row.channel_policy && typeof row.channel_policy === "object" && !Array.isArray(row.channel_policy)
        ? row.channel_policy
        : {},
    version: Math.max(1, Number(row.version || 1)),
  };
}

export function resolveNotificationTemplate(params: {
  templates: NotificationTemplateResolutionRow[];
  tenantId: string | null;
  eventType: NotificationEventKey | string;
  channel: NotificationChannelKey | string;
  locale: string;
  defaultLocale?: string;
}): NotificationTemplateResolution {
  const locale = normalizeLocale(params.locale);
  const defaultLocale = normalizeLocale(params.defaultLocale || "zh-TW");
  const activeRows = params.templates.filter((row) => {
    if (row.is_active === false) return false;
    return row.event_type === params.eventType && row.channel === params.channel;
  });

  const strategies: NotificationTemplateResolution["tried"] = [
    { tenantId: params.tenantId || null, locale, strategy: "tenant_locale" },
    { tenantId: params.tenantId || null, locale: defaultLocale, strategy: "tenant_default_locale" },
    { tenantId: null, locale, strategy: "global_locale" },
    { tenantId: null, locale: defaultLocale, strategy: "global_default_locale" },
  ];

  for (const step of strategies) {
    if (!step.tenantId && (step.strategy === "tenant_locale" || step.strategy === "tenant_default_locale")) continue;
    const matched = activeRows.filter((row) => row.tenant_id === step.tenantId && normalizeLocale(row.locale) === step.locale);
    const selected = pickNewestTemplate(matched);
    if (!selected) continue;
    return {
      found: true,
      source: selected.tenant_id ? "tenant" : "global",
      strategy: step.strategy,
      template: toResolvedTemplate(selected),
      missingReason: null,
      tried: strategies,
    };
  }

  return {
    found: false,
    source: "none",
    strategy: "none",
    template: null,
    missingReason: `No active template found for event=${params.eventType}, channel=${params.channel}`,
    tried: strategies,
  };
}
