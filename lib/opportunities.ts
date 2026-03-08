import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole, ProfileContext } from "./auth-context";
import { createSupabaseAdminClient } from "./supabase/admin";
import { createInAppNotifications } from "./in-app-notifications";

export type OpportunityType =
  | "renewal_due"
  | "low_balance"
  | "expired_no_renewal"
  | "lost_member_reactivation"
  | "trial_not_converted"
  | "crm_reactivation";

export type OpportunityStatus = "open" | "in_progress" | "won" | "lost" | "snoozed" | "archived";
export type OpportunityPriority = "low" | "medium" | "high" | "critical";

export type OpportunityRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  type: OpportunityType;
  status: OpportunityStatus;
  member_id: string | null;
  lead_id: string | null;
  source_ref_type: string;
  source_ref_id: string;
  owner_staff_id: string | null;
  priority: OpportunityPriority;
  reason: string;
  note: string | null;
  due_at: string | null;
  next_action_at: string | null;
  snoozed_until: string | null;
  won_at: string | null;
  lost_at: string | null;
  last_activity_at: string;
  dedupe_key: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type OpportunityLogRow = {
  id: string;
  tenant_id: string;
  opportunity_id: string;
  action: string;
  note: string | null;
  status_before: string | null;
  status_after: string | null;
  next_action_at: string | null;
  payload: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

type TenantRow = {
  id: string;
};

type ContractSweepRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  member_id: string;
  status: string;
  ends_at: string | null;
  remaining_uses: number | null;
  remaining_sessions: number | null;
  updated_at: string;
};

type ContractMemberRow = {
  id: string;
  store_id: string | null;
};

type LeadSweepRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  owner_staff_id: string | null;
  status: string;
  trial_status: string | null;
  trial_result: string | null;
  last_followed_up_at: string | null;
  updated_at: string;
};

type CandidateOpportunity = {
  tenant_id: string;
  branch_id: string | null;
  type: OpportunityType;
  status: OpportunityStatus;
  member_id: string | null;
  lead_id: string | null;
  source_ref_type: string;
  source_ref_id: string;
  owner_staff_id: string | null;
  priority: OpportunityPriority;
  reason: string;
  due_at: string | null;
  dedupe_key: string;
  created_by: string | null;
  updated_by: string | null;
  last_activity_at: string;
  updated_at: string;
};

export type OpportunitySummary = {
  total: number;
  open: number;
  inProgress: number;
  won: number;
  lost: number;
  snoozed: number;
  archived: number;
  highPriority: number;
  dueSoon: number;
  overdue: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
};

export type OpportunityScope = {
  tenantId: string;
  branchId: string | null;
  role: AppRole;
  userId: string;
};

export type OpportunityMapped = {
  id: string;
  tenantId: string;
  branchId: string | null;
  type: OpportunityType;
  status: OpportunityStatus;
  memberId: string | null;
  leadId: string | null;
  sourceRefType: string;
  sourceRefId: string;
  ownerStaffId: string | null;
  priority: OpportunityPriority;
  reason: string;
  note: string | null;
  dueAt: string | null;
  nextActionAt: string | null;
  snoozedUntil: string | null;
  wonAt: string | null;
  lostAt: string | null;
  dedupeKey: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  member: { id: string; fullName: string | null; phone: string | null } | null;
  lead: { id: string; name: string | null; phone: string | null; email: string | null; status: string | null } | null;
};

type SweepInput = {
  actorRole: AppRole;
  actorUserId?: string | null;
  tenantId?: string | null;
  now?: Date;
};

type SweepSummary = {
  inserted: number;
  byType: Record<string, number>;
  reminders: number;
};

function asIso(input: Date) {
  return input.toISOString();
}

function toDate(input: string | null) {
  if (!input) return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}

function upsertCount(summary: SweepSummary, type: OpportunityType) {
  summary.inserted += 1;
  summary.byType[type] = (summary.byType[type] || 0) + 1;
}

