import { createSupabaseAdminClient } from "./supabase/admin";
import { evaluateTenantAccess, type TenantStatus, type TenantSubscriptionSnapshot } from "./tenant-subscription";

type TenantRow = {
  id: string;
  name: string;
  status: TenantStatus;
};

type TenantSubscriptionRow = {
  tenant_id: string;
  plan_id: string | null;
  plan_code: string | null;
  status: TenantSubscriptionSnapshot["status"];
  starts_at: string | null;
  ends_at: string | null;
  grace_ends_at: string | null;
};

type PlanRow = {
  id: string;
  code: string;
  name: string;
};

type DeliveryRow = {
  tenant_id: string | null;
  status: string | null;
  channel: string | null;
  created_at: string;
  error_code: string | null;
  error_message: string | null;
  source_ref_type: string | null;
  source_ref_id: string | null;
};

type JobRunRow = {
  tenant_id: string | null;
  job_type: string;
  trigger_mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  affected_count: number | null;
  error_count: number | null;
  error_summary: string | null;
  created_at: string;
};

type ShiftRow = {
  tenant_id: string | null;
  status: string;
  opened_at: string;
  difference: number | string | null;
  branch_id: string | null;
  closing_confirmed: boolean | null;
};

type HighRiskRow = {
  tenant_id: string | null;
  status: string;
  action: string | null;
  created_at: string;
};

type OpportunityRow = {
  tenant_id: string | null;
  type: string;
  status: string;
  due_at: string | null;
  priority: string;
  owner_staff_id: string | null;
  updated_at: string;
  reason: string;
  id: string;
};

type LeadRow = {
  tenant_id: string | null;
  status: string;
  trial_status: string | null;
  trial_result: string | null;
  source: string | null;
  owner_staff_id: string | null;
  last_followed_up_at: string | null;
  updated_at: string;
};

type ContractRow = {
  tenant_id: string | null;
  member_id: string;
  status: string;
  ends_at: string | null;
  remaining_uses: number | null;
  remaining_sessions: number | null;
  id: string;
};

type AuditUnreconciledRow = {
  tenant_id: string | null;
  action: string;
  target_id: string | null;
  created_at: string;
};

type ShiftItemRefRow = {
  tenant_id: string | null;
  event_type: string | null;
  ref_id: string | null;
};

type TenantSummaryInternal = {
  tenantId: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  subscription: {
    planCode: string | null;
    planName: string | null;
    status: TenantSubscriptionSnapshot["status"] | "none";
    startsAt: string | null;
    endsAt: string | null;
    graceEndsAt: string | null;
    isUsable: boolean;
    blockedCode: string | null;
    warningCode: "SUBSCRIPTION_GRACE" | "SUBSCRIPTION_EXPIRING_SOON" | null;
    remainingDays: number | null;
  };
  notificationOps: {
    failedDeliveries: number;
    retryingDeliveries: number;
    lastJobStatus: string | null;
    lastJobAt: string | null;
    lastNotificationSweepStatus: string | null;
    lastOpportunitySweepStatus: string | null;
    lastDispatchStatus: string | null;
  };
  anomalies: {
    unreconciledEvents: number;
    openShifts: number;
    openShiftsTooLong: number;
    shiftsWithDifference: number;
    pendingApprovals: number;
  };
  opportunities: {
    open: number;
    overdue: number;
    highPriority: number;
    trialNotConverted: number;
    expiredNoRenewal: number;
  };
  crm: {
    staleLeads: number;
    trialNotConvertedLeads: number;
  };
  memberRisk: {
    expiringMembers7d: number;
    lowBalanceContracts: number;
    expiredNoRenewal: number;
  };
};

export type PlatformTenantOpsOverviewItem = TenantSummaryInternal & {
  supportScore: number;
  supportFlags: string[];
};

export type PlatformTenantOpsOverview = {
  generatedAt: string;
  rangeDays: number;
  totals: {
    tenants: number;
    blockedTenants: number;
    tenantsWithAnomalies: number;
    tenantsNeedingSupport: number;
    failedDeliveries: number;
    unreconciledEvents: number;
    overdueOpportunities: number;
  };
  items: PlatformTenantOpsOverviewItem[];
  warnings: string[];
};

