import { randomUUID } from "node:crypto";
import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { resendManagerNotification } from "../../../../../../lib/manager-notifications";
import { listManagerNotificationRemediationQueue, persistManagerNotificationRemediationRun } from "../../../../../../lib/notification-coverage";
import { requirePermission } from "../../../../../../lib/permissions";
import type {
  NotificationCoverageBucket,
  NotificationRemediationActionSummary,
} from "../../../../../../types/notification-coverage";

function normalizeBucket(input: string | null): NotificationCoverageBucket | null {
  return input === "recipient_missing:email" ||
    input === "recipient_missing:line_user_id" ||
    input === "channel_disabled" ||
    input === "provider_unconfigured" ||
    input === "preference_opt_out" ||
    input === "invalid_recipient" ||
    input === "template_missing" ||
    input === "other"
    ? input
    : null;
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.delivery_events.write");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const deliveryIds = Array.isArray(body?.deliveryIds)
    ? body.deliveryIds.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (deliveryIds.length === 0) {
    return apiError(400, "FORBIDDEN", "deliveryIds is required");
  }

  const queue = await listManagerNotificationRemediationQueue({
    supabase: auth.supabase,
    context: auth.context,
    branchId: typeof body?.branchId === "string" ? body.branchId : null,
    bucket: normalizeBucket(typeof body?.bucket === "string" ? body.bucket : null),
    dateFrom: typeof body?.dateFrom === "string" ? body.dateFrom : null,
    dateTo: typeof body?.dateTo === "string" ? body.dateTo : null,
    search: typeof body?.search === "string" ? body.search : null,
    limit: 2000,
  });
  if (!queue.ok) return apiError(500, "INTERNAL_ERROR", queue.error);

  const queueMap = new Map(queue.items.map((item) => [item.deliveryId, item]));
  const normalizedBucket = normalizeBucket(typeof body?.bucket === "string" ? body.bucket : null);
  const summary: NotificationRemediationActionSummary = {
    runId: randomUUID(),
    actionType: "bulk_resend",
    performedAt: new Date().toISOString(),
    performedByUserId: auth.context.userId,
    performedByName: null,
    scope: {
      branchId: typeof body?.branchId === "string" ? body.branchId : null,
      dateFrom: typeof body?.dateFrom === "string" ? body.dateFrom : null,
      dateTo: typeof body?.dateTo === "string" ? body.dateTo : null,
      bucket: normalizedBucket,
      search: typeof body?.search === "string" ? body.search : null,
    },
    requested: deliveryIds.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    blockedItems: [],
    results: [],
  };

  for (const id of deliveryIds) {
    const item = queueMap.get(id);
    if (!item) {
      summary.blocked += 1;
      summary.blockedItems.push({ id, reason: "Delivery is outside the current remediation scope or was not found." });
      summary.results.push({
        sourceDeliveryId: id,
        childDeliveryId: null,
        memberId: null,
        memberName: null,
        bookingReference: null,
        channel: "other",
        bucket: normalizedBucket || "other",
        outcome: "blocked",
        reason: "Delivery is outside the current remediation scope or was not found.",
      });
      continue;
    }

    if (!item.canResendNow) {
      summary.blocked += 1;
      summary.blockedItems.push({ id, reason: item.hintLabel });
      summary.results.push({
        sourceDeliveryId: id,
        childDeliveryId: null,
        memberId: item.memberId,
        memberName: item.memberName,
        bookingReference: item.bookingReference,
        channel: item.channel,
        bucket: item.bucket,
        outcome: "blocked",
        reason: item.hintLabel,
      });
      continue;
    }

    const resent = await resendManagerNotification({
      supabase: auth.supabase,
      context: auth.context,
      id,
    });
    if (!resent.ok) {
      summary.failed += 1;
      summary.results.push({
        sourceDeliveryId: id,
        childDeliveryId: null,
        memberId: item.memberId,
        memberName: item.memberName,
        bookingReference: item.bookingReference,
        channel: item.channel,
        bucket: item.bucket,
        outcome: "failed",
        reason: resent.error,
      });
      continue;
    }

    summary.succeeded += 1;
    summary.results.push({
      sourceDeliveryId: id,
      childDeliveryId: resent.item.id,
      memberId: item.memberId,
      memberName: item.memberName,
      bookingReference: item.bookingReference,
      channel: item.channel,
      bucket: item.bucket,
      outcome: "succeeded",
      reason: null,
    });
  }

  const persisted = await persistManagerNotificationRemediationRun({
    supabase: auth.supabase,
    context: auth.context,
    summary,
  });

  return apiSuccess({
    summary: persisted.ok ? persisted.summary : summary,
    historyPersisted: persisted.ok,
    historyError: persisted.ok ? null : persisted.error,
  });
}
