import assert from "node:assert/strict";
import test from "node:test";
import { detectAttendanceAnomalies, LATE_CLOCK_OUT_CONFIRMATION } from "../lib/staff-attendance";

const schedule = {
  employeeId: "employee-1",
  workDate: "2026-08-05",
  entryKind: "work" as const,
  startsAt: "13:00",
  endsAt: "22:00",
};

test("thresholds notify only after more than 5 late/early minutes and more than 15 late clock-out minutes", () => {
  const within = detectAttendanceAnomalies({
    row: { employeeNumberRaw: "01", employeeNameRaw: "測試", workDate: schedule.workDate, punchTimes: ["13:05", "22:15"], rawRows: [], sourceOrderOutOfOrder: false },
    employeeId: schedule.employeeId,
    schedule,
  });
  assert.equal(within.length, 0);
  const outside = detectAttendanceAnomalies({
    row: { employeeNumberRaw: "01", employeeNameRaw: "測試", workDate: schedule.workDate, punchTimes: ["13:06", "22:16"], rawRows: [], sourceOrderOutOfOrder: false },
    employeeId: schedule.employeeId,
    schedule,
  });
  assert.deepEqual(outside.map((item) => item.anomalyType), ["late", "late_clock_out"]);
});

test("one punch is preserved and classified as a missing counterpart", () => {
  const anomalies = detectAttendanceAnomalies({
    row: { employeeNumberRaw: "01", employeeNameRaw: null, workDate: schedule.workDate, punchTimes: ["13:01"], rawRows: [], sourceOrderOutOfOrder: false },
    employeeId: schedule.employeeId,
    schedule,
  });
  assert.equal(anomalies[0]?.anomalyType, "missing_out");
});

test("late checkout statement does not waive actual work", () => {
  assert.equal(LATE_CLOCK_OUT_CONFIRMATION, "系統偵測您於排定下班時間後打卡。本人確認下班後僅從事私人活動或自主運動，未提供勞務或待命。");
});