export type PlatformTenantOpsDetail = {
  generatedAt: string;
  tenant: PlatformTenantOpsOverviewItem;
  recent: {
    failedDeliveries: Array<{
      createdAt: string;
      channel: string | null;
      status: string | null;
      sourceRefType: string | null;
      sourceRefId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }>;
    jobRuns: Array<{
      createdAt: string;
      jobType: string;
      triggerMode: string;
      status: string;
      errorCount: number;
      errorSummary: string | null;
    }>;
    pendingApprovals: Array<{
      action: string | null;
      createdAt: string;
    }>;
    overdueOpportunities: Array<{
      id: string;
      type: string;
      priority: string;
      dueAt: string | null;
      ownerStaffId: string | null;
      reason: string;
    }>;
    expiringContracts: Array<{
      contractId: string;
      memberId: string;
      endsAt: string | null;
      remainingUses: number | null;
      remainingSessions: number | null;
    }>;
  };
  supportLinks: {
    subscription: string;
    notificationsOps: string;
    observability: string;
    audit: string;
    opportunities: string;
    crm: string;
    managerSummary: string;
    handover: string;
  };
  warnings: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_SHIFT_TOO_LONG_HOURS = 12;

function isMissingTableError(message: string | undefined, table: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = table.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target))
  );
}

