import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole, ProfileContext } from "./auth-context";
import { createSupabaseAdminClient } from "./supabase/admin";
import { listUnreconciledShiftEvents } from "./shift-reconciliation";
import { evaluateTenantAccess, type TenantStatus, type TenantSubscriptionSnapshot } from "./tenant-subscription";
import { insertDeliveryRows } from "./notification-ops";
import { dispatchNotificationDeliveries } from "./notification-dispatch";
import { resolveExternalChannels } from "./notification-external";

export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationStatus = "unread" | "read" | "archived";

type NotificationRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  recipient_user_id: string;
  recipient_role: AppRole;
  status: NotificationStatus;
  severity: NotificationSeverity;
  event_type: string;
  title: string;
  message: string;
  target_type: string | null;
  target_id: string | null;
  action_url: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
};

type TenantRow = { id: string; name: string; status: TenantStatus };
type TenantSubscriptionRow = {
  tenant_id: string;
  status: TenantSubscriptionSnapshot["status"];
  ends_at: string | null;
  grace_ends_at: string | null;
  plan_code: string | null;
  saas_plans: { name: string | null } | Array<{ name: string | null }> | null;
};

type CrmLeadSweepRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  owner_staff_id: string | null;
  name: string;
  status: string;
  trial_status: string | null;
  trial_result: string | null;
  trial_at: string | null;
  next_action_at: string | null;
  last_followed_up_at: string | null;
  updated_at: string;
};

type CreateParams = {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  branchId?: string | null;
  recipientUserIds?: string[];
  recipientRoles?: AppRole[];
  title: string;
  message: string;
  severity?: NotificationSeverity;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  actionUrl?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  createdBy?: string | null;
};

type SweepInput = {
  actorRole: AppRole;
  actorUserId?: string | null;
  tenantId?: string | null;
  now?: Date;
};

type SweepSummary = {
  generated: number;
  byEventType: Record<string, number>;
};

