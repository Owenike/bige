"use client";

import { ArrowLeft, CheckCircle2, ClipboardList, Plus, RefreshCw } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./administrative-assistance-board.module.css";

type AssistanceItem = {
  id: string;
  title: string;
  details: string | null;
  status: "open" | "completed";
  creator_name: string;
  completed_by_name: string | null;
  created_at: string;
  completed_at: string | null;
};

type ApiPayload = {
  ok?: boolean;
  items?: AssistanceItem[];
  item?: AssistanceItem;
  capabilities?: {
    canCreate: boolean;
    canComplete: boolean;
  };
  error?: { message?: string } | string;
  message?: string;
};

function errorMessage(payload: ApiPayload | null, fallback: string) {
  if (typeof payload?.error === "string") return payload.error;
  if (payload?.error && typeof payload.error === "object" && payload.error.message) {
    return payload.error.message;
  }
  return payload?.message || fallback;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AdministrativeAssistanceBoard({
  embedded = false,
  premium = false,
  returnTo,
}: {
  embedded?: boolean;
  premium?: boolean;
  returnTo: string;
}) {
  const [items, setItems] = useState<AssistanceItem[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [canComplete, setCanComplete] = useState(false);
  const [status, setStatus] = useState<"open" | "completed">("open");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/administrative-assistance?status=${status}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (!response.ok) throw new Error(errorMessage(payload, "讀取行政協助事項失敗"));
      setItems(payload?.items || []);
      setCanCreate(payload?.capabilities?.canCreate === true);
      setCanComplete(payload?.capabilities?.canComplete === true);
    } catch (caught) {
      setItems([]);
      setError(caught instanceof Error ? caught.message : "讀取行政協助事項失敗");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !canCreate) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/administrative-assistance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, details }),
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (!response.ok) throw new Error(errorMessage(payload, "建立行政協助事項失敗"));
      setTitle("");
      setDetails("");
      setStatus("open");
      setNotice("已送到櫃台協助清單");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "建立行政協助事項失敗");
    } finally {
      setSaving(false);
    }
  }

  async function completeItem(id: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/administrative-assistance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (!response.ok) throw new Error(errorMessage(payload, "完成行政協助事項失敗"));
      setItems((current) => current.filter((item) => item.id !== id));
      setNotice("已標記完成，處理人與時間已留下紀錄");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "完成行政協助事項失敗");
    } finally {
      setBusyId(null);
    }
  }

  const content = (
      <div
        className={`${embedded ? styles.embedded : styles.shell} ${premium ? styles.premium : ""}`.trim()}
      >
        {!embedded ? (
          <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>BIG E FITNESS OPERATIONS</p>
            <h1>行政協助事項</h1>
            <p>教練部提出，庶務部直接處理並完成。</p>
          </div>
          <a className={styles.iconButton} href={returnTo} title="返回營運後台">
            <ArrowLeft size={19} />
          </a>
          </header>
        ) : null}

        <nav className={styles.tabs} aria-label="行政協助狀態">
          <button
            className={status === "open" ? styles.activeTab : ""}
            type="button"
            onClick={() => setStatus("open")}
          >
            待處理
          </button>
          <button
            className={status === "completed" ? styles.activeTab : ""}
            type="button"
            onClick={() => setStatus("completed")}
          >
            已完成
          </button>
          <button className={styles.iconButton} type="button" onClick={() => void load()} title="重新整理">
            <RefreshCw size={17} />
          </button>
        </nav>

        {error ? <p className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}

        {canCreate ? (
          <form className={styles.createPanel} onSubmit={createItem}>
            <div>
              <h2>建立協助事項</h2>
              <p>送出後會立即出現在櫃台清單。</p>
            </div>
            <label>
              事項
              <input
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：聯絡學員確認明日上課時間"
              />
            </label>
            <label>
              補充內容
              <textarea
                rows={3}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                placeholder="可留空"
              />
            </label>
            <button className={styles.primaryButton} type="submit" disabled={saving}>
              <Plus size={17} />
              {saving ? "送出中" : "送到櫃台"}
            </button>
          </form>
        ) : null}

        <section className={styles.listPanel}>
          <div className={styles.sectionTitle}>
            <div>
              <h2>{status === "open" ? "待處理事項" : "完成紀錄"}</h2>
              <span>{items.length} 筆</span>
            </div>
            <ClipboardList size={22} />
          </div>

          {loading ? <p className={styles.empty}>讀取中...</p> : null}
          {!loading && items.length === 0 ? <p className={styles.empty}>目前沒有資料</p> : null}
          {!loading ? (
            <div className={styles.list}>
              {items.map((item) => (
                <article className={styles.item} key={item.id}>
                  <div className={styles.itemBody}>
                    <strong>{item.title}</strong>
                    {item.details ? <p>{item.details}</p> : null}
                    <span>
                      {item.creator_name} · {formatDateTime(item.created_at)}
                    </span>
                    {item.status === "completed" ? (
                      <span>
                        由 {item.completed_by_name || "員工"} 完成 · {formatDateTime(item.completed_at)}
                      </span>
                    ) : null}
                  </div>
                  {item.status === "open" && canComplete ? (
                    <button
                      className={styles.completeButton}
                      type="button"
                      onClick={() => void completeItem(item.id)}
                      disabled={busyId === item.id}
                    >
                      <CheckCircle2 size={17} />
                      {busyId === item.id ? "處理中" : "標記完成"}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>
  );

  if (embedded) {
    return <section>{content}</section>;
  }

  return (
    <main className={`${styles.page} ${premium ? styles.premiumPage : ""}`.trim()}>
      {content}
    </main>
  );
}
