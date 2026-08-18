"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../app/staff/performance/page.module.css";

type CoachSummary = {
  id: string;
  display_name: string | null;
  english_name: string | null;
  employee_number: string | null;
  employment_type: "full_time" | "part_time" | null;
  employment_configured: boolean;
  confirmedSales: number;
  projectedSales: number;
  completedSessions: number;
  confirmedEpo: number;
  projectedEpo: number;
  sessionRate: number;
  courseFeeAmount: number;
  salesRemaining: number;
  sessionsRemaining: number;
  nextTier: null | { salesThreshold: number; sessionThreshold: number | null; sessionRate: number };
};

type SalesEvent = {
  id: string;
  business_date: string;
  source_type: string;
  label: string;
  amount: number;
  status: string;
  assigned_employee_id: string | null;
  review_note: string | null;
  allocation_note: string | null;
  origin_employee_id: string | null;
  contract_sessions: number | null;
  allocations: SalesAllocation[];
};

type SalesAllocation = {
  id: string;
  employee_id: string;
  amount: number;
  allocation_kind: string;
  status: string;
  source_allocation_id: string | null;
};

type EpoAward = {
  id: string;
  business_date: string;
  employee_id: string;
  quantity: number;
  reason: string;
  status: string;
  review_note: string | null;
  award_type: string;
  calculation: Record<string, unknown>;
};

type DailyTopState = {
  id: string;
  business_date: string;
  adjustment_business_date: string;
  top_amount: number;
  candidate_employee_ids: string[];
  selected_employee_id: string | null;
  status: string;
};

type PerformanceState = {
  actor: {
    id: string;
    canManage: boolean;
    canAllocate: boolean;
    canApprove: boolean;
    canManageEpo: boolean;
    canConfirm: boolean;
  };
  month: string;
  selectedDate: string;
  coaches: CoachSummary[];
  events: SalesEvent[];
  epoAwards: EpoAward[];
  dailyReports: Array<{ id: string; business_date: string; status: string; confirmed_at: string | null; prepared_at: string | null; prepared_by: string | null; reopen_reason: string | null }>;
  dailyTopStates: DailyTopState[];
  sessionEpoEvidence: Array<{ employeeId: string; employmentType: "full_time" | "part_time"; scheduleReady: boolean; inside: number; outside: number; boundary: number; eligible: boolean; requiredInside: number; requiredOutside: number }>;
  courseSettlement: null | {
    summary: { total: number; completed: number; cancelled: number; noShow: number; pending: number; ptCompleted: number; trialCompleted: number };
    closure: null | { status: string; confirmed_at: string | null; reopened_at: string | null };
  };
};

const SOURCE_LABELS: Record<string, string> = {
  fa: "FA 成交",
  renewal: "續約",
  final_payment: "繳交尾款",
  refund: "退款扣回",
  manual_adjustment: "人工調整",
};

const STATUS_LABELS: Record<string, string> = {
  unassigned: "尚未分配",
  pending_manager: "等待經理覆核",
  approved: "已覆核，待日報確認",
  daily_confirmed: "每日報表已確認",
  rejected: "不列入業績",
  ignored: "已作廢",
  assistant_proposed: "等待經理覆核",
  manager_approved: "已覆核，待日報確認",
  cancelled: "已取消",
};

const EPO_TYPE_LABELS: Record<string, string> = {
  manual: "人工 EPO",
  contract_threshold: "成交堂數達標",
  daily_top: "每日數字最高",
  session_load: "班內外堂數達標",
  reversal: "追回",
  reassignment: "退單重算補發",
};

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function todayTaiwan() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function parse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as PerformanceState;
}

