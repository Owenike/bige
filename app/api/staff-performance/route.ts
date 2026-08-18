import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError, apiSuccess, requireProfile, type ProfileContext } from "../../../lib/auth-context";
import { createInAppNotifications } from "../../../lib/in-app-notifications";
import { hasStaffPermission, requireStaffPermission } from "../../../lib/staff-operation-permissions";
import { performanceMonthRange, resolveCourseFeeTier, taiwanBusinessDate } from "../../../lib/staff-performance";
import { syncAutomaticEpoForDate } from "../../../lib/staff-epo-sync";
import { validateSalesAllocations } from "../../../lib/staff-performance-settlement";
import { syncBigePaymentPerformanceSources } from "../../../lib/staff-performance-sync";
import { writeStaffAudit } from "../../../lib/staff-audit";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

export const runtime = "nodejs";

const STAFF_ROLES = [
  "platform_admin", "manager", "supervisor", "branch_manager", "store_owner",
  "store_manager", "frontdesk", "coach", "therapist", "sales",
] as const;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ProfileRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  display_name: string | null;
  english_name: string | null;
  employee_number: string | null;
  position: string | null;
  role: string;
};

async function loadProfile(admin: AdminClient, id: string) {
  const result = await admin.from("profiles")
    .select("id, tenant_id, branch_id, display_name, english_name, employee_number, position, role")
    .eq("id", id).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("找不到員工帳號");
  return result.data as ProfileRow;
}

async function coachDirectory(admin: AdminClient, tenantId: string) {
  const employmentResult = await admin.from("staff_employment_profiles")
    .select("employee_id, employment_type, work_group")
    .eq("tenant_id", tenantId).eq("work_group", "coach");
  if (employmentResult.error) throw new Error(employmentResult.error.message);
  const profileResult = await admin.from("profiles")
      .select("id, display_name, english_name, employee_number, role, position")
      .eq("tenant_id", tenantId).eq("is_active", true).is("staff_deleted_at", null)
      .or("role.eq.coach,position.in.(coach,coach_team_lead,coach_director,coach_assistant_manager,coach_manager,coach_city_manager)");
  if (profileResult.error) throw new Error(profileResult.error.message);
  const employment = new Map((employmentResult.data || []).map((row) => [String(row.employee_id), String(row.employment_type)]));
  return (profileResult.data || []).map((profile) => ({
    ...profile,
    employment_type: employment.has(String(profile.id))
      ? employment.get(String(profile.id)) === "part_time" ? "part_time" as const : "full_time" as const
      : null,
    employment_configured: employment.has(String(profile.id)),
  })).sort((left, right) => String(left.employee_number || left.display_name || "").localeCompare(String(right.employee_number || right.display_name || ""), "zh-Hant"));
}

async function requireCoachTarget(admin: AdminClient, tenantId: string, employeeId: string) {
  const target = await admin.from("profiles").select("id, role, position")
    .eq("tenant_id", tenantId).eq("id", employeeId).eq("is_active", true).is("staff_deleted_at", null).maybeSingle();
  if (target.error) throw new Error(target.error.message);
  const coachPositions = new Set(["coach", "coach_team_lead", "coach_director", "coach_assistant_manager", "coach_manager", "coach_city_manager"]);
  if (!target.data || (target.data.role !== "coach" && !coachPositions.has(String(target.data.position || "")))) throw new Error("只能把業績或 EPO 分配給教練帳號");
}

async function permissions(admin: AdminClient, user: ProfileRow, context: ProfileContext) {
  if (!user.tenant_id) throw new Error("帳號尚未設定館別");
  const base = { supabase: admin, tenantId: user.tenant_id, employeeId: user.id, context };
  const [canAllocate, canApprove, canManageEpo, canConfirm, canViewSalary] = await Promise.all([
    hasStaffPermission({ ...base, permission: "allocate_sales_performance" }),
    hasStaffPermission({ ...base, permission: "approve_sales_performance" }),
    hasStaffPermission({ ...base, permission: "manage_epo" }),
    hasStaffPermission({ ...base, permission: "confirm_daily_sales_report" }),
    hasStaffPermission({ ...base, permission: "view_team_salary" }),
  ]);
  return { canAllocate, canApprove, canManageEpo, canConfirm, canViewSalary, canManage: canAllocate || canApprove || canManageEpo || canConfirm };
}

