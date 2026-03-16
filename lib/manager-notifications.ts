import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileContext } from "./auth-context";
import { insertDeliveryRows, listRecentJobRuns, updateDeliveryStatus, type DeliveryRow } from "./notification-ops";
import { listNotificationDeliveryEvents } from "./notification-delivery-events";
import { dispatchNotificationDeliveries } from "./notification-dispatch";
import { executeRetryPlan, validateRetryTargets } from "./notification-retry-operations";
import { getExternalProviderConfig, resolveNotificationDeliveryRuntime, type DeliveryRuntimeCache } from "./notification-delivery-adapter";
import { resolveNotificationTemplate, type NotificationTemplateResolutionRow } from "./notification-template-resolution-service";
import { reconcileNotificationDelivery } from "./notification-provider-reconcile";
import type {
  ManagerNotificationBatchActionResult,
  ManagerNotificationDeliveryEvent,
  ManagerNotificationDetail,
  ManagerNotificationListItem,
  ManagerNotificationReadinessCheck,
  ManagerNotificationRunItem,
  ManagerNotificationSummary,
} from "../types/manager-notifications";

type DeliveryJoinRow = DeliveryRow & {
  bookings?: { public_reference?: string | null; starts_at?: string | null; service_name?: string | null; status?: string | null } | null;
  branches?: { name?: string | null } | null;
};

type ListInput = {
  supabase: SupabaseClient;
  context: ProfileContext;
  dateFrom?: string | null;
  dateTo?: string | null;
  branchId?: string | null;
  channel?: string | null;
  eventType?: string | null;
  templateKey?: string | null;
  status?: string | null;
  search?: string | null;
  limit?: number;
};

function normalizeIso(input: string | null | undefined, fallback: string | null = null) {
  if (!input) return fallback;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function toNumber(input: unknown) {
  const value = Number(input);
  return Number.isFinite(value) ? value : 0;
}

function ensureTenantScope(context: ProfileContext) {
  if (!context.tenantId) {
    throw new Error("Missing tenant scope");
  }
  return context.tenantId;
}

function mapDeliveryRow(row: DeliveryJoinRow, resendCount = 0): ManagerNotificationListItem {
  const payloadLineUserId =
    typeof row.payload?.lineUserId === "string"
      ? row.payload.lineUserId
      : typeof row.payload?.line_user_id === "string"
        ? row.payload.line_user_id
        : null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    branchName: row.branches?.name || null,
    bookingId: row.booking_id,
    bookingReference: row.bookings?.public_reference || null,
    bookingStartsAt: row.bookings?.starts_at || null,
    eventType: row.source_ref_type,
    templateKey: row.template_key,
    channel: row.channel,
    status: row.status,
    deliveryMode: row.delivery_mode,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    recipientEmail: row.recipient_email,
    recipientLineUserId: payloadLineUserId,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    lastAttemptAt: row.last_attempt_at,
    nextRetryAt: row.next_retry_at,
    failureReason: row.failure_reason || row.error_message || row.last_error,
    skippedReason: row.skipped_reason,
    resendOfDeliveryId: row.resend_of_delivery_id,
    resendCount,
    createdAt: row.created_at,
  };
}

function summarizeDeliveries(items: ManagerNotificationListItem[]): ManagerNotificationSummary {
  return items.reduce<ManagerNotificationSummary>(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "pending") acc.queued += 1;
      if (item.status === "retrying") acc.retrying += 1;
      if (item.status === "sent") acc.sent += 1;
      if (item.status === "failed" || item.status === "dead_letter") acc.failed += 1;
      if (item.status === "cancelled") acc.cancelled += 1;
      if (item.status === "skipped") acc.skipped += 1;
      return acc;
    },
    {
      total: 0,
      queued: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
      retrying: 0,
    },
  );
}