function validActionUrl(input: string | null | undefined) {
  if (!input || typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  return value.startsWith("/") ? value : null;
}

function isMissingCrmTables(message: string) {
  return (
    message.includes('relation "crm_leads" does not exist') ||
    message.includes("Could not find the table 'public.crm_leads' in the schema cache")
  );
}

function num(input: unknown) {
  const value = Number(input);
  return Number.isFinite(value) ? value : 0;
}

function asPlanName(input: TenantSubscriptionRow["saas_plans"]) {
  if (!input) return null;
  if (Array.isArray(input)) return input[0]?.name ?? null;
  return input.name ?? null;
}

function daysUntil(value: string | null, nowMs: number) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  const diff = ts - nowMs;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

async function resolveRecipients(params: {
  supabase: SupabaseClient;
  roles: AppRole[];
  tenantId?: string | null;
  branchId?: string | null;
}) {
  const ids = new Set<string>();
  for (const role of params.roles) {
    let query = params.supabase.from("profiles").select("id").eq("role", role).eq("is_active", true);
    if (role !== "platform_admin") {
      if (!params.tenantId) continue;
      query = query.eq("tenant_id", params.tenantId);
    }
    if (params.branchId && (role === "frontdesk" || role === "branch_manager")) {
      query = query.or(`branch_id.is.null,branch_id.eq.${params.branchId}`);
    }
    const result = await query;
    if (result.error) return { ok: false as const, error: result.error.message };
    for (const row of result.data || []) {
      ids.add(String(row.id));
    }
  }
  return { ok: true as const, ids: Array.from(ids) };
}

export async function createInAppNotifications(params: CreateParams) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const targetUsers = new Set((params.recipientUserIds || []).map((item) => item.trim()).filter(Boolean));
  if ((params.recipientRoles || []).length > 0) {
    const roleRecipients = await resolveRecipients({
      supabase,
      roles: params.recipientRoles || [],
      tenantId: params.tenantId ?? null,
      branchId: params.branchId ?? null,
    });
    if (!roleRecipients.ok) return { ok: false as const, error: roleRecipients.error };
    for (const id of roleRecipients.ids) targetUsers.add(id);
  }
  if (targetUsers.size === 0) return { ok: true as const, inserted: 0 };

  const profileResult = await supabase.from("profiles").select("id, role").in("id", Array.from(targetUsers));
  if (profileResult.error) return { ok: false as const, error: profileResult.error.message };
  const roleMap = new Map<string, AppRole>();
  for (const row of (profileResult.data || []) as Array<{ id: string; role: AppRole }>) {
    roleMap.set(String(row.id), row.role);
  }

  const rows = Array.from(targetUsers)
    .map((recipientUserId) => ({
      tenant_id: params.tenantId ?? null,
      branch_id: params.branchId ?? null,
      recipient_user_id: recipientUserId,
      recipient_role: roleMap.get(recipientUserId) ?? "member",
      status: "unread" as NotificationStatus,
      severity: params.severity || "info",
      event_type: params.eventType,
      title: params.title,
      message: params.message,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      action_url: validActionUrl(params.actionUrl),
      payload: params.payload || {},
      dedupe_key: params.dedupeKey || null,
      created_by: params.createdBy ?? null,
      updated_at: new Date().toISOString(),
    }))
    .filter((row) => row.recipient_role !== "member");

  if (rows.length === 0) return { ok: true as const, inserted: 0 };

  let insertedRows: Array<{
    id: string;
    tenant_id: string | null;
    branch_id: string | null;
    recipient_user_id: string;
    recipient_role: AppRole;
    event_type: string;
    severity: NotificationSeverity;
    target_type: string | null;
    target_id: string | null;
    payload: Record<string, unknown> | null;
    created_by: string | null;
  }> = [];

  if (params.dedupeKey) {
    const upsert = await supabase
      .from("in_app_notifications")
      .upsert(rows, {
        onConflict: "recipient_user_id,dedupe_key",
        ignoreDuplicates: true,
      })
      .select("id, tenant_id, branch_id, recipient_user_id, recipient_role, event_type, severity, target_type, target_id, payload, created_by");
    if (upsert.error) return { ok: false as const, error: upsert.error.message };
    insertedRows = (upsert.data || []) as typeof insertedRows;
  } else {
    const insert = await supabase
      .from("in_app_notifications")
      .insert(rows)
      .select("id, tenant_id, branch_id, recipient_user_id, recipient_role, event_type, severity, target_type, target_id, payload, created_by");
    if (insert.error) return { ok: false as const, error: insert.error.message };
    insertedRows = (insert.data || []) as typeof insertedRows;
  }

  if (insertedRows.length === 0) return { ok: true as const, inserted: 0 };

  const deliveryInsert = await insertDeliveryRows({
    supabase,
    rows: insertedRows.flatMap((row) => {
      const basePayload = {
        eventType: row.event_type,
        severity: row.severity,
        targetType: row.target_type,
        targetId: row.target_id,
        notificationId: row.id,
        title: params.title,
        message: params.message,
        actionUrl: validActionUrl(params.actionUrl),
        ...(row.payload || {}),
      };
      const deliveries: Array<{
        tenantId: string | null;
        branchId: string | null;
        notificationId: string;
        sourceRefType: string;
        sourceRefId: string;
        recipientUserId: string;
        recipientRole: AppRole;
        channel: "in_app" | "email" | "line" | "sms" | "webhook";
        status: "sent" | "pending";
        attempts: number;
        sentAt: string | null;
        dedupeKey: string;
        payload: Record<string, unknown>;
        createdBy: string | null;
      }> = [
        {
          tenantId: row.tenant_id,
          branchId: row.branch_id,
          notificationId: row.id,
          sourceRefType: row.target_type || "notification",
          sourceRefId: row.target_id || row.id,
          recipientUserId: row.recipient_user_id,
          recipientRole: row.recipient_role,
          channel: "in_app",
          status: "sent",
          attempts: 1,
          sentAt: new Date().toISOString(),
          dedupeKey: `in-app:${row.id}:${row.recipient_user_id}`,
          payload: basePayload,
          createdBy: row.created_by,
        },
      ];
      const externalChannels = resolveExternalChannels({
        eventType: row.event_type,
        severity: row.severity,
        recipientRole: row.recipient_role,
      });
      for (const channel of externalChannels) {
        deliveries.push({
          tenantId: row.tenant_id,
          branchId: row.branch_id,
          notificationId: row.id,
          sourceRefType: row.target_type || "notification",
          sourceRefId: row.target_id || row.id,
          recipientUserId: row.recipient_user_id,
          recipientRole: row.recipient_role,
          channel,
          status: "pending",
          attempts: 0,
          sentAt: null,
          dedupeKey: `${channel}:${row.id}:${row.recipient_user_id}`,
          payload: basePayload,
          createdBy: row.created_by,
        });
      }
      return deliveries;
    }),
  });

  if (deliveryInsert.ok) {
    const externalIds = deliveryInsert.items
      .filter((item) => item.channel !== "in_app")
      .map((item) => item.id);
    if (externalIds.length > 0) {
      await dispatchNotificationDeliveries({
        supabase,
        deliveryIds: externalIds,
        mode: "inline",
        limit: externalIds.length,
      }).catch(() => null);
    }
  }

  return { ok: true as const, inserted: insertedRows.length };
}

