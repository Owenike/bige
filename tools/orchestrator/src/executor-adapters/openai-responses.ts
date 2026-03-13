import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  executionReportJsonSchema,
  executionReportSchema,
  type JsonSchema,
  parseWithDualValidation,
  type ExecutionMode,
  type ExecutionReport,
} from "../schemas";
import type { OpenAIResponsesClient } from "../openai";
import { validateAllowListedCommand } from "./command-policy";
import {
  FileSystemWorkspaceManager,
  applyWorkspacePatch,
  listWorkspaceFiles,
  readWorkspaceFile,
  searchWorkspaceFiles,
  writeWorkspaceFile,
  type WorkspaceSession,
} from "../workspace";
import type { ExecutionProvider, ExecutionProviderRun, ExecutionProviderTask, ExecutionProviderRunStatus } from "./index";

const executorTurnSchema = z.object({
  kind: z.enum([
    "list_files",
    "read_file",
    "search_in_files",
    "write_file",
    "apply_patch",
    "run_command",
    "complete",
  ]),
  reasoning: z.string(),
  relativePath: z.string().nullable().default(null),
  pattern: z.string().nullable().default(null),
  content: z.string().nullable().default(null),
  search: z.string().nullable().default(null),
  replace: z.string().nullable().default(null),
  command: z.array(z.string()).nullable().default(null),
  summaryOfChanges: z.array(z.string()).default([]),
  whyThisWasDone: z.array(z.string()).default([]),
  howBehaviorWasKeptStable: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  recommendedNextStep: z.string().default("Continue iterating."),
  shouldCloseSlice: z.boolean().default(false),
});

const executorTurnJsonSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "reasoning"],
  properties: {
    kind: {
      type: "string",
      enum: ["list_files", "read_file", "search_in_files", "write_file", "apply_patch", "run_command", "complete"],
    },
    reasoning: { type: "string" },
    relativePath: { type: "string", nullable: true },
    pattern: { type: "string", nullable: true },
    content: { type: "string", nullable: true },
    search: { type: "string", nullable: true },
    replace: { type: "string", nullable: true },
    command: { type: "array", nullable: true, items: { type: "string" } },
    summaryOfChanges: { type: "array", items: { type: "string" } },
    whyThisWasDone: { type: "array", items: { type: "string" } },
    howBehaviorWasKeptStable: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    recommendedNextStep: { type: "string" },
    shouldCloseSlice: { type: "boolean" },
  },
};

type StoredRun = {
  status: ExecutionProviderRunStatus;
  promise: Promise<ExecutionReport>;
  result?: ExecutionReport;
};

