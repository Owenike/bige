import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { JobRerunDryRunPlan } from "./job-rerun";

type PreviewTokenPayload = {
  v: 1;
  iat: number;
  exp: number;
  actorUserId: string;
  targetType: "job_run";
  targetId: string;
  failedOnly: true;
  planHash: string;
};

function toBase64Url(input: Buffer | string) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function getPreviewSecret() {
  const value = process.env.JOB_RERUN_PREVIEW_SECRET || "";
  return value.trim();
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function hashDryRunPlan(plan: JobRerunDryRunPlan) {
  const stable = stableJson({
    target: plan.target,
    failedOnly: plan.failedOnly,
    planned: plan.planned,
    skipped: plan.skipped.map((item) => ({ sourceJobRunId: item.sourceJobRunId, reasonCode: item.reasonCode })),
    lockConflicts: plan.lockConflicts.map((item) => ({ scopeKey: item.scopeKey, expiresAt: item.expiresAt })),
    dedupeSignals: plan.dedupeSignals.map((item) => item.code),
  });
  return createHash("sha256").update(stable).digest("hex");
}

export function issueJobRerunPreviewToken(params: {
  actorUserId: string;
  plan: JobRerunDryRunPlan;
  ttlSeconds?: number;
}) {
  const secret = getPreviewSecret();
  if (!secret) return { ok: false as const, error: "Missing JOB_RERUN_PREVIEW_SECRET" };
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = Math.min(3600, Math.max(60, Math.floor(params.ttlSeconds || 600)));
  const payload: PreviewTokenPayload = {
    v: 1,
    iat: nowSec,
    exp: nowSec + ttl,
    actorUserId: params.actorUserId,
    targetType: "job_run",
    targetId: params.plan.target.jobRunId,
    failedOnly: true,
    planHash: hashDryRunPlan(params.plan),
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = toBase64Url(createHmac("sha256", secret).update(encodedPayload).digest());
  return {
    ok: true as const,
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyJobRerunPreviewToken(params: {
  token: string;
  actorUserId: string;
  plan: JobRerunDryRunPlan;
}) {
  const secret = getPreviewSecret();
  if (!secret) return { ok: false as const, error: "Missing JOB_RERUN_PREVIEW_SECRET" };
  const parts = params.token.split(".");
  if (parts.length !== 2) return { ok: false as const, error: "Invalid preview token format" };
  const [encodedPayload, encodedSignature] = parts;
  const expectedSignature = toBase64Url(createHmac("sha256", secret).update(encodedPayload).digest());
  const left = Buffer.from(encodedSignature, "utf8");
  const right = Buffer.from(expectedSignature, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false as const, error: "Invalid preview token signature" };
  }

  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload).toString("utf8")) as PreviewTokenPayload;
  } catch {
    return { ok: false as const, error: "Invalid preview token payload" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.v !== 1) return { ok: false as const, error: "Unsupported preview token version" };
  if (payload.exp < nowSec) return { ok: false as const, error: "Preview token expired" };
  if (payload.actorUserId !== params.actorUserId) return { ok: false as const, error: "Preview token actor mismatch" };
  if (payload.targetType !== "job_run" || payload.targetId !== params.plan.target.jobRunId) {
    return { ok: false as const, error: "Preview token target mismatch" };
  }
  if (payload.failedOnly !== true || params.plan.failedOnly !== true) {
    return { ok: false as const, error: "Preview token failed-only mismatch" };
  }
  const expectedPlanHash = hashDryRunPlan(params.plan);
  if (payload.planHash !== expectedPlanHash) {
    return { ok: false as const, error: "Preview token does not match current dry-run plan" };
  }
  return {
    ok: true as const,
    payload,
  };
}
