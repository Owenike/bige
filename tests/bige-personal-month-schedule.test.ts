import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bigePersonalMonthRange,
  collectBigePersonalMonthDayStatuses,
  isBigePersonalMonth,
  listBigePersonalMonthDates,
  shiftBigePersonalMonth,
} from "../lib/bige-personal-month-schedule";

test("personal month values produce exact Taipei month boundaries and dates", () => {
  assert.equal(isBigePersonalMonth("2026-09"), true);
  assert.equal(isBigePersonalMonth("2026-13"), false);
  assert.equal(isBigePersonalMonth("2026-9"), false);
  assert.deepEqual(bigePersonalMonthRange("2026-12"), {
    start: "2026-12-01T00:00:00+08:00",
    end: "2027-01-01T00:00:00+08:00",
  });
  assert.equal(listBigePersonalMonthDates("2028-02").length, 29);
  const septemberDates = listBigePersonalMonthDates("2026-09");
  assert.equal(septemberDates[septemberDates.length - 1], "2026-09-30");
  assert.equal(shiftBigePersonalMonth("2026-01", -1), "2025-12");
  assert.equal(shiftBigePersonalMonth("2026-12", 1), "2027-01");
});

test("personal month statuses remain separated by Taipei business date", () => {
  const statuses = collectBigePersonalMonthDayStatuses(
    [
      { coach_id: "coach-1", starts_at: "2026-09-02T00:00:00+08:00", content: "休" },
      { coach_id: "coach-1", starts_at: "2026-09-02T01:00:00+08:00", content: "10:00-19:00" },
      { coach_id: "coach-1", starts_at: "2026-09-03T00:00:00+08:00", content: "晚" },
      { coach_id: "coach-2", starts_at: "2026-09-04T00:00:00+08:00", content: "休" },
    ],
    "coach-1",
  );

  assert.deepEqual(statuses, [
    { businessDate: "2026-09-02", coach_id: "coach-1", status: "early", label: "早班" },
    { businessDate: "2026-09-03", coach_id: "coach-1", status: "late", label: "晚班" },
  ]);
});

test("personal month API is server-scoped to the signed-in coach", () => {
  const route = readFileSync("app/api/bige-fitness/personal-month/route.ts", "utf8");

  assert.match(route, /requireProfile\(\["coach"\], request\)/);
  assert.match(route, /const coachId = auth\.context\.userId/);
  assert.equal(route.match(/\.eq\("coach_id", coachId\)/g)?.length, 2);
  assert.doesNotMatch(route, /searchParams\.get\("coachId"\)/);
  assert.match(route, /shouldShowBigeScheduleBookingOnDailyBoard\(booking\)/);
  assert.match(route, /collectBigePersonalMonthDayStatuses\(rawNotes, coachId\)/);
  assert.match(route, /trial_conversion_outcome, bb_conversion_outcome/);
  assert.match(route, /reminder_status, converted_at/);
  assert.match(route, /phone, email, email_unavailable, birth_date, member_code, is_prospect/);
  assert.match(route, /id, name, phone, birthday, service/);
  assert.match(route, /\.from\("bige_member_legacy_numbers"\)/);
});

test("coach navigation inserts personal month between daily and staff schedules", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const navigation = component.slice(
    component.indexOf('<nav className={styles.tabs} aria-label="營運功能">'),
    component.indexOf("</nav>", component.indexOf('<nav className={styles.tabs} aria-label="營運功能">')),
  );

  assert.ok(navigation.indexOf("日排課表") < navigation.indexOf("整月課表"));
  assert.ok(navigation.indexOf("整月課表") < navigation.indexOf("我的班表"));
  assert.match(component, /tab === "personal-month" && coachView/);
  assert.match(component, /personalMonthDates\.map\(\(businessDate\) =>/);
  assert.match(component, /hours\.map\(\(hour\) => \(/);
  assert.match(component, /readOnly/);
  assert.match(component, /查看 \$\{businessDate\} 的日排課表/);
  assert.doesNotMatch(component, /personalMonthSummary/);
  assert.doesNotMatch(styles, /\.personalMonthSummary/);
  assert.match(component, /aria-label="選擇整月課表日期"/);
  assert.match(component, /onInput=\{\(event\) =>/);
  assert.match(component, /personalMonthTimelineRef/);
  assert.match(component, /timeline\.scrollTo\(\{/);
  assert.match(component, /data-selected=\{String\(businessDate === personalMonthSelectedDate\)\}/);
  assert.match(styles, /\.personalMonthDateJump\s*\{[\s\S]*justify-content: space-between;/);
  assert.match(styles, /\.personalMonthDay\[data-selected="true"\]/);
  assert.match(styles, /\.personalMonthTimeline\s*\{[\s\S]*overflow-x: auto;[\s\S]*scroll-snap-type: x mandatory;/);
  assert.match(styles, /\.personalMonthDay\s*\{[\s\S]*scroll-snap-align: start;/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.personalMonthTimeline\s*\{\s*grid-auto-columns: 100%;/);
});
