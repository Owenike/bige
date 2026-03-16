import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";
import { ingestNotificationDeliveryEvent } from "./notification-delivery-events";
import type { DeliveryStatus } from "./notification-ops";

export type ProviderReconcileStatus =
  | "queued"
  | "accepted"
  | "processing"
  | "retrying"
  | "delivered"
  | "sent"
  | "opened"
  | "clicked"
  | "failed"
  | "bounced"
  | "rejected"
  | "complained"
  | "cancelled"
  | "suppressed"
  | "skipped";

type ReconcileEventType = "delivered" | "failed" | "opened" | "clicked";

type ResolvedReconcileDelivery = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  status: DeliveryStatus;
  provider: string | null;
  provider_message_id: string | null;
};

export type ReconcileNotificationDeliveryInput = {
  supabase?: SupabaseClient;
  deliveryId?: string | null;
  providerMessageId?: string | null;
  providerEventId?: string | null;
  providerStatus: ProviderReconcileStatus;
  provider?: string | null;
  tenantId?: string | null;
  branchId?: string | null;
  eventAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  actorId?: string | null;
};

export function isNotificationDeliveryReconcilable(params: {
  currentStatus: DeliveryStatus;
  providerStatus: ProviderReconcileStatus;
}) {
  if (params.providerStatus === "opened" || params.providerStatus === "clicked") {
    return params.currentStatus === "sent";
  }

  if (params.currentStatus === "pending" || params.currentStatus === "retrying" || params.currentStatus === "failed") {
    return true;
  }

  return false;
}

type ProviderStatusMapping = {
  eventType: ReconcileEventType;
  statusAfter: DeliveryStatus | null;
  markDeadLetter: boolean;
  failureReason: string | null;
};

function normalizeStatus(input: string) {
  return input.trim().toLowerCase() as ProviderReconcileStatus;
}

function mapProviderStatus(status: ProviderReconcileStatus): ProviderStatusMapping {
  switch (status) {
    case "delivered":
    case "sent":
      return {
        eventType: "delivered",
        statusAfter: "sent",
        markDeadLetter: false,
        failureReason: null,
      };
    case "opened":
      return {
        eventType: "opened",
        statusAfter: null,
        markDeadLetter: false,
        failureReason: null,
      };
    case "clicked":
      return {
        eventType: "clicked",
        statusAfter: null,
        markDeadLetter: false,
        failureReason: null,
      };
    case "queued":
    case "accepted":
    case "processing":
    case "retrying":
      return {
        eventType: "failed",
        statusAfter: "retrying",
        markDeadLetter: false,
        failureReason: "provider_deferred",
      };
    case "cancelled":
      return {
        eventType: "failed",
        statusAfter: "cancelled",
        markDeadLetter: false,
        failureReason: "provider_cancelled",
      };
    case "suppressed":
    case "skipped":
      return {
        eventType: "failed",
        statusAfter: "skipped",
        markDeadLetter: false,
        failureReason: "provider_suppressed",
      };
    case "bounced":
    case "rejected":
    case "complained":
      return {
        eventType: "failed",
        statusAfter: "dead_letter",
        markDeadLetter: true,
        failureReason: "provider_rejected",
      };
    case "failed":
    default:
      return {
        eventType: "failed",
        statusAfter: "failed",
        markDeadLetter: false,
        failureReason: "provider_failed",
      };
  }
}

async function findDelivery(params: {
  supabase: SupabaseClient;
  deliveryId?: string | null;
  providerMessageId?: string | null;
  tenantId?: string | null;
  branchId?: string | null;
}) {
  let query = params.supabase
    .from("notification_deliveries")
    .select("id, tenant_id, branch_id, status, provider, provider_message_id")
    .limit(1);

  if (params.deliveryId) {
    query = query.eq("id", params.deliveryId);
  } else if (params.providerMessageId) {
    query = query.eq("provider_message_id", params.providerMessageId);
  } else {
    return {
      ok: false as const,
      error: "deliveryId or providerMessageId is required",
      item: null as ResolvedReconcileDelivery | null,
    };
  }

  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  if (params.branchId) query = query.eq("branch_id", params.branchId);

  const result = await query.maybeSingle();
  if (result.error) {
    return { ok: false as const, error: result.error.message, item: null as ResolvedReconcileDelivery | null };
  }
  if (!result.data) {
    return { ok: false as const, error: "Notification delivery not found", item: null as ResolvedReconcileDelivery | null };
  }
  return {
    ok: true as const,
    item: result.data as ResolvedReconcileDelivery,
  };
}

export async function reconcileNotificationDelivery(input: ReconcileNotificationDeliveryInput) {
  const supabase = input.supabase ?? createSupabaseAdminClient();
  const resolved = await findDelivery({
    supabase,
    deliveryId: input.deliveryId || null,
    providerMessageId: input.providerMessageId || null,
    tenantId: input.tenantId || null,
    branchId: input.branchId || null,
  });
  if (!resolved.ok) return resolved;

  const providerStatus = normalizeStatus(input.providerStatus);
  const mapping = mapProviderStatus(providerStatus);
  const delivery = resolved.item;
  if (!isNotificationDeliveryReconcilable({ currentStatus: delivery.status, providerStatus })) {
    return {
      ok: false as const,
      error: `Delivery status ${delivery.status} cannot be reconciled with provider status ${providerStatus}`,
      item: null as ResolvedReconcileDelivery | null,
    };
  }
  const metadata = {
    providerStatus,
    ...(input.metadata || {}),
  };

  const ingested = await ingestNotificationDeliveryEvent({
    supabase,
    deliveryId: delivery.id,
    eventType: mapping.eventType,
    eventAt: input.eventAt || null,
    provider: input.provider || delivery.provider || null,
    providerEventId: input.providerEventId || null,
    providerMessageId: input.providerMessageId || delivery.provider_message_id || null,
    statusAfter: mapping.statusAfter,
    markDeadLetter: mapping.markDeadLetter,
    errorCode: input.errorCode || null,
    errorMessage: input.errorMessage || mapping.failureReason,
    metadata,
    actorId: input.actorId || null,
  });
  if (!ingested.ok) {
    return {
      ok: false as const,
      error: ingested.error,
      item: null as ResolvedReconcileDelivery | null,
    };
  }

  return {
    ok: true as const,
    deliveryId: delivery.id,
    providerStatus,
    reconciledStatus: mapping.statusAfter || delivery.status,
    event: ingested.item,
    deduped: ingested.deduped || false,
  };
}
