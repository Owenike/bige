import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("legacy 79 correction merges the misspelled member without changing the deduction", () => {
  const migration = readFileSync(
    "supabase/migrations/20260831150110_merge_misspelled_legacy_79_member.sql",
    "utf8",
  );

  assert.match(migration, /legacy\.legacy_number = '79'/);
  assert.match(migration, /member\.full_name = '鄭宏憶'/);
  assert.match(migration, /member\.full_name = '鄭弘憶'/);
  assert.match(migration, /update public\.bookings[\s\S]*canonical_member_id/);
  assert.match(migration, /update public\.session_redemptions[\s\S]*canonical_member_id/);
  assert.match(migration, /update public\.notification_deliveries[\s\S]*canonical_member_id/);
  assert.match(migration, /delete from public\.members/);
  assert.match(migration, /bige_member_can_use_contract/);
  assert.match(migration, /legacy_79_identity_merge_must_not_change_deduction/);
  assert.doesNotMatch(migration, /insert into public\.session_redemptions/i);
  assert.doesNotMatch(migration, /update public\.member_plan_contracts/i);
});

test("legacy 79 regression requires only the real owner and participant", () => {
  const regression = readFileSync("tests/legacy_79_shared_contract_members.sql", "utf8");

  assert.match(regression, /member\.full_name = '孫馧婷'[\s\S]*relationship = 'owner'/);
  assert.match(regression, /member\.full_name = '鄭宏憶'[\s\S]*relationship = 'participant'/);
  assert.match(regression, /member\.full_name = '鄭弘憶'[\s\S]*raise exception 'misspelled legacy 79 member still exists'/);
  assert.match(regression, /bige_member_can_use_contract/);
});
