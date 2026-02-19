import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

function tableMissing(message: string, tableName: string) {
  return message.includes(`relation "${tableName}" does not exist`)
    || message.includes(`Could not find the table 'public.${tableName}' in the schema cache`);
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const requestedTenantId = params.get("tenantId");
  const hours = Math.min(168, Math.max(1, Number(params.get("hours") || 24)));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const tenantId = auth.context.role === "platform_admin" ? requestedTenantId : auth.context.tenantId;

  if (auth.context.role !== "platform_admin" && !tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const warnings: string[] = [];

  let webhooks: Array<{ id: string; status: string; provider: string; event_type: string; error_message: string | null; received_at: string }> = [];
  let notifications: Array<{ id: string; status: string; channel: string; error_message: string | null; created_at: string }> = [];
  let audits: Array<{ id: string; action: string; target_type: string; created_at: string }> = [];
  let riskRequests: Array<{ id: string; status: string }> = [];
  let shifts: Array<{ id: string; status: string }> = [];

  let webhooksQuery = auth.supabase
    .from("payment_webhooks")
    .select("id, status, provider, event_type, error_message, received_at")
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(200);
  if (tenantId) webhooksQuery = webhooksQuery.eq("tenant_id", tenantId);
  const webhooksResult = await webhooksQuery;
  if (webhooksResult.error) {
    if (tableMissing(webhooksResult.error.message, "payment_webhooks")) warnings.push("payment_webhooks table missing");
    else return NextResponse.json({ error: webhooksResult.error.message }, { status: 500 });
  } else {
    webhooks = webhooksResult.data || [];
  }

  let notificationsQuery = auth.supabase
    .from("notification_logs")
    .select("id, status, channel, error_message, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  if (tenantId) notificationsQuery = notificationsQuery.eq("tenant_id", tenantId);
  const notificationsResult = await notificationsQuery;
  if (notificationsResult.error) {
    if (tableMissing(notificationsResult.error.message, "notification_logs")) warnings.push("notification_logs table missing");
    else return NextResponse.json({ error: notificationsResult.error.message }, { status: 500 });
  } else {
    notifications = notificationsResult.data || [];
  }

  let auditQuery = auth.supabase
    .from("audit_logs")
    .select("id, action, target_type, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  if (tenantId) auditQuery = auditQuery.eq("tenant_id", tenantId);
  const auditResult = await auditQuery;
  if (auditResult.error) return NextResponse.json({ error: auditResult.error.message }, { status: 500 });
  audits = auditResult.data || [];

  let riskQuery = auth.supabase
    .from("high_risk_action_requests")
    .select("id, status")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  if (tenantId) riskQuery = riskQuery.eq("tenant_id", tenantId);
  const riskResult = await riskQuery;
  if (riskResult.error) {
    if (tableMissing(riskResult.error.message, "high_risk_action_requests")) warnings.push("high_risk_action_requests table missing");
    else return NextResponse.json({ error: riskResult.error.message }, { status: 500 });
  } else {
    riskRequests = riskResult.data || [];
  }

  let shiftQuery = auth.supabase
    .from("frontdesk_shifts")
    .select("id, status")
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(200);
  if (tenantId) shiftQuery = shiftQuery.eq("tenant_id", tenantId);
  const shiftResult = await shiftQuery;
  if (shiftResult.error) {
    if (tableMissing(shiftResult.error.message, "frontdesk_shifts")) warnings.push("frontdesk_shifts table missing");
    else return NextResponse.json({ error: shiftResult.error.message }, { status: 500 });
  } else {
    shifts = shiftResult.data || [];
  }

  const webhookSummary = {
    received: webhooks.length,
    processed: webhooks.filter((item) => item.status === "processed").length,
    failed: webhooks.filter((item) => item.status === "failed").length,
  };
  const notificationSummary = {
    total: notifications.length,
    sent: notifications.filter((item) => item.status === "sent").length,
    queued: notifications.filter((item) => item.status === "queued").length,
    failed: notifications.filter((item) => item.status === "failed").length,
  };
  const recentFailures = [
    ...webhooks
      .filter((item) => item.status === "failed")
      .map((item) => ({
        id: item.id,
        source: "payment_webhook",
        status: item.status,
        detail: `${item.provider}:${item.event_type}`,
        error: item.error_message,
        createdAt: item.received_at,
      })),
    ...notifications
      .filter((item) => item.status === "failed")
      .map((item) => ({
        id: item.id,
        source: "notification",
        status: item.status,
        detail: item.channel,
        error: item.error_message,
        createdAt: item.created_at,
      })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 60);

  return NextResponse.json({
    range: { since, until: new Date().toISOString(), hours },
    tenantId: tenantId || null,
    warnings,
    health: {
      ok: true,
      serverTime: new Date().toISOString(),
      uptimeSec: typeof process !== "undefined" && typeof process.uptime === "function" ? Math.floor(process.uptime()) : null,
    },
    summary: {
      webhook: webhookSummary,
      notification: notificationSummary,
      auditRows: audits.length,
      pendingHighRiskRequests: riskRequests.length,
      openShifts: shifts.length,
    },
    recent: {
      failures: recentFailures,
      audits: audits.slice(0, 60),
      webhooks: webhooks.slice(0, 60),
      notifications: notifications.slice(0, 60),
    },
  });
}
