import { createHash } from "node:crypto";
import { z } from "zod";
import { apiError, apiSuccess, requireProfile, type ProfileContext } from "../../../lib/auth-context";
import { createInAppNotifications } from "../../../lib/in-app-notifications";
import { hasStaffPermission, requireStaffPermission } from "../../../lib/staff-operation-permissions";
import {
  DEFAULT_SHIFT_DEFINITIONS,
  assertValidPreferenceDates,
  buildSelectionWindow,
  dateAfter,
  generateMonthlySchedule,
  listMonthDates,
  moveDayOff,
  normalizeMonthStart,
  shiftForEmployeeDate,
  validateSchedule,
  type EmployeeScheduleConfig,
  type ScheduleEntryDraft,
} from "../../../lib/staff-scheduling";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

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

const actionSchema = z.object({ action: z.string().min(1) }).passthrough();
const monthSchema = z.string().regex(/^\d{4}-\d{2}(?:-01)?$/);

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type ProfileRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  role: string;
  display_name: string | null;
  english_name: string | null;
  employee_number: string | null;
  department: string | null;
  position: string | null;
};

type EmploymentRow = {
  employee_id: string;
  employment_type: "full_time" | "part_time";
  pay_basis: "monthly" | "hourly";
  work_group: "frontdesk" | "coach" | "other";
  monthly_salary: number;
  hourly_rate: number;
  default_shift_code: string;
  is_original_early_shift: boolean;
  can_cover_early_shift: boolean;
  counts_toward_middle_limit: boolean;
  insurance_status: string;
};

type PeriodRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  month_start: string;
  selection_opens_at: string;
  selection_closes_at: string;
  preferred_days_required: number;
  middle_preference_daily_limit: number;
  status: string;
};

const TAIWAN_2026_STATUTORY_HOLIDAYS = [
  ["2026-01-01", "中華民國開國紀念日"],
  ["2026-02-16", "農曆除夕"],
  ["2026-02-17", "春節初一"],
  ["2026-02-18", "春節初二"],
  ["2026-02-19", "春節初三"],
  ["2026-02-28", "和平紀念日"],
  ["2026-04-04", "兒童節"],
  ["2026-04-05", "民族掃墓節"],
  ["2026-05-01", "勞動節"],
  ["2026-06-19", "端午節"],
  ["2026-09-25", "中秋節"],
  ["2026-09-28", "孔子誕辰紀念日／教師節"],
  ["2026-10-10", "國慶日"],
  ["2026-10-25", "臺灣光復暨金門古寧頭大捷紀念日"],
  ["2026-12-25", "行憲紀念日"],
] as const;

const HOLIDAY_SOURCE_URL = "https://www.dgpa.gov.tw/information?pid=12685&uid=30";

function monthStartFromInput(input: string | null | undefined) {
  const candidate = input || (() => {
    const now = new Date();
    const month = now.getUTCMonth() + 2;
    const target = new Date(Date.UTC(now.getUTCFullYear(), month - 1, 1));
    return target.toISOString().slice(0, 7);
  })();
  const parsed = monthSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("月份格式錯誤");
  return normalizeMonthStart(candidate.length === 7 ? `${candidate}-01` : candidate);
}

function taiwanDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