function asNumber(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapAuditActionToShiftEventType(action: string) {
  if (action === "payment_refund") return "payment_refunded";
  if (action === "order_void") return "order_voided";
  if (action === "invoice_void") return "invoice_voided";
  if (action === "invoice_allowance") return "invoice_allowance";
  return null;
}

function dedupeKey(tenantId: string, eventType: string, refId: string) {
  return `${tenantId}:${eventType}:${refId}`;
}

function makeBaseSummary(tenant: TenantRow): TenantSummaryInternal {
  return {
    tenantId: tenant.id,
    tenantName: tenant.name || tenant.id,
    tenantStatus: tenant.status ?? null,
    subscription: {
      planCode: null,
      planName: null,
      status: "none",
      startsAt: null,
      endsAt: null,
      graceEndsAt: null,
      isUsable: false,
      blockedCode: "SUBSCRIPTION_NOT_FOUND",
      warningCode: null,
      remainingDays: null,
    },
    notificationOps: {
      failedDeliveries: 0,
      retryingDeliveries: 0,
      lastJobStatus: null,
      lastJobAt: null,
      lastNotificationSweepStatus: null,
      lastOpportunitySweepStatus: null,
      lastDispatchStatus: null,
    },
    anomalies: {
      unreconciledEvents: 0,
      openShifts: 0,
      openShiftsTooLong: 0,
      shiftsWithDifference: 0,
      pendingApprovals: 0,
    },
    opportunities: {
      open: 0,
      overdue: 0,
      highPriority: 0,
      trialNotConverted: 0,
      expiredNoRenewal: 0,
    },
    crm: {
      staleLeads: 0,
      trialNotConvertedLeads: 0,
    },
    memberRisk: {
      expiringMembers7d: 0,
      lowBalanceContracts: 0,
      expiredNoRenewal: 0,
    },
  };
}

async function loadOverviewData(input: { tenantId?: string | null; rangeDays: number }) {
  const admin = createSupabaseAdminClient();
  const warnings: string[] = [];
  const now = new Date();
  const nowMs = now.getTime();
  const sinceIso = new Date(nowMs - input.rangeDays * DAY_MS).toISOString();
  const expiringToIso = new Date(nowMs + 7 * DAY_MS).toISOString();
  const staleLeadThreshold = nowMs - 14 * DAY_MS;
  const openShiftTooLongThreshold = nowMs - OPEN_SHIFT_TOO_LONG_HOURS * 60 * 60 * 1000;

  let tenantsQuery = admin.from("tenants").select("id, name, status").order("created_at", { ascending: false });
  if (input.tenantId) tenantsQuery = tenantsQuery.eq("id", input.tenantId);
  const tenantsResult = await tenantsQuery;
  if (tenantsResult.error) return { ok: false as const, error: tenantsResult.error.message };
  const tenants = (tenantsResult.data || []) as TenantRow[];
  const tenantIds = tenants.map((item) => item.id);
  if (tenantIds.length === 0) {
    return {
      ok: true as const,
      warnings,
      now,
      sinceIso,
      tenants,
      summaries: [] as TenantSummaryInternal[],
      deliveries: [] as DeliveryRow[],
      jobRuns: [] as JobRunRow[],
      highRiskPending: [] as HighRiskRow[],
      opportunities: [] as OpportunityRow[],
      contracts: [] as ContractRow[],
    };
  }

  const [tenantSubsResult, deliveriesResult, jobRunsResult, highRiskResult, shiftsOpenResult, shiftsClosedResult, opportunitiesResult, leadsResult, contractsResult, auditResult, shiftItemsResult] =
    await Promise.all([
      admin
        .from("tenant_subscriptions")
        .select("tenant_id, plan_id, plan_code, status, starts_at, ends_at, grace_ends_at")
        .in("tenant_id", tenantIds)
        .eq("is_current", true),
      admin
        .from("notification_deliveries")
        .select("tenant_id, status, channel, created_at, error_code, error_message, source_ref_type, source_ref_id")
        .in("tenant_id", tenantIds)
        .gte("created_at", sinceIso)
        .limit(20000),
      admin
        .from("notification_job_runs")
        .select("tenant_id, job_type, trigger_mode, status, started_at, finished_at, affected_count, error_count, error_summary, created_at")
        .in("tenant_id", tenantIds)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(20000),
      admin
        .from("high_risk_action_requests")
        .select("tenant_id, status, action, created_at")
        .in("tenant_id", tenantIds)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10000),
      admin
        .from("frontdesk_shifts")
        .select("tenant_id, status, opened_at, difference, branch_id, closing_confirmed")
        .in("tenant_id", tenantIds)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(10000),
      admin
        .from("frontdesk_shifts")
        .select("tenant_id, status, opened_at, difference, branch_id, closing_confirmed")
        .in("tenant_id", tenantIds)
        .eq("status", "closed")
        .gte("opened_at", sinceIso)
        .order("opened_at", { ascending: false })
        .limit(20000),
      admin
        .from("crm_opportunities")
        .select("tenant_id, type, status, due_at, priority, owner_staff_id, updated_at, reason, id")
        .in("tenant_id", tenantIds)
        .order("updated_at", { ascending: false })
        .limit(20000),
      admin
        .from("crm_leads")
        .select("tenant_id, status, trial_status, trial_result, source, owner_staff_id, last_followed_up_at, updated_at")
        .in("tenant_id", tenantIds)
        .order("updated_at", { ascending: false })
        .limit(20000),
      admin
        .from("member_plan_contracts")
        .select("tenant_id, member_id, status, ends_at, remaining_uses, remaining_sessions, id")
        .in("tenant_id", tenantIds)
        .in("status", ["active", "expired", "exhausted", "canceled"])
        .limit(30000),
      admin
        .from("audit_logs")
        .select("tenant_id, action, target_id, created_at")
        .in("tenant_id", tenantIds)
        .in("action", ["payment_refund", "order_void", "invoice_void", "invoice_allowance"])
        .gte("created_at", sinceIso)
        .limit(30000),
      admin
        .from("frontdesk_shift_items")
        .select("tenant_id, event_type, ref_id")
        .in("tenant_id", tenantIds)
        .in("event_type", ["payment_refunded", "order_voided", "invoice_voided", "invoice_allowance"])
        .gte("created_at", sinceIso)
        .limit(30000),
    ]);

  if (tenantSubsResult.error) return { ok: false as const, error: tenantSubsResult.error.message };
  if (deliveriesResult.error) return { ok: false as const, error: deliveriesResult.error.message };
  if (jobRunsResult.error) return { ok: false as const, error: jobRunsResult.error.message };
  if (highRiskResult.error && !isMissingTableError(highRiskResult.error.message, "high_risk_action_requests")) {
    return { ok: false as const, error: highRiskResult.error.message };
  }
  if (highRiskResult.error) warnings.push("high_risk_action_requests table missing");
  if (shiftsOpenResult.error && !isMissingTableError(shiftsOpenResult.error.message, "frontdesk_shifts")) {
    return { ok: false as const, error: shiftsOpenResult.error.message };
  }
  if (shiftsClosedResult.error && !isMissingTableError(shiftsClosedResult.error.message, "frontdesk_shifts")) {
    return { ok: false as const, error: shiftsClosedResult.error.message };
  }
  if (shiftsOpenResult.error || shiftsClosedResult.error) warnings.push("frontdesk_shifts table missing");
  if (opportunitiesResult.error && !isMissingTableError(opportunitiesResult.error.message, "crm_opportunities")) {
    return { ok: false as const, error: opportunitiesResult.error.message };
  }
  if (opportunitiesResult.error) warnings.push("crm_opportunities table missing");
  if (leadsResult.error && !isMissingTableError(leadsResult.error.message, "crm_leads")) {
    return { ok: false as const, error: leadsResult.error.message };
  }
  if (leadsResult.error) warnings.push("crm_leads table missing");
  if (contractsResult.error && !isMissingTableError(contractsResult.error.message, "member_plan_contracts")) {
    return { ok: false as const, error: contractsResult.error.message };
  }
  if (contractsResult.error) warnings.push("member_plan_contracts table missing");
  if (auditResult.error) return { ok: false as const, error: auditResult.error.message };
  if (shiftItemsResult.error) return { ok: false as const, error: shiftItemsResult.error.message };

  const subs = (tenantSubsResult.data || []) as TenantSubscriptionRow[];
  const planIds = Array.from(new Set(subs.map((item) => item.plan_id).filter((id): id is string => Boolean(id))));
  const planNameById = new Map<string, string>();
  if (planIds.length > 0) {
    const plansResult = await admin.from("saas_plans").select("id, code, name").in("id", planIds);
    if (plansResult.error) return { ok: false as const, error: plansResult.error.message };
    for (const row of (plansResult.data || []) as PlanRow[]) {
      planNameById.set(row.id, row.name);
    }
  }

  const summaries = tenants.map((tenant) => makeBaseSummary(tenant));
  const summaryByTenant = new Map(summaries.map((item) => [item.tenantId, item]));

  for (const row of subs) {
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    const snapshot: TenantSubscriptionSnapshot = {
      status: row.status ?? null,
      startsAt: row.starts_at ?? null,
      endsAt: row.ends_at ?? null,
      graceEndsAt: row.grace_ends_at ?? null,
      planCode: row.plan_code ?? null,
      planName: row.plan_id ? planNameById.get(row.plan_id) || null : null,
    };
    const access = evaluateTenantAccess({
      tenantStatus: summary.tenantStatus,
      subscription: snapshot,
      now,
    });
    summary.subscription = {
      planCode: snapshot.planCode,
      planName: snapshot.planName,
      status: access.effectiveStatus,
      startsAt: snapshot.startsAt,
      endsAt: snapshot.endsAt,
      graceEndsAt: snapshot.graceEndsAt,
      isUsable: access.allowed,
      blockedCode: access.blockedCode,
      warningCode: access.warningCode,
      remainingDays: access.remainingDays,
    };
  }

  const deliveries = (deliveriesResult.data || []) as DeliveryRow[];
  for (const row of deliveries) {
    if (!row.tenant_id) continue;
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    if (row.status === "failed") summary.notificationOps.failedDeliveries += 1;
    if (row.status === "retrying") summary.notificationOps.retryingDeliveries += 1;
  }

  const jobRuns = (jobRunsResult.data || []) as JobRunRow[];
  for (const row of jobRuns) {
    if (!row.tenant_id) continue;
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    if (!summary.notificationOps.lastJobAt || new Date(row.created_at).getTime() > new Date(summary.notificationOps.lastJobAt).getTime()) {
      summary.notificationOps.lastJobAt = row.created_at;
      summary.notificationOps.lastJobStatus = row.status;
    }
    if (row.job_type === "notification_sweep" && summary.notificationOps.lastNotificationSweepStatus === null) {
      summary.notificationOps.lastNotificationSweepStatus = row.status;
    }
    if (row.job_type === "opportunity_sweep" && summary.notificationOps.lastOpportunitySweepStatus === null) {
      summary.notificationOps.lastOpportunitySweepStatus = row.status;
    }
    if (row.job_type === "delivery_dispatch" && summary.notificationOps.lastDispatchStatus === null) {
      summary.notificationOps.lastDispatchStatus = row.status;
    }
  }

  const pendingHighRisk = (highRiskResult.data || []) as HighRiskRow[];
  for (const row of pendingHighRisk) {
    if (!row.tenant_id) continue;
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    summary.anomalies.pendingApprovals += 1;
  }

  const openShifts = (shiftsOpenResult.data || []) as ShiftRow[];
  for (const row of openShifts) {
    if (!row.tenant_id) continue;
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    summary.anomalies.openShifts += 1;
    const openedMs = asDate(row.opened_at)?.getTime() ?? nowMs;
    if (openedMs <= openShiftTooLongThreshold) {
      summary.anomalies.openShiftsTooLong += 1;
    }
  }

  const closedShifts = (shiftsClosedResult.data || []) as ShiftRow[];
  for (const row of closedShifts) {
    if (!row.tenant_id) continue;
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    if (Math.abs(asNumber(row.difference)) >= 0.01) {
      summary.anomalies.shiftsWithDifference += 1;
    }
  }

  const opportunities = (opportunitiesResult.data || []) as OpportunityRow[];
  for (const row of opportunities) {
    if (!row.tenant_id) continue;
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    const isOpenState = row.status === "open" || row.status === "in_progress" || row.status === "snoozed";
    if (isOpenState) summary.opportunities.open += 1;
    if ((row.priority === "high" || row.priority === "critical") && isOpenState) {
      summary.opportunities.highPriority += 1;
    }
    if (row.type === "trial_not_converted" && isOpenState) summary.opportunities.trialNotConverted += 1;
    if (row.type === "expired_no_renewal" && isOpenState) {
      summary.opportunities.expiredNoRenewal += 1;
      summary.memberRisk.expiredNoRenewal += 1;
    }
    const dueMs = asDate(row.due_at)?.getTime() ?? null;
    if (dueMs !== null && dueMs < nowMs && isOpenState) {
      summary.opportunities.overdue += 1;
    }
  }

  const leads = (leadsResult.data || []) as LeadRow[];
  for (const row of leads) {
    if (!row.tenant_id) continue;
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    const activeLead = row.status !== "won" && row.status !== "lost" && row.status !== "dormant";
    const touchMs = asDate(row.last_followed_up_at || row.updated_at)?.getTime() ?? nowMs;
    if (activeLead && touchMs <= staleLeadThreshold) {
      summary.crm.staleLeads += 1;
    }
    const trialNotConverted =
      (row.status === "trial_completed" || row.trial_status === "attended") &&
      row.status !== "won" &&
      row.status !== "lost";
    if (trialNotConverted) {
      summary.crm.trialNotConvertedLeads += 1;
    }
  }

  const contracts = (contractsResult.data || []) as ContractRow[];
  const expiringMemberSets = new Map<string, Set<string>>();
  for (const row of contracts) {
    if (!row.tenant_id) continue;
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    if (row.status !== "active") continue;

    const endsMs = asDate(row.ends_at)?.getTime() ?? null;
    if (endsMs !== null && endsMs >= nowMs && endsMs <= new Date(expiringToIso).getTime()) {
      let memberSet = expiringMemberSets.get(row.tenant_id);
      if (!memberSet) {
        memberSet = new Set<string>();
        expiringMemberSets.set(row.tenant_id, memberSet);
      }
      memberSet.add(row.member_id);
    }

    const remainingCandidates = [row.remaining_sessions, row.remaining_uses].filter((value): value is number => Number.isFinite(Number(value)));
    const remaining = remainingCandidates.length > 0 ? Math.min(...remainingCandidates) : null;
    if (remaining !== null && remaining > 0 && remaining <= 2) {
      summary.memberRisk.lowBalanceContracts += 1;
    }
  }
  for (const [tenantId, members] of expiringMemberSets.entries()) {
    const summary = summaryByTenant.get(tenantId);
    if (!summary) continue;
    summary.memberRisk.expiringMembers7d = members.size;
  }

  const auditRows = (auditResult.data || []) as AuditUnreconciledRow[];
  const shiftRefRows = (shiftItemsResult.data || []) as ShiftItemRefRow[];
  const reconciledKeys = new Set<string>();
  for (const row of shiftRefRows) {
    if (!row.tenant_id || !row.event_type || !row.ref_id) continue;
    reconciledKeys.add(dedupeKey(row.tenant_id, row.event_type, row.ref_id));
  }
  for (const row of auditRows) {
    if (!row.tenant_id || !row.target_id) continue;
    const eventType = mapAuditActionToShiftEventType(row.action);
    if (!eventType) continue;
    const key = dedupeKey(row.tenant_id, eventType, row.target_id);
    if (reconciledKeys.has(key)) continue;
    const summary = summaryByTenant.get(row.tenant_id);
    if (!summary) continue;
    summary.anomalies.unreconciledEvents += 1;
  }

  return {
    ok: true as const,
    warnings,
    now,
    sinceIso,
    tenants,
    summaries,
    deliveries,
    jobRuns,
    highRiskPending: pendingHighRisk,
    opportunities,
    contracts,
  };
}

