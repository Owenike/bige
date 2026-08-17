import assert from "node:assert/strict";
import test from "node:test";
import {
  trialBookingAssigneeOptions,
  trialBookingCoachLabel,
  trialBookingCoachOptions,
} from "../lib/trial-booking-coaches";

test("trial booking coach labels prefer the English name used by the schedule board", () => {
  assert.equal(
    trialBookingCoachLabel({ english_name: " Wiwi ", display_name: "林純葳" }),
    "Wiwi",
  );
});

test("trial booking coach labels keep a safe fallback", () => {
  assert.equal(trialBookingCoachLabel({ english_name: null, display_name: "Becky" }), "Becky");
  assert.equal(trialBookingCoachLabel({ english_name: "", display_name: "" }), "Coach");
});

test("trial booking coach options preserve ids and prefer English labels", () => {
  assert.deepEqual(
    trialBookingCoachOptions([
      {
        id: "coach-1",
        english_name: " Wade ",
        display_name: "教練組長",
        branch_id: "branch-1",
      },
    ]),
    [{ id: "coach-1", label: "Wade", branchId: "branch-1" }],
  );
});

test("booking coach options include the front desk defaults and every active coach", () => {
  assert.deepEqual(
    trialBookingAssigneeOptions(["Becky", "Lily", "Una", "Wiwi"]),
    ["櫃台Annie", "櫃台Miffy", "Becky", "Lily", "Una", "Wiwi"],
  );
});

test("booking coach options remove duplicate and blank labels", () => {
  assert.deepEqual(
    trialBookingAssigneeOptions([" Becky ", "becky", "", "櫃台Annie"]),
    ["櫃台Annie", "櫃台Miffy", "Becky"],
  );
});
