import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { fulfillOrderEntitlements } from "../../../../../lib/order-fulfillment";
import type { SupabaseClient } from "@supabase/supabase-js";

async function replayOrderFulfillment(params: {
  supabase: SupabaseClient;
  tenantId: string;
  orderId: string;
  actorId: string;
}) {
  const orderResult = await params.supabase
    .from("orders")
    .select("id, member_id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.orderId)
    .maybeSingle();
  if (orderResult.error) return { ok: false as const, status: 500, message: orderResult.error.message };
  if (!orderResult.data || !orderResult.data.member_id) {
    return { ok: false as const, status: 404, message: "Order or member not found" };
  }
  const paymentResult = await params.supabase
    .from("payments")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("order_id", params.orderId)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentResult.error) return { ok: false as const, status: 500, message: paymentResult.error.message };

  const fulfillment = await fulfillOrderEntitlements({
    supabase: params.supabase as never,
    tenantId: params.tenantId,
    orderId: params.orderId,
    actorId: params.actorId,
    memberId: String(orderResult.data.member_id),
    paymentId: paymentResult.data?.id ? String(paymentResult.data.id) : null,
  });
  if (!fulfillment.ok) {
    return { ok: false as const, status: 500, message: fulfillment.reason || "fulfillment failed" };
  }
  return {
    ok: true as const,
    data: fulfillment,
  };
}

async function normalizeTenantSubscription(params: {
  supabase: SupabaseClient;
  tenantId: string;
}) {
  const nowIso = new Date().toISOString();
  const currentResult = await params.supabase
    .from("tenant_subscriptions")
    .select("id, status, ends_at, grace_ends_at")
    .eq("tenant_id", params.tenantId)
    .eq("is_current", true)
    .maybeSingle();
  if (currentResult.error) return { ok: false as const, status: 500, message: currentResult.error.message };
  if (!currentResult.data) return { ok: false as const, status: 404, message: "Current subscription not found" };

  const row = currentResult.data;
  const nowMs = Date.now();
  const endsMs = row.ends_at ? new Date(row.ends_at).getTime() : null;
  const graceMs = row.grace_ends_at ? new Date(row.grace_ends_at).getTime() : null;
  let nextStatus = row.status;
  if ((row.status === "active" || row.status === "trial") && endsMs !== null && endsMs < nowMs) {
    nextStatus = graceMs !== null && graceMs >= nowMs ? "grace" : "expired";
  } else if (row.status === "grace" && graceMs !== null && graceMs < nowMs) {
    nextStatus = "expired";
  }

  const updateResult = await params.supabase
    .from("tenant_subscriptions")
    .update({
      status: nextStatus,
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .select("id, status, ends_at, grace_ends_at")
    .maybeSingle();
  if (updateResult.error) return { ok: false as const, status: 500, message: updateResult.error.message };
  return { ok: true as const, data: updateResult.data };
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";

  if (!action) return apiError(400, "FORBIDDEN", "action is required");

  if (action === "cleanup_expired_idempotency_keys") {
    const result = await auth.supabase
      .from("operation_idempotency_keys")
      .delete()
      .not("expires_at", "is", null)
      .lt("expires_at", new Date().toISOString())
      .select("id");
    if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);
    return apiSuccess({
      action,
      removed: (result.data || []).length,
    });
  }

  if (!tenantId) return apiError(400, "FORBIDDEN", "tenantId is required");

  if (action === "replay_order_fulfillment") {
    const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
    if (!orderId) return apiError(400, "FORBIDDEN", "orderId is required");
    const replay = await replayOrderFulfillment({
      supabase: auth.supabase,
      tenantId,
      orderId,
      actorId: auth.context.userId,
    });
    if (!replay.ok) return apiError(replay.status, "INTERNAL_ERROR", replay.message);
    await auth.supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: auth.context.userId,
      action: "consistency_repair_replay_order_fulfillment",
      target_type: "order",
      target_id: orderId,
      reason: null,
      payload: replay.data,
    });
    return apiSuccess({
      action,
      tenantId,
      orderId,
      result: replay.data,
    });
  }

  if (action === "normalize_tenant_subscription") {
    const normalized = await normalizeTenantSubscription({
      supabase: auth.supabase,
      tenantId,
    });
    if (!normalized.ok) return apiError(normalized.status, "INTERNAL_ERROR", normalized.message);
    await auth.supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: auth.context.userId,
      action: "consistency_repair_normalize_tenant_subscription",
      target_type: "tenant_subscription",
      target_id: typeof normalized.data?.id === "string" ? normalized.data.id : null,
      reason: null,
      payload: normalized.data || {},
    });
    return apiSuccess({
      action,
      tenantId,
      subscription: normalized.data || null,
    });
  }

  return apiError(400, "FORBIDDEN", "Unsupported repair action");
}
