import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { OrchestratorDependencies } from "../orchestrator";
import { assessGitHubLiveReporting } from "../status-reporting";
import { describeActorPolicyConfig, loadActorPolicyConfig, type LoadedActorPolicyConfig } from "../actor-policy-config";

const execFileAsync = promisify(execFile);

export type WebhookRuntimeSummary = {
  status: "ready" | "degraded" | "blocked";
  healthStatus: "ready" | "degraded" | "blocked";
  readinessStatus: "ready" | "degraded" | "blocked";
  host: string;
  port: number;
  basePath: string;
  webhookPath: string;
  summary: string;
  missingPrerequisites: string[];
  actorPolicy: LoadedActorPolicyConfig | null;
  liveReporting: {
    status: "ready" | "degraded" | "blocked";
    summary: string;
    missingPrerequisites: string[];
  };
  backend: {
    status: string;
    summary: string;
    backendType: string;
  };
  startedAt: string;
};

async function checkGhAvailability() {
  try {
    await execFileAsync("gh", ["--version"], { windowsHide: true, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

export async function evaluateWebhookRuntime(params: {
  dependencies: OrchestratorDependencies;
  webhookSecret: string | null;
  actorPolicyConfigPath?: string | null;
  liveReportingEnabled?: boolean;
  host?: string;
  port?: number;
  basePath?: string;
  webhookPath?: string;
}) : Promise<WebhookRuntimeSummary> {
  const startedAt = new Date().toISOString();
  const missingPrerequisites: string[] = [];
  let actorPolicy: LoadedActorPolicyConfig | null = null;
  let actorPolicyError: string | null = null;
  try {
    actorPolicy = await loadActorPolicyConfig({
      configPath: params.actorPolicyConfigPath ?? null,
    });
  } catch (error) {
    actorPolicyError = error instanceof Error ? error.message : "Actor policy config could not be loaded.";
  }
  const liveReporting = await assessGitHubLiveReporting({
    enabled: params.liveReportingEnabled ?? true,
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    execFileImpl: async (file, args, options) => {
      const { stdout, stderr } = await execFileAsync(file, [...args], {
        windowsHide: options?.windowsHide,
        encoding: "utf8",
      });
      return {
        stdout: String(stdout),
        stderr: String(stderr),
      };
    },
  });
  const backendStatus = await params.dependencies.backend.status();
  const ghAvailable = await checkGhAvailability();

  if (!params.webhookSecret) {
    missingPrerequisites.push("GITHUB_WEBHOOK_SECRET");
  }
  if (actorPolicyError) {
    missingPrerequisites.push(params.actorPolicyConfigPath ?? "actor-policy-config");
  }
  if (!ghAvailable) {
    missingPrerequisites.push("gh");
  }
  missingPrerequisites.push(...liveReporting.missingPrerequisites.filter((value) => !missingPrerequisites.includes(value)));

  const readinessStatus =
    !params.webhookSecret
      ? "blocked"
      : actorPolicyError
        ? "blocked"
      : backendStatus.status === "blocked" || backendStatus.status === "manual_required"
        ? "blocked"
        : liveReporting.status === "ready"
          ? "ready"
          : "degraded";
  const healthStatus =
    backendStatus.status === "blocked"
      ? "blocked"
      : backendStatus.status === "manual_required"
        ? "degraded"
        : "ready";
  const status = readinessStatus === "blocked" ? "blocked" : healthStatus === "blocked" ? "blocked" : readinessStatus === "degraded" || healthStatus === "degraded" ? "degraded" : "ready";

  return {
    status,
    healthStatus,
    readinessStatus,
    summary: [
      `runtime=${status}`,
      `health=${healthStatus}`,
      `readiness=${readinessStatus}`,
      `host=${params.host ?? "127.0.0.1"}`,
      `port=${params.port ?? 8787}`,
      `basePath=${params.basePath ?? "/"}`,
      `webhookPath=${params.webhookPath ?? "/github"}`,
      `backend=${backendStatus.backendType}/${backendStatus.status}`,
      `actorPolicy=${actorPolicy ? describeActorPolicyConfig(actorPolicy) : actorPolicyError ?? "unavailable"}`,
      `liveReporting=${liveReporting.status}`,
    ].join(" | "),
    host: params.host ?? "127.0.0.1",
    port: params.port ?? 8787,
    basePath: params.basePath ?? "",
    webhookPath: params.webhookPath ?? "/github",
    missingPrerequisites,
    actorPolicy,
    liveReporting,
    backend: {
      status: backendStatus.status,
      summary: backendStatus.summary,
      backendType: backendStatus.backendType,
    },
    startedAt,
  };
}

export function formatWebhookRuntimeSummary(summary: WebhookRuntimeSummary) {
  return [
    `Runtime: ${summary.status}`,
    `Health: ${summary.healthStatus}`,
    `Readiness: ${summary.readinessStatus}`,
    `Host: ${summary.host}`,
    `Port: ${summary.port}`,
    `Base path: ${summary.basePath || "/"}`,
    `Webhook path: ${summary.webhookPath}`,
    `Backend: ${summary.backend.backendType} (${summary.backend.status})`,
    `Backend summary: ${summary.backend.summary}`,
    `Actor policy: ${summary.actorPolicy ? describeActorPolicyConfig(summary.actorPolicy) : "none"}`,
    `Live reporting: ${summary.liveReporting.status} (${summary.liveReporting.summary})`,
    `Missing prerequisites: ${summary.missingPrerequisites.join(", ") || "none"}`,
  ].join("\n");
}
