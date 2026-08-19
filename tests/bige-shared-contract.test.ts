import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("one legacy member number supports exactly three independent formal members", () => {
  const migration = readFileSync(
    "supabase/migrations/20260819200613_allow_three_members_per_legacy_number.sql",
    "utf8",
  );

  assert.match(migration, /select count\(distinct member_id\)/);
  assert.match(migration, /if shared_count >= 3 then/);
  assert.doesNotMatch(migration, /if shared_count >= 2 then/);
  assert.match(migration, /at most three distinct formal members/);
});

test("database regression covers shared eligibility, deduction, and restoration", () => {
  const regression = readFileSync(
    "tests/bige_shared_contract_three_members.sql",
    "utf8",
  );

  assert.match(regression, /member_plan_contract_members[\s\S]*'participant'/);
  assert.match(regression, /bige_member_can_use_contract/);
  assert.match(regression, /bige_complete_schedule_booking_without_pin/);
  assert.match(regression, /bige_restore_completed_schedule_booking/);
  assert.match(regression, /session_redemptions/);
  assert.match(regression, /rollback;/);
});
