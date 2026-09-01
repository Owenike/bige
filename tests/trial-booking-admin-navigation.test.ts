import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/admin/trial-bookings/page.tsx", "utf8");
const staffFitnessRoute = readFileSync("app/staff/fitness/route.ts", "utf8");
const staffScheduleSelfService = readFileSync("components/staff-schedule-self-service.tsx", "utf8");
const fitnessOperations = readFileSync("components/bige-fitness-operations.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");
const staffScheduleStyles = readFileSync("app/staff/schedule/page.module.css", "utf8");

test("trial booking admin header exposes a same-origin daily schedule link", () => {
  assert.match(
    page,
    /<Link\s+className="trialAdminButton trialAdminScheduleLink"\s+href="\/staff\/fitness"\s*>\s*日排課表\s*<\/Link>/,
  );
  assert.doesNotMatch(page, /href="https?:\/\/[^"']+\/login\/staff"/);
  assert.ok(page.indexOf("trialAdminScheduleLink") < page.indexOf("BIGE ADMIN"));
});

test("staff schedule replaces the redundant notification link with the daily schedule", () => {
  assert.match(staffScheduleSelfService, /<a className=\{styles\.stackedHeaderAction\} href="\/staff\/fitness" aria-label="日排課表"><span>日排<\/span><span>課表<\/span><\/a>/);
  assert.doesNotMatch(staffScheduleSelfService, /<a href="\/staff\/notifications">站內通知<\/a>/);
});

test("staff schedule mobile page ends after its content instead of adding a viewport-height scroll gap", () => {
  assert.match(staffScheduleStyles, /@media\(max-width:560px\)\{\.page\{min-height:0;padding:12px\}/);
});

test("coach navigation places the monthly schedule after the daily schedule, then the personal shift schedule", () => {
  const navigationStart = fitnessOperations.indexOf('<div className={styles.navigationRow}>');
  const dailyScheduleIndex = fitnessOperations.indexOf("日排課表", navigationStart);
  const personalMonthIndex = fitnessOperations.indexOf("整月課表", navigationStart);
  const staffScheduleIndex = fitnessOperations.indexOf("我的班表", navigationStart);
  const personalInfoIndex = fitnessOperations.indexOf("個人資訊", navigationStart);

  assert.notEqual(navigationStart, -1);
  assert.ok(dailyScheduleIndex > navigationStart);
  assert.ok(personalMonthIndex > dailyScheduleIndex);
  assert.ok(staffScheduleIndex > personalMonthIndex);
  assert.ok(personalInfoIndex > staffScheduleIndex);
  assert.match(fitnessOperations, /\{coachView \? \([\s\S]*?setTab\("personal-month"\)/);
  assert.match(
    fitnessOperations,
    /const canOpenStaffSchedule =\s*Boolean\(previewData \|\| sessionIdentity\) &&\s*canUseStaffScheduleNavigation\(sessionIdentity\?\.employeeNumber\)/s,
  );
});

test("daily schedule resolver preserves each signed-in staff role destination", () => {
  assert.match(
    staffFitnessRoute,
    /requireProfile\(\["platform_admin", "manager", "frontdesk", "coach"\], request\)/,
  );
  assert.match(
    staffFitnessRoute,
    /auth\.context\.role === "frontdesk"[\s\S]*?\? "\/frontdesk\/fitness"/,
  );
  assert.match(
    staffFitnessRoute,
    /auth\.context\.role === "coach" \|\| auth\.context\.role === "therapist"[\s\S]*?\? "\/coach\/fitness"/,
  );
  assert.match(staffFitnessRoute, /:\s*"\/manager\/fitness"/);
  assert.match(
    staffFitnessRoute,
    /url\.searchParams\.set\("returnTo", "\/staff\/fitness"\)/,
  );
});

test("daily schedule link stays left-aligned on wide layouts and follows the shared mobile button width", () => {
  assert.match(styles, /\.trialAdminScheduleLink\{[^}]*width:\s*fit-content;[^}]*\}/s);
  assert.match(
    styles,
    /@media \(max-width: 900px\)\{[\s\S]*?\.trialAdminButton\{\s*width:\s*100%;\s*\}/,
  );
});
