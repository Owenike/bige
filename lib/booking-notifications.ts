import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import { insertDeliveryRows, type DeliveryChannel, type DeliveryRow } from "./notification-ops";
import { buildTemplateKey } from "./notification-productization";
import { resolveNotificationTemplate, type NotificationTemplateResolutionRow } from "./notification-template-resolution-service";
import { getRolePreferenceDetail, getUserPreferenceDetail } from "./notification-preferences";
import { resolveNotificationPreference } from "./notification-preference-resolution-service";
import { resolveNotificationDeliveryRuntime, type DeliveryRuntimeCache } from "./notification-delivery-adapter";

export const BOOKING_NOTIFICATION_EVENTS = [
  "booking_created",
  "booking_rescheduled",
  "booking_cancelled",
  "booking_reminder_day_before",
  "booking_reminder_1h",
  "booking_deposit_pending",
] as const;

export type BookingNotificationEventType = (typeof BOOKING_NOTIFICATION_EVENTS)[number];

export const BOOKING_TEMPLATE_VARIABLES = [
  "customerName",
  "serviceName",
  "bookingDate",
  "bookingTime",
  "branchName",
  "branchAddress",
  "therapistName",
  "publicReference",
  "depositAmount",
  "outstandingAmount",
] as const;

export const BOOKING_TEMPLATE_FALLBACKS: Record<
  BookingNotificationEventType,
  {
    title: string;
    message: string;
    emailSubject: string;
  }
> = {
  booking_created: {
    title: "預約已建立",
    message: "{{customerName}}，您已成功預約 {{serviceName}}。時間：{{bookingDate}} {{bookingTime}}，預約編號：{{publicReference}}。",
    emailSubject: "預約成功通知",
  },
  booking_rescheduled: {
    title: "預約已改期",
    message: "{{customerName}}，您的 {{serviceName}} 預約已改為 {{bookingDate}} {{bookingTime}}，預約編號：{{publicReference}}。",
    emailSubject: "預約改期通知",
  },
  booking_cancelled: {
    title: "預約已取消",
    message: "{{customerName}}，您的 {{serviceName}} 預約已取消，預約編號：{{publicReference}}。",
    emailSubject: "預約取消通知",
  },
  booking_reminder_day_before: {
    title: "預約前一天提醒",
    message: "{{customerName}}，提醒您明天 {{bookingTime}} 於 {{branchName}} 有 {{serviceName}} 預約。",
    emailSubject: "預約提醒",
  },
  booking_reminder_1h: {
    title: "預約即將開始",
    message: "{{customerName}}，您的 {{serviceName}} 預約將於 1 小時後開始。",
    emailSubject: "預約即將開始",
  },
  booking_deposit_pending: {
    title: "尚有訂金待支付",
    message: "{{customerName}}，您的預約仍有 {{depositAmount}} 訂金待支付。",
    emailSubject: "訂金付款提醒",
  },
};

const CLEAN_BOOKING_TEMPLATE_FALLBACKS: Record<
  BookingNotificationEventType,
  {
    title: string;
    message: string;
    emailSubject: string;
  }
> = {
  booking_created: {
    title: "預約建立成功",
    message: "{{customerName}}，您的 {{serviceName}} 已預約成功，時間為 {{bookingDate}} {{bookingTime}}，預約編號 {{publicReference}}。",
    emailSubject: "預約已建立",
  },
  booking_rescheduled: {
    title: "預約已改期",
    message: "{{customerName}}，您的 {{serviceName}} 已改期至 {{bookingDate}} {{bookingTime}}，預約編號 {{publicReference}}。",
    emailSubject: "預約已改期",
  },
  booking_cancelled: {
    title: "預約已取消",
    message: "{{customerName}}，您的 {{serviceName}} 預約已取消，預約編號 {{publicReference}}。",
    emailSubject: "預約已取消",
  },
  booking_reminder_day_before: {
    title: "預約前一天提醒",
    message: "{{customerName}}，提醒您明天 {{bookingTime}} 將於 {{branchName}} 進行 {{serviceName}} 預約。",
    emailSubject: "預約提醒",
  },
  booking_reminder_1h: {
    title: "預約一小時提醒",
    message: "{{customerName}}，您的 {{serviceName}} 預約將在 1 小時後開始，請留意時間。",
    emailSubject: "預約即將開始",
  },
  booking_deposit_pending: {
    title: "訂金待支付提醒",
    message: "{{customerName}}，您的預約尚需支付訂金 {{depositAmount}}，請於到店前完成確認。",
    emailSubject: "訂金待支付提醒",
  },
};

