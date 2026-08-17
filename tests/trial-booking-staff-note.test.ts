import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTrialBookingStaffNote,
  TRIAL_BOOKING_STAFF_NOTE_MAX_LENGTH,
  trialBookingStaffNoteUpdateMatch,
} from "../lib/trial-booking-staff-note";

test("staff note is trimmed without becoming a contact record", () => {
  assert.deepEqual(parseTrialBookingStaffNote("  下週再追蹤  "), {
    ok: true,
    note: "下週再追蹤",
  });
});

test("blank staff note clears the saved note", () => {
  assert.deepEqual(parseTrialBookingStaffNote("   "), { ok: true, note: null });
});

test("staff note rejects non-string and oversized values", () => {
  assert.equal(parseTrialBookingStaffNote(null).ok, false);
  assert.equal(parseTrialBookingStaffNote("a".repeat(TRIAL_BOOKING_STAFF_NOTE_MAX_LENGTH + 1)).ok, false);
});

test("staff note update only filters on columns that exist on trial_bookings", () => {
  assert.deepEqual(trialBookingStaffNoteUpdateMatch("booking-id"), { id: "booking-id" });
});
