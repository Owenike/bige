import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileContext } from "./auth-context";

export const STAFF_PERMISSION_KEYS = [
  "create_employee",
  "edit_employee",
  "suspend_employee",
  "manage_schedule",
  "publish_schedule",
  "review_leave_requests",
  "manage_attendance",
  "view_team_schedule",
  "view_team_salary",
  "calculate_payroll",
  "close_payroll",
  "manage_insurance",
  "assign_supervisor",
  "manage_permissions",
  "export_schedule",
  "allocate_sales_performance",
  "approve_sales_performance",
  "manage_epo",
  "confirm_daily_sales_report",
] as const;

export type StaffPermissionKey = (typeof STAFF_PERMISSION_KEYS)[number];

const finalRoles = new Set([
  "platform_admin",
  "manager",
  "branch_manager",
  "store_owner",
  "store_manager",
]);
const finalPositions = new Set([
  "general_affairs_manager",
  "coach_manager",
  "coach_city_manager",
]);
const assistantRoles = new Set(["supervisor"]);
const assistantPositions = new Set([
  "general_affairs_assistant_manager",
  "coach_assistant_manager",
]);

export function defaultStaffPermission(
  context: Pick<ProfileContext, "role" | "position">,
  key: StaffPermissionKey,
) {
  if (context.role === "platform_admin") return true;
  const finalManager =
    finalRoles.has(context.role) ||
    (!!context.position && finalPositions.has(context.position));
  if (finalManager) return true;
  const assistant =
    assistantRoles.has(context.role) ||
    (!!context.position && assistantPositions.has(context.position));
  if (!assistant) return false;
  return new Set<StaffPermissionKey>([
    "edit_employee",
    "manage_schedule",
    "review_leave_requests",
    "manage_attendance",
    "view_team_schedule",
    "view_team_salary",
    "calculate_payroll",
    "export_schedule",
    "allocate_sales_performance",
    "manage_epo",
  ]).has(key);
}

export async function resolveStaffPermissions(params: {
  supabase: SupabaseClient;
  tenantId: string;
  employeeId: string;
  context: Pick<ProfileContext, "role" | "position">;
}) {
  const result = await params.supabase
    .from("staff_permission_overrides")
    .select("permission_key, allowed, reason, configured_by, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("employee_id", params.employeeId);
  if (result.error) throw new Error(result.error.message);
  const overrides = new Map(
    (result.data || []).map((row) => [String(row.permission_key), row]),
  );
  return Object.fromEntries(
    STAFF_PERMISSION_KEYS.map((key) => {
      const override = overrides.get(key);
      const defaultAllowed = defaultStaffPermission(params.context, key);
      return [
        key,
        {
          allowed: override ? Boolean(override.allowed) : defaultAllowed,
          defaultAllowed,
          override: override ? Boolean(override.allowed) : null,
          reason: override?.reason ? String(override.reason) : null,
          configuredBy: override?.configured_by
            ? String(override.configured_by)
            : null,
          updatedAt: override?.updated_at ? String(override.updated_at) : null,
        },
      ];
    }),
  ) as Record<
    StaffPermissionKey,
    {
      allowed: boolean;
      defaultAllowed: boolean;
      override: boolean | null;
      reason: string | null;
      configuredBy: string | null;
      updatedAt: string | null;
    }
  >;
}

export async function hasStaffPermission(params: {
  supabase: SupabaseClient;
  tenantId: string;
  employeeId: string;
  context: Pick<ProfileContext, "role" | "position">;
  permission: StaffPermissionKey;
}) {
  if (params.context.role === "platform_admin") return true;
  const override = await params.supabase
    .from("staff_permission_overrides")
    .select("allowed")
    .eq("tenant_id", params.tenantId)
    .eq("employee_id", params.employeeId)
    .eq("permission_key", params.permission)
    .maybeSingle();
  if (override.error) throw new Error(override.error.message);
  if (override.data) return Boolean(override.data.allowed);
  return defaultStaffPermission(params.context, params.permission);
}

export async function requireStaffPermission(
  params: Parameters<typeof hasStaffPermission>[0] & { message?: string },
) {
  if (!(await hasStaffPermission(params)))
    throw new Error(params.message || "您沒有此項員工管理權限");
}
