import assert from "node:assert/strict";
import test from "node:test";
import { hasAuthCapability, readAuthCapabilities } from "../lib/auth-capabilities";

test("reads legacy and multi-area auth capabilities", () => {
  assert.deepEqual(readAuthCapabilities({ account_area: "student_checkin_admin" }), [
    "student_checkin_admin",
  ]);
  assert.deepEqual(
    readAuthCapabilities({
      account_areas: ["student_checkin_admin", "trial_booking_admin", "unknown"],
    }),
    ["student_checkin_admin", "trial_booking_admin"],
  );
});

test("ignores malformed or untrusted capability values", () => {
  assert.deepEqual(readAuthCapabilities(null), []);
  assert.deepEqual(readAuthCapabilities({ capabilities: [1, false, "manager"] }), []);
  assert.equal(
    hasAuthCapability({ capabilities: ["trial_booking_admin"] }, "trial_booking_admin"),
    true,
  );
});
