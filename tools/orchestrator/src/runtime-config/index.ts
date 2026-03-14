import path from "node:path";

export type WebhookHostingConfig = {
  host: string;
  port: number;
  basePath: string;
  webhookPath: string;
  webhookSecret: string | null;
  actorPolicyConfigPath: string | null;
  liveReportingEnabled: boolean;
  outputRoot: string;
};

function normalizePathPrefix(value: string | null | undefined, fallback: string) {
  const raw = (value ?? fallback).trim();
  if (!raw || raw === "/") {
    return "";
  }
  return `/${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function normalizeRoute(value: string | null | undefined, fallback: string) {
  const raw = (value ?? fallback).trim();
  if (!raw) {
    return fallback;
  }
  return `/${raw.replace(/^\/+/, "")}`;
}

export function buildWebhookRoute(basePath: string, route: string) {
  const normalizedBase = normalizePathPrefix(basePath, "");
  const normalizedRoute = normalizeRoute(route, "/github");
  return `${normalizedBase}${normalizedRoute}` || normalizedRoute;
}

export function loadWebhookHostingConfig(params: {
  repoPath: string;
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
  };
}) : WebhookHostingConfig {
  const env = params.env ?? process.env;
  const host = params.options?.host ?? env.ORCHESTRATOR_WEBHOOK_HOST ?? "127.0.0.1";
  const portValue = params.options?.port ?? env.ORCHESTRATOR_WEBHOOK_PORT ?? "8787";
  const port = typeof portValue === "number" ? portValue : Number.parseInt(portValue, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid webhook port: ${portValue}`);
  }
  const basePath = normalizePathPrefix(params.options?.basePath ?? env.ORCHESTRATOR_WEBHOOK_BASE_PATH ?? "", "");
  const webhookPath = normalizeRoute(params.options?.webhookPath ?? env.ORCHESTRATOR_WEBHOOK_PATH ?? "/github", "/github");
  return {
    host,
    port,
    basePath,
    webhookPath,
    webhookSecret: params.options?.webhookSecret ?? env.GITHUB_WEBHOOK_SECRET ?? null,
    actorPolicyConfigPath: params.options?.actorPolicyConfigPath ?? env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
    liveReportingEnabled: params.options?.liveReportingEnabled ?? true,
    outputRoot: params.outputRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-status-report"),
  };
}

export function formatWebhookHostingConfig(config: WebhookHostingConfig) {
  return [
    `host=${config.host}`,
    `port=${config.port}`,
    `basePath=${config.basePath || "/"}`,
    `webhookPath=${config.webhookPath}`,
    `actorPolicyConfig=${config.actorPolicyConfigPath ?? "env/default"}`,
    `outputRoot=${config.outputRoot}`,
  ].join(" | ");
}
