import { createHash } from "node:crypto";
import { z } from "zod";
import {
  apiError,
  apiSuccess,
  requireProfile,
  type ProfileContext,
} from "../../../lib/auth-context";
import { createInAppNotifications } from "../../../lib/in-app-notifications";
import { hasStaffPermission, requireStaffPermission } from "../../../lib/staff-operation-permissions";
import { writeStaffAudit } from "../../../lib/staff-audit";
import { paidMinutesForEntry } from "../../../lib/staff-scheduling";
import {
  calculateEmployeePayroll,
  calculateStatutoryDeductions,
  nextMonthPayDates,
  regularMinutesFromPunches,
  type PayrollLeave,
  type PayrollOvertime,
} from "../../../lib/staff-payroll";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { resolveCourseFeeTier } from "../../../lib/staff-performance";
import { syncBigePaymentPerformanceSources } from "../../../lib/staff-performance-sync";

export const runtime = "nodejs";
const STAFF_ROLES = [
  "platform_admin",
  "manager",
  "supervisor",
  "branch_manager",
  "store_owner",
  "store_manager",
  "frontdesk",
  "coach",
  "therapist",
  "sales",
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

function decodeSignature(dataUrl: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("簽名圖片格式不支援");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024)
    throw new Error("簽名圖片大小不正確");
  return {
    buffer,
    extension: match[1] === "jpeg" ? "jpg" : match[1],
    mimeType: `image/${match[1]}`,
  };
}
function range(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月份格式錯誤");
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    monthStart: `${month}-01`,
    start: `${month}-01`,
    end: `${month}-${String(end).padStart(2, "0")}`,
  };
}
function taiwanDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
async function profile(admin: AdminClient, id: string) {
  const result = await admin
    .from("profiles")
    .select(
      "id, tenant_id, branch_id, display_name, english_name, employee_number, position, role",
    )
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("找不到員工帳號");
  return result.data as ProfileRow;
}

