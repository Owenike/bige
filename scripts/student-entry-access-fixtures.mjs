import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const mode = process.argv[2];
if (!new Set(["setup", "cleanup"]).has(mode)) {
  throw new Error("Usage: node --env-file=.env.local scripts/student-entry-access-fixtures.mjs <setup|cleanup>");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("Missing Supabase fixture environment");

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const fixture = {
  tenantId: "1b3b895f-8b4a-42b7-a464-01bc0082281d",
  branchId: "41e3a9b6-d8bc-4da5-884d-2c6061c6e06b",
  memberId: "00000000-0000-4000-8000-00000000e201",
  formalProfileId: "00000000-0000-4000-8000-00000000e202",
  nonMemberProfileId: "00000000-0000-4000-8000-00000000e203",
  blockedProfileId: "00000000-0000-4000-8000-00000000e204",
  adminEmail: "codex-student-entry-admin@example.invalid",
  adminPassword: "CodexAdminFixture!2026",
  studentPassword: "BigeFixture!2026",
  passwordHash: "scrypt$wrNcL0ra8sKDxbJQGa8QKQ$2aCsTrEBM9TEldJtel3SO3R2SogkmwFDgUK6WVi80keF_VToIZyeB8shdLQSoLJkhc87r5ywMu1iu-9csKBkZg",
};

const studentProfileIds = [fixture.formalProfileId, fixture.nonMemberProfileId, fixture.blockedProfileId];
const fixturePhotoPaths = [
  "codex-fixtures/formal-profile.jpg",
  "codex-fixtures/nonmember-profile.jpg",
  "codex-fixtures/blocked-profile.jpg",
  `codex-fixtures/${fixture.nonMemberProfileId}-review.jpg`,
  `codex-fixtures/${fixture.blockedProfileId}-review.jpg`,
];

async function requireSuccess(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function findFixtureAdmin() {
  for (let page = 1; page <= 5; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 200 });
    await requireSuccess(result, "list fixture auth users");
    const found = result.data.users.find((user) => user.email === fixture.adminEmail);
    if (found) return found;
    if (result.data.users.length < 200) break;
  }
  return null;
}

async function cleanup() {
  await requireSuccess(
    await admin.storage.from("student-checkin-photos").remove(fixturePhotoPaths),
    "delete student entry fixture photos",
  );
  await requireSuccess(
    await admin.from("student_line_profiles").delete().in("id", studentProfileIds),
    "delete student entry fixtures",
  );
  await requireSuccess(
    await admin.from("members").delete().eq("id", fixture.memberId),
    "delete formal member fixture",
  );
  const fixtureAdmin = await findFixtureAdmin();
  if (fixtureAdmin) {
    await requireSuccess(await admin.auth.admin.deleteUser(fixtureAdmin.id), "delete admin auth fixture");
  }
}

async function setup() {
  await cleanup();

  const fixturePhoto = await readFile(new URL("../public/LOGO.jpg", import.meta.url));
  for (const path of fixturePhotoPaths) {
    await requireSuccess(
      await admin.storage.from("student-checkin-photos").upload(path, fixturePhoto, {
        contentType: "image/jpeg",
        cacheControl: "60",
        upsert: true,
      }),
      `upload student entry fixture photo ${path}`,
    );
  }

  const authResult = await admin.auth.admin.createUser({
    email: fixture.adminEmail,
    password: fixture.adminPassword,
    email_confirm: true,
    app_metadata: { capabilities: ["student_checkin_admin"], account_type: "codex_e2e_fixture" },
  });
  const authUser = await requireSuccess(authResult, "create admin auth fixture");

  await requireSuccess(
    await admin.from("profiles").upsert({
      id: authUser.user.id,
      tenant_id: fixture.tenantId,
      branch_id: fixture.branchId,
      role: "manager",
      display_name: "Codex 入場測試管理員",
      is_active: true,
      updated_at: new Date().toISOString(),
    }),
    "create admin profile fixture",
  );

  await requireSuccess(
    await admin.from("members").insert({
      id: fixture.memberId,
      tenant_id: fixture.tenantId,
      store_id: fixture.branchId,
      full_name: "Codex 正式學員測試",
      phone: "0900000202",
      phone_normalized: "0900000202",
      email: "codex-formal-entry@example.invalid",
      birth_date: "1992-02-02",
      status: "active",
      is_prospect: false,
    }),
    "create formal member fixture",
  );

  const now = new Date().toISOString();
  await requireSuccess(
    await admin.from("student_line_profiles").insert([
      {
        id: fixture.formalProfileId,
        line_user_id: null,
        full_name: "Codex 正式學員測試",
        phone: "0900000202",
        email: "codex-formal-entry@example.invalid",
        birth_date: "1992-02-02",
        password_hash: fixture.passwordHash,
        photo_path: "codex-fixtures/formal-profile.jpg",
        membership_starts_on: "2026-01-01",
        membership_expires_on: "2026-12-31",
        autonomous_checkin_enabled: true,
        is_active: true,
        must_complete_security_setup: false,
        email_verified_at: now,
        updated_at: now,
      },
      {
        id: fixture.nonMemberProfileId,
        line_user_id: null,
        full_name: "Codex 非學員測試",
        phone: "0900000203",
        email: "codex-nonmember-entry@example.invalid",
        birth_date: "1993-03-03",
        password_hash: fixture.passwordHash,
        photo_path: "codex-fixtures/nonmember-profile.jpg",
        autonomous_checkin_enabled: true,
        is_active: true,
        must_complete_security_setup: false,
        email_verified_at: now,
        updated_at: now,
      },
      {
        id: fixture.blockedProfileId,
        line_user_id: null,
        full_name: "Codex 帳號異常測試",
        phone: "0900000204",
        email: "codex-blocked-entry@example.invalid",
        birth_date: "1994-04-04",
        password_hash: fixture.passwordHash,
        photo_path: "codex-fixtures/blocked-profile.jpg",
        autonomous_checkin_enabled: true,
        is_active: true,
        must_complete_security_setup: false,
        email_verified_at: now,
        updated_at: now,
      },
    ]),
    "create student entry fixtures",
  );

  await requireSuccess(
    await admin.from("student_checkin_member_links").insert({
      student_profile_id: fixture.formalProfileId,
      member_id: fixture.memberId,
      match_method: "manual",
    }),
    "link formal member fixture",
  );
  await requireSuccess(
    await admin.from("student_checkin_access_blocks").insert({
      student_profile_id: fixture.blockedProfileId,
      internal_reason: "codex_e2e_fixture",
    }),
    "block fixture profile",
  );

  await requireSuccess(
    await admin.from("student_drop_in_entitlements").insert(
      [fixture.nonMemberProfileId, fixture.blockedProfileId].map((studentProfileId) => ({
        student_profile_id: studentProfileId,
        review_photo_path: `codex-fixtures/${studentProfileId}-review.jpg`,
        review_photo_uploaded_at: now,
        invoice_carrier: "/E2E-FIXTURE",
        gender: "female",
        activity_interest: "weight_training",
        discovery_source: "Codex controlled E2E fixture",
        terms_version: "2026-08-11",
        terms_accepted_at: now,
      })),
    ),
    "create drop-in fixture entitlements",
  );
}

if (mode === "setup") await setup();
else await cleanup();

console.log(JSON.stringify({
  ok: true,
  mode,
  fixture: {
    memberId: fixture.memberId,
    formalProfileId: fixture.formalProfileId,
    nonMemberProfileId: fixture.nonMemberProfileId,
    blockedProfileId: fixture.blockedProfileId,
    adminEmail: fixture.adminEmail,
  },
}));
