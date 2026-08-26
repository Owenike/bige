import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createRoute = readFileSync("app/api/admin/trial-bookings/route.ts", "utf8");

test("direct trial booking creation links the booking to the coach schedule before LINE notification", () => {
  const createHandlerStart = createRoute.indexOf("export async function POST");
  assert.notEqual(createHandlerStart, -1, "missing direct trial booking create handler");

  const createHandler = createRoute.slice(createHandlerStart);
  const trialInsert = createHandler.indexOf('.from("trial_bookings")');
  const scheduleRpc = createHandler.indexOf('.rpc("bige_create_schedule_booking_v2"');
  const lineNotification = createHandler.indexOf("sendLineScheduledTrialBookingNotification({");

  assert.notEqual(trialInsert, -1, "direct create must persist the trial booking");
  assert.notEqual(scheduleRpc, -1, "direct create must create the linked coach schedule booking");
  assert.notEqual(lineNotification, -1, "direct create must keep the existing LINE notification");
  assert.ok(trialInsert < scheduleRpc, "the trial booking id must exist before schedule creation");
  assert.ok(scheduleRpc < lineNotification, "LINE must be sent only after schedule creation succeeds");
  assert.match(createHandler, /p_trial_booking_id:\s*insertedBooking\.id/);
  assert.match(createHandler, /p_operation_kind:\s*"trial"/);
  assert.match(createHandler, /p_idempotency_key:\s*`trial-admin-schedule:\$\{insertedBooking\.id\}`/);
  assert.match(createHandler, /normalizeBigeScheduleEndAt\("trial", startsAt, startsAt\)/);
});

test("a failed schedule link removes the unnotified direct-create placeholder", () => {
  const createHandlerStart = createRoute.indexOf("export async function POST");
  assert.notEqual(createHandlerStart, -1, "missing direct trial booking create handler");

  const createHandler = createRoute.slice(createHandlerStart);
  assert.match(
    createHandler,
    /if \(scheduleResult\.error\) \{[\s\S]*?\.from\("trial_bookings"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("id", insertedBooking\.id\)/,
  );
  assert.match(createHandler, /scheduleErrorMessage\(scheduleResult\.error\.message\)/);
});
