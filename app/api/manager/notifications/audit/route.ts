import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { listNotificationAdminAudits, summarizeNotificationAdminAuditMetadata } from "../../../../../lib/notification-admin-audit";
import { parseNotificationAdminAuditQuery } from "../../../../../lib/notification-admin-audit-query";
import { isManagerTenantScopeAllowed } from "../../../../../lib/notification-productization";
import { requirePermission } from "../../../../../lib/permissions";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");
  const permission = requirePermission(auth.context, "audit.read");
  if (!permission.ok) return permission.response;

  const parsed = parseNotificationAdminAuditQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return apiError(400, "FORBIDDEN", parsed.error);
  if (!isManagerTenantScopeAllowed(auth.context.tenantId, parsed.query.tenantId)) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "tenantId mismatch");
  }
  if (parsed.query.scope && parsed.query.scope !== "tenant") {
    return apiError(403, "FORBIDDEN", "Manager scope only supports tenant");
  }

  const list = await listNotificationAdminAudits({
    tenantId: auth.context.tenantId,
    scope: "tenant",
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
    scope: "tenant",
    tenantId: auth.context.tenantId,
    items,
    nextCursor: items.length > 0 ? items[items.length - 1]?.createdAt || null : null,
    filters: {
      ...parsed.query,
      tenantId: auth.context.tenantId,
      scope: "tenant",
    },
  });
}
