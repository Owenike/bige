import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import {
  normalizeOptionalText,
  parseIsoDateTime,
  parseLeadSource,
  parseLeadStatus,
  parseLeadTemperature,
  parseTrialStatus,
  toLegacyLeadStatus,
} from "../../../../lib/crm";
import { notifyCrmOutcomeChanged, notifyCrmTrialScheduled } from "../../../../lib/in-app-notifications";

type LegacyLeadStatus = "new" | "tour_scheduled" | "converted" | "lost";
type LeadAction = "lead_created" | "lead_tour_scheduled" | "lead_followup" | "lead_converted" | "lead_lost";

type LeadRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  owner_staff_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  source: string;
  status: string;
  temperature: string;
  trial_at: string | null;
  trial_status: string | null;
  trial_result: string | null;
  next_action_at: string | null;
  won_member_id: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
};

type FollowupRow = {
  id: string;
  lead_id: string;
  follow_up_type: string;
  note: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type LeadAggregate = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  interest: string | null;
  status: LegacyLeadStatus;
  createdAt: string;
  updatedAt: string;
  tourAt: string | null;
  memberId: string | null;
  note: string | null;
  lastReason: string | null;
  events: Array<{
    id: string;
    action: LeadAction | string;
    reason: string | null;
    createdAt: string;
  }>;
};

function mapLegacyAction(row: FollowupRow): LeadAction | string {
  const payloadAction = typeof row.payload?.action === "string" ? row.payload.action : "";
  if (payloadAction === "lead_created") return "lead_created";
  if (payloadAction === "schedule_tour") return "lead_tour_scheduled";
  if (payloadAction === "convert") return "lead_converted";
  if (payloadAction === "mark_lost") return "lead_lost";
  return "lead_followup";
}

