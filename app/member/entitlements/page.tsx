"use client";

import { useEffect, useState } from "react";

export default function MemberEntitlementsPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/member/entitlements", { method: "GET" });
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
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>方案狀態</h1>
      <p style={{ opacity: 0.8 }}>月費到期、剩餘次數、有效票 (best-effort)</p>

      {loading ? <p>Loading...</p> : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {data ? (
        <>
          <section style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Summary</h2>
            <pre style={{ whiteSpace: "pre-wrap", background: "#f6f6f6", padding: 12, borderRadius: 8 }}>
              {JSON.stringify(data.summary, null, 2)}
            </pre>
          </section>

          <section style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Raw</h2>
            <pre style={{ whiteSpace: "pre-wrap", background: "#f6f6f6", padding: 12, borderRadius: 8 }}>
              {JSON.stringify(
                {
                  subscriptions: data.subscriptions?.length ?? 0,
                  entitlements: data.entitlements?.length ?? 0,
                  entryPasses: data.entryPasses?.length ?? 0,
                },
                null,
                2,
              )}
            </pre>
          </section>
        </>
      ) : null}
    </main>
  );
}

