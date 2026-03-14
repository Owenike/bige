import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ingestGitHubWebhook } from "../webhook";
import { GhCliStatusReportingAdapter } from "../status-reporting";
import type { OrchestratorDependencies } from "../orchestrator";
import { evaluateWebhookRuntime, type WebhookRuntimeSummary } from "../webhook-runtime";
import { buildWebhookRoute } from "../runtime-config";

async function readRawBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type WebhookServerHandle = {
  server: Server;
  url: string;
  healthUrl: string;
  readinessUrl: string;
  startupSummary: WebhookRuntimeSummary;
  shutdownSummary: {
    reason: string;
    inFlightCompleted: number;
    closedAt: string;
  } | null;
  shutdown(reason?: string): Promise<{
    reason: string;
    inFlightCompleted: number;
    closedAt: string;
  }>;
  close(): Promise<void>;
};

async function respondRuntimeSummary(params: {
  response: ServerResponse;
  statusCode: number;
  summary: WebhookRuntimeSummary;
}) {
  params.response.statusCode = params.statusCode;
  params.response.setHeader("content-type", "application/json; charset=utf-8");
  params.response.end(JSON.stringify(params.summary, null, 2));
}

export async function handleWebhookHttpRequest(params: {
  request: IncomingMessage;
  response: ServerResponse;
  secret: string | null;
  dependencies: OrchestratorDependencies;
  repoPath: string;
  outputRoot: string;
  webhookPath?: string;
  host?: string;
  basePath?: string;
  actorPolicyConfigPath?: string | null;
  enqueue?: boolean;
  replayOverride?: boolean;
  reportStatus?: boolean;
  isShuttingDown?: () => boolean;
  markRequestStarted?: () => void;
  markRequestFinished?: () => void;
}) {
  const configuredWebhookPath = params.webhookPath ?? "/github";
  const webhookPath = buildWebhookRoute(params.basePath ?? "", configuredWebhookPath);
  const healthPath = buildWebhookRoute(params.basePath ?? "", "/healthz");
  const readinessPath = buildWebhookRoute(params.basePath ?? "", "/readyz");
  const requestUrl = new URL(params.request.url ?? webhookPath, `http://${params.host ?? "127.0.0.1"}`);

  if (params.isShuttingDown?.()) {
    params.response.statusCode = 503;
    params.response.setHeader("content-type", "application/json; charset=utf-8");
    params.response.end(
      JSON.stringify({
        ok: false,
        status: "blocked",
        summary: "Webhook server is shutting down and is no longer accepting new requests.",
      }),
    );
    return;
  }

  params.markRequestStarted?.();

  try {
    if (params.request.method === "GET" && requestUrl.pathname === healthPath) {
      const summary = await evaluateWebhookRuntime({
        dependencies: params.dependencies,
        webhookSecret: params.secret,
        actorPolicyConfigPath: params.actorPolicyConfigPath ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
        liveReportingEnabled: true,
        host: params.host,
        port: undefined,
        basePath: params.basePath ?? "",
        webhookPath: configuredWebhookPath,
      });
      await respondRuntimeSummary({
        response: params.response,
        statusCode: summary.healthStatus === "blocked" ? 503 : 200,
        summary,
      });
      return;
    }

    if (params.request.method === "GET" && requestUrl.pathname === readinessPath) {
      const summary = await evaluateWebhookRuntime({
        dependencies: params.dependencies,
        webhookSecret: params.secret,
        actorPolicyConfigPath: params.actorPolicyConfigPath ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
        liveReportingEnabled: true,
        host: params.host,
        port: undefined,
        basePath: params.basePath ?? "",
        webhookPath: configuredWebhookPath,
      });
      await respondRuntimeSummary({
        response: params.response,
        statusCode: summary.readinessStatus === "blocked" ? 503 : 200,
        summary,
      });
      return;
    }

    if (params.request.method !== "POST" || requestUrl.pathname !== webhookPath) {
      params.response.statusCode = requestUrl.pathname === webhookPath ? 405 : 404;
      params.response.setHeader("content-type", "application/json; charset=utf-8");
      params.response.end(
        JSON.stringify({
          ok: false,
          status: "rejected",
          summary: requestUrl.pathname === webhookPath ? "Only POST is supported for webhook intake." : "Webhook route not found.",
        }),
      );
      return;
    }

    const rawBody = await readRawBody(params.request);
    const headers = Object.fromEntries(
      Object.entries(params.request.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(",") : value,
      ]),
    );
    const result = await ingestGitHubWebhook({
      rawBody,
      headers,
      secret: params.secret,
      dependencies: params.dependencies,
      repoPath: params.repoPath,
      enqueue: params.enqueue ?? true,
      replayOverride: params.replayOverride ?? false,
      reportStatus: params.reportStatus ?? true,
      statusAdapter: new GhCliStatusReportingAdapter({
        enabled: true,
        token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      }),
      statusOutputRoot: params.outputRoot,
      actorPolicyConfigPath: params.actorPolicyConfigPath ?? null,
    });
    params.response.statusCode = result.status === "rejected" ? 401 : result.status === "duplicate" ? 202 : 200;
    params.response.setHeader("content-type", "application/json; charset=utf-8");
    params.response.end(JSON.stringify(result, null, 2));
  } finally {
    params.markRequestFinished?.();
  }
}

