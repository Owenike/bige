import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dateAfter,
  listMonthDates,
  validateSchedule,
  type EmployeeScheduleConfig,
  type OffKind,
  type ScheduleEntryDraft,
} from "./staff-scheduling";

type LeaveForSchedule = {
  id: string;
  employee_id: string;
  leave_type: string;
  starts_at: string;
  ends_at: string;
  unit: string;
};

const leaveKinds: Record<string, OffKind> = {
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
  annual: "特休",
  sick: "病假",
  personal: "事假",
  family_care: "家庭照顧假",
  marriage: "婚假",
  bereavement: "喪假",
  official: "公假",
  other: "其他假",
};

function taiwanDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

function leaveDates(leave: LeaveForSchedule) {
  const start = taiwanDate(leave.starts_at);
  const endValue = new Date(leave.ends_at);
  const end = taiwanDate(new Date(endValue.getTime() - 1));
  const dates: string[] = [];
  for (let current = start; current <= end; current = dateAfter(current, 1)) dates.push(current);
  return dates;
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

async function revalidateVersion(params: {
  supabase: SupabaseClient;
  tenantId: string;
  period: Record<string, unknown>;
  versionId: string;
  monthStart: string;
}) {
  const { supabase, tenantId, period, versionId, monthStart } = params;
  const monthEnd = listMonthDates(monthStart).at(-1) || monthStart;
  const [entries, employments, profiles, holidays, boundaries, adjustments] = await Promise.all([
    supabase.from("staff_schedule_entries").select("*").eq("version_id", versionId),
    supabase.from("staff_employment_profiles").select("employee_id, employment_type, work_group, default_shift_code, is_original_early_shift, can_cover_early_shift, counts_toward_middle_limit").eq("tenant_id", tenantId),
    supabase.from("profiles").select("id, display_name, english_name, employee_number").eq("tenant_id", tenantId),
    supabase.from("staff_holiday_calendar").select("holiday_date, holiday_name").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).gte("holiday_date", monthStart).lte("holiday_date", monthEnd),
    supabase.from("staff_schedule_entries").select("*, staff_schedule_versions!inner(status)").eq("tenant_id", tenantId).eq("staff_schedule_versions.status", "published").gte("work_date", dateAfter(monthStart, -6)).lte("work_date", dateAfter(monthEnd, 6)),
    supabase.from("staff_holiday_adjustments").select("employee_id, holiday_date, adjusted_day_off, status").eq("version_id", versionId),
  ]);
  const error = entries.error || employments.error || profiles.error || holidays.error || boundaries.error || adjustments.error;
  if (error) throw new Error(error.message);
  const profileMap = new Map((profiles.data || []).map((row) => [String(row.id), row]));
  const configs = (employments.data || []).map((employment) => {
    const profile = profileMap.get(String(employment.employee_id));
    if (!profile) return null;
    return {
      employeeId: String(employment.employee_id),
      displayName: String(profile.display_name || profile.english_name || profile.employee_number || "未命名員工"),
      employmentType: employment.employment_type,
      workGroup: employment.work_group,
      defaultShiftCode: String(employment.default_shift_code),
      isOriginalEarlyShift: Boolean(employment.is_original_early_shift),
      canCoverEarlyShift: Boolean(employment.can_cover_early_shift),
      countsTowardMiddleLimit: Boolean(employment.counts_toward_middle_limit),
    } as EmployeeScheduleConfig;
  }).filter((row): row is EmployeeScheduleConfig => !!row);
  const currentEntries = (entries.data || []).map((row) => mapEntry(row));
  const contextEntries = (boundaries.data || [])
    .filter((row) => String(row.work_date) < monthStart || String(row.work_date) > monthEnd)
    .map((row) => mapEntry(row));
  const adjustmentMap = new Map((adjustments.data || []).map((row) => [`${row.employee_id}:${row.holiday_date}`, row]));
  const rules = validateSchedule({
    monthStart,
    employees: configs,
    entries: currentEntries,
    contextEntries,
    preferenceDailyLimit: Number(period.middle_preference_daily_limit || 2),
    holidays: (holidays.data || []).map((row) => ({ date: String(row.holiday_date), name: String(row.holiday_name) })),
  }).map((rule) => {
    if (rule.ruleCode !== "HOLIDAY_ADJUSTMENT_REQUIRED" || !rule.employeeId || !rule.workDate) return rule;
    const adjustment = adjustmentMap.get(`${rule.employeeId}:${rule.workDate}`);
    const adjustedEntry = adjustment
      ? currentEntries.find((entry) => entry.employeeId === rule.employeeId && entry.workDate === adjustment.adjusted_day_off)
      : null;
    if (!adjustment || !["manager_approved", "employee_signed"].includes(String(adjustment.status)) || adjustedEntry?.offKind !== "holiday_adjustment") return rule;
    return { ...rule, passed: true, message: `已安排 ${adjustment.adjusted_day_off} 為國定假日調休日。` };
  });
  const remove = await supabase.from("staff_schedule_rule_results").delete().eq("version_id", versionId);
  if (remove.error) throw new Error(remove.error.message);
  if (rules.length > 0) {
    const insert = await supabase.from("staff_schedule_rule_results").insert(rules.map((rule) => ({
      version_id: versionId,
      period_id: String(period.id),
      tenant_id: tenantId,
      employee_id: rule.employeeId,
      work_date: rule.workDate,
      rule_code: rule.ruleCode,
      severity: rule.severity,
      passed: rule.passed,
      message: rule.message,
      details: rule.details,
    })));
    if (insert.error) throw new Error(insert.error.message);
  }
}