function buildSupportFlags(item: TenantSummaryInternal) {
  const flags: string[] = [];
  if (!item.subscription.isUsable) flags.push("subscription_blocked");
  if (item.subscription.warningCode === "SUBSCRIPTION_GRACE") flags.push("subscription_grace");
  if (item.notificationOps.failedDeliveries > 0) flags.push("failed_deliveries");
  if (item.notificationOps.retryingDeliveries > 0) flags.push("retrying_deliveries");
  if (item.anomalies.unreconciledEvents > 0) flags.push("unreconciled_events");
  if (item.anomalies.openShiftsTooLong > 0) flags.push("open_shift_too_long");
  if (item.anomalies.shiftsWithDifference > 0) flags.push("shift_difference");
  if (item.anomalies.pendingApprovals > 0) flags.push("pending_approvals");
  if (item.opportunities.overdue > 0) flags.push("opportunity_overdue");
  if (item.crm.staleLeads > 0) flags.push("crm_stale_leads");
  if (item.memberRisk.expiringMembers7d > 0) flags.push("member_expiring_soon");
  if (item.memberRisk.lowBalanceContracts > 0) flags.push("member_low_balance");
  return flags;
}

function buildSupportScore(item: TenantSummaryInternal) {
  let score = 0;
  if (!item.subscription.isUsable) score += 40;
  score += Math.min(20, item.notificationOps.failedDeliveries * 2);
  score += Math.min(15, item.anomalies.unreconciledEvents * 2);
  score += Math.min(10, item.anomalies.openShiftsTooLong * 2);
  score += Math.min(10, item.opportunities.overdue);
  score += Math.min(10, item.crm.staleLeads);
  return score;
}

