import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import {
  getRolePreferenceDetail,
  getUserPreferenceDetail,
  listRolePreferences,
  listUserPreferences,
  upsertRolePreference,
  upsertUserPreference,
  type NotificationPreferenceScope,
} from "../../../../../lib/notification-preferences";
import {
  channelPreferencesSchema,
  managerEditableRoleSchema,
  notificationEventKeySchema,
  notificationPreferenceModeSchema,
  notificationPreferenceScopeSchema,
  isManagerTenantScopeAllowed,
  normalizeChannels,
  parseBooleanQuery,
  uuidLikeSchema,
} from "../../../../../lib/notification-productization";
import { parseRoleQueryValue } from "../../../../../lib/notification-productization-contracts";
import { writeNotificationAdminAuditNonBlocking } from "../../../../../lib/notification-admin-audit";
import { z } from "zod";

function parseScope(input: unknown): NotificationPreferenceScope {
  if (input === "tenant_default" || input === "custom") return input;
  return "custom";
}

const managerPreferencesGetQuerySchema = z.object({
  eventType: notificationEventKeySchema.optional(),
  role: managerEditableRoleSchema.optional(),
  userId: uuidLikeSchema.optional(),
  mode: notificationPreferenceModeSchema.optional(),
  detail: z.boolean().optional(),
});

const managerPreferencesPutBodySchema = z.object({
  tenantId: uuidLikeSchema.optional(),
  mode: notificationPreferenceModeSchema.default("role"),
  eventType: notificationEventKeySchema,
  role: managerEditableRoleSchema.optional(),
  userId: uuidLikeSchema.optional(),
  channels: channelPreferencesSchema.default({}),
  isEnabled: z.boolean().optional(),
  source: notificationPreferenceScopeSchema.optional(),
  note: z.string().max(1000).nullable().optional(),
});

function toAuditPreferenceSnapshot(item: Record<string, unknown> | null) {
  if (!item) return {};
  return {
    id: item.id || null,
    tenantId: item.tenant_id || null,
    userId: item.user_id || null,
    role: item.role || null,
    eventType: item.event_type || null,
    channels: item.channels || {},
    isEnabled: item.is_enabled !== false,
    source: item.source || null,
    note: item.note || null,
    updatedAt: item.updated_at || null,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "reports.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const parsed = managerPreferencesGetQuerySchema.safeParse({
    eventType: params.get("eventType") || undefined,
    role: parseRoleQueryValue(params.get("role"), { includePlatformAdmin: false, managerEditableOnly: true }) || undefined,
    userId: params.get("userId") || undefined,
    mode: params.get("mode") || undefined,
    detail: parseBooleanQuery(params.get("detail"), false),
  });
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid query");
  const { eventType, role, userId, mode, detail } = parsed.data;

  if (detail) {
    if (mode === "user") {
      if (!userId || !eventType) return apiError(400, "FORBIDDEN", "userId and eventType are required in detail mode");
      const single = await getUserPreferenceDetail({
        tenantId: auth.context.tenantId,
        userId,
        eventType,
      });
      if (!single.ok) return apiError(500, "INTERNAL_ERROR", single.error);
      return apiSuccess({
        tenantId: auth.context.tenantId,
        mode: "user",
        item: single.item,
      });
    }
    if (!role || !eventType) return apiError(400, "FORBIDDEN", "role and eventType are required in detail mode");
    const single = await getRolePreferenceDetail({
      tenantId: auth.context.tenantId,
      role,
      eventType,
    });
    if (!single.ok) return apiError(500, "INTERNAL_ERROR", single.error);
    return apiSuccess({
      tenantId: auth.context.tenantId,
      mode: "role",
      item: single.item,
    });
  }

  const [roles, users] = await Promise.all([
    listRolePreferences({ tenantId: auth.context.tenantId, eventType, role }),
    listUserPreferences({ tenantId: auth.context.tenantId, userId, eventType }),
  ]);
  if (!roles.ok) return apiError(500, "INTERNAL_ERROR", roles.error);
  if (!users.ok) return apiError(500, "INTERNAL_ERROR", users.error);

  return apiSuccess({
    tenantId: auth.context.tenantId,
    rolePreferences: roles.items,
    userPreferences: users.items,
  });
}

