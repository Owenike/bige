import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/admin/trial-bookings/page.tsx", "utf8");
const staffFitnessRoute = readFileSync("app/staff/fitness/route.ts", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

test("trial booking admin header exposes a same-origin daily schedule link", () => {
  assert.match(
    page,
    /<Link\s+className="trialAdminButton trialAdminScheduleLink"\s+href="\/staff\/fitness"\s*>\s*日排課表\s*<\/Link>/,
  );
  assert.doesNotMatch(page, /href="https?:\/\/[^"']+\/login\/staff"/);
  assert.ok(page.indexOf("trialAdminScheduleLink") < page.indexOf("BIGE ADMIN"));
});

test("daily schedule resolver preserves the signed-in staff role destination", () => {
  assert.match(
    staffFitnessRoute,
    /requireProfile\(\["platform_admin", "manager", "frontdesk"\], request\)/,
  );
  assert.match(
    staffFitnessRoute,
    /auth\.context\.role === "frontdesk"\s*\? "\/frontdesk\/fitness"\s*:\s*"\/manager\/fitness"/,
  );
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
