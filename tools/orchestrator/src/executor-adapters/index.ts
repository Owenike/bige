import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  executionReportJsonSchema,
  executionReportSchema,
  parseWithDualValidation,
  type ExecutionMode,
  type ExecutionReport,
  type ExecutorProviderKind,
} from "../schemas";
import { validateAllowListedCommand } from "./command-policy";
import { OpenAIResponsesExecutorProvider } from "./openai-responses";

export type ExecutionProviderTask = {
  iterationNumber: number;
  prompt: string;
  allowedFiles: string[];
  forbiddenFiles: string[];
  acceptanceCommands: string[];
  repoPath: string;
  metadata?: {
    localCommand?: string[];
    mockReport?: ExecutionReport;
    executionMode?: ExecutionMode;
    workspaceRoot?: string | null;
    taskId?: string;
    applyAllowed?: boolean;
  };
};

export type ExecutionProviderRunStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

export type ExecutionProviderRun = {
  runId: string;
  status: ExecutionProviderRunStatus;
};

export interface ExecutionProvider {
  readonly kind: ExecutorProviderKind;
  submitTask(task: ExecutionProviderTask): Promise<ExecutionProviderRun>;
  pollRun(runId: string): Promise<ExecutionProviderRun>;
  cancelRun(runId: string): Promise<void>;
  collectResult(runId: string): Promise<ExecutionReport>;
}

export type StoredRun = {
  status: ExecutionProviderRunStatus;
  promise: Promise<ExecutionReport>;
  result?: ExecutionReport;
  error?: Error;
};

function validateExecutionReport(data: unknown) {
  return parseWithDualValidation({
    schemaName: "ExecutionReport",
    zodSchema: executionReportSchema,
    jsonSchema: executionReportJsonSchema,
    data,
  });
}

export class MockExecutor implements ExecutionProvider {
  readonly kind = "mock" as const;
  private readonly runs = new Map<string, StoredRun>();
  private readonly queuedReports: ExecutionReport[];

  constructor(queuedReports: ExecutionReport[] = []) {
    this.queuedReports = [...queuedReports];
  }

  enqueueReports(reports: ExecutionReport[]) {
    this.queuedReports.push(...reports);
  }

  async submitTask(task: ExecutionProviderTask) {
    const runId = randomUUID();
    const report =
      task.metadata?.mockReport ??
      this.queuedReports.shift() ??
      validateExecutionReport({
        iterationNumber: task.iterationNumber,
        changedFiles: [],
        checkedButUnmodifiedFiles: task.allowedFiles,
        summaryOfChanges: ["MockExecutor executed a dry loop without touching the repository."],
        whyThisWasDone: ["The MVP loop needs an executor even before a real coding-agent provider is wired in."],
        howBehaviorWasKeptStable: ["Mock execution does not modify runtime code."],
        localValidation: task.acceptanceCommands.map((command) => ({
          command,
          status: "passed",
          output: "mock pass",
        })),
        ciValidation: null,
        blockers: [],
        risks: ["MockExecutor does not validate real repository edits."],
        recommendedNextStep: "Replace MockExecutor with LocalRepoExecutor or a real coding-agent provider.",
        shouldCloseSlice: false,
        artifacts: [{ kind: "prompt", label: "Submitted prompt", path: null, value: task.prompt }],
        rawExecutorOutput: { provider: "mock", executionMode: task.metadata?.executionMode ?? "mock" },
      });

    const promise = Promise.resolve(report);
    this.runs.set(runId, {
      status: "completed",
      promise,
      result: report,
    });

    return { runId, status: "completed" } satisfies ExecutionProviderRun;
  }

  async pollRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`MockExecutor run ${runId} was not found.`);
    return { runId, status: run.status } satisfies ExecutionProviderRun;
  }

  async cancelRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "cancelled";
  }

  async collectResult(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`MockExecutor run ${runId} was not found.`);
    return run.result ?? (await run.promise);
  }
}

export async function runCommand(repoPath: string, command: string[]) {
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

export class LocalRepoExecutor implements ExecutionProvider {
  readonly kind = "local_repo" as const;
  private readonly runs = new Map<string, StoredRun>();

  async submitTask(task: ExecutionProviderTask) {
    const runId = randomUUID();
    const command = task.metadata?.localCommand;
    if (!command) {
      throw new Error("LocalRepoExecutor requires metadata.localCommand.");
    }

    const promise = runCommand(task.repoPath, command)
      .then(({ stdout, stderr }) =>
        validateExecutionReport({
          iterationNumber: task.iterationNumber,
          changedFiles: [],
          checkedButUnmodifiedFiles: task.allowedFiles,
          summaryOfChanges: [`LocalRepoExecutor ran: ${command.join(" ")}`],
          whyThisWasDone: ["The orchestrator needs a real local execution provider before a coding-agent API exists."],
          howBehaviorWasKeptStable: ["LocalRepoExecutor only runs allow-listed commands."],
          localValidation: task.acceptanceCommands.map((validationCommand) => ({
            command: validationCommand,
            status: "not_run",
            output: null,
          })),
          ciValidation: null,
          blockers: [],
          risks: ["LocalRepoExecutor only validates controlled local commands in this MVP."],
          recommendedNextStep: "Swap LocalRepoExecutor command payloads for a real coding-agent provider when available.",
          shouldCloseSlice: false,
          artifacts: [
            { kind: "stdout", label: "stdout", path: null, value: stdout.trim() || null },
            { kind: "stderr", label: "stderr", path: null, value: stderr.trim() || null },
          ],
          rawExecutorOutput: { provider: "local_repo", command, executionMode: task.metadata?.executionMode ?? "dry_run" },
        }),
      )
      .catch((error) =>
        validateExecutionReport({
          iterationNumber: task.iterationNumber,
          changedFiles: [],
          checkedButUnmodifiedFiles: task.allowedFiles,
          summaryOfChanges: [`LocalRepoExecutor failed while running: ${command.join(" ")}`],
          whyThisWasDone: ["The orchestrator must surface local execution failures in a normalized report."],
          howBehaviorWasKeptStable: ["Execution failure is reported without touching protected files."],
          localValidation: task.acceptanceCommands.map((validationCommand) => ({
            command: validationCommand,
            status: "not_run",
            output: null,
          })),
          ciValidation: null,
          blockers: [error instanceof Error ? error.message : "Unknown LocalRepoExecutor failure"],
          risks: ["The requested local command failed."],
          recommendedNextStep: "Fix the local command or use MockExecutor to continue iterating.",
          shouldCloseSlice: false,
          artifacts: [],
          rawExecutorOutput: { provider: "local_repo", command, executionMode: task.metadata?.executionMode ?? "dry_run" },
        }),
      );

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

    return { runId, status: "running" } satisfies ExecutionProviderRun;
  }

  async pollRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`LocalRepoExecutor run ${runId} was not found.`);
    return { runId, status: run.status };
  }

  async cancelRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "cancelled";
  }

  async collectResult(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`LocalRepoExecutor run ${runId} was not found.`);
    return run.result ?? (await run.promise);
  }
}

export { OpenAIResponsesExecutorProvider };
