import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { checkInUrl, taipeiDateParts } from "../../../../lib/student-checkin";

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() || taipeiDateParts().localDate;
  const admin = createSupabaseAdminClient();

  const [todayResult, recentResult] = await Promise.all([
    admin
      .from("student_check_ins")
      .select("id, full_name, phone, checked_in_at, local_date, local_month, month_sequence")
      .eq("local_date", date)
      .order("checked_in_at", { ascending: false })
      .limit(200),
    admin
      .from("student_check_ins")
      .select("id, full_name, phone, checked_in_at, local_date, local_month, month_sequence")
      .order("checked_in_at", { ascending: false })
      .limit(20),
  ]);

  if (todayResult.error) return NextResponse.json({ ok: false, error: todayResult.error.message }, { status: 500 });
  if (recentResult.error) return NextResponse.json({ ok: false, error: recentResult.error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    checkInUrl: checkInUrl(request),
    date,
    today: todayResult.data || [],
    recent: recentResult.data || [],
  });
}
