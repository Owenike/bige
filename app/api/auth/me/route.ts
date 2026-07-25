import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(undefined, request);
  if (!auth.ok) return auth.response;

  const profileResult = await auth.supabase
    .from("profiles")
    .select("must_change_password, password_reset_required_at, staff_email_verified_at")
    .eq("id", auth.context.userId)
    .maybeSingle();

  return NextResponse.json({
    userId: auth.context.userId,
    role: auth.context.role,
    tenantId: auth.context.tenantId,
    branchId: auth.context.branchId,
    mustChangePassword: profileResult.data?.must_change_password === true,
    passwordResetRequiredAt: profileResult.data?.password_reset_required_at || null,
    staffEmailVerifiedAt: profileResult.data?.staff_email_verified_at || null,
  });
}
