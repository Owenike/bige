"use client";

import { ArrowLeft, Bell, CheckCheck, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type NotificationItem = {
  id: string;
  status: "unread" | "read" | "archived";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  actionUrl: string | null;
  createdAt: string;
};

function readError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as { error?: string | { message?: string }; message?: string };
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && body.error.message) {
    return body.error.message;
  }
  return body.message || fallback;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function StaffNotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/notifications?status=all&limit=80", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(payload, "讀取通知失敗"));
      const data = payload?.data || payload;
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "讀取通知失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => items.filter((item) => filter === "all" || item.status === "unread"),
    [filter, items],
  );
  const unreadIds = useMemo(
    () => items.filter((item) => item.status === "unread").map((item) => item.id),
    [items],
  );

  async function markRead(ids: string[]) {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", notificationIds: ids }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(payload, "更新通知失敗"));
      const targetIds = new Set(ids);
      setItems((current) =>
        current.map((item) => (targetIds.has(item.id) ? { ...item, status: "read" } : item)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新通知失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>BIG E STAFF</p>
            <h1 className={styles.title}>通知中心</h1>
            <p className={styles.subtitle}>帳號安全、主管處理結果與未來班表通知都會集中在這裡。</p>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.iconButton} type="button" onClick={() => void load()} title="重新整理">
              <RefreshCw size={19} />
            </button>
            <button className={styles.iconButton} type="button" onClick={() => history.back()} title="返回">
              <ArrowLeft size={19} />
            </button>
          </div>
        </header>

        <section className={styles.toolbar}>
          <div className={styles.segmented} aria-label="通知篩選">
            <button type="button" className={filter === "unread" ? styles.selected : ""} onClick={() => setFilter("unread")}>
              未讀 {unreadIds.length}
            </button>
            <button type="button" className={filter === "all" ? styles.selected : ""} onClick={() => setFilter("all")}>
              全部
            </button>
          </div>
          <button className={styles.markAllButton} type="button" disabled={busy || unreadIds.length === 0} onClick={() => void markRead(unreadIds)}>
            <CheckCheck size={17} />
            全部標示已讀
          </button>
        </section>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <section className={styles.list} aria-live="polite">
          {visible.map((item) => (
            <article
              className={`${styles.item} ${item.status === "unread" ? styles.unread : ""} ${styles[item.severity]}`}
              key={item.id}
            >
              <div className={styles.itemIcon}><Bell size={18} /></div>
              <div className={styles.itemBody}>
                <div className={styles.itemHeading}>
                  <h2>{item.title}</h2>
                  <time>{formatTime(item.createdAt)}</time>
                </div>
                <p>{item.message}</p>
                <div className={styles.itemActions}>
                  {item.status === "unread" ? (
                    <button type="button" onClick={() => void markRead([item.id])}>標示已讀</button>
                  ) : null}
                  {item.actionUrl ? (
                    <Link href={item.actionUrl} onClick={() => void markRead([item.id])}>
                      前往處理
                      <ExternalLink size={15} />
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
          {!loading && visible.length === 0 ? (
            <div className={styles.empty}>
              <Bell size={24} />
              <p>{filter === "unread" ? "目前沒有未讀通知" : "目前還沒有通知"}</p>
            </div>
          ) : null}
          {loading ? <div className={styles.empty}><p>正在讀取通知</p></div> : null}
        </section>
      </div>
    </main>
  );
}
