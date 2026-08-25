import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BIGE_EXPLICIT_TRIAL_STAGES,
  createScheduleSchema,
} from "../lib/bige-fitness";

const baseSchedule = {
  action: "create_schedule" as const,
  branchId: null,
  memberId: null,
  trialBookingId: "00000000-0000-4000-8000-000000000021",
  coachId: "00000000-0000-4000-8000-000000000022",
  operationKind: "trial" as const,
  courseType: "weight_training" as const,
  startsAt: "2026-09-06T13:00:00+08:00",
  endsAt: "2026-09-06T15:00:00+08:00",
  note: null,
  groupId: null,
  idempotencyKey: "test:explicit-fa-stage",
};

test("single schedule input accepts FA2 and FAN while keeping automatic FA available", () => {
  assert.deepEqual(BIGE_EXPLICIT_TRIAL_STAGES, ["FA2", "FAN"]);
  assert.equal(createScheduleSchema.safeParse(baseSchedule).success, true);
  assert.equal(
    createScheduleSchema.safeParse({ ...baseSchedule, trialStage: "FA2" }).success,
    true,
  );
  assert.equal(
    createScheduleSchema.safeParse({ ...baseSchedule, trialStage: "FAN" }).success,
    true,
  );
});

test("explicit FA stages cannot be attached to PT, BB, or arbitrary values", () => {
  assert.equal(
    createScheduleSchema.safeParse({
      ...baseSchedule,
      memberId: "00000000-0000-4000-8000-000000000023",
      trialBookingId: null,
      operationKind: "pt",
      trialStage: "FA2",
    }).success,
    false,
  );
  assert.equal(
    createScheduleSchema.safeParse({
      ...baseSchedule,
      operationKind: "bb",
      courseType: null,
      trialStage: "FAN",
    }).success,
    false,
  );
  assert.equal(
    createScheduleSchema.safeParse({ ...baseSchedule, trialStage: "FA1" }).success,
    false,
  );
});

test("single-schedule UI and API preserve an explicitly selected FA stage", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(component, /<option value="trial:FA2">FA2<\/option>/);
  assert.match(component, /<option value="trial:FAN">FAN<\/option>/);
  assert.match(component, /trialStage:\s*scheduleDraft\.operationKind === "trial"/);
  assert.match(component, /trial_stage:\s*scheduleDraft\.operationKind === "trial"/);
  assert.equal(
    [...route.matchAll(/rpc\("bige_create_schedule_booking_v3"/g)].length,
    1,
  );
  assert.equal(
    [...route.matchAll(/rpc\("bige_create_schedule_booking_v2"/g)].length,
    2,
  );
  assert.match(route, /p_trial_stage: input\.trialStage \|\| null/);
});

test("database wrapper validates and persists only the supported explicit stages", () => {
  const migration = readFileSync(
    "supabase/migrations/20260825170518_explicit_fa_stage_schedule.sql",
    "utf8",
  );

  assert.match(migration, /p_trial_stage not in \('FA2', 'FAN'\)/);
  assert.match(migration, /set trial_stage = p_trial_stage/);
  assert.match(migration, /'\{trialStage\}'/);
  assert.match(migration, /idempotency_key_conflict/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.bige_create_schedule_booking_v3/);
  assert.match(migration, /to authenticated, service_role/);
});