function parseLegacyStatusFilter(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "new" || normalized === "tour_scheduled" || normalized === "converted" || normalized === "lost") {
    return normalized as LegacyLeadStatus;
  }
  return "all";
}

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager", "sales"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const params = new URL(request.url).searchParams;
  const statusFilter = parseLegacyStatusFilter(params.get("status") || "all");
  const limit = Math.min(200, Math.max(10, Number(params.get("limit") || 80)));

  let leadsQuery = auth.supabase
    .from("crm_leads")
    .select("id, tenant_id, branch_id, owner_staff_id, name, phone, email, note, source, status, temperature, trial_at, trial_status, trial_result, next_action_at, won_member_id, lost_reason, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("updated_at", { ascending: false })
    .limit(Math.max(200, limit * 4));

  if (auth.context.role === "sales") {
    leadsQuery = leadsQuery.or(`owner_staff_id.eq.${auth.context.userId},created_by.eq.${auth.context.userId}`);
  } else if (auth.context.role === "frontdesk" && auth.context.branchId) {
    leadsQuery = leadsQuery.eq("branch_id", auth.context.branchId);
  }

  const leadsResult = await leadsQuery;
  if (leadsResult.error) return apiError(500, "INTERNAL_ERROR", leadsResult.error.message);

  const leads = (leadsResult.data || []) as LeadRow[];
  const leadIds = leads.map((item) => item.id);
  let followups: FollowupRow[] = [];
  if (leadIds.length > 0) {
    const followupsResult = await auth.supabase
      .from("crm_lead_followups")
      .select("id, lead_id, follow_up_type, note, payload, created_at")
      .eq("tenant_id", auth.context.tenantId)
      .in("lead_id", leadIds)
      .order("created_at", { ascending: true })
      .limit(4000);
    if (followupsResult.error) return apiError(500, "INTERNAL_ERROR", followupsResult.error.message);
    followups = (followupsResult.data || []) as FollowupRow[];
  }

  const followupByLead = new Map<string, FollowupRow[]>();
  for (const row of followups) {
    const list = followupByLead.get(row.lead_id) || [];
    list.push(row);
    followupByLead.set(row.lead_id, list);
  }

  const items = leads
    .map((lead): LeadAggregate => {
      const legacyStatus = toLegacyLeadStatus({
        status: parseLeadStatus(lead.status, "new"),
        trialStatus: parseTrialStatus(lead.trial_status),
      });
      const events = (followupByLead.get(lead.id) || []).map((event) => ({
        id: event.id,
        action: mapLegacyAction(event),
        reason: event.follow_up_type === "trial" ? "trial" : null,
        createdAt: event.created_at,
      }));
      return {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        source: lead.source,
        interest: lead.temperature,
        status: legacyStatus,
        createdAt: lead.created_at,
        updatedAt: lead.updated_at,
        tourAt: lead.trial_at,
        memberId: lead.won_member_id,
        note: lead.note,
        lastReason: lead.lost_reason,
        events,
      };
    })
    .filter((lead) => (statusFilter === "all" ? true : lead.status === statusFilter))
    .slice(0, limit);

  return apiSuccess({
    items,
    summary: {
      total: items.length,
      new: items.filter((item) => item.status === "new").length,
      tourScheduled: items.filter((item) => item.status === "tour_scheduled").length,
      converted: items.filter((item) => item.status === "converted").length,
      lost: items.filter((item) => item.status === "lost").length,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager", "sales"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  let leadId = normalizeOptionalText(body?.leadId) || "";

  if (action === "create") {
    const name = normalizeOptionalText(body?.name) || "";
    if (!name) return apiError(400, "FORBIDDEN", "name is required");

    const phone = normalizeOptionalText(body?.phone);
    const source = parseLeadSource(body?.source, "walk-in");
    const note = normalizeOptionalText(body?.note);
    const trialAt = parseIsoDateTime(body?.tourAt);
    const interest = parseLeadTemperature(body?.interest, "warm");
    const branchId = auth.context.branchId || null;
    const ownerStaffId = auth.context.role === "sales" ? auth.context.userId : null;

    const createResult = await auth.supabase
      .from("crm_leads")
      .insert({
        tenant_id: auth.context.tenantId,
        branch_id: branchId,
        owner_staff_id: ownerStaffId,
        name,
        phone,
        note,
        source,
        temperature: interest,
        status: trialAt ? "trial_booked" : "new",
        trial_at: trialAt,
        trial_status: trialAt ? "scheduled" : null,
        created_by: auth.context.userId,
        updated_by: auth.context.userId,
        updated_at: new Date().toISOString(),
      })
      .select("id, tenant_id, branch_id, owner_staff_id, name, trial_at, trial_status")
      .maybeSingle();
    if (createResult.error || !createResult.data) return apiError(500, "INTERNAL_ERROR", createResult.error?.message || "Create lead failed");

    leadId = createResult.data.id;
    await auth.supabase.from("crm_lead_followups").insert({
      tenant_id: auth.context.tenantId,
      lead_id: leadId,
      branch_id: branchId,
      follow_up_type: trialAt ? "trial" : "other",
      note: note || "lead_created",
      payload: { action: "lead_created" },
      created_by: auth.context.userId,
    }).catch(() => null);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "crm_lead_created",
      target_type: "crm_lead",
      target_id: leadId,
      reason: source,
      payload: { trialAt, source, interest },
    }).catch(() => null);

    if (createResult.data.trial_at && createResult.data.trial_status === "scheduled") {
      await notifyCrmTrialScheduled({
        tenantId: auth.context.tenantId,
        branchId: createResult.data.branch_id || null,
        leadId,
        leadName: createResult.data.name,
        ownerStaffId: createResult.data.owner_staff_id || null,
        trialAt: createResult.data.trial_at,
        actorId: auth.context.userId,
      }).catch(() => null);
    }

    return apiSuccess({ leadId, action: "lead_created" });
  }

  if (!leadId) return apiError(400, "FORBIDDEN", "leadId is required");

  const leadResult = await auth.supabase
    .from("crm_leads")
    .select("id, tenant_id, branch_id, owner_staff_id, name, status")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadResult.error) return apiError(500, "INTERNAL_ERROR", leadResult.error.message);
  if (!leadResult.data) return apiError(404, "FORBIDDEN", "lead not found");

  if (auth.context.role === "sales" && leadResult.data.owner_staff_id && leadResult.data.owner_staff_id !== auth.context.userId) {
    return apiError(403, "FORBIDDEN", "Forbidden lead scope");
  }
  if (auth.context.role === "frontdesk" && auth.context.branchId && leadResult.data.branch_id && leadResult.data.branch_id !== auth.context.branchId) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden branch scope");
  }

  if (action === "schedule_tour") {
    const tourAt = parseIsoDateTime(body?.tourAt);
    if (!tourAt) return apiError(400, "FORBIDDEN", "valid tourAt is required");

    const updateResult = await auth.supabase
      .from("crm_leads")
      .update({
        trial_at: tourAt,
        trial_status: "scheduled",
        status: "trial_booked",
        note: normalizeOptionalText(body?.note),
        updated_by: auth.context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", leadId)
      .select("id, branch_id, owner_staff_id, name, trial_at")
      .maybeSingle();
    if (updateResult.error || !updateResult.data) return apiError(500, "INTERNAL_ERROR", updateResult.error?.message || "Schedule trial failed");

    await auth.supabase.from("crm_lead_followups").insert({
      tenant_id: auth.context.tenantId,
      lead_id: leadId,
      branch_id: updateResult.data.branch_id,
      follow_up_type: "trial",
      note: normalizeOptionalText(body?.note) || "trial_scheduled",
      next_action_at: tourAt,
      payload: { action: "schedule_tour", tourAt },
      created_by: auth.context.userId,
    }).catch(() => null);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "crm_trial_scheduled",
      target_type: "crm_lead",
      target_id: leadId,
      reason: "schedule_tour",
      payload: { tourAt },
    }).catch(() => null);

    await notifyCrmTrialScheduled({
      tenantId: auth.context.tenantId,
      branchId: updateResult.data.branch_id || null,
      leadId,
      leadName: updateResult.data.name,
      ownerStaffId: updateResult.data.owner_staff_id || null,
      trialAt: updateResult.data.trial_at || tourAt,
      actorId: auth.context.userId,
    }).catch(() => null);

    return apiSuccess({ leadId, action: "lead_tour_scheduled" });
  }

  if (action === "followup") {
    const note = normalizeOptionalText(body?.note);
    if (!note) return apiError(400, "FORBIDDEN", "note is required");

    await auth.supabase.from("crm_lead_followups").insert({
      tenant_id: auth.context.tenantId,
      lead_id: leadId,
      branch_id: leadResult.data.branch_id,
      follow_up_type: "other",
      note,
      payload: { action: "followup" },
      created_by: auth.context.userId,
    }).catch(() => null);

    await auth.supabase
      .from("crm_leads")
      .update({
        status: leadResult.data.status === "new" ? "contacted" : leadResult.data.status,
        last_followed_up_at: new Date().toISOString(),
        note,
        updated_by: auth.context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", leadId);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "crm_followup_created",
      target_type: "crm_lead",
      target_id: leadId,
      reason: "followup",
      payload: { note },
    }).catch(() => null);

    return apiSuccess({ leadId, action: "lead_followup" });
  }

  if (action === "convert") {
    const memberId = normalizeOptionalText(body?.memberId);
    await auth.supabase
      .from("crm_leads")
      .update({
        status: "won",
        trial_result: "won",
        won_member_id: memberId,
        note: normalizeOptionalText(body?.note),
        updated_by: auth.context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", leadId);

    await auth.supabase.from("crm_lead_followups").insert({
      tenant_id: auth.context.tenantId,
      lead_id: leadId,
      branch_id: leadResult.data.branch_id,
      follow_up_type: "consult",
      note: normalizeOptionalText(body?.note) || "lead_converted",
      payload: { action: "convert", memberId },
      created_by: auth.context.userId,
    }).catch(() => null);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "crm_lead_won",
      target_type: "crm_lead",
      target_id: leadId,
      reason: "convert",
      payload: { memberId },
    }).catch(() => null);

    await notifyCrmOutcomeChanged({
      tenantId: auth.context.tenantId,
      branchId: leadResult.data.branch_id || null,
      leadId,
      leadName: leadResult.data.name,
      ownerStaffId: leadResult.data.owner_staff_id || null,
      outcome: "won",
      actorId: auth.context.userId,
    }).catch(() => null);

    return apiSuccess({ leadId, action: "lead_converted" });
  }

  if (action === "mark_lost") {
    const reason = normalizeOptionalText(body?.reason) || "mark_lost";
    await auth.supabase
      .from("crm_leads")
      .update({
        status: "lost",
        trial_result: "lost",
        lost_reason: reason,
        note: normalizeOptionalText(body?.note),
        updated_by: auth.context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", leadId);

    await auth.supabase.from("crm_lead_followups").insert({
      tenant_id: auth.context.tenantId,
      lead_id: leadId,
      branch_id: leadResult.data.branch_id,
      follow_up_type: "consult",
      note: normalizeOptionalText(body?.note) || reason,
      payload: { action: "mark_lost", reason },
      created_by: auth.context.userId,
    }).catch(() => null);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "crm_lead_lost",
      target_type: "crm_lead",
      target_id: leadId,
      reason,
      payload: {
        note: normalizeOptionalText(body?.note),
      },
    }).catch(() => null);

    await notifyCrmOutcomeChanged({
      tenantId: auth.context.tenantId,
      branchId: leadResult.data.branch_id || null,
      leadId,
      leadName: leadResult.data.name,
      ownerStaffId: leadResult.data.owner_staff_id || null,
      outcome: "lost",
      actorId: auth.context.userId,
    }).catch(() => null);

    return apiSuccess({ leadId, action: "lead_lost" });
  }

  return apiError(400, "FORBIDDEN", "invalid action");
}
