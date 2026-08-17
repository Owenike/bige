import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getBigeMemberDisplayNumber,
  resolveBigeMemberSearchRule,
} from "../lib/bige-member-search";

test("a short numeric search is an exact legacy member-number lookup", () => {
  assert.deepEqual(resolveBigeMemberSearchRule("88"), {
    mode: "legacy_number",
    legacyNumber: "88",
  });
  assert.deepEqual(resolveBigeMemberSearchRule("000088"), {
    mode: "legacy_number",
    legacyNumber: "88",
  });
});

test("a complete local mobile number is an exact phone lookup", () => {
  assert.deepEqual(resolveBigeMemberSearchRule("0911778883"), {
    mode: "phone",
    phoneVariants: ["0911778883", "+886911778883", "886911778883"],
  });
});

test("the visible member number prefers the imported operating number", () => {
  assert.equal(
    getBigeMemberDisplayNumber({ member_code: "E000013", legacy_numbers: ["70"] }),
    "70",
  );
  assert.equal(
    getBigeMemberDisplayNumber({ member_code: "E000140", legacy_numbers: [] }),
    "E000140",
  );
  assert.equal(getBigeMemberDisplayNumber({ member_code: null }), null);
});

test("the fitness search route resolves numeric input through the legacy mapping table", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.match(route, /from\("bige_member_legacy_numbers"\)[\s\S]*\.eq\("legacy_number", searchRule\.legacyNumber\)/);
  assert.match(route, /searchRule\.mode === "legacy_number"[\s\S]*membersQuery = membersQuery\.in/);
  assert.match(component, /getBigeMemberDisplayNumber\(member\)/);
  assert.match(component, /getBigeMemberDisplayNumber\(monthlyMember\)/);
});

test("a complete international Taiwan mobile number resolves to the same phone variants", () => {
  assert.deepEqual(resolveBigeMemberSearchRule("+886911778883"), {
    mode: "phone",
    phoneVariants: ["+886911778883", "886911778883", "0911778883"],
  });
});

test("a complete member code is exact while a name stays fuzzy-searchable", () => {
  assert.deepEqual(resolveBigeMemberSearchRule("e000088"), {
    mode: "member_number",
    memberCode: "E000088",
  });
  assert.deepEqual(resolveBigeMemberSearchRule("陳怡"), {
    mode: "name",
    name: "陳怡",
  });
});
