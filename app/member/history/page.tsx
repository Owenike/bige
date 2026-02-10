"use client";

import { useEffect, useState } from "react";

export default function MemberHistoryPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/member/history", { method: "GET" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ padding: 16, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>紀錄查詢</h1>
      <p style={{ opacity: 0.8 }}>入場 / 消費 / 核銷 (best-effort merge)</p>

      {loading ? <p>Loading...</p> : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {data?.items ? (
        <section style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Items</h2>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f6f6f6", padding: 12, borderRadius: 8 }}>
            {JSON.stringify(data.items.slice(0, 50), null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}