async function getProfile(admin: AdminClient, userId: string) {
  const result = await admin
    .from("profiles")
    .select("id, tenant_id, branch_id, role, display_name, english_name, employee_number, department, position")
    .eq("id", userId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("找不到員工資料");
  return result.data as ProfileRow;
}

function withBranchScope<T>(query: T, branchId: string | null) {
  const scoped = query as T & { eq: (column: string, value: string) => T; is: (column: string, value: null) => T };
  return branchId ? scoped.eq("branch_id", branchId) : scoped.is("branch_id", null);
}

async function getPeriod(admin: AdminClient, tenantId: string, branchId: string | null, monthStart: string) {
  const baseQuery = () => admin
    .from("staff_schedule_periods")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("month_start", monthStart);
  let query = branchId ? baseQuery().eq("branch_id", branchId) : baseQuery().is("branch_id", null);
  const result = await query.maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (result.data || !branchId) return (result.data as PeriodRow | null) ?? null;
  const tenantWide = await baseQuery().is("branch_id", null).maybeSingle();
  if (tenantWide.error) throw new Error(tenantWide.error.message);
  return (tenantWide.data as PeriodRow | null) ?? null;
}

async function ensureDefaultShifts(admin: AdminClient, tenantId: string, branchId: string | null, actorId: string) {
  let query = admin.from("staff_shift_templates").select("id, code").eq("tenant_id", tenantId);
  query = branchId ? query.eq("branch_id", branchId) : query.is("branch_id", null);
  const existing = await query;
  if (existing.error) throw new Error(existing.error.message);
  const codes = new Set((existing.data || []).map((row) => String(row.code)));
  const missing = DEFAULT_SHIFT_DEFINITIONS.filter((shift) => !codes.has(shift.code)).map((shift) => ({
    tenant_id: tenantId,
    branch_id: branchId,
    code: shift.code,
    label: shift.label,
    starts_at: shift.startsAt,
    ends_at: shift.endsAt,
    break_minutes: shift.breakMinutes,
    paid_break: shift.paidBreak,
    break_hidden_from_employee: shift.breakHiddenFromEmployee,
    counts_toward_middle_limit: shift.countsTowardMiddleLimit,
    created_by: actorId,
  }));
  if (missing.length > 0) {
    const insert = await admin.from("staff_shift_templates").insert(missing);
    if (insert.error) throw new Error(insert.error.message);
  }
}

async function seedKnownHolidays(admin: AdminClient, tenantId: string, monthStart: string, actorId: string) {
  if (!monthStart.startsWith("2026-")) return;
  const existing = await admin
    .from("staff_holiday_calendar")
    .select("holiday_date, holiday_kind")
    .eq("tenant_id", tenantId)
    .eq("holiday_kind", "statutory")
    .gte("holiday_date", "2026-01-01")
    .lte("holiday_date", "2026-12-31");
  if (existing.error) throw new Error(existing.error.message);
  const existingDates = new Set((existing.data || []).map((row) => String(row.holiday_date)));
  const rows = TAIWAN_2026_STATUTORY_HOLIDAYS.filter(([holidayDate]) => !existingDates.has(holidayDate)).map(([holidayDate, holidayName]) => ({
    tenant_id: tenantId,
    holiday_date: holidayDate,
    holiday_name: holidayName,
    holiday_kind: "statutory",
    source_label: "行政院人事行政總處 115 年辦公日曆表（法定節日原日期）",
    source_url: HOLIDAY_SOURCE_URL,
    created_by: actorId,
  }));
  if (rows.length === 0) return;
  const result = await admin.from("staff_holiday_calendar").insert(rows);
  if (result.error) throw new Error(result.error.message);
}

async function listEmployees(admin: AdminClient, tenantId: string, branchId: string | null) {
  let query = admin
    .from("profiles")
    .select("id, tenant_id, branch_id, role, display_name, english_name, employee_number, department, position")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .is("staff_deleted_at", null)
    .not("role", "in", '("member","customer")')
    .order("employee_number", { ascending: true, nullsFirst: false });
  if (branchId) query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return (result.data || []) as ProfileRow[];
}

function inferEmployment(profile: ProfileRow, actorId: string) {
  const frontdesk = profile.position === "frontdesk" || profile.department === "general_affairs";
  return {
    employee_id: profile.id,
    tenant_id: profile.tenant_id,
    branch_id: profile.branch_id,
    employment_type: frontdesk ? "part_time" : "full_time",
    pay_basis: frontdesk ? "hourly" : "monthly",
    work_group: frontdesk ? "frontdesk" : "coach",
    monthly_salary: 29500,
    hourly_rate: 196,
    default_shift_code: frontdesk ? "FRONTDESK_DAY" : "COACH_MIDDLE",
    is_original_early_shift: false,
    can_cover_early_shift: false,
    counts_toward_middle_limit: !frontdesk,
    configured_by: actorId,
  };
}

async function ensureEmploymentProfiles(admin: AdminClient, employees: ProfileRow[], actorId: string) {
  if (employees.length === 0) return [] as EmploymentRow[];
  const result = await admin.from("staff_employment_profiles").select("*").in("employee_id", employees.map((item) => item.id));
  if (result.error) throw new Error(result.error.message);
  const rows = (result.data || []) as EmploymentRow[];
  const existing = new Set(rows.map((row) => row.employee_id));
  const missing = employees.filter((employee) => !existing.has(employee.id)).map((employee) => inferEmployment(employee, actorId));
  if (missing.length > 0) {
    const insert = await admin.from("staff_employment_profiles").insert(missing).select("*");
    if (insert.error) throw new Error(insert.error.message);
    rows.push(...((insert.data || []) as EmploymentRow[]));
  }
  return rows;
}

function configFromRows(profile: ProfileRow, employment: EmploymentRow): EmployeeScheduleConfig {
  return {
    employeeId: profile.id,
    displayName: profile.display_name || profile.english_name || profile.employee_number || "未命名員工",
    employmentType: employment.employment_type,
    workGroup: employment.work_group,
    defaultShiftCode: employment.default_shift_code,
    isOriginalEarlyShift: employment.is_original_early_shift,
    canCoverEarlyShift: employment.can_cover_early_shift,
    countsTowardMiddleLimit: employment.counts_toward_middle_limit,
  };
}

function mapEntry(row: Record<string, unknown>): ScheduleEntryDraft {
  return {
    employeeId: String(row.employee_id),
    workDate: String(row.work_date),
    entryKind: row.entry_kind as ScheduleEntryDraft["entryKind"],
    shiftCode: row.shift_code ? String(row.shift_code) : null,
    shiftLabel: row.shift_label ? String(row.shift_label) : null,
    startsAt: row.starts_at ? String(row.starts_at).slice(0, 5) : null,
    endsAt: row.ends_at ? String(row.ends_at).slice(0, 5) : null,
    breakMinutes: Number(row.break_minutes || 0),
    paidBreak: Boolean(row.paid_break),
    breakHiddenFromEmployee: Boolean(row.break_hidden_from_employee),
    countsTowardMiddleLimit: Boolean(row.counts_toward_middle_limit),
    offKind: (row.off_kind as ScheduleEntryDraft["offKind"]) || null,
    source: row.source as ScheduleEntryDraft["source"],
    employeeVisibleNote: row.employee_visible_note ? String(row.employee_visible_note) : null,
  };
}

async function loadBoundaryScheduleEntries(admin: AdminClient, tenantId: string, monthStart: string) {
  const monthDates = listMonthDates(monthStart);
  const monthEnd = monthDates.at(-1) || monthStart;
  const result = await admin
    .from("staff_schedule_entries")
    .select("*, staff_schedule_versions!inner(status)")
    .eq("tenant_id", tenantId)
    .eq("staff_schedule_versions.status", "published")
    .gte("work_date", dateAfter(monthStart, -6))
    .lte("work_date", dateAfter(monthEnd, 6));
  if (result.error) throw new Error(result.error.message);
  return (result.data || [])
    .filter((row) => String(row.work_date) < monthStart || String(row.work_date) > monthEnd)
    .map((row) => mapEntry(row));
}

function entryInsertRow(params: {
  draft: ScheduleEntryDraft;
  versionId: string;
  periodId: string;
  tenantId: string;
  actorId: string;
  shiftIds: Map<string, string>;
}) {
  const entry = params.draft;
  return {
    version_id: params.versionId,
    period_id: params.periodId,
    tenant_id: params.tenantId,
    employee_id: entry.employeeId,
    work_date: entry.workDate,
    entry_kind: entry.entryKind,
    shift_template_id: entry.shiftCode ? params.shiftIds.get(entry.shiftCode) || null : null,
    shift_code: entry.shiftCode,
    shift_label: entry.shiftLabel,
    starts_at: entry.startsAt,
    ends_at: entry.endsAt,
    break_minutes: entry.breakMinutes,
    paid_break: entry.paidBreak,
    break_hidden_from_employee: entry.breakHiddenFromEmployee,
    counts_toward_middle_limit: entry.countsTowardMiddleLimit,
    off_kind: entry.offKind,
    source: entry.source,
    employee_visible_note: entry.employeeVisibleNote || null,
    created_by: params.actorId,
    updated_by: params.actorId,
  };
}

async function loadShiftIds(admin: AdminClient, tenantId: string, branchId: string | null) {
  let query = admin.from("staff_shift_templates").select("id, code").eq("tenant_id", tenantId).eq("is_active", true);
  query = branchId ? query.eq("branch_id", branchId) : query.is("branch_id", null);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return new Map((result.data || []).map((row) => [String(row.code), String(row.id)]));
}

async function getLatestVersion(admin: AdminClient, periodId: string, employeeOnlyPublished = false) {
  let query = admin
    .from("staff_schedule_versions")
    .select("*")
    .eq("period_id", periodId)
    .order("version_number", { ascending: false })
    .limit(1);
  if (employeeOnlyPublished) query = query.eq("status", "published");
  const result = await query.maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data as Record<string, unknown> | null;
}

async function clonePublishedVersionForEmployee(params: {
  admin: AdminClient;
  period: PeriodRow;
  version: Record<string, unknown>;
  employeeId: string;
  actorId: string;
  changeSummary: string;
}) {
  const { admin, period, version, employeeId, actorId, changeSummary } = params;
  if (version.status !== "published") return version;
  const clone = await admin.from("staff_schedule_versions").insert({
    period_id: period.id,
    tenant_id: period.tenant_id,
    version_number: Number(version.version_number) + 1,
    status: "draft",
    based_on_version_id: version.id,
    change_summary: changeSummary,
    created_by: actorId,
  }).select("*").single();
  if (clone.error) throw new Error(clone.error.message);
  const [sourceEntries, sourceAdjustments, sourceRules] = await Promise.all([
    admin.from("staff_schedule_entries").select("*").eq("version_id", String(version.id)),
    admin.from("staff_holiday_adjustments").select("*").eq("version_id", String(version.id)),
    admin.from("staff_schedule_rule_results").select("*").eq("version_id", String(version.id)),
  ]);
  if (sourceEntries.error || sourceAdjustments.error || sourceRules.error) throw new Error(sourceEntries.error?.message || sourceAdjustments.error?.message || sourceRules.error?.message || "讀取舊班表失敗");
  const clonedRows = (sourceEntries.data || []).map((row) => {
    const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = row;
    return { ...rest, version_id: clone.data.id, requires_resign: row.employee_id === employeeId, created_by: actorId, updated_by: actorId };
  });
  if (clonedRows.length > 0) {
    const insert = await admin.from("staff_schedule_entries").insert(clonedRows);
    if (insert.error) throw new Error(insert.error.message);
  }
  const clonedAdjustments = (sourceAdjustments.data || []).map((row) => {
    const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = row;
    const affected = row.employee_id === employeeId;
    return { ...rest, version_id: clone.data.id, status: affected ? "draft" : row.status, manager_approved_by: affected ? null : row.manager_approved_by, manager_approved_at: affected ? null : row.manager_approved_at };
  });
  if (clonedAdjustments.length > 0) {
    const insert = await admin.from("staff_holiday_adjustments").insert(clonedAdjustments);
    if (insert.error) throw new Error(insert.error.message);
  }
  const clonedRules = (sourceRules.data || []).map((row) => {
    const { id: _id, created_at: _createdAt, ...rest } = row;
    return { ...rest, version_id: clone.data.id };
  });
  if (clonedRules.length > 0) {
    const insert = await admin.from("staff_schedule_rule_results").insert(clonedRules);
    if (insert.error) throw new Error(insert.error.message);
  }
  await admin.from("staff_schedule_periods").update({ status: "drafting" }).eq("id", period.id);
  return clone.data as Record<string, unknown>;
}

async function buildState(params: {
  admin: AdminClient;
  profile: ProfileRow;
  context: ProfileContext;
  monthStart: string;
}) {
  const tenantId = params.profile.tenant_id;
  if (!tenantId) throw new Error("此帳號尚未設定館別，無法使用員工班表");
  const manager = await hasStaffPermission({
    supabase: params.admin,
    tenantId,
    employeeId: params.profile.id,
    context: params.context,
    permission: "view_team_schedule",
  });
  const finalApprover = await hasStaffPermission({
    supabase: params.admin,
    tenantId,
    employeeId: params.profile.id,
    context: params.context,
    permission: "publish_schedule",
  });
  const period = await getPeriod(params.admin, tenantId, params.profile.branch_id, params.monthStart);
  if (!period) {
    return {
      actor: {
        id: params.profile.id,
        displayName: params.profile.display_name,
        englishName: params.profile.english_name,
        role: params.profile.role,
        position: params.profile.position,
        canManage: manager,
        canFinalApprove: finalApprover,
      },
      monthStart: params.monthStart,
      period: null,
      employees: [],
      preferences: [],
      facilityClosures: [],
      version: null,
      scheduleEntries: [],
      ruleResults: [],
      holidayAdjustments: [],
      acknowledgement: null,
    };
  }

  const employees = manager
    ? await listEmployees(params.admin, tenantId, params.profile.branch_id)
    : [params.profile];
  const employments = await ensureEmploymentProfiles(params.admin, employees, params.profile.id);
  const employeeIds = employees.map((item) => item.id);
  const [closureResult, preferenceResult, holidayResult] = await Promise.all([
    params.admin.from("staff_facility_closures").select("*").eq("period_id", period.id).order("closure_date"),
    params.admin
      .from("staff_time_off_preferences")
      .select("*, staff_time_off_preference_dates(*)")
      .eq("period_id", period.id)
      .in("employee_id", employeeIds),
    params.admin
      .from("staff_holiday_calendar")
      .select("holiday_date, holiday_name, holiday_kind, source_label, source_url")
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .gte("holiday_date", params.monthStart)
      .lte("holiday_date", listMonthDates(params.monthStart).at(-1) || params.monthStart)
      .order("holiday_date"),
  ]);
  if (closureResult.error) throw new Error(closureResult.error.message);
  if (preferenceResult.error) throw new Error(preferenceResult.error.message);
  if (holidayResult.error) throw new Error(holidayResult.error.message);

  const version = await getLatestVersion(params.admin, period.id, !manager);
  let scheduleEntries: Record<string, unknown>[] = [];
  let ruleResults: Record<string, unknown>[] = [];
  let holidayAdjustments: Record<string, unknown>[] = [];
  let acknowledgement: Record<string, unknown> | null = null;
  if (version) {
    let entryQuery = params.admin.from("staff_schedule_entries").select("*").eq("version_id", String(version.id));
    if (!manager) entryQuery = entryQuery.eq("employee_id", params.profile.id);
    const [entriesResult, rulesResult, adjustmentResult, acknowledgementResult] = await Promise.all([
      entryQuery.order("work_date"),
      manager
        ? params.admin.from("staff_schedule_rule_results").select("*").eq("version_id", String(version.id)).order("created_at")
        : Promise.resolve({ data: [], error: null }),
      params.admin
        .from("staff_holiday_adjustments")
        .select("*")
        .eq("version_id", String(version.id))
        .in("employee_id", manager ? employeeIds : [params.profile.id])
        .order("holiday_date"),
      params.admin
        .from("staff_schedule_acknowledgements")
        .select("*")
        .eq("version_id", String(version.id))
        .eq("employee_id", params.profile.id)
        .maybeSingle(),
    ]);
    if (entriesResult.error) throw new Error(entriesResult.error.message);
    if (rulesResult.error) throw new Error(rulesResult.error.message);
    if (adjustmentResult.error) throw new Error(adjustmentResult.error.message);
    if (acknowledgementResult.error) throw new Error(acknowledgementResult.error.message);
    scheduleEntries = (entriesResult.data || []) as Record<string, unknown>[];
    ruleResults = (rulesResult.data || []) as Record<string, unknown>[];
    holidayAdjustments = (adjustmentResult.data || []) as Record<string, unknown>[];
    acknowledgement = acknowledgementResult.data as Record<string, unknown> | null;
  }

  const employmentMap = new Map(employments.map((item) => [item.employee_id, item]));
  return {
    actor: {
      id: params.profile.id,
      displayName: params.profile.display_name || params.profile.english_name || params.profile.employee_number,
      englishName: params.profile.english_name,
      role: params.profile.role,
      position: params.profile.position,
      canManage: manager,
      canFinalApprove: finalApprover,
    },
    monthStart: params.monthStart,
    period,
    employees: employees.map((employee) => ({
      id: employee.id,
      displayName: employee.display_name || employee.english_name || employee.employee_number || "未命名員工",
      employeeNumber: employee.employee_number,
      department: employee.department,
      position: employee.position,
      employment: employmentMap.get(employee.id) || null,
    })),
    preferences: preferenceResult.data || [],
    facilityClosures: closureResult.data || [],
    holidays: holidayResult.data || [],
    version,
    scheduleEntries: scheduleEntries.map((entry) => ({
      id: entry.id,
      employeeId: entry.employee_id,
      workDate: entry.work_date,
      entryKind: entry.entry_kind,
      shiftCode: entry.shift_code,
      shiftLabel: entry.shift_label,
      startsAt: entry.starts_at ? String(entry.starts_at).slice(0, 5) : null,
      endsAt: entry.ends_at ? String(entry.ends_at).slice(0, 5) : null,
      offKind: entry.off_kind,
      source: entry.source,
      employeeVisibleNote: entry.employee_visible_note,
      requiresResign: entry.requires_resign,
      ...(manager ? { internalNote: entry.internal_note } : {}),
    })),
    ruleResults,
    holidayAdjustments,
    acknowledgement,
  };
}

async function writeAudit(admin: AdminClient, params: {
  tenantId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
}) {
  await admin.from("audit_logs").insert({
    tenant_id: params.tenantId,
    actor_id: params.actorId,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId || null,
    reason: params.reason || null,
    payload: params.payload || {},
  });
}

export async function GET(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const monthStart = monthStartFromInput(url.searchParams.get("month"));
    const admin = createSupabaseAdminClient();
    const profile = await getProfile(admin, auth.context.userId);
    const state = await buildState({ admin, profile, context: auth.context, monthStart });
    return apiSuccess(state);
  } catch (error) {
    return apiError(400, "FORBIDDEN", error instanceof Error ? error.message : "無法讀取員工班表");
  }
}

