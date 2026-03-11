import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MANAGER_EDITABLE_ROLE_KEYS,
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  type NotificationChannelKey,
  type NotificationEventKey,
} from "./notification-productization";
import { createSupabaseAdminClient } from "./supabase/admin";
import { resolveNotificationTemplate, type NotificationTemplateResolutionRow } from "./notification-template-resolution-service";

export type NotificationRolePreferenceIntegrityRow = {
  role: string;
  event_type: string;
  is_enabled: boolean;
  channels: Record<string, boolean>;
};

export type NotificationIntegrityCoverageGaps = {
  missingRoleEventPairs: Array<{ role: string; eventType: string }>;
  missingTemplatePairs: Array<{ eventType: string; channel: string }>;
  enabledChannelsWithoutTemplate: Array<{ channel: string; eventTypes: string[] }>;
};

export type TenantNotificationConfigIntegrity = {
  tenantId: string;
  score: number;
  healthStatus: "healthy" | "degraded" | "critical";
  summary: {
    expectedRoleEventPairs: number;
    configuredRoleEventPairs: number;
    expectedTemplatePairs: number;
    coveredTemplatePairs: number;
    channelReadinessRate: number;
  };
  missingItems: NotificationIntegrityCoverageGaps;
  warnings: string[];
};

type CoverageInput = {
  tenantId: string;
  rolePreferenceRows: NotificationRolePreferenceIntegrityRow[];
  templateRows: NotificationTemplateResolutionRow[];
  defaultLocale?: string;
  requiredRoles?: readonly string[];
  requiredEvents?: readonly string[];
  requiredChannels?: readonly string[];
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeRate(numerator: number, denominator: number) {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function sortStrings(values: string[]) {
  return values.slice().sort((a, b) => a.localeCompare(b));
}

export function computeNotificationCoverageGaps(input: CoverageInput): NotificationIntegrityCoverageGaps {
  const requiredRoles = input.requiredRoles || MANAGER_EDITABLE_ROLE_KEYS;
  const requiredEvents = input.requiredEvents || NOTIFICATION_EVENT_KEYS;
  const requiredChannels = input.requiredChannels || NOTIFICATION_CHANNEL_KEYS;
  const rolePairSet = new Set(input.rolePreferenceRows.map((row) => `${row.role}:${row.event_type}`));
  const missingRoleEventPairs: NotificationIntegrityCoverageGaps["missingRoleEventPairs"] = [];

  for (const role of requiredRoles) {
    for (const eventType of requiredEvents) {
      const key = `${role}:${eventType}`;
      if (!rolePairSet.has(key)) {
        missingRoleEventPairs.push({ role, eventType });
      }
    }
  }

  const missingTemplatePairs: NotificationIntegrityCoverageGaps["missingTemplatePairs"] = [];
  for (const eventType of requiredEvents) {
    for (const channel of requiredChannels) {
      const resolved = resolveNotificationTemplate({
        templates: input.templateRows,
        tenantId: input.tenantId,
        eventType,
        channel,
        locale: input.defaultLocale || "zh-TW",
        defaultLocale: input.defaultLocale || "zh-TW",
      });
      if (!resolved.found) {
        missingTemplatePairs.push({ eventType, channel });
      }
    }
  }

  const channelToEvents = new Map<string, Set<string>>();
  for (const row of input.rolePreferenceRows) {
    if (row.is_enabled === false) continue;
    const channels = row.channels || {};
    for (const channel of requiredChannels) {
      if (!channels[channel]) continue;
      if (!channelToEvents.has(channel)) channelToEvents.set(channel, new Set<string>());
      channelToEvents.get(channel)?.add(row.event_type);
    }
  }

  const enabledChannelsWithoutTemplate: NotificationIntegrityCoverageGaps["enabledChannelsWithoutTemplate"] = [];
  for (const [channel, events] of channelToEvents.entries()) {
    const missingEvents: string[] = [];
    for (const eventType of events.values()) {
      const resolved = resolveNotificationTemplate({
        templates: input.templateRows,
        tenantId: input.tenantId,
        eventType,
        channel,
        locale: input.defaultLocale || "zh-TW",
        defaultLocale: input.defaultLocale || "zh-TW",
      });
      if (!resolved.found) missingEvents.push(eventType);
    }
    if (missingEvents.length > 0) {
      enabledChannelsWithoutTemplate.push({
        channel,
        eventTypes: sortStrings(missingEvents),
      });
    }
  }

  return {
    missingRoleEventPairs: missingRoleEventPairs.sort((a, b) => `${a.role}:${a.eventType}`.localeCompare(`${b.role}:${b.eventType}`)),
    missingTemplatePairs: missingTemplatePairs.sort((a, b) => `${a.eventType}:${a.channel}`.localeCompare(`${b.eventType}:${b.channel}`)),
    enabledChannelsWithoutTemplate: enabledChannelsWithoutTemplate.sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}

export function computeTenantNotificationConfigIntegrity(input: CoverageInput): TenantNotificationConfigIntegrity {
  const requiredRoles = input.requiredRoles || MANAGER_EDITABLE_ROLE_KEYS;
  const requiredEvents = input.requiredEvents || NOTIFICATION_EVENT_KEYS;
  const requiredChannels = input.requiredChannels || NOTIFICATION_CHANNEL_KEYS;
  const gaps = computeNotificationCoverageGaps({
    ...input,
    requiredRoles,
    requiredEvents,
    requiredChannels,
  });

  const expectedRoleEventPairs = requiredRoles.length * requiredEvents.length;
  const expectedTemplatePairs = requiredEvents.length * requiredChannels.length;
  const configuredRoleEventPairs = Math.max(0, expectedRoleEventPairs - gaps.missingRoleEventPairs.length);
  const coveredTemplatePairs = Math.max(0, expectedTemplatePairs - gaps.missingTemplatePairs.length);
  const channelReadinessRate = 1 - safeRate(gaps.enabledChannelsWithoutTemplate.length, requiredChannels.length || 1);

  const roleRate = safeRate(configuredRoleEventPairs, expectedRoleEventPairs);
  const templateRate = safeRate(coveredTemplatePairs, expectedTemplatePairs);
  const score = clampPercent((roleRate * 0.45 + templateRate * 0.45 + channelReadinessRate * 0.1) * 100);

  const warnings: string[] = [];
  if (gaps.missingRoleEventPairs.length > 0) {
    warnings.push(`Missing role/event preferences: ${gaps.missingRoleEventPairs.length}`);
  }
  if (gaps.missingTemplatePairs.length > 0) {
    warnings.push(`Missing event/channel templates: ${gaps.missingTemplatePairs.length}`);
  }
  if (gaps.enabledChannelsWithoutTemplate.length > 0) {
    warnings.push(`Enabled channels without template fallback: ${gaps.enabledChannelsWithoutTemplate.length}`);
  }

  let healthStatus: TenantNotificationConfigIntegrity["healthStatus"] = "healthy";
  if (score < 70 || gaps.missingTemplatePairs.length > Math.floor(expectedTemplatePairs * 0.4)) {
    healthStatus = "critical";
  } else if (score < 90 || warnings.length > 0) {
    healthStatus = "degraded";
  }

  return {
    tenantId: input.tenantId,
    score,
    healthStatus,
    summary: {
      expectedRoleEventPairs,
      configuredRoleEventPairs,
      expectedTemplatePairs,
      coveredTemplatePairs,
      channelReadinessRate: clampPercent(channelReadinessRate * 100),
    },
    missingItems: gaps,
    warnings,
  };
}

export async function evaluateTenantNotificationConfigIntegrity(params: {
  tenantId: string;
  supabase?: SupabaseClient;
  defaultLocale?: string;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const [roleResult, templateResult] = await Promise.all([
    supabase
      .from("notification_role_preferences")
      .select("role, event_type, is_enabled, channels")
      .eq("tenant_id", params.tenantId)
      .limit(8000),
    supabase
      .from("notification_templates")
      .select(
        "id, tenant_id, event_type, channel, locale, title_template, message_template, email_subject, action_url, priority, channel_policy, is_active, version, updated_at",
      )
      .eq("is_active", true)
      .or(`tenant_id.is.null,tenant_id.eq.${params.tenantId}`)
      .limit(8000),
  ]);

  if (roleResult.error) return { ok: false as const, error: roleResult.error.message };
  if (templateResult.error) return { ok: false as const, error: templateResult.error.message };

  const integrity = computeTenantNotificationConfigIntegrity({
    tenantId: params.tenantId,
    rolePreferenceRows: (roleResult.data || []) as NotificationRolePreferenceIntegrityRow[],
    templateRows: (templateResult.data || []) as NotificationTemplateResolutionRow[],
    defaultLocale: params.defaultLocale || "zh-TW",
  });

  return {
    ok: true as const,
    integrity,
  };
}
