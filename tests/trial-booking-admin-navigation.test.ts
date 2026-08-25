import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/admin/trial-bookings/page.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

test("trial booking admin header exposes the daily schedule staff login link", () => {
  assert.match(
    page,
    /className="trialAdminButton trialAdminScheduleLink"\s+href="https:\/\/www\.bigefitness\.com\/login\/staff"\s*>\s*日排課表\s*<\/a>/,
  );
  assert.ok(page.indexOf("trialAdminScheduleLink") < page.indexOf("BIGE ADMIN"));
});

test("daily schedule link stays left-aligned on wide layouts and follows the shared mobile button width", () => {
  assert.match(styles, /\.trialAdminScheduleLink\{[^}]*width:\s*fit-content;[^}]*\}/s);
  assert.match(
    styles,
    /@media \(max-width: 900px\)\{[\s\S]*?\.trialAdminButton\{\s*width:\s*100%;\s*\}/,
  );
});
