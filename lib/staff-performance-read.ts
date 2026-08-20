import type { ProfileContext } from "./auth-context";
import { collectCoachDayStatuses } from "./bige-coach-day-status";
import { resolveStaffPermissions } from "./staff-operation-permissions";
import { performanceMonthRange, resolveCourseFeeTier } from "./staff-performance";
import type { syncAutomaticEpoForDate } from "./staff-epo-sync";
import { createSupabaseAdminClient } from "./supabase/admin";

export type StaffPerformanceAdminClient = ReturnType<typeof createSupabaseAdminClient>;
export type StaffPerformanceScope = "daily" | "month";
export type AutomaticEpoState = Awaited<ReturnType<typeof syncAutomaticEpoForDate>>;

export type StaffPerformanceUser = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
};

export function staffPerformanceUserFromContext(context: ProfileContext): StaffPerformanceUser {
  return {
    id: context.userId,
    tenant_id: context.tenantId,
    branch_id: context.branchId,
  };
}

async function coachDirectory(admin: StaffPerformanceAdminClient, tenantId: string) {
  const [employmentResult, profileResult] = await Promise.all([
    admin.from("staff_employment_profiles")
      .select("employee_id, employment_type, work_group")
      .eq("tenant_id", tenantId).eq("work_group", "coach"),
    admin.from("profiles")
      .select("id, display_name, english_name, employee_number, role, position")
      .eq("tenant_id", tenantId).eq("is_active", true).is("staff_deleted_at", null)
      .or("role.eq.coach,position.in.(coach,coach_team_lead,coach_director,coach_assistant_manager,coach_manager,coach_city_manager)"),
  ]);
  if (employmentResult.error || profileResult.error) throw new Error(employmentResult.error?.message || profileResult.error?.message || "教練名錄讀取失敗");
  const employment = new Map((employmentResult.data || []).map((row) => [String(row.employee_id), String(row.employment_type)]));
  return (profileResult.data || []).map((profile) => ({
    ...profile,
    employment_type: employment.has(String(profile.id))
      ? employment.get(String(profile.id)) === "part_time" ? "part_time" as const : "full_time" as const
      : null,
    employment_configured: employment.has(String(profile.id)),
  })).sort((left, right) => String(left.employee_number || left.display_name || "").localeCompare(String(right.employee_number || right.display_name || ""), "zh-Hant"));
}

export async function staffPerformancePermissions(
  admin: StaffPerformanceAdminClient,
  user: StaffPerformanceUser,
  context: ProfileContext,
) {
  if (!user.tenant_id) throw new Error("帳號尚未設定館別");
  if (context.role === "platform_admin") {
    return { canAllocate: true, canApprove: true, canManageEpo: true, canConfirm: true, canViewSalary: true, canManage: true };
  }
  const resolved = await resolveStaffPermissions({
    supabase: admin,
    tenantId: user.tenant_id,
    employeeId: user.id,
    context,
  });
  const canAllocate = resolved.allocate_sales_performance.allowed;
  const canApprove = resolved.approve_sales_performance.allowed;
  const canManageEpo = resolved.manage_epo.allowed;
  const canConfirm = resolved.confirm_daily_sales_report.allowed;
  const canViewSalary = resolved.view_team_salary.allowed;
  return { canAllocate, canApprove, canManageEpo, canConfirm, canViewSalary, canManage: canAllocate || canApprove || canManageEpo || canConfirm };
}

