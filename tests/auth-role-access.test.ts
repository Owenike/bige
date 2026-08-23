import assert from "node:assert/strict";
import test from "node:test";
import { roleMatchesAllowed } from "../lib/auth-context";

test("platform administrators bypass every staff role gate", () => {
  assert.equal(roleMatchesAllowed("platform_admin", ["manager"]), true);
  assert.equal(roleMatchesAllowed("platform_admin", ["frontdesk"]), true);
  assert.equal(roleMatchesAllowed("platform_admin", ["coach"]), true);
  assert.equal(roleMatchesAllowed("platform_admin", ["sales"]), true);
});

test("platform administrators do not become a member identity", () => {
  assert.equal(roleMatchesAllowed("platform_admin", ["member"]), false);
  assert.equal(roleMatchesAllowed("platform_admin", ["customer"]), false);
  assert.equal(roleMatchesAllowed("platform_admin", ["member", "customer"]), false);
});

test("other staff roles keep their existing boundaries", () => {
  assert.equal(roleMatchesAllowed("manager", ["platform_admin"]), false);
  assert.equal(roleMatchesAllowed("supervisor", ["manager"]), true);
  assert.equal(roleMatchesAllowed("coach", ["frontdesk"]), false);
});
