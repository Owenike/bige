import { NextResponse } from "next/server";
import {
  requireStudentCheckinAdmin,
  studentCheckinAdminAuthFailure,
} from "../../../../../../../lib/student-checkin-admin-auth";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/admin";

type RequestTimeRow = {
  id: string;
  requested_at: string;
  reviewed_at: string | null;
};

type AutonomousCheckInRow = {
  id: string;
  request_id: string | null;
  checked_in_at: string;
  daily_sequence: number;
  month_sequence: number;
};

type DropInCheckInRow = {
  id: string;
  request_id: string;
  checked_in_at: string;
  use_sequence: number;
  price_twd: number;
  entry_plan: "review_50" | "standard_100";
};

const HISTORY_PAGE_SIZE = 500;

function requestTimesById(rows: RequestTimeRow[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

async function loadRequestTimes(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  table: "student_checkin_requests" | "student_drop_in_requests",
  requestIds: string[],
) {
  const rows: RequestTimeRow[] = [];
  const uniqueIds = Array.from(new Set(requestIds));
  for (let index = 0; index < uniqueIds.length; index += 100) {
    const result = await admin
      .from(table)
      .select("id, requested_at, reviewed_at")
      .in("id", uniqueIds.slice(index, index + 100));
    if (result.error) return { rows: [] as RequestTimeRow[], error: result.error };
    rows.push(...((result.data || []) as RequestTimeRow[]));
  }
  return { rows, error: null };
}

async function loadAllAutonomousCheckIns(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  studentId: string,
) {
  const rows: AutonomousCheckInRow[] = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const result = await admin
      .from("student_check_ins")
      .select("id, request_id, checked_in_at, daily_sequence, month_sequence")
      .eq("student_profile_id", studentId)
      .order("checked_in_at", { ascending: false })
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (result.error) return { rows: [] as AutonomousCheckInRow[], error: result.error };
    const page = (result.data || []) as AutonomousCheckInRow[];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) break;
  }
  return { rows, error: null };
}

async function loadAllDropInCheckIns(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  studentId: string,
) {
  const rows: DropInCheckInRow[] = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const result = await admin
      .from("student_drop_ins")
      .select("id, request_id, checked_in_at, use_sequence, price_twd, entry_plan")
      .eq("student_profile_id", studentId)
      .order("checked_in_at", { ascending: false })
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (result.error) return { rows: [] as DropInCheckInRow[], error: result.error };
    const page = (result.data || []) as DropInCheckInRow[];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) break;
  }
  return { rows, error: null };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStudentCheckinAdmin(request);
  if (!auth.ok) return studentCheckinAdminAuthFailure(auth.response.status);
  if (auth.context.role !== "student_checkin_admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode !== "autonomous" && mode !== "drop_in") {
    return NextResponse.json({ ok: false, error: "Invalid history mode" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  if (mode === "autonomous") {
    const checkInsResult = await loadAllAutonomousCheckIns(admin, id);

    if (checkInsResult.error) {
      return NextResponse.json({ ok: false, error: "Unable to load autonomous history" }, { status: 500 });
    }

    const checkIns = checkInsResult.rows;
    const requestIds = checkIns.flatMap((item) => item.request_id ? [item.request_id] : []);
    const requestsResult = await loadRequestTimes(admin, "student_checkin_requests", requestIds);

    if (requestsResult.error) {
      return NextResponse.json({ ok: false, error: "Unable to load autonomous request times" }, { status: 500 });
    }

    const requests = requestTimesById(requestsResult.rows);
    const history = checkIns.map((item) => {
      const requestTime = item.request_id ? requests.get(item.request_id) : null;
      return {
        id: item.id,
        requestedAt: requestTime?.requested_at || null,
        approvedAt: requestTime?.reviewed_at || item.checked_in_at,
        checkedInAt: item.checked_in_at,
        dailySequence: item.daily_sequence,
        monthSequence: item.month_sequence,
        useSequence: null,
      };
    });

    return NextResponse.json({ ok: true, mode, history }, { headers: { "Cache-Control": "no-store" } });
  }

  const checkInsResult = await loadAllDropInCheckIns(admin, id);

  if (checkInsResult.error) {
    return NextResponse.json({ ok: false, error: "Unable to load drop-in history" }, { status: 500 });
  }

  const checkIns = checkInsResult.rows;
  const requestIds = checkIns.map((item) => item.request_id);
  const requestsResult = await loadRequestTimes(admin, "student_drop_in_requests", requestIds);

  if (requestsResult.error) {
    return NextResponse.json({ ok: false, error: "Unable to load drop-in request times" }, { status: 500 });
  }

  const requests = requestTimesById(requestsResult.rows);
  const history = checkIns.map((item) => {
    const requestTime = requests.get(item.request_id);
    return {
      id: item.id,
      requestedAt: requestTime?.requested_at || null,
      approvedAt: requestTime?.reviewed_at || item.checked_in_at,
      checkedInAt: item.checked_in_at,
      dailySequence: null,
      monthSequence: null,
      useSequence: item.use_sequence,
      priceTwd: item.price_twd,
      entryPlan: item.entry_plan,
    };
  });

  return NextResponse.json({ ok: true, mode, history }, { headers: { "Cache-Control": "no-store" } });
}
