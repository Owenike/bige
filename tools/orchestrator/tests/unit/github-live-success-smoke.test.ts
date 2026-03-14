import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { GhCliStatusReportingAdapter } from "../../src/status-reporting";
import { runGitHubLiveAuthSmoke } from "../../src/github-live-auth";
import type { LoadedGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";

function createRegistry(): LoadedGitHubSandboxTargetRegistry {
  return {
    registry: {
      version: "sandbox-v2",
      defaultProfileId: "default",
      bundles: {},
      governance: {
        allowedRepositories: [],
        allowedTargetTypes: ["issue", "pull_request"],
        allowedActionPolicies: ["create_or_update", "create_only", "update_only"],
        defaultAllowedActionPolicies: ["create_or_update", "create_only"],
      },
      profiles: {
        default: {
          repository: "example/bige",
          targetType: "issue",
          targetNumber: 501,
          actionPolicy: "create_or_update",
          enabled: true,
          bundleId: null,
          overrideFields: [],
          notes: null,
        },
        updateOnly: {
          repository: "example/bige",
          targetType: "issue",
          targetNumber: 777,
          actionPolicy: "update_only",
          enabled: true,
          bundleId: null,
          overrideFields: [],
          notes: null,
        },
      },
    },
    version: "sandbox-v2",
    source: "file",
    path: "sandbox-targets.json",
  };
}

function createState(profileId = "default") {
  const state = createInitialState({
    id: `github-live-success-smoke-${profileId}`,
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Run a safe live comment success smoke",
    objective: "Validate GitHub live comment success path with a sandbox profile",
    subtasks: ["github-live-success-smoke"],
    successCriteria: ["success path records stable evidence"],
  });
  return {
    ...state,
    task: {
      ...state.task,
      profileId,
    },
  };
}

test("github live success smoke records a create-driven success", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-live-success-create-"));
  const execFileImpl = async (_file: string, args: readonly string[]) => {
    if (args[0] === "--version") {
      return { stdout: "gh version 2.0.0", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/501" && !args.includes("--method")) {
      return { stdout: JSON.stringify({ number: 501 }), stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/501/comments" && !args.includes("--method")) {
      return { stdout: "[]", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/501/comments" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 1501, html_url: "https://github.com/example/bige/issues/501#issuecomment-1501" }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/1501" && !args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 1501, html_url: "https://github.com/example/bige/issues/501#issuecomment-1501" }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/1501" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 1501, html_url: "https://github.com/example/bige/issues/501#issuecomment-1501" }),
        stderr: "",
      };
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl,
  });

  const result = await runGitHubLiveAuthSmoke({
    state: createState(),
    outputRoot,
    adapter,
    enabled: true,
    token: "token",
    sandboxRegistry: createRegistry(),
    execFileImpl,
  });

  assert.equal(result.result.status, "passed");
  assert.equal(result.state.authSmokeSuccessStatus, "success");
  assert.equal(result.state.sandboxProfileId, "default");
  assert.equal(result.state.sandboxProfileStatus, "resolved");
  assert.equal(result.state.lastAuthSmokeSuccessAt, result.result.ranAt);
  assert.match(result.state.lastLiveSmokeSummary ?? "", /updated successfully|posted successfully/i);
});

test("github live success smoke records an update-driven success with an update-only sandbox profile", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-live-success-update-"));
  const execFileImpl = async (_file: string, args: readonly string[]) => {
    if (args[0] === "--version") {
      return { stdout: "gh version 2.0.0", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/1777" && !args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 1777, html_url: "https://github.com/example/bige/issues/777#issuecomment-1777" }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/1777" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 1777, html_url: "https://github.com/example/bige/issues/777#issuecomment-1777" }),
        stderr: "",
      };
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl,
  });
  const state = {
    ...createState("updateOnly"),
    lastStatusReportTarget: {
      kind: "issue_comment" as const,
      repository: "example/bige",
      targetNumber: 777,
      commentId: 1777,
      targetUrl: "https://github.com/example/bige/issues/777#issuecomment-1777",
      correlationId: "orchestrator-status:github-live-success-smoke-updateOnly",
      updatedAt: new Date().toISOString(),
    },
  };

  const result = await runGitHubLiveAuthSmoke({
    state,
    outputRoot,
    adapter,
    enabled: true,
    token: "token",
    sandboxRegistry: createRegistry(),
    sandboxProfileId: "updateOnly",
    execFileImpl,
  });

  assert.equal(result.result.status, "passed");
  assert.equal(result.result.attemptedAction, "update");
  assert.equal(result.state.sandboxProfileId, "updateOnly");
  assert.equal(result.state.lastStatusReportAction, "updated");
});
