import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const baseUrl = (process.argv[2] || "http://localhost:3010").replace(/\/$/, "");
const studentPassword = "BigeFixture!2026";

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  assert.doesNotMatch(text, /<!doctype|<html/i, `${path} must never return raw HTML errors`);
  const payload = text ? JSON.parse(text) : null;
  return { response, payload, cookie: cookieFrom(response) };
}

async function studentLogin(phone) {
  const result = await jsonRequest("/api/student-checkin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password: studentPassword }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.ok, true);
  assert.match(result.cookie, /bige_student_auth_session=/);
  return result.cookie;
}

async function adminToken() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.ok(supabaseUrl && anonKey);
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({
    email: "codex-student-entry-admin@example.invalid",
    password: "CodexAdminFixture!2026",
  });
  assert.ifError(signedIn.error);
  assert.ok(signedIn.data.session?.access_token);
  return signedIn.data.session.access_token;
}

async function adminLoginCookie() {
  const result = await jsonRequest("/api/admin/student-check-ins/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "codex-student-entry-admin@example.invalid",
      password: "CodexAdminFixture!2026",
    }),
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.ok, true);
  assert.ok(result.cookie);
  return result.cookie;
}

async function adminDecision(mode, requestId, decision, token, lockerKey) {
  const path = mode === "autonomous"
    ? `/api/admin/student-check-ins/${requestId}/decision`
    : `/api/admin/student-check-ins/drop-in/${requestId}/decision`;
  const body = mode === "drop_in" && decision === "rejected"
    ? { decision, rejectionAction: "general" }
    : decision === "approved"
      ? { decision, ...lockerKey }
      : { decision };
  const result = await jsonRequest(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.ok, true);
}

const token = await adminToken();
const adminCookie = await adminLoginCookie();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL && serviceRoleKey);
const adminDatabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const path of ["/check-in", "/check-in/drop-in"]) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  assert.equal(response.status, 200, `${path} should render`);
}
for (const path of ["/admin/student-check-ins", "/admin/student-check-ins/drop-in"]) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", headers: { cookie: adminCookie } });
  assert.equal(response.status, 200, `${path} should render for an authorized admin`);
}

const formalCookie = await studentLogin("0900000202");
let result = await jsonRequest("/api/student-checkin/session", { headers: { cookie: formalCookie } });
assert.equal(result.payload.autonomous.accessCode, "allowed");
assert.equal(result.payload.dropIn.accessCode, "allowed");

result = await jsonRequest("/api/student-checkin/request", { method: "POST", headers: { cookie: formalCookie } });
assert.equal(result.response.status, 200);
assert.equal(result.payload.request.status, "pending");
const formalRequestId = result.payload.request.id;

let adminQueue = await jsonRequest("/api/admin/student-check-ins", {
  headers: { authorization: `Bearer ${token}` },
});
assert.equal(adminQueue.response.status, 200);
assert.equal(adminQueue.payload.pending.filter((item) => item.id === formalRequestId).length, 1);
assert.equal(adminQueue.payload.pending.find((item) => item.id === formalRequestId).profile.autonomous_access_status, "formal_member");

result = await jsonRequest(`/api/admin/student-check-ins/${formalRequestId}/decision`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ decision: "approved" }),
});
assert.equal(result.response.status, 400);
assert.equal(result.payload.ok, false);

await adminDecision(
  "autonomous",
  formalRequestId,
  "approved",
  token,
  { lockerKeyTaken: false, lockerKeyNumber: null },
);
result = await jsonRequest("/api/student-checkin/request", { headers: { cookie: formalCookie }, cache: "no-store" });
assert.equal(result.payload.request.status, "approved");
assert.ok(result.payload.checkIn);
let storedEntry = await adminDatabase
  .from("student_check_ins")
  .select("locker_key_taken, locker_key_number")
  .eq("request_id", formalRequestId)
  .single();
assert.ifError(storedEntry.error);
assert.equal(storedEntry.data.locker_key_taken, false);
assert.equal(storedEntry.data.locker_key_number, null);

const nonMemberCookie = await studentLogin("0900000203");
result = await jsonRequest("/api/student-checkin/session", { headers: { cookie: nonMemberCookie } });
assert.equal(result.payload.autonomous.accessCode, "not_official_member");
assert.equal(result.payload.dropIn.accessCode, "allowed");

