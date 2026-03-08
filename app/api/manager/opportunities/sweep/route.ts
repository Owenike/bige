import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import { runOpportunitySweep } from "../../../../../lib/opportunities";

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager"], request);
  if (!auth.ok) return auth.response;

  const permission = requirePermission(auth.context, "crm.write");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const tenantIdFromBody = typeof body?.tenantId === "string" ? body.tenantId.trim() : null;
  const scopedTenantId =
    auth.context.role === "platform_admin"
      ? (tenantIdFromBody || auth.context.tenantId)
      : auth.context.tenantId;
  if (!scopedTenantId && auth.context.role !== "platform_admin") {
    return apiError(400, "FORBIDDEN", "Missing tenant scope");
  }

  const sweep = await runOpportunitySweep({
    actorRole: auth.context.role,
    actorUserId: auth.context.userId,
    tenantId: scopedTenantId || null,
  });
  if (!sweep.ok) return apiError(500, "INTERNAL_ERROR", sweep.error);

  return apiSuccess({
    inserted: sweep.summary.inserted,
    byType: sweep.summary.byType,
    reminders: sweep.summary.reminders,
    scopedTenantId: scopedTenantId || null,
  });
}

