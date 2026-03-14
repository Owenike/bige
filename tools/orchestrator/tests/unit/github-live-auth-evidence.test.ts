import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { GhCliStatusReportingAdapter, inspectGitHubReportingOperatorSummary } from "../../src/status-reporting";
import { runGitHubLiveAuthSmoke } from "../../src/github-live-auth";
import type { LoadedGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";

function createRegistry(): LoadedGitHubSandboxTargetRegistry {
  return {
    registry: {
      version: "sandbox-v1",
      defaultProfileId: "default",
      profiles: {
        default: {
          repository: "example/bige",
          targetType: "issue",
          targetNumber: 404,
          actionPolicy: "create_or_update",
          enabled: true,
          notes: null,
        },
      },
    },
    version: "sandbox-v1",
    source: "file",
    path: "sandbox-targets.json",
  };
}

function createState() {
  return createInitialState({
    id: "github-live-auth-evidence",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Persist auth smoke evidence",
    objective: "Keep operator-facing evidence for success and blocked outcomes",
    subtasks: ["github-live-auth-evidence"],
    successCriteria: ["evidence shape is stable"],
  });
}

test("github live auth evidence persists success details and operator summary", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-auth-evidence-"));
  const execFileImpl = async (_file: string, args: readonly string[]) => {
    if (args[0] === "--version") {
      return { stdout: "gh version 2.0.0", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/404" && !args.includes("--method")) {
      return { stdout: JSON.stringify({ number: 404 }), stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/404/comments" && !args.includes("--method")) {
      return { stdout: "[]", stderr: "" };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/404/comments" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 9404, html_url: "https://github.com/example/bige/issues/404#issuecomment-9404" }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/9404" && !args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 9404, html_url: "https://github.com/example/bige/issues/404#issuecomment-9404" }),
        stderr: "",
      };
    }
    if (args[0] === "api" && args[1] === "repos/example/bige/issues/comments/9404" && args.includes("--method")) {
      return {
        stdout: JSON.stringify({ id: 9404, html_url: "https://github.com/example/bige/issues/404#issuecomment-9404" }),
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

  assert.equal(result.state.lastLiveAuthEvidence?.action, "success");
  assert.equal(result.state.lastLiveAuthEvidence?.lastCommentId, 9404);
  assert.equal(result.state.lastAuthSmokeEvidencePath, result.evidencePath);

  const evidence = JSON.parse(await readFile(result.evidencePath, "utf8")) as { evidence: { action: string } };
  assert.equal(evidence.evidence.action, "success");

  const summary = await inspectGitHubReportingOperatorSummary({
    state: result.state,
    enabled: true,
    token: null,
  });
  assert.match(summary.summaryText, /Last auth smoke: passed \/ success \/ ready/);
  assert.match(summary.summaryText, /Sandbox target profile: default \/ status=resolved \/ config=sandbox-v1/);
});

test("github live auth evidence preserves blocked shape when no safe target exists", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-github-auth-evidence-blocked-"));
  const adapter = new GhCliStatusReportingAdapter({
    enabled: true,
    token: "token",
    execFileImpl: async () => ({ stdout: "gh version 2.0.0", stderr: "" }),
  });

  const result = await runGitHubLiveAuthSmoke({
    state: createState(),
    outputRoot,
    adapter,
    enabled: true,
    token: "token",
    sandboxRegistry: {
      registry: {
        version: "empty-v1",
        defaultProfileId: null,
        profiles: {},
      },
      version: "empty-v1",
      source: "default",
      path: null,
    },
  });

  assert.equal(result.result.status, "manual_required");
  assert.equal(result.state.lastLiveAuthEvidence?.action, "blocked");
  assert.equal(result.state.lastLiveAuthEvidence?.failureReason, "github_auth_smoke_missing_sandbox_target_profile");
});
