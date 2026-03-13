import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ciStatusSummarySchema, type CIStatusSummary } from "../schemas";

const execFileAsync = promisify(execFile);

export interface GitHubStatusAdapter {
  getRunSummary(runId: string): Promise<CIStatusSummary>;
}

export class MockGitHubStatusAdapter implements GitHubStatusAdapter {
  constructor(private readonly summary: CIStatusSummary) {}

  async getRunSummary() {
    return ciStatusSummarySchema.parse(this.summary);
  }
}

export class GitHubCliStatusAdapter implements GitHubStatusAdapter {
  async getRunSummary(runId: string) {
    const { stdout } = await execFileAsync("gh", ["run", "view", runId, "--json", "status,conclusion,jobs"], {
      windowsHide: true,
    });
    const payload = JSON.parse(stdout) as {
      status: string;
      conclusion: string | null;
      jobs?: Array<{
        name: string;
        conclusion: string | null;
        status: string;
      }>;
    };

    return ciStatusSummarySchema.parse({
      provider: "github",
      workflowName: "GitHub Actions",
      runId,
      status:
        payload.status === "completed"
          ? payload.conclusion === "success"
            ? "success"
            : payload.conclusion === "skipped"
              ? "skipped"
              : "failure"
          : "in_progress",
      jobs: (payload.jobs ?? []).map((job) => ({
        name: job.name,
        status:
          job.status === "completed"
            ? job.conclusion === "success"
              ? "success"
              : job.conclusion === "skipped"
                ? "skipped"
                : "failure"
            : "in_progress",
        details: null,
      })),
      summary: `GitHub run ${runId} => ${payload.status}/${payload.conclusion ?? "n/a"}`,
    });
  }
}
