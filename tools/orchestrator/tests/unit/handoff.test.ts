import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { approvePendingPatch, prepareHandoff } from "../../src/orchestrator";
import { validateHandoffPreconditions } from "../../src/handoff";
import { createPromotionReadyFixture } from "./promotion.fixture";

test("prepareHandoff creates a handoff-ready package after approval and live pass", async () => {
  const { dependencies, repoRoot } = await createPromotionReadyFixture("handoff-ready-state");
  await approvePendingPatch("handoff-ready-state", dependencies);
  let state = await dependencies.storage.loadState("handoff-ready-state");
  assert.ok(state);

  const liveRoot = path.join(repoRoot, ".tmp", "live-pass");
  await mkdir(liveRoot, { recursive: true });
  await writeFile(path.join(liveRoot, "report.json"), "{}\n", "utf8");
  await writeFile(path.join(liveRoot, "tool-log.json"), "[]\n", "utf8");
  await writeFile(path.join(liveRoot, "command-log.json"), "[]\n", "utf8");
  await writeFile(path.join(liveRoot, "summary.json"), "{}\n", "utf8");

  await dependencies.storage.saveState({
    ...state!,
    livePassStatus: "passed",
    liveAcceptanceStatus: "passed",
    lastLiveAcceptanceResult: {
      status: "passed",
      reason: "real pass",
      provider: "openai_responses",
      model: "gpt-5",
      summary: "live pass completed",
      reportPath: path.join(liveRoot, "report.json"),
      diffPath: state!.lastExecutionReport?.artifacts.find((artifact) => artifact.kind === "diff")?.path ?? null,
      transcriptSummaryPath: path.join(liveRoot, "summary.json"),
      toolLogPath: path.join(liveRoot, "tool-log.json"),
      commandLogPath: path.join(liveRoot, "command-log.json"),
      ranAt: new Date().toISOString(),
    },
  });

  const result = await prepareHandoff("handoff-ready-state", dependencies, {
    publishBranch: false,
    createBranch: false,
    githubHandoffEnabled: false,
  });

  assert.equal(result.result.status, "handoff_ready");
  assert.equal(Boolean(result.result.handoffPackagePath), true);
  assert.equal(Boolean(result.result.prDraftPath), true);
  assert.equal(result.state.handoffStatus, "handoff_ready");
  assert.equal(result.state.prDraftStatus, "metadata_ready");
  assert.equal(result.state.handoffArtifactPaths.length >= 4, true);
  assert.equal(result.result.githubHandoffStatus, "skipped");

  const handoffPackage = JSON.parse(await readFile(result.result.handoffPackagePath!, "utf8")) as { prDraft: { title: string } };
  assert.equal(typeof handoffPackage.prDraft.title, "string");
});

test("prepareHandoff reports handoff_failed when preconditions are missing", async () => {
  const { dependencies } = await createPromotionReadyFixture("handoff-fail-state");
  const state = await dependencies.storage.loadState("handoff-fail-state");
  assert.ok(state);
  const issues = validateHandoffPreconditions(state!);
  assert.equal(issues.some((issue) => issue.includes("live pass")), true);
  assert.equal(issues.some((issue) => issue.includes("approved patch")), true);

  const result = await prepareHandoff("handoff-fail-state", dependencies, {
    publishBranch: false,
    createBranch: false,
    githubHandoffEnabled: false,
  });

  assert.equal(result.result.status, "handoff_failed");
  assert.equal(result.state.handoffStatus, "handoff_failed");
  assert.equal(result.result.issues.length >= 2, true);
});