function matchesSearch(item: DeliveryJoinRow, search: string) {
  const value = search.toLowerCase();
  const payloadLineUserId =
    typeof item.payload?.lineUserId === "string"
      ? item.payload.lineUserId
      : typeof item.payload?.line_user_id === "string"
        ? item.payload.line_user_id
        : null;
  return [
    item.recipient_name,
    item.recipient_phone,
    item.recipient_email,
    payloadLineUserId,
    item.template_key,
    item.source_ref_type,
    item.bookings?.public_reference,
    item.bookings?.service_name,
    item.provider,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .some((entry) => entry.toLowerCase().includes(value));
}

export async function listManagerNotifications(input: ListInput) {
  const tenantId = ensureTenantScope(input.context);
  const limit = Math.min(300, Math.max(20, Number(input.limit || 120)));

  let query = input.supabase
    .from("notification_deliveries")
    .select(
      "id, tenant_id, branch_id, booking_id, member_id, resend_of_delivery_id, notification_id, opportunity_id, source_ref_type, source_ref_id, template_key, recipient_user_id, recipient_role, recipient_name, recipient_phone, recipient_email, channel, status, scheduled_for, cancelled_at, attempts, retry_count, max_attempts, last_attempt_at, next_retry_at, sent_at, delivered_at, failed_at, dead_letter_at, last_error, error_code, error_message, skipped_reason, failure_reason, delivery_mode, provider, provider_message_id, provider_response, dedupe_key, payload, created_by, created_at, updated_at, bookings(public_reference, starts_at, service_name, status), branches(name)",
    )
    .eq("tenant_id", tenantId)
    .order("scheduled_for", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  const scopeBranchId = input.context.branchId || input.branchId || null;
  if (scopeBranchId) {
    query = query.eq("branch_id", scopeBranchId);
  } else if (input.branchId) {
    query = query.eq("branch_id", input.branchId);
  }

  const dateFrom = normalizeIso(input.dateFrom, null);
  const dateTo = normalizeIso(input.dateTo, null);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);
  if (input.channel) query = query.eq("channel", input.channel);
  if (input.eventType) query = query.eq("source_ref_type", input.eventType);
  if (input.templateKey) query = query.eq("template_key", input.templateKey);
  if (input.status && input.status !== "all") query = query.eq("status", input.status);

  const result = await query;
  if (result.error) {
    return { ok: false as const, error: result.error.message };
  }

  const rawItems = (result.data || []) as DeliveryJoinRow[];
  const search = String(input.search || "").trim().toLowerCase();
  const filteredRows = search ? rawItems.filter((item) => matchesSearch(item, search)) : rawItems;

  const resendParentIds = Array.from(new Set(filteredRows.map((item) => item.id)));
  const resendCounts = new Map<string, number>();
  if (resendParentIds.length > 0) {
    const resendRowsResult = await input.supabase
      .from("notification_deliveries")
      .select("resend_of_delivery_id")
      .eq("tenant_id", tenantId)
      .in("resend_of_delivery_id", resendParentIds);
    if (!resendRowsResult.error) {
      for (const row of resendRowsResult.data || []) {
        const key = String((row as { resend_of_delivery_id?: string | null }).resend_of_delivery_id || "");
        if (!key) continue;
        resendCounts.set(key, (resendCounts.get(key) || 0) + 1);
      }
    }
  }

  const items = filteredRows.map((row) => mapDeliveryRow(row, resendCounts.get(row.id) || 0));
  const recentRunsResult = await listRecentJobRuns({
    supabase: input.supabase,
    tenantId,
    limit: 8,
  });
  const recentRuns: ManagerNotificationRunItem[] = recentRunsResult.ok
    ? recentRunsResult.items.map((item) => ({
        id: String(item.id || ""),
        jobType: String(item.job_type || ""),
        triggerMode: String(item.trigger_mode || ""),
        status: String(item.status || ""),
        startedAt: item.started_at ? String(item.started_at) : null,
        finishedAt: item.finished_at ? String(item.finished_at) : null,
        affectedCount: toNumber(item.affected_count),
        errorCount: toNumber(item.error_count),
        errorSummary: item.error_summary ? String(item.error_summary) : null,
      }))
    : [];

  return {
    ok: true as const,
    items,
    summary: summarizeDeliveries(items),
    recentRuns,
  };
}

async function getScopedDelivery(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  id: string;
}) {
  const tenantId = ensureTenantScope(params.context);
  let query = params.supabase
    .from("notification_deliveries")
    .select(
      "id, tenant_id, branch_id, booking_id, member_id, resend_of_delivery_id, notification_id, opportunity_id, source_ref_type, source_ref_id, template_key, recipient_user_id, recipient_role, recipient_name, recipient_phone, recipient_email, channel, status, scheduled_for, cancelled_at, attempts, retry_count, max_attempts, last_attempt_at, next_retry_at, sent_at, delivered_at, failed_at, dead_letter_at, last_error, error_code, error_message, skipped_reason, failure_reason, delivery_mode, provider, provider_message_id, provider_response, dedupe_key, payload, created_by, created_at, updated_at, bookings(public_reference, starts_at, service_name, status), branches(name)",
    )
    .eq("tenant_id", tenantId)
    .eq("id", params.id);
  if (params.context.branchId) {
    query = query.eq("branch_id", params.context.branchId);
  }
  const result = await query.maybeSingle();
  if (result.error) {
    return { ok: false as const, error: result.error.message, item: null as DeliveryJoinRow | null };
  }
  if (!result.data) {
    return { ok: false as const, error: "Notification delivery not found", item: null as DeliveryJoinRow | null };
  }
  return { ok: true as const, item: result.data as DeliveryJoinRow };
}

