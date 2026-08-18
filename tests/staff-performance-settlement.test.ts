import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateRefundByOriginal,
  buildDefaultSalesAllocations,
  classifyCompletedSessionsAgainstShift,
  contractThresholdEpoRule,
  evaluateDailyTop,
  sessionLoadEpoRule,
  validateSalesAllocations,
} from "../lib/staff-performance-settlement";

test("FA and renewal default half of the received amount to the origin coach", () => {
  assert.deepEqual(buildDefaultSalesAllocations({ amount: 100_001, sourceType: "fa", originEmployeeId: "coach-a" }), {
    allocations: [{ employeeId: "coach-a", amount: 50_000.5, allocationKind: "origin_default" }],
    allocatedAmount: 50_000.5,
    remainingAmount: 50_000.5,
  });
  assert.equal(buildDefaultSalesAllocations({ amount: 80_000, sourceType: "final_payment", originEmployeeId: "coach-a" }).allocatedAmount, 0);
});

test("sales allocations must add up exactly and cannot repeat an employee", () => {
  assert.equal(validateSalesAllocations(100_000, [{ employeeId: "a", amount: 60_000 }, { employeeId: "b", amount: 40_000 }]).valid, true);
  assert.equal(validateSalesAllocations(100_000, [{ employeeId: "a", amount: 60_000 }]).remainingAmount, 40_000);
  assert.throws(() => validateSalesAllocations(100_000, [{ employeeId: "a", amount: 50_000 }, { employeeId: "a", amount: 50_000 }]), /重複分配/);
});

test("refunds reverse the exact original recipients with deterministic cent rounding", () => {
  const reversal = allocateRefundByOriginal({
    refundAmount: 50_001,
    originalAllocations: [
      { id: "one", employeeId: "a", amount: 60_000 },
      { id: "two", employeeId: "b", amount: 40_000 },
    ],
  });
  assert.deepEqual(reversal.map(({ employeeId, amount, sourceAllocationId }) => ({ employeeId, amount, sourceAllocationId })), [
    { employeeId: "a", amount: -30_000.6, sourceAllocationId: "one" },
    { employeeId: "b", amount: -20_000.4, sourceAllocationId: "two" },
  ]);
  assert.equal(reversal.reduce((sum, item) => sum + item.amount, 0), -50_001);
});

test("each qualifying new or renewal contract receives one threshold EPO", () => {
  assert.equal(contractThresholdEpoRule({ sourceType: "fa", totalSessions: 72 }).eligible, true);
  assert.equal(contractThresholdEpoRule({ sourceType: "renewal", totalSessions: 48 }).eligible, true);
  assert.equal(contractThresholdEpoRule({ sourceType: "fa", totalSessions: 71 }).eligible, false);
  assert.equal(contractThresholdEpoRule({ sourceType: "final_payment", totalSessions: 100 }).eligible, false);
});

test("daily top uses pre-allocation actual receipts, excludes refunds, and exposes ties", () => {
  const top = evaluateDailyTop([
    { employeeId: "a", amount: 50_000 },
    { employeeId: "a", amount: 20_000 },
    { employeeId: "b", amount: 70_000 },
    { employeeId: "c", amount: 200_000, refunded: true },
  ]);
  assert.equal(top.status, "tie");
  assert.equal(top.amount, 70_000);
  assert.deepEqual(top.candidateEmployeeIds, ["a", "b"]);
});

test("session-load EPO counts only completed PT sessions supplied to the shift classifier", () => {
  const classified = classifyCompletedSessionsAgainstShift({
    shiftStartsAt: "10:00",
    shiftEndsAt: "19:00",
    sessions: [
      { startsAt: "2026-08-19T02:00:00.000Z", endsAt: "2026-08-19T03:00:00.000Z" },
      { startsAt: "2026-08-19T11:00:00.000Z", endsAt: "2026-08-19T12:00:00.000Z" },
      { startsAt: "2026-08-19T10:30:00.000Z", endsAt: "2026-08-19T11:30:00.000Z" },
    ],
  });
  assert.deepEqual(classified, { ready: true, inside: 1, outside: 1, boundary: 1 });
  assert.equal(sessionLoadEpoRule({ employmentType: "full_time", insideSessions: 6, outsideSessions: 2 }).eligible, true);
  assert.equal(sessionLoadEpoRule({ employmentType: "part_time", insideSessions: 3, outsideSessions: 1 }).eligible, true);
});
