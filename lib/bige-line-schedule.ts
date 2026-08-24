import { createHash, timingSafeEqual, createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BIGE_COURSE_LABELS } from "./bige-fitness";
import { createSupabaseAdminClient } from "./supabase/admin";

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "booked", "checked_in"];
const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

export type BigeLineScheduleEventKind = "created" | "updated" | "cancelled";

type ScheduleRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  course_type: keyof typeof BIGE_COURSE_LABELS | null;
  service_name: string | null;
};

type CurrentScheduleSnapshot = {
  binding: {
    id: string;
    line_group_id: string;
  };
  memberName: string;
  schedules: ScheduleRow[];
};

function taipeiParts(value: string) {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    month: read("month"),
    day: read("day"),
    weekday: read("weekday"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function scheduleLine(row: ScheduleRow) {
  const time = taipeiParts(row.starts_at);
  const course = row.course_type
    ? BIGE_COURSE_LABELS[row.course_type]
    : row.service_name || "正式課程";
  return `${time.month}/${time.day}（${time.weekday}） ${time.hour}:${time.minute} ${course}`;
}

export function buildBigeLineScheduleMessage(params: {
  memberName: string;
  eventKind: BigeLineScheduleEventKind;
  schedules: ScheduleRow[];
}) {
  const heading =
    params.eventKind === "created"
      ? "📅 課程預約通知"
      : params.eventKind === "cancelled"
        ? "📅 課程取消／更新通知"
        : "📅 課程異動通知";
  if (params.schedules.length === 0) {
    return `${heading}\n${params.memberName} 您好，目前沒有尚未開始的正式課程。\n\n如需協助，請聯繫 BIG E。`;
  }
  return [
    heading,
    `${params.memberName} 您好，以下為目前尚未開始的正式課程：`,
    "",
    ...params.schedules.map(scheduleLine),
    "",
    "如需調整，請聯繫 BIG E。",
  ].join("\n");
}

export function bigeLineRetryDelayMinutes(attempts: number) {
  const delays = [5, 15, 60, 360] as const;
  return delays[Math.min(delays.length - 1, Math.max(0, attempts - 1))];
}

function nextRetryAt(attempts: number) {
  return new Date(Date.now() + bigeLineRetryDelayMinutes(attempts) * 60_000).toISOString();
}

function safeProviderBody(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed;
  } catch {
    return { response: value.slice(0, 500) };
  }
}

async function loadCurrentScheduleSnapshot(params: {
  supabase: SupabaseClient;
  tenantId: string;
  memberId: string;
}): Promise<
  | { ok: true; data: CurrentScheduleSnapshot }
  | { ok: false; error: string; terminal?: "binding" | "member" }
> {
  const [bindingResult, memberResult, scheduleResult] = await Promise.all([
    params.supabase
      .from("bige_line_group_bindings")
      .select("id, line_group_id")
      .eq("tenant_id", params.tenantId)
      .eq("member_id", params.memberId)
      .eq("status", "active")
      .maybeSingle(),
    params.supabase
      .from("members")
      .select("id, full_name")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.memberId)
      .maybeSingle(),
    params.supabase
      .from("bookings")
      .select("id, starts_at, ends_at, course_type, service_name")
      .eq("tenant_id", params.tenantId)
      .eq("member_id", params.memberId)
      .eq("is_bige_schedule", true)
      .eq("operation_kind", "pt")
      .in("status", ACTIVE_BOOKING_STATUSES)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(200),
  ]);
  const error = bindingResult.error || memberResult.error || scheduleResult.error;
  if (error) return { ok: false, error: error.message };
  if (!bindingResult.data) {
    return { ok: false, error: "line_group_binding_required", terminal: "binding" };
  }
  if (!memberResult.data) {
    return { ok: false, error: "member_not_found", terminal: "member" };
  }
  return {
    ok: true,
    data: {
      binding: {
        id: String(bindingResult.data.id),
        line_group_id: String(bindingResult.data.line_group_id),
      },
      memberName: String(memberResult.data.full_name || "學員"),
      schedules: (scheduleResult.data || []) as ScheduleRow[],
    },
  };
}

