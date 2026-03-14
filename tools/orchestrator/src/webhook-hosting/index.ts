import type { OrchestratorDependencies } from "../orchestrator";
import {
  formatWebhookHostingConfig,
  loadWebhookHostingConfig,
  type WebhookHostingConfig,
} from "../runtime-config";
import {
  startWebhookServer,
  type WebhookServerHandle,
} from "../webhook-server";
import { formatWebhookRuntimeSummary, type WebhookRuntimeSummary } from "../webhook-runtime";

export type WebhookHostingHandle = WebhookServerHandle & {
  config: WebhookHostingConfig;
  startupText: string;
};

export async function startWebhookHosting(params: {
  repoPath: string;
  dependencies: OrchestratorDependencies;
  outputRoot?: string | null;
  env?: NodeJS.ProcessEnv;
  options?: {
    host?: string | null;
    port?: string | number | null;
    basePath?: string | null;
    webhookPath?: string | null;
    webhookSecret?: string | null;
    actorPolicyConfigPath?: string | null;
    liveReportingEnabled?: boolean | null;
    enqueue?: boolean;
    replayOverride?: boolean;
    reportStatus?: boolean;
  };
}) {
  const config = loadWebhookHostingConfig({
    repoPath: params.repoPath,
    outputRoot: params.outputRoot,
    env: params.env,
    options: {
      host: params.options?.host,
      port: params.options?.port,
      basePath: params.options?.basePath,
      webhookPath: params.options?.webhookPath,
      webhookSecret: params.options?.webhookSecret,
      actorPolicyConfigPath: params.options?.actorPolicyConfigPath,
      liveReportingEnabled: params.options?.liveReportingEnabled,
    },
  });
  const handle = await startWebhookServer({
    port: config.port,
    host: config.host,
    basePath: config.basePath,
    secret: config.webhookSecret,
    dependencies: params.dependencies,
    repoPath: params.repoPath,
    outputRoot: config.outputRoot,
    webhookPath: config.webhookPath,
    actorPolicyConfigPath: config.actorPolicyConfigPath,
    enqueue: params.options?.enqueue,
    replayOverride: params.options?.replayOverride,
    reportStatus: params.options?.reportStatus,
  });

  return {
    ...handle,
    config,
    startupText: formatWebhookHostingStartup({
      config,
      runtime: handle.startupSummary,
      url: handle.url,
      healthUrl: handle.healthUrl,
      readinessUrl: handle.readinessUrl,
    }),
  } satisfies WebhookHostingHandle;
}

export function formatWebhookHostingStartup(params: {
  config: WebhookHostingConfig;
  runtime: WebhookRuntimeSummary;
  url: string;
  healthUrl: string;
  readinessUrl: string;
}) {
  return [
    "Webhook hosting ready",
    formatWebhookHostingConfig(params.config),
    `url=${params.url}`,
    `healthUrl=${params.healthUrl}`,
    `readinessUrl=${params.readinessUrl}`,
    formatWebhookRuntimeSummary(params.runtime),
  ].join("\n");
}

export function formatWebhookShutdownSummary(summary: {
  reason: string;
  inFlightCompleted: number;
  closedAt: string;
}) {
  return [
    "Webhook hosting stopped",
    `reason=${summary.reason}`,
    `inFlightCompleted=${summary.inFlightCompleted}`,
    `closedAt=${summary.closedAt}`,
  ].join("\n");
}
