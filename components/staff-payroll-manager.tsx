"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../app/manager/staff-payroll/page.module.css";

type LineItem = {
  id: string;
  item_type: string;
  code: string;
  label: string;
  quantity: number | null;
  rate: number | null;
  amount: number;
};
type Statement = {
  id: string;
  employee_id: string;
  regular_minutes: number;
  overtime_minutes: number;
  base_pay: number;
  overtime_pay: number;
  leave_deduction: number;
  labor_insurance_employee: number;
  health_insurance_employee: number;
  pension_employee: number;
  bonus_total: number;
  gross_pay: number;
  deduction_total: number;
  net_pay: number;
  status: string;
  attendance_snapshot: {
    unresolvedCount?: number;
    insuranceReady?: boolean;
    bonusRulesComplete?: boolean;
    punchBackedDays?: number;
    fallbackScheduledDays?: number;
  } | null;
  lineItems: LineItem[];
  acknowledgement: {
    action: string;
    dispute_reason: string | null;
    acted_at: string;
  } | null;
};
type PayrollState = {
  actor: { canManage: boolean; canClose: boolean; canCalculate: boolean; canManageInsurance: boolean };
  month: string;
  period: null | {
    id: string;
    status: string;
    base_pay_date: string;
    bonus_pay_date: string;
    unresolved_warning_count: number;
    insurance_incomplete_count: number;
    close_reason: string | null;
    closed_at: string | null;
  };
  employees: Array<{
    id: string;
    display_name: string | null;
    english_name: string | null;
    employee_number: string | null;
  }>;
  statements: Statement[];
  corrections: Array<{
    id: string;
    statement_id: string;
    employee_id: string;
    reason: string;
    difference_amount: number;
    status: string;
  }>;
  insuranceEnrollments: Array<{ id: string; employee_id: string; insurance_type: string; insured_salary: number | null; employee_dependents: number; voluntary_pension_rate: number; status: string }>;
  rateVersions: Array<{ id: string; rate_type: string; effective_from: string; configuration: { employeeRate?: number; maxDependents?: number }; source_label: string | null }>;
  bonusEntries: Array<{ id: string; employee_id: string; bonus_type: string; label: string; amount: number; status: string; source_note: string | null }>;
};

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}
function hours(minutes: number) {
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}
async function parse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok)
    throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as PayrollState;
}