export type BookingNotificationSummaryItem = {
  id: string;
  eventType: string;
  channel: string;
  status: string;
  templateKey: string | null;
  deliveryMode: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  skippedReason: string | null;
  failureReason: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientEmail: string | null;
  createdAt: string;
};

type BookingLifecycleChannel = Exclude<DeliveryChannel, "other" | "webhook">;

type BookingNotificationSnapshot = {
  bookingId: string;
  tenantId: string;
  branchId: string | null;
  memberId: string;
  memberAuthUserId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  lineUserId: string | null;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  paymentStatus: string;
  depositRequiredAmount: number;
  depositPaidAmount: number;
  outstandingAmount: number;
  publicReference: string | null;
  therapistName: string | null;
  branchName: string | null;
  branchAddress: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ScheduleBookingNotificationsInput = {
  supabase?: SupabaseClient;
  tenantId: string;
  bookingId: string;
  actorId?: string | null;
  locale?: string;
  trigger:
    | "created"
    | "rescheduled"
    | "cancelled"
    | "status_completed"
    | "status_no_show"
    | "payment_deposit_paid"
    | "payment_deposit_pending_refresh";
};

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBookingDate(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatBookingTime(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function shiftIso(base: string, minutes: number) {
  const ts = new Date(base).getTime();
  return new Date(ts + minutes * 60 * 1000).toISOString();
}

function isBookingActiveForReminder(status: string) {
  return !["cancelled", "completed", "no_show"].includes(status);
}

function interpolateTemplate(input: string, variables: Record<string, string>) {
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => variables[key] ?? "");
}

function fallbackTemplate(eventType: BookingNotificationEventType) {
  return CLEAN_BOOKING_TEMPLATE_FALLBACKS[eventType];
}

async function loadBookingNotificationSnapshot(params: {
  supabase: SupabaseClient;
  tenantId: string;
  bookingId: string;
}) {
  const bookingResult = await params.supabase
    .from("bookings")
    .select(
      "id, tenant_id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, payment_status, deposit_required_amount, deposit_paid_amount, outstanding_amount, public_reference, created_at, updated_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("id", params.bookingId)
    .maybeSingle();
  if (bookingResult.error || !bookingResult.data) {
    throw new Error(bookingResult.error?.message || "Booking notification snapshot not found");
  }

  const booking = bookingResult.data as Record<string, unknown>;
  const [memberResult, coachResult, branchResult, lineIdentityResult] = await Promise.all([
    params.supabase
      .from("members")
      .select("id, full_name, phone, email, auth_user_id")
      .eq("tenant_id", params.tenantId)
      .eq("id", String(booking.member_id))
      .maybeSingle(),
    booking.coach_id
      ? params.supabase
          .from("profiles")
          .select("id, display_name")
          .eq("tenant_id", params.tenantId)
          .eq("id", String(booking.coach_id))
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    booking.branch_id
      ? params.supabase
          .from("branches")
          .select("id, name, address")
          .eq("tenant_id", params.tenantId)
          .eq("id", String(booking.branch_id))
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    params.supabase
      .from("member_identities")
      .select("value")
      .eq("tenant_id", params.tenantId)
      .eq("member_id", String(booking.member_id))
      .eq("type", "line_user_id")
      .maybeSingle(),
  ]);

  if (memberResult.error || !memberResult.data) {
    throw new Error(memberResult.error?.message || "Member not found for booking notification");
  }
  if (coachResult.error) throw new Error(coachResult.error.message);
  if (branchResult.error) throw new Error(branchResult.error.message);
  if (lineIdentityResult.error) throw new Error(lineIdentityResult.error.message);

  return {
    bookingId: String(booking.id),
    tenantId: String(booking.tenant_id),
    branchId: (booking.branch_id as string | null) ?? null,
    memberId: String(booking.member_id),
    memberAuthUserId: memberResult.data.auth_user_id ? String(memberResult.data.auth_user_id) : null,
    customerName: String(memberResult.data.full_name || "顧客"),
    customerPhone: memberResult.data.phone ? String(memberResult.data.phone) : null,
    customerEmail: memberResult.data.email ? String(memberResult.data.email) : null,
    lineUserId: lineIdentityResult.data?.value ? String(lineIdentityResult.data.value) : null,
    serviceName: String(booking.service_name || "療程"),
    startsAt: String(booking.starts_at),
    endsAt: String(booking.ends_at),
    status: String(booking.status || "booked"),
    paymentStatus: String(booking.payment_status || "unpaid"),
    depositRequiredAmount: toNumber(booking.deposit_required_amount),
    depositPaidAmount: toNumber(booking.deposit_paid_amount),
    outstandingAmount: toNumber(booking.outstanding_amount),
    publicReference: booking.public_reference ? String(booking.public_reference) : null,
    therapistName: coachResult.data?.display_name ? String(coachResult.data.display_name) : null,
    branchName: branchResult.data?.name ? String(branchResult.data.name) : null,
    branchAddress: branchResult.data?.address ? String(branchResult.data.address) : null,
    createdAt: booking.created_at ? String(booking.created_at) : null,
    updatedAt: booking.updated_at ? String(booking.updated_at) : null,
  } satisfies BookingNotificationSnapshot;
}

async function loadTemplates(params: {
  supabase: SupabaseClient;
  tenantId: string;
  eventType: BookingNotificationEventType;
  channels: BookingLifecycleChannel[];
}) {
  const result = await params.supabase
    .from("notification_templates")
    .select("id, tenant_id, event_type, channel, locale, title_template, message_template, email_subject, action_url, priority, channel_policy, is_active, version, updated_at")
    .or(`tenant_id.eq.${params.tenantId},tenant_id.is.null`)
    .eq("event_type", params.eventType)
    .in("channel", params.channels)
    .eq("is_active", true)
    .order("updated_at", { ascending: false });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data || []) as NotificationTemplateResolutionRow[];
}

function buildVariables(snapshot: BookingNotificationSnapshot) {
  return {
    customerName: snapshot.customerName,
    serviceName: snapshot.serviceName,
    bookingDate: formatBookingDate(snapshot.startsAt),
    bookingTime: formatBookingTime(snapshot.startsAt),
    branchName: snapshot.branchName || "門市",
    branchAddress: snapshot.branchAddress || "",
    therapistName: snapshot.therapistName || "療癒師",
    publicReference: snapshot.publicReference || "",
    depositAmount: new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: "TWD",
      maximumFractionDigits: 0,
    }).format(snapshot.depositRequiredAmount || 0),
    outstandingAmount: new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: "TWD",
      maximumFractionDigits: 0,
    }).format(snapshot.outstandingAmount || 0),
  };
}

