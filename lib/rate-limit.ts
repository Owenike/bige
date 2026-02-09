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