export async function PUT(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "crm.assign");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const parsed = managerPreferencesPutBodySchema.safeParse(body);
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid payload");
  const { mode, eventType, userId, role, channels, isEnabled, source, note, tenantId } = parsed.data;

  if (!isManagerTenantScopeAllowed(auth.context.tenantId, tenantId || null)) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "tenantId mismatch");
  }

  if (mode === "user") {
    if (!userId) return apiError(400, "FORBIDDEN", "userId is required for user preference");
    const before = await getUserPreferenceDetail({
      tenantId: auth.context.tenantId,
      userId,
      eventType,
    });
    if (!before.ok) {
      console.warn("[notifications/preferences][audit-before-read-failed]", {
        scope: "tenant",
        mode: "user",
        tenantId: auth.context.tenantId,
        userId,
        eventType,
        error: before.error,
      });
    }
    const write = await upsertUserPreference({
      tenantId: auth.context.tenantId,
      userId,
      eventType,
      channels: normalizeChannels(channels),
      isEnabled: isEnabled !== false,
      note: note || null,
      actorId: auth.context.userId,
    });
    if (!write.ok) return apiError(500, "INTERNAL_ERROR", write.error);

    await writeNotificationAdminAuditNonBlocking({
      scope: "tenant",
      action: "preference_upsert",
      tenantId: auth.context.tenantId,
      actorUserId: auth.context.userId,
      actorRole: auth.context.role,
      targetType: "notification_preference_user",
      targetId: write.item?.id || null,
      beforeData: toAuditPreferenceSnapshot(before.ok ? (before.item as unknown as Record<string, unknown> | null) : null),
      afterData: toAuditPreferenceSnapshot(write.item as unknown as Record<string, unknown> | null),
      metadata: {
        mode: "user",
        eventType,
        userId,
      },
      logContext: "manager/preferences:put:user",
    });
    return apiSuccess({ mode, item: write.item });
  }

  if (!role) return apiError(400, "INVALID_ROLE", "Invalid role");
  const before = await getRolePreferenceDetail({
    tenantId: auth.context.tenantId,
    role,
    eventType,
  });
  if (!before.ok) {
    console.warn("[notifications/preferences][audit-before-read-failed]", {
      scope: "tenant",
      mode: "role",
      tenantId: auth.context.tenantId,
      role,
      eventType,
      error: before.error,
    });
  }

  const write = await upsertRolePreference({
    tenantId: auth.context.tenantId,
    role,
    eventType,
    channels: normalizeChannels(channels),
    isEnabled: isEnabled !== false,
    source: parseScope(source),
    note: note || null,
    actorId: auth.context.userId,
  });
  if (!write.ok) return apiError(500, "INTERNAL_ERROR", write.error);

  await writeNotificationAdminAuditNonBlocking({
    scope: "tenant",
    action: "preference_upsert",
    tenantId: auth.context.tenantId,
    actorUserId: auth.context.userId,
    actorRole: auth.context.role,
    targetType: "notification_preference_role",
    targetId: write.item?.id || `${auth.context.tenantId}:${role}:${eventType}`,
    beforeData: toAuditPreferenceSnapshot(before.ok ? (before.item as unknown as Record<string, unknown> | null) : null),
    afterData: toAuditPreferenceSnapshot(write.item as unknown as Record<string, unknown> | null),
    metadata: {
      mode: "role",
      eventType,
      role,
      source: parseScope(source),
    },
    logContext: "manager/preferences:put:role",
  });
  return apiSuccess({ mode: "role", item: write.item });
}
