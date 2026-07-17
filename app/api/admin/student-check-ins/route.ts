import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { checkInUrl, STUDENT_PHOTO_BUCKET, taipeiDateParts } from "../../../../lib/student-checkin";

function authFailureResponse(status: number) {
  if (status === 401) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (status === 403) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: false, error: "Unable to verify access" }, { status: status || 500 });
}

type SignableRow = { photo_path?: string | null };

async function signedPhotoMap(rows: SignableRow[]) {
  const paths = [...new Set(rows.map((row) => row.photo_path).filter((path): path is string => Boolean(path)))];
  if (paths.length === 0) return new Map<string, string>();
  const result = await createSupabaseAdminClient().storage.from(STUDENT_PHOTO_BUCKET).createSignedUrls(paths, 5 * 60);
  if (result.error) throw new Error(result.error.message);
  return new Map((result.data || []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "frontdesk"], request);
  if (!auth.ok) return authFailureResponse(auth.response.status);

  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() || taipeiDateParts().localDate;
  const admin = createSupabaseAdminClient();

  const [pendingResult, todayResult, studentsResult] = await Promise.all([
    admin
      .from("student_checkin_requests")
      .select(
        "id, status, auth_method, requested_at, student_profile_id, student_line_profiles!student_checkin_requests_student_profile_id_fkey(id, full_name, phone, email, birth_date, membership_starts_on, membership_expires_on, photo_path, line_display_name)",
      )
      .eq("status", "pending")
      .order("requested_at", { ascending: true })
      .limit(50),
    admin
      .from("student_check_ins")
      .select("id, request_id, student_profile_id, full_name, phone, birth_date, photo_path, checked_in_at, local_date, local_month, daily_sequence, month_sequence")
      .eq("local_date", date)
      .order("checked_in_at", { ascending: false })
      .limit(200),
    admin
      .from("student_line_profiles")
      .select("id, full_name, phone, email, membership_starts_on, membership_expires_on, is_active, updated_at")
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(500),
  ]);

  if (pendingResult.error) return NextResponse.json({ ok: false, error: pendingResult.error.message }, { status: 500 });
  if (todayResult.error) return NextResponse.json({ ok: false, error: todayResult.error.message }, { status: 500 });
  if (studentsResult.error) return NextResponse.json({ ok: false, error: studentsResult.error.message }, { status: 500 });

  const pending = (pendingResult.data || []).map((row) => {
    const relation = Array.isArray(row.student_line_profiles) ? row.student_line_profiles[0] : row.student_line_profiles;
    return { ...row, profile: relation, student_line_profiles: undefined };
  });
  const photoRows = [
    ...pending.map((row) => ({ photo_path: row.profile?.photo_path || null })),
    ...(todayResult.data || []),
  ];
  const photos = await signedPhotoMap(photoRows);

  return NextResponse.json({
    ok: true,
    checkInUrl: checkInUrl(request),
    date,
    pending: pending.map((row) => ({
      ...row,
      profile: row.profile ? { ...row.profile, photo_url: photos.get(row.profile.photo_path || "") || null } : null,
    })),
    today: (todayResult.data || []).map((row) => ({ ...row, photo_url: photos.get(row.photo_path || "") || null })),
    students: studentsResult.data || [],
  });
}
