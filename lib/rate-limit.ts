import { createHash } from "crypto";
import { createSupabaseAdminClient } from "./supabase/admin";

type Bucket = {
  count: number;
  resetAtMs: number;
};

const buckets = new Map<string, Bucket>();

function nowMs() {
  return Date.now();
}

function sweepExpired(sampleChance: number) {
  // Avoid per-request O(n) work. This is best-effort cleanup.
  if (Math.random() > sampleChance) return;
  const now = nowMs();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAtMs <= now) buckets.delete(key);
  }
}

export function rateLimitFixedWindow(input: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  sweepExpired(0.01);

  const now = nowMs();
  const existing = buckets.get(input.key);
  const current =
    !existing || existing.resetAtMs <= now
      ? { count: 0, resetAtMs: now + input.windowMs }
      : existing;

  current.count += 1;
  buckets.set(input.key, current);

  const remaining = Math.max(0, input.limit - current.count);
  const ok = current.count <= input.limit;
  const retryAfterSec = Math.max(0, Math.ceil((current.resetAtMs - now) / 1000));

  return {
    ok,
    limit: input.limit,
    remaining,
    resetAtMs: current.resetAtMs,
    retryAfterSec,
  };
}

type SharedRateLimitRow = {
  allowed: boolean;
  remaining: number;
  reset_at: string;
};

/**
 * Uses Postgres as the shared production limiter so separate Vercel instances
 * cannot each maintain an independent allowance. Development stays local to
 * avoid touching the linked project while running tests or the dev server.
 * Production fails closed for a short interval when the shared limiter is
 * unavailable; the protected routes depend on the same database anyway.
 */
export async function rateLimitShared(input: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  if (process.env.NODE_ENV !== "production") {
    return rateLimitFixedWindow(input);
  }

  const keyHash = createHash("sha256").update(input.key, "utf8").digest("hex");
  try {
    const result = await createSupabaseAdminClient().rpc("consume_security_rate_limit_v1", {
      p_key_hash: keyHash,
      p_limit: input.limit,
      p_window_seconds: Math.max(1, Math.ceil(input.windowMs / 1000)),
    });
    if (result.error) throw result.error;

    const row = (Array.isArray(result.data) ? result.data[0] : result.data) as SharedRateLimitRow | null;
    if (!row || typeof row.allowed !== "boolean") throw new Error("invalid_rate_limit_response");

    const resetAtMs = Date.parse(row.reset_at);
    const retryAfterSec = Math.max(0, Math.ceil((resetAtMs - Date.now()) / 1000));
    return {
      ok: row.allowed,
      limit: input.limit,
      remaining: Math.max(0, Number(row.remaining || 0)),
      resetAtMs,
      retryAfterSec,
    };
  } catch (error) {
    console.error("[rate-limit] shared limiter unavailable", {
      code:
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code || "unknown")
          : "unknown",
    });
    return {
      ok: false,
      limit: input.limit,
      remaining: 0,
      resetAtMs: Date.now() + 30_000,
      retryAfterSec: 30,
    };
  }
}
