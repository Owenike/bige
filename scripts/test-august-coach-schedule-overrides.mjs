import assert from "node:assert/strict";
import { resolveAugustScheduleCellContent } from "./import-august-coach-schedule.mjs";

const supplied = resolveAugustScheduleCellContent({
  date: "2026-08-22",
  time: "13:00",
  coach: "Becky",
  marker: "FA1",
  content: "",
});

assert.equal(supplied.content, "林建宇0980120570");
assert.equal(supplied.sourceContent, "");
assert.match(supplied.sourceOverride, /User supplied/);

const untouched = resolveAugustScheduleCellContent({
  date: "2026-08-22",
  time: "14:00",
  coach: "Becky",
  marker: "",
  content: " TO ",
});

assert.equal(untouched.content, "TO");
assert.equal(untouched.sourceContent, "TO");
assert.equal(untouched.sourceOverride, null);

console.log(JSON.stringify({ ok: true, supplied, untouched }, null, 2));
