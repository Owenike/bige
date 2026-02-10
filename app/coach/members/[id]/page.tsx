"use client";

import { useEffect, useState } from "react";

type Props = { params: { id: string } };

export default function CoachMemberOverviewPage({ params }: Props) {
  const memberId = params.id;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/coach/members/${encodeURIComponent(memberId)}/overview`, { method: "GET" });
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
  }, [memberId]);

  return (
    <main style={{ padding: 16, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>會員狀態 (Coach)</h1>
      <p style={{ opacity: 0.8 }}>member_id: {memberId}</p>

      {loading ? <p>Loading...</p> : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {data ? (
        <section style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Overview</h2>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f6f6f6", padding: 12, borderRadius: 8 }}>
            {JSON.stringify(
              {
                member: data.member,
                subscriptions: data.subscriptions?.length ?? 0,
                entitlements: data.entitlements?.length ?? 0,
                entryPasses: data.entryPasses?.length ?? 0,
                recent: {
                  bookings: data.recent?.bookings?.length ?? 0,
                  checkins: data.recent?.checkins?.length ?? 0,
                  sessionRedemptions: data.recent?.sessionRedemptions?.length ?? 0,
                },
              },
              null,
              2,
            )}
          </pre>
        </section>
      ) : null}
    </main>
  );
}

