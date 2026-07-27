import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(undefined, request, {
    allowIncompleteStaffActivation: true,
  });
  if (!auth.ok) return auth.response;

  const profileResult = await auth.supabase
    .from("profiles")
    .select("display_name, english_name, employee_number, must_change_password, password_reset_required_at, staff_email_verified_at, staff_activation_status")
    .eq("id", auth.context.userId)
    .maybeSingle();

  return NextResponse.json({
    userId: auth.context.userId,
    role: auth.context.role,
    department: auth.context.department,
    position: auth.context.position,
    tenantId: auth.context.tenantId,
    branchId: auth.context.branchId,
    displayName: profileResult.data?.display_name || null,
    englishName: profileResult.data?.english_name || null,
    employeeNumber: profileResult.data?.employee_number || null,
    mustChangePassword: profileResult.data?.must_change_password === true,
    passwordResetRequiredAt: profileResult.data?.password_reset_required_at || null,
    staffEmailVerifiedAt: profileResult.data?.staff_email_verified_at || null,
    staffActivationStatus: profileResult.data?.staff_activation_status || "completed",
  });
}