export function parseOpportunityType(input: unknown): OpportunityType | null {
  if (typeof input !== "string") return null;
  if (
    input === "renewal_due" ||
    input === "low_balance" ||
    input === "expired_no_renewal" ||
    input === "lost_member_reactivation" ||
    input === "trial_not_converted" ||
    input === "crm_reactivation"
  ) {
    return input;
  }
  return null;
}

export function parseOpportunityStatus(input: unknown): OpportunityStatus | null {
  if (typeof input !== "string") return null;
  if (input === "open" || input === "in_progress" || input === "won" || input === "lost" || input === "snoozed" || input === "archived") {
    return input;
  }
  return null;
}

export function parseOpportunityPriority(input: unknown): OpportunityPriority | null {
  if (typeof input !== "string") return null;
  if (input === "low" || input === "medium" || input === "high" || input === "critical") return input;
  return null;
}

export function canReadOpportunity(params: { context: ProfileContext; row: Pick<OpportunityRow, "owner_staff_id" | "created_by" | "branch_id"> }) {
  if (params.context.role === "platform_admin" || params.context.role === "manager") return true;
  if (params.context.role === "sales") {
    return params.row.owner_staff_id === params.context.userId || params.row.created_by === params.context.userId;
  }
  if (
    (params.context.role === "supervisor" || params.context.role === "branch_manager") &&
    params.context.branchId
  ) {
    return params.row.branch_id === null || params.row.branch_id === params.context.branchId;
  }
  return false;
}

export function mapOpportunityRow(params: {
  row: OpportunityRow;
  membersById: Map<string, { id: string; full_name: string | null; phone: string | null }>;
  leadsById: Map<string, { id: string; name: string | null; phone: string | null; email: string | null; status: string | null }>;
}): OpportunityMapped {
  const member = params.row.member_id ? params.membersById.get(params.row.member_id) || null : null;
  const lead = params.row.lead_id ? params.leadsById.get(params.row.lead_id) || null : null;
  return {
    id: params.row.id,
    tenantId: params.row.tenant_id,
    branchId: params.row.branch_id,
    type: params.row.type,
    status: params.row.status,
    memberId: params.row.member_id,
    leadId: params.row.lead_id,
    sourceRefType: params.row.source_ref_type,
    sourceRefId: params.row.source_ref_id,
    ownerStaffId: params.row.owner_staff_id,
    priority: params.row.priority,
    reason: params.row.reason,
    note: params.row.note,
    dueAt: params.row.due_at,
    nextActionAt: params.row.next_action_at,
    snoozedUntil: params.row.snoozed_until,
    wonAt: params.row.won_at,
    lostAt: params.row.lost_at,
    dedupeKey: params.row.dedupe_key,
    createdBy: params.row.created_by,
    updatedBy: params.row.updated_by,
    createdAt: params.row.created_at,
    updatedAt: params.row.updated_at,
    member: member
      ? {
          id: member.id,
          fullName: member.full_name,
          phone: member.phone,
        }
      : null,
    lead: lead
      ? {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          status: lead.status,
        }
      : null,
  };
}

export function summarizeOpportunities(rows: OpportunityRow[], now: Date) {
  const nowMs = now.getTime();
  return rows.reduce<OpportunitySummary>(
    (acc, row) => {
      acc.total += 1;
      acc.byType[row.type] = (acc.byType[row.type] || 0) + 1;
      acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + 1;
      acc.byPriority[row.priority] = (acc.byPriority[row.priority] || 0) + 1;
      if (row.status === "open") acc.open += 1;
      if (row.status === "in_progress") acc.inProgress += 1;
      if (row.status === "won") acc.won += 1;
      if (row.status === "lost") acc.lost += 1;
      if (row.status === "snoozed") acc.snoozed += 1;
      if (row.status === "archived") acc.archived += 1;
      if (row.priority === "high" || row.priority === "critical") acc.highPriority += 1;
      if (row.due_at) {
        const dueMs = new Date(row.due_at).getTime();
        if (Number.isFinite(dueMs)) {
          const diff = dueMs - nowMs;
          if (diff < 0 && row.status !== "won" && row.status !== "lost" && row.status !== "archived") acc.overdue += 1;
          if (diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000 && row.status !== "won" && row.status !== "lost" && row.status !== "archived") {
            acc.dueSoon += 1;
          }
        }
      }
      return acc;
    },
    {
      total: 0,
      open: 0,
      inProgress: 0,
      won: 0,
      lost: 0,
      snoozed: 0,
      archived: 0,
      highPriority: 0,
      dueSoon: 0,
      overdue: 0,
      byType: {},
      byStatus: {},
      byPriority: {},
    },
  );
}

