import { apiError, apiSuccess, requireProfile, type ProfileContext } from "../../../../lib/auth-context";
import { requirePermission } from "../../../../lib/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appendOpportunityLog,
  buildOpportunityContextMaps,
  canReadOpportunity,
  mapOpportunityRow,
  parseOpportunityPriority,
  parseOpportunityStatus,
  parseOpportunityType,
  runOpportunitySweep,
  summarizeOpportunities,
  type OpportunityPriority,
  type OpportunityRow,
  type OpportunityStatus,
  type OpportunityType,
} from "../../../../lib/opportunities";
import { createInAppNotifications } from "../../../../lib/in-app-notifications";

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

function parseLimit(input: string | null) {
  const value = Number(input || 80);
  if (!Number.isFinite(value)) return 80;
  return Math.min(300, Math.max(1, Math.floor(value)));
}

function parseBoolean(input: string | null) {
  if (!input) return false;
  return input === "1" || input.toLowerCase() === "true" || input.toLowerCase() === "yes";
}

function roleCanAssign(context: ProfileContext) {
  return context.role === "platform_admin" || context.role === "manager";
}

async function resolveScope(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "sales"], request);
  if (!auth.ok) return auth;

  const tenantIdFromQuery = text(new URL(request.url).searchParams.get("tenantId"));
  const tenantId = auth.context.role === "platform_admin" ? (tenantIdFromQuery || auth.context.tenantId) : auth.context.tenantId;
  if (!tenantId) return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant scope") };

  return { ok: true as const, auth, tenantId };
}

async function enforceBranch(params: {
  context: ProfileContext;
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
}) {
  if (!params.branchId) return { ok: true as const };
  const branchResult = await params.supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.branchId)
    .maybeSingle();
  if (branchResult.error) return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", branchResult.error.message) };
  if (!branchResult.data) return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "branchId is outside tenant scope") };
  if (
    params.context.branchId &&
    params.context.role !== "platform_admin" &&
    params.context.role !== "manager" &&
    params.context.branchId !== params.branchId
  ) {
    return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden branch scope") };
  }
  return { ok: true as const };
}

async function ensureMemberScope(params: { supabase: SupabaseClient; tenantId: string; memberId: string }) {
  const result = await params.supabase
    .from("members")
    .select("id, store_id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.memberId)
    .maybeSingle();
  if (result.error) return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", result.error.message) };
  if (!result.data) return { ok: false as const, response: apiError(403, "FORBIDDEN", "member_id is outside tenant scope") };
  return { ok: true as const, member: result.data as { id: string; store_id: string | null } };
}

async function ensureLeadScope(params: { supabase: SupabaseClient; tenantId: string; leadId: string }) {
  const result = await params.supabase
    .from("crm_leads")
    .select("id, branch_id, owner_staff_id, created_by")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.leadId)
    .maybeSingle();
  if (result.error) return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", result.error.message) };
  if (!result.data) return { ok: false as const, response: apiError(403, "FORBIDDEN", "lead_id is outside tenant scope") };
  return {
    ok: true as const,
    lead: result.data as { id: string; branch_id: string | null; owner_staff_id: string | null; created_by: string | null },
  };
}

