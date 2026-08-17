import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import {
  CUSTOM_EMPLOYEE_NUMBER_MANAGER,
  normalizeEmployeeNumber,
} from "../../../../../lib/staff-credentials";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

type EmailChangePayload = {
  previousEmail?: unknown;
  newEmail?: unknown;
  changedAt?: unknown;
};

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  const viewerResult = await admin
    .from("profiles")
    .select("employee_number")
    .eq("id", auth.context.userId)
    .maybeSingle();
  const canRead =
    auth.context.role === "platform_admin" ||
    normalizeEmployeeNumber(viewerResult.data?.employee_number) ===
      CUSTOM_EMPLOYEE_NUMBER_MANAGER;
  if (viewerResult.error || !canRead) {
    return apiError(403, "FORBIDDEN", "僅限系統管理帳號查看信箱變更紀錄");
  }

  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId")?.trim() || "";
  if (!profileId) {
    return apiError(400, "FORBIDDEN", "profileId is required");
  }

  const targetResult = await admin
    .from("profiles")
    .select("id, tenant_id")
    .eq("id", profileId)
    .maybeSingle();
  if (targetResult.error || !targetResult.data) {
    return apiError(404, "FORBIDDEN", "找不到員工帳號");
  }
  if (
    auth.context.role !== "platform_admin" &&
    targetResult.data.tenant_id !== auth.context.tenantId
  ) {
    return apiError(403, "FORBIDDEN", "不可查看其他租戶的紀錄");
  }

  const historyResult = await admin
    .from("audit_logs")
    .select("id, actor_id, payload, created_at")
    .eq("target_type", "profile")
    .eq("target_id", profileId)
    .eq("action", "staff_email_changed")
    .order("created_at", { ascending: false })
    .limit(100);
  if (historyResult.error) {
    return apiError(500, "INTERNAL_ERROR", historyResult.error.message);
  }

  return apiSuccess({
    items: (historyResult.data || []).map((row) => {
      const payload = (row.payload || {}) as EmailChangePayload;
      return {
        id: row.id,
        previousEmail: stringOrNull(payload.previousEmail),
        newEmail: stringOrNull(payload.newEmail),
        changedAt: stringOrNull(payload.changedAt) || row.created_at,
      };
    }),
  });
}
