import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
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
} from "../../../../../../lib/crm";
import { notifyCrmOutcomeChanged, notifyCrmTrialScheduled } from "../../../../../../lib/in-app-notifications";
import { requirePermission } from "../../../../../../lib/permissions";

type LeadRow = {
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

function mapLead(row: LeadRow) {
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

async function resolveScope(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "sales", "frontdesk"], request);
  if (!auth.ok) return auth;
  if (!auth.context.tenantId && auth.context.role !== "platform_admin") {
    return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant scope") };
  }
  return { ok: true as const, auth };
}

async function loadLeadById(params: {
  auth: {
    supabase: SupabaseClient;
    context: { tenantId: string | null; role: string; userId: string; branchId: string | null };
  };
  leadId: string;
  tenantId?: string | null;
}) {
  const tenantId = params.auth.context.role === "platform_admin" ? (params.tenantId || params.auth.context.tenantId) : params.auth.context.tenantId;
  if (!tenantId) return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant scope") };
  const result = await params.auth.supabase
    .from("crm_leads")
    .select("id, tenant_id, branch_id, owner_staff_id, name, phone, email, gender, note, source, status, temperature, trial_at, trial_status, trial_result, trial_booking_id, next_action_at, last_followed_up_at, won_member_id, won_order_id, won_plan_code, lost_reason, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", params.leadId)
    .maybeSingle();
  if (result.error) return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", result.error.message) };
  if (!result.data) return { ok: false as const, response: apiError(404, "FORBIDDEN", "Lead not found") };
  return { ok: true as const, lead: result.data as LeadRow, tenantId };
}

