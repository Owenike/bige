import { randomUUID } from "node:crypto";
import { scheduleBookingNotifications } from "./booking-notifications";
import {
  extractNewebpayWebhookPayload,
  normalizeNewebpayProviderStatus,
  resolveBookingDepositMirror,
  verifyNewebpayWebhookSignature,
  type BookingDepositPaymentStatus,
} from "./newebpay-deposit-provider";
import { fulfillOrderEntitlements } from "./order-fulfillment";
import type {
  BookingDepositLiveSmokeEvidenceInput,
  BookingDepositLiveSmokeEvidenceItem,
  BookingDepositLiveSmokeSource,
  BookingDepositLiveSmokeStepResults,
} from "../types/booking-management";

type SupabaseLike = any;

type BookingDepositOrderRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  member_id: string | null;
  booking_id?: string | null;
  amount: number | string | null;
  status: string | null;
  channel: string | null;
  note: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type BookingDepositPaymentRow = {
  id: string;
  tenant_id: string;
  order_id: string;
  amount: number | string | null;
  status: BookingDepositPaymentStatus | string | null;
  method: string | null;
  gateway_ref: string | null;
  paid_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type BookingDepositBookingRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  member_id: string | null;
  service_name: string;
  status: string;
  payment_status: string | null;
  booking_payment_mode: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  payment_updated_at: string | null;
  deposit_required_amount: number | string | null;
  deposit_paid_amount: number | string | null;
  final_amount: number | string | null;
  outstanding_amount: number | string | null;
  deposit_paid_at?: string | null;
  public_reference?: string | null;
};

type BookingDepositSummary = {
  provider: "newebpay";
  orderId: string;
  orderStatus: string;
  paymentId: string | null;
  paymentStatus: string;
  providerStatus: string;
  amount: number;
  checkoutUrl: string | null;
  paymentReference: string | null;
  providerReference: string | null;
  paymentMethod: string | null;
  paymentUpdatedAt: string | null;
  paidAt: string | null;
  lastWebhookEvent: string | null;
  lastWebhookStatus: string | null;
  lastWebhookAt: string | null;
};

type BookingDepositWebhookOutcome = {
  paymentId: string;
  orderId: string;
  tenantId: string;
  providerStatus: string;
  paymentStatus: BookingDepositPaymentStatus;
  orderStatus: string;
  bookingId: string | null;
  bookingPaymentStatus: string | null;
  bookingUpdated: boolean;
  duplicate: boolean;
  fulfilled: boolean;
  gatewayReference: string | null;
};