export async function getManagerNotificationDetail(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  id: string;
}) {
  const scoped = await getScopedDelivery(params);
  if (!scoped.ok) return scoped;

  const [eventsResult, resendResult, parentResult] = await Promise.all([
    listNotificationDeliveryEvents({
      supabase: params.supabase,
      tenantId: ensureTenantScope(params.context),
      deliveryId: params.id,
      limit: 60,
    }),
    params.supabase
      .from("notification_deliveries")
      .select(
        "id, tenant_id, branch_id, booking_id, member_id, resend_of_delivery_id, notification_id, opportunity_id, source_ref_type, source_ref_id, template_key, recipient_user_id, recipient_role, recipient_name, recipient_phone, recipient_email, channel, status, scheduled_for, cancelled_at, attempts, retry_count, max_attempts, last_attempt_at, next_retry_at, sent_at, delivered_at, failed_at, dead_letter_at, last_error, error_code, error_message, skipped_reason, failure_reason, delivery_mode, provider, provider_message_id, provider_response, dedupe_key, payload, created_by, created_at, updated_at, bookings(public_reference, starts_at, service_name, status), branches(name)",
      )
      .eq("tenant_id", ensureTenantScope(params.context))
      .eq("resend_of_delivery_id", params.id)
      .order("created_at", { ascending: false }),
    scoped.item.resend_of_delivery_id
      ? params.supabase
          .from("notification_deliveries")
          .select(
            "id, tenant_id, branch_id, booking_id, member_id, resend_of_delivery_id, notification_id, opportunity_id, source_ref_type, source_ref_id, template_key, recipient_user_id, recipient_role, recipient_name, recipient_phone, recipient_email, channel, status, scheduled_for, cancelled_at, attempts, retry_count, max_attempts, last_attempt_at, next_retry_at, sent_at, delivered_at, failed_at, dead_letter_at, last_error, error_code, error_message, skipped_reason, failure_reason, delivery_mode, provider, provider_message_id, provider_response, dedupe_key, payload, created_by, created_at, updated_at, bookings(public_reference, starts_at, service_name, status), branches(name)",
          )
          .eq("tenant_id", ensureTenantScope(params.context))
          .eq("id", scoped.item.resend_of_delivery_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (eventsResult.ok === false) {
    return { ok: false as const, error: eventsResult.error };
  }
  if (resendResult.error) {
    return { ok: false as const, error: resendResult.error.message };
  }
  if (parentResult.error) {
    return { ok: false as const, error: parentResult.error.message };
  }

  const resendHistory = ((resendResult.data || []) as DeliveryJoinRow[]).map((item) => mapDeliveryRow(item));
  const parentDelivery = parentResult.data ? mapDeliveryRow(parentResult.data as DeliveryJoinRow) : null;
  const events: ManagerNotificationDeliveryEvent[] = eventsResult.items.map((item) => ({
    id: item.id,
    eventType: item.event_type,
    eventAt: item.event_at,
    provider: item.provider,
    providerEventId: item.provider_event_id,
    providerMessageId: item.provider_message_id,
    statusBefore: item.status_before,
    statusAfter: item.status_after,
    metadata: item.metadata,
    createdAt: item.created_at,
  }));

  const detail: ManagerNotificationDetail = {
    delivery: mapDeliveryRow(scoped.item, resendHistory.length),
    payload: scoped.item.payload || null,
    providerResponse: scoped.item.provider_response || null,
    errorCode: scoped.item.error_code,
    errorMessage: scoped.item.error_message,
    recipientUserId: scoped.item.recipient_user_id,
    bookingServiceName: scoped.item.bookings?.service_name || null,
    bookingStatus: scoped.item.bookings?.status || null,
    events,
    resendHistory,
    parentDelivery,
  };

  return { ok: true as const, detail };
}

export async function resendManagerNotification(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  id: string;
}) {
  const scoped = await getScopedDelivery(params);
  if (!scoped.ok) return scoped;
  if (!["failed", "dead_letter", "skipped", "cancelled"].includes(scoped.item.status)) {
    return { ok: false as const, error: "Only failed, dead-letter, skipped, or cancelled deliveries can be resent." };
  }

  const now = new Date().toISOString();
  const insert = await insertDeliveryRows({
    supabase: params.supabase,
    rows: [
      {
        tenantId: scoped.item.tenant_id,
        branchId: scoped.item.branch_id,
        bookingId: scoped.item.booking_id,
        memberId: scoped.item.member_id,
        resendOfDeliveryId: scoped.item.id,
        notificationId: scoped.item.notification_id,
        opportunityId: scoped.item.opportunity_id,
        sourceRefType: scoped.item.source_ref_type,
        sourceRefId: scoped.item.source_ref_id,
        templateKey: scoped.item.template_key,
        recipientUserId: scoped.item.recipient_user_id,
        recipientRole: scoped.item.recipient_role,
        recipientName: scoped.item.recipient_name,
        recipientPhone: scoped.item.recipient_phone,
        recipientEmail: scoped.item.recipient_email,
        channel: scoped.item.channel,
        status: "pending",
        scheduledFor: now,
        attempts: 0,
        retryCount: 0,
        maxAttempts: scoped.item.max_attempts || 3,
        deliveryMode: scoped.item.delivery_mode,
        provider: scoped.item.provider,
        dedupeKey: `${scoped.item.dedupe_key || scoped.item.id}:resend:${Date.now()}`,
        payload: {
          ...(scoped.item.payload || {}),
          resendOfDeliveryId: scoped.item.id,
          resentAt: now,
        },
        createdBy: params.context.userId,
      },
    ],
  });
  if (!insert.ok || insert.items.length === 0) {
    return { ok: false as const, error: insert.ok ? "Failed to create resend delivery" : insert.error };
  }

  const dispatch = await dispatchNotificationDeliveries({
    supabase: params.supabase,
    tenantId: ensureTenantScope(params.context),
    deliveryIds: [insert.items[0].id],
    mode: "inline",
    includeFailed: true,
    limit: 1,
  });
  if (!dispatch.ok) {
    return { ok: false as const, error: dispatch.error };
  }

  return {
    ok: true as const,
    item: insert.items[0],
    summary: dispatch.summary,
  };
}

export async function resendManagerNotificationsBatch(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  ids: string[];
}) {
  const requestedIds = Array.from(new Set(params.ids.filter(Boolean)));
  const summary: ManagerNotificationBatchActionResult = {
    requested: requestedIds.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    blockedItems: [],
  };

  for (const id of requestedIds) {
    const resent = await resendManagerNotification({
      supabase: params.supabase,
      context: params.context,
      id,
    });
    if (resent.ok) {
      summary.succeeded += 1;
      continue;
    }
    summary.failed += 1;
    summary.blocked += 1;
    summary.blockedItems.push({
      id,
      reason: resent.error,
    });
  }

  return {
    ok: true as const,
    summary,
  };
}

export async function retryManagerNotification(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  id: string;
}) {
  const validated = await validateRetryTargets({
    tenantId: ensureTenantScope(params.context),
    deliveryIds: [params.id],
  });
  if (!validated.ok) {
    return { ok: false as const, error: validated.error };
  }
  if (validated.items.length === 0) {
    return {
      ok: false as const,
      error: validated.rejected[0]?.reason || "Delivery is not retryable.",
    };
  }
  const executed = await executeRetryPlan({
    scope: "tenant",
    tenantId: ensureTenantScope(params.context),
    actorId: params.context.userId,
    deliveryIds: validated.items,
    limit: 1,
  });
  if (!executed.ok) {
    return { ok: false as const, error: executed.error };
  }
  return { ok: true as const, summary: executed.summary };
}

