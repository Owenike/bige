import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTrialBookingSource,
  trialBookingSourceLabel,
  trialBookingSourceValues,
} from "../lib/trial-booking-sources";

test("trial booking sources include operational and legacy import sources", () => {
  assert.deepEqual(trialBookingSourceValues, [
    "website",
    "official_line",
    "walk_in",
    "phone_booking",
    "br",
    "legacy_schedule_import",
  ]);
  assert.equal(trialBookingSourceLabel("phone_booking"), "來電預約");
  assert.equal(trialBookingSourceLabel("br"), "BR");
  assert.equal(trialBookingSourceLabel("legacy_schedule_import"), "舊預約本匯入");
});

test("unknown legacy source safely falls back to website", () => {
  assert.equal(normalizeTrialBookingSource("website_trial_booking"), "website");
  assert.equal(trialBookingSourceLabel(null), "網站");
});
