"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";
import { MemberTabs } from "../_components/MemberTabs";

type EntitlementSummary = {
  monthly_expires_at: string | null;
  remaining_sessions: number | null;
  pass_valid_to: string | null;
};

type EntitlementsResponse = {
  memberId: string;
  summary: EntitlementSummary;
  subscriptions: Array<Record<string, unknown>>;
  entitlements: Array<Record<string, unknown>>;
  entryPasses: Array<Record<string, unknown>>;
};

function formatDateTime(input: string | null | undefined) {
  if (!input) return "-";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleString();
}

function getStringField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "-";
}

function getNumberField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  }
  return null;
}

export default function MemberEntitlementsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [data, setData] = useState<EntitlementsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function passTypeLabel(input: string) {
    if (!zh) return input;
    if (input === "single") return "\u55ae\u6b21\u7968";
    if (input === "punch") return "\u6b21\u6578\u7968";
    if (input === "monthly") return "\u6708\u6703\u54e1";
    if (input === "entry_pass") return "\u5165\u5834\u7968";
    return input;
  }

  function statusLabel(input: string) {
    if (!zh) return input;
    if (input === "active") return "\u555f\u7528\u4e2d";
    if (input === "expired") return "\u5df2\u904e\u671f";
    if (input === "inactive") return "\u672a\u555f\u7528";
    return input;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/member/entitlements", { method: "GET" });
        const json = (await res.json().catch(() => null)) as EntitlementsResponse | { error?: string } | null;
        if (!res.ok) throw new Error((json as { error?: string } | null)?.error || `HTTP ${res.status}`);

        if (!cancelled) setData(json as EntitlementsResponse);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : zh ? "\u8f09\u5165\u6b0a\u76ca\u5931\u6557" : "Failed to load entitlements");
        }
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
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{zh ? "\u6211\u7684\u6b0a\u76ca" : "My Entitlements"}</h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>
          {zh ? "\u5165\u5834\u8207\u9810\u7d04\u76f8\u95dc\u7684\u6703\u54e1\u8207\u7968\u5238\u6548\u671f\u3002" : "Membership and pass validity for entry and bookings."}
        </p>
        <MemberTabs />
        <div className="actions" style={{ marginTop: 10 }}>
          <a className="btn" href="/member/history">
            {zh ? "查看付款與消費紀錄" : "View Billing History"}
          </a>
          <a className="btn" href="/member/bookings">
            {zh ? "前往預約" : "Go to Bookings"}
          </a>
        </div>

        {loading ? <p style={{ marginTop: 12 }}>{zh ? "\u8f09\u5165\u4e2d..." : "Loading..."}</p> : null}
        {error ? <p style={{ marginTop: 12, color: "crimson" }}>{error}</p> : null}

        {data ? (
          <>
            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{zh ? "\u76ee\u524d\u6458\u8981" : "Current Summary"}</h2>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 10 }}>
                <div className="card kv">
                  <div className="kvLabel">{zh ? "\u6708\u6703\u54e1\u5230\u671f" : "Monthly Expires"}</div>
                  <div className="kvValue">{formatDateTime(data.summary?.monthly_expires_at)}</div>
                </div>
                <div className="card kv">
                  <div className="kvLabel">{zh ? "\u5269\u9918\u5802\u6578" : "Remaining Sessions"}</div>
                  <div className="kvValue">{typeof data.summary?.remaining_sessions === "number" ? data.summary.remaining_sessions : "-"}</div>
                </div>
                <div className="card kv">
                  <div className="kvLabel">{zh ? "\u7968\u5238\u6709\u6548\u81f3" : "Pass Valid Until"}</div>
                  <div className="kvValue">{formatDateTime(data.summary?.pass_valid_to)}</div>
                </div>
              </div>
            </section>

            <section style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{zh ? "\u8fd1\u671f\u7968\u5238" : "Recent Passes"}</h2>
              {data.entryPasses.length === 0 ? (
                <p style={{ marginTop: 10, opacity: 0.75 }}>
                  {zh ? "\u627e\u4e0d\u5230\u4efb\u4f55\u7968\u5238\u7d00\u9304\u3002" : "No active or historical passes found."}
                </p>
              ) : (
                <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                  {data.entryPasses.slice(0, 10).map((row, idx) => {
                    const passType = getStringField(row, ["pass_type", "type", "name"]);
                    const remaining = getNumberField(row, ["remaining", "remaining_sessions", "remaining_count"]);
                    const expiresAt = getStringField(row, ["expires_at", "valid_to", "ends_at"]);
                    const status = getStringField(row, ["status"]);
                    const id = getStringField(row, ["id"]);

                    return (
                      <li key={`${id}-${idx}`} style={{ marginBottom: 8 }}>
                        {passTypeLabel(passType)} | {zh ? "\u5269\u9918" : "remain"} {remaining ?? "-"} | {zh ? "\u5230\u671f" : "expires"}{" "}
                        {formatDateTime(expiresAt === "-" ? null : expiresAt)} | {zh ? "\u72c0\u614b" : "status"} {statusLabel(status)}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{zh ? "\u8cc7\u6599\u7d71\u8a08" : "Data Volume"}</h2>
              <p style={{ marginTop: 10, opacity: 0.85 }}>
                {zh ? "\u6703\u54e1\u65b9\u6848" : "subscriptions"}: {data.subscriptions.length} |{" "}
                {zh ? "\u6b0a\u76ca" : "entitlements"}: {data.entitlements.length} |{" "}
                {zh ? "\u7968\u5238" : "entry passes"}: {data.entryPasses.length}
              </p>
            </section>

            <section className="card" style={{ marginTop: 20, padding: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{zh ? "續約與付款（待串接）" : "Renewal & Payment (Planned)"}</h2>
              <p style={{ marginTop: 10, opacity: 0.85 }}>
                {zh
                  ? "此區將串接會籍續約、付款方式管理、扣款提醒與電子發票。"
                  : "This section will include renewals, payment methods, billing reminders, and invoice details."}
              </p>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
