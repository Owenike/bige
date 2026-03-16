import { NextResponse } from "next/server";
import {
  applyNewebpayWebhook,
  extractNewebpayWebhookPayload,
  verifyNewebpayWebhookSignature,
} from "../../../../../lib/booking-deposit-payments";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { httpLogBase, logEvent } from "../../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../../lib/rate-limit";

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

  if (!verifyNewebpayWebhookSignature(rawBody, signature, secret)) {
    logEvent("warn", { type: "http", action: "newebpay_webhook", ...base, status: 401, durationMs: Date.now() - t0, error: "Invalid signature" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const rawPayload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  const payload = extractNewebpayWebhookPayload(rawPayload);
  const paymentId = String(payload.paymentId || "");

  if (!paymentId) {
    logEvent("info", { type: "http", action: "newebpay_webhook", ...base, status: 400, durationMs: Date.now() - t0, error: "paymentId is required" });
    return NextResponse.json({ error: "paymentId is required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  let outcome;
  try {
    outcome = await applyNewebpayWebhook({
      supabase,
      rawBody,
      signature,
      rawPayload,
      payload,
    });
  } catch (error) {
    logEvent("error", {
      type: "http",
      action: "newebpay_webhook",
      ...base,
      status: 500,
      durationMs: Date.now() - t0,
      paymentId,
      error: error instanceof Error ? error.message : "Webhook apply failed",
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook apply failed" }, { status: 500 });
  }

  logEvent("info", {
    type: "http",
    action: "newebpay_webhook",
    ...base,
    status: 200,
    durationMs: Date.now() - t0,
    paymentId: outcome.paymentId,
    tenantId: outcome.tenantId,
    eventStatus: outcome.providerStatus,
    bookingId: outcome.bookingId,
    duplicate: outcome.duplicate,
  });

  return NextResponse.json({ ok: true, outcome });
}
