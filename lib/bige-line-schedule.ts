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

function nextRetryAt(attempts: number) {
  const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1) * 5);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function safeProviderBody(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed;
  } catch {
    return { response: value.slice(0, 500) };
  }
}

export async function dispatchBigeLineScheduleNotification(params: {
  notificationId: string;
  supabase?: SupabaseClient;
}) {
  const supabase = params.supabase || createSupabaseAdminClient();
  const notificationResult = await supabase
    .from("bige_line_schedule_notifications")
    .select("id, binding_id, message, status, attempts, max_attempts")
    .eq("id", params.notificationId)
    .maybeSingle();
  if (notificationResult.error || !notificationResult.data) {
    return { ok: false as const, error: notificationResult.error?.message || "notification_not_found" };
  }
  const notification = notificationResult.data;
  if (!["pending", "retrying"].includes(String(notification.status))) {
    return { ok: true as const, status: String(notification.status) };
  }
  const bindingResult = await supabase
    .from("bige_line_group_bindings")
    .select("id, line_group_id, status")
    .eq("id", notification.binding_id)
    .maybeSingle();
  if (bindingResult.error || !bindingResult.data || bindingResult.data.status !== "active") {
    await supabase
      .from("bige_line_schedule_notifications")
      .update({
        status: "cancelled",
        last_error: "line_group_binding_inactive",
        updated_at: new Date().toISOString(),
      })
      .eq("id", notification.id);
    return { ok: false as const, error: "line_group_binding_inactive" };
  }
  const token = process.env.LINE_STUDENT_SCHEDULE_CHANNEL_ACCESS_TOKEN || "";
  if (!token) return { ok: false as const, error: "line_student_schedule_token_missing" };

  const attempts = Number(notification.attempts || 0) + 1;
  const attemptedAt = new Date().toISOString();
  try {
    const response = await fetch(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": notification.id,
      },
      body: JSON.stringify({
        to: bindingResult.data.line_group_id,
        messages: [{ type: "text", text: notification.message }],
      }),
    });
    const responseText = await response.text();
    const providerResponse = {
      status: response.status,
      requestId: response.headers.get("x-line-request-id"),
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
          provider_response: providerResponse,
          updated_at: attemptedAt,
        })
        .eq("id", notification.id);
      return { ok: true as const, status: "sent" };
    }
    const retryable = response.status === 429 || response.status >= 500;
    const canRetry = retryable && attempts < Number(notification.max_attempts || 5);
    await supabase
      .from("bige_line_schedule_notifications")
      .update({
        status: canRetry ? "retrying" : "failed",
        attempts,
        last_attempt_at: attemptedAt,
        next_retry_at: canRetry ? nextRetryAt(attempts) : null,
        last_error: `LINE HTTP ${response.status}`,
        provider_response: providerResponse,
        updated_at: attemptedAt,
      })
      .eq("id", notification.id);
    return { ok: false as const, error: `LINE HTTP ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "line_push_failed";
    const canRetry = attempts < Number(notification.max_attempts || 5);
    await supabase
      .from("bige_line_schedule_notifications")
      .update({
        status: canRetry ? "retrying" : "failed",
        attempts,
        last_attempt_at: attemptedAt,
        next_retry_at: canRetry ? nextRetryAt(attempts) : null,
        last_error: message,
        provider_response: { networkError: true },
        updated_at: attemptedAt,
      })
      .eq("id", notification.id);
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
  supabase?: SupabaseClient;
}) {
  const supabase = params.supabase || createSupabaseAdminClient();
  const [bindingResult, memberResult, scheduleResult] = await Promise.all([
    supabase
      .from("bige_line_group_bindings")
      .select("id, group_name")
      .eq("tenant_id", params.tenantId)
      .eq("member_id", params.memberId)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("members")
      .select("id, full_name")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.memberId)
      .maybeSingle(),
    supabase
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
  if (error) return { ok: false as const, error: error.message };
  if (!bindingResult.data) return { ok: false as const, error: "line_group_binding_required", skipped: true as const };
  if (!memberResult.data) return { ok: false as const, error: "member_not_found" };
  const schedules = (scheduleResult.data || []) as ScheduleRow[];
  const message = buildBigeLineScheduleMessage({
    memberName: String(memberResult.data.full_name || "學員"),
    eventKind: params.eventKind,
    schedules,
  });
  const insert = await supabase
    .from("bige_line_schedule_notifications")
    .upsert(
      {
        tenant_id: params.tenantId,
        branch_id: params.branchId || null,
        member_id: params.memberId,
        binding_id: bindingResult.data.id,
        event_kind: params.eventKind,
        status: "pending",
        message,
        schedule_snapshot: schedules,
        dedupe_key: params.dedupeKey,
        created_by: params.createdBy || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    )
    .select("id, status")
    .maybeSingle();
  if (insert.error) return { ok: false as const, error: insert.error.message };
  if (!insert.data) return { ok: true as const, status: "deduplicated" };
  const delivery = await dispatchBigeLineScheduleNotification({
    supabase,
    notificationId: insert.data.id,
  });
  return {
    ok: delivery.ok,
    status: delivery.ok ? delivery.status : "queued",
    notificationId: insert.data.id,
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
