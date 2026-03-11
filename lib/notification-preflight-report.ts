import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import { getRolePreferenceDetail, getUserPreferenceDetail } from "./notification-preferences";
import { listNotificationTemplates } from "./notification-templates";
import { resolveNotificationPreference } from "./notification-preference-resolution-service";
import { resolveNotificationTemplate } from "./notification-template-resolution-service";
import { buildNotificationDeliveryPlanningDraft } from "./notification-delivery-planning-draft-service";
import { evaluateTenantNotificationConfigIntegrity } from "./notification-config-integrity";
import { DEFAULT_CHANNEL_PREFERENCES, type NotificationChannel } from "./notification-preferences";
import type { NotificationChannelKey, NotificationEventKey, NotificationRoleKey } from "./notification-productization";

type PreflightRecipient = {
  userId: string;
  role: string | null;
};

export type NotificationPreflightReport = {
  scope: "tenant";
  tenantId: string;
  input: {
    eventKey: NotificationEventKey;
    roleKey: NotificationRoleKey | null;
    userId: string | null;
    channelHint: NotificationChannelKey | null;
    locale: string;
    defaultLocale: string;
    recipientLimit: number;
  };
  preference: ReturnType<typeof resolveNotificationPreference>;
  templates: {
    channelsEvaluated: NotificationChannelKey[];
    resolutions: Array<{
      channel: NotificationChannelKey;
      found: boolean;
      source: "tenant" | "global" | "none";
      strategy: string;
      templateId: string | null;
      locale: string | null;
      priority: string | null;
      missingReason: string | null;
    }>;
  };
  deliveryPlanning: {
    ready: boolean;
    plannedChannels: NotificationChannelKey[];
    plannedRecipientsCount: number;
    plannedRecipientsPreview: PreflightRecipient[];
    skippedReasons: Array<{ code: string; message: string }>;
    contentSkeleton: Record<string, unknown>;
  };
  coverage: {
    integrityScore: number;
    integrityHealthStatus: string;
    missingRoleEventPairs: number;
    missingTemplatePairs: number;
    enabledChannelsWithoutTemplate: number;
    missingForSelectedEvent: Array<{ channel: NotificationChannelKey; reason: string }>;
  };
  warnings: string[];
};

function normalizeLocale(input: string | null | undefined) {
  const value = String(input || "").trim();
  return value || "zh-TW";
}

function normalizeChannelsFromPreference(channels: Record<string, boolean>) {
  return (Object.keys(channels) as NotificationChannelKey[]).filter((channel) => channels[channel]);
}

async function loadRecipients(params: {
  supabase: SupabaseClient;
  tenantId: string;
  roleKey: NotificationRoleKey | null;
  userId: string | null;
  recipientLimit: number;
}) {
  if (params.userId) {
    const result = await params.supabase
      .from("profiles")
      .select("id, role")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (result.error) return { ok: false as const, error: result.error.message, items: [] as PreflightRecipient[] };
    if (!result.data) return { ok: true as const, items: [] as PreflightRecipient[] };
    return {
      ok: true as const,
      items: [
        {
          userId: result.data.id as string,
          role: (result.data.role as string) || null,
        },
      ] as PreflightRecipient[],
    };
  }

  if (!params.roleKey) {
    return { ok: true as const, items: [] as PreflightRecipient[] };
  }

  const result = await params.supabase
    .from("profiles")
    .select("id, role")
    .eq("tenant_id", params.tenantId)
    .eq("role", params.roleKey)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, params.recipientLimit)));
  if (result.error) return { ok: false as const, error: result.error.message, items: [] as PreflightRecipient[] };
  return {
    ok: true as const,
    items: (result.data || []).map((item) => ({
      userId: item.id as string,
      role: (item.role as string) || null,
    })),
  };
}

