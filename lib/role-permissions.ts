export type PermissionRole =
  | "platform_admin"
  | "manager"
  | "supervisor"
  | "branch_manager"
  | "frontdesk"
  | "coach"
  | "sales"
  | "member";

export const PERMISSION_ACTIONS = [
  "staff.read",
  "staff.create",
  "staff.update",
  "staff.disable",
  "members.read",
  "members.update",
  "products.read",
  "products.write",
  "services.read",
  "services.write",
  "branches.read",
  "branches.write",
  "coach_slots.read",
  "coach_slots.write",
  "reports.read",
  "refunds.request",
  "refunds.approve",
  "orders.void.request",
  "orders.void.approve",
  "pass_adjustments.request",
  "pass_adjustments.approve",
  "audit.read",
  "jobs.rerun.execute",
  "jobs.settings.read",
  "jobs.settings.write",
  "notifications.analytics.read",
  "notifications.anomalies.read",
  "notifications.alerts.read",
  "notifications.alerts.write",
  "notifications.overview.read",
  "notifications.delivery_events.read",
  "notifications.delivery_events.write",
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
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const ROLE_PERMISSIONS: Record<PermissionRole, readonly PermissionAction[] | readonly ["*"]> = {
  platform_admin: ["*"],
  manager: [
    "staff.read",
    "staff.create",
    "staff.update",
    "staff.disable",
    "members.read",
    "members.update",
    "products.read",
    "products.write",
    "services.read",
    "services.write",
    "branches.read",
    "branches.write",
    "coach_slots.read",
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
  ],
  supervisor: [
    "staff.read",
    "members.read",
    "members.update",
    "products.read",
    "services.read",
    "branches.read",
    "coach_slots.read",
    "reports.read",
    "refunds.request",
    "orders.void.request",
    "pass_adjustments.request",
    "audit.read",
    "orders.read",
    "payments.read",
    "plans.read",
    "member_plans.read",
    "crm.read",
  ],
  branch_manager: [
    "staff.read",
    "members.read",
    "members.update",
    "products.read",
    "services.read",
    "branches.read",
    "coach_slots.read",
    "reports.read",
    "refunds.request",
    "orders.void.request",
    "pass_adjustments.request",
    "audit.read",
    "orders.read",
    "payments.read",
    "plans.read",
    "member_plans.read",
    "crm.read",
  ],
  frontdesk: [
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
  ],
  coach: [
    "members.read",
    "coach_slots.read",
  ],
  sales: [
    "members.read",
    "members.update",
    "products.read",
    "services.read",
    "reports.read",
    "orders.read",
    "orders.write",
    "plans.read",
    "member_plans.read",
    "crm.read",
    "crm.write",
    "crm.followup",
  ],
  member: [],
};

export function normalizePermissionRole(input: string | null | undefined): PermissionRole | null {
  if (!input) return null;
  if (
    input === "platform_admin" ||
    input === "manager" ||
    input === "supervisor" ||
    input === "branch_manager" ||
    input === "frontdesk" ||
    input === "coach" ||
    input === "sales" ||
    input === "member"
  ) {
    return input;
  }
  return null;
}

export function listPermissionsForRole(role: PermissionRole | null | undefined): readonly PermissionAction[] | readonly ["*"] {
  if (!role) return [];
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: PermissionRole | null | undefined, action: PermissionAction): boolean {
  const permissions = listPermissionsForRole(role);
  if (permissions[0] === "*") return true;
  return (permissions as readonly PermissionAction[]).includes(action);
}
