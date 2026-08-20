import type { ProfileContext } from "./auth-context";
import { collectCoachDayStatuses } from "./bige-coach-day-status";
import { BIGE_COURSE_LABELS, type BigeCourseType } from "./bige-fitness";
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

function normalizedStaffLabel(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, "");
}

function exactCourseLabel(value: unknown) {
  const key = String(value || "") as BigeCourseType;
  return BIGE_COURSE_LABELS[key] || key || "未標示課別";
}

function timestampInRange(value: unknown, startIso: string, nextIso: string) {
  const timestamp = new Date(String(value || "")).getTime();
  return Number.isFinite(timestamp)
    && timestamp >= new Date(startIso).getTime()
    && timestamp < new Date(nextIso).getTime();
}

function countLabels(labels: string[]) {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-Hant"));
}

function formalCourseCounts(rows: any[]) {
  return countLabels(rows
    .filter((row) => row.operation_kind === "pt" && row.status === "completed")
    .map((row) => exactCourseLabel(row.course_type)));
}

function faExecutionCounts(rows: any[]) {
  return countLabels(rows
    .filter((row) => row.operation_kind === "trial" && row.status === "completed")
    .map((row) => `${String(row.trial_stage || "未標示階段")}・${exactCourseLabel(row.course_type)}`));
}

