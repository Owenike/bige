"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../app/manager/staff-leave/page.module.css";
type Request = {
  id: string;
  employee_id: string;
  leave_type: string;
  starts_at: string;
  ends_at: string;
  unit: string;
  reason: string | null;
  proof_required: boolean;
  proof_due_at: string | null;
  proofOverdue: boolean;
  status: string;
  assistant_decision: string | null;
  manager_decision: string | null;
  staff_leave_attachments: Array<{ id: string; file_name: string }>;
};
type State = {
  actor: { canAssistant: boolean; canFinal: boolean };
  employees: Array<{
    id: string;
    display_name: string | null;
    english_name: string | null;
    employee_number: string | null;
  }>;
  requests: Request[];
};
const LABELS: Record<string, string> = {
  annual: "特休",
  sick: "病假",
  personal: "事假",
  family_care: "家庭照顧假",
  marriage: "婚假",
  bereavement: "喪假",
  official: "公假",
  other: "其他假",
};
function format(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
async function parse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok)
    throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as State;
}
export default function StaffLeaveManager() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
          await fetch(`/api/staff-leave?month=${month}`, { cache: "no-store" }),
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
  function name(id: string) {
    const item = employeeMap.get(id);
    return (
      item?.display_name ||
      item?.english_name ||
      item?.employee_number ||
      "未命名員工"
    );
  }
  async function review(
    request: Request,
    stage: "assistant_manager" | "manager",
    decision: "approved" | "rejected" | "returned" | "adjustment_proposed",
  ) {
    let reason = "";
    let proposedStartsAt: string | undefined;
    let proposedEndsAt: string | undefined;
    if (decision !== "approved") {
      reason =
        window.prompt(
          decision === "adjustment_proposed"
            ? "請填寫建議調整原因"
            : "請填寫理由（必填）",
        ) || "";
      if (!reason) return;
    }
    if (decision === "adjustment_proposed") {
      const start = window.prompt("建議開始時間，例如 2026-08-20T09:00");
      const end = window.prompt("建議結束時間，例如 2026-08-20T17:00");
      if (!start || !end) return;
      proposedStartsAt = new Date(start).toISOString();
      proposedEndsAt = new Date(end).toISOString();
    }
    setBusy(true);
    setError("");
    try {
      setData(
        await parse(
          await fetch("/api/staff-leave", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "review",
              month,
              requestId: request.id,
              stage,
              decision,
              reason,
              proposedStartsAt,
              proposedEndsAt,
            }),
          }),
        ),
      );
      setNotice(
        stage === "assistant_manager" ? "副理初審已更新" : "經理最終決定已更新",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "覆核失敗");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className={styles.page}>
        <div className={styles.empty}>正在讀取請假單…</div>
      </main>
    );
  return (
    <main className={styles.page}>
      <header>
        <div>
          <p>巨挺健身館 · 請假覆核</p>
          <h1>請假單兩次審核</h1>
          <span>
            副理先檢查，經理每筆最終核准；兩個階段都可核准、駁回、退回補充或建議調整日期。
          </span>
        </div>
        <div>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <a href="/manager/staff-scheduling">員工班表</a>
        </div>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}
      <section className={styles.stats}>
        <article>
          <span>本月申請</span>
          <strong>{data?.requests.length || 0}</strong>
        </article>
        <article>
          <span>等待副理</span>
          <strong>
            {data?.requests.filter((item) => item.status === "assistant_review")
              .length || 0}
          </strong>
        </article>
        <article>
          <span>等待經理</span>
          <strong>
            {data?.requests.filter((item) => item.status === "manager_review")
              .length || 0}
          </strong>
        </article>
        <article>
          <span>證明逾期未補</span>
          <strong>
            {data?.requests.filter((item) => item.proofOverdue).length || 0}
          </strong>
        </article>
      </section>
      <section className={styles.list}>
        {!data?.requests.length ? (
          <div className={styles.empty}>本月尚無請假單。</div>
        ) : (
          data.requests.map((item) => (
            <article
              key={item.id}
              className={item.proofOverdue ? styles.overdue : ""}
            >
              <header>
                <div>
                  <h2>
                    {name(item.employee_id)} ·{" "}
                    {LABELS[item.leave_type] || item.leave_type}
                  </h2>
                  <p>
                    {format(item.starts_at)} ～ {format(item.ends_at)}
                  </p>
                </div>
                <b>{item.status}</b>
              </header>
              <dl>
                <div>
                  <dt>員工說明</dt>
                  <dd>{item.reason || "無"}</dd>
                </div>
                <div>
                  <dt>證明附件</dt>
                  <dd>
                    {item.staff_leave_attachments?.length
                      ? item.staff_leave_attachments.map((file, index) => (
                          <span key={file.id}>
                            {index > 0 ? "、" : ""}
                            <a
                              href={`/api/staff-leave/attachments/${file.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {file.file_name}
                            </a>
                          </span>
                        ))
                      : item.proof_required
                        ? item.proofOverdue
                          ? "⚠️ 已超過 3 天仍未補；由經理判定，不自動取消"
                          : "尚未上傳（可 3 天內補）"
                        : "不需要"}
                  </dd>
                </div>
              </dl>
              <footer>
                {data.actor.canAssistant &&
                item.status === "assistant_review" ? (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void review(item, "assistant_manager", "approved")
                      }
                    >
                      副理通過
                    </button>
                    <button
                      onClick={() =>
                        void review(
                          item,
                          "assistant_manager",
                          "adjustment_proposed",
                        )
                      }
                    >
                      建議調整日期
                    </button>
                    <button
                      onClick={() =>
                        void review(item, "assistant_manager", "rejected")
                      }
                    >
                      副理駁回
                    </button>
                    <button
                      onClick={() =>
                        void review(item, "assistant_manager", "returned")
                      }
                    >
                      退回補充
                    </button>
                  </>
                ) : null}
                {data.actor.canFinal && item.status === "manager_review" ? (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => void review(item, "manager", "approved")}
                    >
                      經理最終核准
                    </button>
                    <button
                      onClick={() =>
                        void review(item, "manager", "adjustment_proposed")
                      }
                    >
                      建議調整日期
                    </button>
                    <button
                      onClick={() => void review(item, "manager", "rejected")}
                    >
                      經理駁回
                    </button>
                    <button
                      onClick={() => void review(item, "manager", "returned")}
                    >
                      退回補充
                    </button>
                  </>
                ) : null}
              </footer>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
