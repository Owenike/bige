import type { SupabaseClient } from "@supabase/supabase-js";

export type ShiftItemKind = "payment" | "refund" | "adjustment" | "note";
export type ShiftPaymentMethod = "cash" | "card" | "transfer" | "newebpay" | "manual";

type ShiftItemRow = {
  id?: string;
  kind: string | null;
  ref_id: string | null;
  amount: number | string | null;
  summary: string | null;
  event_type?: string | null;
  payment_method?: string | null;
  quantity?: number | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type ShiftEventType =
  | "payment_recorded"
  | "inventory_sale"
  | "payment_refunded"
  | "order_voided"
  | "cash_adjustment"
  | "invoice_issued"
  | "invoice_voided"
  | "invoice_allowance"
  | "checkin_allowed"
  | "checkin_denied"
  | "checkin_voided"
  | "checkin_manual_allow"
  | "session_redeemed"
  | "note"
  | "adjustment";

export type ShiftReconciliationSummary = {
  expectedCashDelta: number;
  cashAdjustmentNet: number;
  netRevenue: number;
  inflow: Record<ShiftPaymentMethod, number>;
  outflow: Record<ShiftPaymentMethod, number>;
  counts: {
    payments: number;
    refunds: number;
    voids: number;
    invoices: number;
    checkins: number;
    redemptions: number;
    inventorySales: number;
    notes: number;
    adjustments: number;
  };
};

function toNumber(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isMissingColumnError(message: string, column: string) {
  const lower = message.toLowerCase();
  return lower.includes("does not exist") && lower.includes(column.toLowerCase());
}

function parseMethodFromLegacySummary(summary: string | null): ShiftPaymentMethod | null {
  if (!summary) return null;
  const parts = summary.split(":").map((item) => item.trim()).filter(Boolean);
  const candidate = parts[parts.length - 1];
  if (candidate === "cash" || candidate === "card" || candidate === "transfer" || candidate === "newebpay" || candidate === "manual") {
    return candidate;
  }
  return null;
}

function normalizeEventType(kind: string | null, eventType: string | null, summary: string | null): ShiftEventType {
  if (eventType === "payment_recorded") return "payment_recorded";
  if (eventType === "inventory_sale") return "inventory_sale";
  if (eventType === "payment_refunded") return "payment_refunded";
  if (eventType === "order_voided") return "order_voided";
  if (eventType === "cash_adjustment") return "cash_adjustment";
  if (eventType === "invoice_issued") return "invoice_issued";
  if (eventType === "invoice_voided") return "invoice_voided";
  if (eventType === "invoice_allowance") return "invoice_allowance";
  if (eventType === "checkin_allowed") return "checkin_allowed";
  if (eventType === "checkin_denied") return "checkin_denied";
  if (eventType === "checkin_voided") return "checkin_voided";
  if (eventType === "checkin_manual_allow") return "checkin_manual_allow";
  if (eventType === "session_redeemed") return "session_redeemed";
  if (eventType === "note") return "note";
  if (eventType === "adjustment") return "adjustment";

  const lowered = (summary || "").toLowerCase();
  if (lowered.startsWith("payment:")) return "payment_recorded";
  if (lowered.startsWith("product_sale:")) return "inventory_sale";
  if (lowered.startsWith("refund:")) return "payment_refunded";
  if (lowered.startsWith("order_void:")) return "order_voided";
  if (lowered.startsWith("cash_adjustment:")) return "cash_adjustment";
  if (lowered.startsWith("invoice:issue")) return "invoice_issued";
  if (lowered.startsWith("invoice:void")) return "invoice_voided";
  if (lowered.startsWith("invoice:allowance")) return "invoice_allowance";
  if (lowered.startsWith("checkin:deny")) return "checkin_denied";
  if (lowered.startsWith("checkin:allow")) return "checkin_allowed";
  if (lowered.startsWith("checkin:void")) return "checkin_voided";
  if (lowered.startsWith("checkin:manual_allow")) return "checkin_manual_allow";
  if (lowered.startsWith("session_redemption:")) return "session_redeemed";

  if (kind === "payment") return "payment_recorded";
  if (kind === "refund") return "payment_refunded";
  if (kind === "adjustment") return "cash_adjustment";
  return "note";
}

function normalizeMethod(method: string | null, summary: string | null): ShiftPaymentMethod | null {
  if (method === "cash" || method === "card" || method === "transfer" || method === "newebpay" || method === "manual") {
    return method;
  }
  return parseMethodFromLegacySummary(summary);
}

function blankMoneyRecord() {
  return {
    cash: 0,
    card: 0,
    transfer: 0,
    newebpay: 0,
    manual: 0,
  } satisfies Record<ShiftPaymentMethod, number>;
}

export function summarizeShiftItems(rows: ShiftItemRow[]): ShiftReconciliationSummary {
  const inflow = blankMoneyRecord();
  const outflow = blankMoneyRecord();
  const counts = {
    payments: 0,
    refunds: 0,
    voids: 0,
    invoices: 0,
    checkins: 0,
    redemptions: 0,
    inventorySales: 0,
    notes: 0,
    adjustments: 0,
  };
  let cashAdjustmentNet = 0;

  for (const row of rows) {
    const eventType = normalizeEventType(row.kind, row.event_type ?? null, row.summary);
    const method = normalizeMethod(row.payment_method ?? null, row.summary);
    const amount = toNumber(row.amount);

    if (eventType === "payment_recorded" || eventType === "inventory_sale") {
      counts.payments += 1;
      if (eventType === "inventory_sale") counts.inventorySales += 1;
      if (method) inflow[method] = round2(inflow[method] + amount);
      continue;
    }

    if (eventType === "payment_refunded") {
      counts.refunds += 1;
      if (method) outflow[method] = round2(outflow[method] + Math.abs(amount));
      continue;
    }

    if (eventType === "order_voided") {
      counts.voids += 1;
      continue;
    }

    if (eventType === "cash_adjustment") {
      counts.adjustments += 1;
      cashAdjustmentNet = round2(cashAdjustmentNet + amount);
      continue;
    }

    if (eventType === "invoice_issued" || eventType === "invoice_voided" || eventType === "invoice_allowance") {
      counts.invoices += 1;
      continue;
    }

    if (
      eventType === "checkin_allowed" ||
      eventType === "checkin_denied" ||
      eventType === "checkin_voided" ||
      eventType === "checkin_manual_allow"
    ) {
      counts.checkins += 1;
      continue;
    }

    if (eventType === "session_redeemed") {
      counts.redemptions += Number.isFinite(Number(row.quantity ?? 1)) ? Math.max(1, Number(row.quantity ?? 1)) : 1;
      continue;
    }

    if (eventType === "adjustment") {
      counts.adjustments += 1;
      continue;
    }
    counts.notes += 1;
  }

  const expectedCashDelta = round2(inflow.cash - outflow.cash + cashAdjustmentNet);
  const netRevenue = round2(
    inflow.cash + inflow.card + inflow.transfer + inflow.newebpay + inflow.manual
      - outflow.cash - outflow.card - outflow.transfer - outflow.newebpay - outflow.manual,
  );

  return {
    expectedCashDelta,
    cashAdjustmentNet,
    netRevenue,
    inflow,
    outflow,
    counts,
  };
}

export async function loadShiftItems(params: {
  supabase: SupabaseClient;
  tenantId: string;
  shiftId: string;
}) {
  const primary = await params.supabase
    .from("frontdesk_shift_items")
    .select("id, kind, ref_id, amount, summary, event_type, payment_method, quantity, metadata, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("shift_id", params.shiftId)
    .order("created_at", { ascending: true });

  if (!primary.error) {
    return { ok: true as const, items: (primary.data || []) as ShiftItemRow[] };
  }

  const message = primary.error.message || "";
  const missingExtendedColumns =
    isMissingColumnError(message, "event_type") ||
    isMissingColumnError(message, "payment_method") ||
    isMissingColumnError(message, "quantity") ||
    isMissingColumnError(message, "metadata");

  if (!missingExtendedColumns) {
    return { ok: false as const, error: message };
  }

  const fallback = await params.supabase
    .from("frontdesk_shift_items")
    .select("id, kind, ref_id, amount, summary, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("shift_id", params.shiftId)
    .order("created_at", { ascending: true });
  if (fallback.error) {
    return { ok: false as const, error: fallback.error.message };
  }
  return {
    ok: true as const,
    items: ((fallback.data || []) as ShiftItemRow[]).map((item) => ({
      ...item,
      event_type: null,
      payment_method: null,
      quantity: 1,
      metadata: {},
    })),
  };
}

export async function getShiftReconciliation(params: {
  supabase: SupabaseClient;
  tenantId: string;
  shiftId: string;
  openingCash: number;
}) {
  const itemsResult = await loadShiftItems({
    supabase: params.supabase,
    tenantId: params.tenantId,
    shiftId: params.shiftId,
  });
  if (!itemsResult.ok) return itemsResult;
  const summary = summarizeShiftItems(itemsResult.items);
  return {
    ok: true as const,
    items: itemsResult.items,
    summary,
    expectedCash: round2(params.openingCash + summary.expectedCashDelta),
  };
}

export async function findOpenShiftForBranch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
}) {
  if (!params.branchId) return { ok: true as const, shiftId: null };
  const result = await params.supabase
    .from("frontdesk_shifts")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("branch_id", params.branchId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message };
  return { ok: true as const, shiftId: result.data?.id ? String(result.data.id) : null };
}

export async function insertShiftItem(params: {
  supabase: SupabaseClient;
  tenantId: string;
  shiftId: string | null;
  kind: ShiftItemKind;
  refId?: string | null;
  amount?: number | null;
  summary?: string | null;
  eventType?: ShiftEventType | null;
  paymentMethod?: ShiftPaymentMethod | null;
  quantity?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (!params.shiftId) return { ok: true as const };
  const basePayload = {
    tenant_id: params.tenantId,
    shift_id: params.shiftId,
    kind: params.kind,
    ref_id: params.refId ?? null,
    amount: typeof params.amount === "number" && Number.isFinite(params.amount) ? round2(params.amount) : null,
    summary: params.summary ?? null,
  };

  const extendedPayload = {
    ...basePayload,
    event_type: params.eventType ?? null,
    payment_method: params.paymentMethod ?? null,
    quantity: Number.isFinite(Number(params.quantity ?? 1)) ? Math.max(1, Number(params.quantity ?? 1)) : 1,
    metadata: params.metadata ?? {},
  };

  const result = await params.supabase.from("frontdesk_shift_items").insert(extendedPayload);
  if (!result.error) return { ok: true as const };

  const message = result.error.message || "";
  const missingExtendedColumns =
    isMissingColumnError(message, "event_type") ||
    isMissingColumnError(message, "payment_method") ||
    isMissingColumnError(message, "quantity") ||
    isMissingColumnError(message, "metadata");
  if (!missingExtendedColumns) {
    return { ok: false as const, error: message };
  }

  const fallback = await params.supabase.from("frontdesk_shift_items").insert(basePayload);
  if (fallback.error) return { ok: false as const, error: fallback.error.message };
  return { ok: true as const };
}

export type UnreconciledShiftEvent = {
  auditId: string;
  tenantId: string;
  branchId: string | null;
  eventType: "payment_refunded" | "order_voided" | "invoice_voided" | "invoice_allowance";
  refId: string;
  amount: number | null;
  paymentMethod: ShiftPaymentMethod | null;
  actorId: string | null;
  actorName: string | null;
  reason: string | null;
  createdAt: string;
  unreconciledReason: "SHIFT_ITEM_MISSING";
};

type AuditEventRow = {
  id: string;
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  reason: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

function mapAuditToEventType(action: string): "payment_refunded" | "order_voided" | "invoice_voided" | "invoice_allowance" | null {
  if (action === "payment_refund") return "payment_refunded";
  if (action === "order_void") return "order_voided";
  if (action === "invoice_void") return "invoice_voided";
  if (action === "invoice_allowance") return "invoice_allowance";
  return null;
}

function normalizeShiftMethod(input: string | null | undefined): ShiftPaymentMethod | null {
  if (input === "cash" || input === "card" || input === "transfer" || input === "manual" || input === "newebpay") return input;
  return null;
}

export async function listUnreconciledShiftEvents(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
}) {
  const limit = Math.min(200, Math.max(1, params.limit ?? 100));
  let auditQuery = params.supabase
    .from("audit_logs")
    .select("id, tenant_id, actor_id, action, target_id, reason, payload, created_at")
    .eq("tenant_id", params.tenantId)
    .in("action", ["payment_refund", "order_void", "invoice_void", "invoice_allowance"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (params.from) auditQuery = auditQuery.gte("created_at", params.from);
  if (params.to) auditQuery = auditQuery.lte("created_at", params.to);

  const auditResult = await auditQuery;
  if (auditResult.error) return { ok: false as const, error: auditResult.error.message };
  const audits = ((auditResult.data || []) as AuditEventRow[]).filter((row) => row.target_id && row.tenant_id);
  if (audits.length === 0) return { ok: true as const, items: [] as UnreconciledShiftEvent[] };

  const paymentIds = Array.from(
    new Set(
      audits
        .filter((row) => row.action === "payment_refund" && row.target_id)
        .map((row) => String(row.target_id)),
    ),
  );
  const orderIds = Array.from(
    new Set(
      audits
        .filter((row) => (row.action === "order_void" || row.action === "invoice_void" || row.action === "invoice_allowance") && row.target_id)
        .map((row) => String(row.target_id)),
    ),
  );

  const [paymentRowsResult, orderRowsResult, attachedRowsResult] = await Promise.all([
    paymentIds.length > 0
      ? params.supabase
          .from("payments")
          .select("id, order_id, amount, method")
          .eq("tenant_id", params.tenantId)
          .in("id", paymentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; order_id: string | null; amount: number | string | null; method: string | null }>, error: null }),
    orderIds.length > 0
      ? params.supabase
          .from("orders")
          .select("id, amount, branch_id")
          .eq("tenant_id", params.tenantId)
          .in("id", orderIds)
      : Promise.resolve({ data: [] as Array<{ id: string; amount: number | string | null; branch_id: string | null }>, error: null }),
    params.supabase
      .from("frontdesk_shift_items")
      .select("event_type, ref_id")
      .eq("tenant_id", params.tenantId)
      .in("event_type", ["payment_refunded", "order_voided", "invoice_voided", "invoice_allowance"])
      .in(
        "ref_id",
        Array.from(new Set([...paymentIds, ...orderIds])).slice(0, 4000),
      ),
  ]);

  if (paymentRowsResult.error || orderRowsResult.error || attachedRowsResult.error) {
    return {
      ok: false as const,
      error:
        paymentRowsResult.error?.message ||
        orderRowsResult.error?.message ||
        attachedRowsResult.error?.message ||
        "load_unreconciled_failed",
    };
  }

  const paymentRows = (paymentRowsResult.data || []) as Array<{ id: string; order_id: string | null; amount: number | string | null; method: string | null }>;
  const directOrders = (orderRowsResult.data || []) as Array<{ id: string; amount: number | string | null; branch_id: string | null }>;
  const paymentOrderIds = Array.from(new Set(paymentRows.map((row) => String(row.order_id || "")).filter(Boolean)));
  const paymentOrdersResult =
    paymentOrderIds.length > 0
      ? await params.supabase
          .from("orders")
          .select("id, branch_id")
          .eq("tenant_id", params.tenantId)
          .in("id", paymentOrderIds)
      : { data: [] as Array<{ id: string; branch_id: string | null }>, error: null };
  if (paymentOrdersResult.error) return { ok: false as const, error: paymentOrdersResult.error.message };

  const attachedKeys = new Set(
    ((attachedRowsResult.data || []) as Array<{ event_type: string | null; ref_id: string | null }>)
      .filter((row) => row.event_type && row.ref_id)
      .map((row) => `${row.event_type}:${row.ref_id}`),
  );

  const paymentById = new Map(paymentRows.map((row) => [String(row.id), row]));
  const orderById = new Map(directOrders.map((row) => [String(row.id), row]));
  const paymentOrderBranchById = new Map(
    ((paymentOrdersResult.data || []) as Array<{ id: string; branch_id: string | null }>).map((row) => [String(row.id), row.branch_id]),
  );

  const actorIds = Array.from(new Set(audits.map((row) => row.actor_id || "").filter(Boolean)));
  const actorNameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const actorResult = await params.supabase.from("profiles").select("id, display_name").in("id", actorIds);
    if (actorResult.error) return { ok: false as const, error: actorResult.error.message };
    for (const row of (actorResult.data || []) as Array<{ id: string; display_name: string | null }>) {
      actorNameById.set(row.id, row.display_name || row.id);
    }
  }

  const items: UnreconciledShiftEvent[] = [];
  for (const row of audits) {
    const eventType = mapAuditToEventType(row.action);
    if (!eventType || !row.target_id || !row.tenant_id) continue;
    const attachedKey = `${eventType}:${row.target_id}`;
    if (attachedKeys.has(attachedKey)) continue;

    let branchId: string | null = null;
    let amount: number | null = null;
    let paymentMethod: ShiftPaymentMethod | null = null;

    if (eventType === "payment_refunded") {
      const payment = paymentById.get(String(row.target_id));
      if (!payment) continue;
      amount = toNumber(payment.amount);
      paymentMethod = normalizeShiftMethod(payment.method);
      branchId = payment.order_id ? (paymentOrderBranchById.get(String(payment.order_id)) || null) : null;
    } else if (eventType === "order_voided") {
      const order = orderById.get(String(row.target_id));
      if (!order) continue;
      amount = toNumber(order.amount);
      branchId = order.branch_id || null;
    } else {
      const order = orderById.get(String(row.target_id));
      if (!order) continue;
      const payloadAmount = Number((row.payload as { allowanceAmount?: unknown } | null)?.allowanceAmount ?? Number.NaN);
      amount = Number.isFinite(payloadAmount) && payloadAmount > 0 ? payloadAmount : toNumber(order.amount);
      branchId = order.branch_id || null;
    }

    if (params.branchId && params.branchId !== branchId) continue;

    items.push({
      auditId: row.id,
      tenantId: row.tenant_id,
      branchId,
      eventType,
      refId: String(row.target_id),
      amount: Number.isFinite(Number(amount)) ? amount : null,
      paymentMethod,
      actorId: row.actor_id || null,
      actorName: row.actor_id ? (actorNameById.get(row.actor_id) || row.actor_id) : null,
      reason: row.reason || null,
      createdAt: row.created_at,
      unreconciledReason: "SHIFT_ITEM_MISSING",
    });
  }

  return { ok: true as const, items };
}

type AttachableAuditEventType = "payment_refunded" | "order_voided" | "invoice_voided" | "invoice_allowance";

export async function attachUnreconciledEventToShift(params: {
  supabase: SupabaseClient;
  tenantId: string;
  shiftId: string;
  auditId: string;
  actorId: string;
  expectedBranchId?: string | null;
}) {
  const auditResult = await params.supabase
    .from("audit_logs")
    .select("id, tenant_id, actor_id, action, target_id, reason, payload, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.auditId)
    .maybeSingle();
  if (auditResult.error) return { ok: false as const, error: auditResult.error.message, code: "INTERNAL_ERROR" as const };
  if (!auditResult.data?.target_id) {
    return { ok: false as const, error: "Unreconciled event not found", code: "FORBIDDEN" as const };
  }

  const eventType = mapAuditToEventType(String(auditResult.data.action || ""));
  if (!eventType) return { ok: false as const, error: "Unsupported event type", code: "FORBIDDEN" as const };
  const refId = String(auditResult.data.target_id);

  const duplicateResult = await params.supabase
    .from("frontdesk_shift_items")
    .select("id, shift_id")
    .eq("tenant_id", params.tenantId)
    .eq("event_type", eventType)
    .eq("ref_id", refId)
    .limit(1)
    .maybeSingle();
  if (duplicateResult.error) {
    return { ok: false as const, error: duplicateResult.error.message, code: "INTERNAL_ERROR" as const };
  }
  if (duplicateResult.data?.id) {
    return {
      ok: false as const,
      error: "Event already attached to a shift",
      code: "FORBIDDEN" as const,
      duplicateShiftId: duplicateResult.data.shift_id ? String(duplicateResult.data.shift_id) : null,
    };
  }

  const shiftResult = await params.supabase
    .from("frontdesk_shifts")
    .select("id, branch_id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.shiftId)
    .maybeSingle();
  if (shiftResult.error) return { ok: false as const, error: shiftResult.error.message, code: "INTERNAL_ERROR" as const };
  if (!shiftResult.data) return { ok: false as const, error: "Shift not found", code: "FORBIDDEN" as const };
  const shiftBranchId = shiftResult.data.branch_id ? String(shiftResult.data.branch_id) : null;
  if (params.expectedBranchId && shiftBranchId && params.expectedBranchId !== shiftBranchId) {
    return { ok: false as const, error: "Shift is outside branch scope", code: "BRANCH_SCOPE_DENIED" as const };
  }

  let amount = 0;
  let paymentMethod: ShiftPaymentMethod | null = null;
  let eventBranchId: string | null = null;
  const metadata: Record<string, unknown> = {
    attachedVia: "manager_reconciliation",
    auditId: params.auditId,
    originalActorId: auditResult.data.actor_id || null,
    originalReason: auditResult.data.reason || null,
    originalCreatedAt: auditResult.data.created_at || null,
  };

  if (eventType === "payment_refunded") {
    const paymentResult = await params.supabase
      .from("payments")
      .select("id, amount, method, order_id")
      .eq("tenant_id", params.tenantId)
      .eq("id", refId)
      .maybeSingle();
    if (paymentResult.error) return { ok: false as const, error: paymentResult.error.message, code: "INTERNAL_ERROR" as const };
    if (!paymentResult.data) return { ok: false as const, error: "Payment not found", code: "FORBIDDEN" as const };

    const orderId = paymentResult.data.order_id ? String(paymentResult.data.order_id) : null;
    if (orderId) {
      const orderResult = await params.supabase
        .from("orders")
        .select("id, branch_id")
        .eq("tenant_id", params.tenantId)
        .eq("id", orderId)
        .maybeSingle();
      if (orderResult.error) return { ok: false as const, error: orderResult.error.message, code: "INTERNAL_ERROR" as const };
      eventBranchId = orderResult.data?.branch_id ? String(orderResult.data.branch_id) : null;
    }
    amount = toNumber(paymentResult.data.amount);
    const method = paymentResult.data.method;
    paymentMethod =
      method === "cash" || method === "card" || method === "transfer" || method === "manual" || method === "newebpay"
        ? method
        : null;
    metadata.orderId = orderId;
    metadata.paymentId = refId;
  } else {
    const orderResult = await params.supabase
      .from("orders")
      .select("id, amount, branch_id")
      .eq("tenant_id", params.tenantId)
      .eq("id", refId)
      .maybeSingle();
    if (orderResult.error) return { ok: false as const, error: orderResult.error.message, code: "INTERNAL_ERROR" as const };
    if (!orderResult.data) return { ok: false as const, error: "Order not found", code: "FORBIDDEN" as const };
    eventBranchId = orderResult.data.branch_id ? String(orderResult.data.branch_id) : null;
    if (eventType === "invoice_allowance") {
      const payloadAmount = Number((auditResult.data.payload as { allowanceAmount?: unknown } | null)?.allowanceAmount ?? Number.NaN);
      amount = Number.isFinite(payloadAmount) && payloadAmount > 0 ? payloadAmount : Math.abs(toNumber(orderResult.data.amount));
    } else if (eventType === "invoice_voided") {
      amount = 0;
    } else {
      amount = toNumber(orderResult.data.amount);
    }
    metadata.orderId = refId;
  }

  if (shiftBranchId && eventBranchId && shiftBranchId !== eventBranchId) {
    return { ok: false as const, error: "Event branch does not match shift branch", code: "BRANCH_SCOPE_DENIED" as const };
  }

  const mappedKind: ShiftItemKind = eventType === "payment_refunded" ? "refund" : "adjustment";
  const summary =
    eventType === "payment_refunded"
      ? `refund:manual_attach:${refId}:${paymentMethod || "manual"}`
      : eventType === "order_voided"
        ? `order_void:manual_attach:${refId}`
        : eventType === "invoice_voided"
          ? `invoice:void:manual_attach:${refId}`
          : `invoice:allowance:manual_attach:${refId}`;

  const insert = await insertShiftItem({
    supabase: params.supabase,
    tenantId: params.tenantId,
    shiftId: params.shiftId,
    kind: mappedKind,
    refId,
    amount,
    summary,
    eventType: eventType as AttachableAuditEventType,
    paymentMethod,
    metadata: {
      ...metadata,
      attachedBy: params.actorId,
      attachedAt: new Date().toISOString(),
    },
  });
  if (!insert.ok) {
    return { ok: false as const, error: insert.error || "attach_failed", code: "INTERNAL_ERROR" as const };
  }

  return {
    ok: true as const,
    attached: {
      auditId: params.auditId,
      shiftId: params.shiftId,
      eventType,
      refId,
      amount,
      paymentMethod,
      eventBranchId,
    },
  };
}
