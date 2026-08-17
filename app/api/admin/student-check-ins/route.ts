import { NextResponse } from "next/server";
import { STUDENT_DROP_IN_MAX_USES } from "../../../../lib/student-drop-in";
import {
  DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN,
  studentDropInPlanDetails,
  studentDropInRemainingUses,
  type StudentDropInEntryPlan,
} from "../../../../lib/student-drop-in-plan";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import {
  requireStudentCheckinAdmin,
  studentCheckinAdminAuthFailure,
} from "../../../../lib/student-checkin-admin-auth";
import { checkInUrl, STUDENT_PHOTO_BUCKET, taipeiDateParts } from "../../../../lib/student-checkin";
import { externalErrorLogContext } from "../../../../lib/user-facing-error";

const STUDENT_CHECKIN_DATA_UNAVAILABLE = "報到資料暫時無法載入，系統會自動重試。";

function dataUnavailableResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "STUDENT_CHECKIN_DATA_UNAVAILABLE",
      error: STUDENT_CHECKIN_DATA_UNAVAILABLE,
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function reportUpstreamFailure(stage: string, error: unknown) {
  console.error("[student-check-ins] Upstream request failed", {
    stage,
    ...externalErrorLogContext(error),
  });
}

type SignableRow = { photo_path?: string | null };

type StudentRow = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  birth_date: string | null;
  membership_starts_on: string | null;
  membership_expires_on: string | null;
  autonomous_checkin_enabled: boolean;
  photo_path: string | null;
  is_active: boolean;
  updated_at: string;
};

type EntitlementRow = {
  student_profile_id: string;
  total_uses: number;
  used_uses: number;
  entry_plan: StudentDropInEntryPlan;
  review_photo_path: string | null;
  review_photo_uploaded_at: string | null;
  invoice_carrier: string | null;
  gender: "male" | "female" | null;
  activity_interest: "weight_training" | "reformer_pilates" | null;
  discovery_source: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
};