function buildChannels(snapshot: BookingNotificationSnapshot) {
  const channels = new Set<BookingLifecycleChannel>();
  if (snapshot.memberAuthUserId) channels.add("in_app");
  if (snapshot.customerEmail) channels.add("email");
  if (snapshot.customerPhone) channels.add("sms");
  channels.add("line");
  if (channels.size === 0) channels.add("in_app");
  return Array.from(channels);
}

async function resolveRecipientPreference(params: {
  supabase: SupabaseClient;
  tenantId: string;
  eventType: BookingNotificationEventType;
  memberAuthUserId: string | null;
}) {
  const [rolePreferenceResult, userPreferenceResult] = await Promise.all([
    getRolePreferenceDetail({
      tenantId: params.tenantId,
      role: "member",
      eventType: params.eventType,
    }),
    params.memberAuthUserId
      ? getUserPreferenceDetail({
          tenantId: params.tenantId,
          userId: params.memberAuthUserId,
          eventType: params.eventType,
        })
      : Promise.resolve({ ok: true as const, item: null }),
  ]);

  if (!rolePreferenceResult.ok) {
    throw new Error(rolePreferenceResult.error);
  }
  if (!userPreferenceResult.ok) {
    throw new Error("error" in userPreferenceResult ? userPreferenceResult.error : "notification_user_preference_unavailable");
  }

  const hasExplicitRule = Boolean(rolePreferenceResult.item || userPreferenceResult.item);
  if (!hasExplicitRule) {
    return {
      hasExplicitRule,
      enabled: true,
      channels: null as Record<BookingLifecycleChannel, boolean> | null,
      reason: null as string | null,
      source: null as string | null,
    };
  }

  const resolved = resolveNotificationPreference({
    rolePreference: rolePreferenceResult.item
      ? {
          enabled: rolePreferenceResult.item.is_enabled,
          channels: rolePreferenceResult.item.channels,
          reason: rolePreferenceResult.item.note,
        }
      : null,
    userPreference: userPreferenceResult.item
      ? {
          enabled: userPreferenceResult.item.is_enabled,
          channels: userPreferenceResult.item.channels,
          reason: userPreferenceResult.item.note,
        }
      : null,
  });

  return {
    hasExplicitRule,
    enabled: resolved.enabled,
    channels: resolved.channels as Record<BookingLifecycleChannel, boolean>,
    reason: resolved.explain,
    source: resolved.source,
  };
}