export async function startWebhookServer(params: {
  port: number;
  host?: string;
  basePath?: string;
  secret: string | null;
  dependencies: OrchestratorDependencies;
  repoPath: string;
  outputRoot: string;
  webhookPath?: string;
  actorPolicyConfigPath?: string | null;
  enqueue?: boolean;
  replayOverride?: boolean;
  reportStatus?: boolean;
}) {
  const host = params.host ?? "127.0.0.1";
  const basePath = params.basePath ?? "";
  const routePath = params.webhookPath ?? "/github";
  const webhookPath = buildWebhookRoute(basePath, routePath);
  const healthPath = buildWebhookRoute(basePath, "/healthz");
  const readinessPath = buildWebhookRoute(basePath, "/readyz");
  const startupSummary = await evaluateWebhookRuntime({
    dependencies: params.dependencies,
    webhookSecret: params.secret,
    actorPolicyConfigPath: params.actorPolicyConfigPath ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
    liveReportingEnabled: true,
    host,
    port: params.port,
    basePath,
    webhookPath: routePath,
  });
  let inFlightRequests = 0;
  let shuttingDown = false;
  let shutdownSummary: WebhookServerHandle["shutdownSummary"] = null;
  const server = createServer(async (request, response) => {
    try {
      await handleWebhookHttpRequest({
        request,
        response,
        secret: params.secret,
        dependencies: params.dependencies,
        repoPath: params.repoPath,
        outputRoot: params.outputRoot,
        webhookPath: routePath,
        host,
        basePath,
        actorPolicyConfigPath: params.actorPolicyConfigPath,
        enqueue: params.enqueue,
        replayOverride: params.replayOverride,
        reportStatus: params.reportStatus,
        isShuttingDown: () => shuttingDown,
        markRequestStarted: () => {
          inFlightRequests += 1;
        },
        markRequestFinished: () => {
          inFlightRequests = Math.max(0, inFlightRequests - 1);
        },
      });
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          ok: false,
          status: "failed",
          summary: error instanceof Error ? error.message : "Webhook server failed.",
        }),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(params.port, host, () => resolve());
  });

  async function shutdown(reason = "shutdown_requested") {
    shuttingDown = true;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    const closedAt = new Date().toISOString();
    shutdownSummary = {
      reason,
      inFlightCompleted: inFlightRequests,
      closedAt,
    };
    return shutdownSummary;
  }

  return {
    server,
    url: `http://${host}:${params.port}${webhookPath}`,
    healthUrl: `http://${host}:${params.port}${healthPath}`,
    readinessUrl: `http://${host}:${params.port}${readinessPath}`,
    startupSummary,
    get shutdownSummary() {
      return shutdownSummary;
    },
    shutdown,
    async close() {
      await shutdown("close");
    },
  } satisfies WebhookServerHandle;
}
