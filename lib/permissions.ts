import { apiError, type ProfileContext } from "./auth-context";
import { hasPermission, listPermissionsForRole, normalizePermissionRole, type PermissionAction } from "./role-permissions";

export function getRolePermissions(role: string | null | undefined) {
  return listPermissionsForRole(normalizePermissionRole(role));
}

export function canPerform(role: string | null | undefined, action: PermissionAction) {
  return hasPermission(normalizePermissionRole(role), action);
}

function deniedCodeForAction(action: PermissionAction): "FORBIDDEN" | "STAFF_CREATE_DENIED" | "STAFF_UPDATE_DENIED" | "STAFF_DISABLE_DENIED" {
  if (action === "staff.create") return "STAFF_CREATE_DENIED";
  if (action === "staff.update") return "STAFF_UPDATE_DENIED";
  if (action === "staff.disable") return "STAFF_DISABLE_DENIED";
  return "FORBIDDEN";
}

export function requirePermission(context: Pick<ProfileContext, "role">, action: PermissionAction) {
  if (canPerform(context.role, action)) {
    return { ok: true as const };
  }
  return {
    ok: false as const,
    response: apiError(403, deniedCodeForAction(action), `Permission denied: ${action}`),
  };
}

export function requireAnyPermission(context: Pick<ProfileContext, "role">, actions: PermissionAction[]) {
  if (actions.some((action) => canPerform(context.role, action))) {
    return { ok: true as const };
  }
  return {
    ok: false as const,
    response: apiError(403, "FORBIDDEN", `Permission denied: requires one of ${actions.join(", ")}`),
  };
}
