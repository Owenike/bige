"use client";

import { Check, Clock3, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApprovalItem = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  decision_note: string | null;
  requested_by: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
  requester: {
    id: string;
    display_name: string | null;
    employee_number: string | null;
  } | null;
};

type ApprovalPayload = {
  canResolve: boolean;
  items: ApprovalItem[];
};

const actionLabels: Record<string, string> = {
  order_void: "訂單作廢",
  payment_refund: "付款退款",
  bige_contract_payment_void: "合約收款作廢",
  bige_contract_payment_refund: "合約收款退款",
  bige_contract_extension: "合約延期",
};

const statusLabels: Record<string, string> = {
  pending: "待覆核",
  processing: "處理中",
  approved: "已核准",
  rejected: "已拒絕",
  cancelled: "已取消",
};

function apiMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: string | { message?: string }; message?: string };
  return typeof value.error === "string"
    ? value.error
    : value.error?.message || value.message || fallback;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ManagerApprovalsPage() {
  const [status, setStatus] = useState("pending");
  const [payload, setPayload] = useState<ApprovalPayload>({ canResolve: false, items: [] });
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [highlightId, setHighlightId] = useState("");

  useEffect(() => {
    setHighlightId(new URLSearchParams(window.location.search).get("id") || "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/approvals?status=${encodeURIComponent(status)}&limit=100`, {
        cache: "no-store",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(result, "讀取覆核事項失敗"));
      setPayload((result?.data || result) as ApprovalPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "讀取覆核事項失敗");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () => payload.items.filter((item) => item.status === "pending").length,
    [payload.items],
  );

  const decide = async (item: ApprovalItem, decision: "approve" | "reject") => {
    const note = window.prompt(
      decision === "approve" ? "覆核備註（可留空）" : "請輸入拒絕原因",
      "",
    );
    if (note === null || (decision === "reject" && !note.trim())) return;
    setWorkingId(item.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(item.id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, decisionNote: note.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(result, "覆核操作失敗"));
      setMessage(decision === "approve" ? "已核准並完成執行" : "已拒絕申請");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "覆核操作失敗");
    } finally {
      setWorkingId("");
    }
  };

  return (
    <main className="fdGlassScene">
      <div className="fdGlassBackdrop">
      <div className="fdApprovalShell">
        <header className="fdApprovalHeader">
          <div>
            <p className="fdEyebrow">BIG E FITNESS OPERATIONS</p>
            <h1>待覆核事項</h1>
            <p className="fdGlassText">
              副理提出申請，經理由自己的帳號核准或拒絕；不再輸入其他員工的密碼。
            </p>
          </div>
          <div className="fdApprovalActions">
            <a className="fdPillBtn" href="/manager/fitness">返回課表</a>
            <button className="fdPillBtn fdPillBtnPrimary" type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} /> {loading ? "更新中…" : "重新整理"}
            </button>
          </div>
        </header>

        <section className="fdInventorySummary" style={{ marginBottom: 14 }}>
          <article className="fdInventorySummaryItem">
            <span>目前列表</span>
            <strong className="fdInventorySummaryValue">{payload.items.length}</strong>
          </article>
          <article className="fdInventorySummaryItem">
            <span>待覆核</span>
            <strong className="fdInventorySummaryValue">{pendingCount}</strong>
          </article>
          <article className="fdInventorySummaryItem">
            <span>目前權限</span>
            <strong>{payload.canResolve ? "經理覆核" : "申請進度唯讀"}</strong>
          </article>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <div className="fdApprovalActions">
            {[
              ["pending", "待覆核"],
              ["approved", "已核准"],
              ["rejected", "已拒絕"],
              ["all", "全部"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`fdPillBtn ${status === value ? "fdPillBtnPrimary" : ""}`}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 14 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 14 }}>{message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          {loading ? (
            <p className="fdGlassText">讀取覆核事項中…</p>
          ) : payload.items.length ? (
            <div style={{ display: "grid", gap: 12 }}>
              {payload.items.map((item) => {
                const highlighted = item.id === highlightId;
                const requester = [item.requester?.display_name, item.requester?.employee_number]
                  .filter(Boolean)
                  .join(" · ") || "未知申請人";
                return (
                  <article
                    key={item.id}
                    className="fdGlassSubPanel"
                    style={{
                      padding: 16,
                      borderColor: highlighted ? "rgba(212, 166, 58, .9)" : undefined,
                      boxShadow: highlighted ? "0 0 0 2px rgba(212, 166, 58, .16)" : undefined,
                    }}
                  >
                    <div className="fdApprovalHeader" style={{ marginBottom: 10 }}>
                      <div>
                        <div className="fdApprovalActions" style={{ justifyContent: "flex-start" }}>
                          <ShieldCheck size={18} />
                          <strong>{actionLabels[item.action] || item.action}</strong>
                          <span className="fdPillBtn">{statusLabels[item.status] || item.status}</span>
                        </div>
                        <p className="fdGlassText">申請人：{requester}</p>
                      </div>
                      <span className="fdGlassText"><Clock3 size={15} /> {formatDateTime(item.created_at)}</span>
                    </div>
                    <p><strong>原因：</strong>{item.reason}</p>
                    <p className="fdGlassText">目標：{item.target_type} · {item.target_id}</p>
                    {item.decision_note ? <p><strong>覆核備註：</strong>{item.decision_note}</p> : null}
                    {payload.canResolve && item.status === "pending" ? (
                      <div className="fdApprovalActions" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                        <button
                          className="fdPillBtn"
                          type="button"
                          disabled={workingId === item.id}
                          onClick={() => void decide(item, "reject")}
                        >
                          <X size={16} /> 拒絕
                        </button>
                        <button
                          className="fdPillBtn fdPillBtnPrimary"
                          type="button"
                          disabled={workingId === item.id}
                          onClick={() => void decide(item, "approve")}
                        >
                          <Check size={16} /> {workingId === item.id ? "處理中…" : "核准並執行"}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="fdGlassText">目前沒有符合條件的覆核事項。</p>
          )}
        </section>
      </div>
      </div>
    </main>
  );
}
