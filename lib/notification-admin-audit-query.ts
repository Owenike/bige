import { z } from "zod";
import { NOTIFICATION_ADMIN_AUDIT_ACTIONS, type NotificationAdminAuditScope } from "./notification-admin-audit";
import { uuidLikeSchema } from "./notification-productization";

export type NotificationAdminAuditQuery = {
  tenantId: string | null;
  action: (typeof NOTIFICATION_ADMIN_AUDIT_ACTIONS)[number] | null;
  resourceType: string | null;
  resourceId: string | null;
  actorUserId: string | null;
  scope: NotificationAdminAuditScope | null;
  createdFrom: string | null;
  createdTo: string | null;
  cursor: string | null;
  limit: number;
};

const auditScopeSchema = z.enum(["platform", "tenant"]);

function parseIsoDateOrNull(input: string | null) {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseOptionalUuid(input: string | null) {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  const parsed = uuidLikeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseNotificationAdminAuditQuery(params: URLSearchParams):
  | { ok: true; query: NotificationAdminAuditQuery }
  | { ok: false; error: string } {
  const actionRaw = (params.get("action") || "").trim();
  const actionParsed = actionRaw
    ? z.enum(NOTIFICATION_ADMIN_AUDIT_ACTIONS).safeParse(actionRaw)
    : ({ success: true, data: null } as const);
  if (!actionParsed.success) return { ok: false, error: "Invalid action filter" };

  const scopeRaw = (params.get("scope") || "").trim();
  const scopeParsed = scopeRaw
    ? auditScopeSchema.safeParse(scopeRaw)
    : ({ success: true, data: null } as const);
  if (!scopeParsed.success) return { ok: false, error: "Invalid scope filter" };

  const tenantId = parseOptionalUuid(params.get("tenantId"));
  if (params.get("tenantId") && !tenantId) return { ok: false, error: "Invalid tenantId" };
  const actorUserId = parseOptionalUuid(params.get("actorUserId"));
  if (params.get("actorUserId") && !actorUserId) return { ok: false, error: "Invalid actorUserId" };

  const createdFrom = parseIsoDateOrNull(params.get("from"));
  if (params.get("from") && !createdFrom) return { ok: false, error: "Invalid from timestamp" };
  const createdTo = parseIsoDateOrNull(params.get("to"));
  if (params.get("to") && !createdTo) return { ok: false, error: "Invalid to timestamp" };
  const cursor = parseIsoDateOrNull(params.get("cursor"));
  if (params.get("cursor") && !cursor) return { ok: false, error: "Invalid cursor timestamp" };

  const resourceTypeRaw = (params.get("resourceType") || "").trim();
  const resourceIdRaw = (params.get("resourceId") || "").trim();
  const limitRaw = Number(params.get("limit") || 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 100;

  if (createdFrom && createdTo && new Date(createdFrom).getTime() > new Date(createdTo).getTime()) {
    return { ok: false, error: "from must be before to" };
  }

  return {
    ok: true,
    query: {
      tenantId,
      action: actionParsed.data || null,
      resourceType: resourceTypeRaw || null,
      resourceId: resourceIdRaw || null,
      actorUserId,
      scope: scopeParsed.data || null,
      createdFrom,
      createdTo,
      cursor,
      limit,
    },
  };
}
