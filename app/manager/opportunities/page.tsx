"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

type OpportunityItem = {
  id: string;
  tenantId: string;
  branchId: string | null;
  type: string;
  status: string;
  memberId: string | null;
  leadId: string | null;
  sourceRefType: string;
  sourceRefId: string;
  ownerStaffId: string | null;
  priority: string;
  reason: string;
  note: string | null;
  dueAt: string | null;
  nextActionAt: string | null;
  snoozedUntil: string | null;
  wonAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
  member: { id: string; fullName: string | null; phone: string | null } | null;
  lead: { id: string; name: string | null; phone: string | null; email: string | null; status: string | null } | null;
};

type OpportunitySummary = {
  total: number;
  open: number;
  inProgress: number;
  won: number;
  lost: number;
  snoozed: number;
  archived: number;
  highPriority: number;
  dueSoon: number;
  overdue: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
};

type ApiPayload = {
  ok?: boolean;
  data?: {
    items?: OpportunityItem[];
    item?: OpportunityItem;
    summary?: OpportunitySummary;
    inserted?: number;
    byType?: Record<string, number>;
    reminders?: number;
  };
  error?: { message?: string } | string;
  message?: string;
};

function parseError(payload: ApiPayload | null, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error && typeof payload.error.message === "string") return payload.error.message;
  if (typeof payload.message === "string") return payload.message;
  return fallback;
}

function toLocalDateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function fmt(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ManagerOpportunitiesPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [items, setItems] = useState<OpportunityItem[]>([]);
  const [summary, setSummary] = useState<OpportunitySummary>({
    total: 0,
    open: 0,
    inProgress: 0,
    won: 0,
    lost: 0,
    snoozed: 0,
    archived: 0,
    highPriority: 0,
    dueSoon: 0,
    overdue: 0,
    byType: {},
    byStatus: {},
    byPriority: {},
  });
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [ownerStaffId, setOwnerStaffId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [mineOnly, setMineOnly] = useState(false);

  const [createType, setCreateType] = useState("renewal_due");
  const [createMemberId, setCreateMemberId] = useState("");
  const [createLeadId, setCreateLeadId] = useState("");
  const [createReason, setCreateReason] = useState("");
  const [createDueAt, setCreateDueAt] = useState("");
  const [createPriority, setCreatePriority] = useState("medium");
  const [createOwnerStaffId, setCreateOwnerStaffId] = useState("");
  const [createNote, setCreateNote] = useState("");

  const [patchStatusById, setPatchStatusById] = useState<Record<string, string>>({});
  const [patchOwnerById, setPatchOwnerById] = useState<Record<string, string>>({});
  const [patchNextActionById, setPatchNextActionById] = useState<Record<string, string>>({});
  const [patchNoteById, setPatchNoteById] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (priority) params.set("priority", priority);
    if (ownerStaffId.trim()) params.set("ownerStaffId", ownerStaffId.trim());
    if (branchId.trim()) params.set("branchId", branchId.trim());
    if (mineOnly) params.set("mine", "1");
    params.set("limit", "200");

    const res = await fetch(`/api/manager/opportunities?${params.toString()}`);
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok || !payload?.data) {
      setItems([]);
      setSummary({
        total: 0,
        open: 0,
        inProgress: 0,
        won: 0,
        lost: 0,
        snoozed: 0,
        archived: 0,
        highPriority: 0,
        dueSoon: 0,
        overdue: 0,
        byType: {},
        byStatus: {},
        byPriority: {},
      });
      setError(parseError(payload, zh ? "載入機會清單失敗" : "Load opportunities failed"));
      setLoading(false);
      return;
    }

    const nextItems = payload.data.items || [];
    setItems(nextItems);
    setSummary(payload.data.summary || summary);
    setPatchStatusById(
      nextItems.reduce<Record<string, string>>((acc, item) => {
        acc[item.id] = item.status;
        return acc;
      }, {}),
    );
    setPatchOwnerById(
      nextItems.reduce<Record<string, string>>((acc, item) => {
        acc[item.id] = item.ownerStaffId || "";
        return acc;
      }, {}),
    );
    setPatchNextActionById(
      nextItems.reduce<Record<string, string>>((acc, item) => {
        acc[item.id] = toLocalDateTimeInput(item.nextActionAt);
        return acc;
      }, {}),
    );
    setPatchNoteById(
      nextItems.reduce<Record<string, string>>((acc, item) => {
        acc[item.id] = item.note || "";
        return acc;
      }, {}),
    );
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSweep() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/manager/opportunities/sweep", { method: "POST" });
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "機會掃描失敗" : "Opportunity sweep failed"));
      setSubmitting(false);
      return;
    }
    const inserted = payload?.data?.inserted || 0;
    const reminders = payload?.data?.reminders || 0;
    setMessage(zh ? `掃描完成：新增 ${inserted} 筆，提醒 ${reminders} 筆` : `Sweep completed: inserted ${inserted}, reminders ${reminders}`);
    await load();
    setSubmitting(false);
  }

  async function createOpportunity(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/manager/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: createType,
        memberId: createMemberId || null,
        leadId: createLeadId || null,
        reason: createReason,
        dueAt: createDueAt || null,
        priority: createPriority,
        ownerStaffId: createOwnerStaffId || null,
        note: createNote || null,
      }),
    });
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "建立機會失敗" : "Create opportunity failed"));
      setSubmitting(false);
      return;
    }
    setMessage(zh ? "機會已建立" : "Opportunity created");
    setCreateReason("");
    setCreateDueAt("");
    setCreateNote("");
    setCreateMemberId("");
    setCreateLeadId("");
    await load();
    setSubmitting(false);
  }

  async function updateOpportunity(opportunityId: string) {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/manager/opportunities/${encodeURIComponent(opportunityId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "manual_update",
        status: patchStatusById[opportunityId] || undefined,
        ownerStaffId: patchOwnerById[opportunityId] || null,
        nextActionAt: patchNextActionById[opportunityId] || null,
        note: patchNoteById[opportunityId] || null,
      }),
    });
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "更新機會失敗" : "Update opportunity failed"));
      setSubmitting(false);
      return;
    }
    setMessage(zh ? "機會已更新" : "Opportunity updated");
    await load();
    setSubmitting(false);
  }

  const typeStats = useMemo(() => Object.entries(summary.byType || {}), [summary.byType]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "RENEWAL / 回購 / 再行銷" : "RENEWAL / REPURCHASE / REACTIVATION"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              {zh ? "機會管理工作台" : "Opportunity Workspace"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "整合會員合約、餘額、CRM 試上與流失追蹤，形成可行動的續約 / 回購機會清單。"
                : "Track renewal, repurchase, and reactivation opportunities from contracts and CRM signals."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <Link href="/manager">{zh ? "返回管理儀表板" : "Back to dashboard"}</Link>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "可行動機會" : "Actionable"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{summary.open + summary.inProgress + summary.snoozed}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "高優先" : "High Priority"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{summary.highPriority}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "近期到期 / 已逾期" : "Due Soon / Overdue"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{summary.dueSoon} / {summary.overdue}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "已成交 / 已失敗" : "Won / Lost"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{summary.won} / {summary.lost}</p>
          </article>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">{zh ? "機會掃描與篩選" : "Sweep & Filters"}</h2>
          <form
            className="actions"
            style={{ marginTop: 8 }}
            onSubmit={(event) => {
              event.preventDefault();
              void load();
            }}
          >
            <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder={zh ? "搜尋會員 / 線索 / 原因" : "search"} />
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{zh ? "全部狀態" : "all status"}</option>
              <option value="open">open</option>
              <option value="in_progress">in_progress</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
              <option value="snoozed">snoozed</option>
              <option value="archived">archived</option>
            </select>
            <select className="input" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="">{zh ? "全部類型" : "all type"}</option>
              <option value="renewal_due">renewal_due</option>
              <option value="low_balance">low_balance</option>
              <option value="expired_no_renewal">expired_no_renewal</option>
              <option value="lost_member_reactivation">lost_member_reactivation</option>
              <option value="trial_not_converted">trial_not_converted</option>
              <option value="crm_reactivation">crm_reactivation</option>
            </select>
            <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="">{zh ? "全部優先級" : "all priority"}</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
            <input className="input" value={ownerStaffId} onChange={(event) => setOwnerStaffId(event.target.value)} placeholder="owner staff id" />
            <input className="input" value={branchId} onChange={(event) => setBranchId(event.target.value)} placeholder="branch id" />
            <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={mineOnly} onChange={(event) => setMineOnly(event.target.checked)} />
              {zh ? "僅看我的" : "mine only"}
            </label>
            <button type="submit" className="fdPillBtn">{zh ? "套用" : "Apply"}</button>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void runSweep()} disabled={submitting}>
              {submitting ? (zh ? "掃描中..." : "Sweeping...") : (zh ? "執行機會掃描" : "Run Sweep")}
            </button>
          </form>
          <p className="sub" style={{ marginTop: 8 }}>
            {zh ? "機會類型分布" : "By Type"}:{" "}
            {typeStats.length === 0 ? "-" : typeStats.map(([key, value]) => `${key}:${value}`).join(" | ")}
          </p>
        </section>

        <section className="fdTwoCol" style={{ alignItems: "start", marginBottom: 14 }}>
          <form onSubmit={createOpportunity} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "手動建立機會" : "Create Opportunity"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <select className="input" value={createType} onChange={(event) => setCreateType(event.target.value)}>
                <option value="renewal_due">renewal_due</option>
                <option value="low_balance">low_balance</option>
                <option value="expired_no_renewal">expired_no_renewal</option>
                <option value="lost_member_reactivation">lost_member_reactivation</option>
                <option value="trial_not_converted">trial_not_converted</option>
                <option value="crm_reactivation">crm_reactivation</option>
              </select>
              <input className="input" value={createMemberId} onChange={(event) => setCreateMemberId(event.target.value)} placeholder="member id (optional)" />
              <input className="input" value={createLeadId} onChange={(event) => setCreateLeadId(event.target.value)} placeholder="lead id (optional)" />
              <input className="input" value={createReason} onChange={(event) => setCreateReason(event.target.value)} placeholder={zh ? "機會原因" : "reason"} required />
              <select className="input" value={createPriority} onChange={(event) => setCreatePriority(event.target.value)}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
              <input className="input" value={createOwnerStaffId} onChange={(event) => setCreateOwnerStaffId(event.target.value)} placeholder="owner staff id (optional)" />
              <label className="sub">
                {zh ? "到期時間（可選）" : "due at (optional)"}
                <input className="input" type="datetime-local" value={createDueAt} onChange={(event) => setCreateDueAt(event.target.value)} />
              </label>
              <textarea className="input" rows={3} value={createNote} onChange={(event) => setCreateNote(event.target.value)} placeholder={zh ? "備註" : "note"} />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={submitting}>
              {submitting ? (zh ? "建立中..." : "Creating...") : (zh ? "建立機會" : "Create")}
            </button>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "處理說明" : "Workflow"}</h2>
            <p className="sub" style={{ marginTop: 8 }}>
              {zh
                ? "狀態建議：open → in_progress → won / lost。若需延後，使用 snoozed 並設定 next action。"
                : "Suggested flow: open → in_progress → won / lost. Use snoozed with next action for defer."}
            </p>
            <p className="sub" style={{ marginTop: 8 }}>
              {zh
                ? "處理入口：會員機會可導去會員詳情，CRM 機會可導去線索詳情。"
                : "Action entry: member opportunities link to member detail, CRM opportunities link to lead detail."}
            </p>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "機會清單" : "Opportunity List"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {items.map((item) => (
              <article key={item.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <strong>{item.type}</strong>
                  <span className="fdChip">{item.status}</span>
                </div>
                <p className="sub" style={{ marginTop: 4 }}>
                  {item.reason}
                </p>
                <p className="sub" style={{ marginTop: 4 }}>
                  priority: {item.priority} | due: {fmt(item.dueAt)} | next: {fmt(item.nextActionAt)}
                </p>
                <p className="sub" style={{ marginTop: 4 }}>
                  owner: {item.ownerStaffId || "-"} | member: {item.member?.fullName || item.memberId || "-"} | lead: {item.lead?.name || item.leadId || "-"}
                </p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <select
                    className="input"
                    value={patchStatusById[item.id] || item.status}
                    onChange={(event) => setPatchStatusById((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  >
                    <option value="open">open</option>
                    <option value="in_progress">in_progress</option>
                    <option value="won">won</option>
                    <option value="lost">lost</option>
                    <option value="snoozed">snoozed</option>
                    <option value="archived">archived</option>
                  </select>
                  <input
                    className="input"
                    value={patchOwnerById[item.id] || ""}
                    onChange={(event) => setPatchOwnerById((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    placeholder="owner staff id"
                  />
                  <input
                    className="input"
                    type="datetime-local"
                    value={patchNextActionById[item.id] || ""}
                    onChange={(event) => setPatchNextActionById((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  />
                  <input
                    className="input"
                    value={patchNoteById[item.id] || ""}
                    onChange={(event) => setPatchNoteById((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    placeholder={zh ? "備註" : "note"}
                  />
                  <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void updateOpportunity(item.id)} disabled={submitting}>
                    {zh ? "更新" : "Save"}
                  </button>
                  {item.memberId ? (
                    <Link className="fdPillBtn" href={`/manager/members/${item.memberId}`}>{zh ? "會員" : "Member"}</Link>
                  ) : null}
                  {item.leadId ? (
                    <Link className="fdPillBtn" href={`/manager/crm/${item.leadId}`}>{zh ? "線索" : "Lead"}</Link>
                  ) : null}
                </div>
              </article>
            ))}
            {items.length === 0 ? (
              <p className="fdGlassText">{loading ? (zh ? "載入中..." : "Loading...") : (zh ? "目前沒有機會資料。" : "No opportunities found.")}</p>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