async function state(admin: AdminClient, user: ProfileRow, context: ProfileContext, month: string, selectedDate: string) {
  const tenantId = user.tenant_id;
  if (!tenantId) throw new Error("帳號尚未設定館別");
  const range = performanceMonthRange(month);
  const actor = await permissions(admin, user, context);
  let automaticEpo = { dailyTopStates: [] as any[], sessionEvidence: [] as any[] };
  if (actor.canManage) {
    await syncBigePaymentPerformanceSources(admin, tenantId, month, user.id);
    automaticEpo = await syncAutomaticEpoForDate({
      admin,
      tenantId,
      branchId: user.branch_id,
      businessDate: selectedDate,
      actorId: user.id,
    });
  }
  const coaches = await coachDirectory(admin, tenantId);
  const coachIds = coaches.map((item) => String(item.id));
  const [eventResult, allocationResult, epoResult, reportResult, bookingResult, topStateResult, courseResult, courseClosureResult] = await Promise.all([
    admin.from("staff_sales_events").select("*").eq("tenant_id", tenantId).gte("business_date", range.start).lte("business_date", range.end).order("source_occurred_at", { ascending: false }),
    admin.from("staff_sales_allocations").select("*, staff_sales_events!inner(business_date)").eq("tenant_id", tenantId).gte("staff_sales_events.business_date", range.start).lte("staff_sales_events.business_date", range.end),
    admin.from("staff_epo_awards").select("*").eq("tenant_id", tenantId).gte("business_date", range.start).lte("business_date", range.end).order("created_at", { ascending: false }),
    admin.from("staff_sales_daily_reports").select("*").eq("tenant_id", tenantId).gte("business_date", range.start).lte("business_date", range.end).order("business_date", { ascending: false }),
    coachIds.length
      ? admin.from("bookings").select("id, coach_id, starts_at, course_type").eq("tenant_id", tenantId).eq("is_bige_schedule", true).eq("operation_kind", "pt").eq("status", "completed").gte("starts_at", range.startIso).lt("starts_at", range.nextIso).in("coach_id", coachIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("staff_epo_daily_top_states").select("*").eq("tenant_id", tenantId).or(`business_date.eq.${selectedDate},adjustment_business_date.eq.${selectedDate}`).order("business_date"),
    admin.from("bookings").select("id, operation_kind, status, operation_result").eq("tenant_id", tenantId).eq("is_bige_schedule", true).gte("starts_at", `${selectedDate}T00:00:00+08:00`).lte("starts_at", `${selectedDate}T23:59:59.999+08:00`),
    admin.from("bige_daily_closures").select("id, status, snapshot, confirmed_at, reopened_at, reopen_reason").eq("tenant_id", tenantId).eq("business_date", selectedDate).maybeSingle(),
  ]);
  if (eventResult.error || allocationResult.error || epoResult.error || reportResult.error || bookingResult.error || topStateResult.error || courseResult.error || courseClosureResult.error) {
    throw new Error(eventResult.error?.message || allocationResult.error?.message || epoResult.error?.message || reportResult.error?.message || bookingResult.error?.message || topStateResult.error?.message || courseResult.error?.message || courseClosureResult.error?.message || "業績資料讀取失敗");
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
  const selfOnly = !actor.canManage;
  const selfEvents = eventsWithAllocations
    .map((event) => {
      const allocations = event.allocations.filter((allocation: any) => String(allocation.employee_id) === user.id && allocation.status === "daily_confirmed");
      return { ...event, allocations, amount: allocations.reduce((sum: number, allocation: any) => sum + Number(allocation.amount), 0) };
    })
    .filter((event) => event.allocations.length > 0);
  return {
    actor: { id: user.id, ...actor }, month, selectedDate,
    coaches: selfOnly ? summaries.filter((row) => String(row.id) === user.id) : summaries,
    events: selfOnly ? selfEvents : eventsWithAllocations,
    epoAwards: selfOnly ? allEpo.filter((row) => String(row.employee_id) === user.id && row.status === "daily_confirmed") : allEpo,
    dailyReports: selfOnly ? [] : reportResult.data || [],
    dailyTopStates: selfOnly ? [] : topStateResult.data || automaticEpo.dailyTopStates,
    sessionEpoEvidence: selfOnly ? [] : automaticEpo.sessionEvidence,
    courseSettlement: selfOnly ? null : { summary: courseSummary, closure: courseClosureResult.data || null },
  };
}

async function ensureDraftDay(admin: AdminClient, tenantId: string, date: string) {
  const result = await admin.from("staff_sales_daily_reports").select("id, status")
    .eq("tenant_id", tenantId).eq("business_date", date).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (result.data?.status === "confirmed") throw new Error("此日期已完成每日報表確認；如需修改，請由經理先重新開啟");
}

function normalizedDatabaseMessage(message: string) {
  const key = message.split("\n")[0].trim();
  const messages: Record<string, string> = {
    sales_event_not_found: "找不到這筆業績",
    refund_allocation_locked: "退款只能依原正式分配自動扣回，不可自由改配",
    sales_event_locked: "這筆業績已鎖定，請先由經理重新開啟日結",
    sales_allocations_required: "至少要有一筆教練分配",
    sales_allocation_duplicate_employee: "同一位教練不可在同一筆業績重複分配",
    sales_allocation_amount_invalid: "每位教練的分配金額必須大於 0",
    sales_allocation_total_mismatch: "分配總額必須與該筆實收金額完全一致",
    sales_allocation_employee_invalid: "分配對象已停用或不屬於目前場館",
    sales_allocation_confirmed_locked: "已正式結算的分配不可直接覆蓋，請先重新開啟",
    pending_sales_event_not_found: "找不到等待經理覆核的業績分配",
    review_note_required: "駁回時必須填寫原因",
    daily_settlement_already_confirmed: "這一天已完成正式結算",
    daily_courses_pending: "仍有課程狀態尚未處理，不能正式結算",
    daily_sales_unresolved: "仍有業績未完成分配或等待經理覆核",
    daily_epo_unresolved: "仍有 EPO 等待經理覆核",
    daily_top_tie_unresolved: "每日數字最高同額，請先選擇 EPO 得主",
    daily_sales_allocation_mismatch: "有業績分配總額與實收金額不一致",
    reopen_reason_required: "重新開啟必須填寫原因",
    confirmed_daily_settlement_not_found: "找不到已正式結算的資料",
  };
  return messages[key] || message;
}

async function countLegacyPurchaseDateReminders(
  admin: AdminClient,
  tenantId: string,
  branchId: string | null,
  businessDate: string,
) {
  let bookingQuery = admin.from("bookings").select("member_id")
    .eq("tenant_id", tenantId).eq("is_bige_schedule", true)
    .eq("operation_kind", "pt").eq("status", "completed")
    .gte("starts_at", `${businessDate}T00:00:00+08:00`)
    .lte("starts_at", `${businessDate}T23:59:59.999+08:00`);
  if (branchId) bookingQuery = bookingQuery.eq("branch_id", branchId);
  const bookingResult = await bookingQuery;
  if (bookingResult.error) throw new Error(bookingResult.error.message);
  const memberIds = [...new Set((bookingResult.data || []).map((row) => row.member_id ? String(row.member_id) : "").filter(Boolean))];
  if (!memberIds.length) return 0;
  const sharedResult = await admin.from("member_plan_contract_members").select("contract_id")
    .eq("tenant_id", tenantId).in("member_id", memberIds);
  if (sharedResult.error) throw new Error(sharedResult.error.message);
  const sharedIds = [...new Set((sharedResult.data || []).map((row) => String(row.contract_id)))];
  const filter = sharedIds.length
    ? `member_id.in.(${memberIds.join(",")}),id.in.(${sharedIds.join(",")})`
    : `member_id.in.(${memberIds.join(",")})`;
  const contractResult = await admin.from("member_plan_contracts").select("id")
    .eq("tenant_id", tenantId).eq("is_legacy_import", true)
    .is("signed_on", null).neq("status", "canceled").or(filter);
  if (contractResult.error) throw new Error(contractResult.error.message);
  return (contractResult.data || []).length;
}

async function dailySettlementInputs(
  admin: AdminClient,
  tenantId: string,
  branchId: string | null,
  businessDate: string,
) {
  let courseQuery = admin.from("bookings").select("id, operation_kind, status")
    .eq("tenant_id", tenantId).eq("is_bige_schedule", true)
    .gte("starts_at", `${businessDate}T00:00:00+08:00`)
    .lte("starts_at", `${businessDate}T23:59:59.999+08:00`);
  if (branchId) courseQuery = courseQuery.eq("branch_id", branchId);
  const [eventResult, allocationResult, epoResult, topResult, courseResult] = await Promise.all([
    admin.from("staff_sales_events").select("id, amount, status, active_allocation_version")
      .eq("tenant_id", tenantId).eq("business_date", businessDate),
    admin.from("staff_sales_allocations").select("id, event_id, allocation_version, employee_id, amount, status")
      .eq("tenant_id", tenantId).in("status", ["pending_manager", "approved", "daily_confirmed"]),
    admin.from("staff_epo_awards").select("id, employee_id, quantity, status")
      .eq("tenant_id", tenantId).eq("business_date", businessDate),
    admin.from("staff_epo_daily_top_states").select("id, status")
      .eq("tenant_id", tenantId).or(`business_date.eq.${businessDate},adjustment_business_date.eq.${businessDate}`),
    courseQuery,
  ]);
  const failure = eventResult.error || allocationResult.error || epoResult.error || topResult.error || courseResult.error;
  if (failure) throw new Error(failure.message);
  const events = eventResult.data || [];
  const eventMap = new Map(events.map((event) => [String(event.id), event]));
  const allocations = (allocationResult.data || []).filter((allocation) => {
    const event = eventMap.get(String(allocation.event_id));
    return event && Number(allocation.allocation_version) === Number(event.active_allocation_version);
  });
  const epo = epoResult.data || [];
  const courses = courseResult.data || [];
  const courseSnapshot = {
    businessDate,
    generatedAt: new Date().toISOString(),
    total: courses.length,
    completed: courses.filter((row) => row.status === "completed").length,
    cancelled: courses.filter((row) => row.status === "cancelled").length,
    noShow: courses.filter((row) => row.status === "no_show").length,
    pending: courses.filter((row) => ["pending", "confirmed", "booked", "checked_in"].includes(String(row.status))).length,
    ptCompleted: courses.filter((row) => row.operation_kind === "pt" && row.status === "completed").length,
    trialCompleted: courses.filter((row) => row.operation_kind === "trial" && row.status === "completed").length,
  };
  const salesSnapshot = {
    salesTotal: allocations.filter((row) => ["approved", "daily_confirmed"].includes(String(row.status))).reduce((sum, row) => sum + Number(row.amount), 0),
    salesCount: events.filter((row) => ["approved", "daily_confirmed"].includes(String(row.status))).length,
    allocationCount: allocations.filter((row) => ["approved", "daily_confirmed"].includes(String(row.status))).length,
    epoTotal: epo.filter((row) => ["manager_approved", "daily_confirmed"].includes(String(row.status))).reduce((sum, row) => sum + Number(row.quantity), 0),
    generatedAt: new Date().toISOString(),
  };
  return {
    events,
    allocations,
    epo,
    courseSnapshot,
    salesSnapshot,
    unassignedEvents: events.filter((row) => row.status === "unassigned").length,
    pendingEvents: events.filter((row) => row.status === "pending_manager").length,
    pendingEpo: epo.filter((row) => row.status === "assistant_proposed").length,
    pendingTopTies: (topResult.data || []).filter((row) => row.status === "tie_pending").length,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    const selectedDate = url.searchParams.get("date") || taiwanBusinessDate(new Date());
    performanceMonthRange(month);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || !selectedDate.startsWith(month)) throw new Error("日期不在所選月份");
    const admin = createSupabaseAdminClient();
    const user = await loadProfile(admin, auth.context.userId);
    return apiSuccess(await state(admin, user, auth.context, month, selectedDate));
  } catch (error) {
    return apiError(400, "FORBIDDEN", error instanceof Error ? error.message : "無法讀取業績資料");
  }
}

export async function POST(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  try {
    const user = await loadProfile(admin, auth.context.userId);
    const tenantId = user.tenant_id;
    if (!tenantId) throw new Error("帳號尚未設定館別");
    const body = z.object({ action: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).passthrough().parse(await request.json());
    if (!body.date.startsWith(body.month)) throw new Error("日期不在所選月份");
    const actorPermissions = await permissions(admin, user, auth.context);

    if (body.action === "save_allocations") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "allocate_sales_performance", message: "您沒有分配業績的權限" });
      await ensureDraftDay(admin, tenantId, body.date);
      const values = z.object({
        eventId: z.string().uuid(),
        allocations: z.array(z.object({ employeeId: z.string().uuid(), amount: z.coerce.number().positive() })).min(1).max(30),
        note: z.string().trim().max(1000).optional(),
      }).parse(body);
      const eventResult = await admin.from("staff_sales_events").select("id, source_type, label, amount")
        .eq("id", values.eventId).eq("tenant_id", tenantId).eq("business_date", body.date).maybeSingle();
      if (eventResult.error || !eventResult.data) throw new Error("找不到這筆業績");
      if (eventResult.data.source_type === "refund") throw new Error("退款只能依原正式分配自動扣回，不可自由改配");
      const validation = validateSalesAllocations(Number(eventResult.data.amount), values.allocations);
      if (!validation.valid) throw new Error(`分配總額必須等於 ${eventResult.data.amount} 元，目前還差 ${validation.remainingAmount} 元`);
      for (const employeeId of [...new Set(values.allocations.map((item) => item.employeeId))]) {
        await requireCoachTarget(admin, tenantId, employeeId);
      }
      const now = new Date().toISOString();
      const save = await admin.rpc("staff_save_sales_allocations_v1", {
        p_tenant_id: tenantId,
        p_event_id: values.eventId,
        p_actor_id: user.id,
        p_manager_approved: actorPermissions.canApprove,
        p_allocations: values.allocations.map((item) => ({ employee_id: item.employeeId, amount: item.amount })),
        p_note: values.note || null,
      });
      if (save.error) throw new Error(normalizedDatabaseMessage(save.error.message));
      if (!actorPermissions.canApprove) await createInAppNotifications({ supabase: admin, tenantId, recipientRoles: ["manager", "branch_manager", "store_owner", "store_manager"], title: `${body.date} 有業績等待覆核`, message: `${eventResult.data.label} 已由副理完成分配，請經理覆核。`, eventType: "staff_sales_assignment_review", targetType: "staff_sales_event", targetId: values.eventId, actionUrl: `/manager/staff-performance?month=${body.month}&date=${body.date}`, dedupeKey: `staff-sales-review:${values.eventId}:${now}`, createdBy: user.id });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_sales_allocations_saved", targetType: "staff_sales_event", targetId: values.eventId, after: { allocations: values.allocations, status: actorPermissions.canApprove ? "approved" : "pending_manager", note: values.note || null } });
    } else if (body.action === "review_event") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "approve_sales_performance", message: "只有經理能覆核業績" });
      await ensureDraftDay(admin, tenantId, body.date);
      const values = z.object({ eventId: z.string().uuid(), decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() }).parse(body);
      if (values.decision === "reject" && !values.note) throw new Error("駁回時請填寫原因");
      const update = await admin.rpc("staff_review_sales_allocations_v1", {
        p_tenant_id: tenantId,
        p_event_id: values.eventId,
        p_actor_id: user.id,
        p_approve: values.decision === "approve",
        p_note: values.note || null,
      });
      if (update.error) throw new Error(normalizedDatabaseMessage(update.error.message));
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: `staff_sales_event_${values.decision}d`, targetType: "staff_sales_event", targetId: values.eventId, reason: values.note || null });
    } else if (body.action === "select_daily_top") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "manage_epo", message: "您沒有選擇每日最高 EPO 得主的權限" });
      await ensureDraftDay(admin, tenantId, body.date);
      const values = z.object({ originalBusinessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), employeeId: z.string().uuid() }).parse(body);
      await requireCoachTarget(admin, tenantId, values.employeeId);
      const topResult = await admin.from("staff_epo_daily_top_states").select("id, candidate_employee_ids, status")
        .eq("tenant_id", tenantId).eq("business_date", values.originalBusinessDate).maybeSingle();
      if (topResult.error || !topResult.data) throw new Error("找不到每日最高同額待決定資料");
      const candidates = (topResult.data.candidate_employee_ids || []).map(String);
      if (!candidates.includes(values.employeeId)) throw new Error("只能從同額第一名中選擇 EPO 得主");
      const decidedAt = new Date().toISOString();
      const decision = await admin.from("staff_epo_daily_top_states").update({
        selected_employee_id: values.employeeId,
        status: actorPermissions.canApprove ? "manager_selected" : "assistant_selected",
        decision_by: user.id,
        decision_at: decidedAt,
      }).eq("id", topResult.data.id).select("id").single();
      if (decision.error) throw new Error(decision.error.message);
      await syncAutomaticEpoForDate({ admin, tenantId, branchId: user.branch_id, businessDate: body.date, actorId: user.id });
      if (!actorPermissions.canApprove) await createInAppNotifications({ supabase: admin, tenantId, recipientRoles: ["manager", "branch_manager", "store_owner", "store_manager"], title: `${values.originalBusinessDate} 每日最高同額待覆核`, message: `副理建議由指定教練取得每日最高 1 EPO，請經理覆核。`, eventType: "staff_daily_top_review", targetType: "staff_epo_daily_top_state", targetId: String(topResult.data.id), actionUrl: `/manager/staff-performance?month=${body.month}&date=${body.date}`, dedupeKey: `staff-daily-top:${topResult.data.id}:${decidedAt}`, createdBy: user.id });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_daily_top_selected", targetType: "staff_epo_daily_top_state", targetId: String(topResult.data.id), after: { originalBusinessDate: values.originalBusinessDate, employeeId: values.employeeId, status: actorPermissions.canApprove ? "manager_selected" : "assistant_selected" } });
    } else if (body.action === "propose_epo") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "manage_epo", message: "您沒有提出 EPO 的權限" });
      await ensureDraftDay(admin, tenantId, body.date);
      const values = z.object({ employeeId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100), reason: z.string().trim().min(2).max(1000) }).parse(body);
      await requireCoachTarget(admin, tenantId, values.employeeId);
      const insert = await admin.from("staff_epo_awards").insert({ tenant_id: tenantId, branch_id: user.branch_id, business_date: body.date, employee_id: values.employeeId, quantity: values.quantity, reason: values.reason, status: actorPermissions.canApprove ? "manager_approved" : "assistant_proposed", proposed_by: user.id, reviewed_by: actorPermissions.canApprove ? user.id : null, reviewed_at: actorPermissions.canApprove ? new Date().toISOString() : null }).select("id").single();
      if (insert.error) throw new Error(insert.error.message);
      if (!actorPermissions.canApprove) await createInAppNotifications({ supabase: admin, tenantId, recipientRoles: ["manager", "branch_manager", "store_owner", "store_manager"], title: `${body.date} 有 EPO 等待覆核`, message: `副理提出 ${values.quantity} 個 EPO：${values.reason}`, eventType: "staff_epo_review", targetType: "staff_epo_award", targetId: String(insert.data.id), actionUrl: `/manager/staff-performance?month=${body.month}&date=${body.date}`, dedupeKey: `staff-epo-review:${insert.data.id}`, createdBy: user.id });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_epo_proposed", targetType: "staff_epo_award", targetId: String(insert.data.id), reason: values.reason, after: { employeeId: values.employeeId, quantity: values.quantity } });
    } else if (body.action === "review_epo") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "approve_sales_performance", message: "只有經理能覆核 EPO" });
      await ensureDraftDay(admin, tenantId, body.date);
      const values = z.object({ epoId: z.string().uuid(), decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() }).parse(body);
      if (values.decision === "reject" && !values.note) throw new Error("駁回時請填寫原因");
      const awardResult = await admin.from("staff_epo_awards").select("id, award_type")
        .eq("id", values.epoId).eq("tenant_id", tenantId).eq("business_date", body.date).eq("status", "assistant_proposed").maybeSingle();
      if (awardResult.error || !awardResult.data) throw new Error("找不到待覆核 EPO");
      const update = await admin.from("staff_epo_awards").update({ status: values.decision === "approve" ? "manager_approved" : "rejected", reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_note: values.note || null }).eq("id", values.epoId).eq("status", "assistant_proposed").select("id").maybeSingle();
      if (update.error || !update.data) throw new Error("找不到待覆核 EPO");
      if (["daily_top", "reassignment"].includes(String(awardResult.data.award_type))) {
        const topUpdate = values.decision === "approve"
          ? await admin.from("staff_epo_daily_top_states").update({ status: "manager_selected", decision_by: user.id, decision_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("active_award_id", values.epoId)
          : await admin.from("staff_epo_daily_top_states").update({ status: "tie_pending", selected_employee_id: null, active_award_id: null, decision_by: null, decision_at: null }).eq("tenant_id", tenantId).eq("active_award_id", values.epoId);
        if (topUpdate.error) throw new Error(topUpdate.error.message);
      }
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: `staff_epo_${values.decision}d`, targetType: "staff_epo_award", targetId: values.epoId, reason: values.note || null });
    } else if (body.action === "prepare_day") {
      if (!actorPermissions.canAllocate && !actorPermissions.canApprove) throw new Error("您沒有整理今日結算的權限");
      await ensureDraftDay(admin, tenantId, body.date);
      await syncBigePaymentPerformanceSources(admin, tenantId, body.month, user.id);
      await syncAutomaticEpoForDate({ admin, tenantId, branchId: user.branch_id, businessDate: body.date, actorId: user.id });
      const inputs = await dailySettlementInputs(admin, tenantId, user.branch_id, body.date);
      if (inputs.unassignedEvents || inputs.pendingTopTies || inputs.courseSnapshot.pending) {
        throw new Error(`尚有 ${inputs.unassignedEvents} 筆業績未完整分配、${inputs.pendingTopTies} 組每日最高同額未決定、${inputs.courseSnapshot.pending} 堂課程狀態未處理`);
      }
      const prepare = await admin.rpc("staff_prepare_daily_settlement_v1", {
        p_tenant_id: tenantId,
        p_branch_id: user.branch_id,
        p_business_date: body.date,
        p_actor_id: user.id,
        p_sales_snapshot: inputs.salesSnapshot,
        p_course_snapshot: inputs.courseSnapshot,
      });
      if (prepare.error) throw new Error(normalizedDatabaseMessage(prepare.error.message));
      if (!actorPermissions.canApprove) await createInAppNotifications({ supabase: admin, tenantId, recipientRoles: ["manager", "branch_manager", "store_owner", "store_manager"], title: `${body.date} 今日結算已送覆核`, message: `副理已完成課程與業績初審；尚有 ${inputs.pendingEvents} 筆業績、${inputs.pendingEpo} 筆 EPO 等待經理覆核。`, eventType: "staff_daily_settlement_review", targetType: "staff_sales_daily_report", targetId: String(prepare.data), actionUrl: `/manager/staff-performance?month=${body.month}&date=${body.date}`, dedupeKey: `staff-settlement-prepare:${prepare.data}:${new Date().toISOString()}`, createdBy: user.id });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_daily_settlement_prepared", targetType: "staff_sales_daily_report", targetId: String(prepare.data), after: { sales: inputs.salesSnapshot, courses: inputs.courseSnapshot } });
    } else if (body.action === "confirm_day") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "confirm_daily_sales_report", message: "只有經理能確認每日業績報表" });
      await syncBigePaymentPerformanceSources(admin, tenantId, body.month, user.id);
      await syncAutomaticEpoForDate({ admin, tenantId, branchId: user.branch_id, businessDate: body.date, actorId: user.id });
      const inputs = await dailySettlementInputs(admin, tenantId, user.branch_id, body.date);
      const missingPurchaseDates = await countLegacyPurchaseDateReminders(admin, tenantId, user.branch_id, body.date);
      if (missingPurchaseDates) throw new Error(`尚有 ${missingPurchaseDates} 份舊合約未輸入購買日，請先完成日報提醒項目`);
      if (inputs.unassignedEvents || inputs.pendingEvents || inputs.pendingEpo || inputs.pendingTopTies || inputs.courseSnapshot.pending) {
        throw new Error(`尚有 ${inputs.unassignedEvents} 筆業績未分配、${inputs.pendingEvents} 筆業績待覆核、${inputs.pendingEpo} 筆 EPO 待覆核、${inputs.pendingTopTies} 組最高同額未決定、${inputs.courseSnapshot.pending} 堂課程狀態未處理`);
      }
      const confirmed = await admin.rpc("staff_confirm_daily_settlement_v1", {
        p_tenant_id: tenantId,
        p_branch_id: user.branch_id,
        p_business_date: body.date,
        p_actor_id: user.id,
        p_sales_snapshot: inputs.salesSnapshot,
        p_course_snapshot: inputs.courseSnapshot,
      });
      if (confirmed.error) throw new Error(normalizedDatabaseMessage(confirmed.error.message));
      const recipientIds = [...new Set([...inputs.allocations.map((row) => String(row.employee_id)), ...inputs.epo.map((row) => String(row.employee_id))].filter(Boolean))];
      const reportId = String(confirmed.data?.reportId || "");
      if (recipientIds.length) await createInAppNotifications({ supabase: admin, tenantId, recipientUserIds: recipientIds, title: `${body.date} 課程、業績與 EPO 已正式結算`, message: "今日結算已由經理確認，個人績效與薪資資料已更新。", eventType: "staff_daily_sales_confirmed", targetType: "staff_sales_daily_report", targetId: reportId, actionUrl: `/staff/performance?month=${body.month}`, dedupeKey: `staff-sales-day-confirmed:${reportId}:${confirmed.data?.confirmedAt}`, createdBy: user.id });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_daily_settlement_confirmed", targetType: "staff_sales_daily_report", targetId: reportId, after: { sales: inputs.salesSnapshot, courses: inputs.courseSnapshot } });
    } else if (body.action === "reopen_day") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "confirm_daily_sales_report", message: "只有經理能重新開啟每日報表" });
      const reason = z.string().trim().min(3).max(1000).parse(body.reason);
      const reopened = await admin.rpc("staff_reopen_daily_settlement_v1", { p_tenant_id: tenantId, p_branch_id: user.branch_id, p_business_date: body.date, p_actor_id: user.id, p_reason: reason });
      if (reopened.error) throw new Error(normalizedDatabaseMessage(reopened.error.message));
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_daily_settlement_reopened", targetType: "staff_sales_daily_report", targetId: String(reopened.data?.reportId || ""), reason });
    } else if (body.action === "create_manual_event") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "approve_sales_performance", message: "只有經理能新增人工業績調整" });
      await ensureDraftDay(admin, tenantId, body.date);
      const values = z.object({ sourceType: z.enum(["fa", "renewal", "final_payment", "manual_adjustment"]), label: z.string().trim().min(2).max(200), amount: z.coerce.number().positive(), employeeId: z.string().uuid() }).parse(body);
      await requireCoachTarget(admin, tenantId, values.employeeId);
      const signedAmount = Math.abs(values.amount);
      const insert = await admin.from("staff_sales_events").insert({ tenant_id: tenantId, branch_id: user.branch_id, business_date: body.date, source_type: values.sourceType, source_key: `manual:${randomUUID()}`, source_table: "manual", source_occurred_at: `${body.date}T12:00:00+08:00`, label: values.label, amount: signedAmount, status: "unassigned", metadata: { manuallyCreated: true } }).select("id").single();
      if (insert.error) throw new Error(insert.error.message);
      const allocation = await admin.rpc("staff_save_sales_allocations_v1", { p_tenant_id: tenantId, p_event_id: insert.data.id, p_actor_id: user.id, p_manager_approved: true, p_allocations: [{ employee_id: values.employeeId, amount: signedAmount }], p_note: "經理人工補登" });
      if (allocation.error) throw new Error(normalizedDatabaseMessage(allocation.error.message));
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_sales_manual_event_created", targetType: "staff_sales_event", targetId: String(insert.data.id), after: { ...values, amount: signedAmount } });
    } else throw new Error("不支援的業績操作");

    return apiSuccess(await state(admin, user, auth.context, body.month, body.date));
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message || "欄位格式錯誤" : error instanceof Error ? normalizedDatabaseMessage(error.message) : "業績操作失敗";
    return apiError(400, "FORBIDDEN", message);
  }
}
