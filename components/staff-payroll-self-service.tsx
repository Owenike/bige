"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../app/staff/payroll/page.module.css";
import MobileSignaturePad from "./mobile-signature-pad";

type Statement = {
  id: string;
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
  issued_at: string | null;
  lineItems: Array<{
    id: string;
    item_type: string;
    label: string;
    quantity: number | null;
    rate: number | null;
    amount: number;
  }>;
  acknowledgement: {
    action: string;
    dispute_reason: string | null;
    acted_at: string;
  } | null;
};

type Correction = {
  id: string;
  reason: string;
  difference_amount: number;
  status: string;
  employee_signed_at: string | null;
};

type State = {
  period: null | {
    base_pay_date: string;
    bonus_pay_date: string;
    status: string;
  };
  statements: Statement[];
  corrections: Correction[];
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
  return payload.data as State;
}

export default function StaffPayrollSelfService() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [reason, setReason] = useState("");
  const [activeCorrectionId, setActiveCorrectionId] = useState<string | null>(
    null,
  );
  const [correctionSignature, setCorrectionSignature] = useState<string | null>(
    null,
  );
  const [correctionConfirmed, setCorrectionConfirmed] = useState(false);

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

  async function acknowledge(
    statementId: string,
    acknowledgementAction: "read" | "disputed",
  ) {
    if (
      !window.confirm(
        acknowledgementAction === "read"
          ? "確認已完整閱讀本期薪資單？"
          : "確認送出薪資爭議，請主管重新確認？",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      setData(
        await parse(
          await fetch("/api/staff-payroll", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "acknowledge",
              month,
              statementId,
              acknowledgementAction,
              disputeReason: reason,
            }),
          }),
        ),
      );
      setNotice(
        acknowledgementAction === "read"
          ? "已記錄您已閱讀薪資單"
          : "薪資爭議已送出",
      );
      setShowDispute(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失敗");
    } finally {
      setBusy(false);
    }
  }

  function openCorrection(correctionId: string) {
    setActiveCorrectionId(correctionId);
    setCorrectionSignature(null);
    setCorrectionConfirmed(false);
  }

  async function signCorrection(correctionId: string) {
    if (!correctionSignature || !correctionConfirmed) return;
    if (
      !window.confirm(
        "確認更正原因、差額都正確，並送出本次手機簽名？送出後將保留簽署紀錄。",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      setData(
        await parse(
          await fetch("/api/staff-payroll", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "sign_correction",
              month,
              correctionId,
              checkboxConfirmed: true,
              signatureDataUrl: correctionSignature,
            }),
          }),
        ),
      );
      setNotice("薪資更正單已完成手機簽名");
      setActiveCorrectionId(null);
      setCorrectionSignature(null);
      setCorrectionConfirmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "簽名送出失敗");
    } finally {
      setBusy(false);
    }
  }

  const statement = data?.statements[0] || null;
  if (loading)
    return (
      <main className={styles.page}>
        <div className={styles.empty}>正在讀取薪資單…</div>
      </main>
    );

  return (
    <main className={styles.page}>
      <header>
        <div>
          <p>巨挺健身館 · 員工專區</p>
          <h1>我的薪資單</h1>
          <span>只有您本人能看到此頁。</span>
        </div>
        <div>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <a href="/staff/schedule">我的班表</a>
          <a href="/staff/performance">我的業績與課費</a>
        </div>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}
      {statement && statement.status !== "draft" ? (
        <>
          <section className={styles.hero}>
            <div>
              <span>{month} 薪資單</span>
              <h2>{money(statement.net_pay)}</h2>
              <p>本期應領淨額</p>
            </div>
            <div>
              <span>
                底薪發放日<strong>{data?.period?.base_pay_date}</strong>
              </span>
              <span>
                獎金發放日<strong>{data?.period?.bonus_pay_date}</strong>
              </span>
              <span>
                狀態<strong>{statement.status}</strong>
              </span>
            </div>
          </section>
          <section className={styles.summary}>
            <article>
              <span>一般工時</span>
              <strong>{hours(statement.regular_minutes)}</strong>
            </article>
            <article>
              <span>底薪／時薪</span>
              <strong>{money(statement.base_pay)}</strong>
            </article>
            <article>
              <span>加班 {hours(statement.overtime_minutes)}</span>
              <strong>{money(statement.overtime_pay)}</strong>
            </article>
            <article>
              <span>請假扣除</span>
              <strong>-{money(statement.leave_deduction)}</strong>
            </article>
            <article>
              <span>勞健保／自提</span>
              <strong>-{money(Number(statement.labor_insurance_employee || 0) + Number(statement.health_insurance_employee || 0) + Number(statement.pension_employee || 0))}</strong>
            </article>
            <article>
              <span>獎金</span>
              <strong>{money(statement.bonus_total)}</strong>
            </article>
          </section>
          <section className={styles.lines}>
            <div className={styles.sectionTitle}>
              <h2>計算明細</h2>
              <button type="button" onClick={() => window.print()}>
                列印／儲存 PDF
              </button>
            </div>
            {statement.lineItems.map((item) => {
              const isDeduction = ["deduction", "insurance", "tax"].includes(item.item_type);
              return (
              <div key={item.id}>
                <span>
                  {item.label}
                  <small>
                    {item.quantity
                      ? `數量 ${item.quantity}${item.label.includes("工時") ? " 分鐘" : ""}`
                      : ""}
                  </small>
                </span>
                <strong
                  className={isDeduction ? styles.minus : ""}
                >
                  {isDeduction ? "-" : ""}
                  {money(item.amount)}
                </strong>
              </div>
              );
            })}
            <div className={styles.total}>
              <span>應領淨額</span>
              <strong>{money(statement.net_pay)}</strong>
            </div>
          </section>
          {statement.acknowledgement ? (
            <section
              className={
                statement.acknowledgement.action === "read"
                  ? styles.read
                  : styles.disputed
              }
            >
              <h2>
                {statement.acknowledgement.action === "read"
                  ? "✓ 已閱讀"
                  : "已提出薪資爭議"}
              </h2>
              <p>
                {statement.acknowledgement.dispute_reason ||
                  "一般薪資單不需簽名。"}
              </p>
            </section>
          ) : (
            <section className={styles.actions}>
              <button
                disabled={busy}
                onClick={() => void acknowledge(statement.id, "read")}
              >
                我已閱讀
              </button>
              <button
                className={styles.disputeButton}
                onClick={() => setShowDispute((current) => !current)}
              >
                金額有問題
              </button>
              {showDispute ? (
                <div>
                  <label>
                    請說明有問題的項目
                    <textarea
                      rows={4}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void acknowledge(statement.id, "disputed")}
                  >
                    送出薪資爭議
                  </button>
                </div>
              ) : null}
            </section>
          )}
          {data?.corrections.length ? (
            <section className={styles.corrections}>
              <h2>薪資更正單</h2>
              <p>原薪資單不會被覆蓋；每一筆差額都會保留原因與簽署紀錄。</p>
              {data.corrections.map((item) => (
                <article key={item.id}>
                  <div>
                    <span>{item.reason}</span>
                    <strong
                      className={
                        Number(item.difference_amount) < 0 ? styles.minus : ""
                      }
                    >
                      {Number(item.difference_amount) > 0 ? "+" : ""}
                      {money(item.difference_amount)}
                    </strong>
                    <b>
                      {item.status === "manager_approved"
                        ? "待您簽名"
                        : item.status === "employee_signed"
                          ? "已簽名"
                          : item.status}
                    </b>
                  </div>
                  {item.status === "manager_approved" &&
                  activeCorrectionId !== item.id ? (
                    <button
                      type="button"
                      onClick={() => openCorrection(item.id)}
                    >
                      查看並簽名
                    </button>
                  ) : null}
                  {item.status === "manager_approved" &&
                  activeCorrectionId === item.id ? (
                    <div className={styles.correctionSign}>
                      <div className={styles.correctionWarning}>
                        <strong>
                          本次差額：
                          {Number(item.difference_amount) > 0 ? "增加" : "扣回"}{" "}
                          {money(Math.abs(Number(item.difference_amount)))}
                        </strong>
                        <span>原因：{item.reason}</span>
                      </div>
                      <label className={styles.confirm}>
                        <input
                          type="checkbox"
                          checked={correctionConfirmed}
                          onChange={(event) =>
                            setCorrectionConfirmed(event.target.checked)
                          }
                        />
                        我已核對更正原因與差額，確認內容正確。
                      </label>
                      <MobileSignaturePad onChange={setCorrectionSignature} />
                      <button
                        type="button"
                        disabled={
                          busy || !correctionConfirmed || !correctionSignature
                        }
                        onClick={() => void signCorrection(item.id)}
                      >
                        確認並送出手機簽名
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
        </>
      ) : (
        <section className={styles.empty}>
          <span>🧾</span>
          <h2>目前沒有已發出的 {month} 薪資單</h2>
          <p>主管完成關帳並發出後，您會收到站內通知。</p>
        </section>
      )}
    </main>
  );
}