export async function cancelManagerNotification(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  id: string;
}) {
  const scoped = await getScopedDelivery(params);
  if (!scoped.ok) return scoped;
  if (!["pending", "retrying"].includes(scoped.item.status)) {
    return { ok: false as const, error: "Only queued or retrying deliveries can be cancelled." };
  }
  const updated = await updateDeliveryStatus({
    supabase: params.supabase,
    id: scoped.item.id,
    status: "cancelled",
    attempts: scoped.item.attempts || 0,
    retryCount: scoped.item.retry_count || 0,
    lastAttemptAt: scoped.item.last_attempt_at,
    nextRetryAt: null,
    sentAt: scoped.item.sent_at,
    deliveredAt: scoped.item.delivered_at,
    failedAt: scoped.item.failed_at,
    deadLetterAt: scoped.item.dead_letter_at,
    cancelledAt: new Date().toISOString(),
    skippedReason: "manager_cancelled",
    failureReason: scoped.item.failure_reason,
    errorCode: scoped.item.error_code,
    errorMessage: scoped.item.error_message,
    lastError: scoped.item.last_error,
    provider: scoped.item.provider,
    providerMessageId: scoped.item.provider_message_id,
    providerResponse: scoped.item.provider_response,
  });
  if (!updated.ok) {
    return { ok: false as const, error: updated.error };
  }
  return { ok: true as const };
}

