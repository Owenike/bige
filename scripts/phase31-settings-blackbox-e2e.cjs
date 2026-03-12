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
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
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

function toQuery(params) {
  const query = new URLSearchParams();
  query.set('tenantId', params.tenantId);
  if (params.branchId) query.set('branchId', params.branchId);
  return query.toString();
}

function getJobItem(settings, jobType) {
  return (settings?.jobs || []).find((item) => item.jobType === jobType) || null;
}

function getNotificationItem(settings, jobType) {
  return (settings?.notifications || []).find((item) => item.jobType === jobType) || null;
}

function getDeliveryChannelItem(settings, channel) {
  return (settings?.deliveryChannels || []).find((item) => item.channel === channel) || null;
}

async function main() {
  const root = process.cwd();
  const envFileArg = readArg('--env-file');
  const envFile = (envFileArg || process.env.PHASE31_ENV_FILE || '').trim();
  if (envFile) {
    loadEnvFile(path.isAbsolute(envFile) ? envFile : path.join(root, envFile));
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
  }

  const baseUrl = normalizeBaseUrl(
    readArg('--base-url') ||
      process.env.PHASE31_BASE_URL ||
      process.env.PHASE22_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'https://bige.vercel.app',
  );
  const bypassSecret = String(
    readArg('--bypass-secret') ||
      process.env.PHASE31_VERCEL_BYPASS_SECRET ||
      process.env.PHASE22_VERCEL_BYPASS_SECRET ||
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      '',
  ).trim();

  assertOrThrow(baseUrl.startsWith('http://') || baseUrl.startsWith('https://'), `Invalid base URL: ${baseUrl}`);

  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((name) => !(process.env[name] || '').trim());
  assertOrThrow(missing.length === 0, `Missing env: ${missing.join(', ')}`);

  const nowIso = new Date().toISOString();
  const e2eKey = `phase31_settings_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const email = `phase31-settings-${Date.now()}@example.test`;
  const password = `Phase31!${crypto.randomBytes(6).toString('hex')}`;

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const state = {
    tenantId: null,
    branchId: null,
    userId: null,
  };
  const cleanup = {
    tenantDeleted: false,
    branchDeleted: false,
    profileDeleted: false,
    userDeleted: false,
    remainingSettingsRows: 0,
    remainingAuditRows: 0,
    remainingFlags: 0,
  };
  const matrix = {
    defaultOnly: false,
    tenantOverride: false,
    branchOverride: false,
    featureFlagSuppress: false,
    keyPriority: false,
    branchTenantFlagConflict: false,
  };
  let outcome = null;
  let fatalError = null;

  try {
    const tenantInsert = await admin
      .from('tenants')
      .insert({ name: `E2E Phase31 Settings ${e2eKey}`, status: 'active' })
      .select('id')
      .single();
    assertOrThrow(!tenantInsert.error && tenantInsert.data?.id, `tenant insert failed: ${tenantInsert.error?.message || 'unknown'}`);
    state.tenantId = tenantInsert.data.id;

    const userCreate = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase31_settings_blackbox' },
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
          display_name: `Phase31 Settings ${e2eKey}`,
          updated_at: new Date().toISOString(),
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

    const getDefault = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/jobs/settings?${toQuery({ tenantId: state.tenantId })}`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(getDefault.status === 200, `settings GET default expected 200, got ${getDefault.status}: ${pickMessage(getDefault.json, getDefault.text)}`);
    const defaultJob = getJobItem(getDefault.json, 'notification_sweep');
    assertOrThrow(defaultJob, 'default GET missing notification_sweep');
    matrix.defaultOnly = defaultJob.source === 'default';

    const putTenantJob = await apiRequest({
      method: 'PUT',
      baseUrl,
      path: '/api/platform/jobs/settings',
      token: accessToken,
      bypassSecret,
      body: {
        action: 'upsert_job',
        tenantId: state.tenantId,
        branchId: null,
        jobType: 'notification_sweep',
        enabled: true,
        windowMinutes: 45,
        maxBatchSize: 321,
      },
    });
    assertOrThrow(putTenantJob.status === 200, `upsert_job tenant expected 200, got ${putTenantJob.status}: ${pickMessage(putTenantJob.json, putTenantJob.text)}`);

    const getTenant = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/jobs/settings?${toQuery({ tenantId: state.tenantId })}`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(getTenant.status === 200, `settings GET tenant expected 200, got ${getTenant.status}: ${pickMessage(getTenant.json, getTenant.text)}`);
    const tenantJob = getJobItem(getTenant.json, 'notification_sweep');
    matrix.tenantOverride = Boolean(tenantJob && tenantJob.source === 'tenant' && tenantJob.windowMinutes === 45 && tenantJob.maxBatchSize === 321);

    const branchInsert = await admin
      .from('branches')
      .insert({
        tenant_id: state.tenantId,
        name: `Phase31 Branch ${e2eKey}`,
        is_active: true,
      })
      .select('id')
      .single();
    assertOrThrow(!branchInsert.error && branchInsert.data?.id, `branch insert failed: ${branchInsert.error?.message || 'unknown'}`);
    state.branchId = branchInsert.data.id;

    const putBranchJob = await apiRequest({
      method: 'PUT',
      baseUrl,
      path: '/api/platform/jobs/settings',
      token: accessToken,
      bypassSecret,
      body: {
        action: 'upsert_job',
        tenantId: state.tenantId,
        branchId: state.branchId,
        jobType: 'notification_sweep',
        enabled: false,
        windowMinutes: 61,
        maxBatchSize: 111,
      },
    });
    assertOrThrow(putBranchJob.status === 200, `upsert_job branch expected 200, got ${putBranchJob.status}: ${pickMessage(putBranchJob.json, putBranchJob.text)}`);

    const getBranch = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/jobs/settings?${toQuery({ tenantId: state.tenantId, branchId: state.branchId })}`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(getBranch.status === 200, `settings GET branch expected 200, got ${getBranch.status}: ${pickMessage(getBranch.json, getBranch.text)}`);
    const branchJob = getJobItem(getBranch.json, 'notification_sweep');
    matrix.branchOverride = Boolean(branchJob && branchJob.source === 'branch' && branchJob.enabled === false && branchJob.windowMinutes === 61);

    const flagUpsertEnable = await admin.from('feature_flags').upsert(
      {
        tenant_id: state.tenantId,
        key: 'jobs.notification_sweep.enabled',
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,key' },
    );
    assertOrThrow(!flagUpsertEnable.error, `feature flag upsert (jobs.enable=true) failed: ${flagUpsertEnable.error?.message || 'unknown'}`);

    const getBranchFlagEnable = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/jobs/settings?${toQuery({ tenantId: state.tenantId, branchId: state.branchId })}`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(getBranchFlagEnable.status === 200, `settings GET branch(flag=true) expected 200, got ${getBranchFlagEnable.status}`);
    const branchJobFlagEnable = getJobItem(getBranchFlagEnable.json, 'notification_sweep');
    matrix.branchTenantFlagConflict = Boolean(
      branchJobFlagEnable &&
        branchJobFlagEnable.source === 'branch' &&
        branchJobFlagEnable.featureFlag &&
        branchJobFlagEnable.featureFlag.enabled === true &&
        branchJobFlagEnable.enabled === true,
    );

    const putBranchJobEnabledTrue = await apiRequest({
      method: 'PUT',
      baseUrl,
      path: '/api/platform/jobs/settings',
      token: accessToken,
      bypassSecret,
      body: {
        action: 'upsert_job',
        tenantId: state.tenantId,
        branchId: state.branchId,
        jobType: 'notification_sweep',
        enabled: true,
        windowMinutes: 62,
        maxBatchSize: 112,
      },
    });
    assertOrThrow(putBranchJobEnabledTrue.status === 200, `upsert_job branch(enabled=true) expected 200, got ${putBranchJobEnabledTrue.status}`);

    const flagUpsertDisable = await admin.from('feature_flags').upsert(
      {
        tenant_id: state.tenantId,
        key: 'jobs.notification_sweep.enabled',
        enabled: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,key' },
    );
    assertOrThrow(!flagUpsertDisable.error, `feature flag upsert (jobs.enable=false) failed: ${flagUpsertDisable.error?.message || 'unknown'}`);

    const getBranchFlagDisable = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/jobs/settings?${toQuery({ tenantId: state.tenantId, branchId: state.branchId })}`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(getBranchFlagDisable.status === 200, `settings GET branch(flag=false) expected 200, got ${getBranchFlagDisable.status}`);
    const branchJobFlagDisable = getJobItem(getBranchFlagDisable.json, 'notification_sweep');
    matrix.featureFlagSuppress = Boolean(
      branchJobFlagDisable &&
        branchJobFlagDisable.source === 'branch' &&
        branchJobFlagDisable.featureFlag &&
        branchJobFlagDisable.featureFlag.enabled === false &&
        branchJobFlagDisable.enabled === false,
    );

    const putNotification = await apiRequest({
      method: 'PUT',
      baseUrl,
      path: '/api/platform/jobs/settings',
      token: accessToken,
      bypassSecret,
      body: {
        action: 'upsert_notification',
        tenantId: state.tenantId,
        branchId: null,
        jobType: 'notification_sweep',
        isEnabled: true,
        channels: { in_app: true, email: true, line: true, sms: false, webhook: false },
      },
    });
    assertOrThrow(putNotification.status === 200, `upsert_notification expected 200, got ${putNotification.status}: ${pickMessage(putNotification.json, putNotification.text)}`);

    const putDelivery = await apiRequest({
      method: 'PUT',
      baseUrl,
      path: '/api/platform/jobs/settings',
      token: accessToken,
      bypassSecret,
      body: {
        action: 'upsert_delivery_channel',
        tenantId: state.tenantId,
        branchId: null,
        channel: 'email',
        isEnabled: true,
        provider: 'phase31_test_provider',
        rateLimitPerMinute: 120,
        timeoutMs: 15000,
      },
    });
    assertOrThrow(putDelivery.status === 200, `upsert_delivery_channel expected 200, got ${putDelivery.status}: ${pickMessage(putDelivery.json, putDelivery.text)}`);

    const flagNotification = await admin.from('feature_flags').upsert(
      {
        tenant_id: state.tenantId,
        key: 'jobs.notifications.notification_sweep.enabled',
        enabled: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,key' },
    );
    assertOrThrow(!flagNotification.error, `feature flag upsert (jobs.notifications.*) failed: ${flagNotification.error?.message || 'unknown'}`);

    const flagChannel = await admin.from('feature_flags').upsert(
      {
        tenant_id: state.tenantId,
        key: 'jobs.channels.email.enabled',
        enabled: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,key' },
    );
    assertOrThrow(!flagChannel.error, `feature flag upsert (jobs.channels.email.*) failed: ${flagChannel.error?.message || 'unknown'}`);

    const getPriority = await apiRequest({
      method: 'GET',
      baseUrl,
      path: `/api/platform/jobs/settings?${toQuery({ tenantId: state.tenantId })}`,
      token: accessToken,
      bypassSecret,
    });
    assertOrThrow(getPriority.status === 200, `settings GET priority expected 200, got ${getPriority.status}: ${pickMessage(getPriority.json, getPriority.text)}`);

    const jobPriority = getJobItem(getPriority.json, 'notification_sweep');
    const notificationPriority = getNotificationItem(getPriority.json, 'notification_sweep');
    const channelPriority = getDeliveryChannelItem(getPriority.json, 'email');
    matrix.keyPriority = Boolean(
      jobPriority &&
        jobPriority.featureFlag &&
        jobPriority.featureFlag.key === 'jobs.notification_sweep.enabled' &&
        jobPriority.enabled === false &&
        notificationPriority &&
        notificationPriority.featureFlag &&
        notificationPriority.featureFlag.key === 'jobs.notifications.notification_sweep.enabled' &&
        notificationPriority.isEnabled === false &&
        notificationPriority.channels?.email === false &&
        channelPriority &&
        channelPriority.featureFlag &&
        channelPriority.featureFlag.key === 'jobs.channels.email.enabled' &&
        channelPriority.isEnabled === false,
    );

    assertOrThrow(Object.values(matrix).every(Boolean), `resolver matrix failed: ${JSON.stringify(matrix)}`);

    const auditRows = await admin
      .from('audit_logs')
      .select('id, action, payload, created_at')
      .eq('actor_id', state.userId)
      .in('action', ['job_setting_updated', 'job_notification_setting_updated', 'job_delivery_channel_setting_updated'])
      .gte('created_at', nowIso)
      .order('created_at', { ascending: true });
    assertOrThrow(!auditRows.error, `audit query failed: ${auditRows.error?.message || 'unknown'}`);
    const rows = auditRows.data || [];

    function hasAudit(action) {
      return rows.some((row) => {
        if (row.action !== action) return false;
        const payload = row.payload || {};
        return payload.before !== undefined && payload.after !== undefined && payload.diffSummary && payload.diffSummary.changedCount >= 1;
      });
    }

    assertOrThrow(hasAudit('job_setting_updated'), 'missing valid audit row for job_setting_updated');
    assertOrThrow(hasAudit('job_notification_setting_updated'), 'missing valid audit row for job_notification_setting_updated');
    assertOrThrow(hasAudit('job_delivery_channel_setting_updated'), 'missing valid audit row for job_delivery_channel_setting_updated');

    outcome = {
      ok: true,
      mode: 'blackbox',
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      e2eKey,
      tenantId: state.tenantId,
      branchId: state.branchId,
      matrix,
      audit: {
        total: rows.length,
        actions: Array.from(new Set(rows.map((row) => row.action))),
      },
      checks: {
        settingsGet: true,
        upsertJob: true,
        upsertNotification: true,
        upsertDeliveryChannel: true,
      },
    };
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (state.tenantId) {
      await admin.from('feature_flags').delete().eq('tenant_id', state.tenantId);
      await admin.from('tenant_delivery_channel_settings').delete().eq('tenant_id', state.tenantId);
      await admin.from('tenant_notification_settings').delete().eq('tenant_id', state.tenantId);
      await admin.from('tenant_job_settings').delete().eq('tenant_id', state.tenantId);
      await admin.from('audit_logs').delete().eq('tenant_id', state.tenantId);
      if (state.branchId) {
        const branchDelete = await admin.from('branches').delete().eq('id', state.branchId);
        cleanup.branchDeleted = !branchDelete.error;
      }
      const tenantDelete = await admin.from('tenants').delete().eq('id', state.tenantId);
      cleanup.tenantDeleted = !tenantDelete.error;

      const remainSettings = await admin
        .from('tenant_job_settings')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainAudit = await admin
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      const remainFlags = await admin
        .from('feature_flags')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', state.tenantId);
      cleanup.remainingSettingsRows = remainSettings.count ?? 0;
      cleanup.remainingAuditRows = remainAudit.count ?? 0;
      cleanup.remainingFlags = remainFlags.count ?? 0;
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
          matrix,
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
