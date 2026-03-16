import { NextResponse } from "next/server";
import { parseEmailProviderCallbackPayload, verifyEmailProviderWebhookSignature } from "../../../../../../lib/email-notification-provider";
import { reconcileNotificationDelivery } from "../../../../../../lib/notification-provider-reconcile";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const provider = process.env.EMAIL_NOTIFY_PROVIDER || "generic_email";
  const verification = verifyEmailProviderWebhookSignature({
    provider,
    rawBody,
    headers: request.headers,
  });
  if (!verification.ok) {
    return NextResponse.json({ error: verification.reason }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }
  const events = parseEmailProviderCallbackPayload({
    provider,
    body,
  });
  if (events.length === 0) {
    return NextResponse.json({ error: "events is required" }, { status: 400 });
  }

  const results = [];
  for (const event of events) {
    const reconciled = await reconcileNotificationDelivery({
      deliveryId: event.deliveryId || null,
      providerMessageId: event.providerMessageId || null,
      providerEventId: event.providerEventId || null,
      providerStatus: event.providerStatus,
      provider,
      tenantId: event.tenantId || null,
      branchId: event.branchId || null,
      eventAt: event.occurredAt || null,
      errorCode: event.errorCode || null,
      errorMessage: event.errorMessage || null,
      metadata: event.metadata || null,
    });

    results.push(
      reconciled.ok
        ? {
            deliveryId: reconciled.deliveryId,
            ok: true,
            deduped: reconciled.deduped,
            reconciledStatus: reconciled.reconciledStatus,
          }
        : {
            deliveryId: event.deliveryId || null,
            ok: false,
            error: reconciled.error,
          },
    );
  }

  return NextResponse.json({
    accepted: true,
    processed: results.length,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  });
}