async function fetchSalesOwnerMap(params: {
  supabase: SupabaseClient;
  tenantId: string;
  memberIds: string[];
}) {
  const map = new Map<string, string>();
  if (params.memberIds.length === 0) return map;
  const result = await params.supabase
    .from("crm_leads")
    .select("won_member_id, owner_staff_id, updated_at")
    .eq("tenant_id", params.tenantId)
    .in("won_member_id", params.memberIds)
    .eq("status", "won")
    .order("updated_at", { ascending: false });
  if (result.error) return map;
  for (const row of (result.data || []) as Array<{ won_member_id: string | null; owner_staff_id: string | null }>) {
    if (!row.won_member_id || !row.owner_staff_id || map.has(row.won_member_id)) continue;
    map.set(row.won_member_id, row.owner_staff_id);
  }
  return map;
}

async function loadTenantCandidates(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorId: string | null;
  now: Date;
}) {
  const nowIso = asIso(params.now);
  const nowMs = params.now.getTime();
  const renewalToIso = asIso(new Date(nowMs + 7 * 24 * 60 * 60 * 1000));
  const lowBalanceThreshold = 2;
  const lostWindowFromIso = asIso(new Date(nowMs - 90 * 24 * 60 * 60 * 1000));
  const expiredWindowFromIso = asIso(new Date(nowMs - 30 * 24 * 60 * 60 * 1000));
  const staleLeadMs = 14 * 24 * 60 * 60 * 1000;

  const [contractsResult, leadsResult] = await Promise.all([
    params.supabase
      .from("member_plan_contracts")
      .select("id, tenant_id, branch_id, member_id, status, ends_at, remaining_uses, remaining_sessions, updated_at")
      .eq("tenant_id", params.tenantId)
      .in("status", ["active", "expired", "exhausted", "canceled"])
      .gte("updated_at", lostWindowFromIso)
      .limit(3000),
    params.supabase
      .from("crm_leads")
      .select("id, tenant_id, branch_id, owner_staff_id, status, trial_status, trial_result, last_followed_up_at, updated_at")
      .eq("tenant_id", params.tenantId)
      .limit(3000),
  ]);

  if (contractsResult.error) return { ok: false as const, error: contractsResult.error.message };
  if (leadsResult.error) return { ok: false as const, error: leadsResult.error.message };

  const contracts = (contractsResult.data || []) as ContractSweepRow[];
  const leads = (leadsResult.data || []) as LeadSweepRow[];
  const memberIds = Array.from(new Set(contracts.map((item) => item.member_id)));
  const ownerByMember = await fetchSalesOwnerMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    memberIds,
  });

  const activeMembers = new Set<string>();
  for (const contract of contracts) {
    if (contract.status === "active") activeMembers.add(contract.member_id);
  }

  const candidates: CandidateOpportunity[] = [];

  for (const contract of contracts) {
    const endsAt = toDate(contract.ends_at);
    const endsMs = endsAt?.getTime() ?? null;
    const remainingUses = isFiniteNumber(contract.remaining_uses) ? contract.remaining_uses : null;
    const remainingSessions = isFiniteNumber(contract.remaining_sessions) ? contract.remaining_sessions : null;
    const ownerId = ownerByMember.get(contract.member_id) || null;
    const branchId = contract.branch_id || null;
    const updatedAt = nowIso;

    if (contract.status === "active" && endsAt && endsAt.toISOString() >= nowIso && endsAt.toISOString() <= renewalToIso) {
      candidates.push({
        tenant_id: params.tenantId,
        branch_id: branchId,
        type: "renewal_due",
        status: "open",
        member_id: contract.member_id,
        lead_id: null,
        source_ref_type: "member_plan_contract",
        source_ref_id: contract.id,
        owner_staff_id: ownerId,
        priority: endsMs !== null && endsMs - nowMs <= 3 * 24 * 60 * 60 * 1000 ? "critical" : "high",
        reason: `Contract ${contract.id.slice(0, 8)} expires on ${contract.ends_at}.`,
        due_at: contract.ends_at,
        dedupe_key: `renewal_due:${contract.id}:${contract.ends_at?.slice(0, 10) || "na"}`,
        created_by: params.actorId,
        updated_by: params.actorId,
        last_activity_at: nowIso,
        updated_at: updatedAt,
      });
    }

    const lowRemainingValue =
      remainingSessions !== null && remainingSessions > 0
        ? remainingSessions
        : remainingUses !== null && remainingUses > 0
          ? remainingUses
          : null;
    if (contract.status === "active" && lowRemainingValue !== null && lowRemainingValue <= lowBalanceThreshold) {
      candidates.push({
        tenant_id: params.tenantId,
        branch_id: branchId,
        type: "low_balance",
        status: "open",
        member_id: contract.member_id,
        lead_id: null,
        source_ref_type: "member_plan_contract",
        source_ref_id: contract.id,
        owner_staff_id: ownerId,
        priority: lowRemainingValue <= 1 ? "high" : "medium",
        reason: `Remaining balance is low (${lowRemainingValue}).`,
        due_at: asIso(new Date(nowMs + 3 * 24 * 60 * 60 * 1000)),
        dedupe_key: `low_balance:${contract.id}:${lowRemainingValue}`,
        created_by: params.actorId,
        updated_by: params.actorId,
        last_activity_at: nowIso,
        updated_at: updatedAt,
      });
    }

    const isExpiredLike = contract.status === "expired" || contract.status === "exhausted" || contract.status === "canceled";
    const endsIso = endsAt?.toISOString() || null;
    if (isExpiredLike && endsIso && endsIso >= expiredWindowFromIso && !activeMembers.has(contract.member_id)) {
      candidates.push({
        tenant_id: params.tenantId,
        branch_id: branchId,
        type: "expired_no_renewal",
        status: "open",
        member_id: contract.member_id,
        lead_id: null,
        source_ref_type: "member_plan_contract",
        source_ref_id: contract.id,
        owner_staff_id: ownerId,
        priority: "high",
        reason: `Contract expired with no active renewal.`,
        due_at: asIso(new Date(nowMs + 2 * 24 * 60 * 60 * 1000)),
        dedupe_key: `expired_no_renewal:${contract.member_id}:${contract.id}:${endsIso.slice(0, 10)}`,
        created_by: params.actorId,
        updated_by: params.actorId,
        last_activity_at: nowIso,
        updated_at: updatedAt,
      });
    }

    if (isExpiredLike && endsIso && endsIso >= lostWindowFromIso && !activeMembers.has(contract.member_id)) {
      candidates.push({
        tenant_id: params.tenantId,
        branch_id: branchId,
        type: "lost_member_reactivation",
        status: "open",
        member_id: contract.member_id,
        lead_id: null,
        source_ref_type: "member",
        source_ref_id: contract.member_id,
        owner_staff_id: ownerId,
        priority: "medium",
        reason: "Past member is inactive and eligible for reactivation outreach.",
        due_at: asIso(new Date(nowMs + 7 * 24 * 60 * 60 * 1000)),
        dedupe_key: `lost_member_reactivation:${contract.member_id}:${endsIso.slice(0, 10)}`,
        created_by: params.actorId,
        updated_by: params.actorId,
        last_activity_at: nowIso,
        updated_at: updatedAt,
      });
    }
  }

  for (const lead of leads) {
    const lastTouch = toDate(lead.last_followed_up_at || lead.updated_at);
    const lastTouchMs = lastTouch?.getTime() ?? nowMs;
    const isTrialCompleted = lead.status === "trial_completed" || lead.trial_status === "attended";
    if (isTrialCompleted && lead.status !== "won" && lead.status !== "lost") {
      candidates.push({
        tenant_id: params.tenantId,
        branch_id: lead.branch_id || null,
        type: "trial_not_converted",
        status: "open",
        member_id: null,
        lead_id: lead.id,
        source_ref_type: "crm_lead",
        source_ref_id: lead.id,
        owner_staff_id: lead.owner_staff_id || null,
        priority: "high",
        reason: "Trial completed but conversion is pending.",
        due_at: asIso(new Date(nowMs + 2 * 24 * 60 * 60 * 1000)),
        dedupe_key: `trial_not_converted:${lead.id}:${lead.updated_at.slice(0, 10)}`,
        created_by: params.actorId,
        updated_by: params.actorId,
        last_activity_at: nowIso,
        updated_at: nowIso,
      });
    }

    const stale = nowMs - lastTouchMs >= staleLeadMs;
    if (
      stale &&
      lead.status !== "won" &&
      lead.status !== "lost" &&
      lead.status !== "dormant"
    ) {
      candidates.push({
        tenant_id: params.tenantId,
        branch_id: lead.branch_id || null,
        type: "crm_reactivation",
        status: "open",
        member_id: null,
        lead_id: lead.id,
        source_ref_type: "crm_lead",
        source_ref_id: lead.id,
        owner_staff_id: lead.owner_staff_id || null,
        priority: "medium",
        reason: "Lead has not been followed up for more than 14 days.",
        due_at: asIso(new Date(nowMs + 3 * 24 * 60 * 60 * 1000)),
        dedupe_key: `crm_reactivation:${lead.id}:${lastTouch?.toISOString().slice(0, 10) || "na"}`,
        created_by: params.actorId,
        updated_by: params.actorId,
        last_activity_at: nowIso,
        updated_at: nowIso,
      });
    }
  }

  return { ok: true as const, candidates };
}

