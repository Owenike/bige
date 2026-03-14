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
      version: "sandbox-v1",
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
          targetNumber: 101,
          actionPolicy: "create_or_update",
          enabled: true,
          bundleId: null,
          overrideFields: [],
          notes: null,
        },
        review: {
          repository: "example/bige",
          targetType: "issue",
          targetNumber: 202,
          actionPolicy: "create_or_update",
          enabled: true,
          bundleId: null,
          overrideFields: [],
          notes: null,
        },
      },
    },
    version: "sandbox-v1",
    source: "file",
    path: "sandbox-targets.json",
  };
}

function createState(profileId = "default") {
  const state = createInitialState({
    id: `github-live-auth-success-${profileId}`,
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Exercise GitHub live auth success path",
    objective: "Validate a real create or update path against a safe sandbox target",
    subtasks: ["github-live-auth-success"],
    successCriteria: ["live auth smoke can succeed safely"],
  });
  return {
    ...state,
    task: {
      ...state.task,
      profileId,
    },
  };
}

test("github live auth success path can create then update using the default sandbox target", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-auth-success-create-"));
  const execFileImpl = async (_file: string, args: readonly string[]) => {
    if (args[0] === "--version") {
      return { stdout: "gh version 2.0.0", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/101" && !args.includes("--method")) {
      return { stdout: JSON.stringify({ number: 101 }), stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/101/comments" && !args.includes("--method")) {
      return { stdout: "[]", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/101/comments" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 501, html_url: "https://github.com/example/bige/issues/101#issuecomment-501" }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/501" && !args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 501, html_url: "https://github.com/example/bige/issues/101#issuecomment-501" }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/501" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 501, html_url: "https://github.com/example/bige/issues/101#issuecomment-501" }),
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
  assert.equal(result.state.sandboxTargetProfileId, "default");
  assert.equal(result.state.lastAuthSmokeTarget?.commentId, 501);
});

test("github live auth success path can update an existing correlated comment using a profile sandbox target", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-auth-success-update-"));
  const execFileImpl = async (_file: string, args: readonly string[]) => {
    if (args[0] === "--version") {
      return { stdout: "gh version 2.0.0", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/902" && !args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 902, html_url: "https://github.com/example/bige/issues/202#issuecomment-902" }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/902" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 902, html_url: "https://github.com/example/bige/issues/202#issuecomment-902" }),
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
    ...createState("review"),
    lastStatusReportTarget: {
      kind: "issue_comment" as const,
      repository: "example/bige",
      targetNumber: 202,
      commentId: 902,
      targetUrl: "https://github.com/example/bige/issues/202#issuecomment-902",
      correlationId: "orchestrator-status:github-live-auth-success-review",
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
    sandboxProfileId: "review",
    execFileImpl,
  });

  assert.equal(result.result.status, "passed");
  assert.equal(result.result.attemptedAction, "update");
  assert.equal(result.state.sandboxTargetProfileId, "review");
  assert.equal(result.state.lastAuthSmokeAction, "update");
});