function toOverviewItem(item: TenantSummaryInternal): PlatformTenantOpsOverviewItem {
  const supportFlags = buildSupportFlags(item);
  const supportScore = buildSupportScore(item);
  return {
    ...item,
    supportFlags,
    supportScore,
  };
}

export async function getPlatformTenantOpsOverview(input: {
  tenantId?: string | null;
  rangeDays?: number;
}): Promise<{ ok: true; data: PlatformTenantOpsOverview } | { ok: false; error: string }> {
  const rangeDays = Math.min(90, Math.max(1, input.rangeDays ?? 14));
  const loaded = await loadOverviewData({
    tenantId: input.tenantId || null,
    rangeDays,
  });
  if (!loaded.ok) return loaded;

  const items = loaded.summaries.map(toOverviewItem).sort((a, b) => b.supportScore - a.supportScore || a.tenantName.localeCompare(b.tenantName));
  const totals = items.reduce(
    (acc, item) => {
      acc.tenants += 1;
      if (!item.subscription.isUsable) acc.blockedTenants += 1;
      if (
        item.anomalies.unreconciledEvents > 0 ||
        item.anomalies.openShifts > 0 ||
        item.anomalies.shiftsWithDifference > 0 ||
        item.anomalies.pendingApprovals > 0
      ) {
        acc.tenantsWithAnomalies += 1;
      }
      if (item.supportScore >= 10) acc.tenantsNeedingSupport += 1;
      acc.failedDeliveries += item.notificationOps.failedDeliveries;
      acc.unreconciledEvents += item.anomalies.unreconciledEvents;
      acc.overdueOpportunities += item.opportunities.overdue;
      return acc;
    },
    {
      tenants: 0,
      blockedTenants: 0,
      tenantsWithAnomalies: 0,
      tenantsNeedingSupport: 0,
      failedDeliveries: 0,
      unreconciledEvents: 0,
      overdueOpportunities: 0,
    },
  );

  return {
    ok: true,
    data: {
      generatedAt: loaded.now.toISOString(),
      rangeDays,
      totals,
      items,
      warnings: loaded.warnings,
    },
  };
}

