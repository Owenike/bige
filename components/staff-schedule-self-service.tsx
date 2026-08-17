"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../app/staff/schedule/page.module.css";

type SelfState = {
  actor: { id: string; displayName: string | null; englishName: string | null; canManage: boolean };
  monthStart: string;
  period: null | {
    id: string;
    status: string;
    selection_opens_at: string;
    selection_closes_at: string;
    preferred_days_required: number;
  };
  employees: Array<{ id: string; displayName: string }>;
  preferences: Array<{
    employee_id: string;
    status: string;
    submitted_at: string | null;
    staff_time_off_preference_dates?: Array<{ requested_date: string; source: string }>;
  }>;
  facilityClosures: Array<{ closure_date: string }>;
  version: null | { id: string; version_number: number; status: string; published_at: string | null };
  scheduleEntries: Array<{
    id: string;
    employeeId: string;
    workDate: string;
    entryKind: "work" | "off";
    shiftLabel: string | null;
    startsAt: string | null;
    endsAt: string | null;
    offKind: string | null;
    employeeVisibleNote?: string | null;
  }>;
  holidayAdjustments: Array<{
    holiday_date: string;
    holiday_name: string;
    original_shift_summary: string;
    adjusted_day_off: string;
    status: string;
  }>;
  acknowledgement: null | { status: string; signed_at: string | null; objection_reason: string | null };
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

function listCalendarCells(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const offset = new Date(year, monthNumber - 1, 1).getDay();
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`),
  ];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${value}T12:00:00+08:00`));
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as SelfState;
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const resetCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#14243a";
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    setHasInk(false);
    onChange(null);
  }, [onChange]);

  useEffect(() => {
    resetCanvas();
  }, [resetCanvas]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const position = point(event);
    if (!canvas || !position) return;
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;
    const context = canvas.getContext("2d");
    context?.beginPath();
    context?.moveTo(position.x, position.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const position = point(event);
    const context = canvas?.getContext("2d");
    if (!canvas || !position || !context) return;
    context.lineTo(position.x, position.y);
    context.stroke();
    setHasInk(true);
  }

  function end() {
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasInk) onChange(canvas.toDataURL("image/png"));
  }

  return (
    <div className={styles.signaturePad}>
      <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-label="手機手寫簽名區" />
      <div><span>{hasInk ? "簽名已寫入" : "請用手指在框內簽名"}</span><button type="button" onClick={resetCanvas}>清除重簽</button></div>
    </div>
  );
}

