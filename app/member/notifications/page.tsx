"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";
import { MemberTabs } from "../_components/MemberTabs";

type NotificationItem = {
  id: string;
  type: "booking_reminder" | "membership_expiry" | "pass_expiry" | "system_log";
  level: "info" | "warning";
  title: string;
  message: string;
  at: string;
  isRead: boolean;
  readAt: string | null;
};

type NotificationResponse = {
  memberId?: string;
  items?: NotificationItem[];
  error?: string;
};

type ReadFilter = "all" | "unread" | "read";
type TypeFilter = "all" | "class" | "expiry" | "system";

function fmtDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function mapNotificationType(type: NotificationItem["type"]): Exclude<TypeFilter, "all"> {
  if (type === "booking_reminder") return "class";
  if (type === "membership_expiry" || type === "pass_expiry") return "expiry";
  return "system";
}

export default function MemberNotificationsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/member/notifications", { cache: "no-store" });
        const payload = (await res.json().catch(() => null)) as NotificationResponse | null;
        if (!res.ok) throw new Error(payload?.error || (zh ? "載入通知失敗" : "Failed to load notifications"));
        if (!cancelled) setItems(payload?.items || []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : zh ? "載入通知失敗" : "Failed to load notifications");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zh]);

  const grouped = useMemo(() => {
    const filteredByRead =
      readFilter === "all"
        ? items
        : readFilter === "unread"
          ? items.filter((item) => !item.isRead)
          : items.filter((item) => item.isRead);
    const filteredByType =
      typeFilter === "all" ? filteredByRead : filteredByRead.filter((item) => mapNotificationType(item.type) === typeFilter);
    const urgent = filteredByType.filter((item) => item.level === "warning");
    const normal = filteredByType.filter((item) => item.level !== "warning");
    return { urgent, normal };
  }, [items, readFilter, typeFilter]);

  const unreadCount = useMemo(() => items.filter((item) => !item.isRead).length, [items]);
  const typeCounts = useMemo(
    () => ({
      all: items.length,
      class: items.filter((item) => mapNotificationType(item.type) === "class").length,
      expiry: items.filter((item) => mapNotificationType(item.type) === "expiry").length,
      system: items.filter((item) => mapNotificationType(item.type) === "system").length,
    }),
    [items],
  );

  async function markOne(item: NotificationItem, read: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const nowIso = new Date().toISOString();
    const previous = items;
    setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, isRead: read, readAt: read ? nowIso : null } : row)));
    try {
      const res = await fetch("/api/member/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: read ? "mark_read" : "mark_unread",
          notificationId: item.id,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || (zh ? "更新通知狀態失敗" : "Failed to update notification state"));
      setMessage(read ? (zh ? "已標記為已讀" : "Marked as read") : (zh ? "已標記為未讀" : "Marked as unread"));
    } catch (err) {
      setItems(previous);
      setError(err instanceof Error ? err.message : zh ? "更新通知狀態失敗" : "Failed to update notification state");
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    const ids = items.filter((item) => !item.isRead).map((item) => item.id);
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const nowIso = new Date().toISOString();
    const previous = items;
    setItems((prev) => prev.map((row) => ({ ...row, isRead: true, readAt: row.readAt || nowIso })));
    try {
      const res = await fetch("/api/member/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_all_read",
          notificationIds: ids,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || (zh ? "一鍵已讀失敗" : "Mark all read failed"));
      setMessage(zh ? "全部通知已標記為已讀。" : "All notifications marked as read.");
    } catch (err) {
      setItems(previous);
      setError(err instanceof Error ? err.message : zh ? "一鍵已讀失敗" : "Mark all read failed");
    } finally {
      setBusy(false);
    }
  }

  function renderItem(item: NotificationItem) {
    return (
      <li
        key={item.id}
        className="card"
        style={{
          padding: 10,
          opacity: item.isRead ? 0.75 : 1,
          borderColor: !item.isRead ? "rgba(59,130,246,.35)" : undefined,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>{item.title}</strong>
          <span className="fdChip">{item.isRead ? (zh ? "已讀" : "Read") : (zh ? "未讀" : "Unread")}</span>
        </div>
        <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>{item.message}</p>
        <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>{fmtDateTime(item.at)}</p>
        <div className="actions" style={{ marginTop: 8 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void markOne(item, !item.isRead)}>
            {item.isRead ? (zh ? "標為未讀" : "Mark Unread") : (zh ? "標為已讀" : "Mark Read")}
          </button>
        </div>
      </li>
    );
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">{zh ? "通知中心" : "NOTIFICATIONS"}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>{zh ? "通知中心" : "Notification Center"}</h1>
          <p className="sub">
            {zh ? "課程提醒、扣款提醒、會籍到期提醒都會顯示在這裡。" : "Class reminders, billing reminders, and membership expiry reminders are shown here."}
          </p>
          <MemberTabs />

          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className={readFilter === "all" ? "btn btnPrimary" : "btn"} onClick={() => setReadFilter("all")}>
              {zh ? "全部" : "All"}
            </button>
            <button type="button" className={readFilter === "unread" ? "btn btnPrimary" : "btn"} onClick={() => setReadFilter("unread")}>
              {zh ? "未讀" : "Unread"} ({unreadCount})
            </button>
            <button type="button" className={readFilter === "read" ? "btn btnPrimary" : "btn"} onClick={() => setReadFilter("read")}>
              {zh ? "已讀" : "Read"}
            </button>
            <button type="button" className="btn" onClick={() => void markAllRead()} disabled={busy || unreadCount === 0}>
              {zh ? "全部標為已讀" : "Mark All Read"}
            </button>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className={typeFilter === "all" ? "btn btnPrimary" : "btn"} onClick={() => setTypeFilter("all")}>
              {zh ? "全部類型" : "All Types"} ({typeCounts.all})
            </button>
            <button type="button" className={typeFilter === "class" ? "btn btnPrimary" : "btn"} onClick={() => setTypeFilter("class")}>
              {zh ? "課程" : "Classes"} ({typeCounts.class})
            </button>
            <button type="button" className={typeFilter === "expiry" ? "btn btnPrimary" : "btn"} onClick={() => setTypeFilter("expiry")}>
              {zh ? "到期" : "Expiry"} ({typeCounts.expiry})
            </button>
            <button type="button" className={typeFilter === "system" ? "btn btnPrimary" : "btn"} onClick={() => setTypeFilter("system")}>
              {zh ? "系統" : "System"} ({typeCounts.system})
            </button>
          </div>

          {error ? <p className="sub" style={{ marginTop: 10, color: "var(--danger, #b00020)" }}>{error}</p> : null}
          {message ? <p className="sub" style={{ marginTop: 10, color: "var(--success, #0b6b3a)" }}>{message}</p> : null}
          {loading ? <p className="sub" style={{ marginTop: 10 }}>{zh ? "載入中..." : "Loading..."}</p> : null}
          {!loading && grouped.urgent.length + grouped.normal.length === 0 ? (
            <p className="sub" style={{ marginTop: 10 }}>{zh ? "目前沒有通知。" : "No notifications."}</p>
          ) : null}

          {!loading && grouped.urgent.length + grouped.normal.length > 0 ? (
            <>
              <section className="card" style={{ marginTop: 12, padding: 12 }}>
                <div className="kvLabel">{zh ? "優先提醒" : "Priority Alerts"}</div>
                {grouped.urgent.length === 0 ? (
                  <p className="sub" style={{ marginTop: 8 }}>{zh ? "目前沒有高優先提醒。" : "No urgent alerts."}</p>
                ) : (
                  <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
                    {grouped.urgent.map((item) => renderItem(item))}
                  </ul>
                )}
              </section>

              <section className="card" style={{ marginTop: 12, padding: 12 }}>
                <div className="kvLabel">{zh ? "近期通知" : "Recent Notifications"}</div>
                <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
                  {grouped.normal.slice(0, 12).map((item) => renderItem(item))}
                </ul>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
