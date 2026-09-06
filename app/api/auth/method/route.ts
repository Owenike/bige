import { NextResponse } from "next/server";
import { rateLimitShared } from "../../../../lib/rate-limit";
import {
  isSupervisorBiometricEnforced,
  requiresSupervisorBiometric,
} from "../../../../lib/supervisor-biometric";
import { isEmployeeNumber, normalizeEmployeeNumber } from "../../../../lib/staff-credentials";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await rateLimitShared({
    key: `staff-auth-method:${ip}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { method: "password", error: "操作過於頻繁，請稍後再試。" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const body = await request.json().catch(() => null);
  const employeeNumber = normalizeEmployeeNumber(body?.employeeNumber);
  if (!isEmployeeNumber(employeeNumber)) {
    return NextResponse.json({ method: "password" });
  }

  const admin = createSupabaseAdminClient();
  const profileResult = await admin
    .from("profiles")
    .select("id, role, position, employee_number, is_active, staff_deleted_at, staff_activation_status, supervisor_biometric_enforced_at")
    .eq("employee_number", employeeNumber)
    .maybeSingle();
  const profile = profileResult.data;
  if (
    profileResult.error ||
    !profile ||
    profile.is_active !== true ||
    profile.staff_deleted_at ||
    profile.staff_activation_status !== "completed" ||
    !requiresSupervisorBiometric(profile)
  ) {
    return NextResponse.json({ method: "password" });
  }

  const deviceResult = await admin
    .from("supervisor_biometric_devices")
    .select("id")
    .eq("profile_id", profile.id)
    .is("revoked_at", null)
    .maybeSingle();
  const deviceReady = !deviceResult.error && Boolean(deviceResult.data);

  // Enforcement starts only after a phone has completed enrollment. This keeps
  // the staged rollout from locking out supervisors before account 01 can bind
  // their devices.
  if (!deviceReady && !isSupervisorBiometricEnforced(profile)) {
    return NextResponse.json({ method: "password", enrollmentRequired: true });
  }

  return NextResponse.json({
    method: "supervisor_biometric",
    deviceReady,
  });
}
