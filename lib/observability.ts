export type LogLevel = "debug" | "info" | "warn" | "error";

const REQUEST_ID_HEADER = "x-request-id";

export function getRequestId(request?: Request): string | null {
  if (!request) return null;
  return request.headers.get(REQUEST_ID_HEADER) || request.headers.get(REQUEST_ID_HEADER.toUpperCase()) || null;
}

export function getClientIp(request?: Request): string | null {
  if (!request) return null;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim() || null;
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim() || null;
  return null;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "log_unserializable" });
  }
}

export function logEvent(level: LogLevel, event: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    ...event,
  };

  const line = safeJsonStringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function httpLogBase(request: Request) {
  return {
    requestId: getRequestId(request),
    method: request.method,
    path: (() => {
      try {
        return new URL(request.url).pathname;
      } catch {
        return null;
      }
    })(),
    ip: getClientIp(request),
  };
}

