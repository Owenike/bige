import { createHash, timingSafeEqual, createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BIGE_COURSE_LABELS } from "./bige-fitness";
import { createInAppNotifications } from "./in-app-notifications";
import { createSupabaseAdminClient } from "./supabase/admin";

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "booked", "checked_in"];
const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

export function bigeLineGroupVerificationCode(groupId: string) {
  return createHash("sha256").update(groupId.trim()).digest("hex").slice(0, 8).toUpperCase();
}

export function formatBigeLineGroupVerificationCode(code: string | null | undefined) {
  const normalized = String(code || "").trim().toUpperCase();
  return normalized ? `BG-${normalized}` : "尚未取得";
}

export function isBigeLineGroupVerificationCodeRequest(text: string | null | undefined) {
  const normalized = String(text || "")
    .replace(/\s+/g, "")
    .replace(/@BIGE小幫手/gi, "")
    .replace(/BIGE小幫手/gi, "")
    .toLowerCase();
  return ["驗證碼", "群組驗證碼", "綁定", "綁定碼"].includes(normalized);
}

export function buildBigeLineGroupVerificationMessage(params: {
  verificationCode: string;
  joined?: boolean;
}) {
  if (params.joined) {
    return [
      "嗨嗨大家好～我是 BIG E 小幫手小薇👋✨",
      "很開心加入群組！之後會在這裡貼心送上課程通知與提醒，一起開心運動吧 💪",
    ].join("\n");
  }
  return [
    "此群組的 BIG E 驗證碼如下：",
    `群組驗證碼：${formatBigeLineGroupVerificationCode(params.verificationCode)}`,
    "請由櫃台在學員個人資料中核對此碼後完成綁定。",
  ].join("\n");
}

export type BigeLineScheduleEventKind = "created" | "updated" | "cancelled";

export function bigeLineScheduleAnnouncementTitle(eventKind: BigeLineScheduleEventKind) {
  if (eventKind === "created") return "課程預約公告";
  if (eventKind === "cancelled") return "課程取消／更新公告";
  return "課程異動公告";
}

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

export function bigeLineScheduleMonthRange(scheduleMonth: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(scheduleMonth)) {
    throw new Error("invalid_line_schedule_month");
  }
  const [year, month] = scheduleMonth.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  return {
    start: `${scheduleMonth}-01T00:00:00+08:00`,
    end: `${nextMonth}-01T00:00:00+08:00`,
  };
}

