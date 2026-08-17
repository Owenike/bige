import assert from "node:assert/strict";
import test from "node:test";
import { calculateEmployeePayroll, calculateStatutoryDeductions, nextMonthPayDates, regularMinutesFromPunches } from "../lib/staff-payroll";
import { resolveCourseFeeTier } from "../lib/staff-performance";

test("full-time monthly salary starts at 29,500 and sick leave deducts only half pay", () => {
  const result = calculateEmployeePayroll({
    employment: { employeeId: "one", employmentType: "full_time", payBasis: "monthly", monthlySalary: 29500, hourlyRate: 196 },
    regularMinutes: 10_000,
    leaves: [{ leaveType: "sick", minutes: 480 }],
  });
  assert.equal(result.basePay, 29500);
  assert.equal(result.leaveDeduction, 491.67);
  assert.equal(result.grossPay, 29008.33);
});

test("part-time pay uses NT$196 and preserves minute precision", () => {
  const result = calculateEmployeePayroll({
    employment: { employeeId: "two", employmentType: "part_time", payBasis: "hourly", monthlySalary: 29500, hourlyRate: 196 },
    regularMinutes: 421,
  });
  assert.equal(result.basePay, 1375.27);
});

test("actual regular-workday overtime is calculated instead of being discarded for lack of preapproval", () => {
  const result = calculateEmployeePayroll({
    employment: { employeeId: "one", employmentType: "full_time", payBasis: "monthly", monthlySalary: 29500, hourlyRate: 196 },
    regularMinutes: 0,
    overtime: [{ dayType: "regular_workday", minutes: 90 }],
  });
  assert.ok(result.overtimePay > 0);
  assert.equal(result.overtimeMinutes, 90);
});

test("salary and bonus pay dates are the next month 10th and 25th", () => {
  assert.deepEqual(nextMonthPayDates("2026-08-01"), { basePayDate: "2026-09-10", bonusPayDate: "2026-09-25" });
});

test("actual punches are calculated to the minute but extra early/late presence is not automatic work", () => {
  assert.equal(regularMinutesFromPunches({ workDate: "2026-08-05", scheduledStartsAt: "09:30", scheduledEndsAt: "16:30", firstPunchAt: "2026-08-05T09:35:00+08:00", lastPunchAt: "2026-08-05T17:10:00+08:00", breakMinutes: 30, paidBreak: true }), 415);
  assert.equal(regularMinutesFromPunches({ workDate: "2026-08-05", scheduledStartsAt: "10:00", scheduledEndsAt: "19:00", firstPunchAt: "2026-08-05T09:50:00+08:00", lastPunchAt: "2026-08-05T19:30:00+08:00", breakMinutes: 60, paidBreak: false }), 480);
});

test("statutory deductions use configured rates, dependents and voluntary pension without guessing", () => {
  const result = calculateStatutoryDeductions({
    enrollments: [
      { insuranceType: "labor", status: "active", insuredSalary: 30000 },
      { insuranceType: "health", status: "active", insuredSalary: 30000, dependents: 1 },
      { insuranceType: "pension", status: "active", insuredSalary: 30000, voluntaryPensionRate: 0.03 },
    ],
    rates: [
      { rateType: "labor_insurance", configuration: { employeeRate: 0.02 } },
      { rateType: "health_insurance", configuration: { employeeRate: 0.015, maxDependents: 3 } },
    ],
  });
  assert.equal(result.laborInsuranceEmployee, 600);
  assert.equal(result.healthInsuranceEmployee, 900);
  assert.equal(result.pensionEmployee, 900);
  assert.equal(result.total, 2400);
  assert.equal(result.ready, true);
});

test("full-time course fee requires both sales and completed-session thresholds", () => {
  assert.equal(resolveCourseFeeTier({ employmentType: "full_time", salesAmount: 350_000, completedSessions: 139 }).sessionRate, 455);
  assert.equal(resolveCourseFeeTier({ employmentType: "full_time", salesAmount: 350_000, completedSessions: 140 }).sessionRate, 520);
  assert.equal(resolveCourseFeeTier({ employmentType: "full_time", salesAmount: 199_999, completedSessions: 200 }).sessionRate, 250);
});

test("part-time course fee uses sales thresholds without a session minimum", () => {
  const result = resolveCourseFeeTier({ employmentType: "part_time", salesAmount: 250_000, completedSessions: 3 });
  assert.equal(result.sessionRate, 360);
  assert.equal(result.courseFeeAmount, 1080);
});

test("refunds reduce current-month sales before resolving the tier", () => {
  const result = resolveCourseFeeTier({ employmentType: "part_time", salesAmount: 260_000 - 20_000, completedSessions: 10 });
  assert.equal(result.sessionRate, 280);
});

test("official 2026 fixed premium table uses NT$738 labor and NT$458 per health-insured person at 29,500", () => {
  const result = calculateStatutoryDeductions({
    enrollments: [
      { insuranceType: "labor", status: "active", insuredSalary: 29500 },
      { insuranceType: "health", status: "active", insuredSalary: 29500, dependents: 1 },
      { insuranceType: "pension", status: "active", insuredSalary: 29500, voluntaryPensionRate: 0 },
    ],
    rates: [
      { rateType: "labor_insurance", configuration: { employeeAmountBySalary: { "29500": 738 } } },
      { rateType: "health_insurance", configuration: { employeeAmountBySalary: { "29500": 458 }, maxDependents: 3 } },
    ],
  });
  assert.equal(result.laborInsuranceEmployee, 738);
  assert.equal(result.healthInsuranceEmployee, 916);
  assert.equal(result.pensionEmployee, 0);
  assert.equal(result.total, 1654);
  assert.equal(result.ready, true);
});
