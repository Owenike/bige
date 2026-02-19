import { NextResponse } from "next/server";
import { TEMP_DISABLE_ROLE_GUARD, requireProfile } from "../../../../lib/auth-context";

const INVOICE_ACTIONS = ["invoice_issue", "invoice_void", "invoice_allowance"] as const;

function generateInvoiceNo(orderId: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `FD${stamp}${orderId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Invalid tenant context" }, { status: 400 });

  const params = new URL(request.url).searchParams;
  const orderId = params.get("orderId") || "";
  const limit = Math.min(50, Math.max(1, Number(params.get("limit") || 20)));

  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });

  const orderResult = await auth.supabase
    .from("orders")
    .select("id, branch_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (orderResult.error || !orderResult.data) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!TEMP_DISABLE_ROLE_GUARD && auth.context.role === "frontdesk" && auth.context.branchId && String(orderResult.data.branch_id || "") !== auth.context.branchId) {
    return NextResponse.json({ error: "Forbidden order access for current branch" }, { status: 403 });
  }

  const { data, error } = await auth.supabase
    .from("audit_logs")
    .select("id, action, target_id, reason, payload, created_at, actor_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("target_type", "order")
    .eq("target_id", orderId)
    .in("action", [...INVOICE_ACTIONS])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Invalid tenant context" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const action = body?.action === "void" ? "void" : body?.action === "allowance" ? "allowance" : "issue";
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const invoiceNoInput = typeof body?.invoiceNo === "string" ? body.invoiceNo.trim() : "";
  const carrier = typeof body?.carrier === "string" ? body.carrier.trim() : "";
  const taxId = typeof body?.taxId === "string" ? body.taxId.trim() : "";
  const buyerName = typeof body?.buyerName === "string" ? body.buyerName.trim() : "";
  const allowanceAmount = Number(body?.allowanceAmount ?? 0);

  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });

  const orderResult = await auth.supabase
    .from("orders")
    .select("id, amount, status, branch_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (orderResult.error || !orderResult.data) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!TEMP_DISABLE_ROLE_GUARD && auth.context.role === "frontdesk" && auth.context.branchId && String(orderResult.data.branch_id || "") !== auth.context.branchId) {
    return NextResponse.json({ error: "Forbidden order access for current branch" }, { status: 403 });
  }

  const now = new Date().toISOString();

  if (action === "issue") {
    if (orderResult.data.status !== "paid") {
      return NextResponse.json({ error: "Invoice can only be issued after payment is completed" }, { status: 409 });
    }
    const invoiceNo = invoiceNoInput || generateInvoiceNo(orderId);
    const { data, error } = await auth.supabase
      .from("audit_logs")
      .insert({
        tenant_id: auth.context.tenantId,
        actor_id: auth.context.userId,
        action: "invoice_issue",
        target_type: "order",
        target_id: orderId,
        reason: null,
        payload: {
          invoiceNo,
          amount: Number(orderResult.data.amount ?? 0),
          carrier: carrier || null,
          taxId: taxId || null,
          buyerName: buyerName || null,
          issuedAt: now,
        },
      })
      .select("id, action, target_id, reason, payload, created_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ invoiceEvent: data }, { status: 201 });
  }

  const invoiceNo = invoiceNoInput;
  if (!invoiceNo) return NextResponse.json({ error: "invoiceNo is required" }, { status: 400 });

  if (action === "void") {
    if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });
    const { data, error } = await auth.supabase
      .from("audit_logs")
      .insert({
        tenant_id: auth.context.tenantId,
        actor_id: auth.context.userId,
        action: "invoice_void",
        target_type: "order",
        target_id: orderId,
        reason,
        payload: {
          invoiceNo,
          voidedAt: now,
        },
      })
      .select("id, action, target_id, reason, payload, created_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ invoiceEvent: data });
  }

  if (!Number.isFinite(allowanceAmount) || allowanceAmount <= 0) {
    return NextResponse.json({ error: "allowanceAmount must be positive" }, { status: 400 });
  }
  if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("audit_logs")
    .insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "invoice_allowance",
      target_type: "order",
      target_id: orderId,
      reason,
      payload: {
        invoiceNo,
        allowanceAmount,
        allowanceAt: now,
      },
    })
    .select("id, action, target_id, reason, payload, created_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invoiceEvent: data });
}
