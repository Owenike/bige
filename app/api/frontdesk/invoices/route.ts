import { NextResponse } from "next/server";
import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../../lib/auth-context";
import { checkMemberEligibility } from "../../../../lib/entitlement-eligibility";
import { findOpenShiftForBranch, insertShiftItem } from "../../../../lib/shift-reconciliation";

const INVOICE_ACTIONS = ["invoice_issue", "invoice_void", "invoice_allowance"] as const;

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

function generateInvoiceNo(orderId: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `FD${stamp}${orderId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
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
  const eligibility =
    memberId
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
  const action = body?.action === "void" ? "void" : body?.action === "allowance" ? "allowance" : "issue";
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const invoiceNoInput = typeof body?.invoiceNo === "string" ? body.invoiceNo.trim() : "";
  const carrier = typeof body?.carrier === "string" ? body.carrier.trim() : "";
  const taxId = typeof body?.taxId === "string" ? body.taxId.trim() : "";
  const buyerName = typeof body?.buyerName === "string" ? body.buyerName.trim() : "";
  const allowanceAmount = Number(body?.allowanceAmount ?? 0);

  if (!orderId) return fail(400, "FORBIDDEN", "orderId is required");

  const scoped = await loadOrderWithScope({ request, orderId });
  if (!scoped.ok) return scoped.response;

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

  if (action === "issue") {
    if (scoped.order.status !== "paid") {
      return fail(409, "FORBIDDEN", "Invoice can only be issued after payment is completed");
    }
    const invoiceNo = invoiceNoInput || generateInvoiceNo(orderId);
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
          buyerName: buyerName || null,
          issuedAt: now,
          eligibility: scoped.eligibility
            ? {
                eligible: scoped.eligibility.eligible,
                reasonCode: scoped.eligibility.reasonCode,
                selectedContractId: scoped.eligibility.candidate?.contractId ?? null,
              }
            : null,
        },
      })
      .select("id, action, target_id, reason, payload, created_at")
      .maybeSingle();

    if (error) return fail(500, "INTERNAL_ERROR", error.message);
    await insertShiftItem({
      supabase: scoped.auth.supabase,
      tenantId: scoped.auth.context.tenantId!,
      shiftId,
      kind: "note",
      refId: orderId,
      amount: Number(scoped.order.amount ?? 0),
      summary: `invoice:issue:${orderId}:${invoiceNo}`,
      eventType: "invoice_issued",
      metadata: {
        orderId,
        invoiceNo,
      },
    }).catch(() => null);
    return NextResponse.json(
      {
        ok: true,
        data: { invoiceEvent: data, eligibility: scoped.eligibility },
        invoiceEvent: data,
        eligibility: scoped.eligibility,
      },
      { status: 201 },
    );
  }

  const invoiceNo = invoiceNoInput;
  if (!invoiceNo) return fail(400, "FORBIDDEN", "invoiceNo is required");

  if (action === "void") {
    if (!reason) return fail(400, "FORBIDDEN", "reason is required");
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
          invoiceNo,
          voidedAt: now,
          eligibility: scoped.eligibility
            ? {
                eligible: scoped.eligibility.eligible,
                reasonCode: scoped.eligibility.reasonCode,
                selectedContractId: scoped.eligibility.candidate?.contractId ?? null,
              }
            : null,
        },
      })
      .select("id, action, target_id, reason, payload, created_at")
      .maybeSingle();

    if (error) return fail(500, "INTERNAL_ERROR", error.message);
    await insertShiftItem({
      supabase: scoped.auth.supabase,
      tenantId: scoped.auth.context.tenantId!,
      shiftId,
      kind: "note",
      refId: orderId,
      amount: 0,
      summary: `invoice:void:${orderId}:${invoiceNo}`,
      eventType: "invoice_voided",
      metadata: {
        orderId,
        invoiceNo,
        reason,
      },
    }).catch(() => null);
    return ok({ invoiceEvent: data, eligibility: scoped.eligibility });
  }

  if (!Number.isFinite(allowanceAmount) || allowanceAmount <= 0) {
    return fail(400, "FORBIDDEN", "allowanceAmount must be positive");
  }
  if (!reason) return fail(400, "FORBIDDEN", "reason is required");

  const { data, error } = await scoped.auth.supabase
    .from("audit_logs")
    .insert({
      tenant_id: scoped.auth.context.tenantId,
      actor_id: scoped.auth.context.userId,
      action: "invoice_allowance",
      target_type: "order",
      target_id: orderId,
      reason,
      payload: {
        invoiceNo,
        allowanceAmount,
        allowanceAt: now,
        eligibility: scoped.eligibility
          ? {
              eligible: scoped.eligibility.eligible,
              reasonCode: scoped.eligibility.reasonCode,
              selectedContractId: scoped.eligibility.candidate?.contractId ?? null,
            }
          : null,
      },
    })
    .select("id, action, target_id, reason, payload, created_at")
    .maybeSingle();

  if (error) return fail(500, "INTERNAL_ERROR", error.message);
  await insertShiftItem({
    supabase: scoped.auth.supabase,
    tenantId: scoped.auth.context.tenantId!,
    shiftId,
    kind: "note",
    refId: orderId,
    amount: allowanceAmount,
    summary: `invoice:allowance:${orderId}:${invoiceNo}`,
    eventType: "invoice_allowance",
    metadata: {
      orderId,
      invoiceNo,
      reason,
      allowanceAmount,
    },
  }).catch(() => null);
  return ok({ invoiceEvent: data, eligibility: scoped.eligibility });
}
