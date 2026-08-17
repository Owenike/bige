import test from "node:test";
import assert from "node:assert/strict";
import { sanitizedRecoveryUrl } from "../lib/recovery-url";

test("student password recovery keeps only the student mode marker", () => {
  assert.equal(
    sanitizedRecoveryUrl(
      "/reset-password",
      "?mode=student&code=secret-recovery-code&returnTo=%2Flogin",
    ),
    "/reset-password?mode=student",
  );
});

test("account password recovery clears recovery query parameters", () => {
  assert.equal(
    sanitizedRecoveryUrl("/reset-password", "?code=secret-recovery-code&returnTo=%2Flogin"),
    "/reset-password",
  );
});
