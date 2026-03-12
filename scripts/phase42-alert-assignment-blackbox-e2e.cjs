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

  const e2eKey = `phase42_alert_assignment_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const adminEmail = `phase42-alert-assignment-admin-${Date.now()}@example.test`;
  const managerEmail = `phase42-alert-assignment-manager-${Date.now()}@example.test`;
  const assigneeAEmail = `phase42-alert-assignment-a-${Date.now()}@example.test`;
  const assigneeBEmail = `phase42-alert-assignment-b-${Date.now()}@example.test`;
  const password = `Phase42!${crypto.randomBytes(6).toString("hex")}`;

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
    assigneeAUserId: null,
    assigneeBUserId: null,
    alertId: null,
  };

  const cleanup = {
    tenantDeleted: false,
    adminProfileDeleted: false,
    managerProfileDeleted: false,
    assigneeAProfileDeleted: false,
    assigneeBProfileDeleted: false,
    adminUserDeleted: false,
    managerUserDeleted: false,
    assigneeAUserDeleted: false,
    assigneeBUserDeleted: false,
    remainingAlerts: 0,
    remainingAudit: 0,
  };

  let fatalError = null;
  let outcome = null;

  try {
    const tenantInsert = await admin.from("tenants").insert({ name: `E2E Assignment ${e2eKey}`, status: "active" }).select("id").maybeSingle();
    assertOrThrow(!tenantInsert.error && tenantInsert.data?.id, `tenant insert failed: ${tenantInsert.error?.message || "unknown"}`);
    state.tenantId = tenantInsert.data.id;

    const createdUsers = await Promise.all(
      [adminEmail, managerEmail, assigneeAEmail, assigneeBEmail].map((email) =>
        admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { e2eKey, scenario: "phase42_alert_assignment" },
        }),
      ),
    );
    for (const result of createdUsers) {
      assertOrThrow(!result.error && result.data?.user?.id, `create user failed: ${result.error?.message || "unknown"}`);
    }
    state.adminUserId = createdUsers[0].data.user.id;
    state.managerUserId = createdUsers[1].data.user.id;
    state.assigneeAUserId = createdUsers[2].data.user.id;
    state.assigneeBUserId = createdUsers[3].data.user.id;

    const profileUpsert = await admin.from("profiles").upsert(
      [
        {
          id: state.adminUserId,
          role: "platform_admin",
          tenant_id: null,
          branch_id: null,
          is_active: true,
          display_name: `Assignment Admin ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
        {
          id: state.managerUserId,
          role: "manager",
          tenant_id: state.tenantId,
          branch_id: null,
          is_active: true,
          display_name: `Assignment Manager ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
        {
          id: state.assigneeAUserId,
          role: "supervisor",
          tenant_id: state.tenantId,
          branch_id: null,
          is_active: true,
          display_name: `Assignment A ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
        {
          id: state.assigneeBUserId,
          role: "frontdesk",
          tenant_id: state.tenantId,
          branch_id: null,
          is_active: true,
          display_name: `Assignment B ${e2eKey}`,
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

    const upsertAlert = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: adminToken,
      bypassSecret,
      body: {
        action: "upsert_from_anomaly",
        tenantId: state.tenantId,
        anomalyKey: `MANUAL_ASSIGNMENT:${e2eKey}`,
        anomalyType: "manual",
        priority: "P2",
        severity: "high",
        summary: "manual assignment test alert",
        sourceData: { e2eKey },
      },
    });
    assertOrThrow(upsertAlert.status === 200, `upsert alert expected 200, got ${upsertAlert.status}`);
    state.alertId = upsertAlert.json?.item?.id || upsertAlert.json?.data?.item?.id || null;
    assertOrThrow(Boolean(state.alertId), "missing alert id");

    const assignFirst = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: adminToken,
      bypassSecret,
      body: {
        action: "assign_alert",
        id: state.alertId,
        assigneeUserId: state.assigneeAUserId,
        assignmentNote: "assign to A",
      },
    });
    assertOrThrow(assignFirst.status === 200, `assign first expected 200, got ${assignFirst.status}`);

    const assignSecond = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: adminToken,
      bypassSecret,
      body: {
        action: "assign_alert",
        id: state.alertId,
        assigneeUserId: state.assigneeBUserId,
        assignmentNote: "reassign to B",
      },
    });
    assertOrThrow(assignSecond.status === 200, `assign second expected 200, got ${assignSecond.status}`);

    const unassign = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: adminToken,
      bypassSecret,
      body: {
        action: "assign_alert",
        id: state.alertId,
        assigneeUserId: null,
        assignmentNote: "unassign by e2e",
      },
    });
    assertOrThrow(unassign.status === 200, `unassign expected 200, got ${unassign.status}`);

    const listed = await apiGetWithRetry({
      baseUrl,
      path: `/api/platform/notifications/alerts?tenantId=${state.tenantId}&statuses=open`,
      token: adminToken,
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(listed.status === 200, `list expected 200, got ${listed.status}`);
    const items = getItems(listed.json);
    const alert = items.find((item) => item.id === state.alertId);
    assertOrThrow(Boolean(alert), "alert missing after assignment workflow");
    assertOrThrow(alert.assigneeUserId === null, "alert should be unassigned at end");
    assertOrThrow(typeof alert.assignmentNote === "string" && alert.assignmentNote.length > 0, "assignment note missing");

    const unauthorized = await apiRequest({
      method: "GET",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: "",
      bypassSecret,
    });
    assertOrThrow(unauthorized.status === 401, `unauthorized expected 401, got ${unauthorized.status}`);

    const managerDenied = await apiRequest({
      method: "PUT",
      baseUrl,
      path: "/api/platform/notifications/alerts",
      token: managerToken,
      bypassSecret,
      body: {
        action: "assign_alert",
        id: state.alertId,
        assigneeUserId: state.assigneeAUserId,
      },
    });
    assertOrThrow(managerDenied.status === 403, `manager assign expected 403, got ${managerDenied.status}`);

    const page = await apiGetWithRetry({
      baseUrl,
      path: "/platform-admin/notifications-alerts",
      token: "",
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(page.status === 200, `alerts page expected 200, got ${page.status}`);
    assertOrThrow(page.text.length > 200, "alerts page html payload missing");

    const auditRowsResult = await admin
      .from("audit_logs")
      .select("action, payload")
      .eq("tenant_id", state.tenantId)
      .in("action", ["notification_alert_assigned", "notification_alert_reassigned", "notification_alert_unassigned"]);
    assertOrThrow(!auditRowsResult.error, `audit query failed: ${auditRowsResult.error?.message || "unknown"}`);
    const auditRows = auditRowsResult.data || [];
    assertOrThrow(auditRows.some((item) => item.action === "notification_alert_assigned"), "missing assigned audit");
    assertOrThrow(auditRows.some((item) => item.action === "notification_alert_reassigned"), "missing reassigned audit");
    assertOrThrow(auditRows.some((item) => item.action === "notification_alert_unassigned"), "missing unassigned audit");
    assertOrThrow(auditRows.some((item) => item.payload && item.payload.diffSummary && item.payload.before && item.payload.after), "audit payload missing before/after/diffSummary");

    outcome = {
      ok: true,
      mode: "blackbox",
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      e2eKey,
      alertId: state.alertId,
      checks: {
        apiReachable: true,
        uiLoaded: true,
        assign: true,
        reassign: true,
        unassign: true,
        unauthorizedDenied: true,
        managerDenied: true,
        auditRecorded: true,
      },
      metrics: {
        assignmentAuditCount: auditRows.length,
      },
    };
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (state.tenantId) {
      await admin.from("notification_alert_workflows").delete().eq("tenant_id", state.tenantId);
      await admin.from("audit_logs").delete().eq("tenant_id", state.tenantId);
      const remainAlerts = await admin.from("notification_alert_workflows").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantId);
      const remainAudit = await admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("tenant_id", state.tenantId);
      cleanup.remainingAlerts = remainAlerts.count ?? 0;
      cleanup.remainingAudit = remainAudit.count ?? 0;
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
    if (state.assigneeAUserId) {
      const profileDelete = await admin.from("profiles").delete().eq("id", state.assigneeAUserId);
      cleanup.assigneeAProfileDeleted = !profileDelete.error;
      const userDelete = await admin.auth.admin.deleteUser(state.assigneeAUserId);
      cleanup.assigneeAUserDeleted = !userDelete.error;
    }
    if (state.assigneeBUserId) {
      const profileDelete = await admin.from("profiles").delete().eq("id", state.assigneeBUserId);
      cleanup.assigneeBProfileDeleted = !profileDelete.error;
      const userDelete = await admin.auth.admin.deleteUser(state.assigneeBUserId);
      cleanup.assigneeBUserDeleted = !userDelete.error;
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
