"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isSharedFrontdeskScheduleAccount,
  missingScheduleCellKeys,
  staffScheduleEntryOffLabel,
  staffScheduleGridWorkLabel,
  staffScheduleOffLabel,
  staffScheduleShiftLabel,
} from "../lib/staff-scheduling";
import styles from "../app/manager/staff-scheduling/page.module.css";

type Employment = {
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
  annual_leave_balance_days: number;
  accrued_leave_balance_days: number;
};

type Employee = {
  id: string;
  displayName: string;
  englishName: string | null;
  employeeNumber: string | null;
  department: string | null;
  position: string | null;
  employment: Employment | null;
};

type ScheduleEntry = {
  id: string;
  employeeId: string;
  workDate: string;
  entryKind: "work" | "off";
  shiftCode: string | null;
  shiftLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
  offKind: string | null;
  source: string;
  employeeVisibleNote?: string | null;
  requiresResign: boolean;
};

type ShiftChoice = "COACH_EARLY" | "COACH_MIDDLE" | "COACH_PARTTIME_WEEKDAY" | "DEFAULT";
type DayOffChoice = "rest_day" | "regular_day_off";

const SHIFT_PREVIEWS: Record<Exclude<ShiftChoice, "DEFAULT">, Pick<ScheduleEntry, "shiftCode" | "shiftLabel" | "startsAt" | "endsAt">> = {
  COACH_EARLY: { shiftCode: "COACH_EARLY", shiftLabel: "早班", startsAt: "10:00", endsAt: "19:00" },
  COACH_MIDDLE: { shiftCode: "COACH_MIDDLE", shiftLabel: "中班", startsAt: "14:00", endsAt: "23:00" },
  COACH_PARTTIME_WEEKDAY: { shiftCode: "COACH_PARTTIME_WEEKDAY", shiftLabel: "晚班", startsAt: "18:00", endsAt: "22:00" },
};

const SCHEDULE_LOAD_TIMEOUT_MS = 20_000;
const SCHEDULE_CHANGE_HIGHLIGHT_MS = 60_000;

function scheduleEntryKey(employeeId: string, workDate: string) {
  return `${employeeId}:${workDate}`;
}

type RuleResult = {
  id: string;
  employee_id: string | null;
  work_date: string | null;
  rule_code: string;
  severity: "info" | "warning" | "blocking";
  passed: boolean;
  message: string;
  details: Record<string, unknown>;
  override_reason: string | null;
  overridden_at: string | null;
};

type ScheduleState = {
  actor: {
    id: string;
    displayName: string | null;
    role: string;
    position: string | null;
    canManage: boolean;
    canFinalApprove: boolean;
  };
  monthStart: string;
  period: null | {
    id: string;
    status: string;
    selection_opens_at: string;
    selection_closes_at: string;
    preferred_days_required: number;
    middle_preference_daily_limit: number;
  };
  employees: Employee[];
  preferences: Array<{
    employee_id: string;
    status: string;
    submitted_at: string | null;
    staff_time_off_preference_dates?: Array<{ requested_date: string; source: string }>;
  }>;
  facilityClosures: Array<{ id: string; closure_date: string }>;
  holidays: Array<{ holiday_date: string; holiday_name: string }>;
  version: null | { id: string; version_number: number; status: string; published_at: string | null };
  scheduleEntries: ScheduleEntry[];
  ruleResults: RuleResult[];
  holidayAdjustments: Array<{
    id: string;
    employee_id: string;
    holiday_date: string;
    holiday_name: string;
    adjusted_day_off: string;
    status: string;
  }>;
};

type ScheduleEntryPatch = {
  action: "assign_shift" | "assign_day_off";
  entry: ScheduleEntry;
  ruleResults: RuleResult[];
  version: ScheduleState["version"];
  periodStatus: string;
};

function nextMonthValue() {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
}

