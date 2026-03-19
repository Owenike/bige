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

function getSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.snapshot && typeof payload.snapshot === 'object') return payload.snapshot;
  if (payload.data && payload.data.snapshot && typeof payload.data.snapshot === 'object') return payload.data.snapshot;
  return null;
}

function dayStartIsoUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)).toISOString();
}

function dayEndIsoUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)).toISOString();
}

function toDateStringUtc(date) {
  return date.toISOString().slice(0, 10);
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
      process.env.PHASE42_ANALYTICS_BASE_URL ||
      process.env.PHASE42_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      '',
  );
  const bypassSecret = String(
    readArg('--bypass-secret') ||
      process.env.PHASE42_ANALYTICS_VERCEL_BYPASS_SECRET ||
      process.env.PHASE42_VERCEL_BYPASS_SECRET ||
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      '',
  ).trim();

  assertOrThrow(baseUrl.startsWith('http://') || baseUrl.startsWith('https://'), `Invalid base URL: ${baseUrl}`);
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((name) => !(process.env[name] || '').trim());
  assertOrThrow(missing.length === 0, `Missing env: ${missing.join(', ')}`);

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const e2eKey = `phase42_analytics_rollup_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const adminEmail = `phase42-analytics-admin-${Date.now()}@example.test`;
  const managerEmail = `phase42-analytics-manager-${Date.now()}@example.test`;
  const password = `Phase42!${crypto.randomBytes(6).toString('hex')}`;

  const now = new Date();
  const rawFrom = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const rawTo = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const rollupDayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const rollupFrom = dayStartIsoUtc(rollupDayDate);
  const rollupTo = dayEndIsoUtc(rollupDayDate);
  const rollupDate = toDateStringUtc(rollupDayDate);
  const rollupCreatedAt = new Date(new Date(rollupFrom).getTime() + 9 * 60 * 60 * 1000).toISOString();

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
      .insert({ name: `E2E Phase42 Analytics Rollup ${e2eKey}`, status: 'active' })
      .select('id')
      .single();
    assertOrThrow(!tenantInsert.error && tenantInsert.data?.id, `tenant insert failed: ${tenantInsert.error?.message || 'unknown'}`);
    state.tenantId = tenantInsert.data.id;

    const adminCreate = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase42_analytics_rollup_admin' },
    });
    assertOrThrow(!adminCreate.error && adminCreate.data?.user?.id, `admin user create failed: ${adminCreate.error?.message || 'unknown'}`);
    state.adminUserId = adminCreate.data.user.id;

    const managerCreate = await admin.auth.admin.createUser({
      email: managerEmail,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase42_analytics_rollup_manager' },
    });
    assertOrThrow(!managerCreate.error && managerCreate.data?.user?.id, `manager user create failed: ${managerCreate.error?.message || 'unknown'}`);
    state.managerUserId = managerCreate.data.user.id;

    const profileUpsert = await admin.from('profiles').upsert(
      [
        {
          id: state.adminUserId,
          role: 'platform_admin',
          tenant_id: null,
          branch_id: null,
          is_active: true,
          display_name: `Phase42 Analytics Admin ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
        {
          id: state.managerUserId,
          role: 'manager',
          tenant_id: state.tenantId,
          branch_id: null,
          is_active: true,
          display_name: `Phase42 Analytics Manager ${e2eKey}`,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: 'id' },
    );
    assertOrThrow(!profileUpsert.error, `profile upsert failed: ${profileUpsert.error?.message || 'unknown'}`);

    const adminSignIn = await anon.auth.signInWithPassword({ email: adminEmail, password });
    assertOrThrow(!adminSignIn.error, `admin sign-in failed: ${adminSignIn.error?.message || 'unknown'}`);
    const adminToken = adminSignIn.data?.session?.access_token || '';
    assertOrThrow(adminToken.length > 20, 'missing admin access token');

    const managerSignIn = await anon.auth.signInWithPassword({ email: managerEmail, password });
    assertOrThrow(!managerSignIn.error, `manager sign-in failed: ${managerSignIn.error?.message || 'unknown'}`);
    const managerToken = managerSignIn.data?.session?.access_token || '';
    assertOrThrow(managerToken.length > 20, 'missing manager access token');

    const seededDeliveries = await admin
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
          dedupe_key: `${e2eKey}:raw:d1`,
          source_ref_type: 'phase42_analytics_e2e',
          source_ref_id: 'raw_d1',
          payload: { e2eKey, scope: 'raw' },
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
          dedupe_key: `${e2eKey}:raw:d2`,
          source_ref_type: 'phase42_analytics_e2e',
          source_ref_id: 'raw_d2',
          payload: { e2eKey, scope: 'raw' },
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
          error_code: 'PHASE42_ANALYTICS_DL',
          error_message: 'phase42 analytics dead letter',
          last_error: 'phase42 analytics dead letter',
          dedupe_key: `${e2eKey}:raw:d3`,
          source_ref_type: 'phase42_analytics_e2e',
          source_ref_id: 'raw_d3',
          payload: { e2eKey, scope: 'raw' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'line',
          status: 'failed',
          attempts: 2,
          retry_count: 1,
          failed_at: now.toISOString(),
          error_code: 'PHASE42_ANALYTICS_FAILED',
          error_message: 'phase42 analytics failed',
          last_error: 'phase42 analytics failed',
          dedupe_key: `${e2eKey}:raw:d4`,
          source_ref_type: 'phase42_analytics_e2e',
          source_ref_id: 'raw_d4',
          payload: { e2eKey, scope: 'raw' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'email',
          status: 'pending',
          attempts: 0,
          retry_count: 0,
          dedupe_key: `${e2eKey}:raw:d5`,
          source_ref_type: 'phase42_analytics_e2e',
          source_ref_id: 'raw_d5',
          payload: { e2eKey, scope: 'raw' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'sms',
          status: 'retrying',
          attempts: 1,
          retry_count: 0,
          next_retry_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
          dedupe_key: `${e2eKey}:raw:d6`,
          source_ref_type: 'phase42_analytics_e2e',
          source_ref_id: 'raw_d6',
          payload: { e2eKey, scope: 'raw' },
          created_by: state.adminUserId,
        },
      ])
      .select('id, source_ref_id');
    assertOrThrow(!seededDeliveries.error, `raw delivery insert failed: ${seededDeliveries.error?.message || 'unknown'}`);
    for (const row of seededDeliveries.data || []) state.deliveryIds[row.source_ref_id] = row.id;
    assertOrThrow(state.deliveryIds.raw_d1 && state.deliveryIds.raw_d2, 'missing raw delivery ids');

    const rawEventInsert = await admin.from('notification_delivery_events').insert([
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.raw_d1,
        channel: 'email',
        event_type: 'opened',
        event_at: now.toISOString(),
        provider: 'phase42_analytics',
        provider_event_id: `${e2eKey}:raw:open:d1`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.raw_d1,
        channel: 'email',
        event_type: 'clicked',
        event_at: now.toISOString(),
        provider: 'phase42_analytics',
        provider_event_id: `${e2eKey}:raw:click:d1`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.raw_d2,
        channel: 'webhook',
        event_type: 'opened',
        event_at: now.toISOString(),
        provider: 'phase42_analytics',
        provider_event_id: `${e2eKey}:raw:open:d2`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.raw_d2,
        channel: 'webhook',
        event_type: 'conversion',
        event_at: now.toISOString(),
        provider: 'phase42_analytics',
        provider_event_id: `${e2eKey}:raw:conversion:d2`,
      },
    ]);
    assertOrThrow(!rawEventInsert.error, `raw event insert failed: ${rawEventInsert.error?.message || 'unknown'}`);

    const analyticsNonDayAuto = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/analytics?tenantId=${state.tenantId}&from=${encodeURIComponent(rawFrom)}&to=${encodeURIComponent(
        rawTo,
      )}&limit=4000&aggregationMode=auto`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      analyticsNonDayAuto.status === 200,
      `analytics auto(non-day) expected 200, got ${analyticsNonDayAuto.status}: ${pickMessage(analyticsNonDayAuto.json, analyticsNonDayAuto.text)}`,
    );
    const nonDaySnapshot = getSnapshot(analyticsNonDayAuto.json);
    assertOrThrow(nonDaySnapshot, 'analytics auto(non-day) snapshot missing');
    assertOrThrow(nonDaySnapshot.dataSource === 'raw', `analytics auto(non-day) expected raw source, got ${nonDaySnapshot.dataSource}`);
    assertOrThrow(nonDaySnapshot.sent === 2, `analytics auto(non-day) sent expected 2, got ${nonDaySnapshot.sent}`);
    assertOrThrow(nonDaySnapshot.failed === 2, `analytics auto(non-day) failed expected 2, got ${nonDaySnapshot.failed}`);
    assertOrThrow(nonDaySnapshot.deadLetter === 1, `analytics auto(non-day) deadLetter expected 1, got ${nonDaySnapshot.deadLetter}`);
    assertOrThrow(nonDaySnapshot.pending === 1, `analytics auto(non-day) pending expected 1, got ${nonDaySnapshot.pending}`);
    assertOrThrow(nonDaySnapshot.retrying === 1, `analytics auto(non-day) retrying expected 1, got ${nonDaySnapshot.retrying}`);
    assertOrThrow(nonDaySnapshot.opened === 2, `analytics auto(non-day) opened expected 2, got ${nonDaySnapshot.opened}`);
    assertOrThrow(nonDaySnapshot.clicked === 1, `analytics auto(non-day) clicked expected 1, got ${nonDaySnapshot.clicked}`);
    assertOrThrow(nonDaySnapshot.conversion === 1, `analytics auto(non-day) conversion expected 1, got ${nonDaySnapshot.conversion}`);

    const analyticsUnauthorized = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/analytics?tenantId=${state.tenantId}&from=${encodeURIComponent(rawFrom)}&to=${encodeURIComponent(rawTo)}`,
      token: '',
      bypassSecret,
    });
    assertOrThrow(analyticsUnauthorized.status === 401, `analytics unauthorized expected 401, got ${analyticsUnauthorized.status}`);

    const analyticsManagerDenied = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/analytics?tenantId=${state.tenantId}&from=${encodeURIComponent(rawFrom)}&to=${encodeURIComponent(rawTo)}`,
      token: managerToken,
      bypassSecret,
    });
    assertOrThrow(analyticsManagerDenied.status === 403, `analytics manager denied expected 403, got ${analyticsManagerDenied.status}`);

    const rollupDeliveries = await admin
      .from('notification_deliveries')
      .insert([
        {
          tenant_id: state.tenantId,
          channel: 'email',
          status: 'sent',
          attempts: 1,
          retry_count: 0,
          created_at: rollupCreatedAt,
          sent_at: rollupCreatedAt,
          delivered_at: rollupCreatedAt,
          dedupe_key: `${e2eKey}:rollup:d1`,
          source_ref_type: 'phase42_analytics_e2e_rollup',
          source_ref_id: 'rollup_d1',
          payload: { e2eKey, scope: 'rollup' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'webhook',
          status: 'sent',
          attempts: 1,
          retry_count: 0,
          created_at: rollupCreatedAt,
          sent_at: rollupCreatedAt,
          delivered_at: rollupCreatedAt,
          dedupe_key: `${e2eKey}:rollup:d2`,
          source_ref_type: 'phase42_analytics_e2e_rollup',
          source_ref_id: 'rollup_d2',
          payload: { e2eKey, scope: 'rollup' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'sms',
          status: 'dead_letter',
          attempts: 3,
          retry_count: 2,
          created_at: rollupCreatedAt,
          failed_at: rollupCreatedAt,
          dead_letter_at: rollupCreatedAt,
          dedupe_key: `${e2eKey}:rollup:d3`,
          source_ref_type: 'phase42_analytics_e2e_rollup',
          source_ref_id: 'rollup_d3',
          payload: { e2eKey, scope: 'rollup' },
          created_by: state.adminUserId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'line',
          status: 'failed',
          attempts: 2,
          retry_count: 1,
          created_at: rollupCreatedAt,
          failed_at: rollupCreatedAt,
          dedupe_key: `${e2eKey}:rollup:d4`,
          source_ref_type: 'phase42_analytics_e2e_rollup',
          source_ref_id: 'rollup_d4',
          payload: { e2eKey, scope: 'rollup' },
          created_by: state.adminUserId,
        },
      ])
      .select('id, source_ref_id');
    assertOrThrow(!rollupDeliveries.error, `rollup delivery insert failed: ${rollupDeliveries.error?.message || 'unknown'}`);
    for (const row of rollupDeliveries.data || []) state.deliveryIds[row.source_ref_id] = row.id;
    assertOrThrow(state.deliveryIds.rollup_d1 && state.deliveryIds.rollup_d2, 'missing rollup delivery ids');

    const rollupEventInsert = await admin.from('notification_delivery_events').insert([
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.rollup_d1,
        channel: 'email',
        event_type: 'opened',
        event_at: rollupCreatedAt,
        provider: 'phase42_analytics',
        provider_event_id: `${e2eKey}:rollup:opened`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.rollup_d1,
        channel: 'email',
        event_type: 'clicked',
        event_at: rollupCreatedAt,
        provider: 'phase42_analytics',
        provider_event_id: `${e2eKey}:rollup:clicked`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.rollup_d2,
        channel: 'webhook',
        event_type: 'conversion',
        event_at: rollupCreatedAt,
        provider: 'phase42_analytics',
        provider_event_id: `${e2eKey}:rollup:conversion`,
      },
      {
        tenant_id: state.tenantId,
        delivery_id: state.deliveryIds.rollup_d2,
        channel: 'webhook',
        event_type: 'opened',
        event_at: rollupCreatedAt,
        provider: 'phase42_analytics',
        provider_event_id: `${e2eKey}:rollup:opened:2`,
      },
    ]);
    assertOrThrow(!rollupEventInsert.error, `rollup event insert failed: ${rollupEventInsert.error?.message || 'unknown'}`);

    const refreshRebuild = await apiRequest({
      method: 'POST',
      baseUrl,
      path: '/api/platform/notifications/rollups/refresh',
      token: adminToken,
      bypassSecret,
      body: {
        mode: 'rebuild',
        fromDate: rollupDate,
        toDate: rollupDate,
        tenantId: state.tenantId,
      },
    });
    assertOrThrow(
      refreshRebuild.status === 200,
      `rollup refresh rebuild expected 200, got ${refreshRebuild.status}: ${pickMessage(refreshRebuild.json, refreshRebuild.text)}`,
    );

    const rollupPath = `/api/platform/notifications/analytics?tenantId=${state.tenantId}&from=${encodeURIComponent(
      rollupFrom,
    )}&to=${encodeURIComponent(rollupTo)}&limit=4000`;

    const analyticsRollup = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `${rollupPath}&aggregationMode=rollup`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      analyticsRollup.status === 200,
      `analytics rollup expected 200, got ${analyticsRollup.status}: ${pickMessage(analyticsRollup.json, analyticsRollup.text)}`,
    );
    const rollupSnapshot = getSnapshot(analyticsRollup.json);
    assertOrThrow(rollupSnapshot, 'analytics rollup snapshot missing');
    assertOrThrow(rollupSnapshot.dataSource === 'rollup', `analytics rollup expected rollup source, got ${rollupSnapshot.dataSource}`);

    const analyticsRaw = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `${rollupPath}&aggregationMode=raw`,
      token: adminToken,
      bypassSecret,
    });
    assertOrThrow(
      analyticsRaw.status === 200,
      `analytics raw expected 200, got ${analyticsRaw.status}: ${pickMessage(analyticsRaw.json, analyticsRaw.text)}`,
    );
    const rawSnapshot = getSnapshot(analyticsRaw.json);
    assertOrThrow(rawSnapshot, 'analytics raw snapshot missing');
    assertOrThrow(rawSnapshot.dataSource === 'raw', `analytics raw expected raw source, got ${rawSnapshot.dataSource}`);

    const reconcileKeys = ['sent', 'failed', 'deadLetter', 'opened', 'clicked', 'conversion', 'pending', 'retrying'];
    for (const key of reconcileKeys) {
      assertOrThrow(
        Number(rollupSnapshot[key] || 0) === Number(rawSnapshot[key] || 0),
        `analytics rollup/raw mismatch on ${key}: rollup=${rollupSnapshot[key]} raw=${rawSnapshot[key]}`,
      );
    }
    assertOrThrow(
      Number(rollupSnapshot.successRate || 0) === Number(rawSnapshot.successRate || 0),
      `analytics rollup/raw mismatch on successRate: rollup=${rollupSnapshot.successRate} raw=${rawSnapshot.successRate}`,
    );
    assertOrThrow(
      Number(rollupSnapshot.failRate || 0) === Number(rawSnapshot.failRate || 0),
      `analytics rollup/raw mismatch on failRate: rollup=${rollupSnapshot.failRate} raw=${rawSnapshot.failRate}`,
    );
    assertOrThrow(
      Number(rollupSnapshot.openRate || 0) === Number(rawSnapshot.openRate || 0),
      `analytics rollup/raw mismatch on openRate: rollup=${rollupSnapshot.openRate} raw=${rawSnapshot.openRate}`,
    );
    assertOrThrow(
      Number(rollupSnapshot.clickRate || 0) === Number(rawSnapshot.clickRate || 0),
      `analytics rollup/raw mismatch on clickRate: rollup=${rollupSnapshot.clickRate} raw=${rawSnapshot.clickRate}`,
    );
    assertOrThrow(
      Number(rollupSnapshot.conversionRate || 0) === Number(rawSnapshot.conversionRate || 0),
      `analytics rollup/raw mismatch on conversionRate: rollup=${rollupSnapshot.conversionRate} raw=${rawSnapshot.conversionRate}`,
    );

    const analyticsAutoWholeDay = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `${rollupPath}&aggregationMode=auto`,
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
    const autoWholeDaySnapshot = getSnapshot(analyticsAutoWholeDay.json);
    assertOrThrow(autoWholeDaySnapshot, 'analytics auto(whole-day) snapshot missing');
    assertOrThrow(
      autoWholeDaySnapshot.dataSource === 'rollup',
      `analytics auto(whole-day) expected rollup source, got ${autoWholeDaySnapshot.dataSource}`,
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
        unauthorizedDenied: true,
        managerDenied: true,
        autoNonDayFallbackRaw: true,
        autoWholeDayUsesRollup: true,
        rawRollupReconciled: true,
        refreshRebuild: true,
      },
      metrics: {
        sent: rollupSnapshot.sent,
        failed: rollupSnapshot.failed,
        deadLetter: rollupSnapshot.deadLetter,
        opened: rollupSnapshot.opened,
        clicked: rollupSnapshot.clicked,
        conversion: rollupSnapshot.conversion,
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

      const remainDeliveries = await admin.from('notification_deliveries').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantId);
      const remainEvents = await admin.from('notification_delivery_events').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantId);
      const remainDailyRollups = await admin
        .from('notification_delivery_daily_rollups')
        .select('day', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainAnomalyRollups = await admin
        .from('notification_delivery_anomaly_daily_rollups')
        .select('day', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainAudit = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantId);

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
