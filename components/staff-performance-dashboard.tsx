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
};

type EpoAward = {
  id: string;
  business_date: string;
  employee_id: string;
  quantity: number;
  reason: string;
  status: string;
  review_note: string | null;
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
  dailyReports: Array<{ id: string; business_date: string; status: string; confirmed_at: string | null; reopen_reason: string | null }>;
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
    const sourceType = window.prompt("類型：fa、renewal、final_payment、refund、manual_adjustment", "manual_adjustment");
    if (!sourceType || !["fa", "renewal", "final_payment", "refund", "manual_adjustment"].includes(sourceType)) return;
    const label = window.prompt("項目名稱（請寫明會員或原因）");
    if (!label) return;
    const rawAmount = window.prompt(sourceType === "refund" ? "退款金額（輸入正數即可）" : "業績金額");
    if (!rawAmount || !Number(rawAmount)) return;
    const employeeId = window.prompt(`教練 ID：\n${(data?.coaches || []).map((coach) => `${coachName(coach.id)}：${coach.id}`).join("\n")}`);
    if (!employeeId || !coachMap.has(employeeId)) return;
    if (!window.confirm(`確認新增 ${label}，${money(Number(rawAmount))}，分配給 ${coachName(employeeId)}？`)) return;
    await act("create_manual_event", { sourceType, label, amount: Number(rawAmount), employeeId }, "人工業績項目已加入，待今日報表確認");
  }

  if (loading && !data) return <main className={styles.page}><div className={styles.empty}>正在整理業績與 EPO…</div></main>;
  const self = data?.coaches[0] || null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>巨挺健身館 · {data?.actor.canManage ? "主管專區" : "教練個人專區"}</p>
          <h1>{data?.actor.canManage ? "每日業績分配與 EPO" : "我的業績與課費"}</h1>
          <span>{data?.actor.canManage ? "副理可分配與提出 EPO；經理覆核後，再由經理確認每日報表。" : "此頁只顯示您本人且已由經理確認的資料。"}</span>
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
              <strong className={reportConfirmed ? styles.confirmed : styles.draft}>{reportConfirmed ? "本日報表已確認" : dayReport?.status === "reopened" ? "本日報表已重新開啟" : "本日報表尚未確認"}</strong>
            </div>
            <div>
              {data.actor.canApprove && !reportConfirmed ? <button type="button" disabled={busy} onClick={() => void createManualEvent()}>＋人工補登</button> : null}
              {data.actor.canConfirm && !reportConfirmed ? <button className={styles.primary} type="button" disabled={busy} onClick={() => { if (window.confirm(`最後確認 ${date} 所有業績與 EPO？確認後才會計入教練面板與薪資。`)) void act("confirm_day", {}, "每日業績報表已確認"); }}>確認本日報表</button> : null}
              {data.actor.canConfirm && reportConfirmed ? <button type="button" disabled={busy} onClick={() => { const reason = window.prompt("重新開啟原因（必填）"); if (reason && window.confirm("重新開啟後，本日資料會暫時退出教練面板與薪資計算，確定繼續？")) void act("reopen_day", { reason }, "每日報表已重新開啟，可進行更正"); }}>重新開啟更正</button> : null}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>已成交／收款／退款</h2><p>系統自動帶入實收與退款。退款一律以退款日期扣當月業績。</p></div><span>{dayEvents.length} 筆</span></div>
            {dayEvents.length ? <div className={styles.tableWrap}><table>
              <thead><tr><th>項目</th><th>金額</th><th>分配教練</th><th>狀態</th><th>經理覆核</th></tr></thead>
              <tbody>{dayEvents.map((event) => <tr key={event.id}>
                <td><strong>{event.label}</strong><small>{SOURCE_LABELS[event.source_type] || event.source_type}</small></td>
                <td className={event.amount < 0 ? styles.negative : ""}>{money(event.amount)}</td>
                <td>
                  {data.actor.canAllocate && !reportConfirmed && !["daily_confirmed", "ignored"].includes(event.status) ? <select value={event.assigned_employee_id || ""} disabled={busy} onChange={(change) => { if (change.target.value && window.confirm(`確認把「${event.label}」分配給 ${coachName(change.target.value)}？`)) void act("assign_event", { eventId: event.id, employeeId: change.target.value }, data.actor.canApprove ? "業績已分配，待本日報表確認" : "業績已送經理覆核"); }}>
                    <option value="">請選擇教練</option>
                    {data.coaches.map((coach) => <option key={coach.id} value={coach.id}>{coachName(coach.id)}｜EPO {coach.projectedEpo}｜業績 {money(coach.projectedSales)}｜{coach.employment_configured ? `${money(coach.sessionRate)}/堂` : "正兼職待設定"}</option>)}
                  </select> : <strong>{coachName(event.assigned_employee_id)}</strong>}
                </td>
                <td><span className={styles.status}>{STATUS_LABELS[event.status] || event.status}</span>{event.review_note ? <small>{event.review_note}</small> : null}</td>
                <td>{data.actor.canApprove && event.status === "pending_manager" && !reportConfirmed ? <div className={styles.rowActions}><button className={styles.primary} disabled={busy} onClick={() => void reviewEvent(event.id, "approve")}>同意</button><button disabled={busy} onClick={() => void reviewEvent(event.id, "reject")}>駁回</button></div> : "—"}</td>
              </tr>)}</tbody>
            </table></div> : <div className={styles.empty}>這一天沒有收款或退款資料。</div>}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>EPO 額外績效機會</h2><p>每日確認符合條件的教練；副理提出後，經理必須覆核。</p></div><span>{dayEpo.reduce((sum, row) => sum + Number(row.quantity), 0)} 個</span></div>
            {data.actor.canManageEpo && !reportConfirmed ? <div className={styles.epoForm}>
              <select value={epoEmployeeId} onChange={(event) => setEpoEmployeeId(event.target.value)}><option value="">選擇教練</option>{data.coaches.map((coach) => <option key={coach.id} value={coach.id}>{coachName(coach.id)}｜目前 EPO {coach.projectedEpo}｜業績 {money(coach.projectedSales)}</option>)}</select>
              <input type="number" min="1" max="100" value={epoQuantity} onChange={(event) => setEpoQuantity(Number(event.target.value))} aria-label="EPO 數量" />
              <input value={epoReason} onChange={(event) => setEpoReason(event.target.value)} placeholder="符合 EPO 的原因（必填）" />
              <button className={styles.primary} disabled={busy || !epoEmployeeId || !epoReason.trim()} onClick={() => void addEpo()}>加入 EPO</button>
            </div> : null}
            {dayEpo.length ? <div className={styles.epoList}>{dayEpo.map((epo) => <article key={epo.id}>
              <div><strong>{coachName(epo.employee_id)} ＋{epo.quantity} EPO</strong><p>{epo.reason}</p>{epo.review_note ? <small>{epo.review_note}</small> : null}</div>
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
