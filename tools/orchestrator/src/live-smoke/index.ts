import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { LiveSmokeResult } from "../schemas";
import type { OpenAIResponsesClient } from "../openai";
import { NodeHttpsResponsesClient } from "../openai";
import { OpenAIResponsesExecutorProvider } from "../executor-adapters";
import { FileSystemWorkspaceManager } from "../workspace";

export function resolveLiveSmokeGate(params: {
  apiKey?: string | null;
  enabled?: boolean;
  model?: string | null;
}) {
  if (!params.enabled) {
    return {
      runnable: false,
      result: {
        status: "skipped",
        reason: "Live smoke is disabled by configuration.",
        provider: "openai_responses",
        model: params.model ?? null,
        summary: "Live smoke skipped because it was disabled by configuration.",
        reportPath: null,
        diffPath: null,
        transcriptSummaryPath: null,
        toolLogPath: null,
        commandLogPath: null,
        ranAt: new Date().toISOString(),
      } satisfies LiveSmokeResult,
    };
  }

  if (!params.apiKey) {
    return {
      runnable: false,
      result: {
        status: "skipped",
        reason: "OPENAI_API_KEY is missing; live smoke was skipped.",
        provider: "openai_responses",
        model: params.model ?? null,
        summary: "Live smoke skipped because OPENAI_API_KEY is not configured.",
        reportPath: null,
        diffPath: null,
        transcriptSummaryPath: null,
        toolLogPath: null,
        commandLogPath: null,
        ranAt: new Date().toISOString(),
      } satisfies LiveSmokeResult,
    };
  }

  return {
    runnable: true,
    result: null,
  } as const;
}

export async function runOpenAIExecutorLiveSmoke(params: {
  apiKey?: string | null;
  enabled?: boolean;
  model?: string;
  workspaceRoot?: string;
  outputRoot?: string;
  client?: OpenAIResponsesClient;
}) {
  const gate = resolveLiveSmokeGate({
    apiKey: params.apiKey,
    enabled: params.enabled ?? true,
    model: params.model ?? null,
  });
  if (!gate.runnable) {
    return gate.result;
  }

  const smokeRoot = await mkdtemp(path.join(params.outputRoot ?? path.join(tmpdir(), "orchestrator-live-smoke-"), ""));
  const repoRoot = path.join(smokeRoot, "repo");
  const workspaceRoot = params.workspaceRoot ?? path.join(smokeRoot, "workspaces");
  await mkdir(path.join(repoRoot, "allowed"), { recursive: true });
  await writeFile(path.join(repoRoot, "allowed", "smoke.txt"), "smoke\n", "utf8");

  const client = params.client ?? new NodeHttpsResponsesClient(params.apiKey!);
  const executor = new OpenAIResponsesExecutorProvider({
    client,
    workspaceManager: new FileSystemWorkspaceManager(workspaceRoot),
    model: params.model,
    maxTurns: 6,
  });

  try {
    const run = await executor.submitTask({
      iterationNumber: 1,
      prompt: [
        "Read allowed/smoke.txt.",
        "Write allowed/smoke.txt so it contains exactly:",
        "smoke",
        "live-smoke-ok",
        "Then complete with a concise summary.",
      ].join("\n"),
      allowedFiles: ["allowed"],
      forbiddenFiles: ["app/api/platform/notifications"],
      acceptanceCommands: [],
      repoPath: repoRoot,
      metadata: {
        taskId: "live-smoke",
        executionMode: "dry_run",
        applyAllowed: false,
      },
    });

    const report = await executor.collectResult(run.runId);
    const reportPath = path.join(smokeRoot, "execution-report.json");
    const transcriptSummaryPath = path.join(smokeRoot, "live-summary.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const diffPath = report.artifacts.find((artifact) => artifact.kind === "diff")?.path ?? null;
    const toolLogPath = report.artifacts.find((artifact) => artifact.kind === "tool_log")?.path ?? null;
    const commandLogPath = report.artifacts.find((artifact) => artifact.kind === "command_log")?.path ?? null;
    await writeFile(
      transcriptSummaryPath,
      `${JSON.stringify(
        {
          provider: "openai_responses",
          iterationNumber: report.iterationNumber,
          changedFiles: report.changedFiles,
          summaryOfChanges: report.summaryOfChanges,
          recommendedNextStep: report.recommendedNextStep,
          rawExecutorOutput: report.rawExecutorOutput ?? null,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    return {
      status: report.blockers.length > 0 ? "blocked" : "passed",
      reason:
        report.blockers.length > 0
          ? `Live smoke completed with blockers: ${report.blockers.join(" | ")}`
          : "Live smoke completed successfully.",
      provider: "openai_responses",
      model: params.model ?? "gpt-5",
      summary: report.summaryOfChanges.join(" | ") || report.recommendedNextStep,
      reportPath,
      diffPath,
      transcriptSummaryPath,
      toolLogPath,
      commandLogPath,
      ranAt: new Date().toISOString(),
    } satisfies LiveSmokeResult;
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      provider: "openai_responses",
      model: params.model ?? "gpt-5",
      summary: "Live smoke failed before completing a valid execution report.",
      reportPath: null,
      diffPath: null,
      transcriptSummaryPath: null,
      toolLogPath: null,
      commandLogPath: null,
      ranAt: new Date().toISOString(),
    } satisfies LiveSmokeResult;
  }
}
