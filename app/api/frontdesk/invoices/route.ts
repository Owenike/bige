import { NextResponse } from "next/server";
import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../../lib/auth-context";
import { checkMemberEligibility } from "../../../../lib/entitlement-eligibility";
import {
  GivemeInvoiceError,
  issueGivemeInvoice,
  queryGivemeInvoice,
  readGivemeInvoiceConfig,
  voidGivemeInvoice,
  type GivemeProviderResponse,
} from "../../../../lib/integrations/giveme-invoice";
import { findOpenShiftForBranch, insertShiftItem } from "../../../../lib/shift-reconciliation";

const INVOICE_ACTIONS = ["invoice_issue", "invoice_void", "invoice_allowance"] as const;
type RequestedAction = "issue" | "void" | "allowance" | "query";

function ok<TData extends Record<string, unknown>>(data: TData) {
  return apiSuccess(data);
}

function fail(
  status: number,
  code: "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_ERROR" | "BRANCH_SCOPE_DENIED",
  message: string,
) {
  return apiError(status, code, message);
}

function invoiceFailure(
  status: number,
  code: "INVOICE_PROVIDER_ERROR" | "INVOICE_PROVIDER_REJECTED" | "INVOICE_ALREADY_ISSUED" | "INVOICE_ALREADY_VOIDED" | "INVOICE_ALLOWANCE_UNSUPPORTED",
  message: string,
) {
  return NextResponse.json({ ok: false, code, error: message, message }, { status });
}

function providerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Giveme invoice API request failed";
  return invoiceFailure(
    error instanceof GivemeInvoiceError && error.status === null ? 503 : 502,
    "INVOICE_PROVIDER_ERROR",
    message,
  );
}

function providerRejected(response: GivemeProviderResponse) {
  const detail = response.msg || response.code || "Giveme rejected the invoice request";
  return invoiceFailure(422, "INVOICE_PROVIDER_REJECTED", detail);
}

function providerSummary(response: GivemeProviderResponse) {
  return {
    success: response.success,
    code: response.code,
    msg: response.msg,
    totalFee: response.totalFee ?? null,
    orderCode: response.orderCode ?? null,
    phone: response.phone ?? null,
    type: response.type ?? null,
    tranno: response.tranno ?? null,
    email: response.email ?? null,
    email2: response.email2 ?? null,
    randomCode: response.randomCode ?? null,
    datetime: response.datetime ?? null,
    status: response.status ?? null,
    delRemark: response.delRemark ?? null,
    delTime: response.delTime ?? null,
    details: response.details ?? null,
  };
}

function eligibilitySummary(eligibility: Awaited<ReturnType<typeof checkMemberEligibility>> | null) {
  return eligibility
    ? {
        eligible: eligibility.eligible,
        reasonCode: eligibility.reasonCode,
        selectedContractId: eligibility.candidate?.contractId ?? null,
      }
    : null;
}

