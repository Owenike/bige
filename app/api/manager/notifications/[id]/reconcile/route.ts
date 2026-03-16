import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { reconcileManagerNotification } from "../../../../../../lib/manager-notifications";
import type { ProviderReconcileStatus } from "../../../../../../lib/notification-provider-reconcile";
import { requirePermission } from "../../../../../../lib/permissions";

function parseProviderStatus(input: unknown) {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  const allowed: ProviderReconcileStatus[] = [
    "queued",
    "accepted",
    "processing",
    "retrying",
    "delivered",
    "sent",
    "opened",
    "clicked",
    "failed",
    "bounced",
    "rejected",
    "complained",
    "cancelled",
    "suppressed",
    "skipped",
  ];
  return allowed.includes(value as ProviderReconcileStatus) ? (value as ProviderReconcileStatus) : null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.delivery_events.write");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const providerStatus = parseProviderStatus(body?.providerStatus);
  if (!providerStatus) {
    return apiError(400, "FORBIDDEN", "providerStatus is required");
  }

  const params = await context.params;
  const result = await reconcileManagerNotification({
    supabase: auth.supabase,
    context: auth.context,
    id: params.id,
    providerStatus,
  });
  if (!result.ok) return apiError(400, "FORBIDDEN", result.error);

  return apiSuccess({
    deliveryId: result.result.deliveryId,
    providerStatus: result.result.providerStatus,
    reconciledStatus: result.result.reconciledStatus,
    deduped: result.result.deduped,
  });
}
