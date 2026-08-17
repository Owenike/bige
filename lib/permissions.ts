import { apiError, type ProfileContext } from "./auth-context";
import { hasPermission, listPermissionsForRole, normalizePermissionRole, type PermissionAction } from "./role-permissions";
import { isTenantManager, type StaffPosition } from "./staff-organization";

const FRONTDESK_PERMISSIONS: readonly PermissionAction[] = [
  "members.read",
  "members.update",
  "products.read",
  "services.read",
  "coach_slots.read",
  "orders.read",
  "orders.write",
  "payments.read",
  "payments.write",
  "plans.read",
  "member_plans.read",
  "refunds.request",
  "orders.void.request",
  "pass_adjustments.request",
  "crm.write",
  "crm.followup",
  "storefront.read",
  "booking_settings.read",
  "assistance.read",
  "assistance.complete",
];

const COACH_PERMISSIONS: readonly PermissionAction[] = [
  "members.read",
  "coach_slots.read",
];

const POSITION_PERMISSIONS: Record<StaffPosition, readonly PermissionAction[]> = {
  frontdesk: FRONTDESK_PERMISSIONS,
  administrative_director: [...FRONTDESK_PERMISSIONS, "reports.read"],
  general_affairs_assistant_manager: [
    ...FRONTDESK_PERMISSIONS,
    "staff.read",
    "products.write",
    "reports.read",
    "audit.read",
  ],
  general_affairs_manager: [
    ...FRONTDESK_PERMISSIONS,
    "staff.read",
    "staff.create",
    "staff.update",
    "staff.disable",
    "products.write",
    "reports.read",
    "refunds.approve",
    "orders.void.approve",
    "audit.read",
    "finance.general_affairs.approve",
  ],
  coach: COACH_PERMISSIONS,
  coach_team_lead: [...COACH_PERMISSIONS, "reports.read"],
  coach_director: [...COACH_PERMISSIONS, "reports.read", "crm.read"],
  coach_assistant_manager: [
    ...COACH_PERMISSIONS,
    "members.update",
    "services.read",
    "coach_slots.write",
    "reports.read",
    "audit.read",
    "payments.read",
    "payments.write",
    "plans.read",
    "plans.write",
    "member_plans.read",
    "crm.read",
    "crm.write",
    "crm.assign",
    "crm.followup",
    "assistance.read",
    "assistance.create",
  ],
  coach_manager: [
    ...COACH_PERMISSIONS,
    "staff.read",
    "staff.create",
    "staff.update",
    "staff.disable",
    "members.update",
    "services.read",
    "services.write",
    "coach_slots.write",
    "reports.read",
    "refunds.request",
    "refunds.approve",
    "orders.void.request",
    "orders.void.approve",
    "pass_adjustments.request",
    "pass_adjustments.approve",
    "audit.read",
    "orders.read",
    "orders.write",
    "payments.read",
    "payments.write",
    "plans.read",
    "plans.write",
    "member_plans.read",
    "member_plans.write",
    "crm.read",
    "crm.write",
    "crm.assign",
    "crm.followup",
    "booking_settings.read",
    "booking_settings.write",
    "assistance.read",
    "assistance.create",
    "finance.coaching.approve",
  ],
  coach_city_manager: [
    ...COACH_PERMISSIONS,
    "staff.read",
    "staff.create",
    "staff.update",
    "staff.disable",
    "members.read",
    "members.update",
    "services.read",
    "services.write",
    "branches.read",
    "coach_slots.write",
    "reports.read",
    "refunds.request",
    "refunds.approve",
    "orders.void.request",
    "orders.void.approve",
    "pass_adjustments.request",
    "pass_adjustments.approve",
    "audit.read",
    "orders.read",
    "orders.write",
    "payments.read",
    "payments.write",
    "plans.read",
    "plans.write",
    "member_plans.read",
    "member_plans.write",
    "crm.read",
    "crm.write",
    "crm.assign",
    "crm.followup",
    "booking_settings.read",
    "booking_settings.write",
    "finance.coaching.approve",
  ],
};

export function getRolePermissions(role: string | null | undefined) {
  return listPermissionsForRole(normalizePermissionRole(role));
}

export function canPerform(role: string | null | undefined, action: PermissionAction) {
  return hasPermission(normalizePermissionRole(role), action);
}

export function canPerformInContext(
  context: Pick<ProfileContext, "role"> & Partial<Pick<ProfileContext, "department" | "position">>,
  action: PermissionAction,
) {
  if (context.role === "platform_admin") return true;
  // A manager owns every business permission inside their tenant. Platform
  // routes remain separately protected by the platform_admin role guard.
  if (isTenantManager(context)) return canPerform("manager", action);
  if (context.department && context.position) {
    return POSITION_PERMISSIONS[context.position].includes(action);
  }
  return canPerform(context.role, action);
}

function deniedCodeForAction(action: PermissionAction): "FORBIDDEN" | "STAFF_CREATE_DENIED" | "STAFF_UPDATE_DENIED" | "STAFF_DISABLE_DENIED" {
  if (action === "staff.create") return "STAFF_CREATE_DENIED";
  if (action === "staff.update") return "STAFF_UPDATE_DENIED";
  if (action === "staff.disable") return "STAFF_DISABLE_DENIED";
  return "FORBIDDEN";
}

export function requirePermission(
  context: Pick<ProfileContext, "role"> & Partial<Pick<ProfileContext, "department" | "position">>,
  action: PermissionAction,
) {
  if (canPerformInContext(context, action)) {
    return { ok: true as const };
  }
  return {
    ok: false as const,
    response: apiError(403, deniedCodeForAction(action), `Permission denied: ${action}`),
  };
}

export function requireAnyPermission(
  context: Pick<ProfileContext, "role"> & Partial<Pick<ProfileContext, "department" | "position">>,
  actions: PermissionAction[],
) {
  if (actions.some((action) => canPerformInContext(context, action))) {
    return { ok: true as const };
  }
  return {
    ok: false as const,
    response: apiError(403, "FORBIDDEN", `Permission denied: requires one of ${actions.join(", ")}`),
  };
}
