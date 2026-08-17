import assert from "node:assert/strict";
import test from "node:test";
import {
  studentDropInPlanDetails,
  studentDropInRemainingUses,
} from "../lib/student-drop-in-plan";

test("review reward plan keeps the existing NT$50, photo, and ten-use rules", () => {
  assert.deepEqual(studentDropInPlanDetails("review_50"), {
    priceTwd: 50,
    reviewPhotoRequired: true,
    unlimitedUses: false,
    label: "50 元入場",
  });
  assert.equal(studentDropInRemainingUses({ plan: "review_50", totalUses: 10, usedUses: 4 }), 6);
});

test("standard NT$100 plan needs no review photo and never exhausts", () => {
  assert.deepEqual(studentDropInPlanDetails("standard_100"), {
    priceTwd: 100,
    reviewPhotoRequired: false,
    unlimitedUses: true,
    label: "100 元入場",
  });
  assert.equal(studentDropInRemainingUses({ plan: "standard_100", totalUses: 10, usedUses: 250 }), null);
});
