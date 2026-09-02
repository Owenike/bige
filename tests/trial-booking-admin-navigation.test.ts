import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/admin/trial-bookings/page.tsx", "utf8");
const trialBookingRoute = readFileSync("app/api/admin/trial-bookings/route.ts", "utf8");
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

test("marketing report uses the first submitted appointment time instead of later record updates", () => {
  const loadStatsStart = trialBookingRoute.indexOf("async function loadStats");
  const getHandlerStart = trialBookingRoute.indexOf("export async function GET");
  const postHandlerStart = trialBookingRoute.indexOf("export async function POST");
  assert.notEqual(loadStatsStart, -1);
  assert.notEqual(getHandlerStart, -1);
  assert.notEqual(postHandlerStart, -1);

  const loadStats = trialBookingRoute.slice(loadStatsStart, getHandlerStart);
  const getHandler = trialBookingRoute.slice(getHandlerStart, postHandlerStart);

  assert.match(loadStats, /dateBasis: "appointment_date" \| "scheduled_at"/);
  assert.match(loadStats, /\.neq\("source", "legacy_schedule_import"\)[\s\S]*?\.gte\("scheduled_at", marketingRange\.fromInclusive\)[\s\S]*?\.lt\("scheduled_at", marketingRange\.toExclusive\)/);
  assert.doesNotMatch(loadStats, /\.gte\("updated_at"|\.lt\("updated_at"/);
  assert.match(getHandler, /query\.order\("scheduled_at", \{ ascending: false \}\)/);
  assert.match(getHandler, /\.neq\("source", "legacy_schedule_import"\)[\s\S]*?\.not\("appointment_date", "is", null\)/);
  assert.match(getHandler, /query\.gte\("scheduled_at", range\.fromInclusive\)\.lt\("scheduled_at", range\.toExclusive\)/);
  assert.match(getHandler, /isMarketingReport \? "scheduled_at" : "appointment_date"/);
  assert.doesNotMatch(getHandler, /query\.gte\("updated_at"|query\.lt\("updated_at"/);
});

test("marketing report keeps website registrations on lead creation time and shows appointment submission time", () => {
  assert.match(
    trialBookingRoute,
    /\.eq\("source", "website"\)[\s\S]*?\.gte\("created_at", marketingRange\.fromInclusive\)[\s\S]*?\.lt\("created_at", marketingRange\.toExclusive\)/,
  );
  assert.match(page, /scheduled_at: string \| null/);
  assert.equal(page.match(/預約單送出時間/g)?.length, 2);
  assert.equal(page.match(/formatDateTime\(booking\.scheduled_at\)/g)?.length, 2);
});