export async function cancelManagerNotificationsBatch(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  ids: string[];
}) {
  const requestedIds = Array.from(new Set(params.ids.filter(Boolean)));
  const summary: ManagerNotificationBatchActionResult = {
    requested: requestedIds.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    blockedItems: [],
  };

  for (const id of requestedIds) {
    const cancelled = await cancelManagerNotification({
      supabase: params.supabase,
      context: params.context,
      id,
    });
    if (cancelled.ok) {
      summary.succeeded += 1;
      continue;
    }
    summary.failed += 1;
    summary.blocked += 1;
    summary.blockedItems.push({
      id,
      reason: cancelled.error,
    });
  }

  return {
    ok: true as const,
    summary,
  };
}

export async function reconcileManagerNotification(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  id: string;
  providerStatus: string;
}) {
  const scoped = await getScopedDelivery(params);
  if (!scoped.ok) return scoped;
  if (scoped.item.channel !== "email") {
    return {
      ok: false as const,
      error: "Manual reconcile is only supported for email deliveries with provider callback events.",
    };
  }

  const reconciled = await reconcileNotificationDelivery({
    supabase: params.supabase,
    deliveryId: scoped.item.id,
    providerStatus: params.providerStatus as Parameters<typeof reconcileNotificationDelivery>[0]["providerStatus"],
    provider: scoped.item.provider,
    providerMessageId: scoped.item.provider_message_id,
    tenantId: ensureTenantScope(params.context),
    branchId: params.context.branchId || null,
    actorId: params.context.userId,
  });
  if (!reconciled.ok) {
    return { ok: false as const, error: reconciled.error };
  }
  return {
    ok: true as const,
    result: reconciled,
  };
}

export async function reconcileManagerNotificationsBatch(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  ids: string[];
  providerStatus: string;
}) {
  const requestedIds = Array.from(new Set(params.ids.filter(Boolean)));
  const summary: ManagerNotificationBatchActionResult = {
    requested: requestedIds.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    blockedItems: [],
  };

  for (const id of requestedIds) {
    const reconciled = await reconcileManagerNotification({
      supabase: params.supabase,
      context: params.context,
      id,
      providerStatus: params.providerStatus,
    });
    if (reconciled.ok) {
      summary.succeeded += 1;
      continue;
    }
    summary.failed += 1;
    summary.blocked += 1;
    summary.blockedItems.push({
      id,
      reason: reconciled.error,
    });
  }

  return {
    ok: true as const,
    summary,
  };
}

function buildTemplateCoverage(rows: NotificationTemplateResolutionRow[], tenantId: string, channel: "email" | "line" | "sms" | "webhook") {
  const bookingEvents = [
    "booking_created",
    "booking_rescheduled",
    "booking_cancelled",
    "booking_reminder_day_before",
    "booking_reminder_1h",
    "booking_deposit_pending",
  ];

  return bookingEvents.map((eventType) => {
    const resolved = resolveNotificationTemplate({
      templates: rows,
      tenantId,
      eventType,
      channel,
      locale: "zh-TW",
      defaultLocale: "zh-TW",
    });
    return {
      eventType,
      channel,
      found: resolved.found,
      source: resolved.source,
    } as const;
  });
}

