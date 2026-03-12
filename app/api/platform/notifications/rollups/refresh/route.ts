import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import {
  rebuildNotificationDailyRollups,
  refreshNotificationDailyRollupsIncremental,
} from "../../../../../../lib/notification-rollup";
import { requirePermission } from "../../../../../../lib/permissions";
import { uuidLikeSchema } from "../../../../../../lib/notification-productization";

const dateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);

const bodySchema = z.object({
  mode: z.enum(["incremental", "rebuild"]).default("incremental"),
  fromDate: dateSchema.optional(),
  toDate: dateSchema.optional(),
  days: z.coerce.number().int().min(1).max(30).optional(),
  tenantId: uuidLikeSchema.optional(),
});

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const permission = requirePermission(auth.context, "notifications.rollups.refresh");
  if (!permission.ok) return permission.response;

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw || {});
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid payload");

  if (parsed.data.mode === "rebuild") {
    const result = await rebuildNotificationDailyRollups({
      fromDate: parsed.data.fromDate || null,
      toDate: parsed.data.toDate || null,
      tenantId: parsed.data.tenantId || null,
    });
    if (!result.ok) return apiError(500, "INTERNAL_ERROR", result.error);
    return apiSuccess({
      refreshed: true,
      mode: "rebuild",
      summary: result.summary,
    });
  }

  const result = await refreshNotificationDailyRollupsIncremental({
    days: parsed.data.days || 3,
    tenantId: parsed.data.tenantId || null,
  });
  if (!result.ok) return apiError(500, "INTERNAL_ERROR", result.error);
  return apiSuccess({
    refreshed: true,
    mode: "incremental",
    summary: result.summary,
  });
}
