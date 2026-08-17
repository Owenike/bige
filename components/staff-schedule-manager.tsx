"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
};

type Employee = {
  id: string;
  displayName: string;
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
  requiresResign: boolean;
};

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

const OFF_LABELS: Record<string, string> = {
  regular_day_off: "例假",
  rest_day: "休息日",
  facility_closure: "館休",
  preferred_off: "排休",
  holiday_adjustment: "國定假日調休",
  national_holiday: "國定假日",
  annual_leave: "特休",
  sick_leave: "病假",
  personal_leave: "事假",
  family_care_leave: "家庭照顧假",
  marriage_leave: "婚假",
  bereavement_leave: "喪假",
  official_leave: "公假",
  other_leave: "其他假",
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

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as ScheduleState;
}

export default function StaffScheduleManager() {
  const [month, setMonth] = useState(nextMonthValue);
  const [data, setData] = useState<ScheduleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [closureDate, setClosureDate] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [middleDailyLimit, setMiddleDailyLimit] = useState(2);
  const [adjustedDates, setAdjustedDates] = useState<Record<string, string>>({});
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employmentFilter, setEmploymentFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const dates = useMemo(() => monthDates(month), [month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/staff-scheduling?month=${month}`, { cache: "no-store" });
      setData(await parseResponse(response));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "讀取失敗");
    } finally {
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

  async function act(action: string, values: Record<string, unknown> = {}, successMessage = "已完成") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/staff-scheduling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, monthStart: `${month}-01`, ...values }),
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

  const preferenceMap = useMemo(
    () => new Map((data?.preferences || []).map((item) => [item.employee_id, item])),
    [data?.preferences],
  );
  const entryMap = useMemo(
    () => new Map((data?.scheduleEntries || []).map((entry) => [`${entry.employeeId}:${entry.workDate}`, entry])),
    [data?.scheduleEntries],
  );
  const employeeMap = useMemo(() => new Map((data?.employees || []).map((employee) => [employee.id, employee])), [data?.employees]);
  const completeCount = data?.employees.filter((employee) => preferenceMap.get(employee.id)?.status === "submitted").length || 0;
  const incompleteEmployees = data?.employees.filter((employee) => preferenceMap.get(employee.id)?.status !== "submitted") || [];
  const blockingRules = data?.ruleResults.filter((rule) => !rule.passed && rule.severity === "blocking") || [];
  const warningRules = data?.ruleResults.filter((rule) => !rule.passed && rule.severity === "warning") || [];
  const holidayRules = blockingRules.filter((rule) => rule.rule_code === "HOLIDAY_ADJUSTMENT_REQUIRED");
  const visibleEmployees = useMemo(() => (data?.employees || []).filter((employee) => {
    const searchText = `${employee.displayName} ${employee.employeeNumber || ""}`.toLowerCase();
    if (!searchText.includes(employeeSearch.trim().toLowerCase())) return false;
    if (employmentFilter !== "all" && employee.employment?.employment_type !== employmentFilter) return false;
    if (shiftFilter !== "all" && employee.employment?.default_shift_code !== shiftFilter) return false;
    return true;
  }), [data?.employees, employeeSearch, employmentFilter, shiftFilter]);
  const dailyStats = useMemo(() => new Map(dates.map((date) => {
    const rows = visibleEmployees.map((employee) => entryMap.get(`${employee.id}:${date}`)).filter(Boolean);
    return [date, { work: rows.filter((entry) => entry?.entryKind === "work").length, off: rows.filter((entry) => entry?.entryKind === "off").length }];
  })), [dates, entryMap, visibleEmployees]);

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
    }, `${employee.displayName}的班別設定已更新`);
  }

  function exportPng() {
    if (!data?.version || visibleEmployees.length === 0) return;
    const nameWidth = 180;
    const cellWidth = 92;
    const headerHeight = 62;
    const rowHeight = 58;
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
    visibleEmployees.forEach((employee, rowIndex) => { const y = top + headerHeight + rowIndex * rowHeight; context.fillStyle = "#f8fafc"; context.fillRect(0, y, nameWidth, rowHeight); context.textAlign = "left"; context.fillStyle = "#172235"; context.font = "bold 14px sans-serif"; context.fillText(employee.displayName, 10, y + 21); context.font = "11px sans-serif"; context.fillStyle = "#66778e"; context.fillText(employee.employeeNumber || "無編號", 10, y + 42); dates.forEach((date, index) => { const entry = entryMap.get(`${employee.id}:${date}`); const x = nameWidth + index * cellWidth; context.fillStyle = entry?.entryKind === "off" ? "#ffe49a" : "#ffffff"; context.fillRect(x, y, cellWidth, rowHeight); context.textAlign = "center"; context.fillStyle = "#26384e"; context.font = "bold 11px sans-serif"; const title = entry?.entryKind === "off" ? OFF_LABELS[entry.offKind || ""] || "休" : entry?.shiftLabel || "—"; context.fillText(title.slice(0, 8), x + cellWidth / 2, y + 22); if (entry?.entryKind === "work") { context.font = "10px sans-serif"; context.fillStyle = "#66778e"; context.fillText(`${entry.startsAt}–${entry.endsAt}`, x + cellWidth / 2, y + 41); } }); });
    context.strokeStyle = "#cfd8e5"; context.lineWidth = 1; for (let x = 0; x <= canvas.width; x += x === 0 ? nameWidth : cellWidth) { context.beginPath(); context.moveTo(x, top); context.lineTo(x, canvas.height); context.stroke(); if (x === 0) x = nameWidth - cellWidth; } for (let y = top; y <= canvas.height; y += y === top ? headerHeight : rowHeight) { context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); if (y === top) y = top + headerHeight - rowHeight; }
    canvas.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `巨挺健身館-${month}-班表.png`; anchor.click(); URL.revokeObjectURL(url); }, "image/png");
  }

  function dragStart(event: React.DragEvent, entry: ScheduleEntry) {
    if (entry.entryKind !== "off") return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "day_off", employeeId: entry.employeeId, fromDate: entry.workDate }));
  }

  function shiftDragStart(event: React.DragEvent, shiftCode: "COACH_EARLY" | "DEFAULT") {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "shift", shiftCode }));
  }

  async function dropOn(event: React.DragEvent, employeeId: string, toDate: string) {
    event.preventDefault();
    let payload: { kind: "day_off"; employeeId: string; fromDate: string } | { kind: "shift"; shiftCode: "COACH_EARLY" | "DEFAULT" } | null = null;
    try {
      payload = JSON.parse(event.dataTransfer.getData("application/json"));
    } catch {
      return;
    }
    if (!payload) return;
    const employee = employeeMap.get(employeeId);
    const target = entryMap.get(`${employeeId}:${toDate}`);
    if (payload.kind === "shift") {
      if (target?.entryKind !== "work") {
        setError("休假日不能直接覆蓋成班次；請先調整休假日期。");
        return;
      }
      if (payload.shiftCode === "COACH_EARLY" && !employee?.employment?.can_cover_early_shift && !employee?.employment?.is_original_early_shift) {
        setError("此員工尚未設定「可支援早班」，請先在固定班別設定中勾選資格。");
        return;
      }
      const label = payload.shiftCode === "COACH_EARLY" ? "支援早班 10:00–19:00" : "員工原固定班別";
      if (!window.confirm(`確認將 ${employee?.displayName || "此員工"} 的 ${toDate} 改為「${label}」？\n\n系統會重新執行法規與人數檢查；若班表已發布，只有受影響員工需要重新簽名。`)) return;
      await act("assign_shift", { employeeId, workDate: toDate, shiftCode: payload.shiftCode, confirmed: true }, "個別班次已更新，合法性檢查已重新執行");
      return;
    }
    if (payload.employeeId !== employeeId || payload.fromDate === toDate) return;
    const source = entryMap.get(`${employeeId}:${payload.fromDate}`);
    if (target?.entryKind === "off") {
      setError("目標日期已是休假；目前請選另一個上班日，避免不明確的覆蓋。");
      return;
    }
    const confirmed = window.confirm(
      `確認調整 ${employee?.displayName || "此員工"}？\n\n${payload.fromDate} ${OFF_LABELS[source?.offKind || ""] || "休假"} → ${toDate}\n\n原日期會恢復固定班別，系統將重新檢查例假、休息日、連續出勤及人數限制。`,
    );
    if (!confirmed) return;
    await act("move_day_off", {
      employeeId,
      fromDate: payload.fromDate,
      toDate,
      confirmed: true,
    }, "休假已拖移，合法性檢查已重新執行");
  }

  if (loading) {
    return <main className={styles.page}><div className={styles.loading}>正在整理員工排休與班表…</div></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>巨挺健身館 · 員工排班</p>
          <h1>全員班表控制台</h1>
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
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      {!data?.period ? (
        <section className={styles.emptyPanel}>
          <span className={styles.emptyIcon}>🗓️</span>
          <h2>{month} 尚未開放排休</h2>
          <p>開放後，員工可在前一個月 1 日至 20 日 23:59 自選 8 天；館休日若已設定會自動計入。</p>
          <button className={styles.primaryButton} disabled={busy} onClick={() => void act("initialize_period", {}, "月份已建立，可設定館休及員工班別")}>開放這個月份</button>
        </section>
      ) : (
        <>
          <section className={styles.stats}>
            <article><span>流程狀態</span><strong>{stateLabel(data.period.status)}</strong></article>
            <article><span>已選滿 8 天</span><strong>{completeCount} / {data.employees.length}</strong></article>
            <article className={incompleteEmployees.length ? styles.warnStat : ""}><span>尚未完成</span><strong>{incompleteEmployees.length}</strong></article>
            <article className={blockingRules.length ? styles.blockStat : ""}><span>法規阻擋</span><strong>{blockingRules.length}</strong></article>
            <article><span>班表版本</span><strong>{data.version ? `V${data.version.version_number} · ${stateLabel(data.version.status)}` : "尚未建立"}</strong></article>
          </section>

          <section className={styles.setupGrid}>
            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div><span className={styles.step}>1</span><h2>館休與選休進度</h2></div>
                <span className={styles.deadline}>截止 {formatDateTime(data.period.selection_closes_at)}</span>
              </div>
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
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div><span className={styles.step}>2</span><h2>固定班別設定</h2></div>
                <span className={styles.hint}>不用顯示休息時段給員工</span>
              </div>
              <div className={styles.employeeSettings}>
                {data.employees.map((employee) => {
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
                            <option value="FRONTDESK_DAY">櫃台 09:30–16:30</option>
                            <option value="COACH_EARLY">早班 10:00–19:00</option>
                            <option value="COACH_MIDDLE">中班 13:00–22:00</option>
                            <option value="COACH_PARTTIME_WEEKDAY">兼職平日 18:00–22:00</option>
                          </select>
                        </label>
                        <label className={styles.checkField}><input type="checkbox" checked={terms.is_original_early_shift} onChange={(event) => void saveEmployee(employee, { is_original_early_shift: event.target.checked, default_shift_code: event.target.checked ? "COACH_EARLY" : terms.default_shift_code })} />原固定早班（週三 12:00–21:00）</label>
                        <label className={styles.checkField}><input type="checkbox" checked={terms.can_cover_early_shift} onChange={(event) => void saveEmployee(employee, { can_cover_early_shift: event.target.checked })} />主管指定可支援早班</label>
                        <label className={styles.checkField}><input type="checkbox" checked={terms.counts_toward_middle_limit} onChange={(event) => void saveEmployee(employee, { counts_toward_middle_limit: event.target.checked })} />自選排休納入中班每日上限</label>
                      </div>
                    </details>
                  );
                })}
              </div>
            </article>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <div><span className={styles.step}>3</span><h2>副理統整表</h2></div>
              <div className={styles.actionRow}>
                <button className={styles.secondaryButton} disabled={busy} onClick={() => void load()}>重新整理</button>
                {data.version ? <><a className={styles.secondaryButton} href={`/api/staff-scheduling/export?month=${month}`}>匯出 Excel</a><a className={styles.secondaryButton} href={`/manager/staff-scheduling/print?month=${month}`} target="_blank" rel="noreferrer">列印／另存 PDF</a><button className={styles.secondaryButton} onClick={exportPng}>匯出圖片</button></> : null}
                <button className={styles.primaryButton} disabled={busy} onClick={() => void act("create_draft", {}, data.version ? "已依最新排休重建新版本" : "正式班表草稿已建立")}>{data.version ? "依排休重建新版本" : "產生正式班表草稿"}</button>
              </div>
            </div>
            <div className={styles.filterBar}>
              <label>搜尋員工<input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="姓名或員工編號" /></label>
              <label>身分類型<select value={employmentFilter} onChange={(event) => setEmploymentFilter(event.target.value)}><option value="all">全部</option><option value="full_time">正職</option><option value="part_time">兼職</option></select></label>
              <label>固定班別<select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}><option value="all">全部</option><option value="FRONTDESK_DAY">櫃台</option><option value="COACH_EARLY">早班</option><option value="COACH_MIDDLE">中班</option><option value="COACH_PARTTIME_WEEKDAY">兼職平日</option></select></label>
              <strong>目前顯示 {visibleEmployees.length} 人</strong>
            </div>
            <p className={styles.gridHelp}>拖曳有顏色的休假格到同一員工的上班日；每次放開前都會再次確認。左右滑動可看完整月份。</p>
            {data.version ? <div className={styles.shiftPalette}>
              <strong>可拖進表格的班次</strong>
              <div draggable onDragStart={(event) => shiftDragStart(event, "COACH_EARLY")}><span>早</span><b>支援早班</b><small>10:00–19:00 · 僅限已設定資格員工</small></div>
              <div draggable onDragStart={(event) => shiftDragStart(event, "DEFAULT")}><span>↺</span><b>恢復固定班</b><small>依員工原本班別與日期恢復</small></div>
            </div> : null}
            {data.version ? (
              <div className={styles.scheduleScroller}>
                <table className={styles.scheduleTable}>
                  <thead><tr><th className={styles.nameCell}>員工</th>{dates.map((date) => <th key={date} className={weekday(date) === "六" || weekday(date) === "日" ? styles.weekend : ""}><span>{Number(date.slice(-2))}</span><small>{weekday(date)}</small></th>)}</tr></thead>
                  <tbody>
                    {visibleEmployees.map((employee) => (
                      <tr key={employee.id}>
                        <th className={styles.nameCell}><strong>{employee.displayName}</strong><small>{employee.employment?.default_shift_code || "未設定"}</small></th>
                        {dates.map((date) => {
                          const entry = entryMap.get(`${employee.id}:${date}`);
                          const isOff = entry?.entryKind === "off";
                          return (
                            <td
                              key={date}
                              className={`${isOff ? styles.offCell : styles.workCell} ${entry?.requiresResign ? styles.resignCell : ""}`}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => void dropOn(event, employee.id, date)}
                              title={isOff ? `${OFF_LABELS[entry?.offKind || ""] || "休假"}（可拖曳）` : `${entry?.shiftLabel || "未排班"} ${entry?.startsAt || ""}–${entry?.endsAt || ""}`}
                            >
                              {entry ? (
                                <div draggable={isOff} onDragStart={(event) => dragStart(event, entry)}>
                                  {isOff ? <strong>{OFF_LABELS[entry.offKind || ""] || "休"}</strong> : <><span>{entry.shiftLabel}</span><small>{entry.startsAt}–{entry.endsAt}</small></>}
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
              <div className={styles.holidayList}>
                {holidayRules.map((rule) => {
                  const employee = rule.employee_id ? employeeMap.get(rule.employee_id) : null;
                  const holiday = data.holidays.find((item) => item.holiday_date === rule.work_date);
                  const workDays = data.scheduleEntries.filter((entry) => entry.employeeId === rule.employee_id && entry.entryKind === "work" && entry.workDate !== rule.work_date);
                  return (
                    <article key={rule.id} className={styles.holidayCard}>
                      <h3>⚠️ {employee?.displayName || "此員工"}在國定假日被排到上班</h3>
                      <dl><div><dt>國定假日</dt><dd>{rule.work_date}　{holiday?.holiday_name || String(rule.details.holidayName || "")}</dd></div><div><dt>目前班次</dt><dd>{String(rule.details.shift || "")}</dd></div></dl>
                      <p>請立刻決定：當天改休假，或讓員工當天出勤並指定另一個「原本有排班的工作日」作為國定假日調休日。</p>
                      <div className={styles.holidayActions}>
                        <button className={styles.secondaryButton} disabled={busy} onClick={() => {
                          if (window.confirm(`確認將 ${employee?.displayName || "此員工"} 的 ${rule.work_date} 改為「${holiday?.holiday_name || "國定假日"}休假」？`)) {
                            void act("make_holiday_day_off", {
                              employeeId: rule.employee_id,
                              holidayDate: rule.work_date,
                              holidayName: holiday?.holiday_name || String(rule.details.holidayName || "國定假日"),
                            }, "國定假日當天已改為休假");
                          }
                        }}>改成 {rule.work_date?.slice(5)} 休假</button>
                        <span>或</span>
                        <select value={adjustedDates[rule.id] || ""} onChange={(event) => setAdjustedDates((current) => ({ ...current, [rule.id]: event.target.value }))}>
                          <option value="">選擇調休日（只列原工作日）</option>
                          {workDays.map((entry) => <option key={entry.workDate} value={entry.workDate}>{entry.workDate} · {entry.shiftLabel}</option>)}
                        </select>
                        <button className={styles.dangerButton} disabled={busy || !adjustedDates[rule.id]} onClick={() => void act("arrange_holiday_adjustment", {
                          employeeId: rule.employee_id,
                          holidayDate: rule.work_date,
                          holidayName: holiday?.holiday_name || String(rule.details.holidayName || "國定假日"),
                          adjustedDayOff: adjustedDates[rule.id],
                        }, "國定假日與調休日已建立一對一對應")}>確認安排調休日</button>
                      </div>
                    </article>
                  );
                })}
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
              <h2>國定假日調移逐筆核准</h2>
              {data.holidayAdjustments.filter((item) => item.status === "draft").map((item) => <div className={styles.approvalRow} key={item.id}><span>{employeeMap.get(item.employee_id)?.displayName}：{item.holiday_date} {item.holiday_name} → {item.adjusted_day_off} 休假</span><button className={styles.primaryButton} onClick={() => void act("approve_holiday_adjustment", { adjustmentId: item.id }, "此筆國定假日調移已由經理核准")}>經理核准此筆</button></div>)}
            </section>
          ) : null}

          {data.version ? (
            <section className={styles.approvalPanel}>
              <div><span className={styles.step}>4</span><div><h2>正式班表兩次審核</h2><p>初審完成才會送經理；經理發布後，員工只看得到自己的班表。</p></div></div>
              <div className={styles.actionRow}>
                <button className={styles.secondaryButton} disabled={busy || data.version.status === "published"} onClick={() => {
                  if (window.confirm("確認副理已逐日檢查班別、例假、休息日、人力與國定假日調移？")) void act("assistant_approve", {}, "副理初審完成，已通知經理");
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