export async function getStaffPerformanceState(
  admin: StaffPerformanceAdminClient,
  user: StaffPerformanceUser,
  context: ProfileContext,
  month: string,
  selectedDate: string,
  requestedScope: StaffPerformanceScope = "month",
  automaticEpo: AutomaticEpoState = { dailyTopStates: [], sessionEvidence: [] },
) {
  const startedAt = Date.now();
  const tenantId = user.tenant_id;
  if (!tenantId) throw new Error("帳號尚未設定館別");
  const range = performanceMonthRange(month);
  const accessStartedAt = Date.now();
  const [actor, coaches] = await Promise.all([
    staffPerformancePermissions(admin, user, context),
    coachDirectory(admin, tenantId),
  ]);
  const accessMs = Date.now() - accessStartedAt;
  const scope: StaffPerformanceScope = actor.canManage ? requestedScope : "month";
  const startDate = scope === "daily" ? selectedDate : range.start;
  const endDate = scope === "daily" ? selectedDate : range.end;
  const coachIds = coaches.map((item) => String(item.id));

  let coachDayNotesQuery = admin.from("bige_schedule_notes")
    .select("coach_id, content")
    .eq("tenant_id", tenantId)
    .gte("starts_at", `${selectedDate}T00:00:00+08:00`)
    .lte("starts_at", `${selectedDate}T23:59:59.999+08:00`);
  if (user.branch_id) coachDayNotesQuery = coachDayNotesQuery.eq("branch_id", user.branch_id);

  const dataStartedAt = Date.now();
  const [eventResult, allocationResult, epoResult, reportResult, bookingResult, topStateResult, courseResult, courseClosureResult, coachDayNotesResult] = await Promise.all([
    admin.from("staff_sales_events").select("*").eq("tenant_id", tenantId).gte("business_date", startDate).lte("business_date", endDate).order("source_occurred_at", { ascending: false }),
    admin.from("staff_sales_allocations").select("*, staff_sales_events!inner(business_date)").eq("tenant_id", tenantId).gte("staff_sales_events.business_date", startDate).lte("staff_sales_events.business_date", endDate),
    admin.from("staff_epo_awards").select("*").eq("tenant_id", tenantId).gte("business_date", startDate).lte("business_date", endDate).order("created_at", { ascending: false }),
    admin.from("staff_sales_daily_reports").select("*").eq("tenant_id", tenantId).gte("business_date", startDate).lte("business_date", endDate).order("business_date", { ascending: false }),
    scope === "month" && coachIds.length
      ? admin.from("bookings").select("id, coach_id, starts_at, course_type").eq("tenant_id", tenantId).eq("is_bige_schedule", true).eq("operation_kind", "pt").eq("status", "completed").gte("starts_at", range.startIso).lt("starts_at", range.nextIso).in("coach_id", coachIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("staff_epo_daily_top_states").select("*").eq("tenant_id", tenantId).or(`business_date.eq.${selectedDate},adjustment_business_date.eq.${selectedDate}`).order("business_date"),
    admin.from("bookings").select("id, coach_id, operation_kind, status, operation_result").eq("tenant_id", tenantId).eq("is_bige_schedule", true).gte("starts_at", `${selectedDate}T00:00:00+08:00`).lte("starts_at", `${selectedDate}T23:59:59.999+08:00`),
    admin.from("bige_daily_closures").select("id, status, snapshot, confirmed_at, reopened_at, reopen_reason").eq("tenant_id", tenantId).eq("business_date", selectedDate).maybeSingle(),
    coachDayNotesQuery,
  ]);
  const dataMs = Date.now() - dataStartedAt;
  if (eventResult.error || allocationResult.error || epoResult.error || reportResult.error || bookingResult.error || topStateResult.error || courseResult.error || courseClosureResult.error || coachDayNotesResult.error) {
    throw new Error(eventResult.error?.message || allocationResult.error?.message || epoResult.error?.message || reportResult.error?.message || bookingResult.error?.message || topStateResult.error?.message || courseResult.error?.message || courseClosureResult.error?.message || coachDayNotesResult.error?.message || "業績資料讀取失敗");
  }

  const allEvents = eventResult.data || [];
  const allAllocations = allocationResult.data || [];
  const allEpo = epoResult.data || [];
  const bookings = bookingResult.data || [];
  const eventsWithAllocations = allEvents.map((event) => ({
    ...event,
    allocations: allAllocations.filter((allocation) =>
      String(allocation.event_id) === String(event.id) &&
      Number(allocation.allocation_version) === Number(event.active_allocation_version || 0) &&
      allocation.status !== "cancelled",
    ),
  }));
  const summaries = coaches.map((coach) => {
    const employeeId = String(coach.id);
    const assigned = allAllocations.filter((row) => String(row.employee_id || "") === employeeId);
    const confirmedSales = assigned.filter((row) => row.status === "daily_confirmed").reduce((sum, row) => sum + Number(row.amount), 0);
    const projectedSales = assigned.filter((row) => ["pending_manager", "approved", "daily_confirmed"].includes(String(row.status))).reduce((sum, row) => sum + Number(row.amount), 0);
    const completedSessions = bookings.filter((row) => String(row.coach_id || "") === employeeId).length;
    const tier = resolveCourseFeeTier({ employmentType: coach.employment_type === "part_time" ? "part_time" : "full_time", salesAmount: confirmedSales, completedSessions });
    return {
      ...coach,
      confirmedSales,
      projectedSales,
      confirmedEpo: allEpo.filter((row) => String(row.employee_id) === employeeId && row.status === "daily_confirmed").reduce((sum, row) => sum + Number(row.quantity), 0),
      projectedEpo: allEpo.filter((row) => String(row.employee_id) === employeeId && ["assistant_proposed", "manager_approved", "daily_confirmed"].includes(String(row.status))).reduce((sum, row) => sum + Number(row.quantity), 0),
      ...tier,
    };
  });
  const courseRows = courseResult.data || [];
  const courseSummary = {
    total: courseRows.length,
    completed: courseRows.filter((row) => row.status === "completed").length,
    cancelled: courseRows.filter((row) => row.status === "cancelled").length,
    noShow: courseRows.filter((row) => row.status === "no_show").length,
    pending: courseRows.filter((row) => ["pending", "confirmed", "booked", "checked_in"].includes(String(row.status))).length,
    ptCompleted: courseRows.filter((row) => row.operation_kind === "pt" && row.status === "completed").length,
    trialCompleted: courseRows.filter((row) => row.operation_kind === "trial" && row.status === "completed").length,
  };
  const dayAllocations = eventsWithAllocations
    .filter((event) => String(event.business_date) === selectedDate)
    .flatMap((event) => event.allocations);
  const coachDayStatusByEmployee = new Map(
    collectCoachDayStatuses(coachDayNotesResult.data || [], new Set(coachIds))
      .map((status) => [status.coach_id, status]),
  );
  const dailyCoachSummaries = coaches.filter((coach) => coachDayStatusByEmployee.get(String(coach.id))?.status !== "off").map((coach) => {
    const employeeId = String(coach.id);
    const dayStatus = coachDayStatusByEmployee.get(employeeId);
    const coachCourses = courseRows.filter((row) => String(row.coach_id || "") === employeeId && ["pt", "trial"].includes(String(row.operation_kind)));
    const activeCourses = coachCourses.filter((row) => ["completed", "pending", "confirmed", "booked", "checked_in"].includes(String(row.status)));
    const completedCourses = coachCourses.filter((row) => row.status === "completed");
    const allocations = dayAllocations.filter((row) => String(row.employee_id || "") === employeeId);
    return {
      employeeId,
      shiftLabel: dayStatus?.label || null,
      shiftStartsAt: null,
      shiftEndsAt: null,
      completedSessions: completedCourses.length,
      scheduledSessions: activeCourses.length,
      pendingSessions: activeCourses.filter((row) => row.status !== "completed").length,
      ptCompletedSessions: completedCourses.filter((row) => row.operation_kind === "pt").length,
      trialCompletedSessions: completedCourses.filter((row) => row.operation_kind === "trial").length,
      cancelledSessions: coachCourses.filter((row) => row.status === "cancelled").length,
      noShowSessions: coachCourses.filter((row) => row.status === "no_show").length,
      salesAmount: allocations.reduce((sum, row) => sum + Number(row.amount), 0),
      confirmedSalesAmount: allocations.filter((row) => row.status === "daily_confirmed").reduce((sum, row) => sum + Number(row.amount), 0),
      salesAllocationCount: allocations.length,
      salesNeedsConfirmation: allocations.some((row) => row.status !== "daily_confirmed"),
    };
  });
  const selfOnly = !actor.canManage;
  const selfEvents = eventsWithAllocations
    .map((event) => {
      const allocations = event.allocations.filter((allocation: any) => String(allocation.employee_id) === user.id && allocation.status === "daily_confirmed");
      return { ...event, allocations, amount: allocations.reduce((sum: number, allocation: any) => sum + Number(allocation.amount), 0) };
    })
    .filter((event) => event.allocations.length > 0);
  const result = {
    actor: { id: user.id, ...actor }, month, selectedDate, scope,
    coaches: selfOnly ? summaries.filter((row) => String(row.id) === user.id) : summaries,
    events: selfOnly ? selfEvents : eventsWithAllocations,
    epoAwards: selfOnly ? allEpo.filter((row) => String(row.employee_id) === user.id && row.status === "daily_confirmed") : allEpo,
    dailyReports: selfOnly ? [] : reportResult.data || [],
    dailyTopStates: selfOnly ? [] : topStateResult.data || automaticEpo.dailyTopStates,
    sessionEpoEvidence: selfOnly ? [] : automaticEpo.sessionEvidence,
    dailyCoachSummaries: selfOnly ? [] : dailyCoachSummaries,
    courseSettlement: selfOnly ? null : { summary: courseSummary, closure: courseClosureResult.data || null },
  };
  console.info("[staff-performance] state ready", {
    month,
    selectedDate,
    scope,
    accessMs,
    dataMs,
    totalMs: Date.now() - startedAt,
  });
  return result;
}
