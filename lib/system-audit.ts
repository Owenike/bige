import { createSupabaseAdminClient } from "./supabase/admin";
import { getClientIp, getRequestId, logEvent } from "./observability";

export type SystemAuditCategory =
  | "authentication"
  | "data_change"
  | "data_access"
  | "security"
  | "system";

export type SystemAuditOutcome = "success" | "failure" | "denied" | "rate_limited" | "info";

export type SystemAuditInput = {
  request?: Request;
  tenantId?: string | null;
  branchId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  accountType?: string | null;
  accountIdentifier?: string | null;
  eventCategory: SystemAuditCategory;
  action: string;
  outcome: SystemAuditOutcome;
  targetType?: string | null;
  targetId?: string | null;
  reason?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: Record<string, unknown> | null;
};

const SENSITIVE_KEY_PATTERN =
  /password|passcode|pin|token|secret|authorization|cookie|signaturedata|cardnumber|card_number|cvv|access_token|refresh_token/i;

function trimText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth >= 6) return "[MAX_DEPTH]";
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 100);
    return Object.fromEntries(
      entries.map(([key, item]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeAuditValue(item, depth + 1),
      ]),
    );
  }
  return String(value).slice(0, 4000);
}

export function buildSystemAuditRecord(input: SystemAuditInput) {
  const request = input.request;
  const requestUrl = request
    ? (() => {
        try {
          return new URL(request.url).pathname;
        } catch {
          return null;
        }
      })()
    : null;
  const platform = trimText(request?.headers.get("sec-ch-ua-platform"), 200)?.replace(/^"+|"+$/g, "") || null;
  const requestMetadata = request
    ? {
        method: request.method,
        path: requestUrl,
        platform,
      }
    : {};

  return {
    tenant_id: trimText(input.tenantId, 100),
    branch_id: trimText(input.branchId, 100),
    actor_id: trimText(input.actorId, 100),
    actor_role: trimText(input.actorRole, 100),
    account_type: trimText(input.accountType, 100),
    account_identifier: trimText(input.accountIdentifier, 254),
    event_category: input.eventCategory,
    action: input.action.slice(0, 200),
    outcome: input.outcome,
    target_type: trimText(input.targetType, 200),
    target_id: trimText(input.targetId, 500),
    reason: trimText(input.reason, 1000),
    before_state: input.beforeState === undefined ? null : sanitizeAuditValue(input.beforeState),
    after_state: input.afterState === undefined ? null : sanitizeAuditValue(input.afterState),
    metadata: sanitizeAuditValue({ ...requestMetadata, ...(input.metadata || {}) }),
    request_id: trimText(getRequestId(request), 200),
    ip_address: trimText(getClientIp(request), 200),
    user_agent: trimText(request?.headers.get("user-agent"), 1000),
  };
}

export async function recordSystemAuditEvent(input: SystemAuditInput) {
  try {
    const record = buildSystemAuditRecord(input);
    const result = await createSupabaseAdminClient().from("system_audit_events").insert(record);
    if (result.error) {
      logEvent("warn", {
        type: "system_audit",
        action: input.action,
        outcome: input.outcome,
        error: result.error.message,
      });
      return { ok: false as const, error: result.error.message };
    }
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "system_audit_write_failed";
    logEvent("warn", {
      type: "system_audit",
      action: input.action,
      outcome: input.outcome,
      error: message,
    });
    return { ok: false as const, error: message };
  }
}