function scheduleForEvent(params: {
  eventType: BookingNotificationEventType;
  snapshot: BookingNotificationSnapshot;
}) {
  const startTs = new Date(params.snapshot.startsAt).getTime();
  if (!Number.isFinite(startTs)) return null;
  if (params.eventType === "booking_created" || params.eventType === "booking_rescheduled" || params.eventType === "booking_cancelled") {
    return nowIso();
  }
  if (params.eventType === "booking_reminder_day_before") {
    const scheduledFor = shiftIso(params.snapshot.startsAt, -24 * 60);
    return new Date(scheduledFor).getTime() > Date.now() ? scheduledFor : null;
  }
  if (params.eventType === "booking_reminder_1h") {
    const scheduledFor = shiftIso(params.snapshot.startsAt, -60);
    return new Date(scheduledFor).getTime() > Date.now() ? scheduledFor : null;
  }
  if (params.eventType === "booking_deposit_pending") {
    const candidate = Math.min(startTs - 120 * 60 * 1000, Date.now() + 30 * 60 * 1000);
    if (candidate <= Date.now() && startTs > Date.now()) {
      return nowIso();
    }
    return candidate > Date.now() ? new Date(candidate).toISOString() : null;
  }
  return null;
}

function dedupeKey(params: {
  snapshot: BookingNotificationSnapshot;
  eventType: BookingNotificationEventType;
  channel: BookingLifecycleChannel;
  scheduledFor: string | null;
}) {
  return [
    "booking",
    params.snapshot.tenantId,
    params.snapshot.bookingId,
    params.eventType,
    params.channel,
    params.scheduledFor || "immediate",
  ].join(":");
}

