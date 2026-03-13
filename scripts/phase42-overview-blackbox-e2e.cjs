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

function getAggregationMetadata(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const pick = (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : root[key]);
  const metadata = {
    aggregationModeRequested: pick('aggregationModeRequested'),
    aggregationModeResolved: pick('aggregationModeResolved'),
    dataSource: pick('dataSource'),
    isWholeUtcDayWindow: pick('isWholeUtcDayWindow'),
    rollupEligible: pick('rollupEligible'),
  };
  if (!metadata.aggregationModeRequested || !metadata.aggregationModeResolved || !metadata.dataSource) return null;
  return metadata;
}

function assertAggregationMetadata(payload, expected, label) {
  const metadata = getAggregationMetadata(payload);
  assertOrThrow(Boolean(metadata), `${label} aggregation metadata missing`);
  assertOrThrow(
    metadata.aggregationModeRequested === expected.aggregationModeRequested,
    `${label} aggregationModeRequested expected ${expected.aggregationModeRequested}, got ${metadata.aggregationModeRequested}`,
  );
  assertOrThrow(
    metadata.aggregationModeResolved === expected.aggregationModeResolved,
    `${label} aggregationModeResolved expected ${expected.aggregationModeResolved}, got ${metadata.aggregationModeResolved}`,
  );
  assertOrThrow(metadata.dataSource === expected.dataSource, `${label} dataSource expected ${expected.dataSource}, got ${metadata.dataSource}`);
  assertOrThrow(
    metadata.isWholeUtcDayWindow === expected.isWholeUtcDayWindow,
    `${label} isWholeUtcDayWindow expected ${expected.isWholeUtcDayWindow}, got ${metadata.isWholeUtcDayWindow}`,
  );
  assertOrThrow(
    metadata.rollupEligible === expected.rollupEligible,
    `${label} rollupEligible expected ${expected.rollupEligible}, got ${metadata.rollupEligible}`,
  );
}

function toDateStringUtc(date) {
  return date.toISOString().slice(0, 10);
}

function dayStartIsoUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)).toISOString();
}

function dayEndIsoUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)).toISOString();
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

  const e2eKey = `phase42_overview_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const from = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const rollupDayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const rollupFrom = dayStartIsoUtc(rollupDayDate);
  const rollupTo = dayEndIsoUtc(rollupDayDate);
  const rollupDate = toDateStringUtc(rollupDayDate);
  const adminEmail = `phase42-admin-${Date.now()}@example.test`;
  const managerEmail = `phase42-manager-${Date.now()}@example.test`;
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
    remainingDailyRollups: 0,
    remainingAnomalyRollups: 0,
    remainingAudit: 0,
  };
  let fatalError = null;
  let outcome = null;

  try {
    const tenantInsert = await admin
      .from('tenants')
      .insert({ name: `E2E Phase42 Overview ${e2eKey}`, status: 'active' })
      .select('id')
      .single();
    assertOrThrow(!tenantInsert.error && tenantInsert.data?.id, `tenant insert failed: ${tenantInsert.error?.message || 'unknown'}`);
    state.tenantId = tenantInsert.data.id;

    const adminCreate = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase42_overview_platform_admin' },
    });
    assertOrThrow(!adminCreate.error && adminCreate.data?.user?.id, `admin user create failed: ${adminCreate.error?.message || 'unknown'}`);
    state.adminUserId = adminCreate.data.user.id;

    const managerCreate = await admin.auth.admin.createUser({
      email: managerEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase42_overview_manager' },
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
            display_name: `Phase42 Admin ${e2eKey}`,
            updated_at: new Date().toISOString(),
          },
          {
            id: state.managerUserId,
            role: 'manager',
            tenant_id: state.tenantId,
            branch_id: null,
            is_active: true,
            display_name: `Phase42 Manager ${e2eKey}`,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'id' },
      )
      .select('id');
    assertOrThrow(!profileUpsert.error, `profile upsert failed: ${profileUpsert.error?.message || 'unknown'}`);

    const adminSignIn = await anon.auth.signInWithPassword({ email: adminEmail, password });
    assertOrThrow(!adminSignIn.error, `admin sign-in failed: ${adminSignIn.error?.message || 'unknown'}`);
    const adminToken = adminSignIn.data?.session?.access_token || '';
    assertOrThrow(adminToken.length > 20, 'missing admin access token');

    const managerSignIn = await anon.auth.signInWithPassword({ email: managerEmail, password });
    assertOrThrow(!managerSignIn.error, `manager sign-in failed: ${managerSignIn.error?.message || 'unknown'}`);
    const managerToken = managerSignIn.data?.session?.access_token || '';
    assertOrThrow(managerToken.length > 20, 'missing manager access token');

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
          source_ref_type: 'phase42_e2e',
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
          last_error: 'phase42 dead letter',
          error_message: 'phase42 dead letter',
          dedupe_key: `${e2eKey}:d2`,
          source_ref_type: 'phase42_e2e',
          source_ref_id: 'd2',
          payload: { e2eKey, label: 'd2' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'line',
          status: 'failed',
          attempts: 2,
          retry_count: 1,
          failed_at: now.toISOString(),
          last_error: 'phase42 failed',
          error_message: 'phase42 failed',
          dedupe_key: `${e2eKey}:d3`,
          source_ref_type: 'phase42_e2e',
          source_ref_id: 'd3',
          payload: { e2eKey, label: 'd3' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'email',
          status: 'pending',
          attempts: 0,
          retry_count: 0,
          dedupe_key: `${e2eKey}:d4`,
          source_ref_type: 'phase42_e2e',
          source_ref_id: 'd4',
          payload: { e2eKey, label: 'd4' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'webhook',
          status: 'sent',
          attempts: 1,
          retry_count: 0,
          sent_at: now.toISOString(),
          delivered_at: now.toISOString(),
          dedupe_key: `${e2eKey}:d5`,
          source_ref_type: 'phase42_e2e',
          source_ref_id: 'd5',
          payload: { e2eKey, label: 'd5' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'sms',
          status: 'retrying',
          attempts: 1,
          retry_count: 0,
          next_retry_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
          dedupe_key: `${e2eKey}:d6`,
          source_ref_type: 'phase42_e2e',
          source_ref_id: 'd6',
          payload: { e2eKey, label: 'd6' },
          created_by: state.adminUserId,
        },
      ])
      .select('id, source_ref_id');
    assertOrThrow(!deliveryInsert.error, `delivery insert failed: ${deliveryInsert.error?.message || 'unknown'}`);

    for (const row of deliveryInsert.data || []) {
      state.deliveryIds[row.source_ref_id] = row.id;
    }
    assertOrThrow(state.deliveryIds.d1 && state.deliveryIds.d2 && state.deliveryIds.d5, 'missing seeded delivery ids');

    const eventInsert = await admin.from('notification_delivery_events').insert([
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.d1,
        channel: 'email',
        event_type: 'opened',
        event_at: now.toISOString(),
        provider: 'phase42_provider',
        provider_event_id: `${e2eKey}:open:d1`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.d1,
        channel: 'email',
        event_type: 'clicked',
        event_at: now.toISOString(),
        provider: 'phase42_provider',
        provider_event_id: `${e2eKey}:click:d1`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.d5,
        channel: 'webhook',
        event_type: 'opened',
        event_at: now.toISOString(),
        provider: 'phase42_provider',
        provider_event_id: `${e2eKey}:open:d5`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.d5,
        channel: 'webhook',
        event_type: 'conversion',
        event_at: now.toISOString(),
        provider: 'phase42_provider',
        provider_event_id: `${e2eKey}:conv:d5`,
      },
    ]);
    assertOrThrow(!eventInsert.error, `event insert failed: ${eventInsert.error?.message || 'unknown'}`);

    const rollupAt = new Date(new Date(rollupFrom).getTime() + 8 * 60 * 60 * 1000).toISOString();
    const rollupDeliveries = await admin
      .from('notification_deliveries')
      .insert([
        {
          tenant_id: state.tenantId,
          channel: 'email',
          status: 'sent',
          attempts: 1,
          retry_count: 0,
          created_at: rollupAt,
          sent_at: rollupAt,
          delivered_at: rollupAt,
          dedupe_key: `${e2eKey}:rollup:d1`,
          source_ref_type: 'phase42_e2e_rollup',
          source_ref_id: 'rollup_d1',
          payload: { e2eKey, label: 'rollup_d1' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'sms',
          status: 'dead_letter',
          attempts: 3,
          retry_count: 2,
          created_at: rollupAt,
          failed_at: rollupAt,
          dead_letter_at: rollupAt,
          last_error: 'phase42 rollup dead letter',
          error_message: 'phase42 rollup dead letter',
          dedupe_key: `${e2eKey}:rollup:d2`,
          source_ref_type: 'phase42_e2e_rollup',
          source_ref_id: 'rollup_d2',
          payload: { e2eKey, label: 'rollup_d2' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'line',
          status: 'failed',
          attempts: 2,
          retry_count: 1,
          created_at: rollupAt,
          failed_at: rollupAt,
          last_error: 'phase42 rollup failed',
          error_message: 'phase42 rollup failed',
          dedupe_key: `${e2eKey}:rollup:d3`,
          source_ref_type: 'phase42_e2e_rollup',
          source_ref_id: 'rollup_d3',
          payload: { e2eKey, label: 'rollup_d3' },
          created_by: state.adminUserId,
        },
      ])
      .select('id, source_ref_id');
    assertOrThrow(!rollupDeliveries.error, `rollup delivery insert failed: ${rollupDeliveries.error?.message || 'unknown'}`);

    for (const row of rollupDeliveries.data || []) {
      state.deliveryIds[row.source_ref_id] = row.id;
    }
    assertOrThrow(state.deliveryIds.rollup_d1 && state.deliveryIds.rollup_d2, 'missing rollup delivery ids');

    const rollupEvents = await admin.from('notification_delivery_events').insert([
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.rollup_d1,
        channel: 'email',
        event_type: 'opened',
        event_at: rollupAt,
        provider: 'phase42_provider',
        provider_event_id: `${e2eKey}:rollup:opened`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.rollup_d1,
        channel: 'email',
        event_type: 'clicked',
        event_at: rollupAt,
        provider: 'phase42_provider',
        provider_event_id: `${e2eKey}:rollup:clicked`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.rollup_d1,
        channel: 'email',
        event_type: 'conversion',
        event_at: rollupAt,
        provider: 'phase42_provider',
        provider_event_id: `${e2eKey}:rollup:conversion`,
      },
    ]);
    assertOrThrow(!rollupEvents.error, `rollup event insert failed: ${rollupEvents.error?.message || 'unknown'}`);

    const overviewPath = `/api/platform/notifications/overview?tenantId=${state.tenantId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2000&aggregationMode=auto`;
    const overview = await apiGetWithRetry({
      baseUrl,
      path: overviewPath,
      token: adminToken,
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(
      overview.status === 200,
      `overview expected 200, got ${overview.status}: ${pickMessage(overview.json, overview.text)}`,
    );

    const snapshot = getSnapshot(overview.json);
    assertOrThrow(snapshot, 'overview snapshot missing');
    assertOrThrow(snapshot.dataSource === 'raw', `overview auto(non-day) expected raw source, got ${snapshot.dataSource}`);
    assertAggregationMetadata(
      overview.json,
      {
        aggregationModeRequested: 'auto',
        aggregationModeResolved: 'raw',
        dataSource: 'raw',
        isWholeUtcDayWindow: false,
        rollupEligible: false,
      },
      'overview auto(non-day)',
    );
    assertOrThrow(snapshot.totalRows === 6, `overview totalRows expected 6, got ${snapshot.totalRows}`);
    assertOrThrow(snapshot.sent === 2, `overview sent expected 2, got ${snapshot.sent}`);
    assertOrThrow(snapshot.failed === 2, `overview failed expected 2, got ${snapshot.failed}`);
    assertOrThrow(snapshot.deadLetter === 1, `overview deadLetter expected 1, got ${snapshot.deadLetter}`);
    assertOrThrow(snapshot.pending === 1, `overview pending expected 1, got ${snapshot.pending}`);
    assertOrThrow(snapshot.retrying === 1, `overview retrying expected 1, got ${snapshot.retrying}`);
    assertOrThrow(snapshot.opened === 2, `overview opened expected 2, got ${snapshot.opened}`);
    assertOrThrow(snapshot.clicked === 1, `overview clicked expected 1, got ${snapshot.clicked}`);
    assertOrThrow(snapshot.conversion === 1, `overview conversion expected 1, got ${snapshot.conversion}`);
    assertOrThrow(snapshot.successRate === 50, `overview successRate expected 50, got ${snapshot.successRate}`);
    assertOrThrow(snapshot.failRate === 50, `overview failRate expected 50, got ${snapshot.failRate}`);
    assertOrThrow(snapshot.openRate === 100, `overview openRate expected 100, got ${snapshot.openRate}`);

    const emailOnly = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `${overviewPath}&channel=email`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      emailOnly.status === 200,
      `overview channel=email expected 200, got ${emailOnly.status}: ${pickMessage(emailOnly.json, emailOnly.text)}`,
    );
    const emailSnapshot = getSnapshot(emailOnly.json);
    assertOrThrow(emailSnapshot, 'email filtered overview snapshot missing');
    assertOrThrow(emailSnapshot.totalRows === 2, `overview email totalRows expected 2, got ${emailSnapshot.totalRows}`);
    assertOrThrow(emailSnapshot.sent === 1, `overview email sent expected 1, got ${emailSnapshot.sent}`);
    assertOrThrow(emailSnapshot.opened === 1, `overview email opened expected 1, got ${emailSnapshot.opened}`);
    assertOrThrow(emailSnapshot.clicked === 1, `overview email clicked expected 1, got ${emailSnapshot.clicked}`);
    assertOrThrow(emailSnapshot.conversion === 0, `overview email conversion expected 0, got ${emailSnapshot.conversion}`);

    const analytics = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/analytics?tenantId=${state.tenantId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2000`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      analytics.status === 200,
      `analytics expected 200, got ${analytics.status}: ${pickMessage(analytics.json, analytics.text)}`,
    );
    const analyticsSnapshot = getSnapshot(analytics.json);
    assertOrThrow(analyticsSnapshot, 'analytics snapshot missing');
    assertAggregationMetadata(
      analytics.json,
      {
        aggregationModeRequested: 'auto',
        aggregationModeResolved: 'raw',
        dataSource: 'raw',
        isWholeUtcDayWindow: false,
        rollupEligible: false,
      },
      'analytics auto(non-day)',
    );
    assertOrThrow(
      analyticsSnapshot.sent === snapshot.sent &&
        analyticsSnapshot.failed === snapshot.failed &&
        analyticsSnapshot.deadLetter === snapshot.deadLetter,
      'overview and analytics core counters mismatch',
    );

    const trendsNonDay = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/trends?tenantId=${state.tenantId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(
        to,
      )}&limit=2000&topLimit=8&aggregationMode=auto`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      trendsNonDay.status === 200,
      `trends auto(non-day) expected 200, got ${trendsNonDay.status}: ${pickMessage(trendsNonDay.json, trendsNonDay.text)}`,
    );
    const trendsNonDaySnapshot = getSnapshot(trendsNonDay.json);
    assertOrThrow(trendsNonDaySnapshot, 'trends auto(non-day) snapshot missing');
    assertOrThrow(
      trendsNonDaySnapshot.dataSource === 'raw',
      `trends auto(non-day) expected raw source, got ${trendsNonDaySnapshot.dataSource}`,
    );
    assertAggregationMetadata(
      trendsNonDay.json,
      {
        aggregationModeRequested: 'auto',
        aggregationModeResolved: 'raw',
        dataSource: 'raw',
        isWholeUtcDayWindow: false,
        rollupEligible: false,
      },
      'trends auto(non-day)',
    );

    const drilldownNonDay = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/overview/tenants/${state.tenantId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
        to,
      )}&limit=2000&anomalyLimit=40&aggregationMode=auto`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      drilldownNonDay.status === 200,
      `drilldown auto(non-day) expected 200, got ${drilldownNonDay.status}: ${pickMessage(drilldownNonDay.json, drilldownNonDay.text)}`,
    );
    const drilldownNonDaySnapshot = getSnapshot(drilldownNonDay.json);
    assertOrThrow(drilldownNonDaySnapshot, 'drilldown auto(non-day) snapshot missing');
    assertOrThrow(
      drilldownNonDaySnapshot.dataSource === 'raw',
      `drilldown auto(non-day) expected raw source, got ${drilldownNonDaySnapshot.dataSource}`,
    );
    assertAggregationMetadata(
      drilldownNonDay.json,
      {
        aggregationModeRequested: 'auto',
        aggregationModeResolved: 'raw',
        dataSource: 'raw',
        isWholeUtcDayWindow: false,
        rollupEligible: false,
      },
      'drilldown auto(non-day)',
    );

    const refreshUnauthorized = await apiRequest({
      method: 'POST',
      baseUrl,
      path: '/api/platform/notifications/rollups/refresh',
      token: '',
      bypassSecret,
      body: { mode: 'rebuild', fromDate: rollupDate, toDate: rollupDate, tenantId: state.tenantId },
    });
    assertOrThrow(refreshUnauthorized.status === 401, `rollup refresh unauthorized expected 401, got ${refreshUnauthorized.status}`);

    const refreshManagerDenied = await apiRequest({
      method: 'POST',
      baseUrl,
      path: '/api/platform/notifications/rollups/refresh',
      token: managerToken,
      bypassSecret,
      body: { mode: 'rebuild', fromDate: rollupDate, toDate: rollupDate, tenantId: state.tenantId },
    });
    assertOrThrow(refreshManagerDenied.status === 403, `rollup refresh manager denied expected 403, got ${refreshManagerDenied.status}`);

    const refreshRebuild = await apiRequest({
      method: 'POST',
      baseUrl,
      path: '/api/platform/notifications/rollups/refresh',
      token: adminToken,
      bypassSecret,
      body: { mode: 'rebuild', fromDate: rollupDate, toDate: rollupDate, tenantId: state.tenantId },
    });
    assertOrThrow(
      refreshRebuild.status === 200,
      `rollup refresh rebuild expected 200, got ${refreshRebuild.status}: ${pickMessage(refreshRebuild.json, refreshRebuild.text)}`,
    );

    const rollupBasePath = `/api/platform/notifications/overview?tenantId=${state.tenantId}&from=${encodeURIComponent(
      rollupFrom,
    )}&to=${encodeURIComponent(rollupTo)}&limit=2000`;
    const overviewRollup = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `${rollupBasePath}&aggregationMode=rollup`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      overviewRollup.status === 200,
      `overview rollup expected 200, got ${overviewRollup.status}: ${pickMessage(overviewRollup.json, overviewRollup.text)}`,
    );
    const rollupSnapshot = getSnapshot(overviewRollup.json);
    assertOrThrow(rollupSnapshot, 'overview rollup snapshot missing');
    assertOrThrow(rollupSnapshot.dataSource === 'rollup', `overview rollup dataSource expected rollup, got ${rollupSnapshot.dataSource}`);
    assertAggregationMetadata(
      overviewRollup.json,
      {
        aggregationModeRequested: 'rollup',
        aggregationModeResolved: 'rollup',
        dataSource: 'rollup',
        isWholeUtcDayWindow: true,
        rollupEligible: true,
      },
      'overview rollup',
    );

    const overviewRaw = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `${rollupBasePath}&aggregationMode=raw`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      overviewRaw.status === 200,
      `overview raw expected 200, got ${overviewRaw.status}: ${pickMessage(overviewRaw.json, overviewRaw.text)}`,
    );
    const rawSnapshot = getSnapshot(overviewRaw.json);
    assertOrThrow(rawSnapshot, 'overview raw snapshot missing');
    assertOrThrow(rawSnapshot.dataSource === 'raw', `overview raw dataSource expected raw, got ${rawSnapshot.dataSource}`);
    assertAggregationMetadata(
      overviewRaw.json,
      {
        aggregationModeRequested: 'raw',
        aggregationModeResolved: 'raw',
        dataSource: 'raw',
        isWholeUtcDayWindow: true,
        rollupEligible: true,
      },
      'overview raw',
    );

    const comparedKeys = ['sent', 'failed', 'deadLetter', 'opened', 'clicked', 'conversion'];
    for (const key of comparedKeys) {
      assertOrThrow(
        Number(rollupSnapshot[key] || 0) === Number(rawSnapshot[key] || 0),
        `overview rollup/raw mismatch on ${key}: rollup=${rollupSnapshot[key]} raw=${rawSnapshot[key]}`,
      );
    }

    const overviewAutoRollup = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `${rollupBasePath}&aggregationMode=auto`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      overviewAutoRollup.status === 200,
      `overview auto(whole-day) expected 200, got ${overviewAutoRollup.status}: ${pickMessage(overviewAutoRollup.json, overviewAutoRollup.text)}`,
    );
    const autoRollupSnapshot = getSnapshot(overviewAutoRollup.json);
    assertOrThrow(autoRollupSnapshot, 'overview auto(whole-day) snapshot missing');
    assertOrThrow(
      autoRollupSnapshot.dataSource === 'rollup',
      `overview auto(whole-day) expected rollup source, got ${autoRollupSnapshot.dataSource}`,
    );
    assertAggregationMetadata(
      overviewAutoRollup.json,
      {
        aggregationModeRequested: 'auto',
        aggregationModeResolved: 'rollup',
        dataSource: 'rollup',
        isWholeUtcDayWindow: true,
        rollupEligible: true,
      },
      'overview auto(whole-day)',
    );

    const analyticsAutoWholeDay = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/analytics?tenantId=${state.tenantId}&from=${encodeURIComponent(
        rollupFrom,
      )}&to=${encodeURIComponent(rollupTo)}&limit=2000&aggregationMode=auto`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      analyticsAutoWholeDay.status === 200,
      `analytics auto(whole-day) expected 200, got ${analyticsAutoWholeDay.status}: ${pickMessage(
        analyticsAutoWholeDay.json,
        analyticsAutoWholeDay.text,
      )}`,
    );
    const analyticsAutoWholeDaySnapshot = getSnapshot(analyticsAutoWholeDay.json);
    assertOrThrow(analyticsAutoWholeDaySnapshot, 'analytics auto(whole-day) snapshot missing');
    assertOrThrow(
      analyticsAutoWholeDaySnapshot.dataSource === 'rollup',
      `analytics auto(whole-day) expected rollup source, got ${analyticsAutoWholeDaySnapshot.dataSource}`,
    );
    assertAggregationMetadata(
      analyticsAutoWholeDay.json,
      {
        aggregationModeRequested: 'auto',
        aggregationModeResolved: 'rollup',
        dataSource: 'rollup',
        isWholeUtcDayWindow: true,
        rollupEligible: true,
      },
      'analytics auto(whole-day)',
    );

    const trendsAutoWholeDay = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/trends?tenantId=${state.tenantId}&from=${encodeURIComponent(
        rollupFrom,
      )}&to=${encodeURIComponent(rollupTo)}&limit=2000&topLimit=8&aggregationMode=auto`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      trendsAutoWholeDay.status === 200,
      `trends auto(whole-day) expected 200, got ${trendsAutoWholeDay.status}: ${pickMessage(trendsAutoWholeDay.json, trendsAutoWholeDay.text)}`,
    );
    const trendsAutoWholeDaySnapshot = getSnapshot(trendsAutoWholeDay.json);
    assertOrThrow(trendsAutoWholeDaySnapshot, 'trends auto(whole-day) snapshot missing');
    assertOrThrow(
      trendsAutoWholeDaySnapshot.dataSource === 'rollup',
      `trends auto(whole-day) expected rollup source, got ${trendsAutoWholeDaySnapshot.dataSource}`,
    );
    assertAggregationMetadata(
      trendsAutoWholeDay.json,
      {
        aggregationModeRequested: 'auto',
        aggregationModeResolved: 'rollup',
        dataSource: 'rollup',
        isWholeUtcDayWindow: true,
        rollupEligible: true,
      },
      'trends auto(whole-day)',
    );

    const drilldownAutoWholeDay = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/overview/tenants/${state.tenantId}?from=${encodeURIComponent(
        rollupFrom,
      )}&to=${encodeURIComponent(rollupTo)}&limit=2000&anomalyLimit=40&aggregationMode=auto`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      drilldownAutoWholeDay.status === 200,
      `drilldown auto(whole-day) expected 200, got ${drilldownAutoWholeDay.status}: ${pickMessage(
        drilldownAutoWholeDay.json,
        drilldownAutoWholeDay.text,
      )}`,
    );
    const drilldownAutoWholeDaySnapshot = getSnapshot(drilldownAutoWholeDay.json);
    assertOrThrow(drilldownAutoWholeDaySnapshot, 'drilldown auto(whole-day) snapshot missing');
    assertOrThrow(
      drilldownAutoWholeDaySnapshot.dataSource === 'rollup',
      `drilldown auto(whole-day) expected rollup source, got ${drilldownAutoWholeDaySnapshot.dataSource}`,
    );
    assertAggregationMetadata(
      drilldownAutoWholeDay.json,
      {
        aggregationModeRequested: 'auto',
        aggregationModeResolved: 'rollup',
        dataSource: 'rollup',
        isWholeUtcDayWindow: true,
        rollupEligible: true,
      },
      'drilldown auto(whole-day)',
    );

    const unauthorized = await apiRequest({
      method: 'GET',
      baseUrl,
      path: overviewPath,
      token: '',
      bypassSecret,
    });
    assertOrThrow(unauthorized.status === 401, `overview unauthorized expected 401, got ${unauthorized.status}`);

    const managerDenied = await apiRequest({
      method: 'GET',
      baseUrl,
      path: overviewPath,
      token: managerToken,
      bypassSecret,
    });
    assertOrThrow(managerDenied.status === 403, `overview manager denied expected 403, got ${managerDenied.status}`);

    const pageResponse = await apiGetWithRetry({
      baseUrl,
      path: '/platform-admin/notifications-overview',
      token: '',
      bypassSecret,
      retries: 20,
      delayMs: 15000,
    });
    assertOrThrow(pageResponse.status === 200, `overview UI page expected 200, got ${pageResponse.status}`);
    assertOrThrow(
      pageResponse.text.includes('notifications-overview') || pageResponse.text.includes('/platform-admin/notifications-overview'),
      'overview UI route payload missing',
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
        channelFilter: true,
        tenantFilter: true,
        aggregateConsistency: true,
        aggregationMetadataContract: true,
        autoNonDayFallbackRaw: true,
        autoWholeDayUsesRollup: true,
        allReadApisAligned: true,
        rawRollupReconciled: true,
        rollupRefreshRebuild: true,
        unauthorizedDenied: true,
        managerDenied: true,
      },
      metrics: {
        totalRows: snapshot.totalRows,
        sent: snapshot.sent,
        failed: snapshot.failed,
        deadLetter: snapshot.deadLetter,
        opened: snapshot.opened,
        clicked: snapshot.clicked,
        conversion: snapshot.conversion,
      },
    };
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (state.tenantId) {
      await admin.from('notification_delivery_events').delete().eq('tenant_id', state.tenantId);
      await admin.from('notification_deliveries').delete().eq('tenant_id', state.tenantId);
      await admin.from('notification_delivery_anomaly_daily_rollups').delete().eq('tenant_id', state.tenantId);
      await admin.from('notification_delivery_daily_rollups').delete().eq('tenant_id', state.tenantId);
      await admin.from('audit_logs').delete().eq('tenant_id', state.tenantId);

      const remainDeliveries = await admin
        .from('notification_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainEvents = await admin
        .from('notification_delivery_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainDailyRollups = await admin
        .from('notification_delivery_daily_rollups')
        .select('day', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainAnomalyRollups = await admin
        .from('notification_delivery_anomaly_daily_rollups')
        .select('day', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainAudit = await admin
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      cleanup.remainingDeliveries = remainDeliveries.count ?? 0;
      cleanup.remainingEvents = remainEvents.count ?? 0;
      cleanup.remainingDailyRollups = remainDailyRollups.count ?? 0;
      cleanup.remainingAnomalyRollups = remainAnomalyRollups.count ?? 0;
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
