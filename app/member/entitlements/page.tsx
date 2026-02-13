"use client";

import { useEffect, useState } from "react";

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
  const [data, setData] = useState<EntitlementsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load entitlements");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>My Entitlements</h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>Membership and pass validity for entry and bookings.</p>

        {loading ? <p style={{ marginTop: 12 }}>Loading...</p> : null}
        {error ? <p style={{ marginTop: 12, color: "crimson" }}>{error}</p> : null}

        {data ? (
          <>
            <section style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Current Summary</h2>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 10 }}>
                <div className="card kv">
                  <div className="kvLabel">Monthly Expires</div>
                  <div className="kvValue">{formatDateTime(data.summary?.monthly_expires_at)}</div>
                </div>
                <div className="card kv">
                  <div className="kvLabel">Remaining Sessions</div>
                  <div className="kvValue">{typeof data.summary?.remaining_sessions === "number" ? data.summary.remaining_sessions : "-"}</div>
                </div>
                <div className="card kv">
                  <div className="kvLabel">Pass Valid Until</div>
                  <div className="kvValue">{formatDateTime(data.summary?.pass_valid_to)}</div>
                </div>
              </div>
            </section>

            <section style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Recent Passes</h2>
              {data.entryPasses.length === 0 ? (
                <p style={{ marginTop: 10, opacity: 0.75 }}>No active or historical passes found.</p>
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
                        {passType} | remain {remaining ?? "-"} | expires {formatDateTime(expiresAt === "-" ? null : expiresAt)} | status {status}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Data Volume</h2>
              <p style={{ marginTop: 10, opacity: 0.85 }}>
                subscriptions: {data.subscriptions.length} | entitlements: {data.entitlements.length} | entry passes: {data.entryPasses.length}
              </p>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
