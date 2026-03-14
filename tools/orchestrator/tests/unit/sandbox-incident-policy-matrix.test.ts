import assert from "node:assert/strict";
import test from "node:test";
import { resolveSandboxIncidentPolicy } from "../../src/sandbox-incident-policy";
import type { SandboxRecoveryIncident } from "../../src/sandbox-incident-governance";

function createIncident(overrides: Partial<SandboxRecoveryIncident>): SandboxRecoveryIncident {
  return {
    id: "sandbox-incident:test",
    type: "recovery_observed",
    severity: "info",
    summary: "Test incident",
    suggestedNextAction: "No action.",
    restorePointId: "sandbox-restore:test",
    affectedProfiles: ["default"],
    sourceKind: "history",
    result: "previewed",
    reason: null,
    timestamp: "2026-03-15T00:00:00.000Z",
    requiresEscalation: false,
    ...overrides,
  };
}

test("sandbox incident policy matrix blocks rerun apply for manual_required and critical incidents", () => {
  const manualRequired = resolveSandboxIncidentPolicy(
    createIncident({
      type: "restore_point_expired",
      severity: "manual_required",
      requiresEscalation: true,
    }),
  );
  assert.equal(manualRequired.recommendedAction, "request_review");
  assert.equal(manualRequired.allowRerunApply, false);
  assert.equal(manualRequired.requireRequestReview, true);

  const critical = resolveSandboxIncidentPolicy(
    createIncident({
      type: "default_profile_safety_failed",
      severity: "critical",
      requiresEscalation: true,
    }),
  );
  assert.equal(critical.recommendedAction, "escalate");
  assert.equal(critical.allowRerunApply, false);
  assert.equal(critical.requireEscalate, true);
});

test("sandbox incident policy matrix recommends rerun preview or validate only for safer incidents", () => {
  const blocked = resolveSandboxIncidentPolicy(
    createIncident({
      type: "guardrails_failed",
      severity: "blocked",
    }),
  );
  assert.equal(blocked.recommendedAction, "rerun_preview");
  assert.equal(blocked.allowRerunPreview, true);
  assert.equal(blocked.allowRerunApply, false);

  const warning = resolveSandboxIncidentPolicy(
    createIncident({
      type: "batch_partial_restore",
      severity: "warning",
      result: "partially_restored",
    }),
  );
  assert.equal(warning.recommendedAction, "rerun_validate");
  assert.equal(warning.allowRerunValidate, true);
  assert.equal(warning.allowRerunApply, false);
});