export function isBigeLineScheduleDispatchDue(params: {
  nextRetryAt?: string | null;
  scheduledFor?: string | null;
  now?: Date;
}) {
  const availableAt = params.nextRetryAt || params.scheduledFor;
  if (!availableAt) return true;
  const timestamp = new Date(availableAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return timestamp <= (params.now || new Date()).getTime();
}

type ActiveLineGroupBinding = {
  id: string;
  line_group_id: string;
};

export async function resolveActiveBigeLineGroupBinding(params: {
  supabase: SupabaseClient;
  tenantId: string;
  memberId: string;
}): Promise<{ data: ActiveLineGroupBinding | null; error: string | null }> {
  const membershipResult = await params.supabase
    .from("bige_line_group_binding_members")
    .select("binding_id")
    .eq("tenant_id", params.tenantId)
    .eq("member_id", params.memberId)
    .maybeSingle();
  if (membershipResult.error) {
    return { data: null, error: membershipResult.error.message };
  }

  if (membershipResult.data?.binding_id) {
    const bindingResult = await params.supabase
      .from("bige_line_group_bindings")
      .select("id, line_group_id")
      .eq("tenant_id", params.tenantId)
      .eq("id", String(membershipResult.data.binding_id))
      .eq("status", "active")
      .maybeSingle();
    if (bindingResult.error) {
      return { data: null, error: bindingResult.error.message };
    }
    return {
      data: bindingResult.data
        ? {
            id: String(bindingResult.data.id),
            line_group_id: String(bindingResult.data.line_group_id),
          }
        : null,
      error: null,
    };
  }

  // Keep the original primary-member pointer as a deployment-safe fallback.
  const legacyBindingResult = await params.supabase
    .from("bige_line_group_bindings")
    .select("id, line_group_id")
    .eq("tenant_id", params.tenantId)
    .eq("member_id", params.memberId)
    .eq("status", "active")
    .maybeSingle();
  if (legacyBindingResult.error) {
    return { data: null, error: legacyBindingResult.error.message };
  }
  return {
    data: legacyBindingResult.data
      ? {
          id: String(legacyBindingResult.data.id),
          line_group_id: String(legacyBindingResult.data.line_group_id),
        }
      : null,
    error: null,
  };
}

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

async function notifyBigeLineDeliveryFailure(params: {
  supabase: SupabaseClient;
  notificationId: string;
  tenantId: string;
  branchId?: string | null;
  memberId: string;
  error: string;
}) {
  const [memberResult, recipientsResult] = await Promise.all([
    params.supabase
      .from("members")
      .select("full_name")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.memberId)
      .maybeSingle(),
    params.supabase
      .from("profiles")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("department", "coaching")
      .in("position", ["coach_assistant_manager", "coach_manager"])
      .eq("is_active", true),
  ]);
  if (memberResult.error || recipientsResult.error) return;
  const recipientUserIds = (recipientsResult.data || []).map((profile) => String(profile.id));
  if (recipientUserIds.length === 0) return;
  const memberName = String(memberResult.data?.full_name || "學員");
  await createInAppNotifications({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId || null,
    recipientUserIds,
    title: "LINE 課表通知發送失敗",
    message: `${memberName} 的課表通知尚未成功送達；系統會依排程自動補送，請至日排課表的 LINE 通知查看。`,
    severity: "critical",
    eventType: "bige_line_schedule_delivery_failed",
    targetType: "bige_line_schedule_notification",
    targetId: params.notificationId,
    actionUrl: "/manager/fitness",
    payload: {
      memberId: params.memberId,
      memberName,
      deliveryError: params.error.slice(0, 160),
    },
    dedupeKey: `bige-line-schedule-failure:${params.notificationId}`,
    inAppOnly: true,
  }).catch(() => null);
}

async function loadCurrentScheduleSnapshot(params: {
  supabase: SupabaseClient;
  tenantId: string;
  memberId: string;
  scheduleMonth?: string | null;
}): Promise<
  | { ok: true; data: CurrentScheduleSnapshot }
  | { ok: false; error: string; terminal?: "binding" | "member" }
> {
  const monthRange = params.scheduleMonth
    ? bigeLineScheduleMonthRange(params.scheduleMonth)
    : null;
  let scheduleQuery = params.supabase
    .from("bookings")
    .select("id, starts_at, ends_at, course_type, service_name")
    .eq("tenant_id", params.tenantId)
    .eq("member_id", params.memberId)
    .eq("is_bige_schedule", true)
    .eq("operation_kind", "pt")
    .in("status", ACTIVE_BOOKING_STATUSES)
    .gt("starts_at", new Date().toISOString());
  if (monthRange) {
    scheduleQuery = scheduleQuery
      .gte("starts_at", monthRange.start)
      .lt("starts_at", monthRange.end);
  }

  const [bindingResult, memberResult, scheduleResult] = await Promise.all([
    resolveActiveBigeLineGroupBinding(params),
    params.supabase
      .from("members")
      .select("id, full_name")
      .eq("tenant_id", params.tenantId)
      .eq("id", params.memberId)
      .maybeSingle(),
    scheduleQuery.order("starts_at", { ascending: true }).limit(200),
  ]);
  const error = bindingResult.error || memberResult.error?.message || scheduleResult.error?.message;
  if (error) return { ok: false, error };
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
  tenantId: string;
  branchId?: string | null;
  memberId: string;
  attempts: number;
  maxAttempts: number;
  attemptedAt: string;
  error: string;
  providerResponse?: Record<string, unknown>;
  retryable: boolean;
}) {
  const canRetry = params.retryable && params.attempts < params.maxAttempts;
  const updated = await params.supabase
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
    .in("status", ["pending", "retrying"])
    .select("id")
    .maybeSingle();
  if (updated.data) {
    await notifyBigeLineDeliveryFailure({
      supabase: params.supabase,
      notificationId: params.notificationId,
      tenantId: params.tenantId,
      branchId: params.branchId,
      memberId: params.memberId,
      error: params.error,
    });
  }
  return canRetry;
}

