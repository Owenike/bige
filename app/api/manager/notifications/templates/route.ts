import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import { getNotificationTemplateDetail, listNotificationTemplates, upsertNotificationTemplate } from "../../../../../lib/notification-templates";
import type { NotificationChannel } from "../../../../../lib/notification-preferences";
import {
  buildTemplateKey,
  isManagerTenantScopeAllowed,
  notificationChannelSchema,
  notificationEventKeySchema,
  notificationPrioritySchema,
  parseBooleanQuery,
  templateChannelPolicySchema,
  uuidLikeSchema,
} from "../../../../../lib/notification-productization";
import { z } from "zod";

function parseChannel(input: unknown): NotificationChannel | null {
  if (input === "in_app" || input === "email" || input === "line" || input === "sms" || input === "webhook") {
    return input;
  }
  return null;
}

const managerTemplatesGetQuerySchema = z.object({
  eventType: notificationEventKeySchema.optional(),
  channel: notificationChannelSchema.optional(),
  includeGlobal: z.boolean().optional(),
  activeOnly: z.boolean().optional(),
  detail: z.boolean().optional(),
  locale: z.string().trim().min(2).max(10).optional(),
  id: uuidLikeSchema.optional(),
});

const managerTemplatesPutBodySchema = z.object({
  id: uuidLikeSchema.optional(),
  tenantId: uuidLikeSchema.optional(),
  eventType: notificationEventKeySchema,
  channel: notificationChannelSchema,
  locale: z.string().trim().min(2).max(10).optional(),
  titleTemplate: z.string().trim().min(1).max(200),
  messageTemplate: z.string().trim().min(1).max(2000),
  emailSubject: z.string().trim().max(200).nullable().optional(),
  actionUrl: z.string().trim().max(500).nullable().optional(),
  priority: notificationPrioritySchema.optional(),
  channelPolicy: templateChannelPolicySchema.optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().min(1).max(1000).optional(),
  templateKey: z.string().trim().min(1).max(500).optional(),
});

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "reports.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = managerTemplatesGetQuerySchema.safeParse({
    eventType: params.get("eventType") || undefined,
    channel: parseChannel(params.get("channel")) || undefined,
    includeGlobal: parseBooleanQuery(params.get("includeGlobal"), true),
    activeOnly: parseBooleanQuery(params.get("activeOnly"), true),
    detail: parseBooleanQuery(params.get("detail"), false),
    locale: params.get("locale") || undefined,
    id: params.get("id") || undefined,
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");
  const { eventType, channel, includeGlobal, activeOnly, detail, locale, id } = parsed.data;

  if (detail) {
    if (!eventType || !channel) return apiError(400, "FORBIDDEN", "eventType and channel are required in detail mode");
    const single = await getNotificationTemplateDetail({
      id,
      tenantId: auth.context.tenantId,
      eventType,
      channel,
      locale: locale || "zh-TW",
    });
    if (!single.ok) return apiError(500, "INTERNAL_ERROR", single.error);
    return apiSuccess({
      tenantId: auth.context.tenantId,
      includeGlobal,
      item: single.item,
    });
  }

  const templates = await listNotificationTemplates({
    tenantId: auth.context.tenantId,
    includeGlobal,
    eventType,
    channel,
    activeOnly,
  });
  if (!templates.ok) return apiError(500, "INTERNAL_ERROR", templates.error);

  return apiSuccess({
    tenantId: auth.context.tenantId,
    includeGlobal,
    items: templates.items,
  });
}

export async function PUT(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "crm.assign");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const parsed = managerTemplatesPutBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid payload");
  }
  const {
    id,
    tenantId,
    eventType,
    channel,
    locale,
    titleTemplate,
    messageTemplate,
    emailSubject,
    actionUrl,
    priority,
    channelPolicy,
    isActive,
    version,
    templateKey,
  } = parsed.data;

  if (!isManagerTenantScopeAllowed(auth.context.tenantId, tenantId || null)) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "tenantId mismatch");
  }
  const safeTemplateKey = buildTemplateKey({
    tenantId: auth.context.tenantId,
    eventType,
    channel,
    locale: locale || "zh-TW",
  });
  if (templateKey && templateKey !== safeTemplateKey) {
    return apiError(400, "FORBIDDEN", `templateKey mismatch; expected ${safeTemplateKey}`);
  }

  const write = await upsertNotificationTemplate({
    id: id || null,
    tenantId: auth.context.tenantId,
    eventType,
    channel,
    locale: locale || undefined,
    titleTemplate,
    messageTemplate,
    emailSubject: emailSubject || null,
    actionUrl: actionUrl || null,
    priority,
    channelPolicy,
    isActive: isActive !== false,
    version,
    actorId: auth.context.userId,
  });
  if (!write.ok) return apiError(500, "INTERNAL_ERROR", write.error);

  return apiSuccess({
    tenantId: auth.context.tenantId,
    item: write.item,
  });
}
