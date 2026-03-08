"use client";

import Link from "next/link";
import { FormEvent, use, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../i18n-provider";

type LeadDetail = {
  id: string;
  tenantId: string;
  branchId: string | null;
  ownerStaffId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  note: string | null;
  source: string;
  status: string;
  temperature: string;
  trialAt: string | null;
  trialStatus: string | null;
  trialResult: string | null;
  trialBookingId: string | null;
  nextActionAt: string | null;
  lastFollowedUpAt: string | null;
  wonMemberId: string | null;
  wonOrderId: string | null;
  wonPlanCode: string | null;
  lostReason: string | null;
  updatedAt: string;
};

type FollowupItem = {
  id: string;
  follow_up_type: string;
  note: string;
  next_action_at: string | null;
  created_by: string | null;
  created_at: string;
};

type ApiPayload = {
  ok?: boolean;
  error?: string | { message?: string };
  data?: {
    item?: LeadDetail;
    followups?: FollowupItem[];
    linkedMember?: Record<string, unknown> | null;
    linkedOrder?: Record<string, unknown> | null;
    trialBooking?: Record<string, unknown> | null;
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

export default function ManagerCrmLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const leadId = use(params).id;

  const [item, setItem] = useState<LeadDetail | null>(null);
  const [followups, setFollowups] = useState<FollowupItem[]>([]);
  const [linkedMember, setLinkedMember] = useState<Record<string, unknown> | null>(null);
  const [linkedOrder, setLinkedOrder] = useState<Record<string, unknown> | null>(null);
  const [trialBooking, setTrialBooking] = useState<Record<string, unknown> | null>(null);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [status, setStatus] = useState("new");
  const [temperature, setTemperature] = useState("warm");
  const [ownerStaffId, setOwnerStaffId] = useState("");
  const [trialAt, setTrialAt] = useState("");
  const [trialStatus, setTrialStatus] = useState("");
  const [trialResult, setTrialResult] = useState("");
  const [trialBookingId, setTrialBookingId] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [wonMemberId, setWonMemberId] = useState("");
  const [wonOrderId, setWonOrderId] = useState("");
  const [wonPlanCode, setWonPlanCode] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [note, setNote] = useState("");

  const [followUpType, setFollowUpType] = useState("call");
  const [followUpNote, setFollowUpNote] = useState("");
  const [followUpNextActionAt, setFollowUpNextActionAt] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/manager/crm/leads/${encodeURIComponent(leadId)}`);
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok || !payload?.data?.item) {
      setError(parseError(payload, zh ? "載入線索詳情失敗" : "Load lead detail failed"));
      setLoading(false);
      return;
    }

    const nextItem = payload.data.item;
    setItem(nextItem);
    setFollowups(payload.data.followups || []);
    setLinkedMember(payload.data.linkedMember || null);
    setLinkedOrder(payload.data.linkedOrder || null);
    setTrialBooking(payload.data.trialBooking || null);

    setStatus(nextItem.status || "new");
    setTemperature(nextItem.temperature || "warm");
    setOwnerStaffId(nextItem.ownerStaffId || "");
    setTrialAt(nextItem.trialAt ? nextItem.trialAt.slice(0, 16) : "");
    setTrialStatus(nextItem.trialStatus || "");
    setTrialResult(nextItem.trialResult || "");
    setTrialBookingId(nextItem.trialBookingId || "");
    setNextActionAt(nextItem.nextActionAt ? nextItem.nextActionAt.slice(0, 16) : "");
    setWonMemberId(nextItem.wonMemberId || "");
    setWonOrderId(nextItem.wonOrderId || "");
    setWonPlanCode(nextItem.wonPlanCode || "");
    setLostReason(nextItem.lostReason || "");
    setNote(nextItem.note || "");
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function updateLead(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/manager/crm/leads/${encodeURIComponent(leadId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        temperature,
        ownerStaffId: ownerStaffId || null,
        trialAt: trialAt || null,
        trialStatus: trialStatus || null,
        trialResult: trialResult || null,
        trialBookingId: trialBookingId || null,
        nextActionAt: nextActionAt || null,
        wonMemberId: wonMemberId || null,
        wonOrderId: wonOrderId || null,
        wonPlanCode: wonPlanCode || null,
        lostReason: lostReason || null,
        note: note || null,
      }),
    });
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "更新線索失敗" : "Update lead failed"));
      setSubmitting(false);
      return;
    }
    setMessage(zh ? "線索已更新" : "Lead updated");
    await load();
    setSubmitting(false);
  }

  async function createFollowup(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/manager/crm/leads/${encodeURIComponent(leadId)}/followups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        followUpType,
        note: followUpNote,
        nextActionAt: followUpNextActionAt || null,
      }),
    });
    const payload = (await res.json().catch(() => null)) as ApiPayload | null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "新增跟進失敗" : "Create follow-up failed"));
      setSubmitting(false);
      return;
    }
    setMessage(zh ? "跟進紀錄已新增" : "Follow-up added");
    setFollowUpNote("");
    setFollowUpNextActionAt("");
    await load();
    setSubmitting(false);
  }

  const leadStatusBadge = useMemo(() => item?.status || "-", [item?.status]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <p className="sub" style={{ marginBottom: 12 }}>
          <Link href="/manager/crm">{zh ? "返回 CRM 列表" : "Back to CRM list"}</Link>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        {!item ? (
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <p className="fdGlassText">{loading ? (zh ? "載入中..." : "Loading...") : (zh ? "找不到線索。" : "Lead not found.")}</p>
          </section>
        ) : (
          <>
            <section className="fdGlassPanel" style={{ marginBottom: 14 }}>
              <div className="fdEyebrow">{zh ? "CRM Lead" : "CRM LEAD"}</div>
              <h1 className="h1" style={{ marginTop: 10, fontSize: 30 }}>{item.name}</h1>
              <p className="fdGlassText">
                {item.phone || "-"} | {item.email || "-"} | {item.source} | <span className="fdChip">{leadStatusBadge}</span>
              </p>
            </section>

            <section className="fdTwoCol" style={{ alignItems: "start" }}>
              <form onSubmit={updateLead} className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">{zh ? "線索狀態與試上" : "Lead Status & Trial"}</h2>
                <div style={{ display: "grid", gap: 8 }}>
                  <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="new">new</option>
                    <option value="contacted">contacted</option>
                    <option value="trial_booked">trial_booked</option>
                    <option value="trial_completed">trial_completed</option>
                    <option value="won">won</option>
                    <option value="lost">lost</option>
                    <option value="dormant">dormant</option>
                  </select>
                  <select className="input" value={temperature} onChange={(event) => setTemperature(event.target.value)}>
                    <option value="hot">hot</option>
                    <option value="warm">warm</option>
                    <option value="cold">cold</option>
                  </select>
                  <input className="input" value={ownerStaffId} onChange={(event) => setOwnerStaffId(event.target.value)} placeholder="owner staff id" />
                  <label className="sub">
                    trial at
                    <input className="input" type="datetime-local" value={trialAt} onChange={(event) => setTrialAt(event.target.value)} />
                  </label>
                  <select className="input" value={trialStatus} onChange={(event) => setTrialStatus(event.target.value)}>
                    <option value="">trial status</option>
                    <option value="scheduled">scheduled</option>
                    <option value="attended">attended</option>
                    <option value="no_show">no_show</option>
                    <option value="canceled">canceled</option>
                    <option value="rescheduled">rescheduled</option>
                  </select>
                  <select className="input" value={trialResult} onChange={(event) => setTrialResult(event.target.value)}>
                    <option value="">trial result</option>
                    <option value="interested">interested</option>
                    <option value="follow_up_needed">follow_up_needed</option>
                    <option value="won">won</option>
                    <option value="lost">lost</option>
                  </select>
                  <input className="input" value={trialBookingId} onChange={(event) => setTrialBookingId(event.target.value)} placeholder="trial booking id" />
                  <label className="sub">
                    next action
                    <input className="input" type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} />
                  </label>
                  <input className="input" value={wonMemberId} onChange={(event) => setWonMemberId(event.target.value)} placeholder="won member id" />
                  <input className="input" value={wonOrderId} onChange={(event) => setWonOrderId(event.target.value)} placeholder="won order id" />
                  <input className="input" value={wonPlanCode} onChange={(event) => setWonPlanCode(event.target.value)} placeholder="won plan code" />
                  <input className="input" value={lostReason} onChange={(event) => setLostReason(event.target.value)} placeholder={zh ? "失單原因" : "lost reason"} />
                  <textarea className="input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder={zh ? "備註" : "note"} />
                </div>
                <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={submitting}>
                  {submitting ? (zh ? "儲存中..." : "Saving...") : (zh ? "儲存線索" : "Save Lead")}
                </button>
              </form>

              <section className="fdDataGrid">
                <form onSubmit={createFollowup} className="fdGlassSubPanel" style={{ padding: 14 }}>
                  <h2 className="sectionTitle">{zh ? "新增跟進紀錄" : "Add Follow-up"}</h2>
                  <div style={{ display: "grid", gap: 8 }}>
                    <select className="input" value={followUpType} onChange={(event) => setFollowUpType(event.target.value)}>
                      <option value="call">call</option>
                      <option value="message">message</option>
                      <option value="visit">visit</option>
                      <option value="consult">consult</option>
                      <option value="trial">trial</option>
                      <option value="other">other</option>
                    </select>
                    <textarea className="input" rows={3} value={followUpNote} onChange={(event) => setFollowUpNote(event.target.value)} placeholder={zh ? "跟進內容" : "follow-up note"} required />
                    <label className="sub">
                      next action
                      <input className="input" type="datetime-local" value={followUpNextActionAt} onChange={(event) => setFollowUpNextActionAt(event.target.value)} />
                    </label>
                  </div>
                  <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={submitting}>
                    {submitting ? (zh ? "送出中..." : "Submitting...") : (zh ? "新增跟進" : "Add Follow-up")}
                  </button>
                </form>

                <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                  <h2 className="sectionTitle">{zh ? "關聯資料" : "Linked Records"}</h2>
                  <p className="sub" style={{ marginTop: 6 }}>member: {linkedMember ? JSON.stringify(linkedMember) : "-"}</p>
                  <p className="sub" style={{ marginTop: 6 }}>order: {linkedOrder ? JSON.stringify(linkedOrder) : "-"}</p>
                  <p className="sub" style={{ marginTop: 6 }}>trial booking: {trialBooking ? JSON.stringify(trialBooking) : "-"}</p>
                  <p className="sub" style={{ marginTop: 6 }}>
                    last followed: {fmtDateTime(item.lastFollowedUpAt)} | updated: {fmtDateTime(item.updatedAt)}
                  </p>
                </section>
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
              <h2 className="sectionTitle">{zh ? "跟進歷史" : "Follow-up Timeline"}</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {followups.map((log) => (
                  <article key={log.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                    <strong>{log.follow_up_type}</strong>
                    <p className="sub" style={{ marginTop: 4 }}>{log.note}</p>
                    <p className="sub" style={{ marginTop: 4 }}>
                      {fmtDateTime(log.created_at)} | next: {fmtDateTime(log.next_action_at)}
                    </p>
                  </article>
                ))}
                {followups.length === 0 ? (
                  <p className="fdGlassText">{zh ? "目前沒有跟進紀錄。" : "No follow-up logs yet."}</p>
                ) : null}
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
