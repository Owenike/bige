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

  const e2eKey = `phase42_alert_trend_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const adminEmail = `phase42-alert-trend-admin-${Date.now()}@example.test`;
  const managerEmail = `phase42-alert-trend-manager-${Date.now()}@example.test`;
  const password = `Phase42!${crypto.randomBytes(6).toString("hex")}`;
  const now = new Date();
  const currentFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const currentTo = now;
  const previousFrom = new Date(currentFrom.getTime() - (currentTo.getTime() - currentFrom.getTime()));
  const previousTo = new Date(currentFrom.getTime() - 60 * 1000);

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const state = {
    tenantA: null,
    tenantB: null,
    adminUserId: null,
    managerUserId: null,
  };
  const cleanup = {
    tenantADeleted: false,
    tenantBDeleted: false,
    adminProfileDeleted: false,
    managerProfileDeleted: false,
    adminUserDeleted: false,
    managerUserDeleted: false,
    remainingDeliveries: 0,
    remainingAudit: 0,
  };

  let fatalError = null;
  let outcome = null;

  function buildRows(params) {
    const rows = [];
    const createdAt = params.createdAt;
    for (let index = 0; index < params.timeoutDeadLetter; index += 1) {
      rows.push({
        tenant_id: params.tenantId,
        channel: "sms",
        status: "dead_letter",
        attempts: 3,
        retry_count: 2,
        created_at: createdAt,
        dead_letter_at: createdAt,
        failed_at: createdAt,
        error_code: "PROVIDER_TIMEOUT",
        error_message: "provider timeout",
        last_error: "provider timeout",
        dedupe_key: `${e2eKey}:${params.tenantLabel}:${params.windowLabel}:timeout:${index}`,
        source_ref_type: "phase42_alert_trend",
        source_ref_id: `${params.tenantLabel}:${params.windowLabel}:timeout:${index}`,
        payload: { e2eKey },
        created_by: state.adminUserId,
      });
    }
    for (let index = 0; index < params.failedChannelConfig; index += 1) {
      rows.push({
        tenant_id: params.tenantId,
        channel: "email",
        status: "failed",
        attempts: 2,
        retry_count: 1,
        created_at: createdAt,
        failed_at: createdAt,
        error_code: "CHANNEL_NOT_CONFIGURED",
        error_message: "channel not configured",
        last_error: "channel not configured",
        dedupe_key: `${e2eKey}:${params.tenantLabel}:${params.windowLabel}:cfg:${index}`,
        source_ref_type: "phase42_alert_trend",
        source_ref_id: `${params.tenantLabel}:${params.windowLabel}:cfg:${index}`,
        payload: { e2eKey },
        created_by: state.adminUserId,
      });
    }
    for (let index = 0; index < params.retryingTemp; index += 1) {
      rows.push({
        tenant_id: params.tenantId,
        channel: "line",
        status: "retrying",
        attempts: 1,
        retry_count: 0,
        created_at: createdAt,
        next_retry_at: new Date(new Date(createdAt).getTime() + 10 * 60 * 1000).toISOString(),
        error_code: "TEMP_NETWORK",
        error_message: "temporary network issue",
        last_error: "temporary network issue",
        dedupe_key: `${e2eKey}:${params.tenantLabel}:${params.windowLabel}:retry:${index}`,
        source_ref_type: "phase42_alert_trend",
        source_ref_id: `${params.tenantLabel}:${params.windowLabel}:retry:${index}`,
        payload: { e2eKey },
        created_by: state.adminUserId,
      });
    }
    for (let index = 0; index < params.sent; index += 1) {
      rows.push({
        tenant_id: params.tenantId,
        channel: "webhook",
        status: "sent",
        attempts: 1,
        retry_count: 0,
        created_at: createdAt,
        sent_at: createdAt,
        delivered_at: createdAt,
        dedupe_key: `${e2eKey}:${params.tenantLabel}:${params.windowLabel}:sent:${index}`,
        source_ref_type: "phase42_alert_trend",
        source_ref_id: `${params.tenantLabel}:${params.windowLabel}:sent:${index}`,
        payload: { e2eKey },
        created_by: state.adminUserId,
      });
    }
    return rows;
  }

  try {
    const tenants = await admin
      .from("tenants")
      .insert([
        { name: `Trend Tenant A ${e2eKey}`, status: "active" },
        { name: `Trend Tenant B ${e2eKey}`, status: "active" },
      ])
      .select("id");
    assertOrThrow(!tenants.error, `tenant insert failed: ${tenants.error?.message || "unknown"}`);
    state.tenantA = tenants.data[0].id;
    state.tenantB = tenants.data[1].id;

    const adminCreate = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: "phase42_alert_trend_admin" },
    });
    assertOrThrow(!adminCreate.error && adminCreate.data?.user?.id, `admin create failed: ${adminCreate.error?.message || "unknown"}`);
    state.adminUserId = adminCreate.data.user.id;

    const managerCreate = await admin.auth.admin.createUser({
      email: managerEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: "phase42_alert_trend_manager" },
    });
    assertOrThrow(!managerCreate.error && managerCreate.data?.user?.id, `manager create failed: ${managerCreate.error?.message || "unknown"}`);
    state.managerUserId = managerCreate.data.user.id;

    const profileUpsert = await admin.from("profiles").upsert(
      [
        {
          id: state.adminUserId,
          role: "platform_admin",
          tenant_id: null,
          branch_id: null,
          is_active: true,
          display_name: `Trend Admin ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
        {
          id: state.managerUserId,
          role: "manager",
          tenant_id: state.tenantA,
          branch_id: null,
          is_active: true,
          display_name: `Trend Manager ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: "id" },
    );
    assertOrThrow(!profileUpsert.error, `profile upsert failed: ${profileUpsert.error?.message || "unknown"}`);

    const adminSignIn = await anon.auth.signInWithPassword({ email: adminEmail, password });
    assertOrThrow(!adminSignIn.error, `admin sign in failed: ${adminSignIn.error?.message || "unknown"}`);
    const adminToken = adminSignIn.data?.session?.access_token || "";
    assertOrThrow(adminToken.length > 20, "missing admin token");

    const managerSignIn = await anon.auth.signInWithPassword({ email: managerEmail, password });
    assertOrThrow(!managerSignIn.error, `manager sign in failed: ${managerSignIn.error?.message || "unknown"}`);
    const managerToken = managerSignIn.data?.session?.access_token || "";
    assertOrThrow(managerToken.length > 20, "missing manager token");

    const currentTs = new Date(currentFrom.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const previousTs = new Date(previousFrom.getTime() + 2 * 60 * 60 * 1000).toISOString();

    const rows = [
      ...buildRows({
        tenantId: state.tenantA,
        tenantLabel: "A",
        windowLabel: "current",
        createdAt: currentTs,
        timeoutDeadLetter: 5,
        failedChannelConfig: 2,
        retryingTemp: 1,
        sent: 2,
      }),
      ...buildRows({
        tenantId: state.tenantA,
        tenantLabel: "A",
        windowLabel: "previous",
        createdAt: previousTs,
        timeoutDeadLetter: 1,
        failedChannelConfig: 1,
        retryingTemp: 0,
        sent: 8,
      }),
      ...buildRows({
        tenantId: state.tenantB,
        tenantLabel: "B",
        windowLabel: "current",
        createdAt: currentTs,
        timeoutDeadLetter: 0,
        failedChannelConfig: 2,
        retryingTemp: 0,
        sent: 8,
      }),
      ...buildRows({
        tenantId: state.tenantB,
        tenantLabel: "B",
        windowLabel: "previous",
        createdAt: previousTs,
        timeoutDeadLetter: 0,
        failedChannelConfig: 4,
        retryingTemp: 2,
        sent: 4,
      }),
    ];
    const deliveryInsert = await admin.from("notification_deliveries").insert(rows);
    assertOrThrow(!deliveryInsert.error, `delivery insert failed: ${deliveryInsert.error?.message || "unknown"}`);

    const fromIso = currentFrom.toISOString();
    const toIso = currentTo.toISOString();
    const trends = await apiRequest({
      method: "GET",
      baseUrl,
      path: `/api/platform/notifications/trends?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&limit=5000&topLimit=8`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(trends.status === 200, `trend api expected 200, got ${trends.status}`);
    const snapshot = getSnapshot(trends.json);
    assertOrThrow(snapshot, "trend snapshot missing");
    assertOrThrow(snapshot.currentWindow.anomalyCount === 10, `current anomaly expected 10, got ${snapshot.currentWindow.anomalyCount}`);
    assertOrThrow(snapshot.previousWindow.anomalyCount === 8, `previous anomaly expected 8, got ${snapshot.previousWindow.anomalyCount}`);
    assertOrThrow(snapshot.overall.countDelta === 2, `overall count delta expected 2, got ${snapshot.overall.countDelta}`);
    assertOrThrow(snapshot.overall.direction === "up", `overall direction expected up, got ${snapshot.overall.direction}`);

    const topTenant = (snapshot.topWorseningTenants || [])[0];
    assertOrThrow(topTenant && topTenant.tenantId === state.tenantA, "top worsening tenant mismatch");
    assertOrThrow(topTenant.countDelta === 6, `tenant A delta expected 6, got ${topTenant.countDelta}`);

    const topType = (snapshot.topWorseningAnomalyTypes || [])[0];
    assertOrThrow(topType && String(topType.key || "").includes("PROVIDER_TIMEOUT"), "top anomaly type mismatch");
    assertOrThrow(topType.countDelta === 4, `timeout delta expected 4, got ${topType.countDelta}`);

    const tenantFiltered = await apiRequest({
      method: "GET",
      baseUrl,
      path: `/api/platform/notifications/trends?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&tenantId=${state.tenantA}`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(tenantFiltered.status === 200, `tenant filtered trends expected 200, got ${tenantFiltered.status}`);
    const tenantSnapshot = getSnapshot(tenantFiltered.json);
    assertOrThrow(tenantSnapshot && tenantSnapshot.tenantId === state.tenantA, "tenant filter not applied");
    assertOrThrow(tenantSnapshot.currentWindow.anomalyCount === 8, `tenant current anomaly expected 8, got ${tenantSnapshot.currentWindow.anomalyCount}`);
    assertOrThrow(tenantSnapshot.previousWindow.anomalyCount === 2, `tenant previous anomaly expected 2, got ${tenantSnapshot.previousWindow.anomalyCount}`);

    const unauthorized = await apiRequest({
      method: "GET",
      baseUrl,
      path: `/api/platform/notifications/trends?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
      token: "",
      bypassSecret,
    });
    assertOrThrow(unauthorized.status === 401, `unauthorized expected 401, got ${unauthorized.status}`);

    const managerDenied = await apiRequest({
      method: "GET",
      baseUrl,
      path: `/api/platform/notifications/trends?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
      token: managerToken,
      bypassSecret,
    });
    assertOrThrow(managerDenied.status === 403, `manager denied expected 403, got ${managerDenied.status}`);

    const page = await apiRequest({
      method: "GET",
      baseUrl,
      path: "/platform-admin/notifications-overview",
      token: "",
      bypassSecret,
    });
    assertOrThrow(page.status === 200, `overview page expected 200, got ${page.status}`);
    assertOrThrow(page.text.length > 200, "overview page html payload missing");

    outcome = {
      ok: true,
      mode: "blackbox",
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      e2eKey,
      checks: {
        apiReachable: true,
        uiLoaded: true,
        windowComparison: true,
        tenantRanking: true,
        anomalyTypeRanking: true,
        tenantFilter: true,
        unauthorizedDenied: true,
        managerDenied: true,
      },
      metrics: {
        currentAnomalyCount: snapshot.currentWindow.anomalyCount,
        previousAnomalyCount: snapshot.previousWindow.anomalyCount,
        overallDelta: snapshot.overall.countDelta,
      },
    };
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    const tenantIds = [state.tenantA, state.tenantB].filter(Boolean);
    for (const tenantId of tenantIds) {
      await admin.from("notification_deliveries").delete().eq("tenant_id", tenantId);
      await admin.from("audit_logs").delete().eq("tenant_id", tenantId);
    }

    if (state.tenantA) {
      const remainDeliveries = await admin.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantA);
      const remainAudit = await admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantA);
      cleanup.remainingDeliveries += remainDeliveries.count ?? 0;
      cleanup.remainingAudit += remainAudit.count ?? 0;
      const deleted = await admin.from("tenants").delete().eq("id", state.tenantA);
      cleanup.tenantADeleted = !deleted.error;
    }
    if (state.tenantB) {
      const remainDeliveries = await admin.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantB);
      const remainAudit = await admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantB);
      cleanup.remainingDeliveries += remainDeliveries.count ?? 0;
      cleanup.remainingAudit += remainAudit.count ?? 0;
      const deleted = await admin.from("tenants").delete().eq("id", state.tenantB);
      cleanup.tenantBDeleted = !deleted.error;
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
