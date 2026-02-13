"use client";

import { useEffect, useState } from "react";

type CoachMemberOverviewResponse = {
  member: {
    id: string;
    fullName: string;
    phoneLast4: string | null;
    photoUrl: string | null;
    note: string | null;
  };
  subscription: {
    expiresAt: string | null;
    isActive: boolean | null;
  };
  passes: Array<{
    id: string;
    passType: string | null;
    remaining: number | null;
    expiresAt: string | null;
    status: string | null;
  }>;
  recentCheckin: {
    checkedAt: string;
    result: string | null;
    reason: string | null;
  } | null;
  recentRedemption: {
    redeemedAt: string;
    kind: string | null;
    quantity: number;
  } | null;
  recentBooking: {
    startsAt: string;
    endsAt: string;
    serviceName: string | null;
    status: string | null;
    note: string | null;
  } | null;
};

function formatDateTime(input: string | null | undefined) {
  if (!input) return "-";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleString();
}

export default function CoachMemberOverviewPage({ id }: { id: string }) {
  const memberId = id;
  const [data, setData] = useState<CoachMemberOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/coach/members/${encodeURIComponent(memberId)}/overview`, { method: "GET" });
        const json = (await res.json().catch(() => null)) as CoachMemberOverviewResponse | { error?: string } | null;
        if (!res.ok) throw new Error((json as { error?: string } | null)?.error || `HTTP ${res.status}`);

        if (!cancelled) setData(json as CoachMemberOverviewResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load member overview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [memberId]);

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Member Overview</h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>member_id: {memberId}</p>

        {loading ? <p style={{ marginTop: 12 }}>Loading...</p> : null}
        {error ? <p style={{ marginTop: 12, color: "crimson" }}>{error}</p> : null}

        {data ? (
          <>
            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Profile</h2>
              <p style={{ marginTop: 10, marginBottom: 0 }}>
                name: {data.member.fullName || "-"} | phone last4: {data.member.phoneLast4 || "-"}
              </p>
              <p style={{ marginTop: 6, marginBottom: 0 }}>note: {data.member.note || "-"}</p>
            </section>

            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Subscription</h2>
              <p style={{ marginTop: 10, marginBottom: 0 }}>
                expires: {formatDateTime(data.subscription.expiresAt)} | status:{" "}
                {data.subscription.isActive === null ? "unknown" : data.subscription.isActive ? "active" : "inactive"}
              </p>
            </section>

            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Passes</h2>
              {data.passes.length === 0 ? (
                <p style={{ marginTop: 10, opacity: 0.75 }}>No passes found.</p>
              ) : (
                <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                  {data.passes.map((pass) => (
                    <li key={pass.id} style={{ marginBottom: 8 }}>
                      {pass.passType || "pass"} | remain {pass.remaining ?? "-"} | expires {formatDateTime(pass.expiresAt)} | status {pass.status || "-"}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Recent Activity</h2>
              <p style={{ marginTop: 10, marginBottom: 0 }}>
                check-in: {data.recentCheckin ? `${formatDateTime(data.recentCheckin.checkedAt)} (${data.recentCheckin.result || "-"})` : "-"}
              </p>
              <p style={{ marginTop: 6, marginBottom: 0 }}>
                redemption:{" "}
                {data.recentRedemption
                  ? `${formatDateTime(data.recentRedemption.redeemedAt)} (${data.recentRedemption.kind || "-"}, qty ${data.recentRedemption.quantity})`
                  : "-"}
              </p>
              <p style={{ marginTop: 6, marginBottom: 0 }}>
                booking:{" "}
                {data.recentBooking
                  ? `${formatDateTime(data.recentBooking.startsAt)} (${data.recentBooking.serviceName || "-"}, ${data.recentBooking.status || "-"})`
                  : "-"}
              </p>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
