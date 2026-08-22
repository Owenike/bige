import assert from "node:assert/strict";
import test from "node:test";
import { resolveSalesPerformanceOccurrence } from "../lib/staff-performance-sync";

test("FA first payment settles on the originating appointment date", () => {
  assert.deepEqual(resolveSalesPerformanceOccurrence({
    sourceType: "fa",
    paidAt: "2026-08-18T20:26:40.450Z",
    originBookingStartsAt: "2026-08-01T18:00:00+08:00",
  }), {
    businessDate: "2026-08-01",
    occurredAt: "2026-08-01T18:00:00+08:00",
    dateSource: "origin_booking",
  });
});

test("BB first payment settles on the originating appointment date", () => {
  assert.equal(resolveSalesPerformanceOccurrence({
    sourceType: "bb",
    paidAt: "2026-09-01T01:00:00+08:00",
    originBookingStartsAt: "2026-08-31T20:00:00+08:00",
  }).businessDate, "2026-08-31");
});

test("renewals and final payments retain the actual payment date", () => {
  for (const sourceType of ["renewal", "final_payment"] as const) {
    assert.deepEqual(resolveSalesPerformanceOccurrence({
      sourceType,
      paidAt: "2026-08-19T04:26:40+08:00",
      originBookingStartsAt: "2026-08-01T18:00:00+08:00",
    }), {
      businessDate: "2026-08-19",
      occurredAt: "2026-08-19T04:26:40+08:00",
      dateSource: "payment",
    });
  }
});

test("FA without a linked appointment safely falls back to the payment date", () => {
  assert.equal(resolveSalesPerformanceOccurrence({
    sourceType: "fa",
    paidAt: "2026-08-19T04:26:40+08:00",
    originBookingStartsAt: null,
  }).businessDate, "2026-08-19");
});