export async function listMyInAppNotifications(params: {
  context: ProfileContext;
  status: "all" | NotificationStatus;
  limit: number;
}) {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("in_app_notifications")
    .select("id, tenant_id, branch_id, recipient_user_id, recipient_role, status, severity, event_type, title, message, target_type, target_id, action_url, payload, read_at, archived_at, created_at")
    .eq("recipient_user_id", params.context.userId)
    .order("created_at", { ascending: false })
    .limit(params.limit);
  if (params.status !== "all") query = query.eq("status", params.status);
  const listResult = await query;
  if (listResult.error) return { ok: false as const, error: listResult.error.message };

  const unreadResult = await supabase
    .from("in_app_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", params.context.userId)
    .eq("status", "unread");
  if (unreadResult.error) return { ok: false as const, error: unreadResult.error.message };

  return {
    ok: true as const,
    items: (listResult.data || []) as NotificationRow[],
    unreadCount: unreadResult.count || 0,
  };
}

export async function updateMyInAppNotifications(params: {
  context: ProfileContext;
  notificationIds: string[];
  action: "read" | "unread" | "archive";
}) {
  const supabase = createSupabaseAdminClient();
  const ids = Array.from(new Set(params.notificationIds.map((item) => item.trim()).filter(Boolean)));
  if (ids.length === 0) return { ok: true as const, updated: 0 };

  const nowIso = new Date().toISOString();
  const patch =
    params.action === "read"
      ? { status: "read", read_at: nowIso, archived_at: null, updated_at: nowIso }
      : params.action === "archive"
        ? { status: "archived", archived_at: nowIso, read_at: nowIso, updated_at: nowIso }
        : { status: "unread", read_at: null, archived_at: null, updated_at: nowIso };

  const result = await supabase
    .from("in_app_notifications")
    .update(patch)
    .eq("recipient_user_id", params.context.userId)
    .in("id", ids);
  if (result.error) return { ok: false as const, error: result.error.message };
  return { ok: true as const, updated: ids.length };
}

function addCount(summary: SweepSummary, eventType: string, value: number) {
  if (value <= 0) return;
  summary.generated += value;
  summary.byEventType[eventType] = (summary.byEventType[eventType] || 0) + value;
}

