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
  if (envFile) {
    loadEnvFile(path.isAbsolute(envFile) ? envFile : path.join(root, envFile));
  }

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
  const from = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const e2eKey = `phase42_tenant_drilldown_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const adminEmail = `phase42-drill-admin-${Date.now()}@example.test`;
  const managerEmail = `phase42-drill-manager-${Date.now()}@example.test`;
  const password = `Phase42!${crypto.randomBytes(6).toString('hex')}`;

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
    deliveryIds: {},
  };
  const cleanup = {
    tenantDeleted: false,
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
    const tenantInsert = await admin
      .from('tenants')
      .insert({ name: `E2E Phase42 Drilldown ${e2eKey}`, status: 'active' })
      .select('id')
      .single();
    assertOrThrow(!tenantInsert.error && tenantInsert.data?.id, `tenant insert failed: ${tenantInsert.error?.message || 'unknown'}`);
    state.tenantId = tenantInsert.data.id;

    const adminCreate = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase42_tenant_drilldown_admin' },
    });
    assertOrThrow(!adminCreate.error && adminCreate.data?.user?.id, `admin user create failed: ${adminCreate.error?.message || 'unknown'}`);
    state.adminUserId = adminCreate.data.user.id;

    const managerCreate = await admin.auth.admin.createUser({
      email: managerEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase42_tenant_drilldown_manager' },
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
            display_name: `Phase42 Drilldown Admin ${e2eKey}`,
            updated_at: new Date().toISOString(),
          },
          {
            id: state.managerUserId,
            role: 'manager',
            tenant_id: state.tenantId,
            branch_id: null,
            is_active: true,
            display_name: `Phase42 Drilldown Manager ${e2eKey}`,
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

    const deliveryInsert = await admin
      .from('notification_deliveries')
      .insert([
        {
          tenant_id: state.tenantId,
          channel: 'email',
          status: 'sent',
          attempts: 1,
          retry_count: 0,
          sent_at: now.toISOString(),
          delivered_at: now.toISOString(),
          dedupe_key: `${e2eKey}:d1`,
          source_ref_type: 'phase42_drilldown',
          source_ref_id: 'd1',
          payload: { e2eKey, label: 'd1' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'sms',
          status: 'dead_letter',
          attempts: 3,
          retry_count: 2,
          failed_at: now.toISOString(),
          dead_letter_at: now.toISOString(),
          error_code: 'PERM_FAIL',
          error_message: 'provider permanent failure',
          last_error: 'provider permanent failure',
          dedupe_key: `${e2eKey}:d2`,
          source_ref_type: 'phase42_drilldown',
          source_ref_id: 'd2',
          payload: { e2eKey, label: 'd2' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'line',
          status: 'retrying',
          attempts: 2,
          retry_count: 1,
          next_retry_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
          error_code: 'TEMP_FAIL',
          error_message: 'temporary provider failure',
          last_error: 'temporary provider failure',
          dedupe_key: `${e2eKey}:d3`,
          source_ref_type: 'phase42_drilldown',
          source_ref_id: 'd3',
          payload: { e2eKey, label: 'd3' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'webhook',
          status: 'failed',
          attempts: 1,
          retry_count: 0,
          failed_at: now.toISOString(),
          error_code: 'WEBHOOK_FAIL',
          error_message: 'webhook endpoint down',
          last_error: 'webhook endpoint down',
          dedupe_key: `${e2eKey}:d4`,
          source_ref_type: 'phase42_drilldown',
          source_ref_id: 'd4',
          payload: { e2eKey, label: 'd4' },
          created_by: state.adminUserId,
        },
      ])
      .select('id, source_ref_id');
    assertOrThrow(!deliveryInsert.error, `delivery insert failed: ${deliveryInsert.error?.message || 'unknown'}`);
    for (const row of deliveryInsert.data || []) {
      state.deliveryIds[row.source_ref_id] = row.id;
    }

    const eventInsert = await admin.from('notification_delivery_events').insert([
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.d1,
        channel: 'email',
        event_type: 'opened',
        event_at: now.toISOString(),
        provider: 'phase42_drill_provider',
        provider_event_id: `${e2eKey}:open:d1`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.d1,
        channel: 'email',
        event_type: 'clicked',
        event_at: now.toISOString(),
        provider: 'phase42_drill_provider',
        provider_event_id: `${e2eKey}:click:d1`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.d1,
        channel: 'email',
        event_type: 'conversion',
        event_at: now.toISOString(),
        provider: 'phase42_drill_provider',
        provider_event_id: `${e2eKey}:conv:d1`,
      },
    ]);
    assertOrThrow(!eventInsert.error, `event insert failed: ${eventInsert.error?.message || 'unknown'}`);

    const overviewPath = `/api/platform/notifications/overview?tenantId=${state.tenantId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2000`;
    const overview = await apiGetWithRetry({
      baseUrl,
      path: overviewPath,
      token: adminToken,
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(overview.status === 200, `overview expected 200, got ${overview.status}: ${pickMessage(overview.json, overview.text)}`);
    const overviewSnapshot = getSnapshot(overview.json);
    assertOrThrow(overviewSnapshot, 'overview snapshot missing');

    const drilldownPath = `/api/platform/notifications/overview/tenants/${state.tenantId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2000&anomalyLimit=40`;
    const drilldown = await apiGetWithRetry({
      baseUrl,
      path: drilldownPath,
      token: adminToken,
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(drilldown.status === 200, `drilldown expected 200, got ${drilldown.status}: ${pickMessage(drilldown.json, drilldown.text)}`);
    const drillSnapshot = getSnapshot(drilldown.json);
    assertOrThrow(drillSnapshot, 'drilldown snapshot missing');

    assertOrThrow(drillSnapshot.tenantId === state.tenantId, 'drilldown tenantId mismatch');
    assertOrThrow(drillSnapshot.sent === overviewSnapshot.sent, `sent mismatch: drilldown=${drillSnapshot.sent}, overview=${overviewSnapshot.sent}`);
    assertOrThrow(drillSnapshot.failed === overviewSnapshot.failed, `failed mismatch: drilldown=${drillSnapshot.failed}, overview=${overviewSnapshot.failed}`);
    assertOrThrow(drillSnapshot.deadLetter === overviewSnapshot.deadLetter, `deadLetter mismatch: drilldown=${drillSnapshot.deadLetter}, overview=${overviewSnapshot.deadLetter}`);
    assertOrThrow(drillSnapshot.opened === overviewSnapshot.opened, `opened mismatch: drilldown=${drillSnapshot.opened}, overview=${overviewSnapshot.opened}`);
    assertOrThrow(drillSnapshot.clicked === overviewSnapshot.clicked, `clicked mismatch: drilldown=${drillSnapshot.clicked}, overview=${overviewSnapshot.clicked}`);
    assertOrThrow(drillSnapshot.conversion === overviewSnapshot.conversion, `conversion mismatch: drilldown=${drillSnapshot.conversion}, overview=${overviewSnapshot.conversion}`);
    assertOrThrow(Array.isArray(drillSnapshot.daily) && drillSnapshot.daily.length >= 1, 'drilldown daily trend missing');
    assertOrThrow(Array.isArray(drillSnapshot.byChannel) && drillSnapshot.byChannel.length >= 1, 'drilldown byChannel missing');
    assertOrThrow(Array.isArray(drillSnapshot.recentAnomalies) && drillSnapshot.recentAnomalies.length >= 1, 'drilldown anomalies missing');
    assertOrThrow(
      drillSnapshot.recentAnomalies.some((item) => item.status === 'dead_letter'),
      'drilldown anomalies should include dead_letter row',
    );

    const filtered = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `${drilldownPath}&channel=email`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(filtered.status === 200, `drilldown channel filter expected 200, got ${filtered.status}`);
    const filteredSnapshot = getSnapshot(filtered.json);
    assertOrThrow(filteredSnapshot && filteredSnapshot.channel === 'email', 'drilldown channel filter not applied');
    assertOrThrow(filteredSnapshot.sent === 1, `drilldown email sent expected 1, got ${filteredSnapshot.sent}`);
    assertOrThrow(filteredSnapshot.deadLetter === 0, `drilldown email deadLetter expected 0, got ${filteredSnapshot.deadLetter}`);

    const unauthorized = await apiRequest({
      method: 'GET',
      baseUrl,
      path: drilldownPath,
      token: '',
      bypassSecret,
    });
    assertOrThrow(unauthorized.status === 401, `drilldown unauthorized expected 401, got ${unauthorized.status}`);

    const managerDenied = await apiRequest({
      method: 'GET',
      baseUrl,
      path: drilldownPath,
      token: managerToken,
      bypassSecret,
    });
    assertOrThrow(managerDenied.status === 403, `drilldown manager denied expected 403, got ${managerDenied.status}`);

    const pageResponse = await apiGetWithRetry({
      baseUrl,
      path: `/platform-admin/notifications-overview/${state.tenantId}`,
      token: '',
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(pageResponse.status === 200, `drilldown UI expected 200, got ${pageResponse.status}`);
    assertOrThrow(
      pageResponse.text.includes('notifications-overview') || pageResponse.text.includes('/platform-admin/notifications-overview/'),
      'drilldown UI route payload missing',
    );

    outcome = {
      ok: true,
      mode: 'blackbox',
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      e2eKey,
      tenantId: state.tenantId,
      checks: {
        apiReachable: true,
        uiLoaded: true,
        tenantReconciliation: true,
        channelFilter: true,
        dailyTrend: true,
        anomalySummary: true,
        unauthorizedDenied: true,
        managerDenied: true,
      },
      metrics: {
        sent: drillSnapshot.sent,
        failed: drillSnapshot.failed,
        deadLetter: drillSnapshot.deadLetter,
        opened: drillSnapshot.opened,
        clicked: drillSnapshot.clicked,
        conversion: drillSnapshot.conversion,
        anomalyTotal: drillSnapshot.anomalySummary.total,
      },
    };
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (state.tenantId) {
      await admin.from('notification_delivery_events').delete().eq('tenant_id', state.tenantId);
      await admin.from('notification_deliveries').delete().eq('tenant_id', state.tenantId);
      await admin.from('audit_logs').delete().eq('tenant_id', state.tenantId);

      const remainDeliveries = await admin
        .from('notification_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainEvents = await admin
        .from('notification_delivery_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainAudit = await admin
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      cleanup.remainingDeliveries = remainDeliveries.count ?? 0;
      cleanup.remainingEvents = remainEvents.count ?? 0;
      cleanup.remainingAudit = remainAudit.count ?? 0;

      const tenantDelete = await admin.from('tenants').delete().eq('id', state.tenantId);
      cleanup.tenantDeleted = !tenantDelete.error;
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
