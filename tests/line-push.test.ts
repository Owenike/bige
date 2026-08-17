import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduledTrialBookingNotificationText } from "../lib/line-push";

test("scheduled trial notifications use a distinct internal task layout", () => {
  const text = buildScheduledTrialBookingNotificationText({
    appointmentDate: "2026-08-02",
    appointmentTime: "16:00",
    service: "器械皮拉提斯",
    name: "王小明",
    phone: "0912345678",
    bookingCoach: "櫃台 Annie",
    executingCoach: "Wiwi",
    source: "現場",
    note: "第一次體驗",
  });

  assert.equal(
    text,
    [
      "🔔 BIG E｜教練執行任務",
      "【已完成排課】",
      "━━━━━━━━━━━━━━",
      "",
      "01｜課程資訊",
      "日期｜8/2",
      "時間｜16:00",
      "項目｜器械皮拉提斯",
      "",
      "02｜體驗客戶",
      "姓名｜王小明",
      "電話｜0912345678",
      "來源｜現場",
      "",
      "03｜負責人員",
      "預約窗口｜櫃台 Annie",
      "執行教練｜Wiwi",
      "",
      "04｜備註",
      "第一次體驗",
      "",
      "📌 執行提醒",
      "請執行教練於課前確認課表與客戶狀況。",
    ].join("\n"),
  );
  assert.equal(text.includes("BigE 新首次體驗預約"), false);
  assert.equal(text.includes("請協助聯繫確認實際體驗時段"), false);
});

test("scheduled trial notifications show an explicit empty note", () => {
  const text = buildScheduledTrialBookingNotificationText({
    appointmentDate: "2026-08-02",
    appointmentTime: "16:00",
    service: "重訓",
    name: "王小明",
    phone: "0912345678",
    bookingCoach: "櫃台 Miffy",
    executingCoach: "Becky",
    source: "網站",
    note: "   ",
  });

  assert.match(text, /04｜備註\n無\n/);
});