export async function dispatchBigeLineScheduleNotification(params: {
  notificationId: string;
  supabase?: SupabaseClient;
}) {
  const supabase = params.supabase || createSupabaseAdminClient();
  const notificationResult = await supabase
    .from("bige_line_schedule_notifications")
    .select("id, tenant_id, branch_id, member_id, event_kind, status, attempts, max_attempts, next_retry_at, scheduled_for, schedule_month, batch_key")
    .eq("id", params.notificationId)
    .maybeSingle();
  if (notificationResult.error || !notificationResult.data) {
    return { ok: false as const, error: notificationResult.error?.message || "notification_not_found" };
  }
  const notification = notificationResult.data;
  if (!["pending", "retrying"].includes(String(notification.status))) {
    return { ok: true as const, status: String(notification.status) };
  }
  if (!isBigeLineScheduleDispatchDue({
    nextRetryAt: notification.next_retry_at ? String(notification.next_retry_at) : null,
    scheduledFor: notification.scheduled_for ? String(notification.scheduled_for) : null,
  })) {
    return { ok: true as const, status: "scheduled" };
  }

  const attempts = Number(notification.attempts || 0) + 1;
  const maxAttempts = Number(notification.max_attempts || 5);
  const attemptedAt = new Date().toISOString();
  const snapshot = await loadCurrentScheduleSnapshot({
    supabase,
    tenantId: String(notification.tenant_id),
    memberId: String(notification.member_id),
    scheduleMonth: notification.schedule_month
      ? String(notification.schedule_month).slice(0, 7)
      : null,
  });
  if (snapshot.ok === false) {
    if (snapshot.terminal === "binding") {
      const cancelled = await supabase
        .from("bige_line_schedule_notifications")
        .update({
          status: "cancelled",
          next_retry_at: null,
          resolution_reason: "line_group_binding_missing_during_delivery",
          updated_at: attemptedAt,
        })
        .eq("id", notification.id)
        .in("status", ["pending", "retrying"])
        .select("id")
        .maybeSingle();
      if (cancelled.data) {
        await notifyBigeLineDeliveryFailure({
          supabase,
          notificationId: notification.id,
          tenantId: String(notification.tenant_id),
          branchId: notification.branch_id ? String(notification.branch_id) : null,
          memberId: String(notification.member_id),
          error: snapshot.error,
        });
      }
      return { ok: false as const, error: snapshot.error };
    }
    await recordRetryableFailure({
      supabase,
      notificationId: notification.id,
      tenantId: String(notification.tenant_id),
      branchId: notification.branch_id ? String(notification.branch_id) : null,
      memberId: String(notification.member_id),
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
      tenantId: String(notification.tenant_id),
      branchId: notification.branch_id ? String(notification.branch_id) : null,
      memberId: String(notification.member_id),
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
      tenantId: String(notification.tenant_id),
      branchId: notification.branch_id ? String(notification.branch_id) : null,
      memberId: String(notification.member_id),
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
      tenantId: String(notification.tenant_id),
      branchId: notification.branch_id ? String(notification.branch_id) : null,
      memberId: String(notification.member_id),
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
      tenantId: String(notification.tenant_id),
      branchId: notification.branch_id ? String(notification.branch_id) : null,
      memberId: String(notification.member_id),
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
  scheduledFor?: string | null;
  scheduleMonth?: string | null;
  batchKey?: string | null;
  supabase?: SupabaseClient;
}) {
  const supabase = params.supabase || createSupabaseAdminClient();
  const oneTimeValues = [params.scheduledFor, params.scheduleMonth, params.batchKey];
  const isOneTimeBatch = oneTimeValues.some(Boolean);
  if (isOneTimeBatch && oneTimeValues.some((value) => !value)) {
    return { ok: false as const, error: "invalid_one_time_line_schedule_request" };
  }
  if (params.scheduleMonth) {
    try {
      bigeLineScheduleMonthRange(params.scheduleMonth);
    } catch {
      return { ok: false as const, error: "invalid_line_schedule_month" };
    }
  }
  if (params.scheduledFor && !Number.isFinite(new Date(params.scheduledFor).getTime())) {
    return { ok: false as const, error: "invalid_line_schedule_delivery_time" };
  }
  const snapshot = await loadCurrentScheduleSnapshot({
    supabase,
    tenantId: params.tenantId,
    memberId: params.memberId,
    scheduleMonth: params.scheduleMonth,
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
  const queued = await supabase.rpc(
    isOneTimeBatch
      ? "bige_queue_line_schedule_notification_v3"
      : "bige_queue_line_schedule_notification_v2",
    {
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
      ...(isOneTimeBatch
        ? {
            p_scheduled_for: params.scheduledFor,
            p_schedule_month: `${params.scheduleMonth}-01`,
            p_batch_key: params.batchKey,
          }
        : {}),
    },
  );
  if (queued.error) return { ok: false as const, error: queued.error.message };
  const row = Array.isArray(queued.data) ? queued.data[0] : queued.data;
  if (!row?.notification_id) return { ok: false as const, error: "line_notification_queue_failed" };
  if (!row.inserted) {
    const existingStatus = String(row.notification_status || "pending");
    const status =
      existingStatus === "pending" &&
      isOneTimeBatch &&
      !isBigeLineScheduleDispatchDue({ scheduledFor: params.scheduledFor })
        ? "scheduled"
        : existingStatus;
    return {
      ok: !["failed", "cancelled"].includes(existingStatus),
      status,
      notificationId: String(row.notification_id),
      deduplicated: true as const,
    };
  }
  if (isOneTimeBatch && !isBigeLineScheduleDispatchDue({
    scheduledFor: params.scheduledFor,
  })) {
    return {
      ok: true as const,
      status: "scheduled",
      notificationId: String(row.notification_id),
    };
  }
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

export async function queueBigeLineScheduleBatch(params: {
  tenantId: string;
  targets: Array<{ memberId: string; branchId?: string | null }>;
  scheduleMonth: string;
  scheduledFor: string;
  idempotencyKey: string;
  createdBy: string;
  supabase?: SupabaseClient;
}) {
  const supabase = params.supabase || createSupabaseAdminClient();
  const uniqueTargets = Array.from(
    new Map(params.targets.map((target) => [target.memberId, target])).values(),
  );
  const batchKey = `one-time:${params.idempotencyKey}`;
  const results: Array<{
    memberId: string;
    ok: boolean;
    accepted: boolean;
    status: string;
    notificationId?: string;
    error?: string;
  }> = [];

  for (const target of uniqueTargets) {
    const dedupeHash = createHash("sha256")
      .update(`${params.tenantId}:${params.idempotencyKey}:${target.memberId}`)
      .digest("hex");
    const queued = await queueBigeLineScheduleSnapshot({
      tenantId: params.tenantId,
      branchId: target.branchId || null,
      memberId: target.memberId,
      eventKind: "updated",
      dedupeKey: `one-time:${dedupeHash}`,
      createdBy: params.createdBy,
      scheduledFor: params.scheduledFor,
      scheduleMonth: params.scheduleMonth,
      batchKey,
      supabase,
    });
    const status = "status" in queued ? String(queued.status) : queued.ok ? "accepted" : "failed";
    results.push({
      memberId: target.memberId,
      ok: queued.ok,
      accepted: queued.ok || status === "queued",
      status,
      notificationId: "notificationId" in queued ? queued.notificationId : undefined,
      error: queued.ok ? undefined : queued.error,
    });
  }

  const accepted = results.filter((result) => result.accepted).length;
  const failed = results.length - accepted;
  const retrying = results.filter((result) => ["queued", "retrying"].includes(result.status)).length;
  const delivered = results.filter((result) => result.status === "sent").length;
  return {
    ok: failed === 0,
    batchKey,
    scheduledFor: params.scheduledFor,
    scheduleMonth: params.scheduleMonth,
    total: results.length,
    accepted,
    failed,
    retrying,
    delivered,
    results,
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