async function enqueueEvent(params: {
  supabase: SupabaseClient;
  snapshot: BookingNotificationSnapshot;
  actorId: string | null;
  locale: string;
  eventType: BookingNotificationEventType;
}) {
  const channels = buildChannels(params.snapshot);
  const templates = await loadTemplates({
    supabase: params.supabase,
    tenantId: params.snapshot.tenantId,
    eventType: params.eventType,
    channels,
  });
  const variables = buildVariables(params.snapshot);
  const rows = [];
  const preference = await resolveRecipientPreference({
    supabase: params.supabase,
    tenantId: params.snapshot.tenantId,
    eventType: params.eventType,
    memberAuthUserId: params.snapshot.memberAuthUserId,
  });
  const runtimeCache: DeliveryRuntimeCache = {
    settings: new Map(),
  };

  for (const channel of channels) {
    const scheduledFor = scheduleForEvent({
      eventType: params.eventType,
      snapshot: params.snapshot,
    });
    if (!scheduledFor) continue;
    if (params.eventType === "booking_deposit_pending" && params.snapshot.paymentStatus !== "deposit_pending") continue;
    if (params.eventType !== "booking_created" && params.eventType !== "booking_rescheduled" && params.eventType !== "booking_cancelled") {
      if (!isBookingActiveForReminder(params.snapshot.status)) continue;
    }

    const resolved = resolveNotificationTemplate({
      templates,
      tenantId: params.snapshot.tenantId,
      eventType: params.eventType,
      channel,
      locale: params.locale,
    });
    const fallback = fallbackTemplate(params.eventType);
    const titleTemplate = resolved.template?.titleTemplate || fallback.title;
    const messageTemplate = resolved.template?.messageTemplate || fallback.message;
    const emailSubject = resolved.template?.emailSubject || fallback.emailSubject;
    const templateKey =
      resolved.template?.id ||
      buildTemplateKey({
        tenantId: params.snapshot.tenantId,
        eventType: params.eventType,
        channel,
        locale: params.locale,
      });
    const title = interpolateTemplate(titleTemplate, variables);
    const message = interpolateTemplate(messageTemplate, variables);
    const runtime =
      channel === "in_app"
        ? {
            provider: "in_app",
            effectiveMode: "simulated" as const,
          }
        : await resolveNotificationDeliveryRuntime({
            supabase: params.supabase,
            row: {
              tenant_id: params.snapshot.tenantId,
              branch_id: params.snapshot.branchId,
              channel,
              delivery_mode: "provider",
            },
            cache: runtimeCache,
          });
    const channelAllowed =
      !preference.hasExplicitRule ||
      (preference.enabled && Boolean(preference.channels?.[channel]));
    const skippedReason =
      channel === "line" && !params.snapshot.lineUserId
        ? "recipient_missing:line_user_id"
        : channelAllowed
          ? null
          : `preference_blocked:${preference.source || "user"}${preference.reason ? `:${preference.reason}` : ""}`;
    const deliveryMode = channel === "in_app" ? "simulated" : runtime.effectiveMode;
    const provider = runtime.provider || (channel === "in_app" ? "in_app" : null);

    rows.push({
      tenantId: params.snapshot.tenantId,
      branchId: params.snapshot.branchId,
      bookingId: params.snapshot.bookingId,
      memberId: params.snapshot.memberId,
      sourceRefType: params.eventType,
      sourceRefId: params.snapshot.bookingId,
      templateKey,
      recipientUserId: params.snapshot.memberAuthUserId,
      recipientRole: "member" as const,
      recipientName: params.snapshot.customerName,
      recipientPhone: params.snapshot.customerPhone,
      recipientEmail: params.snapshot.customerEmail,
      channel,
      status: skippedReason ? ("skipped" as const) : ("pending" as const),
      scheduledFor,
      attempts: 0,
      skippedReason,
      deliveryMode,
      provider,
      dedupeKey: dedupeKey({
        snapshot: params.snapshot,
        eventType: params.eventType,
        channel,
        scheduledFor,
      }),
      payload: {
        eventType: params.eventType,
        title,
        message,
        actionUrl: "/booking",
        emailSubject,
        locale: params.locale,
        bookingId: params.snapshot.bookingId,
        bookingStartsAt: params.snapshot.startsAt,
        bookingStatus: params.snapshot.status,
        paymentStatus: params.snapshot.paymentStatus,
        publicReference: params.snapshot.publicReference,
        serviceName: params.snapshot.serviceName,
        branchName: params.snapshot.branchName,
        therapistName: params.snapshot.therapistName,
        depositRequiredAmount: params.snapshot.depositRequiredAmount,
        depositPaidAmount: params.snapshot.depositPaidAmount,
        outstandingAmount: params.snapshot.outstandingAmount,
        lineUserId: params.snapshot.lineUserId,
        deliveryMode,
        deliveryProvider: provider,
        templateTitle: title,
        templateMessage: message,
      },
      createdBy: params.actorId,
    });
  }

  if (rows.length === 0) return { ok: true as const, inserted: 0 };
  const insert = await insertDeliveryRows({
    supabase: params.supabase,
    rows,
  });
  if (!insert.ok) {
    throw new Error(insert.error);
  }
  return { ok: true as const, inserted: insert.items.length };
}

