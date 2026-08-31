import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260831224504_allow_fa_drag_before_existing_class.sql",
  "utf8",
);
const scheduleBoard = readFileSync("components/bige-fitness-operations.tsx", "utf8");
const sqlRegression = readFileSync("tests/bige_schedule_drag_roundtrip.sql", "utf8");

test("FA drag occupancy uses the leading hour while preserving the two-hour record", () => {
  assert.match(migration, /source_uses_single_cell boolean := false/);
  assert.match(migration, /source_is_fa and \(/);
  assert.match(migration, /target_primary\.id is null/);
  assert.match(migration, /least\(moved\.ends_at, moved\.starts_at \+ interval '1 hour'\)/);
  assert.match(migration, /new_occupancy_ends_at/);
  assert.match(migration, /when booking\.operation_kind = 'trial'/);
  assert.match(migration, /when restored\.operation_kind = 'trial'/);
});

test("daily schedule renders the following class instead of the spanning FA", () => {
  assert.match(scheduleBoard, /findScheduleBookingForTaipeiHour/);
  assert.match(scheduleBoard, /scheduleBookingDisplayEndMs/);
});

test("database regression keeps and restores the following-hour booking", () => {
  assert.match(sqlRegression, /test:drag-roundtrip:leading-fa/);
  assert.match(sqlRegression, /test:drag-roundtrip:following-target/);
  assert.match(sqlRegression, /jsonb_array_length\(leading_fa_move -> 'items'\) <> 1/);
  assert.match(sqlRegression, /leading_fa_undo/);
});