export async function POST(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "FORBIDDEN", "操作內容格式錯誤");

  const body = parsed.data;
  const admin = createSupabaseAdminClient();
  try {
    const profile = await getProfile(admin, auth.context.userId);
    const tenantId = profile.tenant_id;
    if (!tenantId) throw new Error("此帳號尚未設定館別");
    const monthStart = monthStartFromInput(typeof body.monthStart === "string" ? body.monthStart : null);

    if (body.action === "initialize_period") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有開放排休月份的權限" });
      const existing = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      if (!existing) {
        const window = buildSelectionWindow(monthStart);
        const insert = await admin.from("staff_schedule_periods").insert({
          tenant_id: tenantId,
          branch_id: profile.branch_id,
          month_start: monthStart,
          selection_opens_at: window.opensAt,
          selection_closes_at: window.closesAt,
          created_by: profile.id,
        });
        if (insert.error) throw new Error(insert.error.message);
      }
      await ensureDefaultShifts(admin, tenantId, profile.branch_id, profile.id);
      await seedKnownHolidays(admin, tenantId, monthStart, profile.id);
      const employees = await listEmployees(admin, tenantId, profile.branch_id);
      await ensureEmploymentProfiles(admin, employees, profile.id);
      await writeAudit(admin, {
        tenantId,
        actorId: profile.id,
        action: "staff_schedule_period_initialized",
        targetType: "staff_schedule_period",
        payload: { monthStart },
      });
    } else if (body.action === "set_facility_closure") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有設定館休的權限" });
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      if (!period) throw new Error("請先開放這個月份");
      const closureDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.closureDate);
      if (!listMonthDates(monthStart).includes(closureDate)) throw new Error("館休日必須在該月份內");
      const previous = await admin.from("staff_facility_closures").select("id").eq("period_id", period.id);
      if (previous.error) throw new Error(previous.error.message);
      if ((previous.data || []).length > 0) {
        const update = await admin
          .from("staff_facility_closures")
          .update({ closure_date: closureDate, created_by: profile.id })
          .eq("period_id", period.id);
        if (update.error) throw new Error(update.error.message);
      } else {
        const insert = await admin.from("staff_facility_closures").insert({
          period_id: period.id,
          tenant_id: tenantId,
          closure_date: closureDate,
          created_by: profile.id,
        });
        if (insert.error) throw new Error(insert.error.message);
      }
    } else if (body.action === "update_schedule_rules") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有調整排班規則的權限" });
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      if (!period) throw new Error("請先開放這個月份");
      const middlePreferenceDailyLimit = z.coerce.number().int().min(1).max(20).parse(body.middlePreferenceDailyLimit);
      const update = await admin.from("staff_schedule_periods").update({
        middle_preference_daily_limit: middlePreferenceDailyLimit,
      }).eq("id", period.id);
      if (update.error) throw new Error(update.error.message);
      await writeAudit(admin, {
        tenantId,
        actorId: profile.id,
        action: "staff_schedule_rules_updated",
        targetType: "staff_schedule_period",
        targetId: period.id,
        payload: {
          before: { middlePreferenceDailyLimit: period.middle_preference_daily_limit },
          after: { middlePreferenceDailyLimit },
        },
      });
    } else if (body.action === "upsert_holiday") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有維護國定假日行事曆的權限" });
      const holidayDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.holidayDate);
      const holidayName = z.string().trim().min(2).max(200).parse(body.holidayName);
      if (!listMonthDates(monthStart).includes(holidayDate)) throw new Error("國定假日日期必須在目前選擇的月份");
      const existing = await admin.from("staff_holiday_calendar").select("id, holiday_name").eq("tenant_id", tenantId).eq("holiday_date", holidayDate).eq("holiday_kind", "statutory").maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      const saved = existing.data
        ? await admin.from("staff_holiday_calendar").update({ holiday_name: holidayName, source_label: "主管依當年度官方行事曆設定", created_by: profile.id }).eq("id", existing.data.id)
        : await admin.from("staff_holiday_calendar").insert({ tenant_id: tenantId, holiday_date: holidayDate, holiday_name: holidayName, holiday_kind: "statutory", source_label: "主管依當年度官方行事曆設定", created_by: profile.id });
      if (saved.error) throw new Error(saved.error.message);
      await writeAudit(admin, { tenantId, actorId: profile.id, action: "staff_holiday_calendar_updated", targetType: "staff_holiday_calendar", targetId: existing.data?.id || null, payload: { holidayDate, before: existing.data?.holiday_name || null, after: holidayName } });
    } else if (body.action === "remove_holiday") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有維護國定假日行事曆的權限" });
      const holidayDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.holidayDate);
      const existing = await admin.from("staff_holiday_calendar").select("id, holiday_name").eq("tenant_id", tenantId).eq("holiday_date", holidayDate).eq("holiday_kind", "statutory").maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (!existing.data) throw new Error("只能移除本館自行設定的國定假日");
      const remove = await admin.from("staff_holiday_calendar").delete().eq("id", existing.data.id);
      if (remove.error) throw new Error(remove.error.message);
      await writeAudit(admin, { tenantId, actorId: profile.id, action: "staff_holiday_calendar_removed", targetType: "staff_holiday_calendar", targetId: existing.data.id, payload: { holidayDate, holidayName: existing.data.holiday_name } });
    } else if (body.action === "configure_employee") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有設定員工班別的權限" });
      const employeeId = z.string().uuid().parse(body.employeeId);
      const values = z.object({
        employmentType: z.enum(["full_time", "part_time"]),
        payBasis: z.enum(["monthly", "hourly"]),
        workGroup: z.enum(["frontdesk", "coach", "other"]),
        monthlySalary: z.coerce.number().min(0),
        hourlyRate: z.coerce.number().min(0),
        defaultShiftCode: z.string().min(1),
        isOriginalEarlyShift: z.boolean(),
        canCoverEarlyShift: z.boolean(),
        countsTowardMiddleLimit: z.boolean(),
      }).parse(body);
      const target = await admin.from("profiles").select("id").eq("id", employeeId).eq("tenant_id", tenantId).maybeSingle();
      if (target.error || !target.data) throw new Error("找不到此館員工");
      const update = await admin.from("staff_employment_profiles").upsert({
        employee_id: employeeId,
        tenant_id: tenantId,
        branch_id: profile.branch_id,
        employment_type: values.employmentType,
        pay_basis: values.payBasis,
        work_group: values.workGroup,
        monthly_salary: values.monthlySalary,
        hourly_rate: values.hourlyRate,
        default_shift_code: values.defaultShiftCode,
        is_original_early_shift: values.isOriginalEarlyShift,
        can_cover_early_shift: values.canCoverEarlyShift,
        counts_toward_middle_limit: values.countsTowardMiddleLimit,
        configured_by: profile.id,
      }, { onConflict: "employee_id" });
      if (update.error) throw new Error(update.error.message);
    } else if (body.action === "save_preferences") {
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      if (!period) throw new Error("主管尚未開放這個月份");
      const now = Date.now();
      if (now < new Date(period.selection_opens_at).getTime() || now > new Date(period.selection_closes_at).getTime()) {
        throw new Error("目前不在排休選取期間；請直接聯絡副理協助修改");
      }
      const selectedDates = z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(15).parse(body.selectedDates);
      const closures = await admin.from("staff_facility_closures").select("closure_date").eq("period_id", period.id);
      if (closures.error) throw new Error(closures.error.message);
      const closureDates = (closures.data || []).map((row) => String(row.closure_date));
      assertValidPreferenceDates({
        monthStart,
        selectedDates,
        facilityClosureDates: closureDates,
        requiredCount: period.preferred_days_required,
      });
      const upsert = await admin.from("staff_time_off_preferences").upsert({
        period_id: period.id,
        tenant_id: tenantId,
        employee_id: profile.id,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        last_edited_at: new Date().toISOString(),
      }, { onConflict: "period_id,employee_id" }).select("id, revision").single();
      if (upsert.error) throw new Error(upsert.error.message);
      const deletion = await admin
        .from("staff_time_off_preference_dates")
        .delete()
        .eq("preference_id", upsert.data.id)
        .eq("source", "employee");
      if (deletion.error) throw new Error(deletion.error.message);
      const insert = await admin.from("staff_time_off_preference_dates").insert(selectedDates.map((requestedDate) => ({
        preference_id: upsert.data.id,
        period_id: period.id,
        tenant_id: tenantId,
        employee_id: profile.id,
        requested_date: requestedDate,
        source: "employee",
        created_by: profile.id,
      })));
      if (insert.error) throw new Error(insert.error.message);
      await writeAudit(admin, {
        tenantId,
        actorId: profile.id,
        action: "staff_time_off_preferences_saved",
        targetType: "staff_time_off_preference",
        targetId: upsert.data.id,
        payload: { monthStart, selectedDates, facilityClosureDates: closureDates },
      });
    } else if (body.action === "create_draft") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有建立班表草稿的權限" });
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      if (!period) throw new Error("請先開放這個月份");
      await ensureDefaultShifts(admin, tenantId, profile.branch_id, profile.id);
      await seedKnownHolidays(admin, tenantId, monthStart, profile.id);
      const employees = await listEmployees(admin, tenantId, profile.branch_id);
      const employments = await ensureEmploymentProfiles(admin, employees, profile.id);
      const preferencesResult = await admin
        .from("staff_time_off_preference_dates")
        .select("employee_id, requested_date")
        .eq("period_id", period.id);
      if (preferencesResult.error) throw new Error(preferencesResult.error.message);
      const preferencesByEmployee: Record<string, string[]> = {};
      for (const row of preferencesResult.data || []) {
        const id = String(row.employee_id);
        (preferencesByEmployee[id] ||= []).push(String(row.requested_date));
      }
      const closures = await admin.from("staff_facility_closures").select("closure_date").eq("period_id", period.id);
      if (closures.error) throw new Error(closures.error.message);
      const holidayResult = await admin
        .from("staff_holiday_calendar")
        .select("holiday_date, holiday_name")
        .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
        .gte("holiday_date", monthStart)
        .lte("holiday_date", listMonthDates(monthStart).at(-1) || monthStart);
      if (holidayResult.error) throw new Error(holidayResult.error.message);
      const employmentMap = new Map(employments.map((row) => [row.employee_id, row]));
      const configs = employees
        .map((employee) => {
          const employment = employmentMap.get(employee.id);
          return employment ? configFromRows(employee, employment) : null;
        })
        .filter((item): item is EmployeeScheduleConfig => !!item);
      let entries = generateMonthlySchedule({
        monthStart,
        employees: configs,
        preferencesByEmployee,
        facilityClosureDates: (closures.data || []).map((row) => String(row.closure_date)),
      });
      const monthEnd = listMonthDates(monthStart).at(-1) || monthStart;
      const approvedLeaves = await admin
        .from("staff_leave_requests")
        .select("id, employee_id, leave_type, starts_at, ends_at, unit")
        .eq("tenant_id", tenantId)
        .eq("status", "approved")
        .gte("starts_at", `${monthStart}T00:00:00+08:00`)
        .lte("starts_at", `${monthEnd}T23:59:59+08:00`);
      if (approvedLeaves.error) throw new Error(approvedLeaves.error.message);
      const leaveKinds: Record<string, ScheduleEntryDraft["offKind"]> = {
        annual: "annual_leave",
        sick: "sick_leave",
        personal: "personal_leave",
        family_care: "family_care_leave",
        marriage: "marriage_leave",
        bereavement: "bereavement_leave",
        official: "official_leave",
        other: "other_leave",
      };
      const leaveLabels: Record<string, string> = {
        annual: "特休", sick: "病假", personal: "事假", family_care: "家庭照顧假",
        marriage: "婚假", bereavement: "喪假", official: "公假", other: "其他假",
      };
      for (const leave of approvedLeaves.data || []) {
        const leaveDate = taiwanDate(String(leave.starts_at));
        entries = entries.map((entry) => {
          if (entry.employeeId !== leave.employee_id || entry.workDate !== leaveDate) return entry;
          if (leave.unit !== "full_day") {
            return { ...entry, source: "leave", employeeVisibleNote: `${leaveLabels[leave.leave_type] || "請假"}（部分時段）` };
          }
          return {
            ...entry,
            entryKind: "off",
            shiftCode: null,
            shiftLabel: null,
            startsAt: null,
            endsAt: null,
            breakMinutes: 0,
            paidBreak: false,
            countsTowardMiddleLimit: false,
            offKind: leaveKinds[leave.leave_type] || "other_leave",
            source: "leave",
            employeeVisibleNote: leaveLabels[leave.leave_type] || "請假",
          };
        });
      }
      const rules = validateSchedule({
        monthStart,
        employees: configs,
        entries,
        contextEntries: await loadBoundaryScheduleEntries(admin, tenantId, monthStart),
        preferenceDailyLimit: period.middle_preference_daily_limit,
        holidays: (holidayResult.data || []).map((row) => ({ date: String(row.holiday_date), name: String(row.holiday_name) })),
      });
      const latest = await getLatestVersion(admin, period.id);
      const basedOnVersionId = latest?.status === "published" ? String(latest.id) : latest?.based_on_version_id ? String(latest.based_on_version_id) : null;
      const baseEntries = basedOnVersionId
        ? await admin.from("staff_schedule_entries").select("employee_id, work_date, entry_kind, shift_code, starts_at, ends_at, off_kind, employee_visible_note").eq("version_id", basedOnVersionId)
        : { data: [], error: null };
      if (baseEntries.error) throw new Error(baseEntries.error.message);
      const baseEntryMap = new Map((baseEntries.data || []).map((row) => [`${row.employee_id}:${row.work_date}`, row]));
      const entryChanged = (draft: ScheduleEntryDraft) => {
        const previous = baseEntryMap.get(`${draft.employeeId}:${draft.workDate}`);
        if (!previous) return Boolean(basedOnVersionId);
        return previous.entry_kind !== draft.entryKind ||
          String(previous.shift_code || "") !== String(draft.shiftCode || "") ||
          String(previous.starts_at || "").slice(0, 5) !== String(draft.startsAt || "") ||
          String(previous.ends_at || "").slice(0, 5) !== String(draft.endsAt || "") ||
          String(previous.off_kind || "") !== String(draft.offKind || "") ||
          String(previous.employee_visible_note || "") !== String(draft.employeeVisibleNote || "");
      };
      const nextVersion = latest ? Number(latest.version_number) + 1 : 1;
      const versionInsert = await admin.from("staff_schedule_versions").insert({
        period_id: period.id,
        tenant_id: tenantId,
        version_number: nextVersion,
        status: "draft",
        based_on_version_id: basedOnVersionId,
        change_summary: latest ? "依最新排休重新產生班表" : "首次建立正式班表草稿",
        created_by: profile.id,
      }).select("id").single();
      if (versionInsert.error) throw new Error(versionInsert.error.message);
      const shiftIds = await loadShiftIds(admin, tenantId, profile.branch_id);
      const entryInsert = await admin.from("staff_schedule_entries").insert(entries.map((draft) => ({ ...entryInsertRow({
        draft,
        versionId: versionInsert.data.id,
        periodId: period.id,
        tenantId,
        actorId: profile.id,
        shiftIds,
      }), requires_resign: entryChanged(draft) })));
      if (entryInsert.error) throw new Error(entryInsert.error.message);
      const ruleInsert = await admin.from("staff_schedule_rule_results").insert(rules.map((rule) => ({
        version_id: versionInsert.data.id,
        period_id: period.id,
        tenant_id: tenantId,
        employee_id: rule.employeeId,
        work_date: rule.workDate,
        rule_code: rule.ruleCode,
        severity: rule.severity,
        passed: rule.passed,
        message: rule.message,
        details: rule.details,
      })));
      if (ruleInsert.error) throw new Error(ruleInsert.error.message);
      await admin.from("staff_schedule_periods").update({ status: "drafting" }).eq("id", period.id);
    } else if (body.action === "move_day_off") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有調整班表的權限" });
      if (body.confirmed !== true) throw new Error("每次拖移都必須先確認，避免誤操作");
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      if (!period) throw new Error("找不到排班月份");
      const employeeId = z.string().uuid().parse(body.employeeId);
      const fromDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.fromDate);
      const toDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.toDate);
      let version = await getLatestVersion(admin, period.id);
      if (!version) throw new Error("尚未建立班表草稿");
      version = await clonePublishedVersionForEmployee({ admin, period, version, employeeId, actorId: profile.id, changeSummary: "發布後調整休假日期；受影響員工須重新簽名" });
      const activeVersion = version!;
      const [entriesResult, employees, employments] = await Promise.all([
        admin.from("staff_schedule_entries").select("*").eq("version_id", String(activeVersion.id)),
        listEmployees(admin, tenantId, profile.branch_id),
        admin.from("staff_employment_profiles").select("*").eq("tenant_id", tenantId),
      ]);
      if (entriesResult.error) throw new Error(entriesResult.error.message);
      if (employments.error) throw new Error(employments.error.message);
      const employee = employees.find((item) => item.id === employeeId);
      const employment = ((employments.data || []) as EmploymentRow[]).find((item) => item.employee_id === employeeId);
      if (!employee || !employment) throw new Error("找不到員工班別設定");
      const moved = moveDayOff({
        entries: (entriesResult.data || []).map((row) => mapEntry(row)),
        employeeId,
        fromDate,
        toDate,
        employee: configFromRows(employee, employment),
      });
      const changed = moved.filter((entry) => entry.employeeId === employeeId && (entry.workDate === fromDate || entry.workDate === toDate));
      for (const entry of changed) {
        const update = await admin.from("staff_schedule_entries").update({
          entry_kind: entry.entryKind,
          shift_code: entry.shiftCode,
          shift_label: entry.shiftLabel,
          starts_at: entry.startsAt,
          ends_at: entry.endsAt,
          break_minutes: entry.breakMinutes,
          paid_break: entry.paidBreak,
          break_hidden_from_employee: entry.breakHiddenFromEmployee,
          counts_toward_middle_limit: entry.countsTowardMiddleLimit,
          off_kind: entry.offKind,
          source: entry.source,
          requires_resign: true,
          updated_by: profile.id,
        }).eq("version_id", String(activeVersion.id)).eq("employee_id", employeeId).eq("work_date", entry.workDate);
        if (update.error) throw new Error(update.error.message);
      }
      const allConfigs = employees.map((item) => {
        const terms = ((employments.data || []) as EmploymentRow[]).find((row) => row.employee_id === item.id);
        return terms ? configFromRows(item, terms) : null;
      }).filter((item): item is EmployeeScheduleConfig => !!item);
      const holidayResult = await admin.from("staff_holiday_calendar").select("holiday_date, holiday_name").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).gte("holiday_date", monthStart).lte("holiday_date", listMonthDates(monthStart).at(-1) || monthStart);
      if (holidayResult.error) throw new Error(holidayResult.error.message);
      const allEntries = moved;
      const rules = validateSchedule({
        monthStart,
        employees: allConfigs,
        entries: allEntries,
        contextEntries: await loadBoundaryScheduleEntries(admin, tenantId, monthStart),
        preferenceDailyLimit: period.middle_preference_daily_limit,
        holidays: (holidayResult.data || []).map((row) => ({ date: String(row.holiday_date), name: String(row.holiday_name) })),
      });
      await admin.from("staff_schedule_rule_results").delete().eq("version_id", String(activeVersion.id));
      const ruleInsert = await admin.from("staff_schedule_rule_results").insert(rules.map((rule) => ({
        version_id: activeVersion.id,
        period_id: period.id,
        tenant_id: tenantId,
        employee_id: rule.employeeId,
        work_date: rule.workDate,
        rule_code: rule.ruleCode,
        severity: rule.severity,
        passed: rule.passed,
        message: rule.message,
        details: rule.details,
      })));
      if (ruleInsert.error) throw new Error(ruleInsert.error.message);
    } else if (body.action === "assign_shift") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有調整個別班次的權限" });
      if (body.confirmed !== true) throw new Error("每次調整班次都必須先確認，避免誤操作");
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      if (!period) throw new Error("找不到排班月份");
      const employeeId = z.string().uuid().parse(body.employeeId);
      const workDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.workDate);
      const shiftChoice = z.enum(["COACH_EARLY", "DEFAULT"]).parse(body.shiftCode);
      let version = await getLatestVersion(admin, period.id);
      if (!version) throw new Error("尚未建立班表草稿");
      version = await clonePublishedVersionForEmployee({ admin, period, version, employeeId, actorId: profile.id, changeSummary: "發布後調整個別班次；受影響員工須重新簽名" });
      const activeVersion = version!;
      const [employees, employments] = await Promise.all([
        listEmployees(admin, tenantId, profile.branch_id),
        admin.from("staff_employment_profiles").select("*").eq("tenant_id", tenantId),
      ]);
      if (employments.error) throw new Error(employments.error.message);
      const employee = employees.find((item) => item.id === employeeId);
      const employment = ((employments.data || []) as EmploymentRow[]).find((item) => item.employee_id === employeeId);
      if (!employee || !employment) throw new Error("找不到員工班別設定");
      if (shiftChoice === "COACH_EARLY" && !employment.can_cover_early_shift && !employment.is_original_early_shift) {
        throw new Error("此員工尚未由主管設定「可支援早班」，不能排入支援早班");
      }
      const target = await admin.from("staff_schedule_entries").select("entry_kind").eq("version_id", String(activeVersion.id)).eq("employee_id", employeeId).eq("work_date", workDate).maybeSingle();
      if (target.error || !target.data) throw new Error("找不到目標班表格");
      if (target.data.entry_kind !== "work") throw new Error("休假日不能直接覆蓋成班次；請先調整休假日期");
      const config = configFromRows(employee, employment);
      const shiftMap = new Map(DEFAULT_SHIFT_DEFINITIONS.map((item) => [item.code, item]));
      const shift = shiftChoice === "DEFAULT" ? shiftForEmployeeDate(config, workDate, shiftMap) : shiftMap.get("COACH_EARLY");
      if (!shift) throw new Error("找不到指定班別");
      const shiftIds = await loadShiftIds(admin, tenantId, profile.branch_id);
      const update = await admin.from("staff_schedule_entries").update({
        shift_template_id: shiftIds.get(shift.code) || null,
        shift_code: shift.code,
        shift_label: shift.label,
        starts_at: shift.startsAt,
        ends_at: shift.endsAt,
        break_minutes: shift.breakMinutes,
        paid_break: shift.paidBreak,
        break_hidden_from_employee: shift.breakHiddenFromEmployee,
        counts_toward_middle_limit: shift.countsTowardMiddleLimit,
        source: "supervisor",
        requires_resign: true,
        updated_by: profile.id,
      }).eq("version_id", String(activeVersion.id)).eq("employee_id", employeeId).eq("work_date", workDate);
      if (update.error) throw new Error(update.error.message);
      const entriesResult = await admin.from("staff_schedule_entries").select("*").eq("version_id", String(activeVersion.id));
      if (entriesResult.error) throw new Error(entriesResult.error.message);
      const allConfigs = employees.map((item) => {
        const terms = ((employments.data || []) as EmploymentRow[]).find((row) => row.employee_id === item.id);
        return terms ? configFromRows(item, terms) : null;
      }).filter((item): item is EmployeeScheduleConfig => !!item);
      const monthEnd = listMonthDates(monthStart).at(-1) || monthStart;
      const holidayResult = await admin.from("staff_holiday_calendar").select("holiday_date, holiday_name").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).gte("holiday_date", monthStart).lte("holiday_date", monthEnd);
      if (holidayResult.error) throw new Error(holidayResult.error.message);
      const rules = validateSchedule({
        monthStart,
        employees: allConfigs,
        entries: (entriesResult.data || []).map((row) => mapEntry(row)),
        contextEntries: await loadBoundaryScheduleEntries(admin, tenantId, monthStart),
        preferenceDailyLimit: period.middle_preference_daily_limit,
        holidays: (holidayResult.data || []).map((row) => ({ date: String(row.holiday_date), name: String(row.holiday_name) })),
      });
      await admin.from("staff_schedule_rule_results").delete().eq("version_id", String(activeVersion.id));
      const ruleInsert = await admin.from("staff_schedule_rule_results").insert(rules.map((rule) => ({
        version_id: activeVersion.id,
        period_id: period.id,
        tenant_id: tenantId,
        employee_id: rule.employeeId,
        work_date: rule.workDate,
        rule_code: rule.ruleCode,
        severity: rule.severity,
        passed: rule.passed,
        message: rule.message,
        details: rule.details,
      })));
      if (ruleInsert.error) throw new Error(ruleInsert.error.message);
      await admin.from("staff_schedule_periods").update({ status: "drafting" }).eq("id", period.id);
    } else if (body.action === "make_holiday_day_off") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有調整國定假日班表的權限" });
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      let version = period ? await getLatestVersion(admin, period.id) : null;
      if (!period || !version) throw new Error("找不到班表草稿");
      const employeeId = z.string().uuid().parse(body.employeeId);
      version = await clonePublishedVersionForEmployee({ admin, period, version, employeeId, actorId: profile.id, changeSummary: "發布後調整國定假日班表；受影響員工須重新簽名" });
      const holidayDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.holidayDate);
      const holidayName = z.string().min(1).parse(body.holidayName);
      const update = await admin.from("staff_schedule_entries").update({
        entry_kind: "off",
        shift_template_id: null,
        shift_code: null,
        shift_label: null,
        starts_at: null,
        ends_at: null,
        break_minutes: 0,
        paid_break: false,
        counts_toward_middle_limit: false,
        off_kind: "national_holiday",
        source: "supervisor",
        employee_visible_note: holidayName,
        requires_resign: true,
        updated_by: profile.id,
      }).eq("version_id", String(version.id)).eq("employee_id", employeeId).eq("work_date", holidayDate).eq("entry_kind", "work").select("id").maybeSingle();
      if (update.error || !update.data) throw new Error("找不到該員工的國定假日上班班次");
      await admin.from("staff_schedule_rule_results").update({
        passed: true,
        message: `${holidayDate} ${holidayName} 已改為國定假日休假。`,
        overridden_by: profile.id,
        override_reason: "國定假日當日改為休假",
        overridden_at: new Date().toISOString(),
      }).eq("version_id", String(version.id)).eq("employee_id", employeeId).eq("work_date", holidayDate).eq("rule_code", "HOLIDAY_ADJUSTMENT_REQUIRED");
    } else if (body.action === "arrange_holiday_adjustment") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有安排國定假日調移的權限" });
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      let version = period ? await getLatestVersion(admin, period.id) : null;
      if (!period || !version) throw new Error("找不到班表草稿");
      const employeeId = z.string().uuid().parse(body.employeeId);
      version = await clonePublishedVersionForEmployee({ admin, period, version, employeeId, actorId: profile.id, changeSummary: "發布後安排國定假日調移；受影響員工須重新簽名" });
      const holidayDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.holidayDate);
      const adjustedDayOff = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.adjustedDayOff);
      const holidayName = z.string().min(1).parse(body.holidayName);
      const entries = await admin.from("staff_schedule_entries").select("*").eq("version_id", String(version.id)).eq("employee_id", employeeId).in("work_date", [holidayDate, adjustedDayOff]);
      if (entries.error) throw new Error(entries.error.message);
      const holidayEntry = (entries.data || []).find((row) => row.work_date === holidayDate);
      const adjustedEntry = (entries.data || []).find((row) => row.work_date === adjustedDayOff);
      if (!holidayEntry || holidayEntry.entry_kind !== "work") throw new Error("國定假日當天不是上班班次，不需調移");
      if (!adjustedEntry || adjustedEntry.entry_kind !== "work") throw new Error("調休日只能選擇原本有排班的工作日");
      const status = "draft";
      const adjustment = await admin.from("staff_holiday_adjustments").upsert({
        version_id: version.id,
        period_id: period.id,
        tenant_id: tenantId,
        employee_id: employeeId,
        holiday_date: holidayDate,
        holiday_name: holidayName,
        original_shift_summary: `${String(holidayEntry.starts_at).slice(0, 5)}–${String(holidayEntry.ends_at).slice(0, 5)}`,
        adjusted_day_off: adjustedDayOff,
        status,
        arranged_by: profile.id,
        manager_approved_by: null,
        manager_approved_at: null,
      }, { onConflict: "version_id,employee_id,holiday_date" });
      if (adjustment.error) throw new Error(adjustment.error.message);
      const update = await admin.from("staff_schedule_entries").update({
        entry_kind: "off",
        shift_template_id: null,
        shift_code: null,
        shift_label: null,
        starts_at: null,
        ends_at: null,
        break_minutes: 0,
        paid_break: false,
        counts_toward_middle_limit: false,
        off_kind: "holiday_adjustment",
        source: "holiday_adjustment",
        requires_resign: true,
        updated_by: profile.id,
      }).eq("version_id", String(version.id)).eq("employee_id", employeeId).eq("work_date", adjustedDayOff);
      if (update.error) throw new Error(update.error.message);
      await admin.from("staff_schedule_rule_results").update({
        passed: true,
        message: `已安排 ${adjustedDayOff} 為「${holidayName}」調休日。`,
        overridden_by: profile.id,
        override_reason: "已建立國定假日調移對應",
        overridden_at: new Date().toISOString(),
      }).eq("version_id", String(version.id)).eq("employee_id", employeeId).eq("work_date", holidayDate).eq("rule_code", "HOLIDAY_ADJUSTMENT_REQUIRED");
    } else if (body.action === "approve_holiday_adjustment") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "publish_schedule", message: "您沒有最終核准國定假日調移的權限" });
      const adjustmentId = z.string().uuid().parse(body.adjustmentId);
      const update = await admin.from("staff_holiday_adjustments").update({
        status: "manager_approved",
        manager_approved_by: profile.id,
        manager_approved_at: new Date().toISOString(),
      }).eq("id", adjustmentId).eq("tenant_id", tenantId).select("id").maybeSingle();
      if (update.error || !update.data) throw new Error("找不到國定假日調移項目");
    } else if (body.action === "override_rule") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有覆核班表警告的權限" });
      const ruleId = z.string().uuid().parse(body.ruleId);
      const reason = z.string().trim().min(3).max(2000).parse(body.reason);
      const result = await admin.from("staff_schedule_rule_results").update({
        override_reason: reason,
        overridden_by: profile.id,
        overridden_at: new Date().toISOString(),
      }).eq("id", ruleId).eq("tenant_id", tenantId).eq("severity", "warning").eq("passed", false).select("id, version_id, rule_code").maybeSingle();
      if (result.error || !result.data) throw new Error("找不到可覆核的班表警告");
      await writeAudit(admin, {
        tenantId,
        actorId: profile.id,
        action: "staff_schedule_rule_overridden",
        targetType: "staff_schedule_rule_result",
        targetId: ruleId,
        reason,
        payload: { versionId: result.data.version_id, ruleCode: result.data.rule_code },
      });
    } else if (body.action === "assistant_approve") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_schedule", message: "您沒有初審班表的權限" });
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      const version = period ? await getLatestVersion(admin, period.id) : null;
      if (!period || !version) throw new Error("找不到班表草稿");
      const [blocking, unoverriddenWarnings] = await Promise.all([
        admin.from("staff_schedule_rule_results").select("id, message").eq("version_id", String(version.id)).eq("severity", "blocking").eq("passed", false).limit(20),
        admin.from("staff_schedule_rule_results").select("id, message").eq("version_id", String(version.id)).eq("severity", "warning").eq("passed", false).is("overridden_at", null).limit(20),
      ]);
      if (blocking.error || unoverriddenWarnings.error) throw new Error(blocking.error?.message || unoverriddenWarnings.error?.message || "規則檢查失敗");
      if ((blocking.data || []).length > 0) throw new Error(`尚有 ${(blocking.data || []).length} 項法規阻擋，不能送經理審核`);
      if ((unoverriddenWarnings.data || []).length > 0) throw new Error(`尚有 ${(unoverriddenWarnings.data || []).length} 項警告未填寫覆核理由`);
      const approval = await admin.from("staff_schedule_approvals").upsert({
        version_id: version.id,
        period_id: period.id,
        tenant_id: tenantId,
        stage: "assistant_manager",
        decision: "approved",
        reason: typeof body.reason === "string" ? body.reason : null,
        decided_by: profile.id,
        decided_at: new Date().toISOString(),
      }, { onConflict: "version_id,stage" });
      if (approval.error) throw new Error(approval.error.message);
      await admin.from("staff_schedule_versions").update({ status: "manager_review" }).eq("id", String(version.id));
      await admin.from("staff_schedule_periods").update({ status: "manager_review" }).eq("id", period.id);
      await createInAppNotifications({
        supabase: admin,
        tenantId,
        recipientRoles: ["manager"],
        title: `${monthStart.slice(0, 7)} 正式班表等待終審`,
        message: "副理已完成初審，請經理逐筆檢查後發布。",
        eventType: "staff_schedule_manager_review",
        targetType: "staff_schedule_version",
        targetId: String(version.id),
        actionUrl: `/manager/staff-scheduling?month=${monthStart.slice(0, 7)}`,
        dedupeKey: `staff-schedule-manager-review:${version.id}`,
        createdBy: profile.id,
      });
    } else if (body.action === "manager_publish") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "publish_schedule", message: "您沒有終審及發布正式班表的權限" });
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      const version = period ? await getLatestVersion(admin, period.id) : null;
      if (!period || !version) throw new Error("找不到班表草稿");
      const assistantApproval = await admin.from("staff_schedule_approvals").select("id, decided_by").eq("version_id", String(version.id)).eq("stage", "assistant_manager").eq("decision", "approved").maybeSingle();
      if (assistantApproval.error || !assistantApproval.data) throw new Error("正式班表必須先由副理初審");
      if (String(assistantApproval.data.decided_by) === profile.id) throw new Error("副理初審與經理終審必須由不同帳號完成");
      const [blocking, unoverriddenWarnings, pendingAdjustments] = await Promise.all([
        admin.from("staff_schedule_rule_results").select("id").eq("version_id", String(version.id)).eq("severity", "blocking").eq("passed", false),
        admin.from("staff_schedule_rule_results").select("id").eq("version_id", String(version.id)).eq("severity", "warning").eq("passed", false).is("overridden_at", null),
        admin.from("staff_holiday_adjustments").select("id").eq("version_id", String(version.id)).neq("status", "manager_approved"),
      ]);
      if (blocking.error) throw new Error(blocking.error.message);
      if (unoverriddenWarnings.error) throw new Error(unoverriddenWarnings.error.message);
      if (pendingAdjustments.error) throw new Error(pendingAdjustments.error.message);
      if ((blocking.data || []).length > 0) throw new Error("仍有未排除的法規阻擋，不能發布");
      if ((unoverriddenWarnings.data || []).length > 0) throw new Error("仍有警告尚未填寫覆核理由，不能發布");
      if ((pendingAdjustments.data || []).length > 0) throw new Error("仍有國定假日調移尚未經理逐筆核准");
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const approval = await admin.from("staff_schedule_approvals").upsert({
        version_id: version.id,
        period_id: period.id,
        tenant_id: tenantId,
        stage: "manager",
        decision: "approved",
        reason: reason || null,
        decided_by: profile.id,
        decided_at: new Date().toISOString(),
      }, { onConflict: "version_id,stage" });
      if (approval.error) throw new Error(approval.error.message);
      const employeesResult = await admin.from("staff_schedule_entries").select("*").eq("version_id", String(version.id));
      if (employeesResult.error) throw new Error(employeesResult.error.message);
      const employeeIds = Array.from(new Set((employeesResult.data || []).map((row) => String(row.employee_id))));
      const affectedEmployeeIds = new Set((employeesResult.data || []).filter((row) => row.requires_resign).map((row) => String(row.employee_id)));
      const carriedForwardEmployeeIds = new Set<string>();
      if (version.based_on_version_id) {
        const [previousAcknowledgements, adjustmentResult] = await Promise.all([
          admin.from("staff_schedule_acknowledgements").select("*").eq("version_id", String(version.based_on_version_id)).in("status", ["signed", "carried_forward"]),
          admin.from("staff_holiday_adjustments").select("*").eq("version_id", String(version.id)),
        ]);
        if (previousAcknowledgements.error || adjustmentResult.error) {
          throw new Error(previousAcknowledgements.error?.message || adjustmentResult.error?.message || "無法承接既有簽署");
        }
        const carryRows = (previousAcknowledgements.data || []).flatMap((acknowledgement) => {
          const employeeId = String(acknowledgement.employee_id);
          if (affectedEmployeeIds.has(employeeId) || !employeeIds.includes(employeeId) || !acknowledgement.signed_at) return [];
          const scheduleSnapshot = (employeesResult.data || []).filter((row) => String(row.employee_id) === employeeId);
          const adjustmentSnapshot = (adjustmentResult.data || []).filter((row) => String(row.employee_id) === employeeId);
          const contentSha256 = createHash("sha256").update(JSON.stringify({ scheduleSnapshot, adjustmentSnapshot })).digest("hex");
          carriedForwardEmployeeIds.add(employeeId);
          return [{
            version_id: version.id,
            period_id: period.id,
            tenant_id: tenantId,
            employee_id: employeeId,
            status: "carried_forward",
            checkbox_confirmed: true,
            statement_snapshot: "本版本未變更此員工的班別、工時、休假或國定假日調移；沿用前一版本已完成的簽署。",
            schedule_snapshot: scheduleSnapshot,
            holiday_adjustment_snapshot: adjustmentSnapshot,
            signature_object_path: acknowledgement.signature_object_path,
            signature_sha256: acknowledgement.signature_sha256,
            signed_at: acknowledgement.signed_at,
            submitted_at: new Date().toISOString(),
            ip_hash: acknowledgement.ip_hash,
            user_agent: acknowledgement.user_agent,
            carried_forward_from_id: acknowledgement.id,
            content_sha256: contentSha256,
            device_information: acknowledgement.device_information || {},
          }];
        });
        if (carryRows.length > 0) {
          const carry = await admin.from("staff_schedule_acknowledgements").upsert(carryRows, { onConflict: "version_id,employee_id" });
          if (carry.error) throw new Error(carry.error.message);
        }
      }
      await admin.from("staff_schedule_versions").update({ status: "superseded" }).eq("period_id", period.id).eq("status", "published").neq("id", String(version.id));
      await admin.from("staff_schedule_versions").update({ status: "published", published_by: profile.id, published_at: new Date().toISOString() }).eq("id", String(version.id));
      await admin.from("staff_schedule_periods").update({ status: "published" }).eq("id", period.id);
      const pendingSignatureEmployeeIds = employeeIds.filter((employeeId) => !carriedForwardEmployeeIds.has(employeeId));
      await createInAppNotifications({
        supabase: admin,
        tenantId,
        recipientUserIds: pendingSignatureEmployeeIds,
        title: `${monthStart.slice(0, 7)} 正式班表已發布`,
        message: "請在 3 天內查看自己的班表；確認內容與國定假日調移後，以手機完成簽名。",
        eventType: "staff_schedule_published",
        targetType: "staff_schedule_version",
        targetId: String(version.id),
        actionUrl: `/staff/schedule?month=${monthStart.slice(0, 7)}`,
        dedupeKey: `staff-schedule-published:${version.id}`,
        createdBy: profile.id,
      });
      await writeAudit(admin, {
        tenantId,
        actorId: profile.id,
        action: "staff_schedule_published",
        targetType: "staff_schedule_version",
        targetId: String(version.id),
        reason: reason || null,
        payload: {
          monthStart,
          versionNumber: version.version_number,
          pendingSignatureEmployeeIds,
          carriedForwardEmployeeIds: Array.from(carriedForwardEmployeeIds),
        },
      });
    } else if (body.action === "sign_schedule") {
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      const version = period ? await getLatestVersion(admin, period.id, true) : null;
      if (!period || !version) throw new Error("目前沒有待簽的正式班表");
      if (body.checkboxConfirmed !== true) throw new Error("請先勾選已閱讀並同意班表內容");
      const signatureDataUrl = z.string().startsWith("data:image/").max(8_000_000).parse(body.signatureDataUrl);
      const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(signatureDataUrl);
      if (!match) throw new Error("簽名圖片格式不支援");
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.byteLength === 0 || buffer.byteLength > 5 * 1024 * 1024) throw new Error("簽名圖片大小不正確");
      const extension = match[1] === "jpeg" ? "jpg" : match[1];
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const objectPath = `${tenantId}/${profile.id}/${version.id}-${Date.now()}.${extension}`;
      const upload = await admin.storage.from("staff-signatures").upload(objectPath, buffer, {
        contentType: `image/${match[1]}`,
        upsert: false,
      });
      if (upload.error) throw new Error(upload.error.message);
      const [entriesResult, adjustmentsResult] = await Promise.all([
        admin.from("staff_schedule_entries").select("work_date, entry_kind, shift_label, starts_at, ends_at, off_kind").eq("version_id", String(version.id)).eq("employee_id", profile.id).order("work_date"),
        admin.from("staff_holiday_adjustments").select("holiday_date, holiday_name, original_shift_summary, adjusted_day_off").eq("version_id", String(version.id)).eq("employee_id", profile.id).order("holiday_date"),
      ]);
      if (entriesResult.error) throw new Error(entriesResult.error.message);
      if (adjustmentsResult.error) throw new Error(adjustmentsResult.error.message);
      const statement = "本人已逐日確認本月份正式班表、例假日、休息日及所列國定假日調移內容，並以本次手機簽名確認。";
      const contentSha256 = createHash("sha256").update(JSON.stringify({
        versionId: version.id,
        entries: entriesResult.data || [],
        holidayAdjustments: adjustmentsResult.data || [],
        statement,
      })).digest("hex");
      const insert = await admin.from("staff_schedule_acknowledgements").upsert({
        version_id: version.id,
        period_id: period.id,
        tenant_id: tenantId,
        employee_id: profile.id,
        status: "signed",
        checkbox_confirmed: true,
        statement_snapshot: statement,
        schedule_snapshot: entriesResult.data || [],
        holiday_adjustment_snapshot: adjustmentsResult.data || [],
        signature_object_path: objectPath,
        signature_sha256: sha256,
        content_sha256: contentSha256,
        signed_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        ip_hash: createHash("sha256").update(request.headers.get("x-forwarded-for") || "unknown").digest("hex"),
        user_agent: (request.headers.get("user-agent") || "").slice(0, 500),
        device_information: {
          platform: (request.headers.get("sec-ch-ua-platform") || "").slice(0, 100),
          mobile: (request.headers.get("sec-ch-ua-mobile") || "").slice(0, 20),
        },
      }, { onConflict: "version_id,employee_id" });
      if (insert.error) throw new Error(insert.error.message);
      await admin.from("staff_holiday_adjustments").update({ status: "employee_signed" }).eq("version_id", String(version.id)).eq("employee_id", profile.id);
      await writeAudit(admin, {
        tenantId,
        actorId: profile.id,
        action: "staff_schedule_signed",
        targetType: "staff_schedule_acknowledgement",
        targetId: String(version.id),
        payload: { versionId: version.id, contentSha256, signatureSha256: sha256 },
      });
    } else if (body.action === "object_schedule") {
      const period = await getPeriod(admin, tenantId, profile.branch_id, monthStart);
      const version = period ? await getLatestVersion(admin, period.id, true) : null;
      if (!period || !version) throw new Error("目前沒有可提出異議的正式班表");
      const objectionReason = z.string().trim().min(3).max(2000).parse(body.objectionReason);
      const insert = await admin.from("staff_schedule_acknowledgements").upsert({
        version_id: version.id,
        period_id: period.id,
        tenant_id: tenantId,
        employee_id: profile.id,
        status: "objected",
        checkbox_confirmed: false,
        statement_snapshot: "員工對本版正式班表提出異議。",
        objection_reason: objectionReason,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "version_id,employee_id" });
      if (insert.error) throw new Error(insert.error.message);
      await createInAppNotifications({
        supabase: admin,
        tenantId,
        recipientRoles: ["supervisor", "manager"],
        title: "員工對正式班表提出異議",
        message: `${profile.display_name || profile.employee_number || "員工"}：${objectionReason}`,
        severity: "warning",
        eventType: "staff_schedule_objected",
        targetType: "staff_schedule_version",
        targetId: String(version.id),
        actionUrl: `/manager/staff-scheduling?month=${monthStart.slice(0, 7)}`,
        dedupeKey: `staff-schedule-objected:${version.id}:${profile.id}`,
        createdBy: profile.id,
      });
    } else {
      return apiError(400, "FORBIDDEN", "不支援的班表操作");
    }

    const state = await buildState({ admin, profile, context: auth.context, monthStart });
    return apiSuccess(state);
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues[0]?.message || "欄位格式錯誤"
      : error instanceof Error
        ? error.message
        : "班表操作失敗";
    return apiError(400, "FORBIDDEN", message);
  }
}
