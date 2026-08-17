import { NextResponse } from "next/server";
import { requireTrialBookingAdmin } from "../../../../../lib/trial-booking-admin-auth";
import {
  trialBookingCoachOptions,
  type TrialBookingCoachProfile,
} from "../../../../../lib/trial-booking-coaches";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function GET(request: Request) {
  const auth = await requireTrialBookingAdmin(request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const tenantId = auth.context.tenantId;
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Missing tenant context" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const result = await admin
    .from("profiles")
    .select("id, display_name, english_name, branch_id")
    .eq("tenant_id", tenantId)
    .or("role.in.(coach,therapist),department.eq.coaching")
    .eq("is_active", true)
    .order("english_name", { ascending: true, nullsFirst: false })
    .order("display_name", { ascending: true });

  if (result.error) {
    return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
  }

  const coaches = trialBookingCoachOptions(
    (result.data || []) as TrialBookingCoachProfile[],
  );

  return NextResponse.json({ ok: true, coaches });
}