async function notifyOpportunityInserted(params: {
  supabase: SupabaseClient;
  row: OpportunityRow;
  actorId: string | null;
}) {
  const recipients: AppRole[] = ["manager"];
  const recipientUserIds = params.row.owner_staff_id ? [params.row.owner_staff_id] : [];
  await createInAppNotifications({
    supabase: params.supabase,
    tenantId: params.row.tenant_id,
    branchId: params.row.branch_id,
    recipientRoles: recipients,
    recipientUserIds,
    title: "New renewal/reactivation opportunity",
    message: `${params.row.type} | ${params.row.reason}`,
    severity: params.row.priority === "critical" ? "critical" : params.row.priority === "high" ? "warning" : "info",
    eventType: "opportunity_created",
    targetType: "crm_opportunity",
    targetId: params.row.id,
    actionUrl: "/manager/opportunities",
    dedupeKey: `opportunity-created:${params.row.id}`,
    createdBy: params.actorId,
  }).catch(() => null);
}

async function notifyOpportunityReminder(params: {
  supabase: SupabaseClient;
  row: OpportunityRow;
  actorId: string | null;
  eventType: "opportunity_due_soon" | "opportunity_stale";
}) {
  const recipientUserIds = params.row.owner_staff_id ? [params.row.owner_staff_id] : [];
  const message =
    params.eventType === "opportunity_due_soon"
      ? `Opportunity ${params.row.type} is due soon.`
      : `Opportunity ${params.row.type} has not been updated recently.`;
  await createInAppNotifications({
    supabase: params.supabase,
    tenantId: params.row.tenant_id,
    branchId: params.row.branch_id,
    recipientRoles: ["manager"],
    recipientUserIds,
    title: "Opportunity reminder",
    message,
    severity: params.eventType === "opportunity_due_soon" ? "warning" : "info",
    eventType: params.eventType,
    targetType: "crm_opportunity",
    targetId: params.row.id,
    actionUrl: "/manager/opportunities",
    dedupeKey: `${params.eventType}:${params.row.id}:${new Date().toISOString().slice(0, 10)}`,
    createdBy: params.actorId,
  }).catch(() => null);
}

