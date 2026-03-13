import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { LiveSmokeResult } from "../schemas";

async function safeJsonArrayLength(targetPath: string | null) {
  if (!targetPath) return 0;
  try {
    const content = await readFile(targetPath, "utf8");
    const payload = JSON.parse(content) as unknown;
    return Array.isArray(payload) ? payload.length : 0;
  } catch {
    return 0;
  }
}

export async function writeLiveEvidence(params: {
  stateId: string;
  iterationNumber: number;
  outputRoot: string;
  result: LiveSmokeResult;
  startedAt: string;
  endedAt: string;
}) {
  const evidenceDir = path.join(params.outputRoot, params.stateId, `iteration-${Math.max(params.iterationNumber, 1)}`);
  await mkdir(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, "live-evidence.json");
  const toolCallCount = await safeJsonArrayLength(params.result.toolLogPath);
  const commandCount = await safeJsonArrayLength(params.result.commandLogPath);
  const payload = {
    provider: params.result.provider,
    model: params.result.model,
    status: params.result.status,
    reason: params.result.reason,
    summary: params.result.summary,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    toolCallCount,
    commandCount,
    reportPath: params.result.reportPath,
    diffPath: params.result.diffPath,
    transcriptSummaryPath: params.result.transcriptSummaryPath,
    toolLogPath: params.result.toolLogPath,
    commandLogPath: params.result.commandLogPath,
    patchArtifactPath: params.result.diffPath,
  };
  await writeFile(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    evidencePath,
    evidence: payload,
  };
}
