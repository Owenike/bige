import { apiError, apiSuccess, requireProfile, type ProfileContext } from "../../../../../lib/auth-context";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canAssignCrmOwner,
  normalizeEmail,
  normalizeOptionalText,
  parseIsoDateTime,
  parseLeadSource,
  parseLeadStatus,
  parseLeadTemperature,
  parseTrialResult,
  parseTrialStatus,
} from "../../../../../lib/crm";
import { createInAppNotifications, notifyCrmTrialScheduled } from "../../../../../lib/in-app-notifications";
import { requireAnyPermission, requirePermission } from "../../../../../lib/permissions";

type LeadListRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  owner_staff_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  note: string | null;
  source: string;
  status: string;
  temperature: string;
  trial_at: string | null;
  trial_status: string | null;
  trial_result: string | null;
  trial_booking_id: string | null;
  next_action_at: string | null;
  last_followed_up_at: string | null;
  won_member_id: string | null;
  won_order_id: string | null;
  won_plan_code: string | null;
  lost_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

async function resolveScope(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "sales", "frontdesk"], request);
  if (!auth.ok) return auth;

  const permission = requireAnyPermission(auth.context, ["crm.read", "crm.write", "crm.followup"]);
  if (!permission.ok) return { ok: false as const, response: permission.response };

  const requestedTenantId = new URL(request.url).searchParams.get("tenantId");
  const tenantId = auth.context.role === "platform_admin"
    ? (requestedTenantId || null)
    : auth.context.tenantId;
  if (!tenantId) {
    return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant scope") };
  }

  return {
    ok: true as const,
    auth,
    tenantId,
  };
}

async function ensureBranchInTenant(params: { context: ProfileContext; supabase: SupabaseClient; tenantId: string; branchId: string | null }) {
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

function mapLeadItem(row: LeadListRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    ownerStaffId: row.owner_staff_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    gender: row.gender,
    note: row.note,
    source: row.source,
    status: row.status,
    temperature: row.temperature,
    trialAt: row.trial_at,
    trialStatus: row.trial_status,
    trialResult: row.trial_result,
    trialBookingId: row.trial_booking_id,
    nextActionAt: row.next_action_at,
    lastFollowedUpAt: row.last_followed_up_at,
    wonMemberId: row.won_member_id,
    wonOrderId: row.won_order_id,
    wonPlanCode: row.won_plan_code,
    lostReason: row.lost_reason,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  const scoped = await resolveScope(request);
  if (!scoped.ok) return scoped.response;

  const readPermission = requirePermission(scoped.auth.context, "crm.read");
  if (!readPermission.ok) return readPermission.response;

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") || "").trim();
  const status = parseLeadStatus(params.get("status"), "new");
  const source = parseLeadSource(params.get("source"), "walk-in");
  const ownerStaffId = normalizeOptionalText(params.get("ownerStaffId"));
  const branchId = normalizeOptionalText(params.get("branchId"));
  const useStatusFilter = params.has("status");
  const useSourceFilter = params.has("source");
  const limit = Math.min(300, Math.max(1, Number(params.get("limit") || 120)));

  let query = scoped.auth.supabase
    .from("crm_leads")
    .select("id, tenant_id, branch_id, owner_staff_id, name, phone, email, gender, note, source, status, temperature, trial_at, trial_status, trial_result, trial_booking_id, next_action_at, last_followed_up_at, won_member_id, won_order_id, won_plan_code, lost_reason, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", scoped.tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  if (useStatusFilter) query = query.eq("status", status);
  if (useSourceFilter) query = query.eq("source", source);
  if (ownerStaffId) query = query.eq("owner_staff_id", ownerStaffId);
  if (branchId) query = query.eq("branch_id", branchId);

  if (scoped.auth.context.role === "sales") {
    query = query.or(`owner_staff_id.eq.${scoped.auth.context.userId},created_by.eq.${scoped.auth.context.userId}`);
  } else if (
    scoped.auth.context.branchId &&
    scoped.auth.context.role !== "platform_admin" &&
    scoped.auth.context.role !== "manager"
  ) {
    query = query.eq("branch_id", scoped.auth.context.branchId);
  }

  const result = await query;
  if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);

  const rows = (result.data || []) as LeadListRow[];
  const summary = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + 1;
      acc.bySource[row.source] = (acc.bySource[row.source] || 0) + 1;
      acc.byOwner[row.owner_staff_id || "unassigned"] = (acc.byOwner[row.owner_staff_id || "unassigned"] || 0) + 1;
      if (row.status === "trial_booked" || row.trial_status === "scheduled" || row.trial_status === "rescheduled") acc.trialBooked += 1;
      if (row.trial_status === "attended" || row.status === "trial_completed") acc.trialAttended += 1;
      if (row.status === "won") acc.won += 1;
      if (row.status === "lost") acc.lost += 1;
      return acc;
    },
    {
      total: 0,
      trialBooked: 0,
      trialAttended: 0,
      won: 0,
      lost: 0,
      byStatus: {} as Record<string, number>,
      bySource: {} as Record<string, number>,
      byOwner: {} as Record<string, number>,
    },
  );

  return apiSuccess({
    items: rows.map(mapLeadItem),
    summary,
  });
}