export async function runOpportunitySweep(input: SweepInput): Promise<{ ok: true; summary: SweepSummary } | { ok: false; error: string }> {
  const supabase = createSupabaseAdminClient();
  const now = input.now ?? new Date();
  let tenantQuery = supabase.from("tenants").select("id");
  if (input.actorRole !== "platform_admin") {
    if (!input.tenantId) return { ok: false, error: "Missing tenant scope" };
    tenantQuery = tenantQuery.eq("id", input.tenantId);
  } else if (input.tenantId) {
    tenantQuery = tenantQuery.eq("id", input.tenantId);
  }
  const tenantsResult = await tenantQuery.limit(300);
  if (tenantsResult.error) return { ok: false, error: tenantsResult.error.message };
  const tenants = (tenantsResult.data || []) as TenantRow[];
  const summary: SweepSummary = { inserted: 0, byType: {}, reminders: 0 };
  if (tenants.length === 0) return { ok: true, summary };

  for (const tenant of tenants) {
    const candidateResult = await loadTenantCandidates({
      supabase,
      tenantId: tenant.id,
      actorId: input.actorUserId || null,
      now,
    });
    if (!candidateResult.ok) return { ok: false, error: candidateResult.error };
    const candidates = candidateResult.candidates;
    if (candidates.length > 0) {
      const dedupeKeys = Array.from(new Set(candidates.map((item) => item.dedupe_key)));
      const existingResult = await supabase
        .from("crm_opportunities")
        .select("id, dedupe_key")
        .eq("tenant_id", tenant.id)
        .in("dedupe_key", dedupeKeys);
      if (existingResult.error) return { ok: false, error: existingResult.error.message };
      const existing = new Set(((existingResult.data || []) as Array<{ dedupe_key: string }>).map((row) => row.dedupe_key));
      const seen = new Set<string>();
      const insertRows = candidates.filter((item) => {
        if (existing.has(item.dedupe_key)) return false;
        if (seen.has(item.dedupe_key)) return false;
        seen.add(item.dedupe_key);
        return true;
      });
      if (insertRows.length > 0) {
        const insertedResult = await supabase
          .from("crm_opportunities")
          .insert(insertRows)
          .select("id, tenant_id, branch_id, type, status, member_id, lead_id, source_ref_type, source_ref_id, owner_staff_id, priority, reason, note, due_at, next_action_at, snoozed_until, won_at, lost_at, last_activity_at, dedupe_key, created_by, updated_by, created_at, updated_at");
        if (insertedResult.error) return { ok: false, error: insertedResult.error.message };
        const inserted = (insertedResult.data || []) as OpportunityRow[];

        if (inserted.length > 0) {
          const logs = inserted.map((row) => ({
            tenant_id: row.tenant_id,
            opportunity_id: row.id,
            action: "auto_created",
            note: row.reason,
            status_before: null,
            status_after: row.status,
            next_action_at: row.next_action_at,
            payload: {
              type: row.type,
              priority: row.priority,
              dedupeKey: row.dedupe_key,
            },
            created_by: input.actorUserId || null,
          }));
          await supabase.from("crm_opportunity_logs").insert(logs);
        }

        for (const row of inserted) {
          upsertCount(summary, row.type);
          await notifyOpportunityInserted({
            supabase,
            row,
            actorId: input.actorUserId || null,
          });
        }
      }
    }

    const dueSoonIso = asIso(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const staleIso = asIso(new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000));
    const [dueSoonResult, staleResult] = await Promise.all([
      supabase
        .from("crm_opportunities")
        .select("id, tenant_id, branch_id, type, status, member_id, lead_id, source_ref_type, source_ref_id, owner_staff_id, priority, reason, note, due_at, next_action_at, snoozed_until, won_at, lost_at, last_activity_at, dedupe_key, created_by, updated_by, created_at, updated_at")
        .eq("tenant_id", tenant.id)
        .in("status", ["open", "in_progress"])
        .not("due_at", "is", null)
        .lte("due_at", dueSoonIso)
        .gte("due_at", asIso(now))
        .limit(80),
      supabase
        .from("crm_opportunities")
        .select("id, tenant_id, branch_id, type, status, member_id, lead_id, source_ref_type, source_ref_id, owner_staff_id, priority, reason, note, due_at, next_action_at, snoozed_until, won_at, lost_at, last_activity_at, dedupe_key, created_by, updated_by, created_at, updated_at")
        .eq("tenant_id", tenant.id)
        .in("status", ["open", "in_progress"])
        .lte("updated_at", staleIso)
        .limit(80),
    ]);
    if (dueSoonResult.error) return { ok: false, error: dueSoonResult.error.message };
    if (staleResult.error) return { ok: false, error: staleResult.error.message };
    for (const row of (dueSoonResult.data || []) as OpportunityRow[]) {
      await notifyOpportunityReminder({
        supabase,
        row,
        actorId: input.actorUserId || null,
        eventType: "opportunity_due_soon",
      });
      summary.reminders += 1;
    }
    for (const row of (staleResult.data || []) as OpportunityRow[]) {
      await notifyOpportunityReminder({
        supabase,
        row,
        actorId: input.actorUserId || null,
        eventType: "opportunity_stale",
      });
      summary.reminders += 1;
    }
  }

  return { ok: true, summary };
}

