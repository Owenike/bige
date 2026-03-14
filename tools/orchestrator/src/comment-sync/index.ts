import type { OrchestratorState, StatusReportTarget } from "../schemas";

export function buildStatusReportCorrelationId(state: OrchestratorState) {
  return state.statusReportCorrelationId ?? `orchestrator-status:${state.id}`;
}

export function buildStatusReportMarker(correlationId: string) {
  return `<!-- ${correlationId} -->`;
}

export function withStatusReportMarker(markdown: string, correlationId: string) {
  const marker = buildStatusReportMarker(correlationId);
  if (markdown.includes(marker)) {
    return markdown;
  }
  return `${marker}\n${markdown}`;
}

export function extractCorrelationIdFromBody(body: string) {
  const match = body.match(/<!--\s*(orchestrator-status:[^>\s]+)\s*-->/i);
  return match ? match[1] : null;
}

export function extractCommentIdFromUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }
  const match = url.match(/issuecomment-(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function deriveStatusReportTarget(params: {
  state: OrchestratorState;
  correlationId: string;
  targetUrl: string | null;
  targetNumber: number | null;
  commentId: number | null;
  targetKind?: StatusReportTarget["kind"] | null;
  updatedAt: string;
}): StatusReportTarget {
  const source = params.state.sourceEventSummary;
  return {
    kind: params.targetKind ?? (source?.prNumber ? "pull_request_comment" : source?.issueNumber ? "issue_comment" : "artifact_only"),
    repository: source?.repository ?? null,
    targetNumber: params.targetNumber,
    commentId: params.commentId,
    targetUrl: params.targetUrl,
    correlationId: params.correlationId,
    updatedAt: params.updatedAt,
  };
}