export default function StaffPayrollManager() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<PayrollState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const employeeMap = useMemo(
    () => new Map((data?.employees || []).map((item) => [item.id, item])),
    [data?.employees],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(
        await parse(
          await fetch(`/api/staff-payroll?month=${month}`, {
            cache: "no-store",
          }),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    action: string,
    values: Record<string, unknown> = {},
    success = "已完成",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await parse(
        await fetch("/api/staff-payroll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, month, ...values }),
        }),
      );
      setData(next);
      setNotice(success);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失敗");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function name(employeeId: string) {
    const item = employeeMap.get(employeeId);
    return (
      item?.display_name ||
      item?.english_name ||
      item?.employee_number ||
      "未命名員工"
    );
  }

  async function configureInsurance(employeeId: string) {
    const existing = (type: string) => data?.insuranceEnrollments.find((item) => item.employee_id === employeeId && item.insurance_type === type);
    const laborSalary = window.prompt("勞保投保級距（月額）", String(existing("labor")?.insured_salary || 29500));
    if (laborSalary === null) return;
    const healthSalary = window.prompt("健保投保級距（月額）", String(existing("health")?.insured_salary || laborSalary));
    if (healthSalary === null) return;
    const pensionSalary = window.prompt("勞退提繳工資（月額）", String(existing("pension")?.insured_salary || laborSalary));
    if (pensionSalary === null) return;
    const dependents = window.prompt("健保眷屬人數", String(existing("health")?.employee_dependents || 0));
    if (dependents === null) return;
    const voluntaryPercent = window.prompt("員工勞退自願提繳百分比（0～6）", String(Number(existing("pension")?.voluntary_pension_rate || 0) * 100));
    if (voluntaryPercent === null) return;
    const enrolledFrom = window.prompt("生效日（YYYY-MM-DD）", `${month}-01`);
    if (!enrolledFrom) return;
    const reason = window.prompt("設定／異動原因（必填）", "建立公司投保資料");
    if (!reason) return;
    await act("configure_insurance", { employeeId, laborSalary: Number(laborSalary), healthSalary: Number(healthSalary), pensionSalary: Number(pensionSalary), dependents: Number(dependents), voluntaryPensionRate: Number(voluntaryPercent) / 100, enrolledFrom, reason }, "勞健保與勞退資料已儲存");
  }

  async function configureRate(rateType: "labor_insurance" | "health_insurance") {
    const latest = data?.rateVersions.find((item) => item.rate_type === rateType);
    const percent = window.prompt(`${rateType === "labor_insurance" ? "勞保" : "健保"}員工負擔率（百分比）`, latest?.configuration.employeeRate === undefined ? "" : String(latest.configuration.employeeRate * 100));
    if (percent === null) return;
    const effectiveFrom = window.prompt("費率生效日（YYYY-MM-DD）", latest?.effective_from || `${month}-01`);
    if (!effectiveFrom) return;
    const sourceLabel = window.prompt("費率來源或核定說明（必填）", latest?.source_label || "公司依官方費率表設定");
    if (!sourceLabel) return;
    await act("configure_rate", { rateType, employeeRate: Number(percent) / 100, maxDependents: 3, effectiveFrom, sourceLabel }, "法定費率已儲存");
  }

  async function addBonus(employeeId: string) {
    const label = window.prompt("其他獎金名稱，例如：績效獎金、津貼（課費已自動計算）", "其他獎金");
    if (!label) return;
    const amount = window.prompt("本期金額", "0");
    if (amount === null) return;
    const sourceNote = window.prompt("計算依據或備註（建議填寫）", "主管人工核定");
    await act("add_bonus", { employeeId, bonusType: "other", label, amount: Number(amount), sourceNote: sourceNote || "" }, "獎金已加入；重新試算後會計入薪資單");
  }
  const totalNet =
    data?.statements.reduce((sum, item) => sum + Number(item.net_pay), 0) || 0;
  const warningCount =
    Number(data?.period?.unresolved_warning_count || 0) +
    Number(data?.period?.insurance_incomplete_count || 0);

  if (loading && !data)
    return (
      <main className={styles.page}>
        <div className={styles.empty}>正在整理薪資試算…</div>
      </main>
    );
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>巨挺健身館 · 薪資</p>
          <h1>薪資試算與關帳</h1>
          <span>計薪區間每月 1 日至月底；底薪次月 10 日、獎金次月 25 日。</span>
        </div>
        <div>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <a href="/manager/staff-attendance">打卡異常</a>
          <a href="/manager/staff-performance">業績與 EPO</a>
          <a href="/manager/staff-scheduling">員工班表</a>
          <a href="/manager/staff-permissions">帳號權限</a>
        </div>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}
      <section className={styles.toolbar}>
        <div>
          <h2>{month} 薪資批次</h2>
          <p>
            重新試算會依已發布班表、實際打卡、核准請假與主管已覆核的加班重算，但不會改動已關帳快照。
          </p>
        </div>
        <button
          disabled={busy || data?.period?.status === "closed"}
          onClick={() => void act("generate", {}, "薪資已重新試算到分鐘")}
        >
          {data?.period ? "重新試算" : "產生薪資試算"}
        </button>
      </section>
      {data?.actor.canManageInsurance ? (
        <section className={styles.settingsPanel}>
          <div><h2>勞健保與勞退設定</h2><p>系統不猜費率或級距；填入後才會正式扣款。所有異動都會保留生效日與理由。</p></div>
          <div className={styles.settingActions}>
            <button disabled={busy} onClick={() => void configureRate("labor_insurance")}>設定勞保員工負擔率</button>
            <button disabled={busy} onClick={() => void configureRate("health_insurance")}>設定健保員工負擔率</button>
            <select defaultValue="" onChange={(event) => { if (event.target.value) void configureInsurance(event.target.value); event.target.value = ""; }} disabled={busy}>
              <option value="">選擇員工設定投保資料</option>
              {data.employees.map((employee) => <option key={employee.id} value={employee.id}>{name(employee.id)}</option>)}
            </select>
          </div>
        </section>
      ) : null}
      {data?.period ? (
        <>
          <section className={styles.stats}>
            <article>
              <span>流程狀態</span>
              <strong>{data.period.status}</strong>
            </article>
            <article>
              <span>員工人數</span>
              <strong>{data.statements.length}</strong>
            </article>
            <article>
              <span>本期淨額合計</span>
              <strong>{money(totalNet)}</strong>
            </article>
            <article
              className={
                data.period.unresolved_warning_count ? styles.warn : ""
              }
            >
              <span>未確認項目</span>
              <strong>{data.period.unresolved_warning_count}</strong>
            </article>
            <article
              className={
                data.period.insurance_incomplete_count ? styles.warn : ""
              }
            >
              <span>勞健保待補</span>
              <strong>{data.period.insurance_incomplete_count}</strong>
            </article>
          </section>
          <section className={styles.deferred}>
            <strong>薪資資料提醒</strong>
            <span>
              課費已依經理確認的月業績、退款與完課堂數自動計算；其他非課費獎金仍可逐筆新增。
            </span>
            <span>
              未填完整的投保級距、眷屬或法定費率會明確列為待補，不會猜測扣款。
            </span>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}>
              <div>
                <h2>員工薪資明細</h2>
                <p>
                  時薪以實際打卡分鐘計算並限制在排定班次內；缺卡先以排定工時暫算並顯示警告。晚打卡只有確認有工作且主管覆核後才計入加班。
                </p>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>員工</th>
                    <th>一般工時</th>
                    <th>加班</th>
                    <th>底薪／時薪</th>
                    <th>加班費</th>
                    <th>請假扣除</th>
                    <th>保險／自提</th>
                    <th>獎金</th>
                    <th>應領淨額</th>
                    <th>狀態</th>
                    <th>更正</th>
                  </tr>
                </thead>
                <tbody>
                  {data.statements.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{name(item.employee_id)}</strong>
                        <small>
                          {employeeMap.get(item.employee_id)?.employee_number}
                        </small>
                      </td>
                      <td>{hours(item.regular_minutes)}</td>
                      <td>{hours(item.overtime_minutes)}</td>
                      <td>{money(item.base_pay)}</td>
                      <td>{money(item.overtime_pay)}</td>
                      <td>{money(item.leave_deduction)}</td>
                      <td>{money(Number(item.labor_insurance_employee || 0) + Number(item.health_insurance_employee || 0) + Number(item.pension_employee || 0))}</td>
                      <td>{money(item.bonus_total)}{data.actor.canCalculate && data.period?.status !== "closed" ? <button type="button" onClick={() => void addBonus(item.employee_id)}>＋新增</button> : null}</td>
                      <td className={styles.net}>{money(item.net_pay)}</td>
                      <td>
                        {item.status}
                        {item.acknowledgement ? (
                          <small>
                            {item.acknowledgement.action === "read"
                              ? "員工已閱讀"
                              : "員工提出爭議"}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        <button
                          disabled={data.period?.status !== "closed" || busy}
                          onClick={() => {
                            const difference =
                              window.prompt(
                                "更正差額（增加填正數、扣回填負數）",
                              );
                            if (difference === null) return;
                            const reason = window.prompt("更正原因（必填）");
                            if (reason)
                              void act(
                                "create_correction",
                                {
                                  statementId: item.id,
                                  differenceAmount: Number(difference),
                                  reason,
                                },
                                "薪資更正單已建立；後續需員工簽名",
                              );
                          }}
                        >
                          建立更正單
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {data.bonusEntries.length ? <section className={styles.panel}><div className={styles.panelHeading}><div><h2>本期獎金輸入</h2><p>取消後須重新試算，薪資單才會更新。</p></div></div><div className={styles.bonusList}>{data.bonusEntries.map((bonus) => <div key={bonus.id}><span><strong>{name(bonus.employee_id)}</strong> · {bonus.label}<small>{bonus.source_note || "無備註"}</small></span><b>{money(bonus.amount)}</b>{bonus.status === "approved" && data.period?.status !== "closed" ? <button onClick={() => { const reason = window.prompt("取消原因（必填）"); if (reason) void act("cancel_bonus", { bonusId: bonus.id, reason }, "獎金項目已取消；請重新試算"); }}>取消</button> : <em>{bonus.status}</em>}</div>)}</div></section> : null}
          <section className={styles.closePanel}>
            <div>
              <h2>正式關帳</h2>
              <p>
                未確認項目不扣住正常底薪。若仍有警告，經理可填理由先關帳，之後以薪資更正單補差額。
              </p>
              {warningCount > 0 ? (
                <textarea
                  rows={3}
                  value={closeReason}
                  onChange={(event) => setCloseReason(event.target.value)}
                  placeholder={`目前有 ${warningCount} 項警告；請填寫先關帳理由`}
                />
              ) : null}
              <small>
                預定底薪日 {data.period.base_pay_date}　·　獎金日{" "}
                {data.period.bonus_pay_date}
              </small>
            </div>
            <div>
              {data.actor.canClose && data.period.status !== "closed" ? (
                <button
                  disabled={busy || (warningCount > 0 && !closeReason.trim())}
                  onClick={() => {
                    if (
                      window.confirm("確認關帳？關帳後的差額只能走薪資更正單。")
                    )
                      void act(
                        "close",
                        { reason: closeReason },
                        "薪資已正式關帳",
                      );
                  }}
                >
                  經理／Owner 關帳
                </button>
              ) : null}
              {data.actor.canClose && data.period.status === "closed" ? (
                <button
                  disabled={
                    busy ||
                    data.statements.every((item) => item.status === "issued")
                  }
                  onClick={() => {
                    if (window.confirm("確認發出薪資單並通知所有員工？"))
                      void act("issue", {}, "薪資單已發出並站內通知員工");
                  }}
                >
                  發出薪資單
                </button>
              ) : null}
            </div>
          </section>
        </>
      ) : (
        <section className={styles.empty}>
          <span>🧾</span>
          <h2>這個月份還沒有薪資試算</h2>
          <p>
            先完成班表與打卡覆核，再點「產生薪資試算」。若提前完成，也可提前處理。
          </p>
        </section>
      )}
    </main>
  );
}
