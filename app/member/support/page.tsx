"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";
import { MemberTabs } from "../_components/MemberTabs";

type SupportEvent = {
  id: string;
  action: string;
  note: string;
  createdAt: string;
};

type SupportIncident = {
  id: string;
  incidentNo: string;
  incidentType: string;
  priority: string;
  status: string;
  source: string;
  title: string;
  detail: string;
  updatedAt: string;
  createdAt: string;
  resolutionNote: string;
  events: SupportEvent[];
};

type SupportResponse = {
  items?: SupportIncident[];
  error?: string;
};

type SortMode = "updated_desc" | "updated_asc" | "priority_desc" | "status";

function fmtDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function priorityRank(priority: string) {
  if (priority === "urgent") return 4;
  if (priority === "high") return 3;
  if (priority === "normal") return 2;
  if (priority === "low") return 1;
  return 0;
}

function statusRank(status: string) {
  if (status === "open") return 1;
  if (status === "in_progress") return 2;
  if (status === "resolved") return 3;
  if (status === "closed") return 4;
  return 9;
}

export default function MemberSupportPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [items, setItems] = useState<SupportIncident[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "in_progress" | "resolved" | "closed">("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated_desc");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [incidentType, setIncidentType] = useState("member");
  const [priority, setPriority] = useState("normal");
  const [followupNoteByIncident, setFollowupNoteByIncident] = useState<Record<string, string>>({});

  const loadSupport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/member/support", { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as SupportResponse | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "載入客服工單失敗" : "Failed to load support tickets"));
      setItems(payload?.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "載入客服工單失敗" : "Failed to load support tickets");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    void loadSupport();
  }, [loadSupport]);

  const openCount = useMemo(
    () => items.filter((item) => item.status === "open" || item.status === "in_progress").length,
    [items],
  );
  const statusCounts = useMemo(
    () => ({
      all: items.length,
      open: items.filter((item) => item.status === "open").length,
      in_progress: items.filter((item) => item.status === "in_progress").length,
      resolved: items.filter((item) => item.status === "resolved").length,
      closed: items.filter((item) => item.status === "closed").length,
    }),
    [items],
  );
  const filteredItems = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        item.incidentNo.toLowerCase().includes(keyword) ||
        item.title.toLowerCase().includes(keyword) ||
        item.detail.toLowerCase().includes(keyword)
      );
    });
  }, [items, searchKeyword, statusFilter]);
  const sortedItems = useMemo(() => {
    const cloned = [...filteredItems];
    if (sortMode === "updated_desc") {
      cloned.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return cloned;
    }
    if (sortMode === "updated_asc") {
      cloned.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      return cloned;
    }
    if (sortMode === "priority_desc") {
      cloned.sort((a, b) => {
        const delta = priorityRank(b.priority) - priorityRank(a.priority);
        if (delta !== 0) return delta;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
      return cloned;
    }
    cloned.sort((a, b) => {
      const delta = statusRank(a.status) - statusRank(b.status);
      if (delta !== 0) return delta;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return cloned;
  }, [filteredItems, sortMode]);

  async function createTicket() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (!title.trim()) throw new Error(zh ? "請輸入標題" : "Title is required");
      if (!detail.trim()) throw new Error(zh ? "請輸入問題描述" : "Detail is required");

      const res = await fetch("/api/member/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title: title.trim(),
          detail: detail.trim(),
          incidentType,
          priority,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || (zh ? "建立工單失敗" : "Failed to create ticket"));

      setMessage(zh ? "工單已送出，我們會盡快處理。" : "Ticket submitted. We will follow up soon.");
      setTitle("");
      setDetail("");
      await loadSupport();
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "建立工單失敗" : "Failed to create ticket");
    } finally {
      setSaving(false);
    }
  }

  async function sendFollowup(incidentId: string) {
    const note = (followupNoteByIncident[incidentId] || "").trim();
    if (!note) {
      setError(zh ? "請先輸入追蹤訊息" : "Enter follow-up note first");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/member/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "followup",
          incidentId,
          note,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || (zh ? "送出追蹤訊息失敗" : "Failed to send follow-up"));
      setFollowupNoteByIncident((prev) => ({ ...prev, [incidentId]: "" }));
      setMessage(zh ? "追蹤訊息已送出。" : "Follow-up sent.");
      await loadSupport();
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "送出追蹤訊息失敗" : "Failed to send follow-up");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">{zh ? "客服中心" : "SUPPORT"}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>{zh ? "客服工單" : "Support Tickets"}</h1>
          <p className="sub">
            {zh ? "問題回報、處理進度與客服回覆都在這裡管理。" : "Issue reports, progress updates, and support follow-ups are managed here."}
          </p>
          <MemberTabs />

          <div className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "處理中工單" : "Open Tickets"}</div>
            <div className="kvValue" style={{ marginTop: 8 }}>{openCount}</div>
          </div>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "搜尋與篩選" : "Search & Filter"}</div>
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" className={statusFilter === "all" ? "btn btnPrimary" : "btn"} onClick={() => setStatusFilter("all")}>
                {zh ? "全部" : "All"} ({statusCounts.all})
              </button>
              <button type="button" className={statusFilter === "open" ? "btn btnPrimary" : "btn"} onClick={() => setStatusFilter("open")}>
                {zh ? "開啟" : "Open"} ({statusCounts.open})
              </button>
              <button
                type="button"
                className={statusFilter === "in_progress" ? "btn btnPrimary" : "btn"}
                onClick={() => setStatusFilter("in_progress")}
              >
                {zh ? "處理中" : "In Progress"} ({statusCounts.in_progress})
              </button>
              <button
                type="button"
                className={statusFilter === "resolved" ? "btn btnPrimary" : "btn"}
                onClick={() => setStatusFilter("resolved")}
              >
                {zh ? "已解決" : "Resolved"} ({statusCounts.resolved})
              </button>
              <button type="button" className={statusFilter === "closed" ? "btn btnPrimary" : "btn"} onClick={() => setStatusFilter("closed")}>
                {zh ? "已關閉" : "Closed"} ({statusCounts.closed})
              </button>
            </div>
            <input
              className="input"
              style={{ marginTop: 8 }}
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder={zh ? "搜尋單號、標題、內容" : "Search id/title/detail"}
            />
            <select className="input" style={{ marginTop: 8 }} value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="updated_desc">{zh ? "排序：最新更新" : "Sort: Latest Update"}</option>
              <option value="updated_asc">{zh ? "排序：最舊更新" : "Sort: Oldest Update"}</option>
              <option value="priority_desc">{zh ? "排序：優先級" : "Sort: Priority"}</option>
              <option value="status">{zh ? "排序：狀態" : "Sort: Status"}</option>
            </select>
          </section>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "建立工單" : "Create Ticket"}</div>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <input
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={zh ? "標題" : "Title"}
              />
              <textarea
                className="input"
                rows={4}
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder={zh ? "請描述問題細節" : "Describe details"}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <select className="input" value={incidentType} onChange={(event) => setIncidentType(event.target.value)}>
                  <option value="member">{zh ? "會員" : "Member"}</option>
                  <option value="billing">{zh ? "帳務" : "Billing"}</option>
                  <option value="facility">{zh ? "場館" : "Facility"}</option>
                  <option value="complaint">{zh ? "申訴" : "Complaint"}</option>
                  <option value="other">{zh ? "其他" : "Other"}</option>
                </select>
                <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
                  <option value="normal">{zh ? "一般" : "Normal"}</option>
                  <option value="high">{zh ? "高" : "High"}</option>
                  <option value="urgent">{zh ? "緊急" : "Urgent"}</option>
                </select>
              </div>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn btnPrimary" onClick={() => void createTicket()} disabled={saving}>
                {saving ? (zh ? "送出中..." : "Submitting...") : zh ? "送出工單" : "Submit Ticket"}
              </button>
            </div>
          </section>

          {error ? <p className="sub" style={{ marginTop: 10, color: "var(--danger, #b00020)" }}>{error}</p> : null}
          {message ? <p className="sub" style={{ marginTop: 10, color: "var(--success, #0b6b3a)" }}>{message}</p> : null}

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "工單列表" : "Tickets"}</div>
            {loading ? <p className="sub" style={{ marginTop: 8 }}>{zh ? "載入中..." : "Loading..."}</p> : null}
            {!loading && sortedItems.length === 0 ? (
              <p className="sub" style={{ marginTop: 8 }}>{zh ? "目前沒有工單。" : "No tickets yet."}</p>
            ) : null}

            {!loading && sortedItems.length > 0 ? (
              <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
                {sortedItems.map((item) => (
                  <li key={item.id} className="card" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <strong>{item.incidentNo} | {item.title}</strong>
                      <span className="fdChip">{item.status}</span>
                    </div>
                    <p className="sub" style={{ marginTop: 8 }}>{item.detail}</p>
                    <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>
                      {zh ? "類型" : "Type"}: {item.incidentType} | {zh ? "優先級" : "Priority"}: {item.priority}
                    </p>
                    <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                      {zh ? "更新時間" : "Updated"}: {fmtDateTime(item.updatedAt)}
                    </p>
                    {item.resolutionNote ? (
                      <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                        {zh ? "處理結果" : "Resolution"}: {item.resolutionNote}
                      </p>
                    ) : null}
                    <details style={{ marginTop: 8 }}>
                      <summary>{zh ? "查看時間軸" : "View Timeline"}</summary>
                      <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                        {item.events.slice(0, 6).map((event) => (
                          <li key={event.id} className="card" style={{ padding: 8 }}>
                            <strong>{event.action}</strong>
                            <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>{event.note || "-"}</p>
                            <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>{fmtDateTime(event.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                    {item.status === "open" || item.status === "in_progress" ? (
                      <div style={{ marginTop: 8 }}>
                        <textarea
                          className="input"
                          rows={2}
                          value={followupNoteByIncident[item.id] || ""}
                          onChange={(event) =>
                            setFollowupNoteByIncident((prev) => ({ ...prev, [item.id]: event.target.value }))
                          }
                          placeholder={zh ? "補充追蹤訊息" : "Follow-up note"}
                        />
                        <div className="actions" style={{ marginTop: 8 }}>
                          <button type="button" className="btn" onClick={() => void sendFollowup(item.id)} disabled={saving}>
                            {zh ? "送出追蹤" : "Send Follow-up"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}
