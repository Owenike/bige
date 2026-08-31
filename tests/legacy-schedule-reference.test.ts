import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260821133000_legacy_schedule_reference_warnings.sql",
  "utf8",
);
const legacyDragMigration = readFileSync(
  "supabase/migrations/20260831214000_allow_legacy_schedule_booking_drag.sql",
  "utf8",
);
const trialScheduleRoute = readFileSync(
  "app/api/admin/trial-bookings/[id]/schedule/route.ts",
  "utf8",
);
const scheduleBoard = readFileSync("components/bige-fitness-operations.tsx", "utf8");

test("legacy appointment-book rows remain visible non-blocking references", () => {
  assert.match(migration, /operation_idempotency_key, ''\) like 'legacy-august:%'/);
  assert.match(migration, /not like ''legacy-august:%''/);
  assert.match(migration, /new\.source = 'legacy_schedule_import'/);
  assert.match(migration, /source is distinct from 'legacy_schedule_import'/);
  assert.match(migration, /legacy_schedule_reference_conflict/);
  assert.match(migration, /僅供對照，不阻擋本次安排/);
  assert.match(migration, /legacy_schedule_reference_read_only/);
  assert.match(migration, /bige_drag_schedule_booking/);
  assert.match(migration, /bige_enforce_bb_exclusive_schedule/);
  assert.match(migration, /bige_create_bb_schedule_booking_v1/);
});

test("active legacy appointment-book bookings can move without taking overlapping formal rows", () => {
  assert.match(legacyDragMigration, /source_is_legacy boolean := false/);
  assert.match(legacyDragMigration, /booking\.id = source_booking\.id/);
  assert.match(legacyDragMigration, /not source_is_legacy or moved\.id <> source_booking\.id/);
  assert.match(legacyDragMigration, /legacy_schedule_reference_read_only/);
  assert.match(legacyDragMigration, /grant execute on function public\.bige_drag_schedule_booking/);
});

test("trial scheduling reports reference overlaps as readable success warnings", () => {
  assert.match(trialScheduleRoute, /scheduleSuccessMessage/);
  assert.match(trialScheduleRoute, /legacy_schedule_reference_conflict/);
  assert.match(trialScheduleRoute, /本次安排已保留/);
  assert.match(trialScheduleRoute, /scheduleErrorMessage/);
  assert.match(trialScheduleRoute, /這位客戶在同一時段已有正式預約/);
  assert.doesNotMatch(
    trialScheduleRoute,
    /error: scheduleResult\.error\.message\.split\("\\n"\)/,
  );
});

test("daily schedule confirms creation and displays the legacy reference warning", () => {
  assert.match(scheduleBoard, /created\?\.warnings\?\.find/);
  assert.match(scheduleBoard, /legacy_schedule_reference_conflict/);
  assert.match(scheduleBoard, /排課已建立；同時段有/);
  assert.match(scheduleBoard, /舊預約本資料，僅供對照/);
  assert.match(scheduleBoard, /isScheduleBookingDraggable/);
  assert.doesNotMatch(scheduleBoard, /舊預約本資料僅供對照，不能移動或覆蓋/);
  assert.match(scheduleBoard, /舊預約本有資料，已保留並建立/);
});