result = await jsonRequest("/api/student-checkin/request", { method: "POST", headers: { cookie: nonMemberCookie } });
assert.equal(result.response.status, 403);
assert.equal(result.payload.code, "not_official_member");
assert.match(result.payload.error, /非本館學員/);

result = await jsonRequest("/api/student-checkin/drop-in/request", { method: "POST", headers: { cookie: nonMemberCookie } });
assert.equal(result.response.status, 200, JSON.stringify(result.payload));
assert.equal(result.payload.request.status, "pending");
const rejectedDropInId = result.payload.request.id;

adminQueue = await jsonRequest("/api/admin/student-check-ins", {
  headers: { authorization: `Bearer ${token}` },
});
assert.equal(adminQueue.payload.dropInPending.filter((item) => item.id === rejectedDropInId).length, 1);
assert.equal(adminQueue.payload.dropInPending.find((item) => item.id === rejectedDropInId).profile.autonomous_access_status, "non_member");

await adminDecision("drop_in", rejectedDropInId, "rejected", token);
result = await jsonRequest("/api/student-checkin/drop-in/request", { headers: { cookie: nonMemberCookie }, cache: "no-store" });
assert.equal(result.payload.request.status, "rejected");

result = await jsonRequest("/api/student-checkin/drop-in/request", { method: "POST", headers: { cookie: nonMemberCookie } });
assert.equal(result.response.status, 200);
assert.equal(result.payload.request.status, "pending");
const approvedDropInId = result.payload.request.id;
await adminDecision(
  "drop_in",
  approvedDropInId,
  "approved",
  token,
  { lockerKeyTaken: true, lockerKeyNumber: 27 },
);
result = await jsonRequest("/api/student-checkin/drop-in/request", { headers: { cookie: nonMemberCookie }, cache: "no-store" });
assert.equal(result.payload.request.status, "approved");
assert.equal(result.payload.dropInCheckIn.price_twd, 50);
assert.equal(result.payload.dropInCheckIn.remaining_uses, 9);
storedEntry = await adminDatabase
  .from("student_drop_ins")
  .select("locker_key_taken, locker_key_number")
  .eq("request_id", approvedDropInId)
  .single();
assert.ifError(storedEntry.error);
assert.equal(storedEntry.data.locker_key_taken, true);
assert.equal(storedEntry.data.locker_key_number, 27);

adminQueue = await jsonRequest("/api/admin/student-check-ins", {
  headers: { authorization: `Bearer ${token}` },
});
assert.equal(adminQueue.response.status, 200);
const autonomousSummaryEntry = adminQueue.payload.today.find((item) => item.request_id === formalRequestId);
const dropInSummaryEntry = adminQueue.payload.dropInToday.find((item) => item.request_id === approvedDropInId);
assert.equal(autonomousSummaryEntry?.locker_key_taken, false);
assert.equal(autonomousSummaryEntry?.locker_key_number, null);
assert.equal(dropInSummaryEntry?.locker_key_taken, true);
assert.equal(dropInSummaryEntry?.locker_key_number, 27);

const blockedCookie = await studentLogin("0900000204");
result = await jsonRequest("/api/student-checkin/session", { headers: { cookie: blockedCookie } });
assert.equal(result.payload.autonomous.accessCode, "account_unavailable");
assert.equal(result.payload.dropIn.accessCode, "account_unavailable");
assert.doesNotMatch(JSON.stringify(result.payload), /拒絕名單|禁止入場|黑名單/);

for (const path of ["/api/student-checkin/request", "/api/student-checkin/drop-in/request"]) {
  result = await jsonRequest(path, { method: "POST", headers: { cookie: blockedCookie } });
  assert.equal(result.response.status, 403);
  assert.equal(result.payload.code, "account_unavailable");
  assert.match(result.payload.error, /帳號狀態異常/);
  assert.doesNotMatch(result.payload.error, /拒絕|禁止|黑名單/);
}

console.log(JSON.stringify({
  ok: true,
  flows: {
    autonomousApproved: formalRequestId,
    dropInRejected: rejectedDropInId,
    dropInApproved: approvedDropInId,
    blockedBothModes: true,
    nonMemberRedirected: true,
    adminPagesRendered: true,
    lockerKeyAnswersStored: true,
    lockerKeySummaryReturned: true,
    rawHtmlErrors: false,
  },
}));