async function recordRetryableFailure(params: {
  supabase: SupabaseClient;
  notificationId: string;
  attempts: number;
  maxAttempts: number;
  attemptedAt: string;
  error: string;
  providerResponse?: Record<string, unknown>;
  retryable: boolean;
}) {
  const canRetry = params.retryable && params.attempts < params.maxAttempts;
  await params.supabase
    .from("bige_line_schedule_notifications")
    .update({
      status: canRetry ? "retrying" : "failed",
      attempts: params.attempts,
      last_attempt_at: params.attemptedAt,
      next_retry_at: canRetry ? nextRetryAt(params.attempts) : null,
      last_error: params.error,
      provider_response: params.providerResponse || {},
      resolution_reason: null,
      updated_at: params.attemptedAt,
    })
    .eq("id", params.notificationId)
    .in("status", ["pending", "retrying"]);
  return canRetry;
}

export async function dispatchBigeLineScheduleNotification(params: {
  notificationId: string;
  supabase?: SupabaseClient;
}) {
  const supabase = params.supabase || createSupabaseAdminClient();
  const notificationResult = await supabase
    .from("bige_line_schedule_notifications")
    .select("id, tenant_id, member_id, event_kind, status, attempts, max_attempts")
    .eq("id", params.notificationId)
    .maybeSingle();
  if (notificationResult.error || !notificationResult.data) {
    return { ok: false as const, error: notificationResult.error?.message || "notification_not_found" };
  }
  const notification = notificationResult.data;
  if (!["pending", "retrying"].includes(String(notification.status))) {
    return { ok: true as const, status: String(notification.status) };
  }

  const attempts = Number(notification.attempts || 0) + 1;
  const maxAttempts = Number(notification.max_attempts || 5);
  const attemptedAt = new Date().toISOString();
  const snapshot = await loadCurrentScheduleSnapshot({
    supabase,
    tenantId: String(notification.tenant_id),
    memberId: String(notification.member_id),
  });
  if (snapshot.ok === false) {
    if (snapshot.terminal === "binding") {
      await supabase
        .from("bige_line_schedule_notifications")
        .update({
          status: "cancelled",
          next_retry_at: null,
          resolution_reason: "line_group_binding_missing_during_delivery",
          updated_at: attemptedAt,
        })
        .eq("id", notification.id);
      return { ok: false as const, error: snapshot.error };
    }
    await recordRetryableFailure({
      supabase,
      notificationId: notification.id,
      attempts,
      maxAttempts,
      attemptedAt,
      error: snapshot.error,
      retryable: snapshot.terminal !== "member",
    });
    return { ok: false as const, error: snapshot.error };
  }

  const message = buildBigeLineScheduleMessage({
    memberName: snapshot.data.memberName,
    eventKind: notification.event_kind as BigeLineScheduleEventKind,
    schedules: snapshot.data.schedules,
  });
  const refreshed = await supabase
    .from("bige_line_schedule_notifications")
    .update({
      binding_id: snapshot.data.binding.id,
      message,
      schedule_snapshot: snapshot.data.schedules,
      snapshot_refreshed_at: attemptedAt,
      updated_at: attemptedAt,
    })
    .eq("id", notification.id)
    .in("status", ["pending", "retrying"])
    .select("id, status")
    .maybeSingle();
  if (refreshed.error) {
    await recordRetryableFailure({
      supabase,
      notificationId: notification.id,
      attempts,
      maxAttempts,
      attemptedAt,
      error: refreshed.error.message,
      retryable: true,
    });
    return { ok: false as const, error: refreshed.error.message };
  }
  if (!refreshed.data) {
    return { ok: true as const, status: "superseded" };
  }

  const token = process.env.LINE_STUDENT_SCHEDULE_CHANNEL_ACCESS_TOKEN || "";
  if (!token) {
    await recordRetryableFailure({
      supabase,
      notificationId: notification.id,
      attempts,
      maxAttempts,
      attemptedAt,
      error: "line_student_schedule_token_missing",
      retryable: false,
    });
    return { ok: false as const, error: "line_student_schedule_token_missing" };
  }

  try {
    const response = await fetch(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": notification.id,
      },
      body: JSON.stringify({
        to: snapshot.data.binding.line_group_id,
        messages: [{ type: "text", text: message }],
      }),
    });
    const responseText = await response.text();
    const providerResponse = {
      status: response.status,
      requestId: response.headers.get("x-line-request-id"),
      acceptedRequestId: response.headers.get("x-line-accepted-request-id"),
      ...safeProviderBody(responseText),
    };
    if (response.ok || response.status === 409) {
      await supabase
        .from("bige_line_schedule_notifications")
        .update({
          status: "sent",
          attempts,
          last_attempt_at: attemptedAt,
          next_retry_at: null,
          sent_at: attemptedAt,
          last_error: null,
          resolution_reason: null,
          provider_response: providerResponse,
          updated_at: attemptedAt,
        })
        .eq("id", notification.id);
      return { ok: true as const, status: "sent" };
    }
    await recordRetryableFailure({
      supabase,
      notificationId: notification.id,
      attempts,
      maxAttempts,
      attemptedAt,
      error: `LINE HTTP ${response.status}`,
      providerResponse,
      retryable: response.status === 429 || response.status >= 500,
    });
    return { ok: false as const, error: `LINE HTTP ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "line_push_failed";
    await recordRetryableFailure({
      supabase,
      notificationId: notification.id,
      attempts,
      maxAttempts,
      attemptedAt,
      error: message,
      providerResponse: { networkError: true },
      retryable: true,
    });
    return { ok: false as const, error: message };
  }
}

export async function queueBigeLineScheduleSnapshot(params: {
  tenantId: string;
  branchId?: string | null;
  memberId: string;
  eventKind: BigeLineScheduleEventKind;
  dedupeKey: string;
  createdBy?: string | null;
  manualRetryOfNotificationId?: string | null;
  supabase?: SupabaseClient;
}) {
  const supabase = params.supabase || createSupabaseAdminClient();
  const snapshot = await loadCurrentScheduleSnapshot({
    supabase,
    tenantId: params.tenantId,
    memberId: params.memberId,
  });
  if (snapshot.ok === false) {
    if (snapshot.terminal === "binding") {
      return { ok: false as const, error: snapshot.error, skipped: true as const };
    }
    return { ok: false as const, error: snapshot.error };
  }
  const message = buildBigeLineScheduleMessage({
    memberName: snapshot.data.memberName,
    eventKind: params.eventKind,
    schedules: snapshot.data.schedules,
  });
  const queued = await supabase.rpc("bige_queue_line_schedule_notification_v2", {
    p_tenant_id: params.tenantId,
    p_branch_id: params.branchId || null,
    p_member_id: params.memberId,
    p_binding_id: snapshot.data.binding.id,
    p_event_kind: params.eventKind,
    p_message: message,
    p_schedule_snapshot: snapshot.data.schedules,
    p_dedupe_key: params.dedupeKey,
    p_created_by: params.createdBy || null,
    p_manual_retry_of_notification_id: params.manualRetryOfNotificationId || null,
  });
  if (queued.error) return { ok: false as const, error: queued.error.message };
  const row = Array.isArray(queued.data) ? queued.data[0] : queued.data;
  if (!row?.notification_id) return { ok: false as const, error: "line_notification_queue_failed" };
  if (!row.inserted) return { ok: true as const, status: "deduplicated" };
  const delivery = await dispatchBigeLineScheduleNotification({
    supabase,
    notificationId: row.notification_id,
  });
  return {
    ok: delivery.ok,
    status: delivery.ok ? delivery.status : "queued",
    notificationId: row.notification_id,
    error: delivery.ok ? undefined : delivery.error,
  };
}

export async function dispatchPendingBigeLineScheduleNotifications(params?: {
  supabase?: SupabaseClient;
  limit?: number;
}) {
  const supabase = params?.supabase || createSupabaseAdminClient();
  const now = new Date().toISOString();
  const result = await supabase
    .from("bige_line_schedule_notifications")
    .select("id")
    .in("status", ["pending", "retrying"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(Math.min(200, Math.max(1, params?.limit || 100)));
  if (result.error) return { ok: false as const, error: result.error.message };
  let sent = 0;
  let failed = 0;
  for (const row of result.data || []) {
    const delivery = await dispatchBigeLineScheduleNotification({ supabase, notificationId: row.id });
    if (delivery.ok) sent += 1;
    else failed += 1;
  }
  return { ok: true as const, processed: (result.data || []).length, sent, failed };
}

export function verifyBigeLineWebhookSignature(rawBody: string, signature: string | null) {
  const secret = process.env.LINE_STUDENT_SCHEDULE_CHANNEL_SECRET || "";
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function bigeLineWebhookDedupeKey(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex");
}