export async function syncApprovedLeaveToSchedule(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  actorId: string;
  leave: LeaveForSchedule;
}) {
  const { supabase, tenantId, branchId, actorId, leave } = params;
  const dates = leaveDates(leave);
  const monthStart = `${dates[0].slice(0, 7)}-01`;
  let periodQuery = supabase.from("staff_schedule_periods").select("*").eq("tenant_id", tenantId).eq("month_start", monthStart);
  periodQuery = branchId ? periodQuery.eq("branch_id", branchId) : periodQuery.is("branch_id", null);
  const periodResult = await periodQuery.maybeSingle();
  if (periodResult.error) throw new Error(periodResult.error.message);
  if (!periodResult.data) return { synced: false as const, reason: "schedule_period_missing" as const };
  const period = periodResult.data as Record<string, unknown>;
  const latest = await supabase.from("staff_schedule_versions").select("*").eq("period_id", String(period.id)).order("version_number", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw new Error(latest.error.message);
  if (!latest.data) return { synced: false as const, reason: "schedule_version_missing" as const };

  let version = latest.data as Record<string, unknown>;
  if (version.status === "published") {
    const clone = await supabase.from("staff_schedule_versions").insert({
      period_id: period.id,
      tenant_id: tenantId,
      version_number: Number(version.version_number) + 1,
      status: "draft",
      based_on_version_id: version.id,
      change_summary: "核准請假已自動帶入；受影響員工須重新簽名",
      created_by: actorId,
    }).select("*").single();
    if (clone.error) throw new Error(clone.error.message);
    const [sourceEntries, sourceAdjustments] = await Promise.all([
      supabase.from("staff_schedule_entries").select("*").eq("version_id", String(version.id)),
      supabase.from("staff_holiday_adjustments").select("*").eq("version_id", String(version.id)),
    ]);
    if (sourceEntries.error || sourceAdjustments.error) throw new Error(sourceEntries.error?.message || sourceAdjustments.error?.message || "讀取舊班表失敗");
    const clonedEntries = (sourceEntries.data || []).map((row) => {
      const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = row;
      return { ...rest, version_id: clone.data.id, requires_resign: row.employee_id === leave.employee_id, created_by: actorId, updated_by: actorId };
    });
    if (clonedEntries.length > 0) {
      const insert = await supabase.from("staff_schedule_entries").insert(clonedEntries);
      if (insert.error) throw new Error(insert.error.message);
    }
    const clonedAdjustments = (sourceAdjustments.data || []).map((row) => {
      const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = row;
      const affected = row.employee_id === leave.employee_id;
      return {
        ...rest,
        version_id: clone.data.id,
        status: affected ? "draft" : row.status,
        manager_approved_by: affected ? null : row.manager_approved_by,
        manager_approved_at: affected ? null : row.manager_approved_at,
      };
    });
    if (clonedAdjustments.length > 0) {
      const insert = await supabase.from("staff_holiday_adjustments").insert(clonedAdjustments);
      if (insert.error) throw new Error(insert.error.message);
    }
    version = clone.data as Record<string, unknown>;
  } else {
    const reset = await supabase.from("staff_schedule_versions").update({
      status: "draft",
      change_summary: "核准請假已自動帶入；受影響員工須重新簽名",
    }).eq("id", String(version.id));
    if (reset.error) throw new Error(reset.error.message);
    await supabase.from("staff_schedule_approvals").delete().eq("version_id", String(version.id));
    await supabase.from("staff_holiday_adjustments").update({
      status: "draft",
      manager_approved_by: null,
      manager_approved_at: null,
    }).eq("version_id", String(version.id)).eq("employee_id", leave.employee_id);
  }

  const label = leaveLabels[leave.leave_type] || "請假";
  for (const workDate of dates) {
    const fullDayPatch = {
      entry_kind: "off",
      shift_template_id: null,
      shift_code: null,
      shift_label: null,
      starts_at: null,
      ends_at: null,
      break_minutes: 0,
      paid_break: false,
      counts_toward_middle_limit: false,
      off_kind: leaveKinds[leave.leave_type] || "other_leave",
      source: "leave",
      source_reference_id: leave.id,
      employee_visible_note: label,
      requires_resign: true,
      updated_by: actorId,
    };
    const partialPatch = {
      source: "leave",
      source_reference_id: leave.id,
      employee_visible_note: `${label}（部分時段）`,
      requires_resign: true,
      updated_by: actorId,
    };
    const update = await supabase.from("staff_schedule_entries").update(leave.unit === "full_day" ? fullDayPatch : partialPatch)
      .eq("version_id", String(version.id)).eq("employee_id", leave.employee_id).eq("work_date", workDate);
    if (update.error) throw new Error(update.error.message);
  }
  await revalidateVersion({ supabase, tenantId, period, versionId: String(version.id), monthStart });
  const periodUpdate = await supabase.from("staff_schedule_periods").update({ status: "drafting" }).eq("id", String(period.id));
  if (periodUpdate.error) throw new Error(periodUpdate.error.message);
  return { synced: true as const, versionId: String(version.id), monthStart };
}