export async function cancelBookingNotifications(params: {
  supabase?: SupabaseClient;
  tenantId: string;
  bookingId: string;
  actorId?: string | null;
  eventTypes?: BookingNotificationEventType[];
  reason: string;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  let query = supabase
    .from("notification_deliveries")
    .update({
      status: "cancelled",
      cancelled_at: nowIso(),
      skipped_reason: params.reason,
      updated_at: nowIso(),
      created_by: params.actorId ?? null,
    })
    .eq("tenant_id", params.tenantId)
    .eq("booking_id", params.bookingId)
    .in("status", ["pending", "retrying"]);

  if (params.eventTypes?.length) {
    query = query.in("source_ref_type", params.eventTypes);
  }

  const result = await query;
  if (result.error) throw new Error(result.error.message);
}

export async function scheduleBookingNotifications(input: ScheduleBookingNotificationsInput) {
  const supabase = input.supabase ?? createSupabaseAdminClient();
  const locale = input.locale || "zh-TW";
  const snapshot = await loadBookingNotificationSnapshot({
    supabase,
    tenantId: input.tenantId,
    bookingId: input.bookingId,
  });

  if (input.trigger === "created") {
    await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_created" });
    await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_reminder_day_before" });
    await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_reminder_1h" });
    if (snapshot.paymentStatus === "deposit_pending" && snapshot.depositRequiredAmount > 0) {
      await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_deposit_pending" });
    }
    return;
  }

  if (input.trigger === "rescheduled") {
    await cancelBookingNotifications({
      supabase,
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      actorId: input.actorId,
      eventTypes: ["booking_reminder_day_before", "booking_reminder_1h", "booking_deposit_pending"],
      reason: "booking_rescheduled_superseded",
    });
    await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_rescheduled" });
    await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_reminder_day_before" });
    await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_reminder_1h" });
    if (snapshot.paymentStatus === "deposit_pending" && snapshot.depositRequiredAmount > 0) {
      await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_deposit_pending" });
    }
    return;
  }

  if (input.trigger === "cancelled") {
    await cancelBookingNotifications({
      supabase,
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      actorId: input.actorId,
      eventTypes: ["booking_reminder_day_before", "booking_reminder_1h", "booking_deposit_pending"],
      reason: "booking_cancelled",
    });
    await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_cancelled" });
    return;
  }

  if (input.trigger === "status_completed" || input.trigger === "status_no_show") {
    await cancelBookingNotifications({
      supabase,
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      actorId: input.actorId,
      eventTypes: ["booking_reminder_day_before", "booking_reminder_1h", "booking_deposit_pending"],
      reason: input.trigger === "status_completed" ? "booking_completed" : "booking_no_show",
    });
    return;
  }

  if (input.trigger === "payment_deposit_paid") {
    await cancelBookingNotifications({
      supabase,
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      actorId: input.actorId,
      eventTypes: ["booking_deposit_pending"],
      reason: "deposit_paid",
    });
    return;
  }

  if (input.trigger === "payment_deposit_pending_refresh") {
    await cancelBookingNotifications({
      supabase,
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      actorId: input.actorId,
      eventTypes: ["booking_deposit_pending"],
      reason: "deposit_pending_rescheduled",
    });
    if (snapshot.paymentStatus === "deposit_pending" && snapshot.depositRequiredAmount > 0 && isBookingActiveForReminder(snapshot.status)) {
      await enqueueEvent({ supabase, snapshot, actorId: input.actorId ?? null, locale, eventType: "booking_deposit_pending" });
    }
  }
}

export async function listBookingNotificationSummary(params: {
  supabase: SupabaseClient;
  tenantId: string;
  bookingId: string;
}) {
  const result = await params.supabase
    .from("notification_deliveries")
    .select("id, source_ref_type, channel, status, template_key, delivery_mode, scheduled_for, sent_at, cancelled_at, skipped_reason, failure_reason, recipient_name, recipient_phone, recipient_email, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("booking_id", params.bookingId)
    .order("scheduled_for", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) throw new Error(result.error.message);
  return ((result.data || []) as Array<Record<string, unknown>>).map(
    (row): BookingNotificationSummaryItem => ({
      id: String(row.id),
      eventType: String(row.source_ref_type || "booking_notification"),
      channel: String(row.channel || "unknown"),
      status: String(row.status || "pending"),
      templateKey: row.template_key ? String(row.template_key) : null,
      deliveryMode: row.delivery_mode ? String(row.delivery_mode) : null,
      scheduledFor: row.scheduled_for ? String(row.scheduled_for) : null,
      sentAt: row.sent_at ? String(row.sent_at) : null,
      cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
      skippedReason: row.skipped_reason ? String(row.skipped_reason) : null,
      failureReason: row.failure_reason ? String(row.failure_reason) : null,
      recipientName: row.recipient_name ? String(row.recipient_name) : null,
      recipientPhone: row.recipient_phone ? String(row.recipient_phone) : null,
      recipientEmail: row.recipient_email ? String(row.recipient_email) : null,
      createdAt: String(row.created_at),
    }),
  );
}

export function summarizeBookingNotifications(rows: BookingNotificationSummaryItem[]) {
  return rows.reduce(
    (acc, row) => {
      if (row.status === "pending" || row.status === "retrying") acc.queued += 1;
      if (row.status === "failed" || row.status === "dead_letter") acc.failed += 1;
      if (row.eventType === "booking_deposit_pending" && (row.status === "pending" || row.status === "retrying")) {
        acc.depositPendingQueued = true;
      }
      return acc;
    },
    {
      queued: 0,
      failed: 0,
      depositPendingQueued: false,
    },
  );
}

export async function shouldSkipBookingDelivery(params: {
  supabase?: SupabaseClient;
  row: Pick<DeliveryRow, "booking_id" | "source_ref_type" | "status">;
}) {
  if (!params.row.booking_id) return null;
  if (
    params.row.source_ref_type !== "booking_reminder_day_before" &&
    params.row.source_ref_type !== "booking_reminder_1h" &&
    params.row.source_ref_type !== "booking_deposit_pending"
  ) {
    return null;
  }

  const supabase = params.supabase ?? createSupabaseAdminClient();
  const bookingResult = await supabase
    .from("bookings")
    .select("status, payment_status")
    .eq("id", params.row.booking_id)
    .maybeSingle();
  if (bookingResult.error || !bookingResult.data) {
    return {
      shouldSkip: true,
      status: "failed" as const,
      reason: bookingResult.error?.message || "booking_missing_for_notification",
    };
  }

  if (params.row.source_ref_type === "booking_deposit_pending") {
    if (bookingResult.data.status === "cancelled" || bookingResult.data.status === "completed" || bookingResult.data.status === "no_show") {
      return {
        shouldSkip: true,
        status: "cancelled" as const,
        reason: `booking_${bookingResult.data.status}`,
      };
    }
    if (bookingResult.data.payment_status !== "deposit_pending") {
      return {
        shouldSkip: true,
        status: "cancelled" as const,
        reason: `payment_${bookingResult.data.payment_status || "resolved"}`,
      };
    }
    return null;
  }

  if (!isBookingActiveForReminder(String(bookingResult.data.status || ""))) {
    return {
      shouldSkip: true,
      status: "cancelled" as const,
      reason: `booking_${bookingResult.data.status}`,
    };
  }
  return null;
}