function canAccessLead(context: { role: string; userId: string; branchId: string | null }, lead: LeadRow) {
  if (context.role === "platform_admin" || context.role === "manager") return true;
  if (context.role === "sales") {
    return lead.owner_staff_id === context.userId || lead.created_by === context.userId;
  }
  if ((context.role === "frontdesk" || context.role === "supervisor" || context.role === "branch_manager") && context.branchId) {
    return !lead.branch_id || lead.branch_id === context.branchId;
  }
  return true;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scoped = await resolveScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "crm.read");
  if (!permission.ok) return permission.response;

  const tenantIdFromQuery = new URL(request.url).searchParams.get("tenantId");
  const leadResult = await loadLeadById({ auth: scoped.auth, leadId: id, tenantId: tenantIdFromQuery });
  if (!leadResult.ok) return leadResult.response;
  const lead = leadResult.lead;

  if (!canAccessLead(scoped.auth.context, lead)) return apiError(403, "FORBIDDEN", "Forbidden lead scope");

  const [followupsResult, memberResult, orderResult, trialBookingResult] = await Promise.all([
    scoped.auth.supabase
      .from("crm_lead_followups")
      .select("id, follow_up_type, note, payload, next_action_at, created_by, created_at")
      .eq("tenant_id", leadResult.tenantId)
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(300),
    lead.won_member_id
      ? scoped.auth.supabase
          .from("members")
          .select("id, full_name, phone, email")
          .eq("tenant_id", leadResult.tenantId)
          .eq("id", lead.won_member_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    lead.won_order_id
      ? scoped.auth.supabase
          .from("orders")
          .select("id, status, amount, created_at")
          .eq("tenant_id", leadResult.tenantId)
          .eq("id", lead.won_order_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    lead.trial_booking_id
      ? scoped.auth.supabase
          .from("bookings")
          .select("id, starts_at, ends_at, status, service_name, coach_id, member_id")
          .eq("tenant_id", leadResult.tenantId)
          .eq("id", lead.trial_booking_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (followupsResult.error) return apiError(500, "INTERNAL_ERROR", followupsResult.error.message);
  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (orderResult.error) return apiError(500, "INTERNAL_ERROR", orderResult.error.message);
  if (trialBookingResult.error) return apiError(500, "INTERNAL_ERROR", trialBookingResult.error.message);

  return apiSuccess({
    item: mapLead(lead),
    followups: followupsResult.data || [],
    linkedMember: memberResult.data || null,
    linkedOrder: orderResult.data || null,
    trialBooking: trialBookingResult.data || null,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scoped = await resolveScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "crm.write");
  if (!permission.ok) return permission.response;

  const tenantIdFromQuery = new URL(request.url).searchParams.get("tenantId");
  const leadResult = await loadLeadById({ auth: scoped.auth, leadId: id, tenantId: tenantIdFromQuery });
  if (!leadResult.ok) return leadResult.response;
  const before = leadResult.lead;
  if (!canAccessLead(scoped.auth.context, before)) return apiError(403, "FORBIDDEN", "Forbidden lead scope");

  const body = await request.json().catch(() => null);
  const patch: Record<string, unknown> = {
    updated_by: scoped.auth.context.userId,
    updated_at: new Date().toISOString(),
  };

  if ("name" in (body || {})) {
    const value = normalizeOptionalText(body?.name);
    if (!value) return apiError(400, "FORBIDDEN", "name is required");
    patch.name = value;
  }
  if ("phone" in (body || {})) patch.phone = normalizeOptionalText(body?.phone);
  if ("email" in (body || {})) patch.email = normalizeEmail(body?.email);
  if ("gender" in (body || {})) patch.gender = normalizeOptionalText(body?.gender);
  if ("note" in (body || {})) patch.note = normalizeOptionalText(body?.note);
  if ("source" in (body || {})) patch.source = parseLeadSource(body?.source, parseLeadSource(before.source, "walk-in"));
  if ("temperature" in (body || {})) patch.temperature = parseLeadTemperature(body?.temperature, parseLeadTemperature(before.temperature, "warm"));

  if ("status" in (body || {})) patch.status = parseLeadStatus(body?.status, parseLeadStatus(before.status, "new"));
  if ("lostReason" in (body || {})) patch.lost_reason = normalizeOptionalText(body?.lostReason);
  if ("trialStatus" in (body || {})) patch.trial_status = parseTrialStatus(body?.trialStatus);
  if ("trialResult" in (body || {})) patch.trial_result = parseTrialResult(body?.trialResult);
  if ("trialAt" in (body || {})) patch.trial_at = parseIsoDateTime(body?.trialAt);
  if ("nextActionAt" in (body || {})) patch.next_action_at = parseIsoDateTime(body?.nextActionAt);
  if ("wonPlanCode" in (body || {})) patch.won_plan_code = normalizeOptionalText(body?.wonPlanCode);

  if ("ownerStaffId" in (body || {})) {
    const requestedOwner = normalizeOptionalText(body?.ownerStaffId);
    if (!canAssignCrmOwner(scoped.auth.context.role)) {
      if (requestedOwner && requestedOwner !== scoped.auth.context.userId) {
        return apiError(403, "FORBIDDEN", "Cannot assign owner");
      }
      patch.owner_staff_id = scoped.auth.context.userId;
    } else {
      patch.owner_staff_id = requestedOwner;
    }
  }

  if ("branchId" in (body || {})) {
    const branchId = normalizeOptionalText(body?.branchId);
    if (
      scoped.auth.context.branchId &&
      scoped.auth.context.role !== "platform_admin" &&
      scoped.auth.context.role !== "manager" &&
      branchId &&
      branchId !== scoped.auth.context.branchId
    ) {
      return apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden branch scope");
    }
    patch.branch_id = branchId;
  }

  if ("trialBookingId" in (body || {})) {
    const trialBookingId = normalizeOptionalText(body?.trialBookingId);
    if (trialBookingId) {
      const bookingResult = await scoped.auth.supabase
        .from("bookings")
        .select("id, branch_id")
        .eq("tenant_id", leadResult.tenantId)
        .eq("id", trialBookingId)
        .maybeSingle();
      if (bookingResult.error) return apiError(500, "INTERNAL_ERROR", bookingResult.error.message);
      if (!bookingResult.data) return apiError(403, "FORBIDDEN", "trial booking not found");
      patch.trial_booking_id = trialBookingId;
      if (!patch.branch_id && bookingResult.data.branch_id) patch.branch_id = bookingResult.data.branch_id;
    } else {
      patch.trial_booking_id = null;
    }
  }

  if ("wonMemberId" in (body || {})) {
    const wonMemberId = normalizeOptionalText(body?.wonMemberId);
    if (wonMemberId) {
      const memberResult = await scoped.auth.supabase
        .from("members")
        .select("id")
        .eq("tenant_id", leadResult.tenantId)
        .eq("id", wonMemberId)
        .maybeSingle();
      if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
      if (!memberResult.data) return apiError(403, "FORBIDDEN", "won member not found");
      patch.won_member_id = wonMemberId;
    } else {
      patch.won_member_id = null;
    }
  }

  if ("wonOrderId" in (body || {})) {
    const wonOrderId = normalizeOptionalText(body?.wonOrderId);
    if (wonOrderId) {
      const orderResult = await scoped.auth.supabase
        .from("orders")
        .select("id")
        .eq("tenant_id", leadResult.tenantId)
        .eq("id", wonOrderId)
        .maybeSingle();
      if (orderResult.error) return apiError(500, "INTERNAL_ERROR", orderResult.error.message);
      if (!orderResult.data) return apiError(403, "FORBIDDEN", "won order not found");
      patch.won_order_id = wonOrderId;
    } else {
      patch.won_order_id = null;
    }
  }

  if (Object.keys(patch).length === 2) return apiError(400, "FORBIDDEN", "No update payload");

  const updateResult = await scoped.auth.supabase
    .from("crm_leads")
    .update(patch)
    .eq("tenant_id", leadResult.tenantId)
    .eq("id", before.id)
    .select("id, tenant_id, branch_id, owner_staff_id, name, phone, email, gender, note, source, status, temperature, trial_at, trial_status, trial_result, trial_booking_id, next_action_at, last_followed_up_at, won_member_id, won_order_id, won_plan_code, lost_reason, created_by, updated_by, created_at, updated_at")
    .maybeSingle();
  if (updateResult.error || !updateResult.data) {
    return apiError(500, "INTERNAL_ERROR", updateResult.error?.message || "Update lead failed");
  }
  const after = updateResult.data as LeadRow;

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: leadResult.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "crm_lead_updated",
    target_type: "crm_lead",
    target_id: after.id,
    reason: typeof patch.status === "string" ? patch.status : "update",
    payload: {
      before: {
        status: before.status,
        trialStatus: before.trial_status,
        ownerStaffId: before.owner_staff_id,
        branchId: before.branch_id,
      },
      after: {
        status: after.status,
        trialStatus: after.trial_status,
        ownerStaffId: after.owner_staff_id,
        branchId: after.branch_id,
      },
    },
  }).catch(() => null);

  if ((before.trial_status !== "scheduled" || before.trial_at !== after.trial_at) && after.trial_status === "scheduled" && after.trial_at) {
    await notifyCrmTrialScheduled({
      tenantId: leadResult.tenantId,
      branchId: after.branch_id,
      leadId: after.id,
      leadName: after.name,
      ownerStaffId: after.owner_staff_id,
      trialAt: after.trial_at,
      actorId: scoped.auth.context.userId,
    }).catch(() => null);
  }

  if (before.status !== after.status && (after.status === "won" || after.status === "lost")) {
    await notifyCrmOutcomeChanged({
      tenantId: leadResult.tenantId,
      branchId: after.branch_id,
      leadId: after.id,
      leadName: after.name,
      ownerStaffId: after.owner_staff_id,
      outcome: after.status === "won" ? "won" : "lost",
      actorId: scoped.auth.context.userId,
    }).catch(() => null);
  }

  return apiSuccess({
    item: mapLead(after),
  });
}
