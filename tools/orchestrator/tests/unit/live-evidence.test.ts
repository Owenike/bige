import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeLiveEvidence } from "../../src/live-evidence";

test("live evidence captures consistent shape and counts", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-evidence-"));
  const logDir = path.join(outputRoot, "logs");
  await mkdir(logDir, { recursive: true });
  const toolLogPath = path.join(logDir, "tool-log.json");
  const commandLogPath = path.join(logDir, "command-log.json");
  await writeFile(toolLogPath, `${JSON.stringify([{ tool: "readFile" }, { tool: "writeFile" }])}\n`, "utf8");
  await writeFile(commandLogPath, `${JSON.stringify([{ command: "npm test" }])}\n`, "utf8");

  const result = await writeLiveEvidence({
    stateId: "live-evidence-state",
    iterationNumber: 2,
    outputRoot,
    startedAt: "2026-03-14T00:00:00.000Z",
    endedAt: "2026-03-14T00:00:05.000Z",
    result: {
      status: "passed",
      reason: "ok",
      provider: "openai_responses",
      model: "gpt-5",
      summary: "summary",
      reportPath: "report.json",
      diffPath: "diff.patch",
      transcriptSummaryPath: "summary.json",
      toolLogPath,
      commandLogPath,
      ranAt: "2026-03-14T00:00:05.000Z",
    },
  });

  assert.equal(result.evidence.toolCallCount, 2);
  assert.equal(result.evidence.commandCount, 1);
  const persisted = JSON.parse(await readFile(result.evidencePath, "utf8")) as { status: string; patchArtifactPath: string };
  assert.equal(persisted.status, "passed");
  assert.equal(persisted.patchArtifactPath, "diff.patch");
});

test("live evidence preserves skip shape without artifact paths", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-live-evidence-skip-"));
  const result = await writeLiveEvidence({
    stateId: "live-evidence-skip",
    iterationNumber: 1,
    outputRoot,
    startedAt: "2026-03-14T00:00:00.000Z",
    endedAt: "2026-03-14T00:00:01.000Z",
    result: {
      status: "skipped",
      reason: "missing key",
      provider: "openai_responses",
      model: null,
      summary: "skipped",
      reportPath: null,
      diffPath: null,
      transcriptSummaryPath: null,
      toolLogPath: null,
      commandLogPath: null,
      ranAt: "2026-03-14T00:00:01.000Z",
    },
  });

  assert.equal(result.evidence.toolCallCount, 0);
  assert.equal(result.evidence.commandCount, 0);
  assert.equal(result.evidence.status, "skipped");
});