async function getPeriod(
  admin: AdminClient,
  tenantId: string,
  branchId: string | null,
  monthStart: string,
) {
  let query = admin
    .from("staff_payroll_periods")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("month_start", monthStart);
  query = branchId
    ? query.eq("branch_id", branchId)
    : query.is("branch_id", null);
  const result = await query.maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function ensurePayrollPeriod(admin: AdminClient, tenantId: string, branchId: string | null, monthStart: string, actorId: string) {
  const existing = await getPeriod(admin, tenantId, branchId, monthStart);
  if (existing) return existing;
  const dates = nextMonthPayDates(monthStart);
  const inserted = await admin.from("staff_payroll_periods").insert({
    tenant_id: tenantId,
    branch_id: branchId,
    month_start: monthStart,
    base_pay_date: dates.basePayDate,
    bonus_pay_date: dates.bonusPayDate,
    created_by: actorId,
  }).select("*").single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data;
}

async function state(
  admin: AdminClient,
  user: ProfileRow,
  context: ProfileContext,
  month: string,
) {
  const tenantId = user.tenant_id;
  if (!tenantId) throw new Error("帳號尚未設定館別");
  const dateRange = range(month);
  const [manager, canClosePayroll, canCalculate, canManageInsurance] = await Promise.all([
    hasStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context, permission: "view_team_salary" }),
    hasStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context, permission: "close_payroll" }),
    hasStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context, permission: "calculate_payroll" }),
    hasStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context, permission: "manage_insurance" }),
  ]);
  const period = await getPeriod(
    admin,
    tenantId,
    user.branch_id,
    dateRange.monthStart,
  );
  const employeeResult = manager
    ? await admin.from("profiles").select("id, display_name, english_name, employee_number").eq("tenant_id", tenantId).eq("is_active", true).is("staff_deleted_at", null).not("role", "in", '("member","customer")').order("employee_number", { ascending: true, nullsFirst: false })
    : await admin.from("profiles").select("id, display_name, english_name, employee_number").eq("id", user.id);
  if (employeeResult.error) throw new Error(employeeResult.error.message);
  const allEmployeeIds = (employeeResult.data || []).map((item) => String(item.id));
  const [insuranceResult, rateResult, bonusResult] = manager
    ? await Promise.all([
        allEmployeeIds.length ? admin.from("staff_insurance_enrollments").select("*").in("employee_id", allEmployeeIds).order("insurance_type") : Promise.resolve({ data: [], error: null }),
        admin.from("staff_statutory_rate_versions").select("*").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).lte("effective_from", dateRange.end).or(`effective_to.is.null,effective_to.gte.${dateRange.start}`).order("effective_from", { ascending: false }),
        period ? admin.from("staff_payroll_bonus_entries").select("*").eq("payroll_period_id", period.id).order("created_at") : Promise.resolve({ data: [], error: null }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (insuranceResult.error || rateResult.error || bonusResult.error) throw new Error(insuranceResult.error?.message || rateResult.error?.message || bonusResult.error?.message || "薪資設定讀取失敗");
  const actor = { id: user.id, canManage: manager, canClose: canClosePayroll, canCalculate, canManageInsurance };
  if (!period) return { actor, month, period: null, employees: employeeResult.data || [], statements: [], corrections: [], insuranceEnrollments: insuranceResult.data || [], rateVersions: rateResult.data || [], bonusEntries: [] };
  let statementQuery = admin
    .from("staff_payroll_statements")
    .select("*")
    .eq("payroll_period_id", period.id)
    .order("created_at");
  if (!manager) statementQuery = statementQuery.eq("employee_id", user.id);
  const statementsResult = await statementQuery;
  if (statementsResult.error) throw new Error(statementsResult.error.message);
  const statements = statementsResult.data || [];
  const statementIds = statements.map((item) => String(item.id));
  const correctionPromise = manager
    ? admin
        .from("staff_payroll_corrections")
        .select("*")
        .eq("payroll_period_id", period.id)
        .order("created_at")
    : admin
        .from("staff_payroll_corrections")
        .select("*")
        .eq("payroll_period_id", period.id)
        .eq("employee_id", user.id)
        .order("created_at");
  const [lineResult, ackResult, correctionResult] =
    await Promise.all([
      statementIds.length
        ? admin
            .from("staff_payroll_line_items")
            .select("*")
            .in("statement_id", statementIds)
            .order("created_at")
        : Promise.resolve({ data: [], error: null }),
      statementIds.length
        ? admin
            .from("staff_payroll_acknowledgements")
            .select("*")
            .in("statement_id", statementIds)
        : Promise.resolve({ data: [], error: null }),
      correctionPromise,
    ]);
  if (
    lineResult.error ||
    ackResult.error ||
    correctionResult.error
  )
    throw new Error(
      lineResult.error?.message ||
        ackResult.error?.message ||
        correctionResult.error?.message ||
        "讀取薪資失敗",
    );
  return {
    actor,
    month,
    period,
    employees: employeeResult.data || [],
    statements: statements.map((item) => ({
      ...item,
      lineItems: (lineResult.data || []).filter(
        (line) => line.statement_id === item.id,
      ),
      acknowledgement:
        (ackResult.data || []).find((ack) => ack.statement_id === item.id) ||
        null,
    })),
    corrections: correctionResult.data || [],
    insuranceEnrollments: insuranceResult.data || [],
    rateVersions: rateResult.data || [],
    bonusEntries: bonusResult.data || [],
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const month =
      url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    range(month);
    const admin = createSupabaseAdminClient();
    const user = await profile(admin, auth.context.userId);
    return apiSuccess(await state(admin, user, auth.context, month));
  } catch (error) {
    return apiError(
      400,
      "FORBIDDEN",
      error instanceof Error ? error.message : "無法讀取薪資",
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  try {
    const user = await profile(admin, auth.context.userId);
    const tenantId = user.tenant_id;
    if (!tenantId) throw new Error("帳號尚未設定館別");
    const body = z
      .object({ action: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/) })
      .passthrough()
      .parse(await request.json());
    const dateRange = range(body.month);
    if (body.action === "configure_insurance") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "manage_insurance", message: "您沒有設定勞健保的權限" });
      const values = z.object({
        employeeId: z.string().uuid(),
        laborSalary: z.coerce.number().positive(),
        healthSalary: z.coerce.number().positive(),
        pensionSalary: z.coerce.number().positive(),
        dependents: z.coerce.number().int().min(0).max(20),
        voluntaryPensionRate: z.coerce.number().min(0).max(0.06),
        enrolledFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reason: z.string().trim().min(3).max(1000),
      }).parse(body);
      const target = await admin.from("profiles").select("id").eq("id", values.employeeId).eq("tenant_id", tenantId).maybeSingle();
      if (target.error || !target.data) throw new Error("找不到同一館別的員工");
      const rows = [
        { insurance_type: "labor", insured_salary: values.laborSalary, employee_dependents: 0, voluntary_pension_rate: 0 },
        { insurance_type: "health", insured_salary: values.healthSalary, employee_dependents: values.dependents, voluntary_pension_rate: 0 },
        { insurance_type: "pension", insured_salary: values.pensionSalary, employee_dependents: 0, voluntary_pension_rate: values.voluntaryPensionRate },
      ].map((row) => ({ tenant_id: tenantId, employee_id: values.employeeId, status: "active", enrolled_from: values.enrolledFrom, provided_by_company: true, employer_pension_rate: 0.06, change_reason: values.reason, configured_by: user.id, ...row }));
      const upsert = await admin.from("staff_insurance_enrollments").upsert(rows, { onConflict: "employee_id,insurance_type" });
      if (upsert.error) throw new Error(upsert.error.message);
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_insurance_configured", targetType: "profile", targetId: values.employeeId, reason: values.reason, after: { laborSalary: values.laborSalary, healthSalary: values.healthSalary, pensionSalary: values.pensionSalary, dependents: values.dependents, voluntaryPensionRate: values.voluntaryPensionRate, enrolledFrom: values.enrolledFrom } });
    } else if (body.action === "configure_rate") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "manage_insurance", message: "您沒有設定法定費率的權限" });
      const values = z.object({ rateType: z.enum(["labor_insurance", "health_insurance"]), employeeRate: z.coerce.number().min(0).max(1), maxDependents: z.coerce.number().int().min(0).max(20).optional(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sourceLabel: z.string().trim().min(2).max(500) }).parse(body);
      const configuration = { employeeRate: values.employeeRate, ...(values.rateType === "health_insurance" ? { maxDependents: values.maxDependents ?? 3 } : {}) };
      const existingRate = await admin.from("staff_statutory_rate_versions").select("id").eq("tenant_id", tenantId).eq("rate_type", values.rateType).eq("effective_from", values.effectiveFrom).maybeSingle();
      if (existingRate.error) throw new Error(existingRate.error.message);
      const savedRate = existingRate.data
        ? await admin.from("staff_statutory_rate_versions").update({ configuration, source_label: values.sourceLabel, created_by: user.id }).eq("id", existingRate.data.id)
        : await admin.from("staff_statutory_rate_versions").insert({ tenant_id: tenantId, rate_type: values.rateType, effective_from: values.effectiveFrom, configuration, source_label: values.sourceLabel, created_by: user.id });
      if (savedRate.error) throw new Error(savedRate.error.message);
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_statutory_rate_configured", targetType: "staff_statutory_rate_version", reason: values.sourceLabel, after: { rateType: values.rateType, effectiveFrom: values.effectiveFrom, configuration } });
    } else if (body.action === "add_bonus") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "calculate_payroll", message: "您沒有新增薪資獎金的權限" });
      const values = z.object({ employeeId: z.string().uuid(), bonusType: z.enum(["course_fee", "performance", "allowance", "other"]), label: z.string().trim().min(2).max(200), quantity: z.coerce.number().nonnegative().nullable().optional(), rate: z.coerce.number().nonnegative().nullable().optional(), amount: z.coerce.number().nonnegative(), sourceNote: z.string().trim().max(1000).optional() }).parse(body);
      if (values.bonusType === "course_fee") throw new Error("課費已由已確認業績與完課堂數自動計算，不可再人工重複加入");
      const period = await ensurePayrollPeriod(admin, tenantId, user.branch_id, dateRange.monthStart, user.id);
      const target = await admin.from("profiles").select("id").eq("id", values.employeeId).eq("tenant_id", tenantId).maybeSingle();
      if (target.error || !target.data) throw new Error("找不到同一館別的員工");
      const insert = await admin.from("staff_payroll_bonus_entries").insert({ payroll_period_id: period.id, tenant_id: tenantId, employee_id: values.employeeId, bonus_type: values.bonusType, label: values.label, quantity: values.quantity ?? null, rate: values.rate ?? null, amount: values.amount, source_note: values.sourceNote || null, status: "approved", approved_by: user.id, approved_at: new Date().toISOString(), created_by: user.id }).select("id").single();
      if (insert.error) throw new Error(insert.error.message);
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_payroll_bonus_added", targetType: "staff_payroll_bonus_entry", targetId: insert.data.id, reason: values.sourceNote || null, after: values });
    } else if (body.action === "cancel_bonus") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "calculate_payroll", message: "您沒有取消薪資獎金的權限" });
      const bonusId = z.string().uuid().parse(body.bonusId);
      const reason = z.string().trim().min(3).max(1000).parse(body.reason);
      const update = await admin.from("staff_payroll_bonus_entries").update({ status: "cancelled", source_note: reason }).eq("id", bonusId).eq("tenant_id", tenantId).select("id").maybeSingle();
      if (update.error || !update.data) throw new Error("找不到獎金項目");
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_payroll_bonus_cancelled", targetType: "staff_payroll_bonus_entry", targetId: bonusId, reason });
    } else if (body.action === "generate") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "calculate_payroll", message: "您沒有產生薪資試算的權限" });
      let payrollPeriod = await getPeriod(
        admin,
        tenantId,
        user.branch_id,
        dateRange.monthStart,
      );
      if (!payrollPeriod) {
        const dates = nextMonthPayDates(dateRange.monthStart);
        const inserted = await admin
          .from("staff_payroll_periods")
          .insert({
            tenant_id: tenantId,
            branch_id: user.branch_id,
            month_start: dateRange.monthStart,
            base_pay_date: dates.basePayDate,
            bonus_pay_date: dates.bonusPayDate,
            created_by: user.id,
          })
          .select("*")
          .single();
        if (inserted.error) throw new Error(inserted.error.message);
        payrollPeriod = inserted.data;
      }
      const employeesResult = await admin
        .from("profiles")
        .select("id, display_name, english_name, employee_number")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("staff_deleted_at", null)
        .not("role", "in", '("member","customer")');
      if (employeesResult.error) throw new Error(employeesResult.error.message);
      const employees = employeesResult.data || [];
      const ids = employees.map((item) => item.id);
      await syncBigePaymentPerformanceSources(admin, tenantId, body.month);
      const [
        termsResult,
        scheduleResult,
        leaveResult,
        anomalyResult,
        insuranceResult,
        dailyResult,
        holidayResult,
        rateResult,
        bonusResult,
        performanceResult,
        performancePendingResult,
        epoPendingResult,
        completedSessionsResult,
      ] = await Promise.all([
        admin
          .from("staff_employment_profiles")
          .select("*")
          .in("employee_id", ids),
        admin
          .from("staff_schedule_entries")
          .select("*, staff_schedule_versions!inner(status)")
          .eq("tenant_id", tenantId)
          .eq("staff_schedule_versions.status", "published")
          .gte("work_date", dateRange.start)
          .lte("work_date", dateRange.end),
        admin
          .from("staff_leave_requests")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("status", "approved")
          .gte("starts_at", `${dateRange.start}T00:00:00+08:00`)
          .lte("starts_at", `${dateRange.end}T23:59:59+08:00`),
        admin
          .from("staff_attendance_anomalies")
          .select("*")
          .eq("tenant_id", tenantId)
          .gte("work_date", dateRange.start)
          .lte("work_date", dateRange.end),
        admin
          .from("staff_insurance_enrollments")
          .select("employee_id, insurance_type, status, insured_salary, employee_dependents, voluntary_pension_rate, enrolled_from, enrolled_to, provided_by_company")
          .in("employee_id", ids),
        admin.from("staff_attendance_daily_rows").select("employee_id, work_date, first_punch_at, last_punch_at, punch_times, created_at").eq("tenant_id", tenantId).in("employee_id", ids).gte("work_date", dateRange.start).lte("work_date", dateRange.end).order("created_at", { ascending: false }),
        admin.from("staff_holiday_calendar").select("holiday_date").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).gte("holiday_date", dateRange.start).lte("holiday_date", dateRange.end),
        admin.from("staff_statutory_rate_versions").select("rate_type, configuration, effective_from").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).lte("effective_from", dateRange.end).or(`effective_to.is.null,effective_to.gte.${dateRange.start}`).order("effective_from", { ascending: false }),
        admin.from("staff_payroll_bonus_entries").select("*").eq("payroll_period_id", payrollPeriod.id).eq("status", "approved"),
        admin.from("staff_sales_events").select("employee_id:assigned_employee_id, amount").eq("tenant_id", tenantId).eq("status", "daily_confirmed").gte("business_date", dateRange.start).lte("business_date", dateRange.end).in("assigned_employee_id", ids),
        admin.from("staff_sales_events").select("id", { count: "exact" }).eq("tenant_id", tenantId).gte("business_date", dateRange.start).lte("business_date", dateRange.end).in("status", ["unassigned", "pending_manager", "approved"]),
        admin.from("staff_epo_awards").select("id", { count: "exact" }).eq("tenant_id", tenantId).gte("business_date", dateRange.start).lte("business_date", dateRange.end).in("status", ["assistant_proposed", "manager_approved"]),
        admin.from("bookings").select("id, coach_id").eq("tenant_id", tenantId).eq("is_bige_schedule", true).eq("operation_kind", "pt").eq("status", "completed").gte("starts_at", `${dateRange.start}T00:00:00+08:00`).lt("starts_at", `${dateRange.end}T23:59:59.999+08:00`).in("coach_id", ids),
      ]);
      if (
        termsResult.error ||
        scheduleResult.error ||
        leaveResult.error ||
        anomalyResult.error ||
        insuranceResult.error ||
        dailyResult.error ||
        holidayResult.error ||
        rateResult.error ||
        bonusResult.error
        || performanceResult.error
        || performancePendingResult.error
        || epoPendingResult.error
        || completedSessionsResult.error
      )
        throw new Error(
          termsResult.error?.message ||
            scheduleResult.error?.message ||
            leaveResult.error?.message ||
            anomalyResult.error?.message ||
            insuranceResult.error?.message ||
            dailyResult.error?.message ||
            holidayResult.error?.message ||
            rateResult.error?.message ||
            bonusResult.error?.message ||
            performanceResult.error?.message ||
            performancePendingResult.error?.message ||
            epoPendingResult.error?.message ||
            completedSessionsResult.error?.message ||
            "薪資資料讀取失敗",
        );
      const dailyMap = new Map<string, (typeof dailyResult.data)[number]>();
      for (const row of dailyResult.data || []) {
        const key = `${row.employee_id}:${row.work_date}`;
        if (!dailyMap.has(key)) dailyMap.set(key, row);
      }
      const holidayDates = new Set((holidayResult.data || []).map((row) => String(row.holiday_date)));
      const rateMap = new Map<string, (typeof rateResult.data)[number]>();
      for (const row of rateResult.data || []) if (!rateMap.has(String(row.rate_type))) rateMap.set(String(row.rate_type), row);
      let unresolvedTotal = Number(performancePendingResult.count || 0) + Number(epoPendingResult.count || 0);
      let insuranceIncomplete = 0;
      for (const employee of employees) {
        const terms = (termsResult.data || []).find(
          (item) => item.employee_id === employee.id,
        );
        if (!terms) continue;
        const scheduled = (scheduleResult.data || []).filter(
          (item) =>
            item.employee_id === employee.id && item.entry_kind === "work",
        );
        const employeeLeaves = (leaveResult.data || []).filter((item) => item.employee_id === employee.id);
        const fullDayLeaveDates = new Set(employeeLeaves.filter((item) => item.unit === "full_day").map((item) => taiwanDate(String(item.starts_at))));
        let punchBackedDays = 0;
        let fallbackDays = 0;
        const regularMinutes = scheduled.reduce((sum, item) => {
          const workDate = String(item.work_date);
          if (fullDayLeaveDates.has(workDate)) return sum;
          const scheduledMinutes = paidMinutesForEntry({
            entryKind: item.entry_kind,
            startsAt: item.starts_at ? String(item.starts_at).slice(0, 5) : null,
            endsAt: item.ends_at ? String(item.ends_at).slice(0, 5) : null,
            breakMinutes: Number(item.break_minutes || 0),
            paidBreak: Boolean(item.paid_break),
          });
          const daily = dailyMap.get(`${employee.id}:${workDate}`);
          const actualMinutes = item.starts_at && item.ends_at ? regularMinutesFromPunches({
            workDate,
            scheduledStartsAt: String(item.starts_at).slice(0, 5),
            scheduledEndsAt: String(item.ends_at).slice(0, 5),
            firstPunchAt: daily?.first_punch_at ? String(daily.first_punch_at) : null,
            lastPunchAt: daily?.last_punch_at ? String(daily.last_punch_at) : null,
            breakMinutes: Number(item.break_minutes || 0),
            paidBreak: Boolean(item.paid_break),
            crossesMidnight: Boolean(item.crosses_midnight),
          }) : null;
          if (actualMinutes === null) {
            fallbackDays += 1;
            return sum + scheduledMinutes;
          }
          punchBackedDays += 1;
          return sum + actualMinutes;
        }, 0);
        const leaves: PayrollLeave[] = employeeLeaves
          .map((item) => ({
            leaveType: item.leave_type,
            minutes: Number(item.duration_minutes),
          }));
        const anomalies = (anomalyResult.data || []).filter(
          (item) => item.employee_id === employee.id,
        );
        const unresolved = anomalies.filter(
          (item) => !["resolved", "dismissed"].includes(item.status),
        ).length;
        unresolvedTotal += unresolved;
        const overtime: PayrollOvertime[] = anomalies
          .filter(
            (item) =>
              item.status === "resolved" &&
              item.resolution === "worked_overtime" &&
              Number(item.resolution_minutes) > 0,
          )
          .map((item) => {
            const schedule = (scheduleResult.data || []).find((entry) => entry.employee_id === employee.id && entry.work_date === item.work_date);
            const dayType: PayrollOvertime["dayType"] = holidayDates.has(String(item.work_date))
              ? "national_holiday"
              : schedule?.off_kind === "rest_day" || schedule?.entry_kind === "off"
                ? "rest_day"
                : "regular_workday";
            return { minutes: Number(item.resolution_minutes), dayType };
          });
        const insurance = (insuranceResult.data || []).filter(
          (item) => item.employee_id === employee.id,
        );
        const statutory = calculateStatutoryDeductions({
          enrollments: insurance.map((item) => ({
            insuranceType: item.insurance_type,
            status: String(item.status),
            insuredSalary: Number(item.insured_salary || 0),
            dependents: Number(item.employee_dependents || 0),
            voluntaryPensionRate: Number(item.voluntary_pension_rate || 0),
          })),
          rates: Array.from(rateMap.values()).filter((item) => ["labor_insurance", "health_insurance", "pension"].includes(String(item.rate_type))).map((item) => ({ rateType: item.rate_type, configuration: item.configuration })),
        });
        if (!statutory.ready) insuranceIncomplete += 1;
        const employeeBonuses = (bonusResult.data || []).filter((item) => item.employee_id === employee.id && item.bonus_type !== "course_fee");
        const salesAmount = (performanceResult.data || []).filter((item) => item.employee_id === employee.id).reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const completedSessions = (completedSessionsResult.data || []).filter((item) => item.coach_id === employee.id).length;
        const courseFee = resolveCourseFeeTier({ employmentType: terms.employment_type === "part_time" ? "part_time" : "full_time", salesAmount, completedSessions });
        const otherBonusTotal = employeeBonuses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const bonusTotal = otherBonusTotal + courseFee.courseFeeAmount;
        const calculation = calculateEmployeePayroll({
          employment: {
            employeeId: employee.id,
            employmentType: terms.employment_type,
            payBasis: terms.pay_basis,
            monthlySalary: Number(terms.monthly_salary),
            hourlyRate: Number(terms.hourly_rate),
          },
          regularMinutes,
          leaves,
          overtime,
        });
        const grossPay = calculation.basePay + calculation.paidLeavePay + calculation.overtimePay + bonusTotal;
        const deductionTotal = calculation.leaveDeduction + statutory.total;
        const netPay = grossPay - deductionTotal;
        const statement = await admin
          .from("staff_payroll_statements")
          .upsert(
            {
              payroll_period_id: payrollPeriod.id,
              tenant_id: tenantId,
              employee_id: employee.id,
              employment_snapshot: {
                employmentType: terms.employment_type,
                payBasis: terms.pay_basis,
                monthlySalary: Number(terms.monthly_salary),
                hourlyRate: Number(terms.hourly_rate),
              },
              attendance_snapshot: {
                unresolvedCount: unresolved,
                insuranceReady: statutory.ready,
                insuranceWarnings: statutory.warnings,
                bonusRulesComplete: true,
                courseFee: {
                  formulaVersion: courseFee.formulaVersion,
                  salesAmount: courseFee.salesAmount,
                  completedSessions: courseFee.completedSessions,
                  sessionRate: courseFee.sessionRate,
                  amount: courseFee.courseFeeAmount,
                },
                punchBackedDays,
                fallbackScheduledDays: fallbackDays,
                regularMinutesSource: "actual_punches_clamped_to_scheduled_shift_with_fallback",
              },
              regular_minutes: calculation.regularMinutes,
              overtime_minutes: calculation.overtimeMinutes,
              base_pay: calculation.basePay,
              overtime_pay: calculation.overtimePay,
              leave_deduction: calculation.leaveDeduction,
              labor_insurance_employee: statutory.laborInsuranceEmployee,
              health_insurance_employee: statutory.healthInsuranceEmployee,
              pension_employee: statutory.pensionEmployee,
              bonus_total: bonusTotal,
              gross_pay: grossPay,
              deduction_total: deductionTotal,
              net_pay: netPay,
              status: "draft",
            },
            { onConflict: "payroll_period_id,employee_id" },
          )
          .select("id")
          .single();
        if (statement.error) throw new Error(statement.error.message);
        await admin
          .from("staff_payroll_line_items")
          .delete()
          .eq("statement_id", statement.data.id);
        const lines = [
          ...calculation.lineItems.map((item) => ({
          statement_id: statement.data.id,
          tenant_id: tenantId,
          item_type: item.itemType,
          code: item.code,
          label: item.label,
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
          details: item.details || {},
          })),
          ...employeeBonuses.map((item) => ({
            statement_id: statement.data.id,
            tenant_id: tenantId,
            item_type: "bonus",
            code: `bonus_${item.bonus_type}`,
            label: String(item.label),
            quantity: item.quantity,
            rate: item.rate,
            amount: Number(item.amount),
            source_type: "staff_payroll_bonus_entry",
            source_id: item.id,
            details: { sourceNote: item.source_note || null },
          })),
          ...(courseFee.completedSessions > 0 ? [{
            statement_id: statement.data.id,
            tenant_id: tenantId,
            item_type: "bonus",
            code: "course_fee_auto",
            label: "課費獎金（自動計算）",
            quantity: courseFee.completedSessions,
            rate: courseFee.sessionRate,
            amount: courseFee.courseFeeAmount,
            source_type: "staff_sales_daily_reports",
            details: {
              formulaVersion: courseFee.formulaVersion,
              confirmedSales: courseFee.salesAmount,
              employmentType: terms.employment_type,
              achievedTier: courseFee.achievedTier,
            },
          }] : []),
          ...[
            ["labor_insurance", "勞保員工負擔", statutory.laborInsuranceEmployee],
            ["health_insurance", "健保員工負擔", statutory.healthInsuranceEmployee],
            ["voluntary_pension", "勞退自願提繳", statutory.pensionEmployee],
          ].filter((item) => Number(item[2]) > 0).map((item) => ({
            statement_id: statement.data.id,
            tenant_id: tenantId,
            item_type: "insurance",
            code: String(item[0]),
            label: String(item[1]),
            quantity: null,
            rate: null,
            amount: Number(item[2]),
            details: {},
          })),
        ];
        if (lines.length) {
          const lineInsert = await admin
            .from("staff_payroll_line_items")
            .insert(lines);
          if (lineInsert.error) throw new Error(lineInsert.error.message);
        }
      }
      await admin
        .from("staff_payroll_periods")
        .update({
          status: "manager_review",
          unresolved_warning_count: unresolvedTotal,
          insurance_incomplete_count: insuranceIncomplete,
        })
        .eq("id", payrollPeriod.id);
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_payroll_generated", targetType: "staff_payroll_period", targetId: payrollPeriod.id, after: { month: body.month, employeeCount: employees.length, unresolvedWarningCount: unresolvedTotal, insuranceIncompleteCount: insuranceIncomplete } });
    } else if (body.action === "close") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "close_payroll", message: "您沒有薪資關帳權限" });
      const period = await getPeriod(
        admin,
        tenantId,
        user.branch_id,
        dateRange.monthStart,
      );
      if (!period) throw new Error("請先產生薪資試算");
      const reason =
        z.string().trim().max(2000).optional().parse(body.reason) || "";
      if (
        (Number(period.unresolved_warning_count) > 0 ||
          Number(period.insurance_incomplete_count) > 0) &&
        !reason
      )
        throw new Error(
          "仍有未確認出勤、業績／EPO 或勞健保待補，經理必須填寫理由才能先關帳",
        );
      const update = await admin
        .from("staff_payroll_periods")
        .update({
          status: "closed",
          closed_by: user.id,
          closed_at: new Date().toISOString(),
          close_reason: reason || null,
        })
        .eq("id", period.id);
      if (update.error) throw new Error(update.error.message);
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_payroll_closed", targetType: "staff_payroll_period", targetId: period.id, reason: reason || null, before: { status: period.status, unresolvedWarningCount: period.unresolved_warning_count, insuranceIncompleteCount: period.insurance_incomplete_count }, after: { status: "closed" } });
    } else if (body.action === "issue") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "close_payroll", message: "您沒有發出薪資單的權限" });
      const period = await getPeriod(
        admin,
        tenantId,
        user.branch_id,
        dateRange.monthStart,
      );
      if (!period || period.status !== "closed")
        throw new Error("薪資必須先關帳");
      const statements = await admin
        .from("staff_payroll_statements")
        .update({ status: "issued", issued_at: new Date().toISOString() })
        .eq("payroll_period_id", period.id)
        .select("id, employee_id");
      if (statements.error) throw new Error(statements.error.message);
      await createInAppNotifications({
        supabase: admin,
        tenantId,
        recipientUserIds: (statements.data || []).map((item) =>
          String(item.employee_id),
        ),
        title: `${body.month} 薪資單已發出`,
        message:
          "請查看自己的薪資明細；一般薪資單只需點選已閱讀，有爭議時再提出說明。",
        eventType: "staff_payslip_issued",
        targetType: "staff_payroll_period",
        targetId: period.id,
        actionUrl: `/staff/payroll?month=${body.month}`,
        dedupeKey: `staff-payslip:${period.id}`,
        createdBy: user.id,
      });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_payslips_issued", targetType: "staff_payroll_period", targetId: period.id, after: { statementIds: (statements.data || []).map((item) => item.id), recipientCount: (statements.data || []).length } });
    } else if (body.action === "acknowledge") {
      const statementId = z.string().uuid().parse(body.statementId);
      const action = z
        .enum(["read", "disputed"])
        .parse(body.acknowledgementAction);
      const disputeReason =
        z.string().trim().max(2000).optional().parse(body.disputeReason) || "";
      if (action === "disputed" && !disputeReason)
        throw new Error("提出薪資爭議時必須填寫原因");
      const statement = await admin
        .from("staff_payroll_statements")
        .select("id")
        .eq("id", statementId)
        .eq("employee_id", user.id)
        .maybeSingle();
      if (statement.error || !statement.data)
        throw new Error("找不到您的薪資單");
      const ack = await admin
        .from("staff_payroll_acknowledgements")
        .upsert(
          {
            statement_id: statementId,
            tenant_id: tenantId,
            employee_id: user.id,
            action,
            dispute_reason: disputeReason || null,
            acted_at: new Date().toISOString(),
          },
          { onConflict: "statement_id,employee_id" },
        );
      if (ack.error) throw new Error(ack.error.message);
      if (action === "disputed")
        await admin
          .from("staff_payroll_statements")
          .update({ status: "disputed" })
          .eq("id", statementId);
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: action === "read" ? "staff_payslip_read" : "staff_payslip_disputed", targetType: "staff_payroll_statement", targetId: statementId, reason: disputeReason || null, after: { acknowledgementAction: action } });
    } else if (body.action === "sign_correction") {
      const correctionId = z.string().uuid().parse(body.correctionId);
      if (body.checkboxConfirmed !== true)
        throw new Error("請先確認已閱讀薪資更正內容");
      const correction = await admin
        .from("staff_payroll_corrections")
        .select("id, status, reason, difference_amount")
        .eq("id", correctionId)
        .eq("tenant_id", tenantId)
        .eq("employee_id", user.id)
        .maybeSingle();
      if (correction.error || !correction.data)
        throw new Error("找不到您的薪資更正單");
      if (correction.data.status !== "manager_approved")
        throw new Error("這份薪資更正單目前不需要簽名");
      const signature = decodeSignature(
        z.string().max(8_000_000).parse(body.signatureDataUrl),
      );
      const sha256 = createHash("sha256")
        .update(signature.buffer)
        .digest("hex");
      const objectPath = `${tenantId}/${user.id}/payroll-correction-${correctionId}-${Date.now()}.${signature.extension}`;
      const upload = await admin.storage
        .from("staff-signatures")
        .upload(objectPath, signature.buffer, {
          contentType: signature.mimeType,
          upsert: false,
        });
      if (upload.error) throw new Error(upload.error.message);
      const signed = await admin
        .from("staff_payroll_corrections")
        .update({
          status: "employee_signed",
          signature_object_path: objectPath,
          signature_sha256: sha256,
          employee_signed_at: new Date().toISOString(),
        })
        .eq("id", correctionId)
        .eq("status", "manager_approved")
        .select("id")
        .single();
      if (signed.error) throw new Error(signed.error.message);
      await createInAppNotifications({
        supabase: admin,
        tenantId,
        recipientRoles: ["manager", "supervisor"],
        title: "員工已簽署薪資更正單",
        message: `${user.display_name || user.employee_number || "員工"}已確認並簽署薪資更正單，請安排後續差額處理。`,
        eventType: "staff_payroll_correction_signed",
        targetType: "staff_payroll_correction",
        targetId: correctionId,
        actionUrl: `/manager/staff-payroll?month=${body.month}`,
        dedupeKey: `staff-payroll-correction-signed:${correctionId}`,
        createdBy: user.id,
      });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_payroll_correction_signed", targetType: "staff_payroll_correction", targetId: correctionId, after: { signatureSha256: sha256 } });
    } else if (body.action === "create_correction") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "close_payroll", message: "您沒有建立薪資更正單的權限" });
      const statementId = z.string().uuid().parse(body.statementId);
      const reason = z.string().trim().min(3).max(2000).parse(body.reason);
      const difference = z.coerce.number().parse(body.differenceAmount);
      if (!Number.isFinite(difference) || difference === 0)
        throw new Error("更正差額不可為 0");
      const statement = await admin
        .from("staff_payroll_statements")
        .select("*")
        .eq("id", statementId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (statement.error || !statement.data) throw new Error("找不到薪資單");
      const period = await admin
        .from("staff_payroll_periods")
        .select("status")
        .eq("id", statement.data.payroll_period_id)
        .maybeSingle();
      if (period.error || period.data?.status !== "closed")
        throw new Error("只有關帳後的薪資才能使用更正單");
      const correction = await admin
        .from("staff_payroll_corrections")
        .insert({
          statement_id: statementId,
          payroll_period_id: statement.data.payroll_period_id,
          tenant_id: tenantId,
          employee_id: statement.data.employee_id,
          reason,
          difference_amount: difference,
          before_snapshot: statement.data,
          after_snapshot: {
            ...statement.data,
            net_pay: Number(statement.data.net_pay) + difference,
          },
          status: "manager_approved",
          created_by: user.id,
          manager_approved_by: user.id,
          manager_approved_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (correction.error) throw new Error(correction.error.message);
      await createInAppNotifications({
        supabase: admin,
        tenantId,
        recipientUserIds: [String(statement.data.employee_id)],
        title: "薪資更正單待確認",
        message: `更正原因：${reason}。差額 ${difference > 0 ? "增加" : "扣回"} ${Math.abs(difference)} 元，請查看內容並以手機簽名。`,
        severity: "warning",
        eventType: "staff_payroll_correction_signature",
        targetType: "staff_payroll_correction",
        targetId: String(correction.data.id),
        actionUrl: `/staff/payroll?month=${body.month}`,
        dedupeKey: `staff-payroll-correction-signature:${correction.data.id}`,
        createdBy: user.id,
      });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: user.id, action: "staff_payroll_correction_created", targetType: "staff_payroll_correction", targetId: String(correction.data.id), reason, before: statement.data, after: { differenceAmount: difference, netPay: Number(statement.data.net_pay) + difference } });
    } else throw new Error("不支援的薪資操作");
    return apiSuccess(await state(admin, user, auth.context, body.month));
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message || "欄位格式錯誤"
        : error instanceof Error
          ? error.message
          : "薪資操作失敗";
    return apiError(400, "FORBIDDEN", message);
  }
}
