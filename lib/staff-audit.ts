import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function writeStaffAudit(params: {
  supabase: SupabaseClient;
  request?: Request;
  tenantId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  payload?: Record<string, unknown>;
}) {
  const forwardedFor = params.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = params.request?.headers.get("user-agent") || "unknown";
  const result = await params.supabase.from("audit_logs").insert({
    tenant_id: params.tenantId,
    actor_id: params.actorId,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId ?? null,
    reason: params.reason ?? null,
    payload: {
      ...(params.payload || {}),
      ...(params.before === undefined ? {} : { before: params.before }),
      ...(params.after === undefined ? {} : { after: params.after }),
      request: {
        ipHash: sha256(forwardedFor),
        userAgentHash: sha256(userAgent),
      },
    },
  });
  if (result.error) throw new Error(`稽核紀錄寫入失敗：${result.error.message}`);
}
