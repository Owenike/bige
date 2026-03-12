const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2] || '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readArg(name) {
  const args = process.argv.slice(2);
  const index = args.findIndex((item) => item === name);
  if (index < 0) return '';
  return String(args[index + 1] || '').trim();
}

function normalizeBaseUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

function withBypass(url, bypassSecret) {
  const secret = String(bypassSecret || '').trim();
  if (!secret) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('x-vercel-protection-bypass', secret);
  parsed.searchParams.set('x-vercel-set-bypass-cookie', 'true');
  return parsed.toString();
}

function assertOrThrow(condition, message) {
  if (!condition) throw new Error(message);
}

function pickMessage(payload, fallback) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.message === 'string') return payload.message;
    if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
    if (typeof payload.errorMessage === 'string') return payload.errorMessage;
  }
  return fallback;
}

async function apiRequest(params) {
  const secret = String(params.bypassSecret || '').trim();
  const url = withBypass(`${params.baseUrl}${params.path}`, secret);
  const response = await fetch(url, {
    method: params.method,
    headers: {
      'content-type': 'application/json',
      ...(params.token ? { authorization: `Bearer ${params.token}` } : {}),
      ...(secret ? { 'x-vercel-protection-bypass': secret } : {}),
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
      method: 'GET',
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

function getSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.snapshot && typeof payload.snapshot === 'object') return payload.snapshot;
  if (payload.data && payload.data.snapshot && typeof payload.data.snapshot === 'object') return payload.data.snapshot;
  return null;
}

async function main() {
  const root = process.cwd();
  const envFileArg = readArg('--env-file');
  const envFile = (envFileArg || process.env.PHASE42_ENV_FILE || '').trim();
  if (envFile) loadEnvFile(path.isAbsolute(envFile) ? envFile : path.join(root, envFile));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
  }

  const baseUrl = normalizeBaseUrl(
    readArg('--base-url') ||
      process.env.PHASE42_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'https://bige-git-main-owens-projects-f18ecc5e.vercel.app',
  );
  const bypassSecret = String(
    readArg('--bypass-secret') ||
      process.env.PHASE42_VERCEL_BYPASS_SECRET ||
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      '',
  ).trim();

  assertOrThrow(baseUrl.startsWith('http://') || baseUrl.startsWith('https://'), `Invalid base URL: ${baseUrl}`);
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((name) => !(process.env[name] || '').trim());
  assertOrThrow(missing.length === 0, `Missing env: ${missing.join(', ')}`);

  const now = new Date();
  const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const e2eKey = `phase42_anomaly_priority_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const adminEmail = `phase42-anomaly-admin-${Date.now()}@example.test`;
  const managerEmail = `phase42-anomaly-manager-${Date.now()}@example.test`;
  const password = `Phase42!${crypto.randomBytes(6).toString('hex')}`;

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
    remainingAudit: 0,
  };
  let fatalError = null;
  let outcome = null;

  try {
    const tenantsInsert = await admin
      .from('tenants')
      .insert([
        { name: `E2E High ${e2eKey}`, status: 'active' },
        { name: `E2E Low ${e2eKey}`, status: 'active' },
      ])
      .select('id, name');
    assertOrThrow(!tenantsInsert.error, `tenant insert failed: ${tenantsInsert.error?.message || 'unknown'}`);
    const rows = tenantsInsert.data || [];
    assertOrThrow(rows.length >= 2, 'expected 2 tenants');
    state.tenantHigh = rows[0].id;
    state.tenantLow = rows[1].id;

    const adminCreate = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase42_anomaly_priority_admin' },
    });
    assertOrThrow(!adminCreate.error && adminCreate.data?.user?.id, `admin user create failed: ${adminCreate.error?.message || 'unknown'}`);
    state.adminUserId = adminCreate.data.user.id;

    const managerCreate = await admin.auth.admin.createUser({
      email: managerEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase42_anomaly_priority_manager' },
    });
    assertOrThrow(!managerCreate.error && managerCreate.data?.user?.id, `manager user create failed: ${managerCreate.error?.message || 'unknown'}`);
    state.managerUserId = managerCreate.data.user.id;

    const profileUpsert = await admin
      .from('profiles')
      .upsert(
        [
          {
            id: state.adminUserId,
            role: 'platform_admin',
            tenant_id: null,
            branch_id: null,
            is_active: true,
            display_name: `Phase42 Anomaly Admin ${e2eKey}`,
            updated_at: new Date().toISOString(),
          },
          {
            id: state.managerUserId,
            role: 'manager',
            tenant_id: state.tenantHigh,
            branch_id: null,
            is_active: true,
            display_name: `Phase42 Anomaly Manager ${e2eKey}`,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'id' },
      );
    assertOrThrow(!profileUpsert.error, `profile upsert failed: ${profileUpsert.error?.message || 'unknown'}`);

    const adminSignIn = await anon.auth.signInWithPassword({ email: adminEmail, password });
    assertOrThrow(!adminSignIn.error, `admin sign-in failed: ${adminSignIn.error?.message || 'unknown'}`);
    const adminToken = adminSignIn.data?.session?.access_token || '';
    assertOrThrow(adminToken.length > 20, 'missing admin token');

    const managerSignIn = await anon.auth.signInWithPassword({ email: managerEmail, password });
    assertOrThrow(!managerSignIn.error, `manager sign-in failed: ${managerSignIn.error?.message || 'unknown'}`);
    const managerToken = managerSignIn.data?.session?.access_token || '';
    assertOrThrow(managerToken.length > 20, 'missing manager token');

    const oldTimestamp = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    const recentTimestamp = now.toISOString();

    const deliveryRows = [];
    for (let index = 0; index < 6; index += 1) {
      deliveryRows.push({
        tenant_id: state.tenantHigh,
        channel: 'sms',
        status: 'dead_letter',
        attempts: 3,
        retry_count: 2,
        created_at: recentTimestamp,
        dead_letter_at: recentTimestamp,
        failed_at: recentTimestamp,
        error_code: 'PROVIDER_TIMEOUT',
        error_message: 'provider timeout while sending sms',
        last_error: 'provider timeout while sending sms',
        dedupe_key: `${e2eKey}:high:dl:${index}`,
        source_ref_type: 'phase42_anomaly_priority',
        source_ref_id: `high-dl-${index}`,
        payload: { e2eKey, label: `high-dl-${index}` },
        created_by: state.adminUserId,
      });
    }
    for (let index = 0; index < 4; index += 1) {
      deliveryRows.push({
        tenant_id: state.tenantHigh,
        channel: 'email',
        status: 'failed',
        attempts: 2,
        retry_count: 1,
        created_at: recentTimestamp,
        failed_at: recentTimestamp,
        error_code: 'CHANNEL_NOT_CONFIGURED',
        error_message: 'channel not configured for tenant',
        last_error: 'channel not configured for tenant',
        dedupe_key: `${e2eKey}:high:fail:${index}`,
        source_ref_type: 'phase42_anomaly_priority',
        source_ref_id: `high-fail-${index}`,
        payload: { e2eKey, label: `high-fail-${index}` },
        created_by: state.adminUserId,
      });
    }
    for (let index = 0; index < 3; index += 1) {
      deliveryRows.push({
        tenant_id: state.tenantHigh,
        channel: 'line',
        status: 'retrying',
        attempts: 1,
        retry_count: 0,
        created_at: recentTimestamp,
        next_retry_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        error_code: 'TEMP_NETWORK',
        error_message: 'temporary network issue',
        last_error: 'temporary network issue',
        dedupe_key: `${e2eKey}:high:retry:${index}`,
        source_ref_type: 'phase42_anomaly_priority',
        source_ref_id: `high-retry-${index}`,
        payload: { e2eKey, label: `high-retry-${index}` },
        created_by: state.adminUserId,
      });
    }
    for (let index = 0; index < 5; index += 1) {
      deliveryRows.push({
        tenant_id: state.tenantHigh,
        channel: 'webhook',
        status: 'sent',
        attempts: 1,
        retry_count: 0,
        created_at: recentTimestamp,
        sent_at: recentTimestamp,
        delivered_at: recentTimestamp,
        dedupe_key: `${e2eKey}:high:sent:${index}`,
        source_ref_type: 'phase42_anomaly_priority',
        source_ref_id: `high-sent-${index}`,
        payload: { e2eKey, label: `high-sent-${index}` },
        created_by: state.adminUserId,
      });
    }
    for (let index = 0; index < 2; index += 1) {
      deliveryRows.push({
        tenant_id: state.tenantHigh,
        channel: 'sms',
        status: 'failed',
        attempts: 1,
        retry_count: 0,
        created_at: oldTimestamp,
        failed_at: oldTimestamp,
        error_code: 'PROVIDER_TIMEOUT',
        error_message: 'provider timeout while sending sms',
        last_error: 'provider timeout while sending sms',
        dedupe_key: `${e2eKey}:high:old:${index}`,
        source_ref_type: 'phase42_anomaly_priority',
        source_ref_id: `high-old-${index}`,
        payload: { e2eKey, label: `high-old-${index}` },
        created_by: state.adminUserId,
      });
    }
    deliveryRows.push({
      tenant_id: state.tenantLow,
      channel: 'email',
      status: 'failed',
      attempts: 1,
      retry_count: 0,
      created_at: recentTimestamp,
      failed_at: recentTimestamp,
      error_code: 'CHANNEL_NOT_CONFIGURED',
      error_message: 'channel not configured for tenant',
      last_error: 'channel not configured for tenant',
      dedupe_key: `${e2eKey}:low:fail:1`,
      source_ref_type: 'phase42_anomaly_priority',
      source_ref_id: 'low-fail-1',
      payload: { e2eKey, label: 'low-fail-1' },
      created_by: state.adminUserId,
    });
    for (let index = 0; index < 8; index += 1) {
      deliveryRows.push({
        tenant_id: state.tenantLow,
        channel: 'email',
        status: 'sent',
        attempts: 1,
        retry_count: 0,
        created_at: recentTimestamp,
        sent_at: recentTimestamp,
        delivered_at: recentTimestamp,
        dedupe_key: `${e2eKey}:low:sent:${index}`,
        source_ref_type: 'phase42_anomaly_priority',
        source_ref_id: `low-sent-${index}`,
        payload: { e2eKey, label: `low-sent-${index}` },
        created_by: state.adminUserId,
      });
    }

    const deliveryInsert = await admin.from('notification_deliveries').insert(deliveryRows).select('id, tenant_id, status');
    assertOrThrow(!deliveryInsert.error, `delivery insert failed: ${deliveryInsert.error?.message || 'unknown'}`);

    const failedDeliveryIds = (deliveryInsert.data || []).filter((item) => item.status === 'failed').map((item) => item.id);
    if (failedDeliveryIds.length > 0) {
      const failedEventRows = failedDeliveryIds.slice(0, 3).map((deliveryId, index) => ({
        tenant_id: state.tenantHigh,
        delivery_id: deliveryId,
        channel: index % 2 === 0 ? 'sms' : 'email',
        event_type: 'failed',
        event_at: recentTimestamp,
        provider: 'phase42_priority_provider',
        provider_event_id: `${e2eKey}:failed-event:${index}`,
      }));
      const failedEventsInsert = await admin.from('notification_delivery_events').insert(failedEventRows);
      assertOrThrow(!failedEventsInsert.error, `failed events insert failed: ${failedEventsInsert.error?.message || 'unknown'}`);
    }

    const anomaliesPath = `/api/platform/notifications/anomalies?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=3000&topReasonLimit=10&topTenantLimit=10`;
    const anomalies = await apiGetWithRetry({
      baseUrl,
      path: anomaliesPath,
      token: adminToken,
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(anomalies.status === 200, `anomalies expected 200, got ${anomalies.status}: ${pickMessage(anomalies.json, anomalies.text)}`);
    const snapshot = getSnapshot(anomalies.json);
    assertOrThrow(snapshot, 'anomalies snapshot missing');
    assertOrThrow(snapshot.totalAnomalies >= 14, `expected total anomalies >=14, got ${snapshot.totalAnomalies}`);
    assertOrThrow(Array.isArray(snapshot.reasonClusters) && snapshot.reasonClusters.length >= 2, 'reason clusters missing');
    assertOrThrow(Array.isArray(snapshot.tenantPriorities) && snapshot.tenantPriorities.length >= 2, 'tenant priorities missing');
    assertOrThrow(snapshot.priorityRule && typeof snapshot.priorityRule.scoreFormula === 'string', 'priority rule missing');

    const topTenant = snapshot.tenantPriorities[0];
    assertOrThrow(topTenant.tenantId === state.tenantHigh, `expected top priority tenant=${state.tenantHigh}, got ${topTenant.tenantId}`);
    assertOrThrow(topTenant.priority === 'P1' || topTenant.priority === 'P2', `expected top priority P1/P2, got ${topTenant.priority}`);

    const timeoutCluster = snapshot.reasonClusters.find((item) => String(item.key || '').includes('PROVIDER_TIMEOUT'));
    assertOrThrow(timeoutCluster && timeoutCluster.count >= 6, 'timeout reason cluster missing or undercounted');
    const channelConfigCluster = snapshot.reasonClusters.find((item) => String(item.key || '').includes('CHANNEL_NOT_CONFIGURED'));
    assertOrThrow(channelConfigCluster && channelConfigCluster.count >= 2, 'channel_not_configured cluster missing');

    const tenantFiltered = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `${anomaliesPath}&tenantId=${state.tenantLow}`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(tenantFiltered.status === 200, `tenant filtered anomalies expected 200, got ${tenantFiltered.status}`);
    const tenantFilteredSnapshot = getSnapshot(tenantFiltered.json);
    assertOrThrow(tenantFilteredSnapshot && tenantFilteredSnapshot.tenantId === state.tenantLow, 'tenant filter not applied');
    assertOrThrow(tenantFilteredSnapshot.totalAnomalies === 1, `tenant low anomalies expected 1, got ${tenantFilteredSnapshot.totalAnomalies}`);

    const unauthorized = await apiRequest({
      method: 'GET',
      baseUrl,
      path: anomaliesPath,
      token: '',
      bypassSecret,
    });
    assertOrThrow(unauthorized.status === 401, `anomalies unauthorized expected 401, got ${unauthorized.status}`);

    const managerDenied = await apiRequest({
      method: 'GET',
      baseUrl,
      path: anomaliesPath,
      token: managerToken,
      bypassSecret,
    });
    assertOrThrow(managerDenied.status === 403, `anomalies manager denied expected 403, got ${managerDenied.status}`);

    const overviewPage = await apiGetWithRetry({
      baseUrl,
      path: '/platform-admin/notifications-overview',
      token: '',
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(overviewPage.status === 200, `overview page expected 200, got ${overviewPage.status}`);
    assertOrThrow(
      overviewPage.text.includes('Tenant Alert Priority') || overviewPage.text.includes('notifications-overview'),
      'overview alert section payload missing',
    );

    outcome = {
      ok: true,
      mode: 'blackbox',
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      e2eKey,
      tenantHigh: state.tenantHigh,
      tenantLow: state.tenantLow,
      checks: {
        apiReachable: true,
        uiLoaded: true,
        reasonClusters: true,
        tenantPriority: true,
        tenantFilter: true,
        unauthorizedDenied: true,
        managerDenied: true,
      },
      metrics: {
        totalAnomalies: snapshot.totalAnomalies,
        topPriorityTenant: topTenant.tenantId,
        topPriorityLevel: topTenant.priority,
        topReason: snapshot.reasonClusters[0]?.label || null,
      },
    };
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    const tenantIds = [state.tenantHigh, state.tenantLow].filter(Boolean);
    for (const tenantId of tenantIds) {
      await admin.from('notification_delivery_events').delete().eq('tenant_id', tenantId);
      await admin.from('notification_deliveries').delete().eq('tenant_id', tenantId);
      await admin.from('audit_logs').delete().eq('tenant_id', tenantId);
    }

    if (state.tenantHigh) {
      const remainDeliveries = await admin.from('notification_deliveries').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantHigh);
      const remainEvents = await admin.from('notification_delivery_events').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantHigh);
      const remainAudit = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantHigh);
      cleanup.remainingDeliveries += remainDeliveries.count ?? 0;
      cleanup.remainingEvents += remainEvents.count ?? 0;
      cleanup.remainingAudit += remainAudit.count ?? 0;
      const deleteHigh = await admin.from('tenants').delete().eq('id', state.tenantHigh);
      cleanup.tenantHighDeleted = !deleteHigh.error;
    }
    if (state.tenantLow) {
      const remainDeliveries = await admin.from('notification_deliveries').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantLow);
      const remainEvents = await admin.from('notification_delivery_events').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantLow);
      const remainAudit = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantLow);
      cleanup.remainingDeliveries += remainDeliveries.count ?? 0;
      cleanup.remainingEvents += remainEvents.count ?? 0;
      cleanup.remainingAudit += remainAudit.count ?? 0;
      const deleteLow = await admin.from('tenants').delete().eq('id', state.tenantLow);
      cleanup.tenantLowDeleted = !deleteLow.error;
    }

    if (state.adminUserId) {
      const profileDelete = await admin.from('profiles').delete().eq('id', state.adminUserId);
      cleanup.adminProfileDeleted = !profileDelete.error;
      const userDelete = await admin.auth.admin.deleteUser(state.adminUserId);
      cleanup.adminUserDeleted = !userDelete.error;
    }

    if (state.managerUserId) {
      const profileDelete = await admin.from('profiles').delete().eq('id', state.managerUserId);
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
          mode: 'blackbox',
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
