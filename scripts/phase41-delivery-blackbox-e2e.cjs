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
      authorization: `Bearer ${params.token}`,
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

function getSnapshotFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.snapshot && typeof payload.snapshot === 'object') return payload.snapshot;
  if (payload.data && payload.data.snapshot && typeof payload.data.snapshot === 'object') return payload.data.snapshot;
  return null;
}

function toByKey(items, keyName) {
  const map = new Map();
  for (const item of items || []) {
    const key = String(item?.[keyName] || '');
    if (!key) continue;
    map.set(key, item);
  }
  return map;
}

async function main() {
  const root = process.cwd();
  const envFileArg = readArg('--env-file');
  const envFile = (envFileArg || process.env.PHASE41_ENV_FILE || '').trim();
  if (envFile) {
    loadEnvFile(path.isAbsolute(envFile) ? envFile : path.join(root, envFile));
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
  }

  const baseUrl = normalizeBaseUrl(
    readArg('--base-url') ||
      process.env.PHASE41_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      '',
  );
  const bypassSecret = String(
    readArg('--bypass-secret') ||
      process.env.PHASE41_VERCEL_BYPASS_SECRET ||
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      '',
  ).trim();

  assertOrThrow(baseUrl.startsWith('http://') || baseUrl.startsWith('https://'), `Invalid base URL: ${baseUrl}`);

  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((name) => !(process.env[name] || '').trim());
  assertOrThrow(missing.length === 0, `Missing env: ${missing.join(', ')}`);

  const nowIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const e2eKey = `phase41_delivery_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const email = `phase41-delivery-${Date.now()}@example.test`;
  const password = `Phase41!${crypto.randomBytes(6).toString('hex')}`;
  const dedupeProvider = 'phase41_provider';
  const dedupeProviderEventId = `${e2eKey}_dup_01`;

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const state = {
    tenantId: null,
    userId: null,
    deliveryIds: {},
  };
  const cleanup = {
    tenantDeleted: false,
    profileDeleted: false,
    userDeleted: false,
    remainingDeliveries: 0,
    remainingEvents: 0,
    remainingAudit: 0,
  };
  let outcome = null;
  let fatalError = null;

  try {
    const tenantInsert = await admin
      .from('tenants')
      .insert({ name: `E2E Phase41 Delivery ${e2eKey}`, status: 'active' })
      .select('id')
      .single();
    assertOrThrow(!tenantInsert.error && tenantInsert.data?.id, `tenant insert failed: ${tenantInsert.error?.message || 'unknown'}`);
    state.tenantId = tenantInsert.data.id;

    const userCreate = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase41_delivery_blackbox' },
    });
    assertOrThrow(!userCreate.error && userCreate.data?.user?.id, `user create failed: ${userCreate.error?.message || 'unknown'}`);
    state.userId = userCreate.data.user.id;

    const profileUpsert = await admin
      .from('profiles')
      .upsert(
        {
          id: state.userId,
          role: 'platform_admin',
          tenant_id: null,
          branch_id: null,
          is_active: true,
          display_name: `Phase41 Delivery ${e2eKey}`,
          updated_at: nowIso,
        },
        { onConflict: 'id' },
      )
      .select('id')
      .single();
    assertOrThrow(!profileUpsert.error, `profile upsert failed: ${profileUpsert.error?.message || 'unknown'}`);

    const signIn = await anon.auth.signInWithPassword({ email, password });
    assertOrThrow(!signIn.error, `sign in failed: ${signIn.error?.message || 'unknown'}`);
    const accessToken = signIn.data?.session?.access_token || '';
    assertOrThrow(accessToken.length > 20, 'missing access token');

    const deliveryInsert = await admin
      .from('notification_deliveries')
      .insert([
        {
          tenant_id: state.tenantId,
          channel: 'email',
          status: 'pending',
          attempts: 0,
          retry_count: 0,
          dedupe_key: `${e2eKey}:d1`,
          source_ref_type: 'phase41_e2e',
          source_ref_id: 'd1',
          payload: { e2eKey, label: 'd1' },
          created_by: state.userId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'sms',
          status: 'retrying',
          attempts: 2,
          retry_count: 1,
          next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          dedupe_key: `${e2eKey}:d2`,
          source_ref_type: 'phase41_e2e',
          source_ref_id: 'd2',
          payload: { e2eKey, label: 'd2' },
          created_by: state.userId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'line',
          status: 'pending',
          attempts: 0,
          retry_count: 0,
          dedupe_key: `${e2eKey}:d3`,
          source_ref_type: 'phase41_e2e',
          source_ref_id: 'd3',
          payload: { e2eKey, label: 'd3' },
          created_by: state.userId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'email',
          status: 'failed',
          attempts: 3,
          retry_count: 2,
          failed_at: nowIso,
          last_error: 'seed failed row',
          error_message: 'seed failed row',
          dedupe_key: `${e2eKey}:d4`,
          source_ref_type: 'phase41_e2e',
          source_ref_id: 'd4',
          payload: { e2eKey, label: 'd4' },
          created_by: state.userId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'webhook',
          status: 'sent',
          attempts: 1,
          retry_count: 0,
          sent_at: nowIso,
          delivered_at: nowIso,
          dedupe_key: `${e2eKey}:d5`,
          source_ref_type: 'phase41_e2e',
          source_ref_id: 'd5',
          payload: { e2eKey, label: 'd5' },
          created_by: state.userId,
        },
        {
          tenant_id: state.tenantId,
          channel: 'sms',
          status: 'retrying',
          attempts: 1,
          retry_count: 0,
          next_retry_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          dedupe_key: `${e2eKey}:d6`,
          source_ref_type: 'phase41_e2e',
          source_ref_id: 'd6',
          payload: { e2eKey, label: 'd6' },
          created_by: state.userId,
        },
      ])
      .select('id, source_ref_id');
    assertOrThrow(!deliveryInsert.error, `delivery insert failed: ${deliveryInsert.error?.message || 'unknown'}`);
    const bySource = toByKey(deliveryInsert.data || [], 'source_ref_id');
    for (const key of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) {
      const item = bySource.get(key);
      assertOrThrow(item?.id, `missing inserted delivery id for ${key}`);
      state.deliveryIds[key] = item.id;
    }

    const getAnalyticsInitial = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/analytics?tenantId=${state.tenantId}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&limit=2000`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(
      getAnalyticsInitial.status === 200,
      `analytics initial expected 200, got ${getAnalyticsInitial.status}: ${pickMessage(getAnalyticsInitial.json, getAnalyticsInitial.text)}`,
    );

    const delivered = await apiRequest({
      method: 'POST',
      baseUrl,
      path: '/api/platform/notifications/delivery-events',
      token: accessToken,
      bypassSecret,
      body: {
        deliveryId: state.deliveryIds.d1,
        eventType: 'delivered',
        provider: 'phase41_email',
        providerEventId: `${e2eKey}_delivered_01`,
        providerMessageId: `${e2eKey}_msg_01`,
        providerResponse: { status: 'ok', token: 'should-redact' },
      },
    });
    assertOrThrow(
      delivered.status === 200,
      `delivery-events delivered expected 200, got ${delivered.status}: ${pickMessage(delivered.json, delivered.text)}`,
    );

    const deadLetter = await apiRequest({
      method: 'POST',
      baseUrl,
      path: '/api/platform/notifications/delivery-events',
      token: accessToken,
      bypassSecret,
      body: {
        deliveryId: state.deliveryIds.d2,
        eventType: 'failed',
        markDeadLetter: true,
        errorCode: 'PHASE41_E2E_FAIL',
        errorMessage: 'phase41 forced dead letter',
        provider: 'phase41_sms',
        providerEventId: `${e2eKey}_failed_01`,
        providerResponse: { reason: 'permanent', apiKey: 'should-redact' },
      },
    });
    assertOrThrow(
      deadLetter.status === 200,
      `delivery-events dead_letter expected 200, got ${deadLetter.status}: ${pickMessage(deadLetter.json, deadLetter.text)}`,
    );

    const deadLetterRow = await admin
      .from('notification_deliveries')
      .select('status, dead_letter_at, failed_at')
      .eq('id', state.deliveryIds.d2)
      .single();
    assertOrThrow(!deadLetterRow.error, `delivery fetch dead_letter row failed: ${deadLetterRow.error?.message || 'unknown'}`);
    assertOrThrow(deadLetterRow.data?.status === 'dead_letter', `expected dead_letter status, got ${deadLetterRow.data?.status || 'unknown'}`);
    assertOrThrow(Boolean(deadLetterRow.data?.dead_letter_at), 'dead_letter_at should be set');

    const dupOpen1 = await apiRequest({
      method: 'POST',
      baseUrl,
      path: '/api/platform/notifications/delivery-events',
      token: accessToken,
      bypassSecret,
      body: {
        deliveryId: state.deliveryIds.d3,
        eventType: 'opened',
        provider: dedupeProvider,
        providerEventId: dedupeProviderEventId,
        providerMessageId: `${e2eKey}_open_msg`,
      },
    });
    assertOrThrow(
      dupOpen1.status === 200,
      `delivery-events opened-1 expected 200, got ${dupOpen1.status}: ${pickMessage(dupOpen1.json, dupOpen1.text)}`,
    );
    assertOrThrow(dupOpen1.json?.deduped === false, `opened-1 expected deduped=false, got ${String(dupOpen1.json?.deduped)}`);

    const dupOpen2 = await apiRequest({
      method: 'POST',
      baseUrl,
      path: '/api/platform/notifications/delivery-events',
      token: accessToken,
      bypassSecret,
      body: {
        deliveryId: state.deliveryIds.d3,
        eventType: 'opened',
        provider: dedupeProvider,
        providerEventId: dedupeProviderEventId,
        providerMessageId: `${e2eKey}_open_msg`,
      },
    });
    assertOrThrow(
      dupOpen2.status === 200,
      `delivery-events opened-2 expected 200, got ${dupOpen2.status}: ${pickMessage(dupOpen2.json, dupOpen2.text)}`,
    );
    assertOrThrow(dupOpen2.json?.deduped === true, `opened-2 expected deduped=true, got ${String(dupOpen2.json?.deduped)}`);

    const dedupeCount = await admin
      .from('notification_delivery_events')
      .select('id', { count: 'exact', head: true })
      .eq('provider', dedupeProvider)
      .eq('provider_event_id', dedupeProviderEventId);
    assertOrThrow(!dedupeCount.error, `dedupe count query failed: ${dedupeCount.error?.message || 'unknown'}`);
    assertOrThrow((dedupeCount.count || 0) === 1, `expected dedupe event count=1, got ${dedupeCount.count || 0}`);

    const eventsGet = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/delivery-events?tenantId=${state.tenantId}&limit=100`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(
      eventsGet.status === 200,
      `delivery-events GET expected 200, got ${eventsGet.status}: ${pickMessage(eventsGet.json, eventsGet.text)}`,
    );
    const allEvents = eventsGet.json?.items || eventsGet.json?.data?.items || [];
    assertOrThrow(Array.isArray(allEvents) && allEvents.length >= 3, `expected >=3 events, got ${Array.isArray(allEvents) ? allEvents.length : 'invalid'}`);

    const eventsDupGet = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/delivery-events?tenantId=${state.tenantId}&deliveryId=${state.deliveryIds.d3}&eventTypes=opened&limit=20`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(
      eventsDupGet.status === 200,
      `delivery-events dup GET expected 200, got ${eventsDupGet.status}: ${pickMessage(eventsDupGet.json, eventsDupGet.text)}`,
    );
    const dupEvents = eventsDupGet.json?.items || eventsDupGet.json?.data?.items || [];
    assertOrThrow(Array.isArray(dupEvents) && dupEvents.length === 1, `expected opened dedupe events=1, got ${Array.isArray(dupEvents) ? dupEvents.length : 'invalid'}`);

    const analytics = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/analytics?tenantId=${state.tenantId}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&limit=2000`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(
      analytics.status === 200,
      `analytics expected 200, got ${analytics.status}: ${pickMessage(analytics.json, analytics.text)}`,
    );
    const snapshot = getSnapshotFromPayload(analytics.json);
    assertOrThrow(snapshot, 'analytics snapshot missing');
    assertOrThrow(snapshot.totalRows === 6, `analytics totalRows expected 6, got ${snapshot.totalRows}`);
    assertOrThrow(snapshot.sent === 2, `analytics sent expected 2, got ${snapshot.sent}`);
    assertOrThrow(snapshot.failed === 2, `analytics failed expected 2, got ${snapshot.failed}`);
    assertOrThrow(snapshot.deadLetter === 1, `analytics deadLetter expected 1, got ${snapshot.deadLetter}`);
    assertOrThrow(snapshot.pending === 1, `analytics pending expected 1, got ${snapshot.pending}`);
    assertOrThrow(snapshot.retrying === 1, `analytics retrying expected 1, got ${snapshot.retrying}`);
    assertOrThrow(snapshot.successRate === 50, `analytics successRate expected 50, got ${snapshot.successRate}`);
    assertOrThrow(snapshot.failRate === 50, `analytics failRate expected 50, got ${snapshot.failRate}`);

    const tenantStats = toByKey(snapshot.byTenant || [], 'tenantId');
    const tenantRow = tenantStats.get(state.tenantId);
    assertOrThrow(tenantRow && tenantRow.total === 6 && tenantRow.failed === 2 && tenantRow.deadLetter === 1, 'tenant aggregation mismatch');

    const channelStats = toByKey(snapshot.byChannel || [], 'channel');
    const emailStat = channelStats.get('email');
    const smsStat = channelStats.get('sms');
    assertOrThrow(emailStat && emailStat.sent === 1 && emailStat.failed === 1 && emailStat.total === 2, 'email aggregation mismatch');
    assertOrThrow(smsStat && smsStat.deadLetter === 1 && smsStat.retrying === 1 && smsStat.failed === 1 && smsStat.total === 2, 'sms aggregation mismatch');

    const daySent = (snapshot.daily || []).reduce((sum, item) => sum + Number(item.sent || 0), 0);
    const dayFailed = (snapshot.daily || []).reduce((sum, item) => sum + Number(item.failed || 0), 0);
    assertOrThrow(daySent === 2, `daily sent aggregate expected 2, got ${daySent}`);
    assertOrThrow(dayFailed === 2, `daily failed aggregate expected 2, got ${dayFailed}`);

    const ops = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/notifications/ops?tenantId=${state.tenantId}`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(
      ops.status === 200,
      `ops expected 200, got ${ops.status}: ${pickMessage(ops.json, ops.text)}`,
    );
    const opsSummary = ops.json?.summary || ops.json?.data?.summary || {};
    assertOrThrow(opsSummary.deadLetter === 1, `ops deadLetter expected 1, got ${opsSummary.deadLetter}`);
    assertOrThrow(opsSummary.failed === 2, `ops failed expected 2, got ${opsSummary.failed}`);

    outcome = {
      ok: true,
      mode: 'blackbox',
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      e2eKey,
      tenantId: state.tenantId,
      checks: {
        apiReachable: true,
        eventWriteRead: true,
        deadLetter: true,
        providerEventDedupe: true,
        analyticsConsistency: true,
        cleanup: true,
      },
      metrics: {
        totalRows: snapshot.totalRows,
        sent: snapshot.sent,
        failed: snapshot.failed,
        deadLetter: snapshot.deadLetter,
        pending: snapshot.pending,
        retrying: snapshot.retrying,
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

    if (state.userId) {
      const profileDelete = await admin.from('profiles').delete().eq('id', state.userId);
      cleanup.profileDeleted = !profileDelete.error;
      const userDelete = await admin.auth.admin.deleteUser(state.userId);
      cleanup.userDeleted = !userDelete.error;
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
