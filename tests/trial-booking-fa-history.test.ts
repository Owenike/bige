import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesTrialFaHistorySearch,
  resolveTrialFaHistoryCustomer,
  type TrialFaHistoryItem,
} from "../lib/trial-booking-fa-history";

const historyItem: TrialFaHistoryItem = {
  id: "booking-1",
  trialBookingId: "trial-1",
  name: "王小明",
  phone: "0912345678",
  birthday: "1992-03-04",
  memberCode: null,
  service: "pilates",
  trialStage: "FA1",
  startsAt: "2026-08-10T06:00:00.000Z",
  endsAt: "2026-08-10T08:00:00.000Z",
  recordedAt: "2026-08-10T08:10:00.000Z",
  bookingCoach: "櫃台Annie",
  executingCoach: "Wiwi",
  source: "official_line",
  originalAppointmentDate: "2026-08-10",
  originalAppointmentTime: "14:00",
  originalNote: null,
  scheduleNote: null,
  operationNote: null,
};

test("FA history prefers the original trial customer details", () => {
  assert.deepEqual(
    resolveTrialFaHistoryCustomer({
      trialBooking: { name: " 王小明 ", phone: "0912345678", birthday: "1992-03-04" },
      member: { full_name: "正式會員姓名", phone: "0987654321", birth_date: "1990-01-01", member_code: "B001" },
    }),
    {
      name: "王小明",
      phone: "0912345678",
      birthday: "1992-03-04",
      memberCode: "B001",
    },
  );
});

test("FA history falls back to member details for imported schedules", () => {
  assert.deepEqual(
    resolveTrialFaHistoryCustomer({
      member: { full_name: "陳小華", phone: "0900000000", birth_date: "1995-05-06", member_code: null },
    }),
    {
      name: "陳小華",
      phone: "0900000000",
      birthday: "1995-05-06",
      memberCode: null,
    },
  );
});

test("FA history search covers customer, phone, service and coach details", () => {
  assert.equal(matchesTrialFaHistorySearch(historyItem, "小明"), true);
  assert.equal(matchesTrialFaHistorySearch(historyItem, "0912"), true);
  assert.equal(matchesTrialFaHistorySearch(historyItem, "pilates"), true);
  assert.equal(matchesTrialFaHistorySearch(historyItem, "wiwi"), true);
  assert.equal(matchesTrialFaHistorySearch(historyItem, "Becky"), false);
});