export async function runNotificationSweep(input: SweepInput): Promise<{ ok: true; summary: SweepSummary } | { ok: false; error: string }> {
  const supabase = createSupabaseAdminClient();
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  let tenantQuery = supabase.from("tenants").select("id, name, status");
  if (input.actorRole !== "platform_admin") {
    if (!input.tenantId) return { ok: false, error: "Missing tenant scope" };
    tenantQuery = tenantQuery.eq("id", input.tenantId);
  } else if (input.tenantId) {
    tenantQuery = tenantQuery.eq("id", input.tenantId);
  }
  const tenantResult = await tenantQuery.limit(500);
  if (tenantResult.error) return { ok: false, error: tenantResult.error.message };
  const tenants = (tenantResult.data || []) as TenantRow[];
  if (tenants.length === 0) return { ok: true, summary: { generated: 0, byEventType: {} } };

  const tenantIds = tenants.map((item) => item.id);
  const subscriptionResult = await supabase
    .from("tenant_subscriptions")
    .select("tenant_id, status, ends_at, grace_ends_at, plan_code, saas_plans(name)")
    .in("tenant_id", tenantIds)
    .eq("is_current", true);
  if (subscriptionResult.error) return { ok: false, error: subscriptionResult.error.message };
  const subscriptionByTenant = new Map<string, TenantSubscriptionSnapshot>();
  for (const row of (subscriptionResult.data || []) as TenantSubscriptionRow[]) {
    subscriptionByTenant.set(row.tenant_id, {
      status: row.status ?? null,
      startsAt: null,
      endsAt: row.ends_at ?? null,
      graceEndsAt: row.grace_ends_at ?? null,
      planCode: row.plan_code ?? null,
      planName: asPlanName(row.saas_plans),
    });
  }

  const summary: SweepSummary = { generated: 0, byEventType: {} };
  const expiringBuckets = new Set([30, 14, 7]);
  const shiftOverdueIso = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const contractEndIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const bookingEndIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  for (const tenant of tenants) {
    const snapshot = subscriptionByTenant.get(tenant.id) || null;
    const access = evaluateTenantAccess({ tenantStatus: tenant.status, subscription: snapshot, now });
    const remaining = daysUntil(snapshot?.endsAt ?? null, nowMs);

    if (remaining !== null && expiringBuckets.has(remaining) && access.allowed) {
      const created = await createInAppNotifications({
        supabase,
        tenantId: tenant.id,
        recipientRoles: ["platform_admin", "manager"],
        title: "Tenant subscription expiring soon",
        message: `${tenant.name || tenant.id} subscription expires in ${remaining} day(s).`,
        severity: remaining <= 7 ? "critical" : "warning",
        eventType: "tenant_subscription_expiring",
        targetType: "tenant_subscription",
        targetId: tenant.id,
        actionUrl: "/platform-admin/billing",
        dedupeKey: `tenant-subscription:${tenant.id}:expiring:${remaining}`,
        createdBy: input.actorUserId,
      });
      if (created.ok) addCount(summary, "tenant_subscription_expiring", created.inserted);
    }

    if (access.warningCode === "SUBSCRIPTION_GRACE") {
      const created = await createInAppNotifications({
        supabase,
        tenantId: tenant.id,
        recipientRoles: ["platform_admin", "manager"],
        title: "Tenant subscription in grace period",
        message: `${tenant.name || tenant.id} is in grace period.`,
        severity: "critical",
        eventType: "tenant_subscription_grace",
        targetType: "tenant_subscription",
        targetId: tenant.id,
        actionUrl: "/platform-admin/billing",
        dedupeKey: `tenant-subscription:${tenant.id}:grace:${snapshot?.graceEndsAt || "na"}`,
        createdBy: input.actorUserId,
      });
      if (created.ok) addCount(summary, "tenant_subscription_grace", created.inserted);
    }

    if (!access.allowed && (access.blockedCode === "SUBSCRIPTION_EXPIRED" || access.blockedCode === "SUBSCRIPTION_CANCELED")) {
      const created = await createInAppNotifications({
        supabase,
        tenantId: tenant.id,
        recipientRoles: ["platform_admin", "manager"],
        title: "Tenant subscription blocked",
        message: `${tenant.name || tenant.id} blocked by ${access.blockedCode}.`,
        severity: "critical",
        eventType: "tenant_subscription_blocked",
        targetType: "tenant_subscription",
        targetId: tenant.id,
        actionUrl: "/platform-admin/billing",
        dedupeKey: `tenant-subscription:${tenant.id}:blocked:${access.blockedCode}`,
        createdBy: input.actorUserId,
      });
      if (created.ok) addCount(summary, "tenant_subscription_blocked", created.inserted);
    }

    const [approvalResult, openShiftResult, contractResult, bookingResult] = await Promise.all([
      supabase.from("high_risk_action_requests").select("id", { count: "exact" }).eq("tenant_id", tenant.id).eq("status", "pending"),
      supabase.from("frontdesk_shifts").select("id, branch_id, opened_at").eq("tenant_id", tenant.id).eq("status", "open").lte("opened_at", shiftOverdueIso),
      supabase
        .from("member_plan_contracts")
        .select("id, status, ends_at, remaining_uses, remaining_sessions")
        .eq("tenant_id", tenant.id)
        .eq("status", "active"),
      supabase
        .from("bookings")
        .select("id, branch_id")
        .eq("tenant_id", tenant.id)
        .in("status", ["booked", "checked_in"])
        .gte("starts_at", nowIso)
        .lte("starts_at", bookingEndIso),
    ]);
    if (approvalResult.error || openShiftResult.error || contractResult.error || bookingResult.error) continue;

    const pendingCount = approvalResult.count || 0;
    if (pendingCount > 0) {
      const created = await createInAppNotifications({
        supabase,
        tenantId: tenant.id,
        recipientRoles: ["platform_admin", "manager"],
        title: "Pending high-risk approvals",
        message: `${pendingCount} high-risk approval request(s) pending.`,
        severity: "warning",
        eventType: "high_risk_approval_pending",
        actionUrl: "/manager",
        targetType: "approval_request",
        targetId: tenant.id,
        dedupeKey: `approval-pending:${tenant.id}:${pendingCount}`,
        createdBy: input.actorUserId,
      });
      if (created.ok) addCount(summary, "high_risk_approval_pending", created.inserted);
    }

    const openShifts = openShiftResult.data || [];
    for (const shift of openShifts as Array<{ id: string; branch_id: string | null; opened_at: string }>) {
      const created = await createInAppNotifications({
        supabase,
        tenantId: tenant.id,
        branchId: shift.branch_id || null,
        recipientRoles: ["manager", "frontdesk"],
        title: "Open shift not closed",
        message: `Shift ${shift.id.slice(0, 8)} is still open.`,
        severity: "warning",
        eventType: "shift_open_overdue",
        targetType: "frontdesk_shift",
        targetId: shift.id,
        actionUrl: "/frontdesk/handover",
        dedupeKey: `shift-open-overdue:${shift.id}`,
        createdBy: input.actorUserId,
      });
      if (created.ok) addCount(summary, "shift_open_overdue", created.inserted);
    }

    const unreconciled = await listUnreconciledShiftEvents({
      supabase,
      tenantId: tenant.id,
      from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      to: nowIso,
      limit: 200,
    });
    if (unreconciled.ok && unreconciled.items.length > 0) {
      const created = await createInAppNotifications({
        supabase,
        tenantId: tenant.id,
        recipientRoles: ["manager"],
        title: "Unreconciled events detected",
        message: `${unreconciled.items.length} unreconciled event(s) found.`,
        severity: "warning",
        eventType: "unreconciled_events_detected",
        targetType: "reconciliation",
        targetId: tenant.id,
        actionUrl: "/manager",
        dedupeKey: `unreconciled:${tenant.id}:${unreconciled.items.length}:${nowIso.slice(0, 10)}`,
        createdBy: input.actorUserId,
      });
      if (created.ok) addCount(summary, "unreconciled_events_detected", created.inserted);
    }

    const contracts = contractResult.data || [];
    const expiringContracts = (contracts as Array<{ id: string; ends_at: string | null }>).filter((item) => {
      if (!item.ends_at) return false;
      return item.ends_at >= nowIso && item.ends_at <= contractEndIso;
    }).length;
    const lowBalanceContracts = (contracts as Array<{ remaining_uses: number | null; remaining_sessions: number | null }>).filter((item) => {
      const sessions = num(item.remaining_sessions);
      const uses = num(item.remaining_uses);
      return (sessions > 0 && sessions <= 2) || (uses > 0 && uses <= 2);
    }).length;

    if (expiringContracts > 0) {
      const created = await createInAppNotifications({
        supabase,
        tenantId: tenant.id,
        recipientRoles: ["manager"],
        title: "Member contracts expiring soon",
        message: `${expiringContracts} contract(s) will expire in 7 days.`,
        severity: "warning",
        eventType: "member_contract_expiring",
        targetType: "member_plan_contract",
        targetId: tenant.id,
        actionUrl: "/manager/members",
        dedupeKey: `member-contract-expiring:${tenant.id}:${expiringContracts}:${nowIso.slice(0, 10)}`,
        createdBy: input.actorUserId,
      });
      if (created.ok) addCount(summary, "member_contract_expiring", created.inserted);
    }

    if (lowBalanceContracts > 0) {
      const created = await createInAppNotifications({
        supabase,
        tenantId: tenant.id,
        recipientRoles: ["manager"],
        title: "Member balances running low",
        message: `${lowBalanceContracts} contract(s) are low on remaining uses/sessions.`,
        severity: "warning",
        eventType: "member_contract_low_balance",
        targetType: "member_plan_contract",
        targetId: tenant.id,
        actionUrl: "/manager/members",
        dedupeKey: `member-contract-low:${tenant.id}:${lowBalanceContracts}:${nowIso.slice(0, 10)}`,
        createdBy: input.actorUserId,
      });
      if (created.ok) addCount(summary, "member_contract_low_balance", created.inserted);
    }

    const bookingCount = (bookingResult.data || []).length;
    if (bookingCount > 0) {
      const created = await createInAppNotifications({
        supabase,
        tenantId: tenant.id,
        recipientRoles: ["manager", "frontdesk"],
        title: "Upcoming booking reminders",
        message: `${bookingCount} booking(s) start within 24 hours.`,
        severity: "info",
        eventType: "booking_upcoming",
        targetType: "booking",
        targetId: tenant.id,
        actionUrl: "/frontdesk/bookings",
        dedupeKey: `booking-upcoming:${tenant.id}:${bookingCount}:${nowIso.slice(0, 10)}`,
        createdBy: input.actorUserId,
      });
      if (created.ok) addCount(summary, "booking_upcoming", created.inserted);
    }

    const crmLeadsResult = await supabase
      .from("crm_leads")
      .select("id, tenant_id, branch_id, owner_staff_id, name, status, trial_status, trial_result, trial_at, next_action_at, last_followed_up_at, updated_at")
      .eq("tenant_id", tenant.id)
      .in("status", ["new", "contacted", "trial_booked", "trial_completed"])
      .limit(1000);
    if (crmLeadsResult.error) {
      if (isMissingCrmTables(crmLeadsResult.error.message)) continue;
      continue;
    }

    const crmLeads = (crmLeadsResult.data || []) as CrmLeadSweepRow[];
    const staleThresholdMs = 72 * 60 * 60 * 1000;
    const trialUpcomingThresholdMs = 24 * 60 * 60 * 1000;

    for (const lead of crmLeads) {
      const leadOwner = lead.owner_staff_id || null;
      const recipients = leadOwner ? [leadOwner] : [];
      const roleRecipients = leadOwner ? ["manager"] : ["manager", "sales"];

      if (lead.trial_status === "scheduled" && lead.trial_at) {
        const trialTs = new Date(lead.trial_at).getTime();
        if (Number.isFinite(trialTs) && trialTs > nowMs && trialTs - nowMs <= trialUpcomingThresholdMs) {
          const created = await createInAppNotifications({
            supabase,
            tenantId: tenant.id,
            branchId: lead.branch_id,
            recipientUserIds: recipients,
            recipientRoles: roleRecipients as AppRole[],
            title: "Trial session is coming up",
            message: `Lead ${lead.name} trial starts within 24 hours.`,
            severity: "info",
            eventType: "crm_trial_upcoming",
            targetType: "crm_lead",
            targetId: lead.id,
            actionUrl: `/manager/crm/${lead.id}`,
            dedupeKey: `crm-trial-upcoming:${lead.id}:${lead.trial_at?.slice(0, 16)}`,
            createdBy: input.actorUserId,
          });
          if (created.ok) addCount(summary, "crm_trial_upcoming", created.inserted);
        }
      }

      const lastTouchTs = new Date(lead.last_followed_up_at || lead.updated_at).getTime();
      if (Number.isFinite(lastTouchTs) && nowMs - lastTouchTs >= staleThresholdMs) {
        const created = await createInAppNotifications({
          supabase,
          tenantId: tenant.id,
          branchId: lead.branch_id,
          recipientUserIds: recipients,
          recipientRoles: roleRecipients as AppRole[],
          title: "Lead follow-up overdue",
          message: `Lead ${lead.name} has not been followed up for over 72 hours.`,
          severity: "warning",
          eventType: "crm_followup_overdue",
          targetType: "crm_lead",
          targetId: lead.id,
          actionUrl: `/manager/crm/${lead.id}`,
          dedupeKey: `crm-followup-overdue:${lead.id}:${new Date(lastTouchTs).toISOString().slice(0, 10)}`,
          createdBy: input.actorUserId,
        });
        if (created.ok) addCount(summary, "crm_followup_overdue", created.inserted);
      }

      if (lead.trial_status === "attended" && (!lead.trial_result || lead.trial_result === "follow_up_needed")) {
        const created = await createInAppNotifications({
          supabase,
          tenantId: tenant.id,
          branchId: lead.branch_id,
          recipientUserIds: recipients,
          recipientRoles: roleRecipients as AppRole[],
          title: "Trial completed and follow-up required",
          message: `Lead ${lead.name} completed trial. Follow-up is required.`,
          severity: "warning",
          eventType: "crm_trial_followup_needed",
          targetType: "crm_lead",
          targetId: lead.id,
          actionUrl: `/manager/crm/${lead.id}`,
          dedupeKey: `crm-trial-followup-needed:${lead.id}:${lead.updated_at.slice(0, 10)}`,
          createdBy: input.actorUserId,
        });
        if (created.ok) addCount(summary, "crm_trial_followup_needed", created.inserted);
      }
    }
  }

  return { ok: true, summary };
}

