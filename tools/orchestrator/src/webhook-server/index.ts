import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ingestGitHubWebhook } from "../webhook";
import { GhCliStatusReportingAdapter } from "../status-reporting";
import type { OrchestratorDependencies } from "../orchestrator";

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
  close(): Promise<void>;
};

export async function handleWebhookHttpRequest(params: {
  request: IncomingMessage;
  response: ServerResponse;
  secret: string | null;
  dependencies: OrchestratorDependencies;
  repoPath: string;
  outputRoot: string;
  webhookPath?: string;
  enqueue?: boolean;
  replayOverride?: boolean;
  reportStatus?: boolean;
}) {
  const webhookPath = params.webhookPath ?? "/github";
  const requestUrl = new URL(params.request.url ?? webhookPath, "http://127.0.0.1");
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
  });
  params.response.statusCode = result.status === "rejected" ? 401 : result.status === "duplicate" ? 202 : 200;
  params.response.setHeader("content-type", "application/json; charset=utf-8");
  params.response.end(JSON.stringify(result, null, 2));
}

export async function startWebhookServer(params: {
  port: number;
  secret: string | null;
  dependencies: OrchestratorDependencies;
  repoPath: string;
  outputRoot: string;
  webhookPath?: string;
  enqueue?: boolean;
  replayOverride?: boolean;
  reportStatus?: boolean;
}) {
  const webhookPath = params.webhookPath ?? "/github";
  const server = createServer(async (request, response) => {
    try {
      await handleWebhookHttpRequest({
        request,
        response,
        secret: params.secret,
        dependencies: params.dependencies,
        repoPath: params.repoPath,
        outputRoot: params.outputRoot,
        webhookPath,
        enqueue: params.enqueue,
        replayOverride: params.replayOverride,
        reportStatus: params.reportStatus,
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
    server.listen(params.port, "127.0.0.1", () => resolve());
  });
  return {
    server,
    url: `http://127.0.0.1:${params.port}${webhookPath}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  } satisfies WebhookServerHandle;
}