export async function GET(request: Request) {
  const scoped = await resolveScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "crm.read");
  if (!permission.ok) return permission.response;

  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params.get("limit"));
  const typeFilter = parseOpportunityType(params.get("type"));
  const statusFilter = parseOpportunityStatus(params.get("status"));
  const priorityFilter = parseOpportunityPriority(params.get("priority"));
  const ownerFilter = text(params.get("ownerStaffId"));
  const branchFilter = text(params.get("branchId"));
  const mineOnly = parseBoolean(params.get("mine"));
  const q = (params.get("q") || "").trim();

  let query = scoped.auth.supabase
    .from("crm_opportunities")
    .select("id, tenant_id, branch_id, type, status, member_id, lead_id, source_ref_type, source_ref_id, owner_staff_id, priority, reason, note, due_at, next_action_at, snoozed_until, won_at, lost_at, last_activity_at, dedupe_key, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", scoped.tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (typeFilter) query = query.eq("type", typeFilter);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (priorityFilter) query = query.eq("priority", priorityFilter);
  if (ownerFilter) query = query.eq("owner_staff_id", ownerFilter);
  if (branchFilter) query = query.eq("branch_id", branchFilter);

  if (scoped.auth.context.role === "sales") {
    query = query.or(`owner_staff_id.eq.${scoped.auth.context.userId},created_by.eq.${scoped.auth.context.userId}`);
  } else if (
    scoped.auth.context.branchId &&
    scoped.auth.context.role !== "platform_admin" &&
    scoped.auth.context.role !== "manager"
  ) {
    query = query.or(`branch_id.eq.${scoped.auth.context.branchId},branch_id.is.null`);
  }
  if (mineOnly) {
    query = query.eq("owner_staff_id", scoped.auth.context.userId);
  }

  const result = await query;
  if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);
  let rows = (result.data || []) as OpportunityRow[];

  rows = rows.filter((row) => canReadOpportunity({ context: scoped.auth.context, row }));

  const mapResult = await buildOpportunityContextMaps({
    supabase: scoped.auth.supabase,
    tenantId: scoped.tenantId,
    rows,
  });
  if (!mapResult.ok) return apiError(500, "INTERNAL_ERROR", mapResult.error);

  let items = rows.map((row) =>
    mapOpportunityRow({
      row,
      membersById: mapResult.membersById,
      leadsById: mapResult.leadsById,
    }),
  );

  if (q) {
    const keyword = q.toLowerCase();
    items = items.filter((item) => {
      const fields = [
        item.reason,
        item.note || "",
        item.type,
        item.status,
        item.member?.fullName || "",
        item.member?.phone || "",
        item.lead?.name || "",
        item.lead?.phone || "",
        item.lead?.email || "",
      ];
      return fields.some((field) => field.toLowerCase().includes(keyword));
    });
  }

  const summary = summarizeOpportunities(rows, new Date());

  return apiSuccess({
    items,
    summary,
  });
}