async function signedPhotoMap(rows: SignableRow[]) {
  const paths = [...new Set(rows.map((row) => row.photo_path).filter((path): path is string => Boolean(path)))];
  if (paths.length === 0) return new Map<string, string>();
  const result = await createSupabaseAdminClient().storage.from(STUDENT_PHOTO_BUCKET).createSignedUrls(paths, 5 * 60);
  if (result.error) {
    reportUpstreamFailure("storage-signed-urls", result.error);
    return new Map<string, string>();
  }
  return new Map((result.data || []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
}

async function getStudentCheckInResponse(request: Request) {
  const auth = await requireStudentCheckinAdmin(request);
  if (!auth.ok) return studentCheckinAdminAuthFailure(auth.response.status);

  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() || taipeiDateParts().localDate;
  const admin = createSupabaseAdminClient();

  const [
    pendingResult,
    todayResult,
    studentsResult,
    entitlementResult,
    dropInPendingResult,
    dropInTodayResult,
    memberLinksResult,
    accessBlocksResult,
  ] = await Promise.all([
    admin
      .from("student_checkin_requests")
      .select("id, status, auth_method, requested_at, student_profile_id")
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
      .select("id, full_name, phone, email, birth_date, membership_starts_on, membership_expires_on, autonomous_checkin_enabled, photo_path, is_active, updated_at")
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(500),
    admin
      .from("student_drop_in_entitlements")
      .select("student_profile_id, total_uses, used_uses, entry_plan, review_photo_path, review_photo_uploaded_at, invoice_carrier, gender, activity_interest, discovery_source, terms_version, terms_accepted_at")
      .limit(500),
    admin
      .from("student_drop_in_requests")
      .select("id, status, auth_method, requested_at, student_profile_id")
      .eq("status", "pending")
      .order("requested_at", { ascending: true })
      .limit(50),
    admin
      .from("student_drop_ins")
      .select("id, request_id, student_profile_id, full_name, phone, birth_date, photo_path, review_photo_path, checked_in_at, local_date, use_sequence, remaining_uses, price_twd, entry_plan")
      .eq("local_date", date)
      .order("checked_in_at", { ascending: false })
      .limit(200),
    admin
      .from("student_checkin_member_links")
      .select("student_profile_id, member_id")
      .limit(500),
    admin
      .from("student_checkin_access_blocks")
      .select("student_profile_id")
      .eq("is_active", true)
      .limit(500),
  ]);

  const failed = [
    pendingResult,
    todayResult,
    studentsResult,
    entitlementResult,
    dropInPendingResult,
    dropInTodayResult,
    memberLinksResult,
    accessBlocksResult,
  ]
    .find((result) => result.error);
  if (failed?.error) {
    reportUpstreamFailure("database-query", failed.error);
    return dataUnavailableResponse();
  }

  const studentRows = (studentsResult.data || []) as StudentRow[];
  const entitlementRows = (entitlementResult.data || []) as EntitlementRow[];
  const studentsById = new Map(studentRows.map((student) => [student.id, student]));
  const entitlementsByProfileId = new Map(entitlementRows.map((entitlement) => [entitlement.student_profile_id, entitlement]));
  const formalMemberProfileIds = new Set((memberLinksResult.data || []).map((row) => row.student_profile_id));
  const blockedProfileIds = new Set((accessBlocksResult.data || []).map((row) => row.student_profile_id));
  const pendingProfileIds = new Set([
    ...(pendingResult.data || []).map((row) => row.student_profile_id),
    ...(dropInPendingResult.data || []).map((row) => row.student_profile_id),
  ]);
  const photoRows = [
    ...studentRows.filter((student) => pendingProfileIds.has(student.id)),
    ...(todayResult.data || []),
    ...(dropInTodayResult.data || []),
    ...entitlementRows
      .filter((row) => pendingProfileIds.has(row.student_profile_id))
      .map((row) => ({ photo_path: row.review_photo_path })),
  ];
  const photos = await signedPhotoMap(photoRows);

  const publicStudent = (student: StudentRow) => {
    const entitlement = entitlementsByProfileId.get(student.id);
    const totalUses = entitlement?.total_uses ?? STUDENT_DROP_IN_MAX_USES;
    const usedUses = entitlement?.used_uses ?? 0;
    const entryPlan = entitlement?.entry_plan ?? DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN;
    const plan = studentDropInPlanDetails(entryPlan);
    return {
      ...student,
      photo_url: photos.get(student.photo_path || "") || null,
      drop_in_total_uses: totalUses,
      drop_in_used_uses: usedUses,
      drop_in_remaining_uses: studentDropInRemainingUses({ plan: entryPlan, totalUses, usedUses }),
      drop_in_entry_plan: entryPlan,
      drop_in_price_twd: plan.priceTwd,
      drop_in_review_photo_required: plan.reviewPhotoRequired,
      drop_in_unlimited_uses: plan.unlimitedUses,
      review_photo_url: photos.get(entitlement?.review_photo_path || "") || null,
      review_photo_uploaded_at: entitlement?.review_photo_uploaded_at || null,
      invoice_carrier: entitlement?.invoice_carrier || null,
      gender: entitlement?.gender || null,
      activity_interest: entitlement?.activity_interest || null,
      discovery_source: entitlement?.discovery_source || null,
      terms_version: entitlement?.terms_version || null,
      terms_accepted_at: entitlement?.terms_accepted_at || null,
      autonomous_access_status: blockedProfileIds.has(student.id)
        ? "blocked"
        : formalMemberProfileIds.has(student.id)
          ? "formal_member"
          : "non_member",
    };
  };

  const mapPending = (rows: Array<{ id: string; status: string; auth_method: string; requested_at: string; student_profile_id: string }>) =>
    rows.flatMap((row) => {
      const student = studentsById.get(row.student_profile_id);
      return student ? [{ ...row, profile: publicStudent(student) }] : [];
    });

  return NextResponse.json({
    ok: true,
    checkInUrl: checkInUrl(request, "autonomous"),
    dropInCheckInUrl: checkInUrl(request, "drop_in"),
    date,
    pending: mapPending(pendingResult.data || []),
    today: (todayResult.data || []).map((row) => ({
      ...row,
      photo_url: photos.get(row.photo_path || "") || null,
    })),
    students: studentRows.map(publicStudent),
    dropInPending: mapPending(dropInPendingResult.data || []),
    dropInToday: (dropInTodayResult.data || []).map((row) => ({
      ...row,
      photo_url: photos.get(row.photo_path || "") || null,
      review_photo_url: photos.get(row.review_photo_path || "") || null,
    })),
  });
}

export async function GET(request: Request) {
  try {
    return await getStudentCheckInResponse(request);
  } catch (error) {
    reportUpstreamFailure("request", error);
    return dataUnavailableResponse();
  }
}