export async function appendOpportunityLog(params: {
  supabase: SupabaseClient;
  tenantId: string;
  opportunityId: string;
  action: string;
  note?: string | null;
  statusBefore?: string | null;
  statusAfter?: string | null;
  nextActionAt?: string | null;
  payload?: Record<string, unknown>;
  actorId: string;
}) {
  await params.supabase.from("crm_opportunity_logs").insert({
    tenant_id: params.tenantId,
    opportunity_id: params.opportunityId,
    action: params.action,
    note: params.note || null,
    status_before: params.statusBefore || null,
    status_after: params.statusAfter || null,
    next_action_at: params.nextActionAt || null,
    payload: params.payload || {},
    created_by: params.actorId,
  });
}

export async function listOpportunityLogs(params: {
  supabase: SupabaseClient;
  tenantId: string;
  opportunityId: string;
  limit?: number;
}) {
  const result = await params.supabase
    .from("crm_opportunity_logs")
    .select("id, tenant_id, opportunity_id, action, note, status_before, status_after, next_action_at, payload, created_by, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("opportunity_id", params.opportunityId)
    .order("created_at", { ascending: false })
    .limit(Math.min(300, Math.max(1, params.limit || 80)));
  if (result.error) return { ok: false as const, error: result.error.message };
  return { ok: true as const, items: (result.data || []) as OpportunityLogRow[] };
}

export async function buildOpportunityContextMaps(params: {
  supabase: SupabaseClient;
  tenantId: string;
  rows: OpportunityRow[];
}) {
  const memberIds = Array.from(
    new Set(
      params.rows
        .map((row) => row.member_id || "")
        .filter((value) => value.length > 0),
    ),
  );
  const leadIds = Array.from(
    new Set(
      params.rows
        .map((row) => row.lead_id || "")
        .filter((value) => value.length > 0),
    ),
  );
  const membersById = new Map<string, { id: string; full_name: string | null; phone: string | null }>();
  const leadsById = new Map<string, { id: string; name: string | null; phone: string | null; email: string | null; status: string | null }>();

  if (memberIds.length > 0) {
    const memberResult = await params.supabase
      .from("members")
      .select("id, full_name, phone")
      .eq("tenant_id", params.tenantId)
      .in("id", memberIds);
    if (memberResult.error) return { ok: false as const, error: memberResult.error.message };
    for (const row of (memberResult.data || []) as Array<{ id: string; full_name: string | null; phone: string | null }>) {
      membersById.set(row.id, row);
    }
  }

  if (leadIds.length > 0) {
    const leadResult = await params.supabase
      .from("crm_leads")
      .select("id, name, phone, email, status")
      .eq("tenant_id", params.tenantId)
      .in("id", leadIds);
    if (leadResult.error) return { ok: false as const, error: leadResult.error.message };
    for (const row of (leadResult.data || []) as Array<{ id: string; name: string | null; phone: string | null; email: string | null; status: string | null }>) {
      leadsById.set(row.id, row);
    }
  }

  return { ok: true as const, membersById, leadsById };
}
