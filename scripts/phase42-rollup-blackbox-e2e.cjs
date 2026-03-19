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

function toDateStringUtc(date) {
  return date.toISOString().slice(0, 10);
}

function dayStartIsoUtc(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  return d.toISOString();
}

function dayEndIsoUtc(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return d.toISOString();
}

function insertDeliveryRows(input) {
  const rows = [];
  for (let i = 0; i < input.deadLetter; i += 1) {
    rows.push({
      tenant_id: input.tenantId,
      channel: "sms",
      status: "dead_letter",
      attempts: 3,
      retry_count: 2,
      created_at: input.createdAt,
      failed_at: input.createdAt,
      dead_letter_at: input.createdAt,
      error_code: "PROVIDER_TIMEOUT",
      error_message: "provider timeout",
      last_error: "provider timeout",
      dedupe_key: `${input.e2eKey}:${input.window}:dead_letter:${i}`,
      source_ref_type: "phase42_rollup",
      source_ref_id: `${input.window}:dead_letter:${i}`,
      payload: { e2eKey: input.e2eKey },
      created_by: input.createdBy,
    });
  }
  for (let i = 0; i < input.failed; i += 1) {
    rows.push({
      tenant_id: input.tenantId,
      channel: "email",
      status: "failed",
      attempts: 2,
      retry_count: 1,
      created_at: input.createdAt,
      failed_at: input.createdAt,
      error_code: "CHANNEL_NOT_CONFIGURED",
      error_message: "channel not configured",
      last_error: "channel not configured",
      dedupe_key: `${input.e2eKey}:${input.window}:failed:${i}`,
      source_ref_type: "phase42_rollup",
      source_ref_id: `${input.window}:failed:${i}`,
      payload: { e2eKey: input.e2eKey },
      created_by: input.createdBy,
    });
  }
  for (let i = 0; i < input.retrying; i += 1) {
    rows.push({
      tenant_id: input.tenantId,
      channel: "line",
      status: "retrying",
      attempts: 1,
      retry_count: 0,
      created_at: input.createdAt,
      next_retry_at: new Date(new Date(input.createdAt).getTime() + 20 * 60 * 1000).toISOString(),
      error_code: "TEMP_NETWORK",
      error_message: "temporary network issue",
      last_error: "temporary network issue",
      dedupe_key: `${input.e2eKey}:${input.window}:retrying:${i}`,
      source_ref_type: "phase42_rollup",
      source_ref_id: `${input.window}:retrying:${i}`,
      payload: { e2eKey: input.e2eKey },
      created_by: input.createdBy,
    });
  }
  for (let i = 0; i < input.sent; i += 1) {
    rows.push({
      tenant_id: input.tenantId,
      channel: "webhook",
      status: "sent",
      attempts: 1,
      retry_count: 0,
      created_at: input.createdAt,
      sent_at: input.createdAt,
      delivered_at: input.createdAt,
      dedupe_key: `${input.e2eKey}:${input.window}:sent:${i}`,
      source_ref_type: "phase42_rollup",
      source_ref_id: `${input.window}:sent:${i}`,
      payload: { e2eKey: input.e2eKey },
      created_by: input.createdBy,
    });
  }
  return rows;
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
      "",
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

  const e2eKey = `phase42_rollup_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const adminEmail = `phase42-rollup-admin-${Date.now()}@example.test`;
  const managerEmail = `phase42-rollup-manager-${Date.now()}@example.test`;
  const password = `Phase42!${crypto.randomBytes(6).toString("hex")}`;

  const now = new Date();
  const currentDayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const previousDayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
  const currentFromIso = dayStartIsoUtc(currentDayDate);
  const currentToIso = dayEndIsoUtc(currentDayDate);
  const previousFromIso = dayStartIsoUtc(previousDayDate);
  const previousToIso = dayEndIsoUtc(previousDayDate);

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const state = {
    tenantId: null,
    adminUserId: null,
    managerUserId: null,
  };
  const cleanup = {
    tenantDeleted: false,
    adminProfileDeleted: false,
    managerProfileDeleted: false,
    adminUserDeleted: false,
    managerUserDeleted: false,
    remainingDeliveries: 0,
    remainingEvents: 0,
    remainingDailyRollups: 0,
    remainingAnomalyRollups: 0,
  };

  let fatalError = null;
  let outcome = null;

  try {
    const tenantInsert = await admin.from("tenants").insert([{ name: `Rollup Tenant ${e2eKey}`, status: "active" }]).select("id").single();
    assertOrThrow(!tenantInsert.error && tenantInsert.data?.id, `tenant insert failed: ${tenantInsert.error?.message || "unknown"}`);
    state.tenantId = tenantInsert.data.id;

    const adminCreate = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: "phase42_rollup_admin" },
    });
    assertOrThrow(!adminCreate.error && adminCreate.data?.user?.id, `admin create failed: ${adminCreate.error?.message || "unknown"}`);
    state.adminUserId = adminCreate.data.user.id;

    const managerCreate = await admin.auth.admin.createUser({
      email: managerEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: "phase42_rollup_manager" },
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
          display_name: `Rollup Admin ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
        {
          id: state.managerUserId,
          role: "manager",
          tenant_id: state.tenantId,
          branch_id: null,
          is_active: true,
          display_name: `Rollup Manager ${e2eKey}`,
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

    const currentAt = new Date(new Date(currentFromIso).getTime() + 8 * 60 * 60 * 1000).toISOString();
    const previousAt = new Date(new Date(previousFromIso).getTime() + 8 * 60 * 60 * 1000).toISOString();

    const deliveryRows = [
      ...insertDeliveryRows({
        e2eKey,
        tenantId: state.tenantId,
        createdBy: state.adminUserId,
        window: "previous",
        createdAt: previousAt,
        deadLetter: 1,
        failed: 1,
        retrying: 0,
        sent: 8,
      }),
      ...insertDeliveryRows({
        e2eKey,
        tenantId: state.tenantId,
        createdBy: state.adminUserId,
        window: "current",
        createdAt: currentAt,
        deadLetter: 3,
        failed: 1,
        retrying: 1,
        sent: 5,
      }),
    ];
    const deliveryInsert = await admin.from("notification_deliveries").insert(deliveryRows);
    assertOrThrow(!deliveryInsert.error, `delivery insert failed: ${deliveryInsert.error?.message || "unknown"}`);

    const eventInsert = await admin.from("notification_delivery_events").insert([
      {
        tenant_id: state.tenantId,
        branch_id: null,
        delivery_id: null,
        notification_id: null,
        channel: "webhook",
        event_type: "opened",
        event_at: currentAt,
        provider: "e2e",
        provider_event_id: `${e2eKey}:opened:current`,
        metadata: { e2eKey },
        created_by: state.adminUserId,
      },
      {
        tenant_id: state.tenantId,
        branch_id: null,
        delivery_id: null,
        notification_id: null,
        channel: "webhook",
        event_type: "clicked",
        event_at: currentAt,
        provider: "e2e",
        provider_event_id: `${e2eKey}:clicked:current`,
        metadata: { e2eKey },
        created_by: state.adminUserId,
      },
      {
        tenant_id: state.tenantId,
        branch_id: null,
        delivery_id: null,
        notification_id: null,
        channel: "webhook",
        event_type: "conversion",
        event_at: previousAt,
        provider: "e2e",
        provider_event_id: `${e2eKey}:conversion:previous`,
        metadata: { e2eKey },
        created_by: state.adminUserId,
      },
    ]);
    assertOrThrow(!eventInsert.error, `event insert failed: ${eventInsert.error?.message || "unknown"}`);

    const refreshUnauthorized = await apiRequest({
      method: "POST",
      baseUrl,
      path: "/api/platform/notifications/rollups/refresh",
      token: "",
      bypassSecret,
      body: { mode: "incremental", days: 2, tenantId: state.tenantId },
    });
    assertOrThrow(refreshUnauthorized.status === 401, `refresh unauthorized expected 401, got ${refreshUnauthorized.status}`);

    const refreshManagerDenied = await apiRequest({
      method: "POST",
      baseUrl,
      path: "/api/platform/notifications/rollups/refresh",
      token: managerToken,
      bypassSecret,
      body: { mode: "incremental", days: 2, tenantId: state.tenantId },
    });
    assertOrThrow(refreshManagerDenied.status === 403, `refresh manager denied expected 403, got ${refreshManagerDenied.status}`);

    const refreshRebuild = await apiRequest({
      method: "POST",
      baseUrl,
      path: "/api/platform/notifications/rollups/refresh",
      token: adminToken,
      bypassSecret,
      body: {
        mode: "rebuild",
        fromDate: toDateStringUtc(previousDayDate),
        toDate: toDateStringUtc(currentDayDate),
        tenantId: state.tenantId,
      },
    });
    assertOrThrow(refreshRebuild.status === 200, `refresh rebuild expected 200, got ${refreshRebuild.status}`);
    assertOrThrow(Boolean(refreshRebuild.json?.summary || refreshRebuild.json?.data?.summary), "refresh summary missing");

    const rollupRows = await admin
      .from("notification_delivery_daily_rollups")
      .select("day, total_count, sent_count, failed_count, dead_letter_count, opened_count, clicked_count, conversion_count")
      .eq("tenant_id", state.tenantId)
      .gte("day", toDateStringUtc(previousDayDate))
      .lte("day", toDateStringUtc(currentDayDate));
    assertOrThrow(!rollupRows.error, `rollup read failed: ${rollupRows.error?.message || "unknown"}`);
    assertOrThrow((rollupRows.data || []).length >= 2, "daily rollup rows missing");
    assertOrThrow((rollupRows.data || []).some((item) => Number(item.opened_count || 0) > 0), "opened_count rollup missing");
    assertOrThrow((rollupRows.data || []).some((item) => Number(item.clicked_count || 0) > 0), "clicked_count rollup missing");
    assertOrThrow((rollupRows.data || []).some((item) => Number(item.conversion_count || 0) > 0), "conversion_count rollup missing");

    const trendRollup = await apiRequest({
      method: "GET",
      baseUrl,
      path: `/api/platform/notifications/trends?tenantId=${state.tenantId}&from=${encodeURIComponent(
        currentFromIso,
      )}&to=${encodeURIComponent(currentToIso)}&aggregationMode=rollup&topLimit=6`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(trendRollup.status === 200, `trend rollup expected 200, got ${trendRollup.status}`);
    const rollupSnapshot = getSnapshot(trendRollup.json);
    assertOrThrow(rollupSnapshot, "rollup snapshot missing");
    assertOrThrow(rollupSnapshot.dataSource === "rollup", `rollup dataSource expected rollup, got ${rollupSnapshot.dataSource}`);

    const trendRaw = await apiRequest({
      method: "GET",
      baseUrl,
      path: `/api/platform/notifications/trends?tenantId=${state.tenantId}&from=${encodeURIComponent(
        currentFromIso,
      )}&to=${encodeURIComponent(currentToIso)}&aggregationMode=raw&topLimit=6&limit=6000`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(trendRaw.status === 200, `trend raw expected 200, got ${trendRaw.status}`);
    const rawSnapshot = getSnapshot(trendRaw.json);
    assertOrThrow(rawSnapshot, "raw snapshot missing");
    assertOrThrow(rawSnapshot.dataSource === "raw", `raw dataSource expected raw, got ${rawSnapshot.dataSource}`);

    assertOrThrow(
      rollupSnapshot.currentWindow.anomalyCount === rawSnapshot.currentWindow.anomalyCount,
      `current anomaly mismatch rollup=${rollupSnapshot.currentWindow.anomalyCount} raw=${rawSnapshot.currentWindow.anomalyCount}`,
    );
    assertOrThrow(
      rollupSnapshot.previousWindow.anomalyCount === rawSnapshot.previousWindow.anomalyCount,
      `previous anomaly mismatch rollup=${rollupSnapshot.previousWindow.anomalyCount} raw=${rawSnapshot.previousWindow.anomalyCount}`,
    );
    assertOrThrow(
      rollupSnapshot.overall.countDelta === rawSnapshot.overall.countDelta,
      `overall delta mismatch rollup=${rollupSnapshot.overall.countDelta} raw=${rawSnapshot.overall.countDelta}`,
    );
    assertOrThrow(
      rollupSnapshot.overall.rateDelta === rawSnapshot.overall.rateDelta,
      `overall rate delta mismatch rollup=${rollupSnapshot.overall.rateDelta} raw=${rawSnapshot.overall.rateDelta}`,
    );

    const trendAuto = await apiRequest({
      method: "GET",
      baseUrl,
      path: `/api/platform/notifications/trends?tenantId=${state.tenantId}&from=${encodeURIComponent(
        currentFromIso,
      )}&to=${encodeURIComponent(currentToIso)}&aggregationMode=auto&topLimit=6`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(trendAuto.status === 200, `trend auto expected 200, got ${trendAuto.status}`);
    const autoSnapshot = getSnapshot(trendAuto.json);
    assertOrThrow(autoSnapshot && autoSnapshot.dataSource === "rollup", "auto mode did not switch to rollup");

    const overviewPage = await apiRequest({
      method: "GET",
      baseUrl,
      path: "/platform-admin/notifications-overview",
      token: "",
      bypassSecret,
    });
    assertOrThrow(overviewPage.status === 200, `overview page expected 200, got ${overviewPage.status}`);

    outcome = {
      ok: true,
      mode: "blackbox",
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      e2eKey,
      checks: {
        refreshRebuild: true,
        rollupReadable: true,
        rawVsRollupMatch: true,
        autoModeUsesRollup: true,
        unauthorizedDenied: true,
        managerDenied: true,
        uiLoaded: true,
      },
      metrics: {
        currentAnomalyCount: rollupSnapshot.currentWindow.anomalyCount,
        previousAnomalyCount: rollupSnapshot.previousWindow.anomalyCount,
        overallDelta: rollupSnapshot.overall.countDelta,
      },
    };
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (state.tenantId) {
      await admin.from("notification_delivery_events").delete().eq("tenant_id", state.tenantId);
      await admin.from("notification_deliveries").delete().eq("tenant_id", state.tenantId);
      await admin.from("notification_delivery_anomaly_daily_rollups").delete().eq("tenant_id", state.tenantId);
      await admin.from("notification_delivery_daily_rollups").delete().eq("tenant_id", state.tenantId);

      const remainDeliveries = await admin.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantId);
      const remainEvents = await admin.from("notification_delivery_events").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantId);
      const remainRollup = await admin
        .from("notification_delivery_daily_rollups")
        .select("day", { count: "exact", head: true })
        .eq("tenant_id", state.tenantId);
      const remainAnomalyRollup = await admin
        .from("notification_delivery_anomaly_daily_rollups")
        .select("day", { count: "exact", head: true })
        .eq("tenant_id", state.tenantId);

      cleanup.remainingDeliveries = remainDeliveries.count ?? 0;
      cleanup.remainingEvents = remainEvents.count ?? 0;
      cleanup.remainingDailyRollups = remainRollup.count ?? 0;
      cleanup.remainingAnomalyRollups = remainAnomalyRollup.count ?? 0;

      const tenantDelete = await admin.from("tenants").delete().eq("id", state.tenantId);
      cleanup.tenantDeleted = !tenantDelete.error;
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