async function loadOrderWithScope(params: {
  request: Request;
  orderId: string;
}) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk"], params.request);
  if (!auth.ok) return auth;
  if (!auth.context.tenantId) return { ok: false as const, response: fail(400, "FORBIDDEN", "Invalid tenant context") };
  if (auth.context.role === "frontdesk" && !auth.context.branchId) {
    return { ok: false as const, response: fail(403, "BRANCH_SCOPE_DENIED", "Missing branch context for frontdesk") };
  }

  const orderResult = await auth.supabase
    .from("orders")
    .select("id, amount, status, branch_id, member_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", params.orderId)
    .maybeSingle();
  if (orderResult.error || !orderResult.data) {
    return { ok: false as const, response: fail(404, "FORBIDDEN", "Order not found") };
  }
  if (
    auth.context.role === "frontdesk" &&
    auth.context.branchId &&
    String(orderResult.data.branch_id || "") !== auth.context.branchId
  ) {
    return { ok: false as const, response: fail(403, "BRANCH_SCOPE_DENIED", "Forbidden order access for current branch") };
  }

  const memberId = typeof orderResult.data.member_id === "string" ? orderResult.data.member_id : null;
  const eligibility = memberId
    ? await checkMemberEligibility({
        supabase: auth.supabase,
        tenantId: auth.context.tenantId,
        memberId,
        branchId: auth.context.branchId ?? (typeof orderResult.data.branch_id === "string" ? orderResult.data.branch_id : null),
        scenario: "entry",
      })
    : null;

  return {
    ok: true as const,
    auth,
    order: orderResult.data,
    eligibility,
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const orderId = params.get("orderId") || "";
  const limit = Math.min(50, Math.max(1, Number(params.get("limit") || 20)));
  if (!orderId) return fail(400, "FORBIDDEN", "orderId is required");

  const scoped = await loadOrderWithScope({ request, orderId });
  if (!scoped.ok) return scoped.response;

  const { data, error } = await scoped.auth.supabase
    .from("audit_logs")
    .select("id, action, target_id, reason, payload, created_at, actor_id")
    .eq("tenant_id", scoped.auth.context.tenantId)
    .eq("target_type", "order")
    .eq("target_id", orderId)
    .in("action", [...INVOICE_ACTIONS])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return fail(500, "INTERNAL_ERROR", error.message);
  return ok({
    items: data ?? [],
    eligibility: scoped.eligibility,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const requestedAction = String(body?.action || "issue").trim().toLowerCase();
  if (!["issue", "void", "allowance", "query"].includes(requestedAction)) {
    return fail(400, "FORBIDDEN", "Unsupported invoice action");
  }
  const action = requestedAction as RequestedAction;
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const invoiceNoInput = typeof body?.invoiceNo === "string" ? body.invoiceNo.trim().toUpperCase() : "";
  const carrier = typeof body?.carrier === "string" ? body.carrier.trim() : "";
  const taxId = typeof body?.taxId === "string" ? body.taxId.trim() : "";
  const buyerName = typeof body?.buyerName === "string" ? body.buyerName.trim() : "";

  if (!orderId) return fail(400, "FORBIDDEN", "orderId is required");

  const scoped = await loadOrderWithScope({ request, orderId });
  if (!scoped.ok) return scoped.response;

  if (action === "query") {
    if (!invoiceNoInput) return fail(400, "FORBIDDEN", "invoiceNo is required");
    try {
      const response = await queryGivemeInvoice(invoiceNoInput);
      if (!response.success) return providerRejected(response);
      return ok({ provider: providerSummary(response), eligibility: scoped.eligibility });
    } catch (error) {
      return providerError(error);
    }
  }

  if (action === "allowance") {
    return invoiceFailure(
      501,
      "INVOICE_ALLOWANCE_UNSUPPORTED",
      "Giveme does not provide an allowance API. Create the allowance in the Giveme back office.",
    );
  }

  const shiftGuard = await requireOpenShift({
    supabase: scoped.auth.supabase,
    context: scoped.auth.context,
    enforceRoles: ["frontdesk"],
  });
  if (!shiftGuard.ok) return shiftGuard.response;

  const resolveShiftId = async () => {
    if (shiftGuard.shift?.id) return String(shiftGuard.shift.id);
    const branchId = typeof scoped.order.branch_id === "string" ? scoped.order.branch_id : null;
    const branchShift = await findOpenShiftForBranch({
      supabase: scoped.auth.supabase,
      tenantId: scoped.auth.context.tenantId!,
      branchId,
    });
    if (!branchShift.ok) return null;
    return branchShift.shiftId;
  };
  const shiftId = await resolveShiftId();
  const now = new Date().toISOString();
  const compactEligibility = eligibilitySummary(scoped.eligibility);

  if (action === "issue") {
    if (scoped.order.status !== "paid") {
      return fail(409, "FORBIDDEN", "Invoice can only be issued after payment is completed");
    }

    const existing = await scoped.auth.supabase
      .from("audit_logs")
      .select("id, payload, created_at")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .eq("action", "invoice_issue")
      .eq("target_type", "order")
      .eq("target_id", orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) return fail(500, "INTERNAL_ERROR", existing.error.message);
    if (existing.data) {
      const payload = existing.data.payload && typeof existing.data.payload === "object"
        ? existing.data.payload as Record<string, unknown>
        : {};
      const invoiceNo = String(payload.invoiceNo || "");
      return invoiceFailure(
        409,
        "INVOICE_ALREADY_ISSUED",
        invoiceNo ? `This order already has invoice ${invoiceNo}` : "This order already has an invoice",
      );
    }

    const itemResult = await scoped.auth.supabase
      .from("order_items")
      .select("title, quantity, unit_price, line_total")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .eq("order_id", orderId);
    if (itemResult.error) return fail(500, "INTERNAL_ERROR", itemResult.error.message);

    let customerName = buyerName;
    let customerEmail = "";
    const memberId = typeof scoped.order.member_id === "string" ? scoped.order.member_id : null;
    if (memberId) {
      const memberResult = await scoped.auth.supabase
        .from("members")
        .select("full_name, email")
        .eq("tenant_id", scoped.auth.context.tenantId)
        .eq("id", memberId)
        .maybeSingle();
      if (memberResult.error) return fail(500, "INTERNAL_ERROR", memberResult.error.message);
      customerName ||= String(memberResult.data?.full_name || "");
      customerEmail = String(memberResult.data?.email || "");
    }

    let providerResponse;
    try {
      providerResponse = await issueGivemeInvoice({
        orderId,
        totalFee: Number(scoped.order.amount ?? 0),
        customerName,
        carrier,
        taxId,
        email: customerEmail,
        content: "BIG E FITNESS",
        items: ((itemResult.data ?? []) as Array<{
          title?: unknown;
          quantity?: unknown;
          unit_price?: unknown;
          line_total?: unknown;
        }>).map((item) => ({
          title: String(item.title || ""),
          quantity: Number(item.quantity ?? 1),
          unitPrice: Number(item.unit_price ?? 0),
          lineTotal: Number(item.line_total ?? 0),
        })),
      });
    } catch (error) {
      return providerError(error);
    }
    if (!providerResponse.success) return providerRejected(providerResponse);

    const invoiceNo = String(providerResponse.code || "").trim().toUpperCase();
    if (!invoiceNo) {
      return invoiceFailure(502, "INVOICE_PROVIDER_ERROR", "Giveme returned success without an invoice number");
    }
    const provider = providerSummary(providerResponse);
    const config = readGivemeInvoiceConfig();
    const { data, error } = await scoped.auth.supabase
      .from("audit_logs")
      .insert({
        tenant_id: scoped.auth.context.tenantId,
        actor_id: scoped.auth.context.userId,
        action: "invoice_issue",
        target_type: "order",
        target_id: orderId,
        reason: null,
        payload: {
          invoiceNo,
          amount: Number(scoped.order.amount ?? 0),
          carrier: carrier || null,
          taxId: taxId || null,
          buyerName: customerName || null,
          issuedAt: now,
          provider: "giveme",
          providerMode: config.mode,
          invoiceKind: providerResponse.kind,
          providerMessage: providerResponse.msg || null,
          eligibility: compactEligibility,
        },
      })
      .select("id, action, target_id, reason, payload, created_at")
      .maybeSingle();

    await insertShiftItem({
      supabase: scoped.auth.supabase,
      tenantId: scoped.auth.context.tenantId!,
      shiftId,
      kind: "note",
      refId: orderId,
      amount: Number(scoped.order.amount ?? 0),
      summary: `invoice:issue:${orderId}:${invoiceNo}`,
      eventType: "invoice_issued",
      metadata: { orderId, invoiceNo, provider: "giveme" },
    }).catch(() => null);

    const warning = error ? `Invoice was issued, but the local audit log failed: ${error.message}` : null;
    return NextResponse.json(
      {
        ok: true,
        data: { invoiceEvent: data, invoiceNo, provider, warning, eligibility: scoped.eligibility },
        invoiceEvent: data,
        invoiceNo,
        provider,
        warning,
        eligibility: scoped.eligibility,
      },
      { status: 201 },
    );
  }

  if (!invoiceNoInput) return fail(400, "FORBIDDEN", "invoiceNo is required");
  if (!reason) return fail(400, "FORBIDDEN", "reason is required");

  const existingVoid = await scoped.auth.supabase
    .from("audit_logs")
    .select("id")
    .eq("tenant_id", scoped.auth.context.tenantId)
    .eq("action", "invoice_void")
    .eq("target_type", "order")
    .eq("target_id", orderId)
    .contains("payload", { invoiceNo: invoiceNoInput })
    .limit(1)
    .maybeSingle();
  if (existingVoid.error) return fail(500, "INTERNAL_ERROR", existingVoid.error.message);
  if (existingVoid.data) {
    return invoiceFailure(409, "INVOICE_ALREADY_VOIDED", `Invoice ${invoiceNoInput} has already been voided`);
  }

  let providerResponse;
  try {
    providerResponse = await voidGivemeInvoice({ code: invoiceNoInput, remark: reason });
  } catch (error) {
    return providerError(error);
  }
  if (!providerResponse.success) return providerRejected(providerResponse);

  const provider = providerSummary(providerResponse);
  const config = readGivemeInvoiceConfig();
  const { data, error } = await scoped.auth.supabase
    .from("audit_logs")
    .insert({
      tenant_id: scoped.auth.context.tenantId,
      actor_id: scoped.auth.context.userId,
      action: "invoice_void",
      target_type: "order",
      target_id: orderId,
      reason,
      payload: {
        invoiceNo: invoiceNoInput,
        voidedAt: now,
        provider: "giveme",
        providerMode: config.mode,
        providerMessage: providerResponse.msg || null,
        eligibility: compactEligibility,
      },
    })
    .select("id, action, target_id, reason, payload, created_at")
    .maybeSingle();

  await insertShiftItem({
    supabase: scoped.auth.supabase,
    tenantId: scoped.auth.context.tenantId!,
    shiftId,
    kind: "note",
    refId: orderId,
    amount: 0,
    summary: `invoice:void:${orderId}:${invoiceNoInput}`,
    eventType: "invoice_voided",
    metadata: { orderId, invoiceNo: invoiceNoInput, reason, provider: "giveme" },
  }).catch(() => null);

  const warning = error ? `Invoice was voided, but the local audit log failed: ${error.message}` : null;
  return ok({
    invoiceEvent: data,
    invoiceNo: invoiceNoInput,
    provider,
    warning,
    eligibility: scoped.eligibility,
  });
}
