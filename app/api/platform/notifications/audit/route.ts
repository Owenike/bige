import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { listNotificationAdminAudits, summarizeNotificationAdminAuditMetadata } from "../../../../../lib/notification-admin-audit";
import { parseNotificationAdminAuditQuery } from "../../../../../lib/notification-admin-audit-query";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const parsed = parseNotificationAdminAuditQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);

  const list = await listNotificationAdminAudits({
    tenantId: parsed.query.tenantId,
    scope: parsed.query.scope || undefined,
    action: parsed.query.action || undefined,
    targetType: parsed.query.resourceType || undefined,
    targetId: parsed.query.resourceId || undefined,
    actorUserId: parsed.query.actorUserId || undefined,
    createdFrom: parsed.query.createdFrom || undefined,
    createdTo: parsed.query.createdTo || undefined,
    cursor: parsed.query.cursor || undefined,
    limit: parsed.query.limit,
  });
  if (!list.ok) return apiError(500, "INTERNAL_ERROR", list.error);

  const items = list.items.map((item) => ({
    id: item.id,
    action: item.action,
    actor: {
      userId: item.actor_user_id,
      role: item.actor_role,
    },
    tenantId: item.tenant_id,
    scope: item.scope,
    resourceType: item.target_type,
    resourceId: item.target_id,
    createdAt: item.created_at,
    metadataSummary: summarizeNotificationAdminAuditMetadata(item.metadata),
  }));

  return apiSuccess({
    scope: "platform",
    tenantId: parsed.query.tenantId || null,
    items,
    nextCursor: items.length > 0 ? items[items.length - 1]?.createdAt || null : null,
    filters: parsed.query,
  });
}
