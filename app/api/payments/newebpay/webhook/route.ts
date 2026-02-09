import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { fulfillOrderEntitlements } from "../../../../../lib/order-fulfillment";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { httpLogBase, logEvent } from "../../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";

interface WebhookPayload {
  paymentId?: string;
  orderId?: string;
  status?: string;
  gatewayRef?: string;
  tenantId?: string;
}

function signPayload(rawBody: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

export async function POST(request: Request) {
  const t0 = Date.now();
  const base = httpLogBase(request);
  const ip = base.ip || "unknown";

  const rl = rateLimitFixedWindow({
    key: `webhook:newebpay:${ip}`,
    limit: 600,
    windowMs: 60 * 1000,
  });
  if (!rl.ok) {
    logEvent("warn", {
      type: "rate_limit",
      action: "newebpay_webhook",
      ...base,
      status: 429,
      durationMs: Date.now() - t0,
      retryAfterSec: rl.retryAfterSec,
    });
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": String(rl.remaining),
        },
      },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-newebpay-signature") || "";
  const secret = process.env.NEWEBPAY_WEBHOOK_SECRET || "";

  if (!secret) {
    logEvent("error", { type: "http", action: "newebpay_webhook", ...base, status: 500, durationMs: Date.now() - t0, error: "Missing NEWEBPAY_WEBHOOK_SECRET" });
    return NextResponse.json({ error: "Missing NEWEBPAY_WEBHOOK_SECRET" }, { status: 500 });
  }

  const expected = signPayload(rawBody, secret);
  if (!signature || signature !== expected) {
    logEvent("warn", { type: "http", action: "newebpay_webhook", ...base, status: 401, durationMs: Date.now() - t0, error: "Invalid signature" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody || "{}") as WebhookPayload;
  const paymentId = String(payload.paymentId || "");
  const status = payload.status === "paid" ? "paid" : payload.status === "failed" ? "failed" : "pending";
  const orderStatus = status === "paid" ? "paid" : status === "failed" ? "confirmed" : "confirmed";

  if (!paymentId) {
    logEvent("info", { type: "http", action: "newebpay_webhook", ...base, status: 400, durationMs: Date.now() - t0, error: "paymentId is required" });
    return NextResponse.json({ error: "paymentId is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const { data: payment, error: paymentFetchError } = await supabase
    .from("payments")
    .select("id, order_id, tenant_id")
    .eq("id", paymentId)
    .maybeSingle();

  if (paymentFetchError || !payment) {
    logEvent("info", { type: "http", action: "newebpay_webhook", ...base, status: 404, durationMs: Date.now() - t0, paymentId, error: "Payment not found" });
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const { error: paymentUpdateError } = await supabase
    .from("payments")
    .update({
      status,
      gateway_ref: payload.gatewayRef || null,
      paid_at: status === "paid" ? now : null,
      updated_at: now,
    })
    .eq("id", paymentId);

  if (paymentUpdateError) {
    logEvent("error", { type: "http", action: "newebpay_webhook", ...base, status: 500, durationMs: Date.now() - t0, paymentId, error: paymentUpdateError.message });
    return NextResponse.json({ error: paymentUpdateError.message }, { status: 500 });
  }

  await supabase
    .from("orders")
    .update({ status: orderStatus, updated_at: now })
    .eq("id", String(payment.order_id));

  if (status === "paid") {
    const orderResult = await supabase
      .from("orders")
      .select("id, tenant_id, member_id")
      .eq("id", String(payment.order_id))
      .maybeSingle();

    if (orderResult.data && orderResult.data.tenant_id) {
      await fulfillOrderEntitlements({
        supabase,
        tenantId: String(orderResult.data.tenant_id),
        orderId: String(orderResult.data.id),
        actorId: null,
        memberId: String(orderResult.data.member_id || ""),
      });
    }
  }

  await supabase.from("payment_webhooks").insert({
    tenant_id: payment.tenant_id,
    provider: "newebpay",
    event_type: status,
    payment_id: paymentId,
    raw_payload: payload,
    signature,
    status: "processed",
    processed_at: now,
  });

  logEvent("info", {
    type: "http",
    action: "newebpay_webhook",
    ...base,
    status: 200,
    durationMs: Date.now() - t0,
    paymentId,
    tenantId: payment.tenant_id ? String(payment.tenant_id) : null,
    eventStatus: status,
  });

  return NextResponse.json({ ok: true });
}

