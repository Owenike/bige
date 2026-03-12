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

function assertOrThrow(condition, message) {
  if (!condition) throw new Error(message);
}

function pickMessage(payload, fallback) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.message === 'string') return payload.message;
    if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  }
  return fallback;
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

async function postJson(baseUrl, token, body, bypassSecret) {
  const secret = String(bypassSecret || '').trim();
  const response = await fetch(withBypass(`${baseUrl}/api/platform/jobs/rerun`, secret), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(secret ? { 'x-vercel-protection-bypass': secret } : {}),
    },
    body: JSON.stringify(body),
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

async function main() {
  const root = process.cwd();
  const envFileArg = readArg('--env-file');
  const envFile = (envFileArg || process.env.PHASE22_ENV_FILE || '').trim();
  if (envFile) {
    loadEnvFile(path.isAbsolute(envFile) ? envFile : path.join(root, envFile));
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
  }

  const baseUrl = normalizeBaseUrl(readArg('--base-url') || process.env.PHASE22_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bige.vercel.app');
  const bypassSecret = String(
    readArg('--bypass-secret') || process.env.PHASE22_VERCEL_BYPASS_SECRET || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '',
  ).trim();
  assertOrThrow(baseUrl.startsWith('http://') || baseUrl.startsWith('https://'), `Invalid base URL: ${baseUrl}`);

  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((name) => !(process.env[name] || '').trim());
  assertOrThrow(missing.length === 0, `Missing env: ${missing.join(', ')}`);

  const nowIso = new Date().toISOString();
  const e2eKey = `phase22_blackbox_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const email = `phase22-blackbox-${Date.now()}@example.test`;
  const password = `Phase22!${crypto.randomBytes(6).toString('hex')}`;

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const state = {
    tenantId: null,
    userId: null,
    sourceRunSuccessId: null,
    sourceRunConflictId: null,
    executionRunId: null,
    lockConflictRowId: null,
    dryRunScopeKey: null,
    dryRunConflictScopeKey: null,
  };

  const cleanup = {
    tenantDeleted: false,
    profileDeleted: false,
    userDeleted: false,
    remainingRuns: null,
    remainingLocks: null,
    remainingAudit: null,
  };

  let outcome = null;
  let fatalError = null;

  try {
    const tenantInsert = await admin
      .from('tenants')
      .insert({ name: `E2E Phase22 Blackbox ${e2eKey}`, status: 'active' })
      .select('id')
      .single();
    assertOrThrow(!tenantInsert.error && tenantInsert.data?.id, `tenant insert failed: ${tenantInsert.error?.message || 'unknown'}`);
    state.tenantId = tenantInsert.data.id;

    const userCreate = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { e2eKey, scenario: 'phase22_blackbox_execute_minimal' },
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
          display_name: `Phase22 Blackbox ${e2eKey}`,
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

    async function createFailedRun(label, minutesAgo) {
      const now = Date.now();
      const createdAt = new Date(now - minutesAgo * 60000).toISOString();
      const startedAt = new Date(now - (minutesAgo + 1) * 60000).toISOString();
      const finishedAt = new Date(now - (minutesAgo + 0.5) * 60000).toISOString();
      const result = await admin
        .from('notification_job_runs')
        .insert({
          tenant_id: state.tenantId,
          branch_id: null,
          job_type: 'notification_sweep',
          trigger_mode: 'manual',
          status: 'failed',
          started_at: startedAt,
          finished_at: finishedAt,
          duration_ms: 15000,
          affected_count: 0,
          error_count: 1,
          error_summary: `phase22 blackbox ${label}`,
          payload: { e2eKey, label, phase: 'phase22_blackbox_execute_minimal' },
          initiated_by: state.userId,
          created_at: createdAt,
          updated_at: new Date().toISOString(),
        })
        .select('id, created_at')
        .single();
      assertOrThrow(!result.error && result.data?.id, `create failed run (${label}) failed: ${result.error?.message || 'unknown'}`);
      return result.data;
    }

    const source1 = await createFailedRun('dry_execute_success', 5);
    state.sourceRunSuccessId = source1.id;

    const dry1 = await postJson(baseUrl, accessToken, {
      action: 'dry_run',
      failedOnly: true,
      target: { type: 'job_run', id: source1.id },
    }, bypassSecret);
    assertOrThrow(dry1.status === 200, `dry_run success-chain expected 200, got ${dry1.status}: ${pickMessage(dry1.json, dry1.text)}`);
    assertOrThrow(Boolean(dry1.json?.ok), 'dry_run success-chain response not ok');
    assertOrThrow(Array.isArray(dry1.json?.planned) && dry1.json.planned.length > 0, 'dry_run planned should not be empty');
    assertOrThrow(typeof dry1.json?.previewToken === 'string' && dry1.json.previewToken.length > 20, 'dry_run missing previewToken; check JOB_RERUN_PREVIEW_SECRET in deployed env');
    state.dryRunScopeKey = dry1.json.planned[0].scopeKey;

    const execute1 = await postJson(baseUrl, accessToken, {
      action: 'execute',
      failedOnly: true,
      target: { type: 'job_run', id: source1.id },
      previewToken: dry1.json.previewToken,
      confirmPhrase: 'EXECUTE_RERUN',
    }, bypassSecret);
    assertOrThrow(execute1.status === 200, `execute success-chain expected 200, got ${execute1.status}: ${pickMessage(execute1.json, execute1.text)}`);
    assertOrThrow(Boolean(execute1.json?.ok), 'execute success-chain response not ok');
    assertOrThrow(Boolean(execute1.json?.result?.executionJobRunId), 'execute success-chain missing executionJobRunId');
    state.executionRunId = execute1.json.result.executionJobRunId;

    const lockReleaseCheck = await admin
      .from('notification_job_execution_locks')
      .select('id, scope_key, lock_status, released_at, expires_at')
      .eq('scope_key', state.dryRunScopeKey)
      .order('acquired_at', { ascending: false });
    assertOrThrow(!lockReleaseCheck.error, `lock release check failed: ${lockReleaseCheck.error?.message || 'unknown'}`);
    const activeLocks = (lockReleaseCheck.data || []).filter((row) => {
      const expiresAt = new Date(row.expires_at || 0).getTime();
      return row.lock_status === 'locked' && !row.released_at && expiresAt > Date.now();
    });
    assertOrThrow(activeLocks.length === 0, 'lock should be released after execute');

    const source2 = await createFailedRun('lock_conflict', 4);
    state.sourceRunConflictId = source2.id;

    const dry2 = await postJson(baseUrl, accessToken, {
      action: 'dry_run',
      failedOnly: true,
      target: { type: 'job_run', id: source2.id },
    }, bypassSecret);
    assertOrThrow(dry2.status === 200, `dry_run lock-conflict expected 200, got ${dry2.status}: ${pickMessage(dry2.json, dry2.text)}`);
    assertOrThrow(Array.isArray(dry2.json?.planned) && dry2.json.planned.length > 0, 'dry_run lock-conflict planned should not be empty');
    assertOrThrow(typeof dry2.json?.previewToken === 'string' && dry2.json.previewToken.length > 20, 'dry_run lock-conflict missing previewToken');
    state.dryRunConflictScopeKey = dry2.json.planned[0].scopeKey;

    const lockInsert = await admin
      .from('notification_job_execution_locks')
      .insert({
        tenant_id: state.tenantId,
        job_type: 'notification_sweep',
        trigger_source: 'rerun_execute',
        window_start_at: dry2.json.planned[0].windowStartAt,
        window_end_at: dry2.json.planned[0].windowEndAt,
        scope_key: state.dryRunConflictScopeKey,
        lock_status: 'locked',
        acquired_by: state.userId,
        expires_at: new Date(Date.now() + 20 * 60000).toISOString(),
        metadata: { e2eKey, scenario: 'manual_lock_conflict_blackbox' },
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    assertOrThrow(!lockInsert.error && lockInsert.data?.id, `lock insert failed: ${lockInsert.error?.message || 'unknown'}`);
    state.lockConflictRowId = lockInsert.data.id;

    const executeConflict = await postJson(baseUrl, accessToken, {
      action: 'execute',
      failedOnly: true,
      target: { type: 'job_run', id: source2.id },
      previewToken: dry2.json.previewToken,
      confirmPhrase: 'EXECUTE_RERUN',
    }, bypassSecret);
    assertOrThrow(executeConflict.status === 409, `execute lock-conflict expected 409, got ${executeConflict.status}: ${pickMessage(executeConflict.json, executeConflict.text)}`);
    const conflictMessage = pickMessage(executeConflict.json, executeConflict.text).toLowerCase();
    assertOrThrow(conflictMessage.includes('lock'), 'execute lock-conflict should mention lock rejection');

    const auditRows = await admin
      .from('audit_logs')
      .select('id, action, target_id, payload, created_at')
      .eq('actor_id', state.userId)
      .in('action', ['job_rerun_dry_run', 'job_rerun_execute'])
      .gte('created_at', nowIso)
      .order('created_at', { ascending: true });
    assertOrThrow(!auditRows.error, `audit check failed: ${auditRows.error?.message || 'unknown'}`);

    const rows = auditRows.data || [];
    const dryAuditCount = rows.filter((row) => row.action === 'job_rerun_dry_run').length;
    const executeAuditRows = rows.filter((row) => row.action === 'job_rerun_execute');
    const executeStatuses = executeAuditRows.map((row) => row.payload?.summary?.executeStatus).filter(Boolean);
    assertOrThrow(dryAuditCount >= 2, `expected >=2 dry-run audits, got ${dryAuditCount}`);
    assertOrThrow(executeAuditRows.length >= 2, `expected >=2 execute audits, got ${executeAuditRows.length}`);
    assertOrThrow(executeStatuses.includes('executed'), 'missing execute audit status=executed');
    assertOrThrow(
      executeStatuses.includes('rejected_or_failed') || executeStatuses.includes('rejected_precheck'),
      'missing execute audit rejection status',
    );

    outcome = {
      ok: true,
      mode: 'blackbox',
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      e2eKey,
      sourceRunSuccessId: state.sourceRunSuccessId,
      sourceRunConflictId: state.sourceRunConflictId,
      executionRunId: state.executionRunId,
      dryRunScopeKey: state.dryRunScopeKey,
      dryRunConflictScopeKey: state.dryRunConflictScopeKey,
      audit: {
        total: rows.length,
        dryRunCount: dryAuditCount,
        executeCount: executeAuditRows.length,
        executeStatuses,
      },
      checks: {
        dryRunToExecuteSuccess: true,
        lockConflictRejected: true,
        lockReleasedAfterExecute: true,
      },
    };
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (state.tenantId) {
      await admin.from('notification_job_execution_locks').delete().eq('tenant_id', state.tenantId);
      await admin.from('notification_job_runs').delete().eq('tenant_id', state.tenantId);
      const tenantDelete = await admin.from('tenants').delete().eq('id', state.tenantId);
      cleanup.tenantDeleted = !tenantDelete.error;

      const remainRuns = await admin.from('notification_job_runs').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantId);
      const remainLocks = await admin.from('notification_job_execution_locks').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantId);
      const remainAudit = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', state.tenantId);
      cleanup.remainingRuns = remainRuns.count ?? null;
      cleanup.remainingLocks = remainLocks.count ?? null;
      cleanup.remainingAudit = remainAudit.count ?? null;
    }

    if (state.userId) {
      const profileDelete = await admin.from('profiles').delete().eq('id', state.userId);
      cleanup.profileDeleted = !profileDelete.error;
      const userDelete = await admin.auth.admin.deleteUser(state.userId);
      cleanup.userDeleted = !userDelete.error;
    }
  }

  if (fatalError) {
    const errPayload = {
      ok: false,
      mode: 'blackbox',
      baseUrl,
      bypassEnabled: Boolean(bypassSecret),
      error: fatalError.message,
      cleanup,
    };
    console.error(JSON.stringify(errPayload, null, 2));
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