export default function StaffPerformanceDashboard() {
  const initialToday = todayTaiwan();
  const [month, setMonth] = useState(initialToday.slice(0, 7));
  const [date, setDate] = useState(initialToday);
  const [data, setData] = useState<PerformanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [epoEmployeeId, setEpoEmployeeId] = useState("");
  const [epoQuantity, setEpoQuantity] = useState(1);
  const [epoReason, setEpoReason] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [allocationDraft, setAllocationDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requestedMonth = query.get("month");
    const requestedDate = query.get("date");
    if (requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)) setMonth(requestedMonth);
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) setDate(requestedDate);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await parse(await fetch(`/api/staff-performance?month=${month}&date=${date}`, { cache: "no-store" })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [date, month]);

  useEffect(() => { void load(); }, [load]);

  async function act(action: string, values: Record<string, unknown> = {}, success = "已完成") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(await parse(await fetch("/api/staff-performance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, month, date, ...values }),
      })));
      setNotice(success);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失敗");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const coachMap = useMemo(() => new Map((data?.coaches || []).map((coach) => [coach.id, coach])), [data?.coaches]);
  const coachName = (id: string | null) => {
    const coach = id ? coachMap.get(id) : null;
    return coach?.display_name || coach?.english_name || coach?.employee_number || "尚未分配";
  };
  const dayEvents = (data?.events || []).filter((item) => item.business_date === date);
  const dayEpo = (data?.epoAwards || []).filter((item) => item.business_date === date);
  const dayReport = (data?.dailyReports || []).find((item) => item.business_date === date) || null;
  const reportConfirmed = dayReport?.status === "confirmed";
  const topStates = (data?.dailyTopStates || []).filter((item) => item.business_date === date || item.adjustment_business_date === date);
  const courseSummary = data?.courseSettlement?.summary || null;

  function changeMonth(nextMonth: string) {
    setMonth(nextMonth);
    setDate(`${nextMonth}-01`);
  }

  async function reviewEvent(eventId: string, decision: "approve" | "reject") {
    let note = "";
    if (decision === "reject") {
      note = window.prompt("請填寫不列入業績／退回重分配的原因") || "";
      if (!note) return;
    }
    if (!window.confirm(decision === "approve" ? "確認此筆業績分配正確？" : "確認此筆不列入業績？")) return;
    await act("review_event", { eventId, decision, note }, decision === "approve" ? "業績已覆核" : "業績已標記不列入");
  }

  async function reviewEpo(epoId: string, decision: "approve" | "reject") {
    let note = "";
    if (decision === "reject") {
      note = window.prompt("請填寫駁回 EPO 的原因") || "";
      if (!note) return;
    }
    if (!window.confirm(decision === "approve" ? "確認給出這筆 EPO？" : "確認駁回這筆 EPO？")) return;
    await act("review_epo", { epoId, decision, note }, decision === "approve" ? "EPO 已覆核" : "EPO 已駁回");
  }

  async function addEpo() {
    if (!epoEmployeeId || !epoReason.trim()) return;
    const coach = coachMap.get(epoEmployeeId);
    if (!window.confirm(`確認給 ${coachName(epoEmployeeId)} ${epoQuantity} 個 EPO？\n原因：${epoReason}`)) return;
    const ok = await act("propose_epo", { employeeId: epoEmployeeId, quantity: epoQuantity, reason: epoReason }, data?.actor.canApprove ? "EPO 已加入，待今日報表再次確認" : "EPO 已送經理覆核");
    if (ok) {
      setEpoReason("");
      setEpoQuantity(1);
      if (coach) setEpoEmployeeId(coach.id);
    }
  }

  async function createManualEvent() {
    const sourceType = window.prompt("類型：fa、renewal、final_payment、manual_adjustment", "manual_adjustment");
    if (!sourceType || !["fa", "renewal", "final_payment", "manual_adjustment"].includes(sourceType)) return;
    const label = window.prompt("項目名稱（請寫明會員或原因）");
    if (!label) return;
    const rawAmount = window.prompt("業績金額");
    if (!rawAmount || !Number(rawAmount)) return;
    const employeeId = window.prompt(`教練 ID：\n${(data?.coaches || []).map((coach) => `${coachName(coach.id)}：${coach.id}`).join("\n")}`);
    if (!employeeId || !coachMap.has(employeeId)) return;
    if (!window.confirm(`確認新增 ${label}，${money(Number(rawAmount))}，分配給 ${coachName(employeeId)}？`)) return;
    await act("create_manual_event", { sourceType, label, amount: Number(rawAmount), employeeId }, "人工業績項目已加入，待今日報表確認");
  }

  function beginAllocation(event: SalesEvent) {
    setEditingEventId(event.id);
    setAllocationDraft(Object.fromEntries(event.allocations.map((allocation) => [allocation.employee_id, String(allocation.amount)])));
  }

  async function saveAllocations(event: SalesEvent) {
    const allocations = Object.entries(allocationDraft)
      .map(([employeeId, rawAmount]) => ({ employeeId, amount: Number(rawAmount) }))
      .filter((item) => Number.isFinite(item.amount) && item.amount > 0);
    const allocated = Math.round(allocations.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    const total = Math.round(Number(event.amount) * 100) / 100;
    if (allocated !== total) {
      setError(`分配總額必須等於 ${money(total)}，目前為 ${money(allocated)}，還差 ${money(total - allocated)}。`);
      return;
    }
    if (!window.confirm(`確認「${event.label}」分配如下？\n${allocations.map((item) => `${coachName(item.employeeId)}：${money(item.amount)}`).join("\n")}`)) return;
    const ok = await act("save_allocations", { eventId: event.id, allocations }, data?.actor.canApprove ? "分配已由經理直接核准" : "分配已送經理覆核");
    if (ok) {
      setEditingEventId(null);
      setAllocationDraft({});
    }
  }

  if (loading && !data) return <main className={styles.page}><div className={styles.empty}>正在整理業績與 EPO…</div></main>;
  const self = data?.coaches[0] || null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>巨挺健身館 · {data?.actor.canManage ? "主管專區" : "教練個人專區"}</p>
          <h1>{data?.actor.canManage ? "每日課程、業績與 EPO 結算" : "我的業績與課費"}</h1>
          <span>{data?.actor.canManage ? "副理可完成初審並送出；經理可直接調整，最後正式結算課程、業績與 EPO。" : "此頁只顯示您本人且已由經理正式結算的資料。"}</span>
        </div>
        <nav>
          <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} />
          {data?.actor.canManage ? <a href="/manager/staff-payroll">薪資試算</a> : <a href="/staff/payroll">我的薪資單</a>}
          {data?.actor.canManage ? <a href="/manager/staff-scheduling">設定正／兼職</a> : null}
          {data?.actor.canManage ? <a href="/manager/fitness">營運班表</a> : <a href="/staff/schedule">我的班表</a>}
        </nav>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      {data?.actor.canManage ? (
        <>
          <section className={styles.coachGrid}>
            {data.coaches.map((coach) => (
              <article key={coach.id}>
                <div><strong>{coachName(coach.id)}</strong><small>{!coach.employment_configured ? "正／兼職待設定" : coach.employment_type === "part_time" ? "兼職" : "正職"}</small></div>
                <dl>
                  <div><dt>目前 EPO</dt><dd>{coach.projectedEpo}</dd></div>
                  <div><dt>目前業績</dt><dd>{money(coach.projectedSales)}</dd></div>
                  <div><dt>已完課</dt><dd>{coach.completedSessions} 堂</dd></div>
                  <div><dt>已確認堂費</dt><dd>{coach.employment_configured ? `${money(coach.sessionRate)}／堂` : "待設定"}</dd></div>
                </dl>
                {coach.projectedSales !== coach.confirmedSales || coach.projectedEpo !== coach.confirmedEpo ? <small className={styles.pending}>含尚待當日報表確認的分配</small> : null}
              </article>
            ))}
          </section>

          <section className={styles.dayToolbar}>
            <div>
              <label>處理日期<input type="date" value={date} min={`${month}-01`} max={`${month}-31`} onChange={(event) => setDate(event.target.value)} /></label>
              <strong className={reportConfirmed ? styles.confirmed : styles.draft}>{reportConfirmed ? "本日已正式結算" : dayReport?.status === "reopened" ? "本日結算已重新開啟" : dayReport?.prepared_at ? "副理已完成初審，等待經理" : "本日尚未結算"}</strong>
              {courseSummary ? <span className={courseSummary.pending ? styles.pending : styles.confirmed}>課程：完成 {courseSummary.completed}、取消 {courseSummary.cancelled}、請假／未到 {courseSummary.noShow}、待處理 {courseSummary.pending}</span> : null}
            </div>
            <div>
              {data.actor.canApprove && !reportConfirmed ? <button type="button" disabled={busy} onClick={() => void createManualEvent()}>＋人工補登</button> : null}
              {!data.actor.canConfirm && data.actor.canAllocate && !reportConfirmed ? <button className={styles.primary} type="button" disabled={busy} onClick={() => { if (window.confirm(`確認已整理 ${date} 的課程狀態、業績分配與 EPO，並送經理覆核？`)) void act("prepare_day", {}, "今日課程與業績已送經理覆核"); }}>完成初審並送經理</button> : null}
              {data.actor.canConfirm && !reportConfirmed ? <button className={styles.primary} type="button" disabled={busy} onClick={() => { if (window.confirm(`正式結算 ${date} 的課程、業績與 EPO？完成後會計入教練面板與薪資。`)) void act("confirm_day", {}, "今日課程、業績與 EPO 已正式結算"); }}>正式結算今日課程與業績</button> : null}
              {data.actor.canConfirm && reportConfirmed ? <button type="button" disabled={busy} onClick={() => { const reason = window.prompt("重新開啟原因（必填）"); if (reason && window.confirm("重新開啟後，本日課程、業績與 EPO 會暫時退出正式結算，確定繼續？")) void act("reopen_day", { reason }, "今日結算已重新開啟，可進行更正"); }}>重新開啟更正</button> : null}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>實收業績分配</h2><p>FA／續約會先替原成交教練帶入 50%；可調整後再分配剩餘金額。退款只能精準反沖原正式分配。</p></div><span>{dayEvents.length} 筆</span></div>
            {dayEvents.length ? <div className={styles.tableWrap}><table>
              <thead><tr><th>項目／原始實收</th><th>分配明細</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>{dayEvents.map((event) => {
                const allocated = event.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0);
                const remaining = Number(event.amount) - allocated;
                const editable = data.actor.canAllocate && !reportConfirmed && !["daily_confirmed", "ignored"].includes(event.status) && event.source_type !== "refund";
                return <tr key={event.id}>
                  <td><strong>{event.label}</strong><small>{SOURCE_LABELS[event.source_type] || event.source_type}{event.contract_sessions ? `｜${event.contract_sessions} 堂` : ""}</small><b className={event.amount < 0 ? styles.negative : ""}>{money(event.amount)}</b></td>
                  <td>
                    {editingEventId === event.id ? <div className={styles.allocationEditor}>
                      {data.coaches.map((coach) => <label key={coach.id}><span>{coachName(coach.id)}{event.origin_employee_id === coach.id ? "（原成交）" : ""}</span><input type="number" min="0" step="1" value={allocationDraft[coach.id] || ""} onChange={(change) => setAllocationDraft((current) => ({ ...current, [coach.id]: change.target.value }))} placeholder="0" /></label>)}
                      <div className={styles.allocationTotal}><span>已分配 {money(Object.values(allocationDraft).reduce((sum, value) => sum + Number(value || 0), 0))}</span><span>應等於 {money(event.amount)}</span></div>
                    </div> : event.allocations.length ? <div className={styles.allocationList}>{event.allocations.map((allocation) => <span key={allocation.id}><b>{coachName(allocation.employee_id)}</b>{money(allocation.amount)}{allocation.allocation_kind === "origin_default" ? "（預設 50%）" : allocation.allocation_kind === "refund_reversal" ? "（原分配扣回）" : ""}</span>)}</div> : <strong>尚未分配</strong>}
                    {event.source_type !== "refund" && Math.abs(remaining) > 0.001 ? <small className={styles.pending}>尚差 {money(remaining)} 未分配</small> : null}
                    {event.source_type === "refund" ? <small>退款分配已鎖定，不可改給其他人</small> : event.allocation_note ? <small>{event.allocation_note}</small> : null}
                  </td>
                  <td><span className={styles.status}>{STATUS_LABELS[event.status] || event.status}</span>{event.review_note ? <small>{event.review_note}</small> : null}</td>
                  <td>
                    {editingEventId === event.id ? <div className={styles.rowActions}><button className={styles.primary} disabled={busy} onClick={() => void saveAllocations(event)}>儲存分配</button><button disabled={busy} onClick={() => { setEditingEventId(null); setAllocationDraft({}); }}>取消</button></div> : null}
                    {editingEventId !== event.id && editable ? <button disabled={busy} onClick={() => beginAllocation(event)}>{event.allocations.length ? "調整分配" : "開始分配"}</button> : null}
                    {data.actor.canApprove && event.status === "pending_manager" && !reportConfirmed ? <div className={styles.rowActions}><button className={styles.primary} disabled={busy} onClick={() => void reviewEvent(event.id, "approve")}>同意</button><button disabled={busy} onClick={() => void reviewEvent(event.id, "reject")}>駁回</button></div> : null}
                  </td>
                </tr>;
              })}</tbody>
            </table></div> : <div className={styles.empty}>這一天沒有收款或退款資料。</div>}
          </section>

          {topStates.length ? <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>每日數字最高 EPO</h2><p>依分配前的當日實收計算；同額第一由副理建議、經理覆核。退款會回到原收款日重算。</p></div></div>
            <div className={styles.decisionList}>{topStates.map((top) => <article key={top.id}>
              <div><strong>{top.business_date}｜最高實收 {money(top.top_amount)}</strong><small>{top.adjustment_business_date !== top.business_date ? `本次因 ${top.adjustment_business_date} 退款重算` : "依原始成交數字計算"}</small></div>
              <div className={styles.candidates}>{top.candidate_employee_ids.length ? top.candidate_employee_ids.map((employeeId) => {
                const selected = top.selected_employee_id === employeeId;
                const canChoose = data.actor.canManageEpo && !reportConfirmed && (top.status === "tie_pending" || data.actor.canApprove);
                return <button key={employeeId} className={selected ? styles.primary : ""} disabled={busy || !canChoose} onClick={() => { if (window.confirm(`確認選擇 ${coachName(employeeId)} 取得 ${top.business_date} 每日最高 1 EPO？`)) void act("select_daily_top", { originalBusinessDate: top.business_date, employeeId }, data.actor.canApprove ? "每日最高 EPO 已由經理決定" : "每日最高 EPO 已送經理覆核"); }}>{coachName(employeeId)}{selected ? " ✓" : ""}</button>;
              }) : <span>當日沒有符合的實收資料</span>}</div>
              <span className={styles.status}>{top.status === "tie_pending" ? "同額待決定" : top.status === "assistant_selected" ? "副理已選，待經理" : top.status === "manager_selected" ? "經理已決定" : top.status === "auto_selected" ? "單獨第一，自動取得" : "無得主"}</span>
            </article>)}</div>
          </section> : null}

          {(data.sessionEpoEvidence || []).length ? <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>班內／班外堂數 EPO 檢查</h2><p>只計完成的正式 PT；體驗、取消、請假與未完成不計。班內外依已發布的實際班表判定。</p></div></div>
            <div className={styles.evidenceGrid}>{data.sessionEpoEvidence.map((item) => <article key={item.employeeId} className={item.eligible ? styles.eligible : ""}>
              <strong>{coachName(item.employeeId)}</strong>
              <span>{item.employmentType === "part_time" ? "兼職" : "正職"}｜班內 {item.inside}/{item.requiredInside}｜班外 {item.outside}/{item.requiredOutside}</span>
              <small>{!item.scheduleReady ? "尚無已發布班表，暫不判定" : item.boundary ? `另有 ${item.boundary} 堂跨越班界，不計入班內外` : item.eligible ? "已符合 1 EPO" : "尚未達標"}</small>
            </article>)}</div>
          </section> : null}

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>EPO 額外績效機會</h2><p>每日確認符合條件的教練；副理提出後，經理必須覆核。</p></div><span>{dayEpo.reduce((sum, row) => sum + Number(row.quantity), 0)} 個</span></div>
            {data.actor.canManageEpo && !reportConfirmed ? <div className={styles.epoForm}>
              <select value={epoEmployeeId} onChange={(event) => setEpoEmployeeId(event.target.value)}><option value="">選擇教練</option>{data.coaches.map((coach) => <option key={coach.id} value={coach.id}>{coachName(coach.id)}｜目前 EPO {coach.projectedEpo}｜業績 {money(coach.projectedSales)}</option>)}</select>
              <input type="number" min="1" max="100" value={epoQuantity} onChange={(event) => setEpoQuantity(Number(event.target.value))} aria-label="EPO 數量" />
              <input value={epoReason} onChange={(event) => setEpoReason(event.target.value)} placeholder="符合 EPO 的原因（必填）" />
              <button className={styles.primary} disabled={busy || !epoEmployeeId || !epoReason.trim()} onClick={() => void addEpo()}>加入 EPO</button>
            </div> : null}
            {dayEpo.length ? <div className={styles.epoList}>{dayEpo.map((epo) => <article key={epo.id}>
              <div><strong className={epo.quantity < 0 ? styles.negative : ""}>{coachName(epo.employee_id)} {epo.quantity > 0 ? "+" : ""}{epo.quantity} EPO</strong><p>{epo.reason}</p><small>{EPO_TYPE_LABELS[epo.award_type] || epo.award_type}</small>{epo.review_note ? <small>{epo.review_note}</small> : null}</div>
              <span>{STATUS_LABELS[epo.status] || epo.status}</span>
              {data.actor.canApprove && epo.status === "assistant_proposed" && !reportConfirmed ? <div className={styles.rowActions}><button className={styles.primary} disabled={busy} onClick={() => void reviewEpo(epo.id, "approve")}>同意</button><button disabled={busy} onClick={() => void reviewEpo(epo.id, "reject")}>駁回</button></div> : null}
            </article>)}</div> : <div className={styles.empty}>本日尚未登記 EPO。</div>}
          </section>
        </>
      ) : self ? (
        <>
          <section className={styles.selfHero}>
            <div><span>{month} 已確認業績</span><strong>{money(self.confirmedSales)}</strong><small>退款已按退款日期扣在本月</small></div>
            <div><span>目前 EPO</span><strong>{self.confirmedEpo}</strong><small>只顯示經理已確認的 EPO</small></div>
            <div><span>本月已完課</span><strong>{self.completedSessions} 堂</strong><small>完成狀態的 PT 課程</small></div>
            <div><span>目前每堂課費</span><strong>{self.employment_configured ? money(self.sessionRate) : "待主管設定"}</strong><small>{self.employment_configured ? `本月預估課費 ${money(self.courseFeeAmount)}` : "尚未設定正職或兼職，不會猜測堂費"}</small></div>
          </section>
          <section className={styles.target}>
            <h2>{!self.employment_configured ? "請主管先設定正職／兼職" : self.nextTier ? `下一級：每堂 ${money(self.nextTier.sessionRate)}` : "已達最高課費級距"}</h2>
            {!self.employment_configured ? <p>設定完成後，系統才會顯示正確級距並自動計入薪資。</p> : self.nextTier ? <p>還需要業績 {money(self.salesRemaining)}{self.employment_type === "full_time" ? `，且還需要 ${self.sessionsRemaining} 堂完課` : "；兼職不綁最低堂數"}。需同時達標後，當月所有完課堂數會套用新單價。</p> : <p>本月所有完課堂數皆以最高單價計算。</p>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>本月已確認明細</h2><p>一般分配與 EPO 都在經理確認每日報表後才顯示。</p></div></div>
            <div className={styles.selfHistory}>
              {(data?.events || []).map((event) => <article key={event.id}><time>{event.business_date}</time><div><strong>{event.label}</strong><small>{SOURCE_LABELS[event.source_type] || event.source_type}</small></div><b className={event.amount < 0 ? styles.negative : ""}>{money(event.amount)}</b></article>)}
              {(data?.epoAwards || []).map((epo) => <article key={epo.id}><time>{epo.business_date}</time><div><strong>＋{epo.quantity} EPO</strong><small>{epo.reason}</small></div><b>EPO</b></article>)}
              {!data?.events.length && !data?.epoAwards.length ? <div className={styles.empty}>本月尚無已確認的業績或 EPO。</div> : null}
            </div>
          </section>
        </>
      ) : <div className={styles.empty}>您的帳號尚未設定為教練，請聯絡副理。</div>}
    </main>
  );
}
