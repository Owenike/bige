import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError, apiSuccess, requireProfile, type ProfileContext } from "../../../lib/auth-context";
import { createInAppNotifications } from "../../../lib/in-app-notifications";
import { hasStaffPermission, requireStaffPermission } from "../../../lib/staff-operation-permissions";
import { performanceMonthRange, resolveCourseFeeTier, taiwanBusinessDate } from "../../../lib/staff-performance";
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

function inRange(value: string | null | undefined, range: ReturnType<typeof performanceMonthRange>) {
  if (!value) return false;
  const date = taiwanBusinessDate(value);
  return date >= range.start && date <= range.end;
}

async function syncPaymentSources(admin: AdminClient, tenantId: string, month: string) {
  const range = performanceMonthRange(month);
  const paymentResult = await admin.from("bige_contract_payments")
    .select("id, contract_id, payment_kind, amount, status, paid_at, voided_at, void_reason, idempotency_key")
    .eq("tenant_id", tenantId)
    .or(`and(paid_at.gte.${range.startIso},paid_at.lt.${range.nextIso}),and(voided_at.gte.${range.startIso},voided_at.lt.${range.nextIso})`)
    .order("paid_at", { ascending: true });
  if (paymentResult.error) throw new Error(paymentResult.error.message);
  const payments = paymentResult.data || [];
  const contractIds = [...new Set(payments.map((row) => String(row.contract_id)))];
  if (!contractIds.length) return;

  const [contractResult, contractPaymentsResult] = await Promise.all([
    admin.from("member_plan_contracts")
      .select("id, branch_id, member_id, contract_number, source_trial_booking_id, converted_from_booking_id")
      .eq("tenant_id", tenantId).in("id", contractIds),
    admin.from("bige_contract_payments")
      .select("id, contract_id, paid_at")
      .eq("tenant_id", tenantId).in("contract_id", contractIds)
      .order("paid_at", { ascending: true }),
  ]);
  if (contractResult.error || contractPaymentsResult.error) {
    throw new Error(contractResult.error?.message || contractPaymentsResult.error?.message || "業績來源讀取失敗");
  }
  const contracts = new Map((contractResult.data || []).map((row) => [String(row.id), row]));
  const memberIds = [...new Set((contractResult.data || []).map((row) => row.member_id ? String(row.member_id) : "").filter(Boolean))];
  const memberResult = memberIds.length
    ? await admin.from("members").select("id, full_name").eq("tenant_id", tenantId).in("id", memberIds)
    : { data: [], error: null };
  if (memberResult.error) throw new Error(memberResult.error.message);
  const members = new Map((memberResult.data || []).map((row) => [String(row.id), String(row.full_name || "會員")]));
  const firstPaymentByContract = new Map<string, string>();
  for (const row of contractPaymentsResult.data || []) {
    const key = String(row.contract_id);
    if (!firstPaymentByContract.has(key)) firstPaymentByContract.set(key, String(row.id));
  }

  const sourceRows: Array<Record<string, unknown>> = [];
  const voidedKeys: string[] = [];
  for (const payment of payments) {
    const contract = contracts.get(String(payment.contract_id));
    if (!contract) continue;
    const memberName = contract.member_id ? members.get(String(contract.member_id)) || "會員" : "會員";
    const isFirstPayment = firstPaymentByContract.get(String(payment.contract_id)) === String(payment.id);
    const sourceType = !isFirstPayment || payment.payment_kind === "balance"
      ? "final_payment"
      : contract.source_trial_booking_id || contract.converted_from_booking_id
        ? "fa"
        : "renewal";

    if (inRange(String(payment.paid_at), range) && payment.status !== "voided") {
      sourceRows.push({
        tenant_id: tenantId,
        branch_id: contract.branch_id || null,
        business_date: taiwanBusinessDate(String(payment.paid_at)),
        source_type: sourceType,
        source_key: `bige-payment:${payment.id}`,
        source_table: "bige_contract_payments",
        source_id: payment.id,
        source_occurred_at: payment.paid_at,
        member_id: contract.member_id || null,
        member_name_snapshot: memberName,
        contract_number: contract.contract_number || null,
        label: `${sourceType === "fa" ? "FA 成交" : sourceType === "renewal" ? "續約" : "繳交尾款"}｜${memberName}`,
        amount: Number(payment.amount),
        metadata: { paymentKind: payment.payment_kind, paymentStatus: payment.status },
      });
    }
    if (payment.status === "voided") voidedKeys.push(`bige-payment:${payment.id}`);
    if (payment.status === "refunded" && inRange(payment.voided_at ? String(payment.voided_at) : null, range)) {
      sourceRows.push({
        tenant_id: tenantId,
        branch_id: contract.branch_id || null,
        business_date: taiwanBusinessDate(String(payment.voided_at)),
        source_type: "refund",
        source_key: `bige-refund:${payment.id}`,
        source_table: "bige_contract_payments",
        source_id: payment.id,
        source_occurred_at: payment.voided_at,
        member_id: contract.member_id || null,
        member_name_snapshot: memberName,
        contract_number: contract.contract_number || null,
        label: `退款扣回｜${memberName}`,
        amount: -Math.abs(Number(payment.amount)),
        metadata: { paymentKind: payment.payment_kind, refundReason: payment.void_reason || null },
      });
    }
  }
  if (sourceRows.length) {
    const upsert = await admin.from("staff_sales_events").upsert(sourceRows, { onConflict: "tenant_id,source_key" });
    if (upsert.error) throw new Error(upsert.error.message);
  }
  if (voidedKeys.length) {
    const ignored = await admin.from("staff_sales_events")
      .update({ status: "ignored", assigned_employee_id: null, review_note: "原付款已作廢" })
      .eq("tenant_id", tenantId).in("source_key", voidedKeys).neq("status", "daily_confirmed");
    if (ignored.error) throw new Error(ignored.error.message);
  }
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
  if (actor.canManage) await syncPaymentSources(admin, tenantId, month);
  const coaches = await coachDirectory(admin, tenantId);
  const coachIds = coaches.map((item) => String(item.id));
  const [eventResult, epoResult, reportResult, bookingResult] = await Promise.all([
    admin.from("staff_sales_events").select("*").eq("tenant_id", tenantId).gte("business_date", range.start).lte("business_date", range.end).order("source_occurred_at", { ascending: false }),
    admin.from("staff_epo_awards").select("*").eq("tenant_id", tenantId).gte("business_date", range.start).lte("business_date", range.end).order("created_at", { ascending: false }),
    admin.from("staff_sales_daily_reports").select("*").eq("tenant_id", tenantId).gte("business_date", range.start).lte("business_date", range.end).order("business_date", { ascending: false }),
    coachIds.length
      ? admin.from("bookings").select("id, coach_id, starts_at, course_type").eq("tenant_id", tenantId).eq("is_bige_schedule", true).eq("operation_kind", "pt").eq("status", "completed").gte("starts_at", range.startIso).lt("starts_at", range.nextIso).in("coach_id", coachIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventResult.error || epoResult.error || reportResult.error || bookingResult.error) {
    throw new Error(eventResult.error?.message || epoResult.error?.message || reportResult.error?.message || bookingResult.error?.message || "業績資料讀取失敗");
  }
  const allEvents = eventResult.data || [];
  const allEpo = epoResult.data || [];
  const bookings = bookingResult.data || [];
  const summaries = coaches.map((coach) => {
    const employeeId = String(coach.id);
    const assigned = allEvents.filter((row) => String(row.assigned_employee_id || "") === employeeId);
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
  const selfOnly = !actor.canManage;
  return {
    actor: { id: user.id, ...actor }, month, selectedDate,
    coaches: selfOnly ? summaries.filter((row) => String(row.id) === user.id) : summaries,
    events: selfOnly ? allEvents.filter((row) => String(row.assigned_employee_id || "") === user.id && row.status === "daily_confirmed") : allEvents,
    epoAwards: selfOnly ? allEpo.filter((row) => String(row.employee_id) === user.id && row.status === "daily_confirmed") : allEpo,
    dailyReports: selfOnly ? [] : reportResult.data || [],
  };
}

async function ensureDraftDay(admin: AdminClient, tenantId: string, date: string) {
  const result = await admin.from("staff_sales_daily_reports").select("id, status")
    .eq("tenant_id", tenantId).eq("business_date", date).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (result.data?.status === "confirmed") throw new Error("此日期已完成每日報表確認；如需修改，請由經理先重新開啟");
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

    if (body.action === "assign_event") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "allocate_sales_performance", message: "您沒有分配業績的權限" });
      await ensureDraftDay(admin, tenantId, body.date);
      const values = z.object({ eventId: z.string().uuid(), employeeId: z.string().uuid() }).parse(body);
      await requireCoachTarget(admin, tenantId, values.employeeId);
      const now = new Date().toISOString();
      const update = await admin.from("staff_sales_events").update({
        assigned_employee_id: values.employeeId, assigned_by: user.id, assigned_at: now,
        status: actorPermissions.canApprove ? "approved" : "pending_manager",
        approved_by: actorPermissions.canApprove ? user.id : null,
        approved_at: actorPermissions.canApprove ? now : null,
        reviewed_by: null, reviewed_at: null, review_note: null,
      }).eq("id", values.eventId).eq("tenant_id", tenantId).eq("business_date", body.date)
        .in("status", ["unassigned", "pending_manager", "approved", "rejected"]).select("id, label, amount").maybeSingle();
      if (update.error || !update.data) throw new Error("找不到可分配的業績，或該日已鎖定");
      if (!actorPermissions.canApprove) await createInAppNotifications({ supabase: admin, tenantId, recipientRoles: ["manager", "branch_manager", "store_owner", "store_manager"], title: `${body.date} 有業績等待覆核`, message: `${update.data.label} 已由副理分配，請經理覆核。`, eventType: "staff_sales_assignment_review", targetType: "staff_sales_event", targetId: values.eventId, actionUrl: `/manager/staff-performance?month=${body.month}&date=${body.date}`, dedupeKey: `staff-sales-review:${values.eventId}:${now}`, createdBy: user.id });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_sales_event_assigned", targetType: "staff_sales_event", targetId: values.eventId, after: { employeeId: values.employeeId, status: actorPermissions.canApprove ? "approved" : "pending_manager" } });
    } else if (body.action === "review_event") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "approve_sales_performance", message: "只有經理能覆核業績" });
      await ensureDraftDay(admin, tenantId, body.date);
      const values = z.object({ eventId: z.string().uuid(), decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() }).parse(body);
      if (values.decision === "reject" && !values.note) throw new Error("駁回時請填寫原因");
      const now = new Date().toISOString();
      const update = await admin.from("staff_sales_events").update({ status: values.decision === "approve" ? "approved" : "rejected", approved_by: values.decision === "approve" ? user.id : null, approved_at: values.decision === "approve" ? now : null, reviewed_by: user.id, reviewed_at: now, review_note: values.note || null }).eq("id", values.eventId).eq("tenant_id", tenantId).eq("business_date", body.date).eq("status", "pending_manager").select("id").maybeSingle();
      if (update.error || !update.data) throw new Error("找不到待覆核業績");
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: `staff_sales_event_${values.decision}d`, targetType: "staff_sales_event", targetId: values.eventId, reason: values.note || null });
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
      const update = await admin.from("staff_epo_awards").update({ status: values.decision === "approve" ? "manager_approved" : "rejected", reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_note: values.note || null }).eq("id", values.epoId).eq("tenant_id", tenantId).eq("business_date", body.date).eq("status", "assistant_proposed").select("id").maybeSingle();
      if (update.error || !update.data) throw new Error("找不到待覆核 EPO");
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: `staff_epo_${values.decision}d`, targetType: "staff_epo_award", targetId: values.epoId, reason: values.note || null });
    } else if (body.action === "confirm_day") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "confirm_daily_sales_report", message: "只有經理能確認每日業績報表" });
      const [events, epo] = await Promise.all([
        admin.from("staff_sales_events").select("id, status, amount, assigned_employee_id").eq("tenant_id", tenantId).eq("business_date", body.date),
        admin.from("staff_epo_awards").select("id, status, quantity, employee_id").eq("tenant_id", tenantId).eq("business_date", body.date),
      ]);
      if (events.error || epo.error) throw new Error(events.error?.message || epo.error?.message || "每日資料讀取失敗");
      const unresolvedEvents = (events.data || []).filter((row) => ["unassigned", "pending_manager"].includes(String(row.status)));
      const unresolvedEpo = (epo.data || []).filter((row) => row.status === "assistant_proposed");
      if (unresolvedEvents.length || unresolvedEpo.length) throw new Error(`尚有 ${unresolvedEvents.length} 筆業績未分配／未覆核、${unresolvedEpo.length} 筆 EPO 未覆核，請先處理完再確認報表`);
      const snapshot = { salesTotal: (events.data || []).filter((row) => ["approved", "daily_confirmed"].includes(String(row.status))).reduce((sum, row) => sum + Number(row.amount), 0), salesCount: (events.data || []).filter((row) => ["approved", "daily_confirmed"].includes(String(row.status))).length, epoTotal: (epo.data || []).filter((row) => ["manager_approved", "daily_confirmed"].includes(String(row.status))).reduce((sum, row) => sum + Number(row.quantity), 0), confirmedAt: new Date().toISOString() };
      const current = await admin.from("staff_sales_daily_reports").select("id").eq("tenant_id", tenantId).eq("business_date", body.date).maybeSingle();
      if (current.error) throw new Error(current.error.message);
      const report = current.data
        ? await admin.from("staff_sales_daily_reports").update({ status: "confirmed", snapshot, confirmed_by: user.id, confirmed_at: snapshot.confirmedAt }).eq("id", current.data.id).select("id").single()
        : await admin.from("staff_sales_daily_reports").insert({ tenant_id: tenantId, branch_id: user.branch_id, business_date: body.date, status: "confirmed", snapshot, confirmed_by: user.id, confirmed_at: snapshot.confirmedAt, created_by: user.id }).select("id").single();
      if (report.error) throw new Error(report.error.message);
      const [eventConfirm, epoConfirm] = await Promise.all([
        admin.from("staff_sales_events").update({ status: "daily_confirmed", daily_report_id: report.data.id }).eq("tenant_id", tenantId).eq("business_date", body.date).eq("status", "approved"),
        admin.from("staff_epo_awards").update({ status: "daily_confirmed", daily_report_id: report.data.id }).eq("tenant_id", tenantId).eq("business_date", body.date).eq("status", "manager_approved"),
      ]);
      if (eventConfirm.error || epoConfirm.error) throw new Error(eventConfirm.error?.message || epoConfirm.error?.message || "每日確認失敗");
      const recipientIds = [...new Set([...(events.data || []).map((row) => row.assigned_employee_id ? String(row.assigned_employee_id) : ""), ...(epo.data || []).map((row) => String(row.employee_id))].filter(Boolean))];
      if (recipientIds.length) await createInAppNotifications({ supabase: admin, tenantId, recipientUserIds: recipientIds, title: `${body.date} 業績與 EPO 已確認`, message: "今日報表已由經理確認，個人績效面板已更新。", eventType: "staff_daily_sales_confirmed", targetType: "staff_sales_daily_report", targetId: String(report.data.id), actionUrl: `/staff/performance?month=${body.month}`, dedupeKey: `staff-sales-day-confirmed:${report.data.id}:${snapshot.confirmedAt}`, createdBy: user.id });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_sales_daily_report_confirmed", targetType: "staff_sales_daily_report", targetId: String(report.data.id), after: snapshot });
    } else if (body.action === "reopen_day") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "confirm_daily_sales_report", message: "只有經理能重新開啟每日報表" });
      const reason = z.string().trim().min(3).max(1000).parse(body.reason);
      const report = await admin.from("staff_sales_daily_reports").update({ status: "reopened", reopened_by: user.id, reopened_at: new Date().toISOString(), reopen_reason: reason }).eq("tenant_id", tenantId).eq("business_date", body.date).eq("status", "confirmed").select("id").maybeSingle();
      if (report.error || !report.data) throw new Error("找不到已確認的每日報表");
      const [events, epo] = await Promise.all([
        admin.from("staff_sales_events").update({ status: "approved", daily_report_id: null }).eq("daily_report_id", report.data.id).eq("status", "daily_confirmed"),
        admin.from("staff_epo_awards").update({ status: "manager_approved", daily_report_id: null }).eq("daily_report_id", report.data.id).eq("status", "daily_confirmed"),
      ]);
      if (events.error || epo.error) throw new Error(events.error?.message || epo.error?.message || "重新開啟失敗");
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_sales_daily_report_reopened", targetType: "staff_sales_daily_report", targetId: String(report.data.id), reason });
    } else if (body.action === "create_manual_event") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "approve_sales_performance", message: "只有經理能新增人工業績調整" });
      await ensureDraftDay(admin, tenantId, body.date);
      const values = z.object({ sourceType: z.enum(["fa", "renewal", "final_payment", "refund", "manual_adjustment"]), label: z.string().trim().min(2).max(200), amount: z.coerce.number().refine((value) => value !== 0), employeeId: z.string().uuid() }).parse(body);
      const signedAmount = values.sourceType === "refund" ? -Math.abs(values.amount) : Math.abs(values.amount);
      const insert = await admin.from("staff_sales_events").insert({ tenant_id: tenantId, branch_id: user.branch_id, business_date: body.date, source_type: values.sourceType, source_key: `manual:${randomUUID()}`, source_table: "manual", source_occurred_at: `${body.date}T12:00:00+08:00`, label: values.label, amount: signedAmount, status: "approved", assigned_employee_id: values.employeeId, assigned_by: user.id, assigned_at: new Date().toISOString(), approved_by: user.id, approved_at: new Date().toISOString(), metadata: { manuallyCreated: true } }).select("id").single();
      if (insert.error) throw new Error(insert.error.message);
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_sales_manual_event_created", targetType: "staff_sales_event", targetId: String(insert.data.id), after: { ...values, amount: signedAmount } });
    } else throw new Error("不支援的業績操作");

    return apiSuccess(await state(admin, user, auth.context, body.month, body.date));
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message || "欄位格式錯誤" : error instanceof Error ? error.message : "業績操作失敗";
    return apiError(400, "FORBIDDEN", message);
  }
}
