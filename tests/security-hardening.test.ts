import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { apiError } from "../lib/auth-context";
import {
  getAcpayChecklistSnapshot,
  recordAcpayChecklist,
} from "../lib/acpay-checklist";
import { rateLimitFixedWindow, rateLimitShared } from "../lib/rate-limit";

const migration = readFileSync(
  "supabase/migrations/20260902123009_harden_core_authorization.sql",
  "utf8",
);

test("profile security fields are protected at the database boundary", () => {
  assert.match(migration, /create trigger prevent_unauthorized_profile_security_changes/i);
  assert.match(migration, /profile_security_fields_are_server_managed/i);
  assert.match(
    migration,
    /to_jsonb\(new\) - array\['display_name', 'english_name', 'updated_at'\]::text\[\]/i,
  );
  assert.match(migration, /old\.id <> \(select auth\.uid\(\)\)/i);
});

test("anonymous users cannot bypass the public booking route", () => {
  assert.match(
    migration,
    /revoke all on function public\.create_public_booking_request[\s\S]*from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.create_public_booking_request[\s\S]*to service_role;/i,
  );
});

test("tenant tables use action and role-specific policies", () => {
  assert.doesNotMatch(migration, /create policy \w+_tenant_access/i);
  assert.match(migration, /create policy members_authorized_select/i);
  assert.match(migration, /create policy orders_operations_insert/i);
  assert.match(migration, /create policy audit_logs_actor_insert/i);
  assert.match(migration, /for (select|insert|update|delete) to authenticated/i);
});

test("contract signatures require a matching tenant folder", () => {
  assert.match(
    migration,
    /\(storage\.foldername\(name\)\)\[1\] = public\.current_tenant_id\(\)::text/i,
  );
  assert.match(migration, /bige_contract_signatures_read[\s\S]*role::text in \('manager',[\s\S]*'frontdesk'\)/i);
});

test("shared rate limiter is callable only by the trusted server role", () => {
  assert.match(
    migration,
    /revoke all on function public\.consume_security_rate_limit_v1[\s\S]*from public, anon, authenticated;/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.consume_security_rate_limit_v1[\s\S]*to service_role;/i,
  );
});

test("local fixed-window limiter blocks after the configured allowance", () => {
  const key = `security-test:${Date.now()}:${Math.random()}`;
  assert.equal(rateLimitFixedWindow({ key, limit: 2, windowMs: 60_000 }).ok, true);
  assert.equal(rateLimitFixedWindow({ key, limit: 2, windowMs: 60_000 }).ok, true);
  const blocked = rateLimitFixedWindow({ key, limit: 2, windowMs: 60_000 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
});

test("shared limiter keeps development and test runs local", async () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const originalNodeEnv = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "test";
  try {
    const key = `shared-security-test:${Date.now()}:${Math.random()}`;
    assert.equal((await rateLimitShared({ key, limit: 1, windowMs: 60_000 })).ok, true);
    assert.equal((await rateLimitShared({ key, limit: 1, windowMs: 60_000 })).ok, false);
  } finally {
    if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = originalNodeEnv;
  }
});

test("internal API failures do not expose database details", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const response = apiError(500, "INTERNAL_ERROR", "relation secret_table does not exist");
    const body = (await response.json()) as {
      message: string;
      incidentId: string;
      error: { message: string; incidentId: string };
    };
    assert.equal(body.message, "系統暫時無法處理，請稍後再試。");
    assert.equal(body.error.message, body.message);
    assert.ok(body.incidentId);
    assert.doesNotMatch(JSON.stringify(body), /secret_table/i);
  } finally {
    console.error = originalError;
  }
});

test("ACPay signed XML is retained only in the explicit test environment", () => {
  const originalAcpayEnv = process.env.ACPAY_ENV;
  const marker = `SECURITY_XML_${Date.now()}`;
  try {
    process.env.ACPAY_ENV = "production";
    assert.deepEqual(recordAcpayChecklist({ authorizationRequestXml: marker }), {});
    assert.deepEqual(getAcpayChecklistSnapshot(), {});

    process.env.ACPAY_ENV = "test";
    const recorded = recordAcpayChecklist({ authorizationRequestXml: marker });
    assert.equal(recorded.authorizationRequestXml, marker);
    assert.equal(getAcpayChecklistSnapshot().authorizationRequestXml, marker);
  } finally {
    if (originalAcpayEnv === undefined) delete process.env.ACPAY_ENV;
    else process.env.ACPAY_ENV = originalAcpayEnv;
  }
});

test("every route receives the baseline browser security headers", () => {
  const configSource = readFileSync("next.config.js", "utf8");
  assert.match(configSource, /poweredByHeader:\s*false/);
  assert.match(configSource, /Content-Security-Policy/);
  assert.match(configSource, /frame-ancestors 'self'/);
  assert.doesNotMatch(configSource, /frame-ancestors 'none'/);
  assert.match(configSource, /frame-src 'self'/);
  assert.match(configSource, /X-Frame-Options[\s\S]*SAMEORIGIN/);
  assert.match(configSource, /NODE_ENV === "development" \? " 'unsafe-eval'" : ""/);
  assert.match(configSource, /X-Content-Type-Options[\s\S]*nosniff/);
  assert.match(configSource, /Permissions-Policy/);
  assert.match(configSource, /source:\s*"\/:path\*"/);
});

test("same-origin staff management iframe stays compatible with clickjacking protection", () => {
  const operations = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const configSource = readFileSync("next.config.js", "utf8");

  assert.match(operations, /<iframe[\s\S]*src="\/manager\/staff"[\s\S]*title="員工帳號管理"/);
  assert.match(configSource, /frame-ancestors 'self'/);
  assert.match(configSource, /frame-src 'self'/);
  assert.match(configSource, /X-Frame-Options[\s\S]*SAMEORIGIN/);
});

test("staff account registration is visible and callable only by the 01 platform administrator", () => {
  const operations = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const layoutSource = readFileSync("app/manager/staff/layout.tsx", "utf8");
  const guardedRoutes = [
    "app/api/manager/staff/route.ts",
    "app/api/manager/staff/activation-code/route.ts",
    "app/api/manager/staff/reset-password/route.ts",
    "app/api/manager/staff/email-history/route.ts",
    "app/api/platform/users/route.ts",
  ];

  assert.match(operations, /const canOpenStaffAccountManagement = canManageStaffAccounts/);
  assert.match(
    operations,
    /tab === "schedule" && canOpenStaffAccountManagement/,
  );
  assert.match(layoutSource, /requireStaffAccountAdministrator\(\)/);
  assert.match(layoutSource, /\/forbidden\?code=FORBIDDEN/);

  for (const route of guardedRoutes) {
    assert.match(
      readFileSync(route, "utf8"),
      /requireStaffAccountAdministrator\(request\)/,
      `${route} must enforce the 01-only guard`,
    );
  }
});