export async function notifyHighRiskRequestCreated(params: {
  tenantId: string;
  branchId: string | null;
  requestId: string;
  action: "order_void" | "payment_refund";
  targetType: "order" | "payment";
  targetId: string;
  requestedBy: string;
}) {
  return createInAppNotifications({
    tenantId: params.tenantId,
    branchId: params.branchId,
    recipientRoles: ["manager", "platform_admin"],
    title: params.action === "order_void" ? "Void request pending approval" : "Refund request pending approval",
    message: `${params.targetType}:${params.targetId} requires approval.`,
    severity: "warning",
    eventType: "high_risk_approval_pending",
    targetType: "approval_request",
    targetId: params.requestId,
    actionUrl: "/manager",
    dedupeKey: `approval-request:${params.requestId}`,
    createdBy: params.requestedBy,
  });
}

export async function notifyApprovalDecision(params: {
  tenantId: string;
  requestId: string;
  decision: "approved" | "rejected";
  action: string;
  targetType: string;
  targetId: string;
  requestedBy: string | null;
  resolvedBy: string;
}) {
  if (!params.requestedBy) return { ok: true as const, inserted: 0 };
  return createInAppNotifications({
    tenantId: params.tenantId,
    recipientUserIds: [params.requestedBy],
    title: params.decision === "approved" ? "Approval request approved" : "Approval request rejected",
    message: `${params.action} for ${params.targetType}:${params.targetId} was ${params.decision}.`,
    severity: params.decision === "approved" ? "info" : "warning",
    eventType: "high_risk_approval_decision",
    targetType: "approval_request",
    targetId: params.requestId,
    actionUrl: "/manager",
    dedupeKey: `approval-decision:${params.requestId}:${params.decision}`,
    createdBy: params.resolvedBy,
  });
}

