"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";

type HistoryItem = {
  type: "checkin" | "session_redemption" | "order" | "payment" | string;
  ts: string | null;
  row: Record<string, unknown>;
};

type HistoryResponse = {
  memberId: string;
  items: HistoryItem[];
};

function formatDateTime(input: string | null | undefined) {
  if (!input) return "-";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleString();
}

function getField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return "-";
}

export default function MemberHistoryPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function typeLabel(type: string) {
    if (!zh) return type;
    if (type === "checkin") return "\u5165\u5834";
    if (type === "session_redemption") return "\u5802\u6578\u6838\u92b7";
    if (type === "order") return "\u8a02\u55ae";
    if (type === "payment") return "\u4ed8\u6b3e";
    return type;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/member/history", { method: "GET" });
        const json = (await res.json().catch(() => null)) as HistoryResponse | { error?: string } | null;
        if (!res.ok) throw new Error((json as { error?: string } | null)?.error || `HTTP ${res.status}`);

        if (!cancelled) setData(json as HistoryResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : zh ? "\u8f09\u5165\u7d00\u9304\u5931\u6557" : "Failed to load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [zh]);

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          {zh ? "\u6d3b\u52d5\u7d00\u9304" : "My Activity History"}
        </h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>
          {zh
            ? "\u67e5\u770b\u5165\u5834\u3001\u6838\u92b7\u3001\u8a02\u55ae\u8207\u4ed8\u6b3e\u3002"
            : "Check-ins, redemptions, orders, and payments in one timeline."}
        </p>

        {loading ? <p style={{ marginTop: 12 }}>{zh ? "\u8f09\u5165\u4e2d..." : "Loading..."}</p> : null}
        {error ? <p style={{ marginTop: 12, color: "crimson" }}>{error}</p> : null}

        {data && !loading && !error ? (
          data.items.length === 0 ? (
            <p style={{ marginTop: 12, opacity: 0.75 }}>{zh ? "\u5c1a\u7121\u7d00\u9304\u3002" : "No activity records found."}</p>
          ) : (
            <ul style={{ marginTop: 14, listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
              {data.items.slice(0, 50).map((item, idx) => {
                const id = getField(item.row, ["id"]);
                const status = getField(item.row, ["status", "result"]);
                const amount = getField(item.row, ["amount"]);
                const reason = getField(item.row, ["reason"]);
                const service = getField(item.row, ["service_name"]);

                return (
                  <li key={`${id}-${idx}`} className="card" style={{ padding: 12 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
                      <strong>{typeLabel(item.type)}</strong>
                      <span style={{ opacity: 0.75 }}>{formatDateTime(item.ts)}</span>
                    </div>
                    <p style={{ marginTop: 8, marginBottom: 0 }}>
                      {zh ? "\u72c0\u614b" : "status"}: {status} | {zh ? "\u91d1\u984d" : "amount"}: {amount} | {zh ? "\u670d\u52d9" : "service"}: {service}
                    </p>
                    {reason !== "-" ? (
                      <p style={{ marginTop: 6, marginBottom: 0, opacity: 0.85 }}>
                        {zh ? "\u539f\u56e0" : "reason"}: {reason}
                      </p>
                    ) : null}
                    <p style={{ marginTop: 6, marginBottom: 0, opacity: 0.65, fontSize: 12 }}>
                      {zh ? "\u7d00\u9304 ID" : "record id"}: {id}
                    </p>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>
    </main>
  );
}