export async function POST(request: Request) {
  const scoped = await resolveScope(request);
  if (!scoped.ok) return scoped.response;

  const body = await request.json().catch(() => null);
  const mode = text(body?.mode) || "create";

  if (mode === "sweep") {
    const writePermission = requirePermission(scoped.auth.context, "crm.write");
    if (!writePermission.ok) return writePermission.response;
    const sweep = await runOpportunitySweep({
      actorRole: scoped.auth.context.role,
      actorUserId: scoped.auth.context.userId,
      tenantId: scoped.auth.context.role === "platform_admin" ? (text(body?.tenantId) || scoped.tenantId) : scoped.tenantId,
    });
    if (!sweep.ok) return apiError(500, "INTERNAL_ERROR", sweep.error);
    return apiSuccess({
      mode: "sweep",
      inserted: sweep.summary.inserted,
      byType: sweep.summary.byType,
      reminders: sweep.summary.reminders,
    });
  }

  const writePermission = requirePermission(scoped.auth.context, "crm.write");
  if (!writePermission.ok) return writePermission.response;

  const type = parseOpportunityType(body?.type);
  if (!type) return apiError(400, "FORBIDDEN", "Invalid opportunity type");

  const status = parseOpportunityStatus(body?.status) || "open";
  const priority = parseOpportunityPriority(body?.priority) || "medium";
  const memberId = text(body?.memberId);
  const leadId = text(body?.leadId);
  const sourceRefType = text(body?.sourceRefType) || (memberId ? "member" : leadId ? "crm_lead" : null);
  const sourceRefId = text(body?.sourceRefId) || memberId || leadId;
  const reason = text(body?.reason) || "";
  const note = text(body?.note);
  const dueAt = dateIso(body?.dueAt);
  const nextActionAt = dateIso(body?.nextActionAt);
  const branchIdInput = text(body?.branchId);
  const ownerRequested = text(body?.ownerStaffId);
  const dedupeKey = text(body?.dedupeKey) || `manual:${type}:${memberId || leadId || sourceRefId || "na"}:${new Date().toISOString().slice(0, 13)}`;

  if (!reason) return apiError(400, "FORBIDDEN", "reason is required");
  if (!memberId && !leadId) return apiError(400, "FORBIDDEN", "memberId or leadId is required");
  if (!sourceRefType || !sourceRefId) return apiError(400, "FORBIDDEN", "sourceRefType/sourceRefId are required");

  let branchId: string | null = branchIdInput || null;
  if (memberId) {
    const memberScope = await ensureMemberScope({ supabase: scoped.auth.supabase, tenantId: scoped.tenantId, memberId });
    if (!memberScope.ok) return memberScope.response;
    if (!branchId && memberScope.member.store_id) branchId = memberScope.member.store_id;
  }
  if (leadId) {
    const leadScope = await ensureLeadScope({ supabase: scoped.auth.supabase, tenantId: scoped.tenantId, leadId });
    if (!leadScope.ok) return leadScope.response;
    if (!branchId && leadScope.lead.branch_id) branchId = leadScope.lead.branch_id;
  }
  const branchScope = await enforceBranch({
    context: scoped.auth.context,
    supabase: scoped.auth.supabase,
    tenantId: scoped.tenantId,
    branchId,
  });
  if (!branchScope.ok) return branchScope.response;

  let ownerStaffId = ownerRequested;
  if (!roleCanAssign(scoped.auth.context)) {
    if (ownerRequested && ownerRequested !== scoped.auth.context.userId) {
      return apiError(403, "FORBIDDEN", "Cannot assign another owner");
    }
    ownerStaffId = scoped.auth.context.userId;
  }

  const nowIso = new Date().toISOString();
  const insertResult = await scoped.auth.supabase
    .from("crm_opportunities")
    .insert({
      tenant_id: scoped.tenantId,
      branch_id: branchId,
      type,
      status,
      member_id: memberId,
      lead_id: leadId,
      source_ref_type: sourceRefType,
      source_ref_id: sourceRefId,
      owner_staff_id: ownerStaffId,
      priority: priority as OpportunityPriority,
      reason,
      note,
      due_at: dueAt,
      next_action_at: nextActionAt,
      dedupe_key: dedupeKey,
      created_by: scoped.auth.context.userId,
      updated_by: scoped.auth.context.userId,
      last_activity_at: nowIso,
      updated_at: nowIso,
    })
    .select("id, tenant_id, branch_id, type, status, member_id, lead_id, source_ref_type, source_ref_id, owner_staff_id, priority, reason, note, due_at, next_action_at, snoozed_until, won_at, lost_at, last_activity_at, dedupe_key, created_by, updated_by, created_at, updated_at")
    .maybeSingle();
  if (insertResult.error || !insertResult.data) {
    if ((insertResult.error?.message || "").toLowerCase().includes("duplicate key")) {
      return apiError(409, "FORBIDDEN", "Duplicate opportunity");
    }
    return apiError(500, "INTERNAL_ERROR", insertResult.error?.message || "Create opportunity failed");
  }
  const row = insertResult.data as OpportunityRow;

  await appendOpportunityLog({
    supabase: scoped.auth.supabase,
    tenantId: scoped.tenantId,
    opportunityId: row.id,
    action: "manual_created",
    note,
    statusBefore: null,
    statusAfter: row.status,
    nextActionAt: row.next_action_at,
    payload: {
      type: row.type,
      priority: row.priority,
      sourceRefType: row.source_ref_type,
      sourceRefId: row.source_ref_id,
    },
    actorId: scoped.auth.context.userId,
  });

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "crm_opportunity_created",
    target_type: "crm_opportunity",
    target_id: row.id,
    reason: row.type,
    payload: {
      status: row.status,
      priority: row.priority,
      memberId: row.member_id,
      leadId: row.lead_id,
      sourceRefType: row.source_ref_type,
      sourceRefId: row.source_ref_id,
      dueAt: row.due_at,
    },
  }).catch(() => null);

  await createInAppNotifications({
    tenantId: scoped.tenantId,
    branchId: row.branch_id,
    recipientRoles: ["manager"],
    recipientUserIds: row.owner_staff_id ? [row.owner_staff_id] : [],
    title: "New opportunity created",
    message: `${row.type} | ${row.reason}`,
    severity: row.priority === "critical" ? "critical" : row.priority === "high" ? "warning" : "info",
    eventType: "opportunity_created",
    targetType: "crm_opportunity",
    targetId: row.id,
    actionUrl: "/manager/opportunities",
    dedupeKey: `opportunity-created:${row.id}`,
    createdBy: scoped.auth.context.userId,
  }).catch(() => null);

  const mapResult = await buildOpportunityContextMaps({
    supabase: scoped.auth.supabase,
    tenantId: scoped.tenantId,
    rows: [row],
  });
  if (!mapResult.ok) return apiError(500, "INTERNAL_ERROR", mapResult.error);

  return apiSuccess({
    item: mapOpportunityRow({
      row,
      membersById: mapResult.membersById,
      leadsById: mapResult.leadsById,
    }),
  });
}
