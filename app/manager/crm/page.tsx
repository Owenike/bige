"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

type LeadItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string;
  status: string;
  temperature: string;
  ownerStaffId: string | null;
  branchId: string | null;
  trialAt: string | null;
  trialStatus: string | null;
  nextActionAt: string | null;
  updatedAt: string;
};

type LeadSummary = {
  total: number;
  trialBooked: number;
  trialAttended: number;
  won: number;
  lost: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byOwner: Record<string, number>;
};

type FunnelSummary = {
  total: number;
  newCount: number;
  trialBooked: number;
  trialAttended: number;
  won: number;
  lost: number;
  staleFollowups: number;
  pendingNextActions: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byOwner: Record<string, number>;
};

type ApiPayload = {
  ok?: boolean;
  error?: { message?: string } | string;
  data?: {
    items?: LeadItem[];
    summary?: LeadSummary | FunnelSummary;
  };
};

function parseError(payload: ApiPayload | null, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error && typeof payload.error.message === "string") return payload.error.message;
  return fallback;
}

function fmtDateTime(input: string | null) {
  if (!input) return "-";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return d.toLocaleString();
}

export default function ManagerCrmPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [items, setItems] = useState<LeadItem[]>([]);
  const [summary, setSummary] = useState<LeadSummary>({
    total: 0,
    trialBooked: 0,
    trialAttended: 0,
    won: 0,
    lost: 0,
    byStatus: {},
    bySource: {},
    byOwner: {},
  });
  const [funnel, setFunnel] = useState<FunnelSummary>({
    total: 0,
    newCount: 0,
    trialBooked: 0,
    trialAttended: 0,
    won: 0,
    lost: 0,
    staleFollowups: 0,
    pendingNextActions: 0,
    byStatus: {},
    bySource: {},
    byOwner: {},
  });
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [ownerStaffId, setOwnerStaffId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [reportFrom, setReportFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10));

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [leadSource, setLeadSource] = useState("walk-in");
  const [temperature, setTemperature] = useState("warm");
  const [trialAt, setTrialAt] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [note, setNote] = useState("");

  async function loadLeads() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    if (ownerStaffId.trim()) params.set("ownerStaffId", ownerStaffId.trim());
    if (branchId.trim()) params.set("branchId", branchId.trim());
    params.set("limit", "150");

    const res = await fetch(`/api/manager/crm/leads?${params.toString()}`);
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok || !payload?.data) {
      setItems([]);
      setError(parseError(payload, zh ? "載入 CRM 線索失敗" : "Load CRM leads failed"));
      setLoading(false);
      return;
    }
    setItems(payload.data.items || []);
    const nextSummary = payload.data.summary as LeadSummary | undefined;
    if (nextSummary) setSummary(nextSummary);
    setLoading(false);
  }

  async function loadSummary() {
    const params = new URLSearchParams();
    params.set("from", reportFrom);
    params.set("to", reportTo);
    const res = await fetch(`/api/manager/crm/summary?${params.toString()}`);
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok || !payload?.data) {
      setError(parseError(payload, zh ? "載入漏斗摘要失敗" : "Load funnel summary failed"));
      return;
    }
    const nextSummary = payload.data.summary as FunnelSummary | undefined;
    if (nextSummary) setFunnel(nextSummary);
  }

  async function loadAll() {
    await Promise.all([loadLeads(), loadSummary()]);
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createLead(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/manager/crm/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        phone: phone || null,
        email: email || null,
        source: leadSource,
        temperature,
        trialAt: trialAt || null,
        nextActionAt: nextActionAt || null,
        note: note || null,
      }),
    });
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "建立線索失敗" : "Create lead failed"));
      setSubmitting(false);
      return;
    }

    setMessage(zh ? "線索已建立" : "Lead created");
    setName("");
    setPhone("");
    setEmail("");
    setLeadSource("walk-in");
    setTemperature("warm");
    setTrialAt("");
    setNextActionAt("");
    setNote("");
    await loadAll();
    setSubmitting(false);
  }

  const sourceStats = useMemo(() => Object.entries(funnel.bySource || {}), [funnel.bySource]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "CRM / 業務漏斗" : "CRM / SALES FUNNEL"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              {zh ? "CRM 線索管理" : "CRM Lead Pipeline"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "管理線索來源、試上追蹤、跟進紀錄與成交結果，並與 booking/member/notification 流程整合。"
                : "Manage lead source, trial tracking, follow-up logs, and conversion outcomes with booking/member/notification integration."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <Link href="/manager">{zh ? "返回管理儀表板" : "Back to dashboard"}</Link>
          {" | "}
          <Link href="/manager/opportunities">{zh ? "續約 / 回購機會" : "Renewal Opportunities"}</Link>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "新進線索" : "New Leads"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{funnel.newCount}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "試上預約 / 到課" : "Trial Booked / Attended"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{funnel.trialBooked} / {funnel.trialAttended}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "成交 / 失單" : "Won / Lost"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{funnel.won} / {funnel.lost}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "逾期未跟進" : "Overdue Follow-ups"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{funnel.staleFollowups}</p>
          </article>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">{zh ? "漏斗摘要區間" : "Funnel Summary Range"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <input className="input" type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} />
            <input className="input" type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} />
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void loadSummary()}>
              {zh ? "更新摘要" : "Refresh Summary"}
            </button>
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            {zh ? "來源分布" : "Source Distribution"}:{" "}
            {sourceStats.length === 0
              ? "-"
              : sourceStats.map(([key, value]) => `${key}:${value}`).join(" | ")}
          </p>
        </section>

        <section className="fdTwoCol" style={{ alignItems: "start" }}>
          <form onSubmit={createLead} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "新增線索" : "Create Lead"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={zh ? "姓名" : "name"} required />
              <input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={zh ? "電話" : "phone"} />
              <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email" />
              <select className="input" value={leadSource} onChange={(event) => setLeadSource(event.target.value)}>
                <option value="walk-in">walk-in</option>
                <option value="referral">referral</option>
                <option value="ad">ad</option>
                <option value="instagram">instagram</option>
                <option value="line">line</option>
                <option value="google">google</option>
                <option value="other">other</option>
              </select>
              <select className="input" value={temperature} onChange={(event) => setTemperature(event.target.value)}>
                <option value="hot">hot</option>
                <option value="warm">warm</option>
                <option value="cold">cold</option>
              </select>
              <label className="sub">
                {zh ? "試上時間（可選）" : "Trial At (optional)"}
                <input className="input" type="datetime-local" value={trialAt} onChange={(event) => setTrialAt(event.target.value)} />
              </label>
              <label className="sub">
                {zh ? "下次行動（可選）" : "Next Action (optional)"}
                <input className="input" type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} />
              </label>
              <textarea className="input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder={zh ? "備註" : "note"} />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={submitting}>
              {submitting ? (zh ? "建立中..." : "Creating...") : (zh ? "建立線索" : "Create Lead")}
            </button>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "線索篩選" : "Lead Filters"}</h2>
            <form
              className="actions"
              style={{ marginTop: 8 }}
              onSubmit={(event) => {
                event.preventDefault();
                void loadLeads();
              }}
            >
              <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder={zh ? "姓名 / 電話 / Email" : "name / phone / email"} />
              <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">{zh ? "全部狀態" : "all status"}</option>
                <option value="new">new</option>
                <option value="contacted">contacted</option>
                <option value="trial_booked">trial_booked</option>
                <option value="trial_completed">trial_completed</option>
                <option value="won">won</option>
                <option value="lost">lost</option>
                <option value="dormant">dormant</option>
              </select>
              <select className="input" value={source} onChange={(event) => setSource(event.target.value)}>
                <option value="">{zh ? "全部來源" : "all source"}</option>
                <option value="walk-in">walk-in</option>
                <option value="referral">referral</option>
                <option value="ad">ad</option>
                <option value="instagram">instagram</option>
                <option value="line">line</option>
                <option value="google">google</option>
                <option value="other">other</option>
              </select>
              <input className="input" value={ownerStaffId} onChange={(event) => setOwnerStaffId(event.target.value)} placeholder={zh ? "Owner Staff ID" : "owner staff id"} />
              <input className="input" value={branchId} onChange={(event) => setBranchId(event.target.value)} placeholder={zh ? "Branch ID" : "branch id"} />
              <button type="submit" className="fdPillBtn">{zh ? "套用" : "Apply"}</button>
            </form>
            <p className="sub" style={{ marginTop: 8 }}>
              {zh ? "目前清單" : "Current List"}: {summary.total} | trial {summary.trialBooked}/{summary.trialAttended} | won/lost {summary.won}/{summary.lost}
            </p>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "線索清單" : "Lead List"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {items.map((item) => (
              <article key={item.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <strong>{item.name}</strong>
                  <span className="fdChip">{item.status}</span>
                </div>
                <p className="sub" style={{ marginTop: 4 }}>{item.phone || "-"} | {item.email || "-"}</p>
                <p className="sub" style={{ marginTop: 4 }}>
                  source: {item.source} | temp: {item.temperature} | owner: {item.ownerStaffId || "-"}
                </p>
                <p className="sub" style={{ marginTop: 4 }}>
                  trial: {fmtDateTime(item.trialAt)} ({item.trialStatus || "-"}) | next: {fmtDateTime(item.nextActionAt)}
                </p>
                <p className="sub" style={{ marginTop: 4 }}>updated: {fmtDateTime(item.updatedAt)}</p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <Link href={`/manager/crm/${item.id}`} className="fdPillBtn fdPillBtnPrimary">
                    {zh ? "查看詳情" : "Open Detail"}
                  </Link>
                </div>
              </article>
            ))}
            {items.length === 0 ? (
              <p className="fdGlassText">{loading ? (zh ? "載入中..." : "Loading...") : (zh ? "查無符合條件的線索。" : "No leads found.")}</p>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

