import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import {
  appendOpportunityLog,
  buildOpportunityContextMaps,
  canReadOpportunity,
  listOpportunityLogs,
  mapOpportunityRow,
  parseOpportunityPriority,
  parseOpportunityStatus,
  type OpportunityRow,
} from "../../../../../lib/opportunities";
import { createInAppNotifications } from "../../../../../lib/in-app-notifications";

function text(input: unknown) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value || null;
}

function dateIso(input: unknown) {
  const value = text(input);
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function resolveScope(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "sales"], request);
  if (!auth.ok) return auth;
  const tenantIdFromQuery = text(new URL(request.url).searchParams.get("tenantId"));
  const tenantId = auth.context.role === "platform_admin" ? (tenantIdFromQuery || auth.context.tenantId) : auth.context.tenantId;
  if (!tenantId) return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant scope") };
  return { ok: true as const, auth, tenantId };
}

async function loadOpportunity(params: { request: Request; id: string }) {
  const scoped = await resolveScope(params.request);
  if (!scoped.ok) return scoped;
  const result = await scoped.auth.supabase
    .from("crm_opportunities")
    .select("id, tenant_id, branch_id, type, status, member_id, lead_id, source_ref_type, source_ref_id, owner_staff_id, priority, reason, note, due_at, next_action_at, snoozed_until, won_at, lost_at, last_activity_at, dedupe_key, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", scoped.tenantId)
    .eq("id", params.id)
    .maybeSingle();
  if (result.error) return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", result.error.message) };
  if (!result.data) return { ok: false as const, response: apiError(404, "FORBIDDEN", "Opportunity not found") };
  const row = result.data as OpportunityRow;
  if (!canReadOpportunity({ context: scoped.auth.context, row })) {
    return { ok: false as const, response: apiError(403, "FORBIDDEN", "Forbidden opportunity scope") };
  }
  return { ok: true as const, scoped, row };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await loadOpportunity({ request, id });
  if (!loaded.ok) return loaded.response;

  const permission = requirePermission(loaded.scoped.auth.context, "crm.read");
  if (!permission.ok) return permission.response;

  const mapResult = await buildOpportunityContextMaps({
    supabase: loaded.scoped.auth.supabase,
    tenantId: loaded.scoped.tenantId,
    rows: [loaded.row],
  });
  if (!mapResult.ok) return apiError(500, "INTERNAL_ERROR", mapResult.error);

  const logs = await listOpportunityLogs({
    supabase: loaded.scoped.auth.supabase,
    tenantId: loaded.scoped.tenantId,
    opportunityId: loaded.row.id,
    limit: 120,
  });
  if (!logs.ok) return apiError(500, "INTERNAL_ERROR", logs.error);

  return apiSuccess({
    item: mapOpportunityRow({
      row: loaded.row,
      membersById: mapResult.membersById,
      leadsById: mapResult.leadsById,
    }),
    logs: logs.items.map((row) => ({
      id: row.id,
      action: row.action,
      note: row.note,
      statusBefore: row.status_before,
      statusAfter: row.status_after,
      nextActionAt: row.next_action_at,
      payload: row.payload || {},
      createdBy: row.created_by,
      createdAt: row.created_at,
    })),
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const loaded = await loadOpportunity({ request, id });
  if (!loaded.ok) return loaded.response;

  const body = await request.json().catch(() => null);
  const status = parseOpportunityStatus(body?.status);
  const priority = parseOpportunityPriority(body?.priority);
  const ownerStaffId = text(body?.ownerStaffId);
  const note = "note" in (body || {}) ? text(body?.note) : undefined;
  const reason = "reason" in (body || {}) ? text(body?.reason) : undefined;
  const nextActionAt = "nextActionAt" in (body || {}) ? dateIso(body?.nextActionAt) : undefined;
  const dueAt = "dueAt" in (body || {}) ? dateIso(body?.dueAt) : undefined;
  const snoozedUntil = "snoozedUntil" in (body || {}) ? dateIso(body?.snoozedUntil) : undefined;
  const action = text(body?.action) || "update";

  const followupPermission = requirePermission(loaded.scoped.auth.context, "crm.followup");
  if (!followupPermission.ok) return followupPermission.response;

  if ("ownerStaffId" in (body || {})) {
    const assignPermission = requirePermission(loaded.scoped.auth.context, "crm.assign");
    if (!assignPermission.ok) {
      if (ownerStaffId && ownerStaffId !== loaded.scoped.auth.context.userId) {
        return apiError(403, "FORBIDDEN", "Cannot assign owner");
      }
    }
  }

  const patch: Record<string, unknown> = {
    updated_by: loaded.scoped.auth.context.userId,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  };
  if (status) patch.status = status;
  if (priority) patch.priority = priority;
  if ("ownerStaffId" in (body || {})) patch.owner_staff_id = ownerStaffId;
  if (note !== undefined) patch.note = note;
  if (reason !== undefined && reason) patch.reason = reason;
  if (nextActionAt !== undefined) patch.next_action_at = nextActionAt;
  if (dueAt !== undefined) patch.due_at = dueAt;
  if (snoozedUntil !== undefined) patch.snoozed_until = snoozedUntil;

  if (status === "won") patch.won_at = new Date().toISOString();
  if (status === "lost") patch.lost_at = new Date().toISOString();
  if (status && status !== "snoozed") patch.snoozed_until = null;

  const meaningfulKeys = Object.keys(patch).filter((key) => !["updated_by", "updated_at", "last_activity_at"].includes(key));
  if (meaningfulKeys.length === 0) return apiError(400, "FORBIDDEN", "No update payload");

  const updateResult = await loaded.scoped.auth.supabase
    .from("crm_opportunities")
    .update(patch)
    .eq("tenant_id", loaded.scoped.tenantId)
    .eq("id", loaded.row.id)
    .select("id, tenant_id, branch_id, type, status, member_id, lead_id, source_ref_type, source_ref_id, owner_staff_id, priority, reason, note, due_at, next_action_at, snoozed_until, won_at, lost_at, last_activity_at, dedupe_key, created_by, updated_by, created_at, updated_at")
    .maybeSingle();
  if (updateResult.error || !updateResult.data) {
    return apiError(500, "INTERNAL_ERROR", updateResult.error?.message || "Update opportunity failed");
  }
  const updated = updateResult.data as OpportunityRow;

  await appendOpportunityLog({
    supabase: loaded.scoped.auth.supabase,
    tenantId: loaded.scoped.tenantId,
    opportunityId: updated.id,
    action,
    note: note || null,
    statusBefore: loaded.row.status,
    statusAfter: updated.status,
    nextActionAt: updated.next_action_at,
    payload: {
      changed: meaningfulKeys,
      ownerStaffId: updated.owner_staff_id,
      priority: updated.priority,
      dueAt: updated.due_at,
    },
    actorId: loaded.scoped.auth.context.userId,
  });

  await loaded.scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: loaded.scoped.tenantId,
    actor_id: loaded.scoped.auth.context.userId,
    action: "crm_opportunity_updated",
    target_type: "crm_opportunity",
    target_id: updated.id,
    reason: updated.status,
    payload: {
      statusBefore: loaded.row.status,
      statusAfter: updated.status,
      ownerStaffId: updated.owner_staff_id,
      priority: updated.priority,
      nextActionAt: updated.next_action_at,
      dueAt: updated.due_at,
      action,
    },
  }).catch(() => null);

  if (updated.priority === "critical" || updated.status === "open" || updated.status === "in_progress") {
    await createInAppNotifications({
      tenantId: loaded.scoped.tenantId,
      branchId: updated.branch_id,
      recipientRoles: ["manager"],
      recipientUserIds: updated.owner_staff_id ? [updated.owner_staff_id] : [],
      title: "Opportunity updated",
      message: `${updated.type} is now ${updated.status}.`,
      severity: updated.priority === "critical" ? "critical" : "warning",
      eventType: "opportunity_updated",
      targetType: "crm_opportunity",
      targetId: updated.id,
      actionUrl: "/manager/opportunities",
      dedupeKey: `opportunity-updated:${updated.id}:${updated.updated_at.slice(0, 16)}`,
      createdBy: loaded.scoped.auth.context.userId,
    }).catch(() => null);
  }

  const mapResult = await buildOpportunityContextMaps({
    supabase: loaded.scoped.auth.supabase,
    tenantId: loaded.scoped.tenantId,
    rows: [updated],
  });
  if (!mapResult.ok) return apiError(500, "INTERNAL_ERROR", mapResult.error);

  return apiSuccess({
    item: mapOpportunityRow({
      row: updated,
      membersById: mapResult.membersById,
      leadsById: mapResult.leadsById,
    }),
  });
}

