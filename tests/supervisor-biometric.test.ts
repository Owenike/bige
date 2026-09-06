import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createSupervisorSecret,
  hashSupervisorSecret,
  isSupervisorBiometricEnforced,
  isSupervisorPhoneUserAgent,
  isValidSupervisorSecret,
  readJwtSessionId,
  requiresSupervisorBiometric,
  secretsMatch,
} from "../lib/supervisor-biometric";

test("all leadership roles and positions require supervisor biometric login", () => {
  for (const role of [
    "platform_admin",
    "manager",
    "supervisor",
    "branch_manager",
    "store_owner",
    "store_manager",
  ]) {
    assert.equal(requiresSupervisorBiometric({ role, position: null }), true, role);
  }
  for (const position of [
    "administrative_director",
    "general_affairs_assistant_manager",
    "general_affairs_manager",
    "coach_team_lead",
    "coach_director",
    "coach_assistant_manager",
    "coach_manager",
    "coach_city_manager",
  ]) {
    assert.equal(requiresSupervisorBiometric({ role: "coach", position }), true, position);
  }
  assert.equal(requiresSupervisorBiometric({ role: "frontdesk", position: "frontdesk" }), false);
  assert.equal(requiresSupervisorBiometric({ role: "coach", position: "coach" }), false);
  assert.equal(requiresSupervisorBiometric({ role: "member", position: null }), false);
});

test("device enrollment accepts phones and rejects desktop or tablet user agents", () => {
  assert.equal(isSupervisorPhoneUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), true);
  assert.equal(isSupervisorPhoneUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit Mobile"), true);
  assert.equal(isSupervisorPhoneUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
  assert.equal(isSupervisorPhoneUserAgent("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), false);
});

test("supervisor enforcement begins only after activation and phone enrollment", () => {
  const profile = {
    id: "00000000-0000-4000-8000-000000000001",
    role: "platform_admin",
    position: null,
    staff_activation_status: "completed",
    supervisor_biometric_enforced_at: "2026-09-06T00:00:00.000Z",
  };
  assert.equal(isSupervisorBiometricEnforced(profile), true);
  assert.equal(isSupervisorBiometricEnforced({ ...profile, staff_activation_status: "identity_confirmed" }), false);
  assert.equal(isSupervisorBiometricEnforced({ ...profile, supervisor_biometric_enforced_at: null }), false);
});

test("browser and phone approval secrets are random, hashed, and constant-time comparable", () => {
  const secret = createSupervisorSecret();
  const other = createSupervisorSecret();
  assert.equal(isValidSupervisorSecret(secret), true);
  assert.notEqual(secret, other);
  assert.notEqual(hashSupervisorSecret(secret), secret);
  assert.equal(secretsMatch(secret, hashSupervisorSecret(secret)), true);
  assert.equal(secretsMatch(other, hashSupervisorSecret(secret)), false);
});

test("approved Supabase session id can be read from the trusted issued access token", () => {
  const payload = Buffer.from(JSON.stringify({ session_id: "session-123" })).toString("base64url");
  assert.equal(readJwtSessionId(`header.${payload}.signature`), "session-123");
  assert.equal(readJwtSessionId("invalid"), null);
});

test("password bypass, session enforcement, one-time links, and service-only tables are encoded", () => {
  const login = readFileSync("app/api/auth/login/route.ts", "utf8");
  const authContext = readFileSync("lib/auth-context.ts", "utf8");
  const proxy = readFileSync("proxy.ts", "utf8");
  const managerRoute = readFileSync("app/api/manager/staff/supervisor-devices/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260906114205_supervisor_biometric_login.sql",
    "utf8",
  );

  assert.match(login, /supervisor_password_login_blocked/);
  assert.match(authContext, /hasApprovedSupervisorSession/);
  assert.match(proxy, /hasApprovedSupervisorSession/);
  assert.match(managerRoute, /canManageStaffAccounts/);
  assert.match(managerRoute, /created_via: "platform_admin"/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table public\.supervisor_biometric_devices from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.supervisor_biometric_devices to service_role/);
  assert.match(migration, /browser_secret_hash text not null unique/);
  assert.match(migration, /approval_secret_hash text not null unique/);
  assert.match(migration, /where revoked_at is null/);
});

test("login UI replaces the password field with phone approval for enrolled supervisors", () => {
  const portal = readFileSync("app/login/login-portal.tsx", "utf8");
  assert.match(portal, /staffAuthMethod === "password" \? \(/);
  assert.match(portal, /傳送手機驗證/);
  assert.match(portal, /supervisor-login\/request/);
  assert.match(portal, /supervisor-login\/status/);
  assert.match(portal, /等待手機確認/);
});
