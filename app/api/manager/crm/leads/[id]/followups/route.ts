import { apiError, apiSuccess, requireProfile } from "../../../../../../../lib/auth-context";
import { normalizeOptionalText, parseFollowupType, parseIsoDateTime, parseLeadStatus } from "../../../../../../../lib/crm";
import { createInAppNotifications } from "../../../../../../../lib/in-app-notifications";
import { requirePermission } from "../../../../../../../lib/permissions";

type LeadScopeRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  owner_staff_id: string | null;
  created_by: string | null;
  status: string;
};

async function resolveLead(request: Request, leadId: string) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "sales", "frontdesk"], request);
  if (!auth.ok) return auth;
  if (!auth.context.tenantId && auth.context.role !== "platform_admin") {
    return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant scope") };
  }

  const tenantId = auth.context.role === "platform_admin"
    ? (new URL(request.url).searchParams.get("tenantId") || auth.context.tenantId)
    : auth.context.tenantId;
  if (!tenantId) return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant scope") };

  const leadResult = await auth.supabase
    .from("crm_leads")
    .select("id, tenant_id, branch_id, owner_staff_id, created_by, status")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadResult.error) return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", leadResult.error.message) };
  if (!leadResult.data) return { ok: false as const, response: apiError(404, "FORBIDDEN", "Lead not found") };

  const lead = leadResult.data as LeadScopeRow;
  if (
    auth.context.role === "sales" &&
    lead.owner_staff_id !== auth.context.userId &&
    lead.created_by !== auth.context.userId
  ) {
    return { ok: false as const, response: apiError(403, "FORBIDDEN", "Forbidden lead scope") };
  }
  if (
    auth.context.branchId &&
    auth.context.role !== "platform_admin" &&
    auth.context.role !== "manager" &&
    lead.branch_id &&
    lead.branch_id !== auth.context.branchId
  ) {
    return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden branch scope") };
  }

  return {
    ok: true as const,
    auth,
    tenantId,
    lead,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scoped = await resolveLead(request, id);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "crm.read");
  if (!permission.ok) return permission.response;

  const limit = Math.min(300, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 120)));
  const result = await scoped.auth.supabase
    .from("crm_lead_followups")
    .select("id, follow_up_type, note, payload, next_action_at, created_by, created_at")
    .eq("tenant_id", scoped.tenantId)
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);

  return apiSuccess({
    items: result.data || [],
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scoped = await resolveLead(request, id);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "crm.followup");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const followupType = parseFollowupType(body?.followUpType, "other");
  const note = normalizeOptionalText(body?.note);
  const nextActionAt = parseIsoDateTime(body?.nextActionAt);
  const statusAfter = "statusAfter" in (body || {}) ? parseLeadStatus(body?.statusAfter, parseLeadStatus(scoped.lead.status, "new")) : null;

  if (!note) return apiError(400, "FORBIDDEN", "note is required");

  const insertResult = await scoped.auth.supabase
    .from("crm_lead_followups")
    .insert({
      tenant_id: scoped.tenantId,
      lead_id: id,
      branch_id: scoped.lead.branch_id,
      follow_up_type: followupType,
      note,
      next_action_at: nextActionAt,
      payload: {
        statusAfter,
      },
      created_by: scoped.auth.context.userId,
    })
    .select("id, follow_up_type, note, payload, next_action_at, created_by, created_at")
    .maybeSingle();
  if (insertResult.error || !insertResult.data) return apiError(500, "INTERNAL_ERROR", insertResult.error?.message || "Create follow-up failed");

  const leadPatch: Record<string, unknown> = {
    updated_by: scoped.auth.context.userId,
    updated_at: new Date().toISOString(),
    last_followed_up_at: new Date().toISOString(),
    next_action_at: nextActionAt,
  };
  if (statusAfter) {
    leadPatch.status = statusAfter;
  } else if (scoped.lead.status === "new") {
    leadPatch.status = "contacted";
  }

  await scoped.auth.supabase
    .from("crm_leads")
    .update(leadPatch)
    .eq("tenant_id", scoped.tenantId)
    .eq("id", id);

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "crm_followup_created",
    target_type: "crm_lead",
    target_id: id,
    reason: followupType,
    payload: {
      note,
      nextActionAt,
      statusAfter: statusAfter || null,
    },
  }).catch(() => null);

  if (nextActionAt) {
    await createInAppNotifications({
      tenantId: scoped.tenantId,
      branchId: scoped.lead.branch_id,
      recipientUserIds: scoped.lead.owner_staff_id ? [scoped.lead.owner_staff_id] : [],
      recipientRoles: ["manager"],
      title: "CRM next action scheduled",
      message: `Lead follow-up is scheduled at ${nextActionAt}.`,
      severity: "info",
      eventType: "crm_next_action_scheduled",
      targetType: "crm_lead",
      targetId: id,
      actionUrl: `/manager/crm/${id}`,
      dedupeKey: `crm-next-action:${id}:${nextActionAt.slice(0, 16)}`,
      createdBy: scoped.auth.context.userId,
    }).catch(() => null);
  }

  return apiSuccess({
    item: insertResult.data,
  });
}
