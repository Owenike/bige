import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { createInAppNotifications } from "../../../../lib/in-app-notifications";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const STAFF_ROLES = [
  "platform_admin",
  "manager",
  "supervisor",
  "branch_manager",
  "frontdesk",
  "coach",
  "sales",
] as const;

export async function POST(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request, {
    allowIncompleteStaffActivation: true,
  });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const decision = body?.decision === "confirm" ? "confirm" : body?.decision === "deny" ? "deny" : null;
  if (!decision) return apiError(400, "FORBIDDEN", "decision must be confirm or deny");

  const admin = createSupabaseAdminClient();
  const profileResult = await admin
    .from("profiles")
    .select("id, tenant_id, branch_id, display_name, english_name, employee_number, department, position, staff_activation_status, is_active, staff_deleted_at")
    .eq("id", auth.context.userId)
    .maybeSingle();
  if (profileResult.error) return apiError(500, "INTERNAL_ERROR", profileResult.error.message);
  const profile = profileResult.data;
  if (!profile || !profile.is_active || profile.staff_deleted_at) {
    return apiError(403, "INACTIVE_ACCOUNT", "員工帳號目前不可使用");
  }
  if (profile.staff_activation_status === "completed") {
    return apiSuccess({ completed: true, next: null });
  }
  if (profile.staff_activation_status !== "pending_identity") {
    return apiError(409, "STAFF_ACTIVATION_REQUIRED", "目前的首次啟用狀態無法進行本人確認");
  }

  const now = new Date().toISOString();
  if (decision === "confirm") {
    const updateResult = await admin
      .from("profiles")
      .update({
        staff_activation_status: "identity_confirmed",
        staff_identity_confirmed_at: now,
        staff_identity_denied_at: null,
        updated_at: now,
      })
      .eq("id", profile.id)
      .eq("staff_activation_status", "pending_identity")
      .select("id")
      .maybeSingle();
    if (updateResult.error) return apiError(500, "INTERNAL_ERROR", updateResult.error.message);
    if (!updateResult.data) {
      return apiError(409, "STAFF_ACTIVATION_REQUIRED", "本人確認狀態已變更，請重新登入");
    }

    await admin.from("audit_logs").insert({
      tenant_id: profile.tenant_id,
      actor_id: profile.id,
      action: "staff_identity_confirmed",
      target_type: "profile",
      target_id: profile.id,
      reason: "employee_self_confirmation",
      payload: {
        employeeNumber: profile.employee_number,
        confirmedAt: now,
      },
    });

    return apiSuccess({
      confirmed: true,
      next: "/staff/change-password",
    });
  }

  const updateResult = await admin
    .from("profiles")
    .update({
      staff_activation_status: "denied",
      staff_identity_denied_at: now,
      staff_identity_confirmed_at: null,
      updated_at: now,
    })
    .eq("id", profile.id)
    .eq("staff_activation_status", "pending_identity")
    .select("id")
    .maybeSingle();
  if (updateResult.error) return apiError(500, "INTERNAL_ERROR", updateResult.error.message);
  if (!updateResult.data) {
    return apiError(409, "STAFF_ACTIVATION_REQUIRED", "本人確認狀態已變更，請重新登入");
  }

  await admin.from("audit_logs").insert({
    tenant_id: profile.tenant_id,
    actor_id: profile.id,
    action: "staff_identity_denied",
    target_type: "profile",
    target_id: profile.id,
    reason: "employee_selected_not_me",
    payload: {
      employeeNumber: profile.employee_number,
      deniedAt: now,
      department: profile.department,
      position: profile.position,
    },
  });

  await createInAppNotifications({
    supabase: admin,
    tenantId: profile.tenant_id,
    branchId: profile.branch_id,
    recipientRoles: ["platform_admin", "manager", "supervisor", "branch_manager"],
    title: "員工否認首次啟用資料",
    message: `${profile.display_name || profile.english_name || profile.employee_number || "員工"}選擇「不是本人」，首次啟用已立即中斷。請主管當面確認身分後重新產生啟用碼。`,
    severity: "critical",
    eventType: "staff_identity_denied",
    targetType: "profile",
    targetId: profile.id,
    actionUrl: "/manager/staff",
    payload: {
      employeeNumber: profile.employee_number,
      department: profile.department,
      position: profile.position,
      deniedAt: now,
    },
    dedupeKey: `staff-identity-denied:${profile.id}:${now}`,
    createdBy: profile.id,
  }).catch(() => null);

  await auth.supabase.auth.signOut();
  return apiSuccess({
    denied: true,
    next: "/login/staff",
  });
}
