import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTrialBookingContactNote,
  TRIAL_BOOKING_CONTACT_NOTE_MAX_LENGTH,
} from "../lib/trial-booking-contact";

test("contact notes are required and trimmed", () => {
  assert.equal(normalizeTrialBookingContactNote(undefined), null);
  assert.equal(normalizeTrialBookingContactNote("   "), null);
  assert.equal(normalizeTrialBookingContactNote("  已電話聯繫，週三回覆  "), "已電話聯繫，週三回覆");
});

test("contact notes enforce the storage limit", () => {
  assert.equal(
    normalizeTrialBookingContactNote("a".repeat(TRIAL_BOOKING_CONTACT_NOTE_MAX_LENGTH)),
    "a".repeat(TRIAL_BOOKING_CONTACT_NOTE_MAX_LENGTH),
  );
  assert.equal(normalizeTrialBookingContactNote("a".repeat(TRIAL_BOOKING_CONTACT_NOTE_MAX_LENGTH + 1)), null);
});