type BookingDepositLiveSmokeAuditRow = {
  id: string;
  actor_id: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type BookingDepositInitiateResult = {
  bookingId: string;
  paymentCreated: boolean;
  reusedPendingPayment: boolean;
  voidedStalePendingPayment: boolean;
  alreadyPaid: boolean;
  depositPayment: BookingDepositSummary;
};

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function nowIso() {
  return new Date().toISOString();
}

function isPendingPaymentStale(createdAt: string | null | undefined, staleAfterHours = 24) {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created >= staleAfterHours * 60 * 60 * 1000;
}

function isMissingColumn(message: string | undefined, column: string) {
  return Boolean(message && message.includes(column));
}

function bookingDepositOrderNote(bookingId: string) {
  return `booking_deposit:${bookingId}`;
}

function buildCheckoutUrl(params: { paymentId: string; orderId: string; amount: number }) {
  const checkoutBase = process.env.NEWEBPAY_CHECKOUT_URL || "";
  const webhookUrl = process.env.NEWEBPAY_WEBHOOK_URL || "";
  if (!checkoutBase || !webhookUrl) return null;
  return `${checkoutBase}?paymentId=${encodeURIComponent(params.paymentId)}&orderId=${encodeURIComponent(params.orderId)}&amount=${encodeURIComponent(String(params.amount))}&callback=${encodeURIComponent(webhookUrl)}`;
}

function defaultLiveSmokeStepResults(): BookingDepositLiveSmokeStepResults {
  return {
    paymentLinkObtained: false,
    callbackReceived: false,
    managerDetailVerified: false,
    bookingStateVerified: false,
    notificationsVerified: false,
    reportsVerified: false,
  };
}

function normalizeLiveSmokeStepResults(
  value: Partial<BookingDepositLiveSmokeStepResults> | null | undefined,
): BookingDepositLiveSmokeStepResults {
  const defaults = defaultLiveSmokeStepResults();
  return {
    paymentLinkObtained: Boolean(value?.paymentLinkObtained ?? defaults.paymentLinkObtained),
    callbackReceived: Boolean(value?.callbackReceived ?? defaults.callbackReceived),
    managerDetailVerified: Boolean(value?.managerDetailVerified ?? defaults.managerDetailVerified),
    bookingStateVerified: Boolean(value?.bookingStateVerified ?? defaults.bookingStateVerified),
    notificationsVerified: Boolean(value?.notificationsVerified ?? defaults.notificationsVerified),
    reportsVerified: Boolean(value?.reportsVerified ?? defaults.reportsVerified),
  };
}

function buildLiveSmokeChecklistSummary(steps: BookingDepositLiveSmokeStepResults) {
  const labels: Array<[keyof BookingDepositLiveSmokeStepResults, string]> = [
    ["paymentLinkObtained", "payment link"],
    ["callbackReceived", "callback"],
    ["managerDetailVerified", "manager detail"],
    ["bookingStateVerified", "booking mirror"],
    ["notificationsVerified", "notifications"],
    ["reportsVerified", "reports"],
  ];
  const completed = labels.filter(([key]) => steps[key]).map(([, label]) => label);
  return completed.length
    ? `${completed.length}/${labels.length} checks verified: ${completed.join(", ")}`
    : `0/${labels.length} checks verified`;
}

function parseEvidencePayloadInput(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function hasProviderConfig() {
  return Boolean(process.env.NEWEBPAY_CHECKOUT_URL && process.env.NEWEBPAY_WEBHOOK_URL);
}

async function getLatestWebhookSnapshot(params: { supabase: SupabaseLike; paymentId: string; tenantId: string }) {
  const result = await params.supabase
    .from("payment_webhooks")
    .select("event_type, status, processed_at, received_at")
    .eq("tenant_id", params.tenantId)
    .eq("payment_id", params.paymentId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) return null;
  return result.data
    ? {
        lastWebhookEvent: String(result.data.event_type || ""),
        lastWebhookStatus: String(result.data.status || ""),
        lastWebhookAt: String(result.data.processed_at || result.data.received_at || ""),
      }
    : null;
}

async function listBookingOrders(params: { supabase: SupabaseLike; tenantId: string; bookingId: string }) {
  const result = await params.supabase
    .from("orders")
    .select("id, tenant_id, branch_id, member_id, booking_id, amount, status, channel, note, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("booking_id", params.bookingId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (result.error) throw new Error(result.error.message);
  return (result.data || []) as BookingDepositOrderRow[];
}

async function listOrderPayments(params: { supabase: SupabaseLike; tenantId: string; orderId: string }) {
  const result = await params.supabase
    .from("payments")
    .select("id, tenant_id, order_id, amount, status, method, gateway_ref, paid_at, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("order_id", params.orderId)
    .order("created_at", { ascending: false });

  if (result.error) throw new Error(result.error.message);
  return (result.data || []) as BookingDepositPaymentRow[];
}

async function getScopedBooking(params: { supabase: SupabaseLike; tenantId: string; bookingId: string }) {
  const result = await params.supabase
    .from("bookings")
    .select(
      "id, tenant_id, branch_id, member_id, service_name, status, payment_status, booking_payment_mode, payment_method, payment_reference, payment_updated_at, deposit_required_amount, deposit_paid_amount, final_amount, outstanding_amount, deposit_paid_at, public_reference",
    )
    .eq("tenant_id", params.tenantId)
    .eq("id", params.bookingId)
    .maybeSingle();

  if (result.error) throw new Error(result.error.message);
  return (result.data as BookingDepositBookingRow | null) ?? null;
}

async function ensureOrderForDeposit(params: {
  supabase: SupabaseLike;
  booking: BookingDepositBookingRow;
  actorId: string | null;
  channel: "online" | "frontdesk";
}) {
  const existingOrders = await listBookingOrders({
    supabase: params.supabase,
    tenantId: params.booking.tenant_id,
    bookingId: params.booking.id,
  });

  const reusable = existingOrders.find((item) => item.status === "confirmed" || item.status === "draft");
  if (reusable) {
    const nextAmount = Number(params.booking.deposit_required_amount ?? 0);
    if (toNumber(reusable.amount) !== nextAmount) {
      const updateResult = await params.supabase
        .from("orders")
        .update({
          amount: nextAmount,
          updated_at: nowIso(),
          note: reusable.note || bookingDepositOrderNote(params.booking.id),
        })
        .eq("id", reusable.id)
        .eq("tenant_id", params.booking.tenant_id);
      if (updateResult.error) throw new Error(updateResult.error.message);
      reusable.amount = nextAmount;
      reusable.updated_at = nowIso();
    }
    return { order: reusable, created: false };
  }

  const insertResult = await params.supabase
    .from("orders")
    .insert({
      tenant_id: params.booking.tenant_id,
      branch_id: params.booking.branch_id,
      member_id: params.booking.member_id,
      booking_id: params.booking.id,
      amount: Number(params.booking.deposit_required_amount ?? 0),
      status: "confirmed",
      channel: params.channel,
      note: bookingDepositOrderNote(params.booking.id),
      created_by: params.actorId,
    })
    .select("id, tenant_id, branch_id, member_id, booking_id, amount, status, channel, note, created_at, updated_at")
    .maybeSingle();

  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message || "Unable to create booking deposit order");
  }

  return { order: insertResult.data as BookingDepositOrderRow, created: true };
}

function buildSummary(params: {
  order: BookingDepositOrderRow;
  payment: BookingDepositPaymentRow | null;
  webhookSnapshot?: { lastWebhookEvent: string; lastWebhookStatus: string; lastWebhookAt: string } | null;
}) {
  const amount = params.payment ? toNumber(params.payment.amount) : toNumber(params.order.amount);
  return {
    provider: "newebpay" as const,
    orderId: params.order.id,
    orderStatus: String(params.order.status || "confirmed"),
    paymentId: params.payment?.id || null,
    paymentStatus: String(params.payment?.status || "pending"),
    providerStatus: params.webhookSnapshot?.lastWebhookEvent || String(params.payment?.status || "pending"),
    amount,
    checkoutUrl:
      params.payment && params.payment.status === "pending"
        ? buildCheckoutUrl({
            paymentId: params.payment.id,
            orderId: params.order.id,
            amount,
          })
        : null,
    paymentReference: params.payment?.id || null,
    providerReference: params.payment?.gateway_ref || null,
    paymentMethod: params.payment?.method || "newebpay",
    paymentUpdatedAt: params.payment?.updated_at || params.order.updated_at || params.order.created_at || null,
    paidAt: params.payment?.paid_at || null,
    lastWebhookEvent: params.webhookSnapshot?.lastWebhookEvent || null,
    lastWebhookStatus: params.webhookSnapshot?.lastWebhookStatus || null,
    lastWebhookAt: params.webhookSnapshot?.lastWebhookAt || null,
  } satisfies BookingDepositSummary;
}

async function loadProfileDisplayNames(params: {
  supabase: SupabaseLike;
  tenantId: string;
  actorIds: string[];
}) {
  if (!params.actorIds.length) return new Map<string, string>();
  const result = await params.supabase
    .from("profiles")
    .select("id, display_name")
    .eq("tenant_id", params.tenantId)
    .in("id", params.actorIds);
  if (result.error) throw new Error(result.error.message);
  return new Map<string, string>(
    ((result.data || []) as Array<{ id: string; display_name: string | null }>).map((row) => [
      row.id,
      row.display_name || row.id,
    ]),
  );
}

function parsePersistedLiveSmokeEvidence(params: {
  row: BookingDepositLiveSmokeAuditRow;
  actorNameById: Map<string, string>;
}): BookingDepositLiveSmokeEvidenceItem | null {
  const payload = params.row.payload || {};
  const smokeSteps = normalizeLiveSmokeStepResults(
    typeof payload.smokeSteps === "object" && payload.smokeSteps ? (payload.smokeSteps as Partial<BookingDepositLiveSmokeStepResults>) : null,
  );
  const bookingId =
    typeof payload.bookingId === "string" && payload.bookingId
      ? payload.bookingId
      : typeof params.row.target_id === "string" && params.row.target_id
        ? params.row.target_id
        : null;
  if (!bookingId) return null;

  const sourceValue =
    typeof payload.source === "string" && ["manual", "replay", "live"].includes(payload.source)
      ? (payload.source as BookingDepositLiveSmokeSource)
      : "manual";
  const smokeResult =
    typeof payload.smokeResult === "string" && ["pass", "fail", "partial"].includes(payload.smokeResult)
      ? (payload.smokeResult as BookingDepositLiveSmokeEvidenceItem["smokeResult"])
      : "partial";
  const performedByUserId =
    typeof payload.performedByUserId === "string" && payload.performedByUserId ? payload.performedByUserId : params.row.actor_id;
  const performedByName =
    typeof payload.performedByName === "string" && payload.performedByName
      ? payload.performedByName
      : performedByUserId
        ? params.actorNameById.get(performedByUserId) || performedByUserId
        : null;

  return {
    id: typeof payload.evidenceId === "string" && payload.evidenceId ? payload.evidenceId : params.row.id,
    bookingId,
    performedAt:
      typeof payload.performedAt === "string" && payload.performedAt ? payload.performedAt : params.row.created_at,
    performedByUserId,
    performedByName,
    provider: typeof payload.provider === "string" && payload.provider ? payload.provider : "newebpay",
    source: sourceValue,
    smokeResult,
    orderId: typeof payload.orderId === "string" && payload.orderId ? payload.orderId : null,
    paymentId: typeof payload.paymentId === "string" && payload.paymentId ? payload.paymentId : null,
    paymentReference: typeof payload.paymentReference === "string" && payload.paymentReference ? payload.paymentReference : null,
    providerReference: typeof payload.providerReference === "string" && payload.providerReference ? payload.providerReference : null,
    callbackStatus: typeof payload.callbackStatus === "string" && payload.callbackStatus ? payload.callbackStatus : null,
    callbackVerificationResult:
      typeof payload.callbackVerificationResult === "string" && payload.callbackVerificationResult
        ? payload.callbackVerificationResult
        : null,
    webhookReceivedAt: typeof payload.webhookReceivedAt === "string" && payload.webhookReceivedAt ? payload.webhookReceivedAt : null,
    bookingPaymentStatusSnapshot:
      typeof payload.bookingPaymentStatusSnapshot === "string" && payload.bookingPaymentStatusSnapshot
        ? payload.bookingPaymentStatusSnapshot
        : null,
    depositRequiredAmount: toNumber(payload.depositRequiredAmount as number | string | null | undefined),
    depositPaidAmount: toNumber(payload.depositPaidAmount as number | string | null | undefined),
    checklistSummary:
      typeof payload.checklistSummary === "string" && payload.checklistSummary
        ? payload.checklistSummary
        : buildLiveSmokeChecklistSummary(smokeSteps),
    smokeSteps,
    notes: typeof payload.notes === "string" && payload.notes ? payload.notes : null,
    compareResultSummary:
      typeof payload.compareResultSummary === "string" && payload.compareResultSummary ? payload.compareResultSummary : null,
    rawEvidencePayload: payload.rawEvidencePayload ?? null,
  } satisfies BookingDepositLiveSmokeEvidenceItem;
}

export async function createOrReuseBookingDepositPayment(params: {
  supabase: SupabaseLike;
  tenantId: string;
  bookingId: string;
  actorId: string | null;
  channel: "online" | "frontdesk";
}) {
  const booking = await getScopedBooking({
    supabase: params.supabase,
    tenantId: params.tenantId,
    bookingId: params.bookingId,
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.booking_payment_mode === "package") throw new Error("Package bookings do not require deposit payments");
  if (["cancelled", "completed", "no_show"].includes(booking.status)) throw new Error("Booking is not eligible for deposit payment");
  if (toNumber(booking.deposit_required_amount) <= 0) throw new Error("Booking does not require a deposit");
  if (booking.payment_status !== "deposit_pending") {
    throw new Error(booking.payment_status === "deposit_paid" || booking.payment_status === "fully_paid" ? "Booking deposit already paid" : "Booking is not pending deposit payment");
  }

  const { order } = await ensureOrderForDeposit({
    supabase: params.supabase,
    booking,
    actorId: params.actorId,
    channel: params.channel,
  });
  const payments = await listOrderPayments({
    supabase: params.supabase,
    tenantId: params.tenantId,
    orderId: order.id,
  });

  const paidPayment = payments.find((item) => item.status === "paid");
  if (paidPayment) {
    await syncBookingDepositAfterWebhook({
      supabase: params.supabase,
      tenantId: params.tenantId,
      bookingId: booking.id,
      payment: paidPayment,
      providerStatus: "paid",
      actorId: params.actorId,
    });
    const webhookSnapshot = await getLatestWebhookSnapshot({
      supabase: params.supabase,
      tenantId: params.tenantId,
      paymentId: paidPayment.id,
    });
    return {
      bookingId: booking.id,
      paymentCreated: false,
      reusedPendingPayment: false,
      voidedStalePendingPayment: false,
      alreadyPaid: true,
      depositPayment: buildSummary({ order: { ...order, status: "paid" }, payment: paidPayment, webhookSnapshot }),
    } satisfies BookingDepositInitiateResult;
  }

  const pendingPayment = payments.find((item) => item.status === "pending" && item.method === "newebpay");
  if (pendingPayment && !isPendingPaymentStale(pendingPayment.created_at)) {
    const paymentUpdateResult = await params.supabase
      .from("bookings")
      .update({
        payment_method: "newebpay",
        payment_updated_at: nowIso(),
      })
      .eq("tenant_id", params.tenantId)
      .eq("id", booking.id);
    if (paymentUpdateResult.error) throw new Error(paymentUpdateResult.error.message);

    const webhookSnapshot = await getLatestWebhookSnapshot({
      supabase: params.supabase,
      tenantId: params.tenantId,
      paymentId: pendingPayment.id,
    });
    return {
      bookingId: booking.id,
      paymentCreated: false,
      reusedPendingPayment: true,
      voidedStalePendingPayment: false,
      alreadyPaid: false,
      depositPayment: buildSummary({ order, payment: pendingPayment, webhookSnapshot }),
    } satisfies BookingDepositInitiateResult;
  }

  if (pendingPayment && isPendingPaymentStale(pendingPayment.created_at)) {
    const voidResult = await params.supabase
      .from("payments")
      .update({
        status: "voided",
        updated_at: nowIso(),
      })
      .eq("tenant_id", params.tenantId)
      .eq("id", pendingPayment.id);
    if (voidResult.error) throw new Error(voidResult.error.message);
  }

  const createResult = await params.supabase
    .from("payments")
    .insert({
      tenant_id: params.tenantId,
      order_id: order.id,
      amount: Number(booking.deposit_required_amount ?? 0),
      status: "pending",
      method: "newebpay",
    })
    .select("id, tenant_id, order_id, amount, status, method, gateway_ref, paid_at, created_at, updated_at")
    .maybeSingle();

  if (createResult.error || !createResult.data) {
    throw new Error(createResult.error?.message || "Unable to create booking deposit payment");
  }

  const paymentUpdateResult = await params.supabase
    .from("bookings")
    .update({
      payment_method: "newebpay",
      payment_updated_at: nowIso(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("id", booking.id);
  if (paymentUpdateResult.error) throw new Error(paymentUpdateResult.error.message);

  return {
    bookingId: booking.id,
    paymentCreated: true,
    reusedPendingPayment: false,
    voidedStalePendingPayment: Boolean(pendingPayment && isPendingPaymentStale(pendingPayment.created_at)),
    alreadyPaid: false,
    depositPayment: buildSummary({
      order,
      payment: createResult.data as BookingDepositPaymentRow,
    }),
  } satisfies BookingDepositInitiateResult;
}

export async function getBookingDepositTimeline(params: {
  supabase: SupabaseLike;
  tenantId: string;
  bookingId: string;
}) {
  const orders = await listBookingOrders({
    supabase: params.supabase,
    tenantId: params.tenantId,
    bookingId: params.bookingId,
  });
  if (!orders.length) {
    return { orders: [], attempts: [], webhooks: [] };
  }

  const orderIds = orders.map((item) => item.id);
  const paymentResult = await params.supabase
    .from("payments")
    .select("id, tenant_id, order_id, amount, status, method, gateway_ref, paid_at, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .in("order_id", orderIds)
    .order("created_at", { ascending: false });
  if (paymentResult.error) throw new Error(paymentResult.error.message);
  const attempts = ((paymentResult.data || []) as BookingDepositPaymentRow[]).map((item) => ({
    id: item.id,
    orderId: item.order_id,
    amount: toNumber(item.amount),
    status: String(item.status || "pending"),
    method: item.method || null,
    providerReference: item.gateway_ref || null,
    paidAt: item.paid_at || null,
    createdAt: item.created_at || null,
    updatedAt: item.updated_at || null,
    isCurrentPending: item.status === "pending" && !isPendingPaymentStale(item.created_at),
    isStalePending: item.status === "pending" && isPendingPaymentStale(item.created_at),
    isPaid: item.status === "paid",
  }));

  const paymentIds = attempts.map((item) => item.id);
  let webhooks: Array<{
    paymentId: string | null;
    eventType: string;
    status: string;
    errorMessage: string | null;
    receivedAt: string | null;
    processedAt: string | null;
    signaturePresent: boolean;
  }> = [];

  if (paymentIds.length > 0) {
    const webhookResult = await params.supabase
      .from("payment_webhooks")
      .select("payment_id, event_type, status, error_message, received_at, processed_at, signature")
      .eq("tenant_id", params.tenantId)
      .in("payment_id", paymentIds)
      .order("received_at", { ascending: false })
      .limit(30);
    if (webhookResult.error) throw new Error(webhookResult.error.message);
    webhooks = ((webhookResult.data || []) as Array<{
      payment_id: string | null;
      event_type: string;
      status: string;
      error_message: string | null;
      received_at: string | null;
      processed_at: string | null;
      signature: string | null;
    }>).map((item) => ({
      paymentId: item.payment_id,
      eventType: item.event_type,
      status: item.status,
      errorMessage: item.error_message,
      receivedAt: item.received_at,
      processedAt: item.processed_at,
      signaturePresent: Boolean(item.signature),
    }));
  }

  return {
    orders: orders.map((item) => ({
      id: item.id,
      status: String(item.status || "confirmed"),
      channel: item.channel || null,
      amount: toNumber(item.amount),
      createdAt: item.created_at || null,
      updatedAt: item.updated_at || null,
      note: item.note || null,
      isCurrent: item.id === orders[0]?.id,
    })),
    attempts,
    webhooks,
  };
}

export async function getBookingDepositReadiness(params: {
  supabase: SupabaseLike;
  tenantId: string;
  bookingId: string;
}) {
  const booking = await getScopedBooking({
    supabase: params.supabase,
    tenantId: params.tenantId,
    bookingId: params.bookingId,
  });
  if (!booking) throw new Error("Booking not found");

  const [timeline, serviceResult, scopedSettingsResult, defaultSettingsResult] = await Promise.all([
    getBookingDepositTimeline({
      supabase: params.supabase,
      tenantId: params.tenantId,
      bookingId: params.bookingId,
    }),
    params.supabase
      .from("services")
      .select("id, name, requires_deposit, deposit_calculation_type, deposit_value")
      .eq("tenant_id", params.tenantId)
      .eq("name", booking.service_name)
      .limit(1),
    booking.branch_id
      ? params.supabase
          .from("store_booking_settings")
          .select("id, branch_id, deposits_enabled, deposit_required_mode, deposit_calculation_type, deposit_value")
          .eq("tenant_id", params.tenantId)
          .eq("branch_id", booking.branch_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    params.supabase
      .from("store_booking_settings")
      .select("id, branch_id, deposits_enabled, deposit_required_mode, deposit_calculation_type, deposit_value")
      .eq("tenant_id", params.tenantId)
      .is("branch_id", null)
      .maybeSingle(),
  ]);

  if (serviceResult.error && !isMissingColumn(serviceResult.error.message, "requires_deposit")) {
    throw new Error(serviceResult.error.message);
  }
  if (scopedSettingsResult.error && !isMissingColumn(scopedSettingsResult.error.message, "store_booking_settings")) {
    throw new Error(scopedSettingsResult.error.message);
  }
  if (defaultSettingsResult.error && !isMissingColumn(defaultSettingsResult.error.message, "store_booking_settings")) {
    throw new Error(defaultSettingsResult.error.message);
  }

  const settingsRow = scopedSettingsResult.data || defaultSettingsResult.data;
  const serviceRow = ((serviceResult.data || []) as Array<{
    id: string;
    name: string;
    requires_deposit: boolean | null;
    deposit_calculation_type: string | null;
    deposit_value: number | string | null;
  }>).find((item) => item.name === booking.service_name) || null;

  const providerConfigured = hasProviderConfig();
  const callbackVerificationEnabled = Boolean(process.env.NEWEBPAY_WEBHOOK_SECRET);
  const depositsEnabled = settingsRow ? settingsRow.deposits_enabled !== false : toNumber(booking.deposit_required_amount) > 0;
  const serviceRequiresDeposit = serviceRow ? serviceRow.requires_deposit !== false : toNumber(booking.deposit_required_amount) > 0;
  const currentPending = timeline.attempts.find((item) => item.isCurrentPending);
  const stalePending = timeline.attempts.find((item) => item.isStalePending);
  const paidAttempt = timeline.attempts.find((item) => item.isPaid);
  const lastWebhook = timeline.webhooks[0] || null;
  const bookingEligible =
    !["cancelled", "completed", "no_show"].includes(booking.status) &&
    booking.booking_payment_mode !== "package" &&
    toNumber(booking.deposit_required_amount) > 0 &&
    booking.payment_status !== "deposit_paid" &&
    booking.payment_status !== "fully_paid";

  const warnings: string[] = [];
  const blockers: string[] = [];
  if (!providerConfigured) blockers.push("provider_unconfigured");
  if (!callbackVerificationEnabled) blockers.push("webhook_secret_missing");
  if (!depositsEnabled) blockers.push("deposit_capability_disabled");
  if (!serviceRequiresDeposit) warnings.push("service_not_marked_requires_deposit");
  if (!bookingEligible) blockers.push("booking_not_eligible");
  if (stalePending) warnings.push("stale_pending_payment_will_be_regenerated");

  const mode: "reuse_pending" | "generate_new" | "blocked" = currentPending
    ? "reuse_pending"
    : bookingEligible
      ? "generate_new"
      : "blocked";

  return {
    ready: blockers.length === 0,
    mode,
    canGenerateLink: blockers.length === 0 && bookingEligible,
    blockers,
    warnings,
    config: {
      checkoutUrlConfigured: Boolean(process.env.NEWEBPAY_CHECKOUT_URL),
      webhookUrlConfigured: Boolean(process.env.NEWEBPAY_WEBHOOK_URL),
      webhookSecretConfigured: callbackVerificationEnabled,
      callbackVerificationEnabled,
      providerRoute: "/api/payments/newebpay/webhook",
      providerRouteExists: true,
    },
    booking: {
      bookingId: booking.id,
      status: booking.status,
      paymentStatus: booking.payment_status || "unpaid",
      depositRequiredAmount: toNumber(booking.deposit_required_amount),
      depositPaidAmount: toNumber(booking.deposit_paid_amount),
      outstandingAmount: toNumber(booking.outstanding_amount),
      branchId: booking.branch_id,
      memberId: booking.member_id || null,
    },
    runtime: {
      depositsEnabled,
      serviceRequiresDeposit,
      bookingEligible,
      reusablePendingPaymentId: currentPending?.id || null,
      stalePendingPaymentId: stalePending?.id || null,
      paidPaymentId: paidAttempt?.id || null,
      providerConfigured,
      lastWebhookStatus: lastWebhook?.status || null,
      lastWebhookAt: lastWebhook?.processedAt || lastWebhook?.receivedAt || null,
      managerCanAccessPaymentEntry: providerConfigured && bookingEligible,
    },
  };
}

export async function getBookingDepositPaymentSummary(params: {
  supabase: SupabaseLike;
  tenantId: string;
  bookingId: string;
}) {
  const orders = await listBookingOrders({
    supabase: params.supabase,
    tenantId: params.tenantId,
    bookingId: params.bookingId,
  });
  const order = orders[0];
  if (!order) return null;

  const payments = await listOrderPayments({
    supabase: params.supabase,
    tenantId: params.tenantId,
    orderId: order.id,
  });
  const payment = payments[0] || null;
  const webhookSnapshot = payment
    ? await getLatestWebhookSnapshot({
        supabase: params.supabase,
        tenantId: params.tenantId,
        paymentId: payment.id,
      })
    : null;

  return buildSummary({ order, payment, webhookSnapshot });
}

export async function listBookingDepositLiveSmokeEvidence(params: {
  supabase: SupabaseLike;
  tenantId: string;
  bookingId: string;
  limit?: number;
}) {
  const result = await params.supabase
    .from("audit_logs")
    .select("id, actor_id, target_id, payload, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("action", "booking_deposit_live_smoke_save")
    .eq("target_type", "booking_deposit_live_smoke")
    .eq("target_id", params.bookingId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(params.limit ?? 10, 20)));
  if (result.error) throw new Error(result.error.message);

  const rows = (result.data || []) as BookingDepositLiveSmokeAuditRow[];
  const actorNameById = await loadProfileDisplayNames({
    supabase: params.supabase,
    tenantId: params.tenantId,
    actorIds: Array.from(new Set(rows.map((row) => row.actor_id).filter((value): value is string => Boolean(value)))),
  });
  const history = rows
    .map((row) => parsePersistedLiveSmokeEvidence({ row, actorNameById }))
    .filter((item): item is BookingDepositLiveSmokeEvidenceItem => Boolean(item));

  return {
    latest: history[0] || null,
    history,
  };
}

export async function loadBookingDepositLiveSmokeEvidenceMap(params: {
  supabase: SupabaseLike;
  tenantId: string;
  bookingIds: string[];
}) {
  if (!params.bookingIds.length) return new Map<string, BookingDepositLiveSmokeEvidenceItem>();
  const result = await params.supabase
    .from("audit_logs")
    .select("id, actor_id, target_id, payload, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("action", "booking_deposit_live_smoke_save")
    .eq("target_type", "booking_deposit_live_smoke")
    .in("target_id", params.bookingIds)
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);

  const rows = (result.data || []) as BookingDepositLiveSmokeAuditRow[];
  const actorNameById = await loadProfileDisplayNames({
    supabase: params.supabase,
    tenantId: params.tenantId,
    actorIds: Array.from(new Set(rows.map((row) => row.actor_id).filter((value): value is string => Boolean(value)))),
  });

  const evidenceByBookingId = new Map<string, BookingDepositLiveSmokeEvidenceItem>();
  for (const row of rows) {
    if (!row.target_id || evidenceByBookingId.has(row.target_id)) continue;
    const parsed = parsePersistedLiveSmokeEvidence({ row, actorNameById });
    if (parsed) evidenceByBookingId.set(row.target_id, parsed);
  }
  return evidenceByBookingId;
}

export async function persistBookingDepositLiveSmokeEvidence(params: {
  supabase: SupabaseLike;
  tenantId: string;
  bookingId: string;
  actorId: string | null;
  performedByName?: string | null;
  input: BookingDepositLiveSmokeEvidenceInput;
}) {
  const booking = await getScopedBooking({
    supabase: params.supabase,
    tenantId: params.tenantId,
    bookingId: params.bookingId,
  });
  if (!booking) throw new Error("Booking not found");

  const [paymentSummary, paymentTimeline, paymentReadiness] = await Promise.all([
    getBookingDepositPaymentSummary({
      supabase: params.supabase,
      tenantId: params.tenantId,
      bookingId: params.bookingId,
    }),
    getBookingDepositTimeline({
      supabase: params.supabase,
      tenantId: params.tenantId,
      bookingId: params.bookingId,
    }),
    getBookingDepositReadiness({
      supabase: params.supabase,
      tenantId: params.tenantId,
      bookingId: params.bookingId,
    }),
  ]);

  const latestAttempt = paymentTimeline.attempts[0] || null;
  const latestWebhook = paymentTimeline.webhooks[0] || null;
  const smokeSteps = normalizeLiveSmokeStepResults(params.input.smokeSteps);
  const performedAt = nowIso();
  const payload = {
    evidenceId: randomUUID(),
    bookingId: booking.id,
    tenantId: booking.tenant_id,
    branchId: booking.branch_id,
    memberId: booking.member_id || null,
    serviceName: booking.service_name,
    publicReference: booking.public_reference || null,
    performedAt,
    performedByUserId: params.actorId ?? null,
    performedByName: params.performedByName ?? null,
    provider: paymentSummary?.provider || "newebpay",
    source: params.input.source,
    smokeResult: params.input.smokeResult,
    orderId: paymentSummary?.orderId || paymentTimeline.orders[0]?.id || null,
    paymentId: paymentSummary?.paymentId || latestAttempt?.id || null,
    paymentReference: paymentSummary?.paymentReference || booking.payment_reference || null,
    providerReference: paymentSummary?.providerReference || latestAttempt?.providerReference || null,
    callbackStatus: paymentSummary?.lastWebhookStatus || latestWebhook?.status || null,
    callbackVerificationResult: latestWebhook ? (latestWebhook.signaturePresent ? "signature_present" : "signature_missing") : null,
    webhookReceivedAt: latestWebhook?.processedAt || latestWebhook?.receivedAt || null,
    bookingPaymentStatusSnapshot: booking.payment_status || null,
    paymentStatusSnapshot: paymentSummary?.paymentStatus || latestAttempt?.status || null,
    orderStatusSnapshot: paymentSummary?.orderStatus || paymentTimeline.orders[0]?.status || null,
    depositRequiredAmount: toNumber(booking.deposit_required_amount),
    depositPaidAmount: toNumber(booking.deposit_paid_amount),
    checklistSummary: buildLiveSmokeChecklistSummary(smokeSteps),
    smokeSteps,
    notes: params.input.notes.trim() || null,
    compareResultSummary: params.input.compareResultSummary.trim() || null,
    rawEvidencePayload: parseEvidencePayloadInput(params.input.rawEvidencePayload),
    readinessSnapshot: {
      ready: paymentReadiness.ready,
      mode: paymentReadiness.mode,
      blockers: paymentReadiness.blockers,
      warnings: paymentReadiness.warnings,
      reusablePendingPaymentId: paymentReadiness.runtime.reusablePendingPaymentId,
      stalePendingPaymentId: paymentReadiness.runtime.stalePendingPaymentId,
      paidPaymentId: paymentReadiness.runtime.paidPaymentId,
      managerCanAccessPaymentEntry: paymentReadiness.runtime.managerCanAccessPaymentEntry,
      lastWebhookStatus: paymentReadiness.runtime.lastWebhookStatus,
      lastWebhookAt: paymentReadiness.runtime.lastWebhookAt,
    },
    latestWebhookSnapshot: latestWebhook,
  };

  const insert = await params.supabase.from("audit_logs").insert({
    tenant_id: params.tenantId,
    actor_id: params.actorId,
    action: "booking_deposit_live_smoke_save",
    target_type: "booking_deposit_live_smoke",
    target_id: booking.id,
    reason: "Persisted booking deposit live smoke evidence",
    payload,
  });
  if (insert.error) throw new Error(insert.error.message);

  const actorNameById = params.actorId
    ? new Map<string, string>([[params.actorId, params.performedByName || params.actorId]])
    : new Map<string, string>();
  const evidence = parsePersistedLiveSmokeEvidence({
    row: {
      id: payload.evidenceId,
      actor_id: params.actorId ?? null,
      target_id: booking.id,
      payload,
      created_at: performedAt,
    },
    actorNameById,
  });
  if (!evidence) {
    throw new Error("Persisted booking deposit live smoke evidence payload is invalid");
  }

  return evidence;
}

export async function syncBookingDepositAfterWebhook(params: {
  supabase: SupabaseLike;
  tenantId: string;
  bookingId: string;
  payment: BookingDepositPaymentRow;
  providerStatus: string;
  actorId?: string | null;
}) {
  const booking = await getScopedBooking({
    supabase: params.supabase,
    tenantId: params.tenantId,
    bookingId: params.bookingId,
  });
  if (!booking) {
    return { bookingId: params.bookingId, bookingPaymentStatus: null, bookingUpdated: false, duplicate: false };
  }

  const now = nowIso();
  const mirror = resolveBookingDepositMirror({
    currentBookingPaymentStatus: booking.payment_status,
    depositRequiredAmount: booking.deposit_required_amount,
    depositPaidAmount: booking.deposit_paid_amount,
    finalAmount: booking.final_amount,
    paymentAmount: params.payment.amount,
    paymentStatus: params.payment.status as BookingDepositPaymentStatus,
    gatewayRef: params.payment.gateway_ref,
    paymentId: params.payment.id,
  });

  if (params.payment.status === "paid") {
    const updateResult = await params.supabase
      .from("bookings")
      .update({
        payment_status: mirror.nextBookingPaymentStatus,
        payment_method: "newebpay",
        payment_reference: mirror.nextPaymentReference,
        payment_updated_at: now,
        deposit_paid_amount: mirror.nextDepositPaidAmount,
        deposit_paid_at: booking.deposit_paid_at || params.payment.paid_at || (mirror.shouldStampDepositPaidAt ? now : null),
        outstanding_amount: mirror.nextOutstandingAmount,
      })
      .eq("tenant_id", params.tenantId)
      .eq("id", params.bookingId);
    if (updateResult.error) throw new Error(updateResult.error.message);

    if (mirror.isPaidTransition) {
      await scheduleBookingNotifications({
        tenantId: params.tenantId,
        bookingId: params.bookingId,
        actorId: params.actorId ?? null,
        trigger: "payment_deposit_paid",
      });
    }

    return {
      bookingId: params.bookingId,
      bookingPaymentStatus: mirror.nextBookingPaymentStatus,
      bookingUpdated: true,
    duplicate: mirror.duplicate,
  };
  }

  const previousPaymentStatus = String(booking.payment_status || "unpaid");
  const updateResult = await params.supabase
    .from("bookings")
    .update({
      payment_method: "newebpay",
      payment_updated_at: now,
    })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.bookingId);
  if (updateResult.error) throw new Error(updateResult.error.message);

  return {
    bookingId: params.bookingId,
    bookingPaymentStatus: previousPaymentStatus,
    bookingUpdated: true,
    duplicate: false,
  };
}

export async function applyNewebpayWebhook(params: {
  supabase: SupabaseLike;
  rawBody: string;
  signature: string;
  rawPayload?: Record<string, unknown> | null;
  payload: {
    paymentId?: string;
    orderId?: string;
    status?: string;
    gatewayRef?: string | null;
    merchantTradeNo?: string | null;
    tenantId?: string;
  };
}) {
  const paymentId = String(params.payload.paymentId || "").trim();
  if (!paymentId) throw new Error("paymentId is required");

  const paymentResult = await params.supabase
    .from("payments")
    .select("id, tenant_id, order_id, amount, status, method, gateway_ref, paid_at, created_at, updated_at")
    .eq("id", paymentId)
    .maybeSingle();
  if (paymentResult.error || !paymentResult.data) throw new Error(paymentResult.error?.message || "Payment not found");
  const payment = paymentResult.data as BookingDepositPaymentRow;

  const orderResult = await params.supabase
    .from("orders")
    .select("id, tenant_id, branch_id, member_id, booking_id, amount, status, channel, note, created_at, updated_at")
    .eq("id", String(payment.order_id))
    .maybeSingle();
  if (orderResult.error || !orderResult.data) throw new Error(orderResult.error?.message || "Order not found");
  const order = orderResult.data as BookingDepositOrderRow;

  const normalized = normalizeNewebpayProviderStatus(params.payload.status, payment.status);
  const duplicatePaid = normalized.ignoredStatusRegression;
  const now = nowIso();
  const nextPaymentStatus = duplicatePaid ? "paid" : normalized.paymentStatus;
  const nextOrderStatus = duplicatePaid ? "paid" : normalized.orderStatus;

  const paymentPatch: Record<string, unknown> = {
    gateway_ref: params.payload.gatewayRef || payment.gateway_ref || null,
    updated_at: now,
  };
  if (payment.status !== "paid" || nextPaymentStatus === "paid") {
    paymentPatch.status = nextPaymentStatus;
    paymentPatch.paid_at = nextPaymentStatus === "paid" ? payment.paid_at || now : null;
  }

  const paymentUpdateResult = await params.supabase
    .from("payments")
    .update(paymentPatch)
    .eq("id", payment.id)
    .eq("tenant_id", payment.tenant_id)
    .select("id, tenant_id, order_id, amount, status, method, gateway_ref, paid_at, created_at, updated_at")
    .maybeSingle();
  if (paymentUpdateResult.error || !paymentUpdateResult.data) {
    throw new Error(paymentUpdateResult.error?.message || "Unable to update payment");
  }
  const updatedPayment = paymentUpdateResult.data as BookingDepositPaymentRow;

  let resolvedOrderStatus = nextOrderStatus;
  if (updatedPayment.status !== "paid") {
    const paidPayments = await params.supabase
      .from("payments")
      .select("id")
      .eq("tenant_id", payment.tenant_id)
      .eq("order_id", order.id)
      .eq("status", "paid");
    if (paidPayments.error) throw new Error(paidPayments.error.message);
    resolvedOrderStatus = (paidPayments.data || []).length > 0 ? "paid" : "confirmed";
  }

  const orderUpdateResult = await params.supabase
    .from("orders")
    .update({
      status: resolvedOrderStatus,
      updated_at: now,
    })
    .eq("id", order.id)
    .eq("tenant_id", payment.tenant_id);
  if (orderUpdateResult.error) throw new Error(orderUpdateResult.error.message);

  await params.supabase.from("payment_webhooks").insert({
    tenant_id: payment.tenant_id,
    provider: "newebpay",
    event_type: normalized.providerStatus,
    payment_id: payment.id,
    raw_payload: params.rawPayload ?? params.payload,
    signature: params.signature,
    status: "processed",
    processed_at: now,
  });

  let bookingPaymentStatus: string | null = null;
  let bookingUpdated = false;
  let duplicate = duplicatePaid;
  if (order.booking_id) {
    const syncResult = await syncBookingDepositAfterWebhook({
      supabase: params.supabase,
      tenantId: payment.tenant_id,
      bookingId: order.booking_id,
      payment: updatedPayment,
      providerStatus: normalized.providerStatus,
      actorId: null,
    });
    bookingPaymentStatus = syncResult.bookingPaymentStatus;
    bookingUpdated = syncResult.bookingUpdated;
    duplicate = duplicate || syncResult.duplicate;
  }

  let fulfilled = false;
  if (!order.booking_id && updatedPayment.status === "paid") {
    const fulfillmentResult = await fulfillOrderEntitlements({
      supabase: params.supabase,
      tenantId: payment.tenant_id,
      orderId: order.id,
      actorId: null,
      memberId: String(order.member_id || ""),
      paymentId: updatedPayment.id,
    });
    fulfilled = fulfillmentResult.ok && fulfillmentResult.fulfilled === true;
  }

  return {
    paymentId: updatedPayment.id,
    orderId: order.id,
    tenantId: payment.tenant_id,
    providerStatus: normalized.providerStatus,
    paymentStatus: updatedPayment.status as BookingDepositPaymentStatus,
    orderStatus: resolvedOrderStatus,
    bookingId: order.booking_id || null,
    bookingPaymentStatus,
    bookingUpdated,
    duplicate,
    fulfilled,
    gatewayReference: updatedPayment.gateway_ref || null,
  } satisfies BookingDepositWebhookOutcome;
}

export {
  extractNewebpayWebhookPayload,
  hasProviderConfig,
  isMissingColumn,
  normalizeNewebpayProviderStatus,
  resolveBookingDepositMirror,
  verifyNewebpayWebhookSignature,
};