export async function getPlatformTenantOpsDetail(input: {
  tenantId: string;
  rangeDays?: number;
}): Promise<{ ok: true; data: PlatformTenantOpsDetail } | { ok: false; error: string }> {
  const rangeDays = Math.min(90, Math.max(1, input.rangeDays ?? 14));
  const loaded = await loadOverviewData({
    tenantId: input.tenantId,
    rangeDays,
  });
  if (!loaded.ok) return loaded;
  const base = loaded.summaries[0];
  if (!base) return { ok: false, error: "Tenant not found" };
  const tenant = toOverviewItem(base);
  const tenantId = tenant.tenantId;

  const failedDeliveries = loaded.deliveries
    .filter((row) => row.tenant_id === tenantId && (row.status === "failed" || row.status === "retrying"))
    .slice(0, 30)
    .map((row) => ({
      createdAt: row.created_at,
      channel: row.channel,
      status: row.status,
      sourceRefType: row.source_ref_type,
      sourceRefId: row.source_ref_id,
      errorCode: row.error_code,
      errorMessage: row.error_message,
    }));

  const jobRuns = loaded.jobRuns
    .filter((row) => row.tenant_id === tenantId)
    .slice(0, 30)
    .map((row) => ({
      createdAt: row.created_at,
      jobType: row.job_type,
      triggerMode: row.trigger_mode,
      status: row.status,
      errorCount: asNumber(row.error_count),
      errorSummary: row.error_summary,
    }));

  const pendingApprovals = loaded.highRiskPending
    .filter((row) => row.tenant_id === tenantId)
    .slice(0, 30)
    .map((row) => ({
      action: row.action,
      createdAt: row.created_at,
    }));

  const overdueOpportunities = loaded.opportunities
    .filter((row) => {
      if (row.tenant_id !== tenantId) return false;
      if (!(row.status === "open" || row.status === "in_progress" || row.status === "snoozed")) return false;
      const dueMs = asDate(row.due_at)?.getTime() ?? null;
      return dueMs !== null && dueMs < loaded.now.getTime();
    })
    .slice(0, 30)
    .map((row) => ({
      id: row.id,
      type: row.type,
      priority: row.priority,
      dueAt: row.due_at,
      ownerStaffId: row.owner_staff_id,
      reason: row.reason,
    }));

  const expiringContracts = loaded.contracts
    .filter((row) => {
      if (row.tenant_id !== tenantId) return false;
      if (row.status !== "active") return false;
      const endsMs = asDate(row.ends_at)?.getTime() ?? null;
      if (endsMs === null) return false;
      return endsMs >= loaded.now.getTime() && endsMs <= loaded.now.getTime() + 7 * DAY_MS;
    })
    .slice(0, 30)
    .map((row) => ({
      contractId: row.id,
      memberId: row.member_id,
      endsAt: row.ends_at,
      remainingUses: row.remaining_uses,
      remainingSessions: row.remaining_sessions,
    }));

  const supportLinks = {
    subscription: `/platform-admin/billing?tenantId=${encodeURIComponent(tenantId)}`,
    notificationsOps: `/platform-admin/notifications-ops?tenantId=${encodeURIComponent(tenantId)}`,
    observability: `/platform-admin/observability?tenantId=${encodeURIComponent(tenantId)}`,
    audit: `/platform-admin/audit?tenantId=${encodeURIComponent(tenantId)}`,
    opportunities: `/manager/opportunities?tenantId=${encodeURIComponent(tenantId)}`,
    crm: `/manager/crm?tenantId=${encodeURIComponent(tenantId)}`,
    managerSummary: `/manager?tenantId=${encodeURIComponent(tenantId)}`,
    handover: `/frontdesk/handover?tenantId=${encodeURIComponent(tenantId)}`,
  };

  return {
    ok: true,
    data: {
      generatedAt: loaded.now.toISOString(),
      tenant,
      recent: {
        failedDeliveries,
        jobRuns,
        pendingApprovals,
        overdueOpportunities,
        expiringContracts,
      },
      supportLinks,
      warnings: loaded.warnings,
    },
  };
}