export default function StaffScheduleSelfService() {
  const [month, setMonth] = useState(nextMonthValue);
  const [data, setData] = useState<SelfState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [objection, setObjection] = useState("");
  const [showObjection, setShowObjection] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const calendarCells = useMemo(() => listCalendarCells(month), [month]);
  const closureDates = useMemo(() => new Set((data?.facilityClosures || []).map((item) => item.closure_date)), [data?.facilityClosures]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/staff-scheduling?month=${month}`, { cache: "no-store" });
      const next = await parseResponse(response);
      setData(next);
      const preference = next.preferences.find((item) => item.employee_id === next.actor.id);
      setSelected((preference?.staff_time_off_preference_dates || []).filter((item) => item.source === "employee").map((item) => item.requested_date));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, values: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/staff-scheduling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, monthStart: `${month}-01`, ...values }),
      });
      const next = await parseResponse(response);
      setData(next);
      setNotice(successMessage);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失敗");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const requiredCount = data?.period?.preferred_days_required || 8;
  const combinedCount = new Set([...selected, ...closureDates]).size;
  const remaining = Math.max(0, requiredCount - combinedCount);
  const selectionOpen = data?.period
    ? Date.now() >= new Date(data.period.selection_opens_at).getTime() && Date.now() <= new Date(data.period.selection_closes_at).getTime()
    : false;
  const sortedEntries = useMemo(() => [...(data?.scheduleEntries || [])].sort((a, b) => a.workDate.localeCompare(b.workDate)), [data?.scheduleEntries]);
  const greetingName = data?.actor.englishName || data?.actor.displayName || "夥伴";

  function toggleDate(date: string) {
    if (!selectionOpen || closureDates.has(date)) return;
    setSelected((current) => {
      if (current.includes(date)) return current.filter((item) => item !== date);
      if (new Set([...current, ...closureDates]).size >= requiredCount) {
        setError(`已選滿 ${requiredCount} 天；若要更換，請先取消另一個日期。`);
        return current;
      }
      setError("");
      return [...current, date].sort();
    });
  }

  if (loading) return <main className={styles.page}><div className={styles.loading}>正在讀取您的班表…</div></main>;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p>巨挺健身館 · 員工專區</p><h1 className={styles.greeting} lang="en">Hi! {greetingName}</h1></div>
        <div className={styles.headerActions}>
          <label>月份<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          <a href="/staff/notifications">站內通知</a>
          <a href="/staff/attendance">打卡確認</a>
          <a href="/staff/leave">請假</a>
          <a href="/staff/payroll">薪資單</a>
          {data?.actor.canManage ? <a href="/manager/staff-scheduling">主管控制台</a> : null}
        </div>
      </header>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      {!data?.period ? (
        <section className={styles.empty}><span>🗓️</span><h2>主管尚未開放 {month} 排休</h2><p>開放後即可在這裡自選 8 天；其他法定請假不受這 8 天限制。</p></section>
      ) : !data.version ? (
        <section className={styles.selectionSection}>
          <div className={styles.selectionHeader}>
            <div><span className={styles.kicker}>自選排休</span><h2>{month.replace("-", " 年 ")} 月</h2><p>{selectionOpen ? "截止日前可隨時更改；送出後仍可在 20 日 23:59 前重新儲存。" : "選取期限已截止；如需修改，請直接聯絡副理。"}</p></div>
            <div className={`${styles.counter} ${remaining === 0 ? styles.counterDone : ""}`}><strong>{combinedCount}</strong><span>/ {requiredCount} 天</span><small>{remaining === 0 ? "已選滿" : `還差 ${remaining} 天`}</small></div>
          </div>
          <div className={styles.legend}><span><i className={styles.selectedMark} />我選的排休</span><span><i className={styles.closureMark} />館休（已計入）</span><span>只選日期，例假／休息日由合法班表安排</span></div>
          <div className={styles.calendar}>
            {["日", "一", "二", "三", "四", "五", "六"].map((label) => <div className={styles.weekday} key={label}>{label}</div>)}
            {calendarCells.map((date, index) => date ? (
              <button
                key={date}
                type="button"
                disabled={!selectionOpen || closureDates.has(date)}
                className={`${styles.day} ${selected.includes(date) ? styles.selectedDay : ""} ${closureDates.has(date) ? styles.closureDay : ""}`}
                onClick={() => toggleDate(date)}
                aria-pressed={selected.includes(date) || closureDates.has(date)}
              >
                <strong>{Number(date.slice(-2))}</strong>
                {closureDates.has(date) ? <span>館休</span> : selected.includes(date) ? <span>排休</span> : <span>可選</span>}
              </button>
            ) : <div className={styles.blankDay} key={`blank-${index}`} />)}
          </div>
          <div className={styles.selectionFooter}>
            <div><strong>目前選擇：</strong><span>{[...new Set([...selected, ...closureDates])].sort().map((date) => `${Number(date.slice(-2))} 日`).join("、") || "尚未選擇"}</span></div>
            <button type="button" disabled={busy || !selectionOpen || combinedCount !== requiredCount} onClick={() => {
              if (window.confirm(`確認儲存 ${month} 的 ${requiredCount} 天排休日期？截止前仍可再修改。`)) void act("save_preferences", { selectedDates: selected }, "排休日期已儲存");
            }}>儲存我的 {requiredCount} 天排休</button>
          </div>
        </section>
      ) : (
        <>
          <section className={styles.publishedHeader}>
            <div><span className={styles.kicker}>正式班表 V{data.version.version_number}</span><h2>{month.replace("-", " 年 ")} 月班表</h2><p>發布時間：{formatTime(data.version.published_at)}</p></div>
            <span className={styles.statusBadge}>{data.acknowledgement?.status === "signed" ? "已簽名" : data.acknowledgement?.status === "carried_forward" ? "內容未變更，沿用原簽署" : data.acknowledgement?.status === "objected" ? "已提出異議" : "等待確認與簽名"}</span>
          </section>

          <section className={styles.scheduleList}>
            {sortedEntries.map((entry) => (
              <article key={entry.id} className={entry.entryKind === "off" ? styles.offEntry : styles.workEntry}>
                <div><strong>{Number(entry.workDate.slice(-2))}</strong><span>{formatDate(entry.workDate).split("週").at(-1)}</span></div>
                <div>{entry.entryKind === "work" ? <><h3>{entry.shiftLabel || "上班"}</h3><p>{entry.startsAt}–{entry.endsAt}{entry.employeeVisibleNote ? ` · ${entry.employeeVisibleNote}` : ""}</p></> : <><h3>{OFF_LABELS[entry.offKind || ""] || "休假"}</h3><p>{entry.employeeVisibleNote || "本日不上班"}</p></>}</div>
              </article>
            ))}
          </section>

          {data.holidayAdjustments.length > 0 ? (
            <section className={styles.holidayBox}>
              <h2>國定假日調移（請逐筆確認）</h2>
              <p>下列原國定假日改為出勤，並將指定的原工作日調整為休假；本次簽名會同時確認這些對應。</p>
              {data.holidayAdjustments.map((item) => <div key={`${item.holiday_date}:${item.adjusted_day_off}`}><span><strong>{item.holiday_date}</strong>　{item.holiday_name}</span><b>當日出勤 {item.original_shift_summary}</b><i>→</i><span><strong>{item.adjusted_day_off}</strong>　國定假日調休</span></div>)}
            </section>
          ) : null}

          {!data.acknowledgement ? (
            <section className={styles.signPanel}>
              <div><span className={styles.kicker}>手機簽署</span><h2>確認正式班表</h2><p>本人已逐日確認本月份正式班表、例假日、休息日及上方所列國定假日調移內容，並以本次手機簽名確認。</p></div>
              <label className={styles.confirmCheck}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已閱讀並確認上方全部內容</span></label>
              <SignaturePad onChange={setSignature} />
              <div className={styles.signActions}>
                <button type="button" className={styles.objectionButton} onClick={() => setShowObjection((current) => !current)}>內容有問題，提出異議</button>
                <button type="button" disabled={busy || !confirmed || !signature} onClick={() => {
                  if (window.confirm("確認送出本次手機簽名？送出後會保留本版班表與簽名紀錄。")) void act("sign_schedule", { checkboxConfirmed: confirmed, signatureDataUrl: signature }, "班表簽名已完成");
                }}>確認並送出手機簽名</button>
              </div>
              {showObjection ? <div className={styles.objectionForm}><label>請清楚說明哪一天或哪個內容有問題<textarea value={objection} onChange={(event) => setObjection(event.target.value)} rows={4} /></label><button type="button" disabled={busy || objection.trim().length < 3} onClick={() => void act("object_schedule", { objectionReason: objection }, "異議已送給副理與經理")}>送出異議（不簽名）</button></div> : null}
            </section>
          ) : (
            <section className={data.acknowledgement.status === "objected" ? styles.objectedPanel : styles.signedPanel}>
              <h2>{data.acknowledgement.status === "signed" ? "✓ 本版班表已完成簽名" : data.acknowledgement.status === "carried_forward" ? "✓ 本版未變更您的內容，不需重新簽名" : "已提出班表異議"}</h2>
              <p>{data.acknowledgement.status === "signed" ? `簽署時間：${formatTime(data.acknowledgement.signed_at)}` : data.acknowledgement.status === "carried_forward" ? `沿用前一版本簽署時間：${formatTime(data.acknowledgement.signed_at)}` : data.acknowledgement.objection_reason}</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