export async function POST(request: Request) {
  const scoped = await resolveScope(request);
  if (!scoped.ok) return scoped.response;

  const writePermission = requirePermission(scoped.auth.context, "crm.write");
  if (!writePermission.ok) return writePermission.response;

  const body = await request.json().catch(() => null);
  const name = normalizeOptionalText(body?.name) || "";
  const phone = normalizeOptionalText(body?.phone);
  const email = normalizeEmail(body?.email);
  const gender = normalizeOptionalText(body?.gender) || null;
  const note = normalizeOptionalText(body?.note);
  const status = parseLeadStatus(body?.status, "new");
  const temperature = parseLeadTemperature(body?.temperature, "warm");
  const source = parseLeadSource(body?.source, "walk-in");
  const trialAt = parseIsoDateTime(body?.trialAt);
  const trialStatus = parseTrialStatus(body?.trialStatus);
  const trialResult = parseTrialResult(body?.trialResult);
  const nextActionAt = parseIsoDateTime(body?.nextActionAt);
  const branchId = normalizeOptionalText(body?.branchId) || scoped.auth.context.branchId || null;

  if (!name) return apiError(400, "FORBIDDEN", "name is required");

  if (scoped.auth.context.role === "frontdesk" && source !== "walk-in") {
    return apiError(403, "FORBIDDEN", "frontdesk can only create walk-in lead");
  }

  const ownerRequested = normalizeOptionalText(body?.ownerStaffId);
  const ownerStaffId = ownerRequested
    ? (canAssignCrmOwner(scoped.auth.context.role) ? ownerRequested : scoped.auth.context.userId)
    : (scoped.auth.context.role === "sales" ? scoped.auth.context.userId : null);

  if (ownerRequested && !canAssignCrmOwner(scoped.auth.context.role) && ownerRequested !== scoped.auth.context.userId) {
    return apiError(403, "FORBIDDEN", "Cannot assign lead owner");
  }

  const branchScope = await ensureBranchInTenant({
    context: scoped.auth.context,
    supabase: scoped.auth.supabase,
    tenantId: scoped.tenantId,
    branchId,
  });
  if (!branchScope.ok) return branchScope.response;

  const nowIso = new Date().toISOString();
  const insertResult = await scoped.auth.supabase
    .from("crm_leads")
    .insert({
      tenant_id: scoped.tenantId,
      branch_id: branchId,
      owner_staff_id: ownerStaffId,
      name,
      phone,
      email,
      gender,
      note,
      source,
      status: trialAt ? "trial_booked" : status,
      temperature,
      trial_at: trialAt,
      trial_status: trialAt ? (trialStatus || "scheduled") : trialStatus,
      trial_result: trialResult,
      next_action_at: nextActionAt,
      created_by: scoped.auth.context.userId,
      updated_by: scoped.auth.context.userId,
      updated_at: nowIso,
    })
    .select("id, tenant_id, branch_id, owner_staff_id, name, phone, email, gender, note, source, status, temperature, trial_at, trial_status, trial_result, trial_booking_id, next_action_at, last_followed_up_at, won_member_id, won_order_id, won_plan_code, lost_reason, created_by, updated_by, created_at, updated_at")
    .maybeSingle();
  if (insertResult.error || !insertResult.data) {
    return apiError(500, "INTERNAL_ERROR", insertResult.error?.message || "Create lead failed");
  }

  await scoped.auth.supabase.from("crm_lead_followups").insert({
    tenant_id: scoped.tenantId,
    lead_id: insertResult.data.id,
    branch_id: branchId,
    follow_up_type: trialAt ? "trial" : "other",
    note: note || "lead_created",
    next_action_at: nextActionAt,
    payload: { action: "lead_created" },
    created_by: scoped.auth.context.userId,
  });

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "crm_lead_created",
    target_type: "crm_lead",
    target_id: insertResult.data.id,
    reason: source,
    payload: {
      branchId,
      ownerStaffId,
      status: insertResult.data.status,
      trialAt: insertResult.data.trial_at,
      trialStatus: insertResult.data.trial_status,
    },
  });

  if (insertResult.data.trial_at && insertResult.data.trial_status === "scheduled") {
    await notifyCrmTrialScheduled({
      tenantId: scoped.tenantId,
      branchId,
      leadId: insertResult.data.id,
      leadName: insertResult.data.name,
      ownerStaffId: insertResult.data.owner_staff_id,
      trialAt: insertResult.data.trial_at,
      actorId: scoped.auth.context.userId,
    }).catch(() => null);
  } else {
    await createInAppNotifications({
      tenantId: scoped.tenantId,
      branchId,
      recipientRoles: ["manager"],
      recipientUserIds: insertResult.data.owner_staff_id ? [insertResult.data.owner_staff_id] : [],
      title: "New CRM lead created",
      message: `Lead ${insertResult.data.name} is created (${insertResult.data.source}).`,
      severity: "info",
      eventType: "crm_lead_created",
      targetType: "crm_lead",
      targetId: insertResult.data.id,
      actionUrl: `/manager/crm/${insertResult.data.id}`,
      dedupeKey: `crm-lead-created:${insertResult.data.id}`,
      createdBy: scoped.auth.context.userId,
    }).catch(() => null);
  }

  return apiSuccess({
    item: mapLeadItem(insertResult.data as LeadListRow),
  });
}