export async function notifyShiftDifference(params: {
  tenantId: string;
  branchId: string | null;
  shiftId: string;
  difference: number;
  actorId: string;
}) {
  if (Math.abs(params.difference) < 0.01) return { ok: true as const, inserted: 0 };
  return createInAppNotifications({
    tenantId: params.tenantId,
    branchId: params.branchId,
    recipientRoles: ["manager"],
    title: "Shift difference detected",
    message: `Shift ${params.shiftId.slice(0, 8)} closed with difference ${params.difference}.`,
    severity: Math.abs(params.difference) >= 100 ? "critical" : "warning",
    eventType: "shift_difference_detected",
    targetType: "frontdesk_shift",
    targetId: params.shiftId,
    actionUrl: "/frontdesk/handover",
    dedupeKey: `shift-difference:${params.shiftId}:${params.difference}`,
    createdBy: params.actorId,
  });
}

export async function notifyUnreconciledEvent(params: {
  tenantId: string;
  branchId: string | null;
  eventType: "order_voided" | "payment_refunded";
  refId: string;
  actorId: string;
}) {
  return createInAppNotifications({
    tenantId: params.tenantId,
    branchId: params.branchId,
    recipientRoles: ["manager"],
    title: "Event needs reconciliation attach",
    message: `${params.eventType} for ${params.refId} is not attached to an open shift.`,
    severity: "warning",
    eventType: "unreconciled_events_detected",
    targetType: "reconciliation",
    targetId: params.refId,
    actionUrl: "/manager",
    dedupeKey: `unreconciled:${params.eventType}:${params.refId}`,
    createdBy: params.actorId,
  });
}

