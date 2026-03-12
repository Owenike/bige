import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import {
  resolveJobSettings,
  upsertTenantDeliveryChannelSetting,
  upsertTenantJobSetting,
  upsertTenantNotificationSetting,
} from "../../../../../lib/job-settings-resolver";
import { requirePermission } from "../../../../../lib/permissions";
import { channelPreferencesSchema, uuidLikeSchema } from "../../../../../lib/notification-productization";

const jobTypeSchema = z.enum(["notification_sweep", "opportunity_sweep", "delivery_dispatch", "reminder_bundle"]);
const deliveryChannelSchema = z.enum(["email", "line", "sms", "webhook"]);

const querySchema = z.object({
  tenantId: uuidLikeSchema,
  branchId: uuidLikeSchema.optional(),
});

const upsertJobBodySchema = z.object({
  action: z.literal("upsert_job"),
  tenantId: uuidLikeSchema,
  branchId: uuidLikeSchema.optional().nullable(),
  jobType: jobTypeSchema,
  enabled: z.boolean(),
  windowMinutes: z.number().int().min(5).max(1440),
  maxBatchSize: z.number().int().min(1).max(5000),
  note: z.string().trim().max(1000).optional().nullable(),
});

const upsertNotificationBodySchema = z.object({
  action: z.literal("upsert_notification"),
  tenantId: uuidLikeSchema,
  branchId: uuidLikeSchema.optional().nullable(),
  jobType: jobTypeSchema,
  isEnabled: z.boolean(),
  channels: channelPreferencesSchema.default({}),
  quietHoursStart: z.number().int().min(0).max(23).optional().nullable(),
  quietHoursEnd: z.number().int().min(0).max(23).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

const upsertDeliveryBodySchema = z.object({
  action: z.literal("upsert_delivery_channel"),
  tenantId: uuidLikeSchema,
  branchId: uuidLikeSchema.optional().nullable(),
  channel: deliveryChannelSchema,
  isEnabled: z.boolean(),
  provider: z.string().trim().max(120).optional().nullable(),
  rateLimitPerMinute: z.number().int().min(1).max(10000).optional().nullable(),
  timeoutMs: z.number().int().min(100).max(600000).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

const putBodySchema = z.discriminatedUnion("action", [
  upsertJobBodySchema,
  upsertNotificationBodySchema,
  upsertDeliveryBodySchema,
]);

function buildDiffSummary(before: Record<string, unknown>, after: Record<string, unknown>) {
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changed: Array<{ key: string; before: unknown; after: unknown }> = [];
  for (const key of keys) {
    const left = before[key] === undefined ? null : before[key];
    const right = after[key] === undefined ? null : after[key];
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    changed.push({ key, before: left, after: right });
  }
  return {
    changedCount: changed.length,
    changedKeys: changed.map((item) => item.key),
    changed: changed.slice(0, 25),
  };
}

async function writeSettingsAuditNonBlocking(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  branchId: string | null;
}) {
  const diffSummary = buildDiffSummary(params.beforeData, params.afterData);
  try {
    await params.supabase.from("audit_logs").insert({
      tenant_id: params.tenantId,
      actor_id: params.actorId,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId,
      reason: "phase3_job_settings_update",
      payload: {
        branchId: params.branchId,
        before: params.beforeData,
        after: params.afterData,
        diffSummary,
      },
    });
  } catch (error: unknown) {
    console.warn("[platform/jobs/settings][audit-write-failed]", {
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      tenantId: params.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    tenantId: params.get("tenantId"),
    branchId: params.get("branchId") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");

  const resolved = await resolveJobSettings({
    tenantId: parsed.data.tenantId,
    branchId: parsed.data.branchId || null,
  });
  if (!resolved.ok) return apiError(500, "INTERNAL_ERROR", resolved.error);

  return apiSuccess({
    ...resolved.data,
  });
}

export async function PUT(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const permission = requirePermission(auth.context, "jobs.settings.write");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const parsed = putBodySchema.safeParse(body || {});
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid payload");

  if (parsed.data.action === "upsert_job") {
    const write = await upsertTenantJobSetting({
      tenantId: parsed.data.tenantId,
      branchId: parsed.data.branchId || null,
      jobType: parsed.data.jobType,
      enabled: parsed.data.enabled,
      windowMinutes: parsed.data.windowMinutes,
      maxBatchSize: parsed.data.maxBatchSize,
      note: parsed.data.note || null,
      actorId: auth.context.userId,
    });
    if (!write.ok) return apiError(500, "INTERNAL_ERROR", write.error);

    await writeSettingsAuditNonBlocking({
      supabase: auth.supabase,
      tenantId: parsed.data.tenantId,
      actorId: auth.context.userId,
      action: "job_setting_updated",
      targetType: "tenant_job_setting",
      targetId: write.item?.id || `${parsed.data.tenantId}:${parsed.data.branchId || "tenant"}:${parsed.data.jobType}`,
      beforeData: write.before || {},
      afterData: write.item || {},
      branchId: parsed.data.branchId || null,
    });

    const resolved = await resolveJobSettings({
      tenantId: parsed.data.tenantId,
      branchId: parsed.data.branchId || null,
    });
    if (!resolved.ok) return apiError(500, "INTERNAL_ERROR", resolved.error);
    return apiSuccess({ item: write.item, resolved: resolved.data });
  }

  if (parsed.data.action === "upsert_notification") {
    const write = await upsertTenantNotificationSetting({
      tenantId: parsed.data.tenantId,
      branchId: parsed.data.branchId || null,
      jobType: parsed.data.jobType,
      isEnabled: parsed.data.isEnabled,
      channels: parsed.data.channels,
      quietHoursStart: parsed.data.quietHoursStart ?? null,
      quietHoursEnd: parsed.data.quietHoursEnd ?? null,
      note: parsed.data.note || null,
      actorId: auth.context.userId,
    });
    if (!write.ok) return apiError(500, "INTERNAL_ERROR", write.error);

    await writeSettingsAuditNonBlocking({
      supabase: auth.supabase,
      tenantId: parsed.data.tenantId,
      actorId: auth.context.userId,
      action: "job_notification_setting_updated",
      targetType: "tenant_notification_setting",
      targetId: write.item?.id || `${parsed.data.tenantId}:${parsed.data.branchId || "tenant"}:${parsed.data.jobType}`,
      beforeData: write.before || {},
      afterData: write.item || {},
      branchId: parsed.data.branchId || null,
    });

    const resolved = await resolveJobSettings({
      tenantId: parsed.data.tenantId,
      branchId: parsed.data.branchId || null,
    });
    if (!resolved.ok) return apiError(500, "INTERNAL_ERROR", resolved.error);
    return apiSuccess({ item: write.item, resolved: resolved.data });
  }

  const write = await upsertTenantDeliveryChannelSetting({
    tenantId: parsed.data.tenantId,
    branchId: parsed.data.branchId || null,
    channel: parsed.data.channel,
    isEnabled: parsed.data.isEnabled,
    provider: parsed.data.provider || null,
    rateLimitPerMinute: parsed.data.rateLimitPerMinute ?? null,
    timeoutMs: parsed.data.timeoutMs ?? null,
    note: parsed.data.note || null,
    actorId: auth.context.userId,
  });
  if (!write.ok) return apiError(500, "INTERNAL_ERROR", write.error);

  await writeSettingsAuditNonBlocking({
    supabase: auth.supabase,
    tenantId: parsed.data.tenantId,
    actorId: auth.context.userId,
    action: "job_delivery_channel_setting_updated",
    targetType: "tenant_delivery_channel_setting",
    targetId: write.item?.id || `${parsed.data.tenantId}:${parsed.data.branchId || "tenant"}:${parsed.data.channel}`,
    beforeData: write.before || {},
    afterData: write.item || {},
    branchId: parsed.data.branchId || null,
  });

  const resolved = await resolveJobSettings({
    tenantId: parsed.data.tenantId,
    branchId: parsed.data.branchId || null,
  });
  if (!resolved.ok) return apiError(500, "INTERNAL_ERROR", resolved.error);
  return apiSuccess({ item: write.item, resolved: resolved.data });
}
