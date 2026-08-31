import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("legacy 79 data correction adds the missing shared member without deducting a class", () => {
  const migration = readFileSync(
    "supabase/migrations/20260831143905_add_zheng_hongyi_to_legacy_79_shared_contract.sql",
    "utf8",
  );

  assert.match(migration, /legacy\.legacy_number = '79'/);
  assert.match(migration, /member\.full_name = '鄭弘憶'/);
  assert.match(migration, /member_plan_contract_members[\s\S]*'participant'/);
  assert.match(migration, /bige_member_can_use_contract/);
  assert.match(migration, /legacy_79_migration_must_not_deduct_sessions/);
  assert.doesNotMatch(migration, /insert into public\.session_redemptions/i);
  assert.doesNotMatch(migration, /update public\.member_plan_contracts/i);
});

test("legacy 79 regression requires one owner and two eligible participants", () => {
  const regression = readFileSync("tests/legacy_79_shared_contract_members.sql", "utf8");

  assert.match(regression, /member\.full_name = '孫馧婷'[\s\S]*relationship = 'owner'/);
  assert.match(regression, /member\.full_name in \('鄭宏憶', '鄭弘憶'\)[\s\S]*relationship = 'participant'/);
  assert.match(regression, /bige_member_can_use_contract/);
});
