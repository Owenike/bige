import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../lib/auth-context";
import { STAFF_PERMISSION_KEYS, defaultStaffPermission, requireStaffPermission } from "../../../lib/staff-operation-permissions";
import { writeStaffAudit } from "../../../lib/staff-audit";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

export const runtime = "nodejs";

const STAFF_ROLES = ["platform_admin", "manager", "supervisor", "branch_manager", "store_owner", "store_manager"] as const;
const updateSchema = z.object({
  employeeId: z.string().uuid(),
  permissionKey: z.enum(STAFF_PERMISSION_KEYS),
  override: z.boolean().nullable(),
  reason: z.string().trim().max(1000).optional(),
});

async function actorTenant(admin: ReturnType<typeof createSupabaseAdminClient>, actorId: string) {
  const profile = await admin.from("profiles").select("id, tenant_id").eq("id", actorId).maybeSingle();
  if (profile.error) throw new Error(profile.error.message);
  if (!profile.data?.tenant_id) throw new Error("帳號尚未設定館別");
  return String(profile.data.tenant_id);
}

async function loadState(admin: ReturnType<typeof createSupabaseAdminClient>, tenantId: string) {
  const [employees, overrides] = await Promise.all([
    admin.from("profiles").select("id, display_name, english_name, employee_number, role, position, department, is_active").eq("tenant_id", tenantId).is("staff_deleted_at", null).order("employee_number", { ascending: true, nullsFirst: false }),
    admin.from("staff_permission_overrides").select("employee_id, permission_key, allowed, reason, configured_by, updated_at").eq("tenant_id", tenantId),
  ]);
  if (employees.error || overrides.error) throw new Error(employees.error?.message || overrides.error?.message || "權限資料讀取失敗");
  const overrideMap = new Map((overrides.data || []).map((row) => [`${row.employee_id}:${row.permission_key}`, row]));
  return {
    permissionKeys: STAFF_PERMISSION_KEYS,
    employees: (employees.data || []).map((employee) => ({
      ...employee,
      permissions: Object.fromEntries(STAFF_PERMISSION_KEYS.map((key) => {
        const override = overrideMap.get(`${employee.id}:${key}`);
        const defaultAllowed = defaultStaffPermission({ role: employee.role, position: employee.position }, key);
        return [key, {
          allowed: override ? Boolean(override.allowed) : defaultAllowed,
          defaultAllowed,
          override: override ? Boolean(override.allowed) : null,
          reason: override?.reason || null,
          updatedAt: override?.updated_at || null,
        }];
      })),
    })),
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  try {
    const tenantId = await actorTenant(admin, auth.context.userId);
    await requireStaffPermission({ supabase: admin, tenantId, employeeId: auth.context.userId, context: auth.context, permission: "manage_permissions", message: "只有具備帳號權限管理資格的人可開啟此頁" });
    return apiSuccess(await loadState(admin, tenantId));
  } catch (error) {
    return apiError(403, "FORBIDDEN", error instanceof Error ? error.message : "無法讀取帳號權限");
  }
}

export async function POST(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  try {
    const body = updateSchema.parse(await request.json());
    const tenantId = await actorTenant(admin, auth.context.userId);
    await requireStaffPermission({ supabase: admin, tenantId, employeeId: auth.context.userId, context: auth.context, permission: "manage_permissions", message: "只有具備帳號權限管理資格的人可調整權限" });
    const target = await admin.from("profiles").select("id, tenant_id, role, position").eq("id", body.employeeId).eq("tenant_id", tenantId).maybeSingle();
    if (target.error || !target.data) throw new Error("找不到同一館別的員工帳號");
    const previous = await admin.from("staff_permission_overrides").select("allowed, reason").eq("employee_id", body.employeeId).eq("permission_key", body.permissionKey).maybeSingle();
    if (previous.error) throw new Error(previous.error.message);
    if (body.override === null) {
      const remove = await admin.from("staff_permission_overrides").delete().eq("employee_id", body.employeeId).eq("permission_key", body.permissionKey);
      if (remove.error) throw new Error(remove.error.message);
    } else {
      if (!body.reason || body.reason.length < 3) throw new Error("允許或禁止個別權限時，請填寫至少 3 個字的理由");
      const upsert = await admin.from("staff_permission_overrides").upsert({
        tenant_id: tenantId,
        employee_id: body.employeeId,
        permission_key: body.permissionKey,
        allowed: body.override,
        reason: body.reason,
        configured_by: auth.context.userId,
      }, { onConflict: "employee_id,permission_key" });
      if (upsert.error) throw new Error(upsert.error.message);
    }
    await writeStaffAudit({
      supabase: admin,
      request,
      tenantId,
      actorId: auth.context.userId,
      action: "staff_permission_override_changed",
      targetType: "profile",
      targetId: body.employeeId,
      reason: body.reason || (body.override === null ? "恢復職務預設權限" : null),
      before: previous.data || { override: null },
      after: { permissionKey: body.permissionKey, override: body.override },
    });
    return apiSuccess(await loadState(admin, tenantId));
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message || "欄位格式錯誤" : error instanceof Error ? error.message : "權限更新失敗";
    return apiError(400, "FORBIDDEN", message);
  }
}
