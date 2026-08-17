import assert from "node:assert/strict";
import test from "node:test";
import {
  createTrialBookingScheduleNotePatch,
  normalizeTrialBookingScheduleNote,
  TRIAL_BOOKING_SCHEDULE_NOTE_MAX_LENGTH,
} from "../lib/trial-booking-schedule-note";

test("arrangement notes are stored separately from customer notes", () => {
  const patch = createTrialBookingScheduleNotePatch("  已安排週三 19:00  ");

  assert.deepEqual(patch, { schedule_note: "已安排週三 19:00" });
  assert.equal("note" in patch, false);
});

test("arrangement notes support blank values and enforce the storage limit", () => {
  assert.equal(normalizeTrialBookingScheduleNote("   "), null);
  assert.equal(
    normalizeTrialBookingScheduleNote("a".repeat(TRIAL_BOOKING_SCHEDULE_NOTE_MAX_LENGTH)),
    "a".repeat(TRIAL_BOOKING_SCHEDULE_NOTE_MAX_LENGTH),
  );
  assert.equal(
    normalizeTrialBookingScheduleNote("a".repeat(TRIAL_BOOKING_SCHEDULE_NOTE_MAX_LENGTH + 1)),
    null,
  );
});
