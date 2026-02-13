"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n-provider";

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
  const { locale } = useI18n();
  const zh = locale !== "en";
  const memberId = id;
  const [data, setData] = useState<CoachMemberOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function statusLabel(value: string | null) {
    if (!value) return "-";
    if (!zh) return value;
    if (value === "booked") return "\u5df2\u9810\u7d04";
    if (value === "checked_in") return "\u5df2\u5831\u5230";
    if (value === "completed") return "\u5df2\u5b8c\u6210";
    if (value === "cancelled") return "\u5df2\u53d6\u6d88";
    if (value === "no_show") return "\u672a\u51fa\u5e2d";
    if (value === "active") return "\u555f\u7528\u4e2d";
    if (value === "inactive") return "\u672a\u555f\u7528";
    if (value === "expired") return "\u5df2\u904e\u671f";
    return value;
  }

  function passTypeLabel(value: string | null) {
    if (!value) return zh ? "\u7968\u5238" : "pass";
    if (!zh) return value;
    if (value === "single") return "\u55ae\u6b21\u7968";
    if (value === "punch") return "\u6b21\u6578\u7968";
    if (value === "pass") return "\u7968\u5238";
    return value;
  }

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
        if (!cancelled) setError(err instanceof Error ? err.message : zh ? "\u8f09\u5165\u6703\u54e1\u8cc7\u6599\u5931\u6557" : "Failed to load member overview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [memberId, zh]);

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{zh ? "\u6703\u54e1\u6982\u89bd" : "Member Overview"}</h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>{zh ? "\u6703\u54e1\u7de8\u865f" : "member_id"}: {memberId}</p>

        {loading ? <p style={{ marginTop: 12 }}>{zh ? "\u8f09\u5165\u4e2d..." : "Loading..."}</p> : null}
        {error ? <p style={{ marginTop: 12, color: "crimson" }}>{error}</p> : null}

        {data ? (
          <>
            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{zh ? "\u500b\u4eba\u8cc7\u6599" : "Profile"}</h2>
              <p style={{ marginTop: 10, marginBottom: 0 }}>
                {zh ? "\u59d3\u540d" : "name"}: {data.member.fullName || "-"} | {zh ? "\u96fb\u8a71\u5f8c\u56db\u78bc" : "phone last4"}: {data.member.phoneLast4 || "-"}
              </p>
              <p style={{ marginTop: 6, marginBottom: 0 }}>{zh ? "\u5099\u8a3b" : "note"}: {data.member.note || "-"}</p>
            </section>

            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{zh ? "\u6703\u54e1\u65b9\u6848" : "Subscription"}</h2>
              <p style={{ marginTop: 10, marginBottom: 0 }}>
                {zh ? "\u5230\u671f" : "expires"}: {formatDateTime(data.subscription.expiresAt)} | {zh ? "\u72c0\u614b" : "status"}:{" "}
                {data.subscription.isActive === null ? (zh ? "\u672a\u77e5" : "unknown") : data.subscription.isActive ? (zh ? "\u555f\u7528\u4e2d" : "active") : (zh ? "\u672a\u555f\u7528" : "inactive")}
              </p>
            </section>

            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{zh ? "\u7968\u5238" : "Passes"}</h2>
              {data.passes.length === 0 ? (
                <p style={{ marginTop: 10, opacity: 0.75 }}>{zh ? "\u627e\u4e0d\u5230\u7968\u5238\u8cc7\u6599\u3002" : "No passes found."}</p>
              ) : (
                <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                  {data.passes.map((pass) => (
                    <li key={pass.id} style={{ marginBottom: 8 }}>
                      {passTypeLabel(pass.passType)} | {zh ? "\u5269\u9918\u5802\u6578" : "remain"} {pass.remaining ?? "-"} | {zh ? "\u5230\u671f" : "expires"} {formatDateTime(pass.expiresAt)} | {zh ? "\u72c0\u614b" : "status"} {statusLabel(pass.status)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{zh ? "\u6700\u8fd1\u6d3b\u52d5" : "Recent Activity"}</h2>
              <p style={{ marginTop: 10, marginBottom: 0 }}>
                {zh ? "\u5831\u5230" : "check-in"}: {data.recentCheckin ? `${formatDateTime(data.recentCheckin.checkedAt)} (${statusLabel(data.recentCheckin.result)})` : "-"}
              </p>
              <p style={{ marginTop: 6, marginBottom: 0 }}>
                {zh ? "\u6838\u92b7" : "redemption"}:{" "}
                {data.recentRedemption
                  ? `${formatDateTime(data.recentRedemption.redeemedAt)} (${statusLabel(data.recentRedemption.kind)}, ${zh ? "\u6578\u91cf" : "qty"} ${data.recentRedemption.quantity})`
                  : "-"}
              </p>
              <p style={{ marginTop: 6, marginBottom: 0 }}>
                {zh ? "\u9810\u7d04" : "booking"}:{" "}
                {data.recentBooking
                  ? `${formatDateTime(data.recentBooking.startsAt)} (${data.recentBooking.serviceName || "-"}, ${statusLabel(data.recentBooking.status)})`
                  : "-"}
              </p>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