export async function getManagerNotificationReadiness(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  channel?: "email" | "line" | "sms" | "webhook";
}) {
  const tenantId = ensureTenantScope(params.context);
  const channel = params.channel || "email";
  const runtimeCache: DeliveryRuntimeCache = { settings: new Map() };
  const [templateResult, sampleBookingResult] = await Promise.all([
    params.supabase
      .from("notification_templates")
      .select("id, tenant_id, event_type, channel, locale, title_template, message_template, email_subject, action_url, priority, channel_policy, is_active, version, updated_at")
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .eq("channel", channel)
      .eq("is_active", true),
    params.supabase
      .from("bookings")
      .select("id, member_id")
      .eq("tenant_id", tenantId)
      .not("member_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (templateResult.error) {
    return { ok: false as const, error: templateResult.error.message };
  }
  if (sampleBookingResult.error) {
    return { ok: false as const, error: sampleBookingResult.error.message };
  }

  const templateCoverage = buildTemplateCoverage(
    (templateResult.data || []) as NotificationTemplateResolutionRow[],
    tenantId,
    channel,
  );
  const sampleBooking = sampleBookingResult.data as { id: string; member_id: string | null } | null;
  const sampleMemberResult =
    sampleBooking?.member_id
      ? await params.supabase
          .from("members")
          .select("id, full_name, email, phone")
          .eq("tenant_id", tenantId)
          .eq("id", sampleBooking.member_id)
          .maybeSingle()
      : { data: null, error: null };
  if (sampleMemberResult.error) {
    return { ok: false as const, error: sampleMemberResult.error.message };
  }
  const sampleLineIdentityResult =
    sampleBooking?.member_id
      ? await params.supabase
          .from("member_identities")
          .select("value")
          .eq("tenant_id", tenantId)
          .eq("member_id", sampleBooking.member_id)
          .eq("type", "line_user_id")
          .maybeSingle()
      : { data: null, error: null };
  if (sampleLineIdentityResult.error) {
    return { ok: false as const, error: sampleLineIdentityResult.error.message };
  }

  const runtime = await resolveNotificationDeliveryRuntime({
    supabase: params.supabase,
    row: {
      tenant_id: tenantId,
      branch_id: params.context.branchId || null,
      channel,
      delivery_mode: "provider",
    },
    cache: runtimeCache,
  });
  const providerConfig = getExternalProviderConfig(channel);

  const issues: string[] = [];
  if (!runtime.channelEnabled) issues.push("tenant channel setting is disabled");
  if (!providerConfig.endpointConfigured) issues.push("provider endpoint is missing");
  if (!templateCoverage.every((item) => item.found)) issues.push("one or more booking templates are missing");
  if (!sampleMemberResult.data?.email && channel === "email") issues.push("no recent booking recipient has a valid email");
  if (!sampleMemberResult.data?.phone && channel === "sms") issues.push("no recent booking recipient has a valid phone");
  if (!sampleLineIdentityResult.data?.value && channel === "line") issues.push("no recent booking recipient has a valid line_user_id");
  if (runtime.effectiveMode !== "provider") issues.push(`adapter would currently use ${runtime.effectiveMode}`);

  const readiness: ManagerNotificationReadinessCheck = {
    channel,
    eventType: "booking_created",
    templateCoverage: templateCoverage.map((item) => ({
      eventType: item.eventType,
      channel: item.channel,
      found: item.found,
      source: item.source,
    })),
    sampleRecipient: sampleBooking
      ? {
        memberId: sampleBooking?.member_id || null,
        bookingId: sampleBooking?.id || null,
        name: sampleMemberResult.data?.full_name || null,
        email: sampleMemberResult.data?.email || null,
        phone: sampleMemberResult.data?.phone || null,
        lineUserId: sampleLineIdentityResult.data?.value ? String(sampleLineIdentityResult.data.value) : null,
      }
      : null,
    runtime: {
      provider: runtime.provider,
      requestedMode: runtime.requestedMode,
      effectiveMode: runtime.effectiveMode,
      channelEnabled: runtime.channelEnabled,
      configured: runtime.configured,
      reason: runtime.reason,
      endpointConfigured: providerConfig.endpointConfigured,
      tokenConfigured: providerConfig.tokenConfigured,
    },
    ready: issues.length === 0,
    issues,
  };

  return {
    ok: true as const,
    readiness,
  };
}
