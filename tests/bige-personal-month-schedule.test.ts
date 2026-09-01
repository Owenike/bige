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
  const navigationStart = component.lastIndexOf("<nav", component.indexOf('aria-label="營運功能"'));
  const navigation = component.slice(navigationStart, component.indexOf("</nav>", navigationStart));

  assert.ok(navigation.indexOf("日排課表") < navigation.indexOf("整月課表"));
  assert.ok(navigation.indexOf("整月課表") < navigation.indexOf("我的班表"));
  assert.ok(navigation.indexOf("我的班表") < navigation.indexOf("個人資訊"));
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

test("ordinary coaches default to personal month while overview roles retain daily navigation", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.match(
    component,
    /coachView && previewData\?\.coachScheduleScope !== "all" \? "personal-month" : "schedule"/,
  );
  assert.match(
    component,
    /const shouldDefaultCoachToPersonalMonth =[\s\S]*coachView &&[\s\S]*!coachInitialTabResolvedRef\.current &&[\s\S]*merged\.coachScheduleScope !== "all"/,
  );
  assert.match(component, /if \(shouldDefaultCoachToPersonalMonth\) setTab\("personal-month"\)/);
  assert.match(
    component,
    /const canShowDailyScheduleTab = !coachView \|\| canUseScheduleOverviewControls;/,
  );
  assert.match(component, /\{canShowDailyScheduleTab \? \([\s\S]*日排課表[\s\S]*\) : null\}/);
  assert.match(
    component,
    /selectBoardDate\(businessDate\);\s*setTab\("schedule"\);/,
  );
});

test("coach mobile replaces the header account controls with a vertical dropdown button menu", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.match(component, /aria-label="個人資訊選單"/);
  assert.match(component, /aria-expanded=\{mobilePersonalMenuOpen\}/);
  assert.match(component, /data-daily-schedule-visible=\{canShowDailyScheduleTab \? "true" : undefined\}/);
  assert.match(component, /aria-haspopup="menu"/);
  assert.match(component, /aria-orientation="vertical"/);
  assert.match(component, /個人資訊[\s\S]*<ChevronDown size=\{15\}/);
  assert.match(component, /href="\/staff\/account#email"[\s\S]*更改信箱/);
  assert.match(component, /href="\/staff\/account#password"[\s\S]*更改密碼/);
  assert.match(component, /href="\/logout"[\s\S]*登出/);
  assert.match(component, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(component, /event\.key !== "Escape"/);
  assert.match(styles, /\.mobilePersonalMenu\s*\{[\s\S]*display: none;/);
  assert.match(
    styles,
    /@media \(max-width: 780px\)[\s\S]*\.page\[data-role-view="coach"\] \.header\s*\{\s*display: none;/,
  );
  assert.match(
    styles,
    /\.page\[data-role-view="coach"\] \.navigationRow\s*\{\s*position: relative;\s*z-index: 90;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 780px\)[\s\S]*\.page\[data-role-view="coach"\] \.mobilePersonalMenu\s*\{[^}]*display: block;/,
  );
  assert.match(
    styles,
    /\.mobilePersonalMenuPanel\s*\{[\s\S]*top: calc\(100% \+ 9px\);[\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(
    styles,
    /\.mobilePersonalMenuAction\s*\{[\s\S]*width: 100%;[\s\S]*justify-content: flex-start;/,
  );
  assert.match(
    styles,
    /\.page\[data-role-view="coach"\] \.tabs\[data-daily-schedule-visible="true"\]\s*\{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) max-content;/,
  );
  assert.match(
    styles,
    /\.page\[data-role-view="coach"\] \.mobilePersonalMenu\s*\{[\s\S]*min-width: 98px;/,
  );
});