function monthDates(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function weekday(date: string) {
  return ["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T12:00:00+08:00`).getDay()];
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function stateLabel(status: string) {
  return {
    selection_open: "員工選休中",
    selection_closed: "選休截止",
    drafting: "副理排班中",
    manager_review: "等待經理終審",
    published: "正式發布",
    draft: "草稿",
    assistant_review: "副理初審",
  }[status] || status;
}

function formatDays(value: number | null | undefined) {
  const days = Number(value || 0);
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

async function parseResponse<T = ScheduleState>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as T;
}

function scheduleTone(entry: ScheduleEntry | undefined) {
  if (!entry || entry.entryKind === "off") return "off";
  if (["FRONTDESK_DAY", "COACH_EARLY"].includes(entry.shiftCode || "")) return "early";
  if (entry.shiftCode === "COACH_PARTTIME_WEEKDAY") return "late";
  return "middle";
}

function applyShiftPreview(current: ScheduleState | null, employeeId: string, workDate: string, shiftCode: ShiftChoice) {
  if (!current || shiftCode === "DEFAULT") return current;
  const preview = SHIFT_PREVIEWS[shiftCode];
  return {
    ...current,
    scheduleEntries: current.scheduleEntries.map((entry) => entry.employeeId === employeeId && entry.workDate === workDate
      ? { ...entry, ...preview, source: "supervisor", requiresResign: true }
      : entry),
  };
}

function applyScheduleEntryPatch(current: ScheduleState | null, patch: ScheduleEntryPatch) {
  if (!current) return current;
  return {
    ...current,
    version: patch.version,
    period: current.period ? { ...current.period, status: patch.periodStatus } : current.period,
    scheduleEntries: current.scheduleEntries.map((entry) => entry.employeeId === patch.entry.employeeId && entry.workDate === patch.entry.workDate ? patch.entry : entry),
    ruleResults: patch.ruleResults,
  };
}

export default function StaffScheduleManager() {
  const [month, setMonth] = useState(nextMonthValue);
  const [data, setData] = useState<ScheduleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [setupDialog, setSetupDialog] = useState<"progress" | "shifts" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [closureDate, setClosureDate] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [middleDailyLimit, setMiddleDailyLimit] = useState(2);
  const [adjustedDates, setAdjustedDates] = useState<Record<string, string>>({});
  const [recentlyChangedEntryKeys, setRecentlyChangedEntryKeys] = useState<Set<string>>(() => new Set());
  const recentChangeTimersRef = useRef(new Map<string, number>());
  const syncedDraftVersionsRef = useRef(new Set<string>());
  const setupDialogRef = useRef<HTMLDialogElement>(null);
  const dates = useMemo(() => monthDates(month), [month]);

  const highlightChangedEntries = useCallback((entries: Array<{ employeeId: string; workDate: string }>) => {
    const keys = entries.map((entry) => scheduleEntryKey(entry.employeeId, entry.workDate));
    setRecentlyChangedEntryKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => next.add(key));
      return next;
    });

    keys.forEach((key) => {
      const existingTimer = recentChangeTimersRef.current.get(key);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        recentChangeTimersRef.current.delete(key);
        setRecentlyChangedEntryKeys((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }, SCHEDULE_CHANGE_HIGHLIGHT_MS);
      recentChangeTimersRef.current.set(key, timer);
    });
  }, []);

  useEffect(() => {
    const timers = recentChangeTimersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const dialog = setupDialogRef.current;
    if (!dialog) return;
    if (setupDialog && !dialog.open) dialog.showModal();
    if (!setupDialog && dialog.open) dialog.close();
  }, [setupDialog]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SCHEDULE_LOAD_TIMEOUT_MS);
    try {
      const response = await fetch(`/api/staff-scheduling?month=${month}&view=team`, {
        cache: "no-store",
        signal: controller.signal,
      });
      setData(await parseResponse(response));
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "班表讀取超過 20 秒，已停止等待。請按下方按鈕重新讀取。"
          : caught instanceof Error
            ? caught.message
            : "讀取失敗",
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setClosureDate(data?.facilityClosures[0]?.closure_date || "");
  }, [data?.facilityClosures]);

  useEffect(() => {
    if (data?.period) setMiddleDailyLimit(data.period.middle_preference_daily_limit);
  }, [data?.period]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function act(action: string, values: Record<string, unknown> = {}, successMessage = "已完成") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/staff-scheduling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, monthStart: `${month}-01`, view: "team", ...values }),
      });
      setData(await parseResponse(response));
      setNotice(successMessage);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失敗");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function assignShift(employeeId: string, workDate: string, shiftCode: ShiftChoice) {
    const previousData = data;
    setBusy(true);
    setError("");
    setNotice("班別已套用，正在儲存並檢查規則…");
    setData((current) => applyShiftPreview(current, employeeId, workDate, shiftCode));
    try {
      const response = await fetch("/api/staff-scheduling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "assign_shift",
          monthStart: `${month}-01`,
          view: "team",
          employeeId,
          workDate,
          shiftCode,
          confirmed: true,
          compactResponse: data?.version?.status !== "published",
        }),
      });
      const result = await parseResponse<ScheduleState | ScheduleEntryPatch>(response);
      if ((result as ScheduleEntryPatch).action === "assign_shift") {
        setData((current) => applyScheduleEntryPatch(current, result as ScheduleEntryPatch));
      } else {
        setData(result as ScheduleState);
      }
      setNotice("個別班次已更新，合法性檢查已重新執行");
      return true;
    } catch (caught) {
      setData(previousData);
      setNotice("");
      setError(caught instanceof Error ? `${caught.message}；班別已恢復原狀。` : "操作失敗；班別已恢復原狀。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function assignDayOff(employeeId: string, workDate: string, offKind: DayOffChoice) {
    const previousData = data;
    setBusy(true);
    setError("");
    setNotice("休假已套用，正在儲存並檢查規則…");
    setData((current) => current ? {
      ...current,
      scheduleEntries: current.scheduleEntries.map((entry) => entry.employeeId === employeeId && entry.workDate === workDate
        ? {
            ...entry,
            entryKind: "off",
            shiftCode: null,
            shiftLabel: null,
            startsAt: null,
            endsAt: null,
            offKind,
            source: "supervisor",
            employeeVisibleNote: null,
            requiresResign: true,
          }
        : entry),
    } : current);
    try {
      const response = await fetch("/api/staff-scheduling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "assign_day_off",
          monthStart: `${month}-01`,
          view: "team",
          employeeId,
          workDate,
          offKind,
          confirmed: true,
          compactResponse: data?.version?.status !== "published",
        }),
      });
      const result = await parseResponse<ScheduleState | ScheduleEntryPatch>(response);
      if ((result as ScheduleEntryPatch).action === "assign_day_off") {
        setData((current) => applyScheduleEntryPatch(current, result as ScheduleEntryPatch));
      } else {
        setData(result as ScheduleState);
      }
      setNotice(`${offKind === "regular_day_off" ? "例假" : "休假"}已更新，合法性檢查已重新執行`);
      return true;
    } catch (caught) {
      setData(previousData);
      setNotice("");
      setError(caught instanceof Error ? `${caught.message}；休假設定已恢復原狀。` : "操作失敗；休假設定已恢復原狀。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const preferenceMap = useMemo(
    () => new Map((data?.preferences || []).map((item) => [item.employee_id, item])),
    [data?.preferences],
  );
  const entryMap = useMemo(
    () => new Map((data?.scheduleEntries || []).map((entry) => [`${entry.employeeId}:${entry.workDate}`, entry])),
    [data?.scheduleEntries],
  );
  const scheduleEmployees = useMemo(() => (data?.employees || []).filter((employee) =>
    !isSharedFrontdeskScheduleAccount(employee.employeeNumber)
  ), [data?.employees]);
  const employeeMap = useMemo(() => new Map(scheduleEmployees.map((employee) => [employee.id, employee])), [scheduleEmployees]);
  const incompleteEmployees = scheduleEmployees.filter((employee) => preferenceMap.get(employee.id)?.status !== "submitted");
  const blockingRules = data?.ruleResults.filter((rule) => !rule.passed && rule.severity === "blocking") || [];
  const warningRules = data?.ruleResults.filter((rule) => !rule.passed && rule.severity === "warning") || [];
  const holidayRules = blockingRules.filter((rule) => rule.rule_code === "HOLIDAY_ADJUSTMENT_REQUIRED");
  const holidayRuleGroups = Array.from(holidayRules.reduce((groups, rule) => {
    const holiday = data?.holidays.find((item) => item.holiday_date === rule.work_date);
    const holidayName = holiday?.holiday_name || String(rule.details.holidayName || "國定假日");
    const key = `${rule.work_date || "unknown"}:${holidayName}`;
    const group = groups.get(key) || { workDate: rule.work_date, holidayName, rules: [] as RuleResult[] };
    group.rules.push(rule);
    groups.set(key, group);
    return groups;
  }, new Map<string, { workDate: string | null; holidayName: string; rules: RuleResult[] }>()).values());
  const visibleEmployees = scheduleEmployees;
  const dailyStats = useMemo(() => new Map(dates.map((date) => {
    const rows = visibleEmployees.map((employee) => entryMap.get(`${employee.id}:${date}`)).filter(Boolean);
    return [date, { work: rows.filter((entry) => entry?.entryKind === "work").length, off: rows.filter((entry) => entry?.entryKind === "off").length }];
  })), [dates, entryMap, visibleEmployees]);
  const selectedPreferenceRows = useMemo(() => (data?.preferences || []).flatMap((preference) => {
    if (preference.status !== "submitted") return [];
    const selectedDates = (preference.staff_time_off_preference_dates || [])
      .filter((item) => item.source === "employee")
      .map((item) => item.requested_date)
      .sort();
    if (selectedDates.length === 0) return [];
    const employee = scheduleEmployees.find((item) => item.id === preference.employee_id);
    return employee ? [{ employee, selectedDates }] : [];
  }), [data?.preferences, scheduleEmployees]);
  const missingScheduleCellCount = data?.version
    ? missingScheduleCellKeys({
        monthStart: `${month}-01`,
        employeeIds: scheduleEmployees.map((employee) => employee.id),
        entries: data.scheduleEntries,
      }).length
    : 0;

  useEffect(() => {
    const version = data?.version;
    if (!version || version.status !== "draft" || missingScheduleCellCount === 0 || busy) return;
    const syncKey = `${month}:${version.id}`;
    if (syncedDraftVersionsRef.current.has(syncKey)) return;
    syncedDraftVersionsRef.current.add(syncKey);
    void act("sync_missing_draft_cells", {}, "已將新進員工補入目前草稿，既有排班保持不變");
  }, [busy, data?.version, missingScheduleCellCount, month]);

  async function saveEmployee(employee: Employee, patch: Partial<Employment>) {
    const current = { ...employee.employment, ...patch } as Employment;
    await act("configure_employee", {
      employeeId: employee.id,
      employmentType: current.employment_type,
      payBasis: current.pay_basis,
      workGroup: current.work_group,
      monthlySalary: current.monthly_salary,
      hourlyRate: current.hourly_rate,
      defaultShiftCode: current.default_shift_code,
      isOriginalEarlyShift: current.is_original_early_shift,
      canCoverEarlyShift: current.can_cover_early_shift,
      countsTowardMiddleLimit: current.counts_toward_middle_limit,
      annualLeaveBalanceDays: current.annual_leave_balance_days,
      accruedLeaveBalanceDays: current.accrued_leave_balance_days,
    }, `${employee.displayName}的班別設定已更新`);
  }

  function exportPng() {
    if (!data?.version || visibleEmployees.length === 0) return;
    const nameWidth = 250;
    const cellWidth = 96;
    const headerHeight = 62;
    const rowHeight = 72;
    const canvas = document.createElement("canvas");
    canvas.width = nameWidth + dates.length * cellWidth;
    canvas.height = 76 + headerHeight + visibleEmployees.length * rowHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#173b67"; context.fillRect(0, 0, canvas.width, 76);
    context.fillStyle = "#ffffff"; context.font = "bold 25px sans-serif"; context.fillText(`巨挺健身館｜${month} 全員班表 V${data.version.version_number}`, 18, 34);
    context.font = "14px sans-serif"; context.fillText(`篩選結果 ${visibleEmployees.length} 人｜${stateLabel(data.version.status)}`, 18, 59);
    const top = 76;
    context.textAlign = "center"; context.textBaseline = "middle";
    dates.forEach((date, index) => { const x = nameWidth + index * cellWidth; const weekend = [0, 6].includes(new Date(`${date}T12:00:00+08:00`).getDay()); context.fillStyle = weekend ? "#ffe7e1" : "#eaf0f7"; context.fillRect(x, top, cellWidth, headerHeight); context.fillStyle = weekend ? "#9c322b" : "#26384e"; context.font = "bold 14px sans-serif"; context.fillText(`${Number(date.slice(-2))}（${weekday(date)}）`, x + cellWidth / 2, top + headerHeight / 2); });
    context.fillStyle = "#eaf0f7"; context.fillRect(0, top, nameWidth, headerHeight); context.fillStyle = "#26384e"; context.fillText("員工", nameWidth / 2, top + headerHeight / 2);
    visibleEmployees.forEach((employee, rowIndex) => { const y = top + headerHeight + rowIndex * rowHeight; context.fillStyle = "#f8fafc"; context.fillRect(0, y, nameWidth, rowHeight); context.textAlign = "left"; context.fillStyle = "#172235"; context.font = "bold 14px sans-serif"; context.fillText(`${employee.displayName}${employee.englishName || "未設定英文名"}　特休${formatDays(employee.employment?.annual_leave_balance_days)}　積假${formatDays(employee.employment?.accrued_leave_balance_days)}`, 10, y + rowHeight / 2); dates.forEach((date, index) => { const entry = entryMap.get(`${employee.id}:${date}`); const x = nameWidth + index * cellWidth; const tone = scheduleTone(entry); context.fillStyle = tone === "off" ? "#fee2e2" : tone === "early" ? "#ffedd5" : tone === "late" ? "#dbeafe" : "#ffffff"; context.fillRect(x, y, cellWidth, rowHeight); context.textAlign = "center"; context.fillStyle = tone === "off" ? "#991b1b" : tone === "early" ? "#9a3412" : tone === "late" ? "#1e40af" : "#26384e"; context.font = "bold 14px sans-serif"; const title = entry?.entryKind === "off" ? staffScheduleEntryOffLabel(entry) : staffScheduleGridWorkLabel(entry || {}, employee.employeeNumber, date); context.fillText(title.slice(0, 12), x + cellWidth / 2, y + rowHeight / 2); }); });
    context.strokeStyle = "#cfd8e5"; context.lineWidth = 1; for (let x = 0; x <= canvas.width; x += x === 0 ? nameWidth : cellWidth) { context.beginPath(); context.moveTo(x, top); context.lineTo(x, canvas.height); context.stroke(); if (x === 0) x = nameWidth - cellWidth; } for (let y = top; y <= canvas.height; y += y === top ? headerHeight : rowHeight) { context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); if (y === top) y = top + headerHeight - rowHeight; }
    canvas.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `巨挺健身館-${month}-班表.png`; anchor.click(); URL.revokeObjectURL(url); }, "image/png");
  }

  function dragStart(event: React.DragEvent, entry: ScheduleEntry) {
    if (entry.entryKind !== "off") return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "day_off", employeeId: entry.employeeId, fromDate: entry.workDate }));
  }

  function shiftDragStart(event: React.DragEvent, shiftCode: ShiftChoice) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "shift", shiftCode }));
  }

  function dayOffDragStart(event: React.DragEvent, offKind: DayOffChoice) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "assign_day_off", offKind }));
  }

  async function dropOn(event: React.DragEvent, employeeId: string, toDate: string) {
    event.preventDefault();
    let payload:
      | { kind: "day_off"; employeeId: string; fromDate: string }
      | { kind: "shift"; shiftCode: ShiftChoice }
      | { kind: "assign_day_off"; offKind: DayOffChoice }
      | null = null;
    try {
      payload = JSON.parse(event.dataTransfer.getData("application/json"));
    } catch {
      return;
    }
    if (!payload) return;
    const employee = employeeMap.get(employeeId);
    const target = entryMap.get(`${employeeId}:${toDate}`);
    if (payload.kind === "shift") {
      if (!target) {
        setError("找不到這個日期的班表格，請重新整理後再試一次。");
        return;
      }
      if (payload.shiftCode === "DEFAULT" && target.entryKind === "off" && !["rest_day", "regular_day_off"].includes(target.offKind || "")) {
        setError("館休、國休或國定假日調休日不能用復原覆蓋。");
        return;
      }
      if (target.entryKind !== "work" && payload.shiftCode !== "DEFAULT") {
        setError("休假日不能直接覆蓋成班次；請先調整休假日期。");
        return;
      }
      const label = {
        DEFAULT: "員工原固定班別",
        COACH_EARLY: "早班 10:00–19:00",
        COACH_MIDDLE: "中班 14:00–23:00",
        COACH_PARTTIME_WEEKDAY: "晚班 18:00–22:00",
      }[payload.shiftCode];
      if (!window.confirm(`確認將 ${employee?.displayName || "此員工"} 的 ${toDate} 改為「${label}」？\n\n系統會重新執行法規與人數檢查；若班表已發布，只有受影響員工需要重新簽名。`)) return;
      if (await assignShift(employeeId, toDate, payload.shiftCode)) {
        highlightChangedEntries([{ employeeId, workDate: toDate }]);
      }
      return;
    }
    if (payload.kind === "assign_day_off") {
      if (!target) {
        setError("找不到這個日期的班表格，請重新整理後再試一次。");
        return;
      }
      if (preferenceMap.get(employeeId)?.status !== "submitted") {
        setError("此員工尚未完成 8 天排休，完成後才能安排休假或例假。");
        return;
      }
      if (target.entryKind === "off" && !["rest_day", "regular_day_off"].includes(target.offKind || "")) {
        setError("館休、國休或國定假日調休日不能改成一般休假或例假。");
        return;
      }
      const label = payload.offKind === "regular_day_off" ? "例假" : "休假";
      if (!window.confirm(`確認將 ${employee?.displayName || "此員工"} 的 ${toDate} 改為「${label}」？\n\n系統會重新執行例假、休息日、連續出勤及人數檢查；若班表已發布，只有受影響員工需要重新簽名。`)) return;
      if (await assignDayOff(employeeId, toDate, payload.offKind)) {
        highlightChangedEntries([{ employeeId, workDate: toDate }]);
      }
      return;
    }
    if (payload.employeeId !== employeeId || payload.fromDate === toDate) return;
    const source = entryMap.get(`${employeeId}:${payload.fromDate}`);
    if (target?.entryKind === "off") {
      setError("目標日期已是休假；目前請選另一個上班日，避免不明確的覆蓋。");
      return;
    }
    const confirmed = window.confirm(
      `確認調整 ${employee?.displayName || "此員工"}？\n\n${payload.fromDate} ${staffScheduleOffLabel(source?.offKind)} → ${toDate}\n\n原日期會恢復固定班別，系統將重新檢查例假、休息日、連續出勤及人數限制。`,
    );
    if (!confirmed) return;
    if (await act("move_day_off", {
      employeeId,
      fromDate: payload.fromDate,
      toDate,
      confirmed: true,
    }, "休假已拖移，合法性檢查已重新執行")) {
      highlightChangedEntries([
        { employeeId, workDate: payload.fromDate },
        { employeeId, workDate: toDate },
      ]);
    }
  }

  if (loading) {
    return <main className={styles.page}><div className={styles.loading}>正在整理員工排休與班表…</div></main>;
  }

  if (!data) {
    return (
      <main className={styles.page}>
        <div className={`${styles.loading} ${styles.loadFailure}`} role="alert">
          <h2>班表目前無法載入</h2>
          <p>{error || "讀取班表時發生問題。"}</p>
          <button type="button" className={styles.primaryButton} onClick={() => void load()}>
            重新讀取班表
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>巨挺健身館 · 員工排班</p>
          <div className={styles.titleRow}>
            <h1>全員班表控制台</h1>
            <span className={styles.workflowBadge}>
              <i aria-hidden="true" />
              <span>流程狀態</span>
              <strong>{data.period ? stateLabel(data.period.status) : "尚未開放"}</strong>
            </span>
          </div>
          <p>副理統整與初審，經理逐筆終審；發布後的實質修改會產生新版本並要求受影響員工重簽。</p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.monthField}>
            排班月份
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <a className={styles.secondaryButton} href="/manager/fitness">返回營運後台</a>
          <a className={styles.secondaryButton} href="/manager/staff-attendance">打卡異常</a>
          <a className={styles.secondaryButton} href="/manager/staff-leave">請假覆核</a>
          <a className={styles.secondaryButton} href="/manager/staff-payroll">薪資關帳</a>
          <a className={styles.secondaryButton} href="/manager/staff-permissions">帳號權限</a>
          <a className={styles.secondaryButton} href="/staff/schedule">查看我的班表</a>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status"><span>{notice}</span><button type="button" aria-label="關閉提示" onClick={() => setNotice("")}>×</button></div> : null}

      {!data?.period ? (
        <section className={styles.emptyPanel}>
          <span className={styles.emptyIcon}>🗓️</span>
          <h2>{month} 尚未開放排休</h2>
          <p>開放後，員工可在前一個月 1 日至 20 日 23:59 自選 8 天；館休日若已設定會自動計入。</p>
          <button className={styles.primaryButton} disabled={busy} onClick={() => void act("initialize_period", {}, "月份已建立，可設定館休及員工班別")}>開放這個月份</button>
        </section>
      ) : (
        <>
          <section className={styles.setupActions} aria-label="排班前置設定">
            <button type="button" className={styles.setupActionButton} onClick={() => setSetupDialog("progress")}>
              <span className={styles.setupActionIcon} aria-hidden="true">休</span>
              <span><strong>館休與選休進度</strong><small>設定館休日並查看員工選休</small></span>
              <b aria-hidden="true">›</b>
            </button>
            <button type="button" className={styles.setupActionButton} onClick={() => setSetupDialog("shifts")}>
              <span className={styles.setupActionIcon} aria-hidden="true">班</span>
              <span><strong>固定班別設定</strong><small>調整員工預設班別與工時</small></span>
              <b aria-hidden="true">›</b>
            </button>
          </section>

          <dialog
            ref={setupDialogRef}
            className={styles.setupDialog}
            aria-labelledby="setup-dialog-title"
            onClose={() => setSetupDialog(null)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setSetupDialog(null);
            }}
          >
            <div className={styles.setupDialogCard}>
              <div className={styles.setupDialogHeader}>
                <div>
                  <span>{setupDialog === "progress" ? "排休設定" : "員工設定"}</span>
                  <h2 id="setup-dialog-title">{setupDialog === "progress" ? "館休與選休進度" : "固定班別設定"}</h2>
                  <p>{setupDialog === "progress" ? `選休截止 ${formatDateTime(data.period.selection_closes_at)}` : "設定員工平日預設班別與休假餘額"}</p>
                </div>
                <button type="button" className={styles.dialogCloseButton} aria-label="關閉設定視窗" onClick={() => setSetupDialog(null)}>×</button>
              </div>

              <div className={styles.setupDialogBody}>
                {setupDialog === "progress" ? (
                  <div className={styles.progressSettings}>
                    <label className={styles.field}>
                      <span>本月館休日（自動計入員工 8 天）</span>
                      <div className={styles.inlineField}>
                        <input type="date" min={`${month}-01`} max={dates.at(-1)} value={closureDate} onChange={(event) => setClosureDate(event.target.value)} />
                        <button className={styles.secondaryButton} disabled={busy || !closureDate} onClick={() => void act("set_facility_closure", { closureDate }, "館休日已更新")}>儲存館休</button>
                      </div>
                    </label>
                    <label className={styles.field}>
                      <span>中班人員同一天最多可自選休假人數</span>
                      <div className={styles.inlineField}>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={middleDailyLimit}
                          onChange={(event) => setMiddleDailyLimit(Number(event.target.value))}
                        />
                        <button
                          className={styles.secondaryButton}
                          disabled={busy || middleDailyLimit < 1 || middleDailyLimit > 20}
                          onClick={() => void act("update_schedule_rules", { middlePreferenceDailyLimit: middleDailyLimit }, "中班每日自選休假上限已更新")}
                        >儲存人數上限</button>
                      </div>
                      <small>早班不計入；星期六、日 13:00–22:00 的兼職教練會計入。</small>
                    </label>
                    <div className={styles.field}>
                      <span>當年度國定假日行事曆</span>
                      <div className={styles.inlineField}>
                        <input type="date" min={`${month}-01`} max={dates.at(-1)} value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} />
                        <input value={holidayName} onChange={(event) => setHolidayName(event.target.value)} placeholder="例如：中秋節" />
                        <button className={styles.secondaryButton} disabled={busy || !holidayDate || holidayName.trim().length < 2} onClick={() => void act("upsert_holiday", { holidayDate, holidayName }, "國定假日行事曆已更新")}>加入／更新</button>
                      </div>
                      <small>2026 已內建；未來年度由主管依官方行事曆逐筆加入，不需先設定當天誰出勤。</small>
                      {data.holidays.length ? <div className={styles.holidayChips}>{data.holidays.map((holiday) => <span key={holiday.holiday_date}>{holiday.holiday_date.slice(5)} {holiday.holiday_name}<button title="移除本館自行設定項目" onClick={() => { if (window.confirm(`確認移除 ${holiday.holiday_date} ${holiday.holiday_name}？`)) void act("remove_holiday", { holidayDate: holiday.holiday_date }, "國定假日項目已移除"); }}>×</button></span>)}</div> : null}
                    </div>
                    {incompleteEmployees.length > 0 ? (
                      <div className={styles.reminderBox}>
                        <strong>15 日起每天提醒副理：</strong>
                        <span>{incompleteEmployees.map((employee) => employee.displayName).join("、")}</span>
                      </div>
                    ) : <div className={styles.successBox}>全部員工都已完成自選排休。</div>}
                  </div>
                ) : setupDialog === "shifts" ? (
                  <div className={styles.employeeSettings}>
                    {scheduleEmployees.map((employee) => {
                      const terms = employee.employment;
                      if (!terms) return null;
                      return (
                        <details key={employee.id} className={styles.employeeSetting}>
                          <summary>
                            <span><strong>{employee.displayName}</strong><small>{employee.employeeNumber || "無員工編號"}</small></span>
                            <span>{terms.employment_type === "full_time" ? "正職" : "兼職"} · {terms.work_group === "frontdesk" ? "櫃台" : "教練"}</span>
                          </summary>
                          <div className={styles.settingFields}>
                            <label>身分類型
                              <select value={terms.employment_type} onChange={(event) => void saveEmployee(employee, {
                                employment_type: event.target.value as Employment["employment_type"],
                                pay_basis: event.target.value === "part_time" ? "hourly" : "monthly",
                              })}>
                                <option value="full_time">正職</option><option value="part_time">兼職</option>
                              </select>
                            </label>
                            <label>工作類別
                              <select value={terms.work_group} onChange={(event) => {
                                const workGroup = event.target.value as Employment["work_group"];
                                void saveEmployee(employee, {
                                  work_group: workGroup,
                                  default_shift_code: workGroup === "frontdesk" ? "FRONTDESK_DAY" : "COACH_MIDDLE",
                                  counts_toward_middle_limit: workGroup === "coach",
                                });
                              }}>
                                <option value="frontdesk">櫃台</option><option value="coach">教練</option><option value="other">其他</option>
                              </select>
                            </label>
                            <label>固定班別
                              <select value={terms.default_shift_code} onChange={(event) => void saveEmployee(employee, { default_shift_code: event.target.value })}>
                                <option value="FRONTDESK_DAY">早班 09:30–16:30（櫃台）</option>
                                <option value="COACH_EARLY">早班 10:00–19:00</option>
                                <option value="COACH_MIDDLE">中班 14:00–23:00</option>
                                <option value="COACH_PARTTIME_WEEKDAY">晚班 18:00–22:00</option>
                              </select>
                            </label>
                            <label className={styles.checkField}><input type="checkbox" checked={terms.is_original_early_shift} onChange={(event) => void saveEmployee(employee, { is_original_early_shift: event.target.checked, default_shift_code: event.target.checked ? "COACH_EARLY" : terms.default_shift_code })} />原固定早班（週三 12:00–21:00）</label>
                            <label className={styles.checkField}><input type="checkbox" checked={terms.counts_toward_middle_limit} onChange={(event) => void saveEmployee(employee, { counts_toward_middle_limit: event.target.checked })} />自選排休納入中班每日上限</label>
                            <label>特休餘額（天）
                              <input key={`${employee.id}:annual:${terms.annual_leave_balance_days}`} type="number" min={0} max={365} step={0.5} defaultValue={terms.annual_leave_balance_days} disabled={busy} onBlur={(event) => void saveEmployee(employee, { annual_leave_balance_days: Number(event.target.value) })} />
                            </label>
                            <label>積假餘額（天）
                              <input key={`${employee.id}:accrued:${terms.accrued_leave_balance_days}`} type="number" min={0} max={365} step={0.5} defaultValue={terms.accrued_leave_balance_days} disabled={busy} onBlur={(event) => void saveEmployee(employee, { accrued_leave_balance_days: Number(event.target.value) })} />
                            </label>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </dialog>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <div><span className={styles.step}>3</span><h2>副理統整表</h2></div>
              <div className={styles.actionRow}>
                <button className={styles.secondaryButton} disabled={busy} onClick={() => void load()}>重新整理</button>
                {data.version ? <><a className={styles.secondaryButton} href={`/api/staff-scheduling/export?month=${month}`}>匯出 Excel</a><a className={styles.secondaryButton} href={`/manager/staff-scheduling/print?month=${month}`} target="_blank" rel="noreferrer">列印／另存 PDF</a><button className={styles.secondaryButton} onClick={exportPng}>匯出圖片</button></> : null}
                <button className={styles.primaryButton} disabled={busy} onClick={() => void act("create_draft", {}, data.version ? "已依最新排休重建新版本" : "正式班表草稿已建立")}>{data.version ? "依排休重建新版本" : "產生正式班表草稿"}</button>
              </div>
            </div>
            {selectedPreferenceRows.length > 0 ? <div className={styles.preferenceSummary}>
              <strong>員工自選休假日期</strong>
              <div>{selectedPreferenceRows.map(({ employee, selectedDates }) => (
                <span key={employee.id}><b>{employee.displayName}{employee.englishName ? ` ${employee.englishName}` : ""}</b>{selectedDates.map((date) => Number(date.slice(-2))).join("、")} 日</span>
              ))}</div>
            </div> : null}
            {data.version ? <div className={styles.shiftPalette}>
              <strong>可拖進表格</strong>
              <button type="button" className={styles.restorePaletteButton} disabled={busy} draggable={!busy} onDragStart={(event) => shiftDragStart(event, "DEFAULT")}><span>↺</span><b>復原</b><small>回到原固定班別</small></button>
              <button type="button" disabled={busy} draggable={!busy} onDragStart={(event) => shiftDragStart(event, "COACH_EARLY")}><span>早</span><b>早班</b><small>10:00–19:00</small></button>
              <button type="button" disabled={busy} draggable={!busy} onDragStart={(event) => shiftDragStart(event, "COACH_MIDDLE")}><span>中</span><b>中班</b><small>14:00–23:00</small></button>
              <button type="button" disabled={busy} draggable={!busy} onDragStart={(event) => shiftDragStart(event, "COACH_PARTTIME_WEEKDAY")}><span>晚</span><b>晚班</b><small>18:00–22:00</small></button>
              <button type="button" className={styles.dayOffPaletteButton} disabled={busy} draggable={!busy} onDragStart={(event) => dayOffDragStart(event, "rest_day")}><span>休</span><b>休假</b><small>排為休息日</small></button>
              <button type="button" className={styles.dayOffPaletteButton} disabled={busy} draggable={!busy} onDragStart={(event) => dayOffDragStart(event, "regular_day_off")}><span>例</span><b>例假</b><small>排為例假日</small></button>
            </div> : null}
            {data.version ? (
              <div className={styles.scheduleScroller}>
                <table className={styles.scheduleTable}>
                  <thead><tr><th className={styles.nameCell}>員工</th>{dates.map((date) => <th key={date} className={weekday(date) === "六" || weekday(date) === "日" ? styles.weekend : ""}><span>{Number(date.slice(-2))}</span><small>{weekday(date)}</small></th>)}</tr></thead>
                  <tbody>
                    {visibleEmployees.map((employee) => (
                      <tr key={employee.id}>
                        <th className={styles.nameCell}><div className={styles.nameSummary}><strong>{employee.displayName}</strong><small>{employee.englishName || "未設定英文名"}</small><span className={styles.leaveBalances}><i>特休{formatDays(employee.employment?.annual_leave_balance_days)}</i><i>積假{formatDays(employee.employment?.accrued_leave_balance_days)}</i></span></div></th>
                        {dates.map((date) => {
                          const entryKey = scheduleEntryKey(employee.id, date);
                          const entry = entryMap.get(entryKey);
                          const isOff = entry?.entryKind === "off";
                          const tone = scheduleTone(entry);
                          return (
                            <td
                              key={date}
                              className={`${isOff ? styles.offCell : styles.workCell} ${recentlyChangedEntryKeys.has(entryKey) ? styles.resignCell : ""}`}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => void dropOn(event, employee.id, date)}
                              title={isOff ? `${entry ? staffScheduleEntryOffLabel(entry) : "休假"}（可拖曳）` : `${entry ? staffScheduleShiftLabel(entry) : "未排班"} ${entry?.startsAt || ""}–${entry?.endsAt || ""}`}
                            >
                              {entry ? (
                                <div draggable={isOff} onDragStart={(event) => dragStart(event, entry)}>
                                  {isOff
                                    ? <strong className={styles.offBadge}>{staffScheduleEntryOffLabel(entry)}</strong>
                                    : <span className={`${styles.shiftBadge} ${tone === "early" ? styles.earlyShiftBadge : tone === "late" ? styles.lateShiftBadge : styles.middleShiftBadge}`}>{staffScheduleGridWorkLabel(entry, employee.employeeNumber, date)}</span>}
                                </div>
                              ) : <span className={styles.emptyCell}>—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><th className={styles.nameCell}>上班人數</th>{dates.map((date) => <td key={date}>{dailyStats.get(date)?.work || 0}</td>)}</tr><tr><th className={styles.nameCell}>休假人數</th>{dates.map((date) => <td key={date}>{dailyStats.get(date)?.off || 0}</td>)}</tr></tfoot>
                </table>
              </div>
            ) : <div className={styles.placeholder}>員工選休完成後，點「產生正式班表草稿」即可看到這張表。</div>}
          </section>

          {holidayRules.length > 0 ? (
            <section className={`${styles.panel} ${styles.holidayPanel}`}>
              <div className={styles.panelHeading}><div><span className={styles.step}>!</span><h2>國定假日必須逐筆處理</h2></div><span className={styles.blockingBadge}>發布前必須完成</span></div>
              <p className={styles.holidayIntro}>每個日期只說明一次；請逐位選擇「當天國休」或保留出勤並指定另一個國休日。</p>
              <div className={styles.holidayList}>
                {holidayRuleGroups.map((group) => (
                  <section key={`${group.workDate}:${group.holidayName}`} className={styles.holidayGroup}>
                    <header className={styles.holidayGroupHeader}>
                      <div><strong>{group.workDate?.slice(5)}　{group.holidayName}</strong><small>當天排班者需要安排國休</small></div>
                      <span>{group.rules.length} 人待處理</span>
                    </header>
                    <div className={styles.holidayRows}>
                      {group.rules.map((rule) => {
                        const employee = rule.employee_id ? employeeMap.get(rule.employee_id) : null;
                        const workDays = data.scheduleEntries.filter((entry) => entry.employeeId === rule.employee_id && entry.entryKind === "work" && entry.workDate !== rule.work_date);
                        return (
                          <div key={rule.id} className={styles.holidayRuleRow}>
                            <div className={styles.holidayEmployee}><strong>{employee?.displayName || "此員工"}</strong><small>{String(rule.details.shift || "目前已排班")}</small></div>
                            <button className={styles.secondaryButton} disabled={busy} onClick={async () => {
                              if (window.confirm(`確認將 ${employee?.displayName || "此員工"} 的 ${rule.work_date} 改為「${group.holidayName}國休」？`)) {
                                const changed = await act("make_holiday_day_off", {
                                  employeeId: rule.employee_id,
                                  holidayDate: rule.work_date,
                                  holidayName: group.holidayName,
                                }, "國定假日當天已改為國休");
                                if (changed && rule.employee_id && rule.work_date) {
                                  highlightChangedEntries([{ employeeId: rule.employee_id, workDate: rule.work_date }]);
                                }
                              }
                            }}>{group.workDate?.slice(5)} 當天國休</button>
                            <span className={styles.holidayOr}>或</span>
                            <select aria-label={`${employee?.displayName || "此員工"}的其他國休日期`} value={adjustedDates[rule.id] || ""} onChange={(event) => setAdjustedDates((current) => ({ ...current, [rule.id]: event.target.value }))}>
                              <option value="">選擇另一個國休日期</option>
                              {workDays.map((entry) => <option key={entry.workDate} value={entry.workDate}>{entry.workDate.slice(5)} · {staffScheduleShiftLabel(entry)}</option>)}
                            </select>
                            <button className={styles.dangerButton} disabled={busy || !adjustedDates[rule.id]} onClick={async () => {
                              const adjustedDayOff = adjustedDates[rule.id];
                              const changed = await act("arrange_holiday_adjustment", {
                                employeeId: rule.employee_id,
                                holidayDate: rule.work_date,
                                holidayName: group.holidayName,
                                adjustedDayOff,
                              }, "國休日已安排完成");
                              if (changed && rule.employee_id && adjustedDayOff) {
                                highlightChangedEntries([{ employeeId: rule.employee_id, workDate: adjustedDayOff }]);
                              }
                            }}>確認其他國休日</button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          ) : null}

          {(blockingRules.length > 0 || warningRules.length > 0) && holidayRules.length !== blockingRules.length ? (
            <section className={styles.rulePanel}>
              <h2>檢核結果</h2>
              {[...blockingRules.filter((rule) => rule.rule_code !== "HOLIDAY_ADJUSTMENT_REQUIRED"), ...warningRules].map((rule) => (
                <div key={rule.id} className={rule.severity === "blocking" ? styles.ruleBlock : styles.ruleWarn}>
                  <strong>{rule.severity === "blocking" ? "必須修正" : rule.overridden_at ? "已覆核" : "需填理由"}</strong>
                  <span>{rule.work_date ? `${rule.work_date}　` : ""}{rule.message}{rule.override_reason ? `（覆核理由：${rule.override_reason}）` : ""}</span>
                  {rule.severity === "warning" && !rule.overridden_at ? (
                    <button
                      className={styles.secondaryButton}
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt("請填寫允許這項例外的具體原因；系統會保留覆核人、時間與理由。", "");
                        if (reason?.trim()) void act("override_rule", { ruleId: rule.id, reason: reason.trim() }, "警告已完成覆核並留下紀錄");
                      }}
                    >填理由並覆核</button>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {data.holidayAdjustments.some((item) => item.status === "draft") && data.actor.canFinalApprove ? (
            <section className={styles.panel}>
              <h2>國休安排逐筆核准</h2>
              {data.holidayAdjustments.filter((item) => item.status === "draft").map((item) => <div className={styles.approvalRow} key={item.id}><span>{employeeMap.get(item.employee_id)?.displayName}：{item.holiday_date} {item.holiday_name} → {item.adjusted_day_off} 國休</span><button className={styles.primaryButton} onClick={() => void act("approve_holiday_adjustment", { adjustmentId: item.id }, "此筆國休安排已由經理核准")}>經理核准此筆</button></div>)}
            </section>
          ) : null}

          {data.version ? (
            <section className={styles.approvalPanel}>
              <div><span className={styles.step}>4</span><div><h2>正式班表兩次審核</h2><p>初審完成才會送經理；經理發布後，員工只看得到自己的班表。</p></div></div>
              <div className={styles.actionRow}>
                <button className={styles.secondaryButton} disabled={busy || data.version.status === "published"} onClick={() => {
                  if (window.confirm("確認副理已逐日檢查班別、例假、休息日、人力與國休安排？")) void act("assistant_approve", {}, "副理初審完成，已通知經理");
                }}>副理完成初審</button>
                {data.actor.canFinalApprove ? <button className={styles.primaryButton} disabled={busy || data.version.status !== "manager_review"} onClick={() => {
                  if (window.confirm("確認經理已逐筆終審？發布後會立即通知所有員工在 3 天內簽名。")) void act("manager_publish", {}, "正式班表已發布並通知員工");
                }}>經理終審並發布</button> : null}
              </div>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
