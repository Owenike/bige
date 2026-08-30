import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("components/staff-leave-self-service.tsx", "utf8");
const styles = readFileSync("app/staff/leave/page.module.css", "utf8");

test("new leave requests exclude family care leave without breaking historical labels", () => {
  const submitTypes = component.slice(
    component.indexOf("const SUBMIT_LEAVE_TYPES"),
    component.indexOf("const PROOF_TYPES"),
  );

  assert.doesNotMatch(submitTypes, /family_care/);
  assert.match(component, /family_care:\s*"家庭照顧假"/);
  assert.match(component, /const PROOF_TYPES = new Set\(\[[\s\S]*?"family_care"/);
  assert.match(component, /SUBMIT_LEAVE_TYPES\.map\(\(value\) =>/);
  assert.doesNotMatch(component, /Object\.entries\(LABELS\)/);
});

test("family care hourly copy is removed from the employee leave form", () => {
  assert.doesNotMatch(component, /家庭照顧假可按小時/);
  assert.match(
    component,
    /特休只能整天；病假、事假可整天或半天；婚喪公假依實際期間。/,
  );
});

test("leave page highlights navigation and leave timing rules without the monthly-limit copy", () => {
  assert.doesNotMatch(component, /這裡的法定請假不受每月自選 8 天限制/);
  assert.match(
    component,
    /<a className=\{styles\.scheduleLink\} href="\/staff\/schedule">/,
  );
  assert.match(component, /<aside className=\{styles\.leaveRule\} aria-label="請假時間規則">/);
  assert.match(styles, /\.page > header \.scheduleLink\s*\{[\s\S]*?var\(--leave-gold-bright\)/);
  assert.match(styles, /\.leaveRule\s*\{[\s\S]*?rgba\(242, 210, 139, 0\.48\)/);
});

test("leave page uses the member and contracts M2-A visual language responsively", () => {
  assert.match(styles, /linear-gradient\(112deg, #183149 0%, #172b3c 45%, #202832 72%, #454542 100%\)/);
  assert.match(styles, /--leave-ice-line:\s*rgba\(177, 218, 244, 0\.38\)/);
  assert.match(styles, /--leave-gold:\s*#d8b361/);
  assert.match(styles, /\.form > button\s*\{[\s\S]*?linear-gradient\(135deg, var\(--leave-gold-bright\)/);
  assert.match(styles, /@media \(max-width: 780px\)/);
  assert.match(styles, /@media \(max-width: 620px\)/);
});
