import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clampStaffNotificationPosition,
  parseSavedStaffNotificationPosition,
  restoreStaffNotificationPosition,
  snapStaffNotificationPosition,
} from "../lib/staff-notification-position";

test("staff notification button stays inside the visible viewport", () => {
  assert.deepEqual(
    clampStaffNotificationPosition({ x: -80, y: 900 }, { width: 390, height: 844 }),
    { x: 14, y: 782 },
  );
});

test("staff notification button snaps to the nearest horizontal edge", () => {
  const left = snapStaffNotificationPosition({ x: 80, y: 310 }, { width: 390, height: 844 });
  const right = snapStaffNotificationPosition({ x: 280, y: 510 }, { width: 390, height: 844 });

  assert.equal(left.position.x, 14);
  assert.equal(left.position.y, 310);
  assert.equal(left.saved.side, "left");
  assert.equal(right.position.x, 328);
  assert.equal(right.position.y, 510);
  assert.equal(right.saved.side, "right");
});

test("staff notification button restores its edge and relative height after resize", () => {
  const saved = snapStaffNotificationPosition(
    { x: 1200, y: 500 },
    { width: 1440, height: 900 },
  ).saved;
  const restored = restoreStaffNotificationPosition(saved, { width: 390, height: 844 });

  assert.equal(restored.x, 328);
  assert.ok(restored.y >= 14 && restored.y <= 782);
  assert.equal(saved.side, "right");
});

test("staff notification button ignores invalid saved positions and bounds valid ratios", () => {
  assert.equal(parseSavedStaffNotificationPosition(null), null);
  assert.equal(parseSavedStaffNotificationPosition("not-json"), null);
  assert.equal(parseSavedStaffNotificationPosition('{"side":"top","yRatio":0.5}'), null);
  assert.deepEqual(
    parseSavedStaffNotificationPosition('{"side":"left","yRatio":1.5}'),
    { side: "left", yRatio: 1 },
  );
});

test("staff notification button keeps navigation while wiring pointer drag safeguards", () => {
  const component = readFileSync(
    resolve(process.cwd(), "components/staff-notification-button.tsx"),
    "utf8",
  );
  const styles = readFileSync(
    resolve(process.cwd(), "components/staff-notification-button.module.css"),
    "utf8",
  );

  assert.match(component, /href="\/staff\/notifications"/);
  assert.match(component, /onPointerDown=\{handlePointerDown\}/);
  assert.match(component, /snapStaffNotificationPosition/);
  assert.match(component, /suppressPointerClickRef\.current/);
  assert.match(component, /window\.localStorage\.setItem/);
  assert.match(styles, /touch-action:\s*none/);
  assert.match(styles, /cursor:\s*grab/);
});