async function runAllowListedCommand(repoPath: string, command: string[]) {
  const safe = validateAllowListedCommand(command);
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(safe.executable, safe.args, {
      cwd: repoPath,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code && code !== 0) {
        reject(new Error(stderr || stdout || `Command exited with code ${code}.`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function validateExecutionReport(data: unknown) {
  return parseWithDualValidation({
    schemaName: "ExecutionReport",
    zodSchema: executionReportSchema,
    jsonSchema: executionReportJsonSchema,
    data,
  });
}

async function writeJsonArtifact(filePath: string, data: unknown) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export class OpenAIResponsesExecutorProvider implements ExecutionProvider {
  readonly kind = "openai_responses" as const;
  private readonly runs = new Map<string, StoredRun>();

  constructor(
    private readonly params: {
      client: OpenAIResponsesClient;
      workspaceManager: FileSystemWorkspaceManager;
      model?: string;
      maxTurns?: number;
    },
  ) {}

  private async executeToolLoop(task: ExecutionProviderTask) {
    const executionMode = task.metadata?.executionMode ?? ("dry_run" satisfies ExecutionMode);
    const workspace = await this.params.workspaceManager.createWorkspace({
      taskId: task.metadata?.taskId ?? "default",
      iterationNumber: task.iterationNumber,
      repoPath: task.repoPath,
      allowedFiles: task.allowedFiles,
      forbiddenFiles: task.forbiddenFiles,
    });

    const toolLog: Array<Record<string, unknown>> = [];
    const commandLog: Array<Record<string, unknown>> = [];
    let completion = {
      summaryOfChanges: ["OpenAI executor completed without explicit summary."],
      whyThisWasDone: ["Execute orchestrator changes in an isolated workspace."],
      howBehaviorWasKeptStable: ["Workspace isolation prevented direct main-repo mutation."],
      risks: ["OpenAI coding executor is still MVP quality."],
      recommendedNextStep: "Review the generated patch artifact.",
      shouldCloseSlice: false,
    };

    for (let turn = 0; turn < (this.params.maxTurns ?? 12); turn += 1) {
      const response = await this.params.client.createStructuredOutput<z.infer<typeof executorTurnSchema>>({
        model: this.params.model ?? "gpt-5",
        schemaName: "executor_turn",
        jsonSchema: executorTurnJsonSchema,
        systemPrompt: [
          "You are a coding executor operating in an isolated workspace.",
          "Use one tool action per response.",
          "Return complete when you are done.",
          "Do not target forbidden files.",
        ].join(" "),
        userPrompt: JSON.stringify({
          prompt: task.prompt,
          iterationNumber: task.iterationNumber,
          executionMode,
          allowedFiles: task.allowedFiles,
          forbiddenFiles: task.forbiddenFiles,
          acceptanceCommands: task.acceptanceCommands,
          toolLog,
          commandLog,
        }),
      });
      const action = parseWithDualValidation({
        schemaName: "ExecutorTurn",
        zodSchema: executorTurnSchema,
        jsonSchema: executorTurnJsonSchema,
        data: response,
      });

      if (action.kind === "complete") {
        completion = {
          summaryOfChanges: action.summaryOfChanges,
          whyThisWasDone: action.whyThisWasDone,
          howBehaviorWasKeptStable: action.howBehaviorWasKeptStable,
          risks: action.risks,
          recommendedNextStep: action.recommendedNextStep,
          shouldCloseSlice: action.shouldCloseSlice,
        };
        break;
      }

      try {
        let result: unknown = null;
        if (action.kind === "list_files") {
          result = await listWorkspaceFiles(workspace, action.relativePath ?? ".");
        } else if (action.kind === "read_file") {
          result = await readWorkspaceFile(workspace, action.relativePath ?? "");
        } else if (action.kind === "search_in_files") {
          result = await searchWorkspaceFiles(workspace, action.pattern ?? "");
        } else if (action.kind === "write_file") {
          await writeWorkspaceFile(workspace, action.relativePath ?? "", action.content ?? "");
          result = { ok: true };
        } else if (action.kind === "apply_patch") {
          await applyWorkspacePatch({
            session: workspace,
            relativePath: action.relativePath ?? "",
            search: action.search ?? "",
            replace: action.replace ?? "",
          });
          result = { ok: true };
        } else if (action.kind === "run_command") {
          const command = action.command ?? [];
          const { stdout, stderr } = await runAllowListedCommand(workspace.rootDir, command);
          commandLog.push({
            command,
            stdout: stdout.trim() || null,
            stderr: stderr.trim() || null,
          });
          result = { stdout: stdout.trim() || null, stderr: stderr.trim() || null };
        }

        toolLog.push({
          turn,
          kind: action.kind,
          reasoning: action.reasoning,
          relativePath: action.relativePath,
          command: action.command,
          result,
        });
      } catch (error) {
        toolLog.push({
          turn,
          kind: action.kind,
          reasoning: action.reasoning,
          relativePath: action.relativePath,
          command: action.command,
          error: error instanceof Error ? error.message : String(error),
        });
        const toolLogPath = path.join(workspace.rootDir, ".orchestrator", "tool-log.json");
        const commandLogPath = path.join(workspace.rootDir, ".orchestrator", "command-log.json");
        await writeJsonArtifact(toolLogPath, toolLog);
        await writeJsonArtifact(commandLogPath, commandLog);
        return validateExecutionReport({
          iterationNumber: task.iterationNumber,
          changedFiles: [],
          checkedButUnmodifiedFiles: task.allowedFiles,
          summaryOfChanges: ["OpenAI executor stopped after a tool failure."],
          whyThisWasDone: ["Surface tool failures as normalized execution reports."],
          howBehaviorWasKeptStable: ["Workspace isolation prevented main-repo mutation."],
          localValidation: task.acceptanceCommands.map((command) => ({
            command,
            status: "not_run",
            output: null,
          })),
          ciValidation: null,
          blockers: [error instanceof Error ? error.message : String(error)],
          risks: ["The coding executor hit a tool-level failure."],
          recommendedNextStep: "Review the tool log and retry with a narrower prompt.",
          shouldCloseSlice: false,
          artifacts: [
            { kind: "workspace", label: "workspace", path: workspace.rootDir, value: workspace.id },
            { kind: "tool_log", label: "tool log", path: toolLogPath, value: null },
            { kind: "command_log", label: "command log", path: commandLogPath, value: null },
          ],
          rawExecutorOutput: {
            provider: "openai_responses",
            executionMode,
            workspace: workspace.rootDir,
          },
        });
      }
    }

    const toolLogPath = path.join(workspace.rootDir, ".orchestrator", "tool-log.json");
    const commandLogPath = path.join(workspace.rootDir, ".orchestrator", "command-log.json");
    await writeJsonArtifact(toolLogPath, toolLog);
    await writeJsonArtifact(commandLogPath, commandLog);

    const diffArtifacts = await this.params.workspaceManager.collectDiffArtifacts(workspace);
    return validateExecutionReport({
      iterationNumber: task.iterationNumber,
      changedFiles: diffArtifacts.changedFiles,
      checkedButUnmodifiedFiles: task.allowedFiles.filter((file) => !diffArtifacts.changedFiles.includes(file)),
      summaryOfChanges: completion.summaryOfChanges,
      whyThisWasDone: completion.whyThisWasDone,
      howBehaviorWasKeptStable: completion.howBehaviorWasKeptStable,
      localValidation: task.acceptanceCommands.map((command) => ({
        command,
        status: "not_run",
        output: null,
      })),
      ciValidation: null,
      blockers: [],
      risks: completion.risks,
      recommendedNextStep: completion.recommendedNextStep,
      shouldCloseSlice: completion.shouldCloseSlice,
      artifacts: [
        { kind: "workspace", label: "workspace", path: workspace.rootDir, value: workspace.id },
        { kind: "diff", label: "diff patch", path: diffArtifacts.diffPath, value: diffArtifacts.diffText || null },
        { kind: "tool_log", label: "tool log", path: toolLogPath, value: null },
        { kind: "command_log", label: "command log", path: commandLogPath, value: null },
      ],
      rawExecutorOutput: {
        provider: "openai_responses",
        executionMode,
        workspace: workspace.rootDir,
        toolTurns: toolLog.length,
        patchPromotionRequired: executionMode === "apply" && diffArtifacts.changedFiles.length > 0,
      },
    });
  }

  async submitTask(task: ExecutionProviderTask): Promise<ExecutionProviderRun> {
    const runId = randomUUID();
    const promise = this.executeToolLoop(task);
    this.runs.set(runId, {
      status: "running",
      promise,
    });
    promise.then((result) => {
      const run = this.runs.get(runId);
      if (!run) return;
      run.status = "completed";
      run.result = result;
    });
    return { runId, status: "running" };
  }

  async pollRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`OpenAIResponsesExecutorProvider run ${runId} was not found.`);
    return { runId, status: run.status };
  }

  async cancelRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "cancelled";
  }

  async collectResult(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`OpenAIResponsesExecutorProvider run ${runId} was not found.`);
    return run.result ?? (await run.promise);
  }
}
