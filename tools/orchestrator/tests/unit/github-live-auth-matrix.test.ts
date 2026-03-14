import assert from "node:assert/strict";
import test from "node:test";
import { classifyGitHubReportingFailure } from "../../src/github-report-permissions";

test("github live auth matrix classifies create denied separately", () => {
  const result = classifyGitHubReportingFailure({
    error: new Error("HTTP 403 Resource not accessible by integration"),
    attemptedAction: "create",
  });

  assert.equal(result.permissionStatus, "create_denied");
});

test("github live auth matrix classifies update denied separately", () => {
  const result = classifyGitHubReportingFailure({
    error: new Error("HTTP 403 Resource not accessible by integration"),
    attemptedAction: "update",
  });

  assert.equal(result.permissionStatus, "update_denied");
});

test("github live auth matrix classifies correlation target missing on visible update target", () => {
  const result = classifyGitHubReportingFailure({
    error: new Error("HTTP 404 Not Found"),
    attemptedAction: "update",
    correlatedTargetVisible: true,
  });

  assert.equal(result.permissionStatus, "correlation_target_missing");
});

test("github live auth matrix classifies target not found for create target lookup", () => {
  const result = classifyGitHubReportingFailure({
    error: new Error("HTTP 404 Not Found"),
    attemptedAction: "create",
  });

  assert.equal(result.permissionStatus, "target_not_found");
});

test("github live auth matrix classifies locked targets", () => {
  const result = classifyGitHubReportingFailure({
    error: new Error("HTTP 423 Locked"),
    attemptedAction: "update",
  });

  assert.equal(result.permissionStatus, "target_locked_or_not_updatable");
});

test("github live auth matrix classifies invalid targets", () => {
  const result = classifyGitHubReportingFailure({
    error: new Error("Validation failed"),
    attemptedAction: "create",
  });

  assert.equal(result.permissionStatus, "target_invalid");
});
