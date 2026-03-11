import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "./auth-context";
import { createSupabaseAdminClient } from "./supabase/admin";

export const NOTIFICATION_ADMIN_AUDIT_ACTIONS = [
  "preference_upsert",
  "template_upsert",
  "retry_dry_run",
  "retry_execute",
] as const;

export type NotificationAdminAuditAction = (typeof NOTIFICATION_ADMIN_AUDIT_ACTIONS)[number];

export type NotificationAdminAuditScope = "platform" | "tenant";

export type NotificationAdminAuditLogRow = {
  id: string;
  created_at: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_role: AppRole | null;
  scope: NotificationAdminAuditScope;
  action: NotificationAdminAuditAction;
  target_type: string;
  target_id: string | null;
  before_data: Record<string, unknown>;
  after_data: Record<string, unknown>;
  diff: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export function buildNotificationAdminDiff(params: {
  before: Record<string, unknown> | null | undefined;
  after: Record<string, unknown> | null | undefined;
}) {
  const before = params.before || {};
  const after = params.after || {};
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of keys) {
    const beforeValue = before[key];
    const afterValue = after[key];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    diff[key] = {
      before: beforeValue === undefined ? null : beforeValue,
      after: afterValue === undefined ? null : afterValue,
    };
  }
  return diff;
}

export async function writeNotificationAdminAudit(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  actorUserId?: string | null;
  actorRole?: AppRole | null;
  scope: NotificationAdminAuditScope;
  action: NotificationAdminAuditAction;
  targetType: string;
  targetId?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const beforeData = params.beforeData || {};
  const afterData = params.afterData || {};
  const diff = buildNotificationAdminDiff({
    before: beforeData,
    after: afterData,
  });
  const result = await supabase
    .from("notification_admin_audit_logs")
    .insert({
      tenant_id: params.tenantId || null,
      actor_user_id: params.actorUserId || null,
      actor_role: params.actorRole || null,
      scope: params.scope,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId || null,
      before_data: beforeData,
      after_data: afterData,
      diff,
      metadata: params.metadata || {},
    })
    .select("id, created_at, tenant_id, actor_user_id, actor_role, scope, action, target_type, target_id, before_data, after_data, diff, metadata")
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as NotificationAdminAuditLogRow | null };
  return {
    ok: true as const,
    item: (result.data || null) as NotificationAdminAuditLogRow | null,
  };
}

export async function writeNotificationAdminAuditNonBlocking(
  params: Parameters<typeof writeNotificationAdminAudit>[0] & {
    logContext?: string;
  },
) {
  const result = await writeNotificationAdminAudit(params);
  if (!result.ok) {
    console.warn("[notification-admin-audit][write-failed]", {
      context: params.logContext || "unknown",
      scope: params.scope,
      action: params.action,
      tenantId: params.tenantId || null,
      targetType: params.targetType,
      targetId: params.targetId || null,
      error: result.error,
    });
  }
  return result;
}

export async function listNotificationAdminAudits(params: {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  scope?: NotificationAdminAuditScope;
  action?: NotificationAdminAuditAction;
  targetType?: string | null;
  targetId?: string | null;
  actorUserId?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  cursor?: string | null;
  limit?: number;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  let query = supabase
    .from("notification_admin_audit_logs")
    .select("id, created_at, tenant_id, actor_user_id, actor_role, scope, action, target_type, target_id, before_data, after_data, diff, metadata")
    .order("created_at", { ascending: false })
    .limit(Math.min(500, Math.max(1, Number(params.limit || 100))));
  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  if (params.scope) query = query.eq("scope", params.scope);
  if (params.action) query = query.eq("action", params.action);
  if (params.targetType) query = query.eq("target_type", params.targetType);
  if (params.targetId) query = query.eq("target_id", params.targetId);
  if (params.actorUserId) query = query.eq("actor_user_id", params.actorUserId);
  if (params.createdFrom) query = query.gte("created_at", params.createdFrom);
  if (params.createdTo) query = query.lte("created_at", params.createdTo);
  if (params.cursor) query = query.lt("created_at", params.cursor);
  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message, items: [] as NotificationAdminAuditLogRow[] };
  return {
    ok: true as const,
    items: (result.data || []) as NotificationAdminAuditLogRow[],
  };
}

export function summarizeNotificationAdminAuditMetadata(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata || {};
  const blocked = Array.isArray((value as { blocked?: unknown }).blocked)
    ? ((value as { blocked?: Array<{ code?: string }> }).blocked || []).map((item) => String(item?.code || "UNKNOWN"))
    : [];
  return {
    keys: Object.keys(value).slice(0, 20),
    blockedCodes: blocked.slice(0, 20),
    blockedCount: blocked.length,
  };
}