function mapRoleRowToPreferenceRule(params: {
  roleRow:
    | {
        source: "platform_default" | "tenant_default" | "custom";
        is_enabled: boolean;
        channels: Record<string, boolean>;
        note: string | null;
      }
    | null;
}) {
  if (!params.roleRow) return {};
  if (params.roleRow.source === "platform_default") {
    return {
      platformDefault: {
        enabled: params.roleRow.is_enabled !== false,
        channels: params.roleRow.channels,
        reason: params.roleRow.note,
      },
    };
  }
  if (params.roleRow.source === "tenant_default") {
    return {
      tenantDefault: {
        enabled: params.roleRow.is_enabled !== false,
        channels: params.roleRow.channels,
        reason: params.roleRow.note,
      },
    };
  }
  return {
    rolePreference: {
      enabled: params.roleRow.is_enabled !== false,
      channels: params.roleRow.channels,
      reason: params.roleRow.note,
    },
  };
}

export async function buildNotificationPreflightReport(params: {
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
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const locale = normalizeLocale(params.locale);
  const defaultLocale = normalizeLocale(params.defaultLocale || "zh-TW");
  const recipientLimit = Math.min(100, Math.max(1, Number(params.recipientLimit || 20)));

  const rolePreferenceResult = params.roleKey
    ? await getRolePreferenceDetail({
        tenantId: params.tenantId,
        role: params.roleKey,
        eventType: params.eventKey,
      })
    : ({ ok: true as const, item: null });
  if (!rolePreferenceResult.ok) return { ok: false as const, error: rolePreferenceResult.error };

  const userPreferenceResult = params.userId
    ? await getUserPreferenceDetail({
        tenantId: params.tenantId,
        userId: params.userId,
        eventType: params.eventKey,
      })
    : ({ ok: true as const, item: null });
  if (!userPreferenceResult.ok) return { ok: false as const, error: userPreferenceResult.error };

  const roleRule = mapRoleRowToPreferenceRule({
    roleRow: rolePreferenceResult.item
      ? {
          source: rolePreferenceResult.item.source,
          is_enabled: rolePreferenceResult.item.is_enabled,
          channels: rolePreferenceResult.item.channels,
          note: rolePreferenceResult.item.note,
        }
      : null,
  });

  const preference = resolveNotificationPreference({
    platformDefault: {
      enabled: true,
      channels: DEFAULT_CHANNEL_PREFERENCES,
      reason: "system baseline",
    },
    ...roleRule,
    userPreference: userPreferenceResult.item
      ? {
          enabled: userPreferenceResult.item.is_enabled !== false,
          channels: userPreferenceResult.item.channels,
          reason: userPreferenceResult.item.note,
        }
      : null,
  });

  const templateRowsResult = await listNotificationTemplates({
    tenantId: params.tenantId,
    includeGlobal: true,
    eventType: params.eventKey,
    activeOnly: true,
  });
  if (!templateRowsResult.ok) return { ok: false as const, error: templateRowsResult.error };

  const templateRows = templateRowsResult.items.map((item) => ({
    id: item.id,
    tenant_id: item.tenant_id,
    event_type: item.event_type,
    channel: item.channel,
    locale: item.locale,
    title_template: item.title_template,
    message_template: item.message_template,
    email_subject: item.email_subject,
    action_url: item.action_url,
    priority: item.priority,
    channel_policy: item.channel_policy || {},
    is_active: item.is_active,
    version: item.version,
    updated_at: item.updated_at,
  }));

  const resolvedChannels = normalizeChannelsFromPreference(preference.channels);
  const channelsToEvaluate = (
    params.channelHint
      ? [params.channelHint]
      : resolvedChannels.length > 0
        ? resolvedChannels
        : (["in_app"] as NotificationChannelKey[])
  ).filter((value, index, array) => array.indexOf(value) === index);

  const templateResolutionsByChannel = Object.fromEntries(
    channelsToEvaluate.map((channel) => [
      channel,
      resolveNotificationTemplate({
        templates: templateRows,
        tenantId: params.tenantId,
        eventType: params.eventKey,
        channel,
        locale,
        defaultLocale,
      }),
    ]),
  ) as Record<NotificationChannelKey, ReturnType<typeof resolveNotificationTemplate>>;

  const recipientsResult = await loadRecipients({
    supabase,
    tenantId: params.tenantId,
    roleKey: params.roleKey,
    userId: params.userId,
    recipientLimit,
  });
  if (!recipientsResult.ok) return { ok: false as const, error: recipientsResult.error };

  const planningDraft = buildNotificationDeliveryPlanningDraft({
    eventKey: params.eventKey,
    tenantId: params.tenantId,
    targetHints: {
      roleKeys: params.roleKey ? [params.roleKey] : [],
      userIds: params.userId ? [params.userId] : [],
    },
    recipients: recipientsResult.items,
    preferenceResolution: preference,
    templateResolutionsByChannel,
  });

  const integrityResult = await evaluateTenantNotificationConfigIntegrity({
    tenantId: params.tenantId,
    supabase,
    defaultLocale,
  });
  if (!integrityResult.ok) return { ok: false as const, error: integrityResult.error };

  const templateResolutionList = channelsToEvaluate.map((channel) => {
    const resolved = templateResolutionsByChannel[channel];
    return {
      channel,
      found: resolved.found,
      source: resolved.source,
      strategy: resolved.strategy,
      templateId: resolved.template?.id || null,
      locale: resolved.template?.locale || null,
      priority: resolved.template?.priority || null,
      missingReason: resolved.missingReason || null,
    };
  });
  const missingForSelectedEvent = templateResolutionList
    .filter((item) => !item.found)
    .map((item) => ({
      channel: item.channel,
      reason: item.missingReason || "Template missing",
    }));

  const warnings: string[] = [];
  if (planningDraft.ready === false) warnings.push("Planning draft is not ready for runtime delivery.");
  if (recipientsResult.items.length === 0) warnings.push("No recipients resolved from current role/user filters.");
  if (integrityResult.integrity.healthStatus !== "healthy") {
    warnings.push(`Tenant config integrity is ${integrityResult.integrity.healthStatus}.`);
  }
  if (params.channelHint && !templateResolutionsByChannel[params.channelHint]?.found) {
    warnings.push(`Channel hint ${params.channelHint} has no resolved template.`);
  }
  for (const warning of integrityResult.integrity.warnings.slice(0, 5)) warnings.push(warning);

  const report: NotificationPreflightReport = {
    scope: "tenant",
    tenantId: params.tenantId,
    input: {
      eventKey: params.eventKey,
      roleKey: params.roleKey,
      userId: params.userId,
      channelHint: params.channelHint,
      locale,
      defaultLocale,
      recipientLimit,
    },
    preference,
    templates: {
      channelsEvaluated: channelsToEvaluate,
      resolutions: templateResolutionList,
    },
    deliveryPlanning: {
      ready: planningDraft.ready,
      plannedChannels: planningDraft.plannedChannels,
      plannedRecipientsCount: planningDraft.plannedRecipients.length,
      plannedRecipientsPreview: planningDraft.plannedRecipients.slice(0, 20).map((item) => ({
        userId: item.userId,
        role: item.role || null,
      })),
      skippedReasons: planningDraft.skippedReasons,
      contentSkeleton: planningDraft.plannedContentSkeleton.byChannel as unknown as Record<string, unknown>,
    },
    coverage: {
      integrityScore: integrityResult.integrity.score,
      integrityHealthStatus: integrityResult.integrity.healthStatus,
      missingRoleEventPairs: integrityResult.integrity.missingItems.missingRoleEventPairs.length,
      missingTemplatePairs: integrityResult.integrity.missingItems.missingTemplatePairs.length,
      enabledChannelsWithoutTemplate: integrityResult.integrity.missingItems.enabledChannelsWithoutTemplate.length,
      missingForSelectedEvent,
    },
    warnings: warnings.filter((value, index, array) => array.indexOf(value) === index),
  };

  return {
    ok: true as const,
    report,
  };
}
