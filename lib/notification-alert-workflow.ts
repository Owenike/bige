import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";

export type NotificationAlertStatus = "open" | "acknowledged" | "investigating" | "resolved" | "dismissed";
export type NotificationAlertPriority = "P1" | "P2" | "P3" | "P4";
export type NotificationAlertSeverity = "critical" | "high" | "medium" | "low";
export type NotificationAlertAnomalyType = "tenant_priority" | "reason_cluster" | "delivery_error" | "manual";

type NotificationAlertRow = {
  id: string;
  tenant_id: string;
  anomaly_key: string;
  anomaly_type: NotificationAlertAnomalyType;
  priority: NotificationAlertPriority;
  severity: NotificationAlertSeverity;
  status: NotificationAlertStatus;
  summary: string;
  owner_user_id: string | null;
  assignee_user_id: string | null;
  note: string | null;
  resolution_note: string | null;
  source_data: Record<string, unknown> | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  dismissed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationAlertItem = {
  id: string;
  tenantId: string;
  anomalyKey: string;
  anomalyType: NotificationAlertAnomalyType;
  priority: NotificationAlertPriority;
  severity: NotificationAlertSeverity;
  status: NotificationAlertStatus;
  summary: string;
  ownerUserId: string | null;
  assigneeUserId: string | null;
  note: string | null;
  resolutionNote: string | null;
  sourceData: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  dismissedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListNotificationAlertsParams = {
  supabase?: SupabaseClient;
  tenantId?: string | null;
  statuses?: NotificationAlertStatus[];
  priorities?: NotificationAlertPriority[];
  severities?: NotificationAlertSeverity[];
  from?: string | null;
  to?: string | null;
  limit?: number;
};

type UpsertNotificationAlertFromAnomalyParams = {
  supabase?: SupabaseClient;
  tenantId: string;
  anomalyKey: string;
  anomalyType: NotificationAlertAnomalyType;
  priority: NotificationAlertPriority;
  severity: NotificationAlertSeverity;
  summary: string;
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  note?: string | null;
  sourceData?: Record<string, unknown>;
  actorId?: string | null;
};

type UpdateNotificationAlertParams = {
  supabase?: SupabaseClient;
  id: string;
  status?: NotificationAlertStatus;
  summary?: string | null;
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  note?: string | null;
  resolutionNote?: string | null;
  sourceDataPatch?: Record<string, unknown>;
  actorId?: string | null;
};

export type NotificationAlertDiffSummary = {
  changedCount: number;
  changedKeys: string[];
  changed: Array<{ key: string; before: unknown; after: unknown }>;
};

export type NotificationAlertUpsertResult = {
  item: NotificationAlertItem;
  before: NotificationAlertItem | null;
  diffSummary: NotificationAlertDiffSummary;
  created: boolean;
};

export type NotificationAlertUpdateResult = {
  item: NotificationAlertItem;
  before: NotificationAlertItem;
  diffSummary: NotificationAlertDiffSummary;
  transition: {
    from: NotificationAlertStatus;
    to: NotificationAlertStatus;
    changed: boolean;
  };
};

const STATUS_TRANSITIONS: Record<NotificationAlertStatus, readonly NotificationAlertStatus[]> = {
  open: ["open", "acknowledged", "investigating", "resolved", "dismissed"],
  acknowledged: ["acknowledged", "investigating", "resolved", "dismissed", "open"],
  investigating: ["investigating", "acknowledged", "resolved", "dismissed", "open"],
  resolved: ["resolved", "open"],
  dismissed: ["dismissed", "open"],
};

function toAlertItem(row: NotificationAlertRow): NotificationAlertItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    anomalyKey: row.anomaly_key,
    anomalyType: row.anomaly_type,
    priority: row.priority,
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    ownerUserId: row.owner_user_id,
    assigneeUserId: row.assignee_user_id,
    note: row.note,
    resolutionNote: row.resolution_note,
    sourceData: row.source_data || {},
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    dismissedAt: row.dismissed_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNowIso() {
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined, max: number) {
  if (value === undefined) return undefined;
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function mergeSourceData(
  previous: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null | undefined,
) {
  return {
    ...(previous || {}),
    ...(patch || {}),
  };
}

function chooseAuditAction(params: {
  created: boolean;
  from: NotificationAlertStatus;
  to: NotificationAlertStatus;
  diffSummary: NotificationAlertDiffSummary;
}) {
  if (params.created) return "notification_alert_upsert";
  if (params.from !== params.to) {
    if (params.to === "acknowledged") return "notification_alert_acknowledged";
    if (params.to === "investigating") return "notification_alert_investigating";
    if (params.to === "resolved") return "notification_alert_resolved";
    if (params.to === "dismissed") return "notification_alert_dismissed";
    if (params.to === "open") return "notification_alert_reopened";
  }
  if (params.diffSummary.changedKeys.includes("note") || params.diffSummary.changedKeys.includes("resolutionNote")) {
    return "notification_alert_note_updated";
  }
  return "notification_alert_updated";
}

export function isNotificationAlertTransitionAllowed(from: NotificationAlertStatus, to: NotificationAlertStatus) {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function buildNotificationAlertDiffSummary(params: {
  before: Record<string, unknown> | null | undefined;
  after: Record<string, unknown> | null | undefined;
}) {
  const before = params.before || {};
  const after = params.after || {};
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changed: Array<{ key: string; before: unknown; after: unknown }> = [];
  for (const key of keys) {
    const left = before[key] === undefined ? null : before[key];
    const right = after[key] === undefined ? null : after[key];
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    changed.push({ key, before: left, after: right });
  }
  return {
    changedCount: changed.length,
    changedKeys: changed.map((item) => item.key),
    changed: changed.slice(0, 25),
  };
}

function toAuditPayload(params: {
  before: NotificationAlertItem | null;
  after: NotificationAlertItem;
  diffSummary: NotificationAlertDiffSummary;
}) {
  return {
    before: params.before || {},
    after: params.after,
    diffSummary: params.diffSummary,
  };
}

async function writeAlertAuditNonBlocking(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorId: string | null;
  action: string;
  targetId: string;
  before: NotificationAlertItem | null;
  after: NotificationAlertItem;
  diffSummary: NotificationAlertDiffSummary;
}) {
  try {
    await params.supabase.from("audit_logs").insert({
      tenant_id: params.tenantId,
      actor_id: params.actorId,
      action: params.action,
      target_type: "notification_alert_workflow",
      target_id: params.targetId,
      reason: "phase42_alert_workflow",
      payload: toAuditPayload({
        before: params.before,
        after: params.after,
        diffSummary: params.diffSummary,
      }),
    });
  } catch (error: unknown) {
    console.warn("[notification-alert-workflow][audit-write-failed]", {
      tenantId: params.tenantId,
      targetId: params.targetId,
      action: params.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function findActiveAlertByKey(supabase: SupabaseClient, tenantId: string, anomalyKey: string) {
  const result = await supabase
    .from("notification_alert_workflows")
    .select(
      "id, tenant_id, anomaly_key, anomaly_type, priority, severity, status, summary, owner_user_id, assignee_user_id, note, resolution_note, source_data, first_seen_at, last_seen_at, resolved_at, dismissed_at, created_by, updated_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("anomaly_key", anomalyKey)
    .in("status", ["open", "acknowledged", "investigating"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as NotificationAlertRow | null };
  return { ok: true as const, item: (result.data || null) as NotificationAlertRow | null };
}

async function getAlertById(supabase: SupabaseClient, id: string) {
  const result = await supabase
    .from("notification_alert_workflows")
    .select(
      "id, tenant_id, anomaly_key, anomaly_type, priority, severity, status, summary, owner_user_id, assignee_user_id, note, resolution_note, source_data, first_seen_at, last_seen_at, resolved_at, dismissed_at, created_by, updated_by, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as NotificationAlertRow | null };
  if (!result.data) return { ok: false as const, error: "Alert not found", item: null as NotificationAlertRow | null };
  return { ok: true as const, item: result.data as NotificationAlertRow };
}

export async function listNotificationAlerts(params: ListNotificationAlertsParams) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  let query = supabase
    .from("notification_alert_workflows")
    .select(
      "id, tenant_id, anomaly_key, anomaly_type, priority, severity, status, summary, owner_user_id, assignee_user_id, note, resolution_note, source_data, first_seen_at, last_seen_at, resolved_at, dismissed_at, created_by, updated_by, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(Math.min(500, Math.max(1, Number(params.limit || 120))));
  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  if (params.statuses && params.statuses.length > 0) query = query.in("status", params.statuses);
  if (params.priorities && params.priorities.length > 0) query = query.in("priority", params.priorities);
  if (params.severities && params.severities.length > 0) query = query.in("severity", params.severities);
  if (params.from) query = query.gte("created_at", params.from);
  if (params.to) query = query.lte("created_at", params.to);

  const result = await query;
  if (result.error) return { ok: false as const, error: result.error.message, items: [] as NotificationAlertItem[] };

  return {
    ok: true as const,
    items: ((result.data || []) as NotificationAlertRow[]).map((row) => toAlertItem(row)),
  };
}

export async function upsertNotificationAlertFromAnomaly(params: UpsertNotificationAlertFromAnomalyParams) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const nowIso = toNowIso();
  const summary = normalizeText(params.summary, 1000);
  if (!summary) return { ok: false as const, error: "summary is required", item: null as NotificationAlertItem | null };

  const active = await findActiveAlertByKey(supabase, params.tenantId, params.anomalyKey);
  if (!active.ok) return { ok: false as const, error: active.error, item: null as NotificationAlertItem | null };

  if (active.item) {
    const before = toAlertItem(active.item);
    const updatePayload = {
      anomaly_type: params.anomalyType,
      priority: params.priority,
      severity: params.severity,
      summary,
      owner_user_id: params.ownerUserId === undefined ? active.item.owner_user_id : params.ownerUserId,
      assignee_user_id: params.assigneeUserId === undefined ? active.item.assignee_user_id : params.assigneeUserId,
      note: params.note === undefined ? active.item.note : normalizeText(params.note, 4000),
      source_data: mergeSourceData(active.item.source_data, params.sourceData || {}),
      last_seen_at: nowIso,
      updated_by: params.actorId || null,
      updated_at: nowIso,
    };
    const updated = await supabase
      .from("notification_alert_workflows")
      .update(updatePayload)
      .eq("id", active.item.id)
      .select(
        "id, tenant_id, anomaly_key, anomaly_type, priority, severity, status, summary, owner_user_id, assignee_user_id, note, resolution_note, source_data, first_seen_at, last_seen_at, resolved_at, dismissed_at, created_by, updated_by, created_at, updated_at",
      )
      .maybeSingle();
    if (updated.error || !updated.data) {
      return { ok: false as const, error: updated.error?.message || "Update alert failed", item: null as NotificationAlertItem | null };
    }
    const after = toAlertItem(updated.data as NotificationAlertRow);
    const diffSummary = buildNotificationAlertDiffSummary({ before, after });
    await writeAlertAuditNonBlocking({
      supabase,
      tenantId: after.tenantId,
      actorId: params.actorId || null,
      action: chooseAuditAction({ created: false, from: before.status, to: after.status, diffSummary }),
      targetId: after.id,
      before,
      after,
      diffSummary,
    });
    return {
      ok: true as const,
      item: after,
      before,
      diffSummary,
      created: false as const,
    };
  }

  const insertPayload = {
    tenant_id: params.tenantId,
    anomaly_key: params.anomalyKey,
    anomaly_type: params.anomalyType,
    priority: params.priority,
    severity: params.severity,
    status: "open" as NotificationAlertStatus,
    summary,
    owner_user_id: params.ownerUserId || null,
    assignee_user_id: params.assigneeUserId || null,
    note: normalizeText(params.note, 4000) || null,
    resolution_note: null,
    source_data: params.sourceData || {},
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    created_by: params.actorId || null,
    updated_by: params.actorId || null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const inserted = await supabase
    .from("notification_alert_workflows")
    .insert(insertPayload)
    .select(
      "id, tenant_id, anomaly_key, anomaly_type, priority, severity, status, summary, owner_user_id, assignee_user_id, note, resolution_note, source_data, first_seen_at, last_seen_at, resolved_at, dismissed_at, created_by, updated_by, created_at, updated_at",
    )
    .maybeSingle();

  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const race = await findActiveAlertByKey(supabase, params.tenantId, params.anomalyKey);
      if (race.ok && race.item) {
        return upsertNotificationAlertFromAnomaly({ ...params, supabase });
      }
    }
    return { ok: false as const, error: inserted.error.message, item: null as NotificationAlertItem | null };
  }

  const after = toAlertItem(inserted.data as NotificationAlertRow);
  const diffSummary = buildNotificationAlertDiffSummary({
    before: null,
    after,
  });
  await writeAlertAuditNonBlocking({
    supabase,
    tenantId: after.tenantId,
    actorId: params.actorId || null,
    action: chooseAuditAction({ created: true, from: "open", to: "open", diffSummary }),
    targetId: after.id,
    before: null,
    after,
    diffSummary,
  });
  return {
    ok: true as const,
    item: after,
    before: null,
    diffSummary,
    created: true as const,
  };
}

export async function updateNotificationAlert(params: UpdateNotificationAlertParams) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const current = await getAlertById(supabase, params.id);
  if (!current.ok || !current.item) return { ok: false as const, error: current.error, item: null as NotificationAlertItem | null };

  const before = toAlertItem(current.item);
  const nextStatus = params.status || before.status;
  if (!isNotificationAlertTransitionAllowed(before.status, nextStatus)) {
    return {
      ok: false as const,
      error: `Invalid status transition: ${before.status} -> ${nextStatus}`,
      item: null as NotificationAlertItem | null,
    };
  }

  const nowIso = toNowIso();
  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    updated_by: params.actorId || null,
    updated_at: nowIso,
  };
  if (params.summary !== undefined) {
    const summary = normalizeText(params.summary, 1000);
    if (!summary) {
      return { ok: false as const, error: "summary cannot be empty", item: null as NotificationAlertItem | null };
    }
    updatePayload.summary = summary;
  }
  if (params.ownerUserId !== undefined) updatePayload.owner_user_id = params.ownerUserId;
  if (params.assigneeUserId !== undefined) updatePayload.assignee_user_id = params.assigneeUserId;
  if (params.note !== undefined) updatePayload.note = normalizeText(params.note, 4000);
  if (params.resolutionNote !== undefined) updatePayload.resolution_note = normalizeText(params.resolutionNote, 4000);
  if (params.sourceDataPatch) {
    updatePayload.source_data = mergeSourceData(before.sourceData, params.sourceDataPatch);
  }

  if (nextStatus === "resolved") {
    updatePayload.resolved_at = nowIso;
    updatePayload.dismissed_at = null;
  } else if (nextStatus === "dismissed") {
    updatePayload.dismissed_at = nowIso;
    updatePayload.resolved_at = null;
  } else {
    updatePayload.resolved_at = null;
    updatePayload.dismissed_at = null;
  }

  const updated = await supabase
    .from("notification_alert_workflows")
    .update(updatePayload)
    .eq("id", params.id)
    .select(
      "id, tenant_id, anomaly_key, anomaly_type, priority, severity, status, summary, owner_user_id, assignee_user_id, note, resolution_note, source_data, first_seen_at, last_seen_at, resolved_at, dismissed_at, created_by, updated_by, created_at, updated_at",
    )
    .maybeSingle();
  if (updated.error || !updated.data) {
    return { ok: false as const, error: updated.error?.message || "Update alert failed", item: null as NotificationAlertItem | null };
  }

  const after = toAlertItem(updated.data as NotificationAlertRow);
  const diffSummary = buildNotificationAlertDiffSummary({ before, after });
  await writeAlertAuditNonBlocking({
    supabase,
    tenantId: after.tenantId,
    actorId: params.actorId || null,
    action: chooseAuditAction({
      created: false,
      from: before.status,
      to: after.status,
      diffSummary,
    }),
    targetId: after.id,
    before,
    after,
    diffSummary,
  });

  return {
    ok: true as const,
    item: after,
    before,
    diffSummary,
    transition: {
      from: before.status,
      to: after.status,
      changed: before.status !== after.status,
    },
  };
}
