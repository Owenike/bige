import assert from "node:assert/strict";
import test from "node:test";
import { buildSandboxImpactSummary } from "../../src/sandbox-impact-summary";

test("sandbox impact summary aggregates changed fields and blocked profiles", () => {
  const summary = buildSandboxImpactSummary({
    diffs: [
      {
        profileId: "default",
        action: "update",
        changedFields: ["actionPolicy", "bundleId"],
        summary: "Update sandbox profile 'default' fields: actionPolicy, bundleId.",
      },
      {
        profileId: "review",
        action: "update",
        changedFields: ["enabled"],
        summary: "Update sandbox profile 'review' fields: enabled.",
      },
    ],
    affectedProfileIds: ["default", "review", "legacy"],
    blockedProfileIds: ["legacy"],
    manualRequiredProfileIds: ["review"],
    defaultProfileId: "default",
  });

  assert.equal(summary.profileCount, 3);
  assert.deepEqual(summary.changedFields, ["actionPolicy", "bundleId", "enabled"]);
  assert.deepEqual(summary.blockedProfileIds, ["legacy"]);
  assert.deepEqual(summary.manualRequiredProfileIds, ["review"]);
  assert.match(summary.summaryText, /Affected profiles: 3/);
});
