import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitHubDraftRequest = {
  repoPath: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  payloadRoot: string;
  stateId: string;
  iterationNumber: number;
};

export type GitHubHandoffResult = {
  status: "not_requested" | "skipped" | "payload_only" | "draft_created" | "failed";
  provider: string;
  targetBranch: string | null;
  draftUrl: string | null;
  summary: string;
  requestPayloadPath: string | null;
  ranAt: string;
};

export interface GitHubHandoffAdapter {
  readonly kind: string;
  createDraftPullRequest(request: GitHubDraftRequest): Promise<GitHubHandoffResult>;
}

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: {
    cwd: string;
    windowsHide: boolean;
    env: NodeJS.ProcessEnv;
  },
) => Promise<{ stdout: string; stderr: string }>;

export class MockGitHubHandoffAdapter implements GitHubHandoffAdapter {
  readonly kind = "mock_github_handoff" as const;

  constructor(private readonly result: GitHubHandoffResult) {}

  async createDraftPullRequest() {
    return this.result;
  }
}

export async function writeDraftPullRequestPayload(request: GitHubDraftRequest) {
  const handoffDir = path.join(request.payloadRoot, request.stateId, `iteration-${request.iterationNumber}`);
  await mkdir(handoffDir, { recursive: true });
  const payloadPath = path.join(handoffDir, "github-draft-request.json");
  await writeFile(
    payloadPath,
    `${JSON.stringify(
      {
        title: request.title,
        body: request.body,
        headBranch: request.headBranch,
        baseBranch: request.baseBranch,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return payloadPath;
}

export class GhCliDraftPullRequestAdapter implements GitHubHandoffAdapter {
  readonly kind = "gh_cli" as const;

  constructor(
    private readonly params: {
      enabled?: boolean;
      token?: string | null;
      execFileImpl?: ExecFileLike;
    } = {},
  ) {}

  async createDraftPullRequest(request: GitHubDraftRequest): Promise<GitHubHandoffResult> {
    const ranAt = new Date().toISOString();
    const payloadPath = await writeDraftPullRequestPayload(request);

    if (!this.params.enabled) {
      return {
        status: "skipped",
        provider: this.kind,
        targetBranch: request.headBranch,
        draftUrl: null,
        summary: "GitHub handoff is disabled by configuration.",
        requestPayloadPath: payloadPath,
        ranAt,
      };
    }

    if (!this.params.token) {
      return {
        status: "skipped",
        provider: this.kind,
        targetBranch: request.headBranch,
        draftUrl: null,
        summary: "GitHub handoff skipped because GITHUB_TOKEN is missing.",
        requestPayloadPath: payloadPath,
        ranAt,
      };
    }

    try {
      const bodyFile = path.join(path.dirname(payloadPath), "github-draft-body.md");
      await writeFile(bodyFile, request.body, "utf8");
      const { stdout } = await (this.params.execFileImpl ?? execFileAsync)(
        "gh",
        ["pr", "create", "--draft", "--title", request.title, "--body-file", bodyFile, "--head", request.headBranch, "--base", request.baseBranch],
        {
          cwd: request.repoPath,
          windowsHide: true,
          env: {
            ...process.env,
            GITHUB_TOKEN: this.params.token,
          },
        },
      );
      return {
        status: "draft_created",
        provider: this.kind,
        targetBranch: request.headBranch,
        draftUrl: stdout.trim() || null,
        summary: "GitHub draft PR handoff created successfully.",
        requestPayloadPath: payloadPath,
        ranAt,
      };
    } catch (error) {
      return {
        status: "failed",
        provider: this.kind,
        targetBranch: request.headBranch,
        draftUrl: null,
        summary: error instanceof Error ? error.message : String(error),
        requestPayloadPath: payloadPath,
        ranAt,
      };
    }
  }
}
