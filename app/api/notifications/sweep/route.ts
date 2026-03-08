import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { runNotificationSweep } from "../../../../lib/in-app-notifications";
import { runOpportunitySweep } from "../../../../lib/opportunities";

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const tenantIdFromBody = typeof body?.tenantId === "string" ? body.tenantId.trim() : null;
  const scopedTenantId =
    auth.context.role === "platform_admin"
      ? (tenantIdFromBody || null)
      : auth.context.tenantId;

  if (auth.context.role !== "platform_admin" && !scopedTenantId) {
    return apiError(400, "FORBIDDEN", "Missing tenant scope");
  }

  const sweep = await runNotificationSweep({
    actorRole: auth.context.role,
    actorUserId: auth.context.userId,
    tenantId: scopedTenantId,
  });
  if (!sweep.ok) return apiError(500, "INTERNAL_ERROR", sweep.error);

  const opportunitySweep = await runOpportunitySweep({
    actorRole: auth.context.role,
    actorUserId: auth.context.userId,
    tenantId: scopedTenantId,
  });
  if (!opportunitySweep.ok) return apiError(500, "INTERNAL_ERROR", opportunitySweep.error);

  return apiSuccess({
    generated: sweep.summary.generated,
    byEventType: sweep.summary.byEventType,
    opportunityInserted: opportunitySweep.summary.inserted,
    opportunityByType: opportunitySweep.summary.byType,
    opportunityReminders: opportunitySweep.summary.reminders,
    scopedTenantId,
  });
}