export async function notifyCrmTrialScheduled(params: {
  tenantId: string;
  branchId: string | null;
  leadId: string;
  leadName: string;
  ownerStaffId: string | null;
  trialAt: string;
  actorId: string;
}) {
  return createInAppNotifications({
    tenantId: params.tenantId,
    branchId: params.branchId,
    recipientUserIds: params.ownerStaffId ? [params.ownerStaffId] : [],
    recipientRoles: ["manager"],
    title: "Trial session scheduled",
    message: `Lead ${params.leadName} trial is scheduled at ${params.trialAt}.`,
    severity: "info",
    eventType: "crm_trial_scheduled",
    targetType: "crm_lead",
    targetId: params.leadId,
    actionUrl: `/manager/crm/${params.leadId}`,
    dedupeKey: `crm-trial-scheduled:${params.leadId}:${params.trialAt.slice(0, 16)}`,
    createdBy: params.actorId,
  });
}

export async function notifyCrmOutcomeChanged(params: {
  tenantId: string;
  branchId: string | null;
  leadId: string;
  leadName: string;
  ownerStaffId: string | null;
  outcome: "won" | "lost";
  actorId: string;
}) {
  return createInAppNotifications({
    tenantId: params.tenantId,
    branchId: params.branchId,
    recipientUserIds: params.ownerStaffId ? [params.ownerStaffId] : [],
    recipientRoles: ["manager"],
    title: params.outcome === "won" ? "Lead converted to customer" : "Lead marked as lost",
    message: `Lead ${params.leadName} was marked as ${params.outcome}.`,
    severity: params.outcome === "won" ? "info" : "warning",
    eventType: params.outcome === "won" ? "crm_lead_won" : "crm_lead_lost",
    targetType: "crm_lead",
    targetId: params.leadId,
    actionUrl: `/manager/crm/${params.leadId}`,
    dedupeKey: `crm-outcome:${params.leadId}:${params.outcome}`,
    createdBy: params.actorId,
  });
}