async function successfulFaAppointmentCredits(params: {
  admin: StaffPerformanceAdminClient;
  tenantId: string;
  startIso: string;
  nextIso: string;
  coaches: Array<{ id: string; display_name: string | null; english_name: string | null }>;
}) {
  const trialsResult = await params.admin.from("trial_bookings")
    .select("id, booking_coach, scheduled_at")
    .eq("tenant_id", params.tenantId)
    .not("booking_coach", "is", null)
    .not("appointment_date", "is", null)
    .gte("scheduled_at", params.startIso)
    .lt("scheduled_at", params.nextIso);
  if (trialsResult.error) throw new Error(trialsResult.error.message || "FA 預約成功資料讀取失敗");
  const coachByLabel = new Map<string, string>();
  for (const coach of params.coaches) {
    for (const label of [coach.english_name, coach.display_name]) {
      const normalized = normalizedStaffLabel(label);
      if (normalized && !coachByLabel.has(normalized)) coachByLabel.set(normalized, String(coach.id));
    }
  }

  const byEmployee = new Map<string, number>();
  const otherLabels: string[] = [];
  let total = 0;
  for (const trial of trialsResult.data || []) {
    const bookingCoach = String(trial.booking_coach || "").trim();
    if (!bookingCoach) continue;
    total += 1;
    const employeeId = coachByLabel.get(normalizedStaffLabel(bookingCoach));
    if (employeeId) byEmployee.set(employeeId, (byEmployee.get(employeeId) || 0) + 1);
    else otherLabels.push(bookingCoach);
  }
  return { byEmployee, other: countLabels(otherLabels), total };
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
  const appointmentStartIso = scope === "daily" ? `${selectedDate}T00:00:00+08:00` : range.startIso;
  const appointmentNextIso = scope === "daily"
    ? new Date(new Date(`${selectedDate}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : range.nextIso;
  const [eventResult, allocationResult, epoResult, reportResult, bookingResult, topStateResult, courseResult, courseClosureResult, coachDayNotesResult, appointmentCredits] = await Promise.all([
    admin.from("staff_sales_events").select("*").eq("tenant_id", tenantId).gte("business_date", startDate).lte("business_date", endDate).order("source_occurred_at", { ascending: false }),
    admin.from("staff_sales_allocations").select("*, staff_sales_events!inner(business_date)").eq("tenant_id", tenantId).gte("staff_sales_events.business_date", startDate).lte("staff_sales_events.business_date", endDate),
    admin.from("staff_epo_awards").select("*").eq("tenant_id", tenantId).gte("business_date", startDate).lte("business_date", endDate).order("created_at", { ascending: false }),
    admin.from("staff_sales_daily_reports").select("*").eq("tenant_id", tenantId).gte("business_date", startDate).lte("business_date", endDate).order("business_date", { ascending: false }),
    scope === "month" && coachIds.length
      ? admin.from("bookings").select("id, coach_id, starts_at, course_type, operation_kind, trial_stage, status, trial_conversion_outcome, bb_conversion_outcome, converted_at, trial_booking_id").eq("tenant_id", tenantId).eq("is_bige_schedule", true).eq("status", "completed").or(`and(starts_at.gte.${range.startIso},starts_at.lt.${range.nextIso}),and(operation_kind.eq.bb,converted_at.gte.${range.startIso},converted_at.lt.${range.nextIso})`).in("coach_id", coachIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("staff_epo_daily_top_states").select("*").eq("tenant_id", tenantId).or(`business_date.eq.${selectedDate},adjustment_business_date.eq.${selectedDate}`).order("business_date"),
    admin.from("bookings").select("id, coach_id, operation_kind, status, operation_result, course_type, trial_stage, trial_conversion_outcome, bb_conversion_outcome, converted_at, trial_booking_id, starts_at").eq("tenant_id", tenantId).eq("is_bige_schedule", true).or(`and(starts_at.gte.${appointmentStartIso},starts_at.lt.${appointmentNextIso}),and(operation_kind.eq.bb,converted_at.gte.${appointmentStartIso},converted_at.lt.${appointmentNextIso})`),
    admin.from("bige_daily_closures").select("id, status, snapshot, confirmed_at, reopened_at, reopen_reason").eq("tenant_id", tenantId).eq("business_date", selectedDate).maybeSingle(),
    coachDayNotesQuery,
    successfulFaAppointmentCredits({
      admin,
      tenantId,
      startIso: appointmentStartIso,
      nextIso: appointmentNextIso,
      coaches,
    }),
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
    const coachBookings = bookings.filter((row) => String(row.coach_id || "") === employeeId);
    const coachScheduledBookings = coachBookings.filter((row) => timestampInRange(row.starts_at, range.startIso, range.nextIso));
    const completedSessions = coachScheduledBookings.filter((row) => row.operation_kind === "pt").length;
    const fa1Fa2 = coachScheduledBookings.filter((row) =>
      row.operation_kind === "trial" && ["FA1", "FA2"].includes(String(row.trial_stage || "")),
    );
    const faConverted = fa1Fa2.filter((row) => row.trial_conversion_outcome === "converted" || row.converted_at).length;
    const faNotConverted = fa1Fa2.filter((row) => row.trial_conversion_outcome === "not_converted").length;
    const faResolved = faConverted + faNotConverted;
    const bbVisits = coachScheduledBookings.filter((row) => row.operation_kind === "bb").length;
    const bbConversions = coachBookings.filter((row) =>
      row.operation_kind === "bb"
      && row.bb_conversion_outcome === "converted"
      && timestampInRange(row.converted_at, range.startIso, range.nextIso),
    ).length;
    const tier = resolveCourseFeeTier({ employmentType: coach.employment_type === "part_time" ? "part_time" : "full_time", salesAmount: confirmedSales, completedSessions });
    return {
      ...coach,
      confirmedSales,
      projectedSales,
      confirmedEpo: allEpo.filter((row) => String(row.employee_id) === employeeId && row.status === "daily_confirmed").reduce((sum, row) => sum + Number(row.quantity), 0),
      projectedEpo: allEpo.filter((row) => String(row.employee_id) === employeeId && ["assistant_proposed", "manager_approved", "daily_confirmed"].includes(String(row.status))).reduce((sum, row) => sum + Number(row.quantity), 0),
      formalCourseCounts: formalCourseCounts(coachScheduledBookings),
      faExecutionCounts: faExecutionCounts(coachScheduledBookings),
      faConverted,
      faNotConverted,
      faPending: Math.max(0, fa1Fa2.length - faResolved),
      faConversionRate: faResolved ? Math.round((faConverted / faResolved) * 1000) / 10 : null,
      successfulFaAppointments: appointmentCredits.byEmployee.get(employeeId) || 0,
      bbVisits,
      bbConversions,
      ...tier,
    };
  });
  const courseRows = courseResult.data || [];
  const settlementCourseRows = courseRows.filter((row) => ["pt", "trial"].includes(String(row.operation_kind)));
  const courseSummary = {
    total: settlementCourseRows.length,
    completed: settlementCourseRows.filter((row) => row.status === "completed").length,
    cancelled: settlementCourseRows.filter((row) => row.status === "cancelled").length,
    noShow: settlementCourseRows.filter((row) => row.status === "no_show").length,
    pending: settlementCourseRows.filter((row) => ["pending", "confirmed", "booked", "checked_in"].includes(String(row.status))).length,
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
    const coachBbRows = courseRows.filter((row) =>
      String(row.coach_id || "") === employeeId && row.operation_kind === "bb" && row.status === "completed",
    );
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
      formalCourseCounts: formalCourseCounts(completedCourses),
      faExecutionCounts: faExecutionCounts(completedCourses),
      successfulFaAppointments: appointmentCredits.byEmployee.get(employeeId) || 0,
      bbVisits: coachBbRows.filter((row) => timestampInRange(row.starts_at, appointmentStartIso, appointmentNextIso)).length,
      bbConversions: coachBbRows.filter((row) =>
        row.bb_conversion_outcome === "converted"
        && timestampInRange(row.converted_at, appointmentStartIso, appointmentNextIso),
      ).length,
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
    successfulFaAppointments: selfOnly ? null : {
      total: appointmentCredits.total,
      otherBookers: appointmentCredits.other,
    },
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
