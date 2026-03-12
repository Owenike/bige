const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readArg(name) {
  const args = process.argv.slice(2);
  const index = args.findIndex((item) => item === name);
  if (index < 0) return "";
  return String(args[index + 1] || "").trim();
}

function normalizeBaseUrl(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

function withBypass(url, bypassSecret) {
  const secret = String(bypassSecret || "").trim();
  if (!secret) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("x-vercel-protection-bypass", secret);
  parsed.searchParams.set("x-vercel-set-bypass-cookie", "true");
  return parsed.toString();
}

function assertOrThrow(condition, message) {
  if (!condition) throw new Error(message);
}

function pickMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    if (typeof payload.message === "string") return payload.message;
    if (payload.error && typeof payload.error.message === "string") return payload.error.message;
    if (typeof payload.errorMessage === "string") return payload.errorMessage;
  }
  return fallback;
}

async function apiRequest(params) {
  const secret = String(params.bypassSecret || "").trim();
  const url = withBypass(`${params.baseUrl}${params.path}`, secret);
  const response = await fetch(url, {
    method: params.method,
    headers: {
      "content-type": "application/json",
      ...(params.token ? { authorization: `Bearer ${params.token}` } : {}),
      ...(secret ? { "x-vercel-protection-bypass": secret } : {}),
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, text, json };
}

async function apiGetWithRetry(params) {
  const retries = Number(params.retries || 20);
  const delayMs = Number(params.delayMs || 15000);
  let last = null;
  for (let index = 0; index < retries; index += 1) {
    const result = await apiRequest({
      method: "GET",
      baseUrl: params.baseUrl,
      path: params.path,
      token: params.token,
      bypassSecret: params.bypassSecret,
    });
    last = result;
    if (result.status !== 404) return result;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return last;
}

function getItems(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;
  return [];
}

function getSnapshot(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.snapshot && typeof payload.snapshot === "object") return payload.snapshot;
  if (payload.data && payload.data.snapshot && typeof payload.data.snapshot === "object") return payload.data.snapshot;
  return null;
}

async function main() {
  const root = process.cwd();
  const envFileArg = readArg("--env-file");
  const envFile = (envFileArg || process.env.PHASE42_ENV_FILE || "").trim();
  if (envFile) loadEnvFile(path.isAbsolute(envFile) ? envFile : path.join(root, envFile));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
  }

  const baseUrl = normalizeBaseUrl(
    readArg("--base-url") ||
      process.env.PHASE42_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://bige-git-main-owens-projects-f18ecc5e.vercel.app",
  );
  const bypassSecret = String(
    readArg("--bypass-secret") ||
      process.env.PHASE42_VERCEL_BYPASS_SECRET ||
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      "",
  ).trim();

  assertOrThrow(baseUrl.startsWith("http://") || baseUrl.startsWith("https://"), `Invalid base URL: ${baseUrl}`);
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((name) => !(process.env[name] || "").trim());
  assertOrThrow(missing.length === 0, `Missing env: ${missing.join(", ")}`);

  const e2eKey = `phase42_alert_workflow_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const adminEmail = `phase42-alert-admin-${Date.now()}@example.test`;
  const managerEmail = `phase42-alert-manager-${Date.now()}@example.test`;
  const password = `Phase42!${crypto.randomBytes(6).toString("hex")}`;
  const now = new Date();
  const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const state = {
    tenantHigh: null,
    tenantLow: null,
    adminUserId: null,
    managerUserId: null,
    alertResolvedId: null,
    alertDismissedId: null,
  };
  const cleanup = {
    tenantHighDeleted: false,
    tenantLowDeleted: false,
    adminProfileDeleted: false,
    managerProfileDeleted: false,
    adminUserDeleted: false,
    managerUserDeleted: false,
    remainingDeliveries: 0,
    remainingEvents: 0,
    remainingAlerts: 0,
    remainingAudit: 0,
  };
  let fatalError = null;
  let outcome = null;

  try {
    const tenantInsert = await admin
      .from("tenants")
      .insert([
        { name: `E2E Alert High ${e2eKey}`, status: "active" },
        { name: `E2E Alert Low ${e2eKey}`, status: "active" },
      ])
      .select("id");
    assertOrThrow(!tenantInsert.error, `tenant insert failed: ${tenantInsert.error?.message || "unknown"}`);
    assertOrThrow((tenantInsert.data || []).length === 2, "expected two tenants");
    state.tenantHigh = tenantInsert.data[0].id;
    state.tenantLow = tenantInsert.data[1].id;

    const adminCreate = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: "phase42_alert_workflow_admin" },
    });
    assertOrThrow(!adminCreate.error && adminCreate.data?.user?.id, `admin user create failed: ${adminCreate.error?.message || "unknown"}`);
    state.adminUserId = adminCreate.data.user.id;

    const managerCreate = await admin.auth.admin.createUser({
      email: managerEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: "phase42_alert_workflow_manager" },
    });
    assertOrThrow(!managerCreate.error && managerCreate.data?.user?.id, `manager user create failed: ${managerCreate.error?.message || "unknown"}`);
    state.managerUserId = managerCreate.data.user.id;

    const profileUpsert = await admin.from("profiles").upsert(
      [
        {
          id: state.adminUserId,
          role: "platform_admin",
          tenant_id: null,
          branch_id: null,
          is_active: true,
          display_name: `Phase42 Alert Admin ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
        {
          id: state.managerUserId,
          role: "manager",
          tenant_id: state.tenantHigh,
          branch_id: null,
          is_active: true,
          display_name: `Phase42 Alert Manager ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: "id" },
    );
    assertOrThrow(!profileUpsert.error, `profile upsert failed: ${profileUpsert.error?.message || "unknown"}`);

    const adminSignIn = await anon.auth.signInWithPassword({ email: adminEmail, password });
    assertOrThrow(!adminSignIn.error, `admin sign-in failed: ${adminSignIn.error?.message || "unknown"}`);
    const adminToken = adminSignIn.data?.session?.access_token || "";
    assertOrThrow(adminToken.length > 20, "missing admin token");

    const managerSignIn = await anon.auth.signInWithPassword({ email: managerEmail, password });
    assertOrThrow(!managerSignIn.error, `manager sign-in failed: ${managerSignIn.error?.message || "unknown"}`);
    const managerToken = managerSignIn.data?.session?.access_token || "";
    assertOrThrow(managerToken.length > 20, "missing manager token");

    const recentTimestamp = now.toISOString();
    const deliveryInsert = await admin.from("notification_deliveries").insert([
      {
        tenant_id: state.tenantHigh,
        channel: "sms",
        status: "dead_letter",
        attempts: 3,
        retry_count: 2,
        created_at: recentTimestamp,
        dead_letter_at: recentTimestamp,
        failed_at: recentTimestamp,
        error_code: "PROVIDER_TIMEOUT",
        error_message: "provider timeout while sending sms",
        last_error: "provider timeout while sending sms",
        dedupe_key: `${e2eKey}:high:dl:1`,
        source_ref_type: "phase42_alert_workflow",
        source_ref_id: "high-dl-1",
        payload: { e2eKey },
        created_by: state.adminUserId,
      },
      {
        tenant_id: state.tenantHigh,
        channel: "email",
        status: "failed",
        attempts: 2,
        retry_count: 1,
        created_at: recentTimestamp,
        failed_at: recentTimestamp,
        error_code: "CHANNEL_NOT_CONFIGURED",
        error_message: "channel not configured",
        last_error: "channel not configured",
        dedupe_key: `${e2eKey}:high:fail:1`,
        source_ref_type: "phase42_alert_workflow",
        source_ref_id: "high-fail-1",
        payload: { e2eKey },
        created_by: state.adminUserId,
      },
      {
        tenant_id: state.tenantLow,
        channel: "line",
        status: "retrying",
        attempts: 1,
        retry_count: 0,
        next_retry_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        created_at: recentTimestamp,
        error_code: "TEMP_NETWORK",
        error_message: "temporary network issue",
        last_error: "temporary network issue",
        dedupe_key: `${e2eKey}:low:retry:1`,
        source_ref_type: "phase42_alert_workflow",
        source_ref_id: "low-retry-1",
        payload: { e2eKey },
        created_by: state.adminUserId,
      },
      {
        tenant_id: state.tenantHigh,
        channel: "email",
        status: "sent",
        attempts: 1,
        retry_count: 0,
        created_at: recentTimestamp,
        sent_at: recentTimestamp,
        delivered_at: recentTimestamp,
        dedupe_key: `${e2eKey}:high:sent:1`,
        source_ref_type: "phase42_alert_workflow",
        source_ref_id: "high-sent-1",
        payload: { e2eKey },
        created_by: state.adminUserId,
      },
    ]);
    assertOrThrow(!deliveryInsert.error, `delivery seed failed: ${deliveryInsert.error?.message || "unknown"}`);

    const anomalies = await apiGetWithRetry({
      baseUrl,
      path: `/api/platform/notifications/anomalies?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=4000&topTenantLimit=10`,
      token: adminToken,
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(anomalies.status === 200, `anomalies expected 200, got ${anomalies.status}: ${pickMessage(anomalies.json, anomalies.text)}`);
    const anomalySnapshot = getSnapshot(anomalies.json);
    assertOrThrow(anomalySnapshot && Array.isArray(anomalySnapshot.tenantPriorities), "tenant priorities missing");
    const highPriority = anomalySnapshot.tenantPriorities.find((item) => item.tenantId === state.tenantHigh) || anomalySnapshot.tenantPriorities[0];
    assertOrThrow(highPriority, "missing high priority tenant");

    const upsertHigh = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: adminToken,
      bypassSecret,
      body: {
        action: "upsert_from_anomaly",
        tenantId: state.tenantHigh,
        anomalyKey: `TENANT_PRIORITY:${state.tenantHigh}`,
        anomalyType: "tenant_priority",
        priority: highPriority.priority || "P1",
        severity: highPriority.severity || "high",
        summary: highPriority.summary || "high tenant anomaly",
        sourceData: { e2eKey, score: highPriority.score || 0 },
      },
    });
    assertOrThrow(upsertHigh.status === 200, `upsert high expected 200, got ${upsertHigh.status}`);
    state.alertResolvedId = upsertHigh.json?.item?.id || upsertHigh.json?.data?.item?.id || null;
    assertOrThrow(Boolean(state.alertResolvedId), "missing resolved alert id");

    const upsertLow = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: adminToken,
      bypassSecret,
      body: {
        action: "upsert_from_anomaly",
        tenantId: state.tenantLow,
        anomalyKey: `TENANT_PRIORITY:${state.tenantLow}`,
        anomalyType: "tenant_priority",
        priority: "P3",
        severity: "medium",
        summary: "low tenant anomaly",
        sourceData: { e2eKey, score: 9 },
      },
    });
    assertOrThrow(upsertLow.status === 200, `upsert low expected 200, got ${upsertLow.status}`);
    state.alertDismissedId = upsertLow.json?.item?.id || upsertLow.json?.data?.item?.id || null;
    assertOrThrow(Boolean(state.alertDismissedId), "missing dismissed alert id");

    const openList = await apiRequest({
      method: "GET",
      baseUrl,
      path: "/api/platform/notifications/alerts?statuses=open",
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(openList.status === 200, `open list expected 200, got ${openList.status}`);
    const openItems = getItems(openList.json);
    assertOrThrow(openItems.length >= 2, `open list expected >=2, got ${openItems.length}`);

    const acknowledge = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: adminToken,
      bypassSecret,
      body: {
        action: "update_alert",
        id: state.alertResolvedId,
        status: "acknowledged",
        note: "ack by e2e",
      },
    });
    assertOrThrow(acknowledge.status === 200, `acknowledged expected 200, got ${acknowledge.status}`);

    const resolve = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: adminToken,
      bypassSecret,
      body: {
        action: "update_alert",
        id: state.alertResolvedId,
        status: "resolved",
        resolutionNote: "resolved by e2e",
      },
    });
    assertOrThrow(resolve.status === 200, `resolved expected 200, got ${resolve.status}`);

    const dismiss = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: adminToken,
      bypassSecret,
      body: {
        action: "update_alert",
        id: state.alertDismissedId,
        status: "dismissed",
        note: "dismiss by e2e",
      },
    });
    assertOrThrow(dismiss.status === 200, `dismissed expected 200, got ${dismiss.status}`);

    const resolvedList = await apiRequest({
      method: "GET",
      baseUrl,
      path: `/api/platform/notifications/alerts?statuses=resolved&tenantId=${state.tenantHigh}`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(resolvedList.status === 200, `resolved list expected 200, got ${resolvedList.status}`);
    const resolvedItems = getItems(resolvedList.json);
    assertOrThrow(resolvedItems.some((item) => item.id === state.alertResolvedId), "resolved alert not found");

    const dismissedList = await apiRequest({
      method: "GET",
      baseUrl,
      path: `/api/platform/notifications/alerts?statuses=dismissed&tenantId=${state.tenantLow}`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(dismissedList.status === 200, `dismissed list expected 200, got ${dismissedList.status}`);
    const dismissedItems = getItems(dismissedList.json);
    assertOrThrow(dismissedItems.some((item) => item.id === state.alertDismissedId), "dismissed alert not found");

    const unauthorized = await apiRequest({
      method: "GET",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: "",
      bypassSecret,
    });
    assertOrThrow(unauthorized.status === 401, `alerts unauthorized expected 401, got ${unauthorized.status}`);

    const managerDenied = await apiRequest({
      method: "GET",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: managerToken,
      bypassSecret,
    });
    assertOrThrow(managerDenied.status === 403, `alerts manager denied expected 403, got ${managerDenied.status}`);

    const alertPage = await apiGetWithRetry({
      baseUrl,
      path: "/platform-admin/notifications-alerts",
      token: "",
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(alertPage.status === 200, `alerts page expected 200, got ${alertPage.status}`);
    assertOrThrow(alertPage.text.includes("Notification Alert Triage"), "alerts page keyword missing");

    const auditQuery = await admin
      .from("audit_logs")
      .select("action, payload")
      .in("tenant_id", [state.tenantHigh, state.tenantLow])
      .ilike("action", "notification_alert_%");
    assertOrThrow(!auditQuery.error, `audit query failed: ${auditQuery.error?.message || "unknown"}`);
    const auditRows = auditQuery.data || [];
    assertOrThrow(auditRows.length >= 4, `expected >=4 alert audit logs, got ${auditRows.length}`);
    const hasDiffSummary = auditRows.some((row) => row.payload && row.payload.diffSummary && row.payload.after && row.payload.before !== undefined);
    assertOrThrow(hasDiffSummary, "alert audit payload missing before/after/diffSummary");

    outcome = {
      ok: true,
      mode: "blackbox",
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      e2eKey,
      alertResolvedId: state.alertResolvedId,
      alertDismissedId: state.alertDismissedId,
      checks: {
        apiReachable: true,
        uiLoaded: true,
        workflowOpenAckResolved: true,
        workflowDismissed: true,
        auditRecorded: true,
        unauthorizedDenied: true,
        managerDenied: true,
      },
      metrics: {
        auditCount: auditRows.length,
      },
    };
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    const tenantIds = [state.tenantHigh, state.tenantLow].filter(Boolean);
    for (const tenantId of tenantIds) {
      await admin.from("notification_delivery_events").delete().eq("tenant_id", tenantId);
      await admin.from("notification_deliveries").delete().eq("tenant_id", tenantId);
      await admin.from("notification_alert_workflows").delete().eq("tenant_id", tenantId);
      await admin.from("audit_logs").delete().eq("tenant_id", tenantId);
    }

    if (state.tenantHigh) {
      const remainDeliveries = await admin.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantHigh);
      const remainEvents = await admin.from("notification_delivery_events").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantHigh);
      const remainAlerts = await admin.from("notification_alert_workflows").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantHigh);
      const remainAudit = await admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantHigh);
      cleanup.remainingDeliveries += remainDeliveries.count ?? 0;
      cleanup.remainingEvents += remainEvents.count ?? 0;
      cleanup.remainingAlerts += remainAlerts.count ?? 0;
      cleanup.remainingAudit += remainAudit.count ?? 0;
      const deleteHigh = await admin.from("tenants").delete().eq("id", state.tenantHigh);
      cleanup.tenantHighDeleted = !deleteHigh.error;
    }
    if (state.tenantLow) {
      const remainDeliveries = await admin.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantLow);
      const remainEvents = await admin.from("notification_delivery_events").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantLow);
      const remainAlerts = await admin.from("notification_alert_workflows").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantLow);
      const remainAudit = await admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantLow);
      cleanup.remainingDeliveries += remainDeliveries.count ?? 0;
      cleanup.remainingEvents += remainEvents.count ?? 0;
      cleanup.remainingAlerts += remainAlerts.count ?? 0;
      cleanup.remainingAudit += remainAudit.count ?? 0;
      const deleteLow = await admin.from("tenants").delete().eq("id", state.tenantLow);
      cleanup.tenantLowDeleted = !deleteLow.error;
    }

    if (state.adminUserId) {
      const profileDelete = await admin.from("profiles").delete().eq("id", state.adminUserId);
      cleanup.adminProfileDeleted = !profileDelete.error;
      const userDelete = await admin.auth.admin.deleteUser(state.adminUserId);
      cleanup.adminUserDeleted = !userDelete.error;
    }

    if (state.managerUserId) {
      const profileDelete = await admin.from("profiles").delete().eq("id", state.managerUserId);
      cleanup.managerProfileDeleted = !profileDelete.error;
      const userDelete = await admin.auth.admin.deleteUser(state.managerUserId);
      cleanup.managerUserDeleted = !userDelete.error;
    }
  }

  if (fatalError) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          mode: "blackbox",
          baseUrl,
          bypassEnabled: Boolean(bypassSecret),
          error: fatalError.message,
          cleanup,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ...outcome,
        cleanup,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
