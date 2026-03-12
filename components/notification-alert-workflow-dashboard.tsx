"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type AlertStatus = "open" | "acknowledged" | "investigating" | "resolved" | "dismissed";
type AlertPriority = "P1" | "P2" | "P3" | "P4";
type AlertSeverity = "critical" | "high" | "medium" | "low";
type DeliveryChannel = "in_app" | "email" | "line" | "sms" | "webhook" | "other";

type AlertItem = {
  id: string;
  tenantId: string;
  anomalyKey: string;
  anomalyType: "tenant_priority" | "reason_cluster" | "delivery_error" | "manual";
  priority: AlertPriority;
  severity: AlertSeverity;
  status: AlertStatus;
  summary: string;
  ownerUserId: string | null;
  assigneeUserId: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
  assignmentNote: string | null;
  note: string | null;
  resolutionNote: string | null;
  sourceData: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AssigneeOption = {
  id: string;
  tenantId: string | null;
  displayName: string | null;
  role: string;
  isActive: boolean;
};

type TenantPriorityItem = {
  tenantId: string;
  priority: AlertPriority;
  severity: AlertSeverity;
  score: number;
  summary: string;
  deadLetter: number;
  failedRate: number;
  retrying: number;
  anomalyTotal: number;
};

type AnomalyInsightsSnapshot = {
  from: string;
  to: string;
  channel: DeliveryChannel | null;
  tenantPriorities: TenantPriorityItem[];
};

type FilterState = {
  from: string;
  to: string;
  tenantId: string;
  statuses: string;
  limit: number;
};

type AlertDraft = {
  status: AlertStatus;
  assigneeUserId: string;
  assignmentNote: string;
  note: string;
  resolutionNote: string;
};

function toLocalDateTimeInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const tzOffset = date.getTimezoneOffset();
  return new Date(date.getTime() - tzOffset * 60_000).toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(input: string) {
  const value = String(input || "").trim();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function defaultFilters(): FilterState {
  const now = new Date();
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    from: toLocalDateTimeInput(last7d.toISOString()),
    to: toLocalDateTimeInput(now.toISOString()),
    tenantId: "",
    statuses: "open,acknowledged,investigating",
    limit: 120,
  };
}

function safeMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const data = payload as { message?: unknown; error?: { message?: unknown } };
  if (typeof data.message === "string") return data.message;
  if (typeof data.error?.message === "string") return data.error.message;
  return fallback;
}

function buildTenantDrilldownHref(tenantId: string, filters: FilterState) {
  const params = new URLSearchParams();
  const fromIso = fromLocalDateTimeInput(filters.from);
  const toIso = fromLocalDateTimeInput(filters.to);
  if (fromIso) params.set("from", fromIso);
  if (toIso) params.set("to", toIso);
  params.set("limit", "2000");
  params.set("anomalyLimit", "40");
  return `/platform-admin/notifications-overview/${encodeURIComponent(tenantId)}?${params.toString()}`;
}

export default function NotificationAlertWorkflowDashboard() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<FilterState>(() => {
    const defaults = defaultFilters();
    const from = String(searchParams.get("from") || "").trim();
    const to = String(searchParams.get("to") || "").trim();
    const tenantId = String(searchParams.get("tenantId") || "").trim();
    const statuses = String(searchParams.get("statuses") || "").trim();
    const limit = Number(searchParams.get("limit") || "");
    return {
      from: from ? toLocalDateTimeInput(from) : defaults.from,
      to: to ? toLocalDateTimeInput(to) : defaults.to,
      tenantId,
      statuses: statuses || defaults.statuses,
      limit: Number.isFinite(limit) ? Math.min(500, Math.max(1, limit)) : defaults.limit,
    };
  });
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => ({
    ...filters,
  }));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [insights, setInsights] = useState<AnomalyInsightsSnapshot | null>(null);
  const [alertDrafts, setAlertDrafts] = useState<Record<string, AlertDraft>>({});
  const [assigneesByTenant, setAssigneesByTenant] = useState<Record<string, AssigneeOption[]>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    const fromIso = fromLocalDateTimeInput(filters.from);
    const toIso = fromLocalDateTimeInput(filters.to);
    if (filters.tenantId.trim()) params.set("tenantId", filters.tenantId.trim());
    if (filters.statuses.trim()) params.set("statuses", filters.statuses.trim());
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);
    params.set("limit", String(Math.min(500, Math.max(1, Number(filters.limit || 120)))));

    const anomaliesParams = new URLSearchParams();
    if (filters.tenantId.trim()) anomaliesParams.set("tenantId", filters.tenantId.trim());
    if (fromIso) anomaliesParams.set("from", fromIso);
    if (toIso) anomaliesParams.set("to", toIso);
    anomaliesParams.set("topTenantLimit", "12");
    anomaliesParams.set("topReasonLimit", "8");
    anomaliesParams.set("limit", "6000");

    setLoading(true);
    setError(null);
    setMessage(null);

    void Promise.all([
      fetch(`/api/platform/notifications/alerts?${params.toString()}`, { cache: "no-store" }).then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(safeMessage(payload, "Load alerts failed"));
        return (payload?.items || payload?.data?.items || []) as AlertItem[];
      }),
      fetch(`/api/platform/notifications/anomalies?${anomaliesParams.toString()}`, { cache: "no-store" }).then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(safeMessage(payload, "Load anomalies failed"));
        return (payload?.snapshot || payload?.data?.snapshot || null) as AnomalyInsightsSnapshot | null;
      }),
    ])
      .then(([alertsData, insightsData]) => {
        if (!active) return;
        setAlerts(alertsData);
        setInsights(insightsData);
        setAlertDrafts((prev) => {
          const next: Record<string, AlertDraft> = {};
          for (const item of alertsData) {
            next[item.id] = prev[item.id] || {
              status: item.status,
              assigneeUserId: item.assigneeUserId || "",
              assignmentNote: item.assignmentNote || "",
              note: item.note || "",
              resolutionNote: item.resolutionNote || "",
            };
          }
          return next;
        });
        setLoading(false);
      })
      .catch((fetchError) => {
        if (!active) return;
        setError(fetchError instanceof Error ? fetchError.message : "Load alert workflow failed");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, refreshKey]);

  useEffect(() => {
    let active = true;
    const tenantIds = Array.from(new Set(alerts.map((item) => item.tenantId))).filter(Boolean);
    if (tenantIds.length === 0) {
      setAssigneesByTenant({});
      return () => {
        active = false;
      };
    }

    void Promise.all(
      tenantIds.map(async (tenantId) => {
        const response = await fetch(
          `/api/platform/users?tenantId=${encodeURIComponent(tenantId)}&activeOnly=1&limit=200`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) return [tenantId, []] as const;
        const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.data?.items) ? payload.data.items : [];
        const normalized = items
          .map((row: Record<string, unknown>) => ({
            id: String(row.id || ""),
            tenantId: row.tenant_id ? String(row.tenant_id) : null,
            displayName: row.display_name ? String(row.display_name) : null,
            role: String(row.role || "unknown"),
            isActive: Boolean(row.is_active),
          }))
          .filter((row: AssigneeOption) => row.id && row.isActive)
          .sort((a: AssigneeOption, b: AssigneeOption) => {
            const aLabel = `${a.displayName || ""}${a.id}`;
            const bLabel = `${b.displayName || ""}${b.id}`;
            return aLabel.localeCompare(bLabel);
          });
        return [tenantId, normalized] as const;
      }),
    ).then((rows) => {
      if (!active) return;
      const next: Record<string, AssigneeOption[]> = {};
      for (const [tenantId, items] of rows) next[tenantId] = items;
      setAssigneesByTenant(next);
    });

    return () => {
      active = false;
    };
  }, [alerts]);

  const highPriorityOpenAlerts = useMemo(
    () => alerts.filter((item) => ["open", "acknowledged", "investigating"].includes(item.status) && (item.priority === "P1" || item.priority === "P2")),
    [alerts],
  );

  async function upsertFromTenantPriority(item: TenantPriorityItem) {
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/platform/notifications/alerts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert_from_anomaly",
          tenantId: item.tenantId,
          anomalyKey: `TENANT_PRIORITY:${item.tenantId}`,
          anomalyType: "tenant_priority",
          priority: item.priority,
          severity: item.severity,
          summary: item.summary,
          sourceData: {
            score: item.score,
            anomalyTotal: item.anomalyTotal,
            deadLetter: item.deadLetter,
            failedRate: item.failedRate,
            retrying: item.retrying,
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(safeMessage(payload, "Upsert alert failed"));
      setMessage(`Alert upserted for tenant ${item.tenantId}`);
      setRefreshKey((value) => value + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Upsert alert failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateAlert(id: string) {
    const draft = alertDrafts[id];
    if (!draft) return;
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/platform/notifications/alerts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update_alert",
          id,
          status: draft.status,
          note: draft.note,
          resolutionNote: draft.resolutionNote,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(safeMessage(payload, "Update alert failed"));
      setMessage(`Alert ${id.slice(0, 8)} updated`);
      setRefreshKey((value) => value + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Update alert failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function assignAlert(id: string) {
    const draft = alertDrafts[id];
    if (!draft) return;
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/platform/notifications/alerts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "assign_alert",
          id,
          assigneeUserId: draft.assigneeUserId || null,
          assignmentNote: draft.assignmentNote,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(safeMessage(payload, "Assign alert failed"));
      setMessage(`Alert ${id.slice(0, 8)} assignment updated`);
      setRefreshKey((value) => value + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Assign alert failed");
    } finally {
      setSubmitting(false);
    }
  }

  function applyFilters() {
    setFilters({
      from: draftFilters.from,
      to: draftFilters.to,
      tenantId: draftFilters.tenantId.trim(),
      statuses: draftFilters.statuses,
      limit: Math.min(500, Math.max(1, Number(draftFilters.limit || 120))),
    });
  }

  function resetFilters() {
    const defaults = defaultFilters();
    setDraftFilters(defaults);
    setFilters(defaults);
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">ALERT WORKFLOW</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Notification Alert Triage
            </h1>
            <p className="fdGlassText">Track open alerts, acknowledge/investigate/resolved/dismiss, and keep notes.</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/platform-admin/notifications-overview">
                Back To Overview
              </Link>
              <button type="button" className="fdPillBtn" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading || submitting}>
                Refresh
              </button>
            </div>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Filters</h2>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input
              className="input"
              type="datetime-local"
              value={draftFilters.from}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
            <input
              className="input"
              type="datetime-local"
              value={draftFilters.to}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
            <input
              className="input"
              value={draftFilters.tenantId}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, tenantId: event.target.value }))}
              placeholder="tenantId (blank = all)"
            />
          </div>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input
              className="input"
              value={draftFilters.statuses}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, statuses: event.target.value }))}
              placeholder="statuses csv (open,acknowledged,investigating...)"
            />
            <select
              className="input"
              value={String(draftFilters.limit)}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, limit: Number(event.target.value || 120) }))}
            >
              <option value="50">limit 50</option>
              <option value="120">limit 120</option>
              <option value="200">limit 200</option>
              <option value="300">limit 300</option>
            </select>
            <div className="actions">
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={applyFilters} disabled={submitting}>
                Apply
              </button>
              <button type="button" className="fdPillBtn" onClick={resetFilters} disabled={submitting}>
                Reset
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <div className="error">{error}</div>
          </section>
        ) : null}
        {message ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <div className="ok">{message}</div>
          </section>
        ) : null}
        {loading ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading alert workflow...</p>
          </section>
        ) : null}

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Open High Priority Alerts (P1/P2)</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {highPriorityOpenAlerts.map((item) => (
              <p key={`high-${item.id}`} className="sub" style={{ marginTop: 0 }}>
                [{item.priority}/{item.severity}] {item.status} - {item.tenantId} - assignee{" "}
                {item.assigneeUserId ? item.assigneeUserId : "unassigned"} - {item.summary}
              </p>
            ))}
            {highPriorityOpenAlerts.length === 0 ? <p className="fdGlassText">No open P1/P2 alerts in current scope.</p> : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Suggested Alerts From Tenant Priority</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {(insights?.tenantPriorities || []).map((item) => (
              <div key={`suggest-${item.tenantId}`} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  [{item.priority}/{item.severity}] score {item.score} - {item.tenantId}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {item.summary}
                </p>
                <div className="actions" style={{ marginTop: 6 }}>
                  <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void upsertFromTenantPriority(item)} disabled={submitting}>
                    Open / Refresh Alert
                  </button>
                  <Link className="fdPillBtn" href={buildTenantDrilldownHref(item.tenantId, filters)}>
                    Tenant Drilldown
                  </Link>
                </div>
              </div>
            ))}
            {(insights?.tenantPriorities || []).length === 0 ? <p className="fdGlassText">No tenant priority suggestions.</p> : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Alert Backlog</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {alerts.map((item) => {
              const draft = alertDrafts[item.id] || {
                status: item.status,
                assigneeUserId: item.assigneeUserId || "",
                assignmentNote: item.assignmentNote || "",
                note: item.note || "",
                resolutionNote: item.resolutionNote || "",
              };
              const assigneeOptions = assigneesByTenant[item.tenantId] || [];
              return (
                <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                  <p className="sub" style={{ marginTop: 0 }}>
                    [{item.priority}/{item.severity}] {item.status} - {item.tenantId}
                  </p>
                  <p className="sub" style={{ marginTop: 0 }}>
                    key: {item.anomalyKey}
                  </p>
                  <p className="sub" style={{ marginTop: 0 }}>
                    {item.summary}
                  </p>
                  <p className="sub" style={{ marginTop: 0 }}>
                    assignee: {item.assigneeUserId || "unassigned"} | assigned_at:{" "}
                    {item.assignedAt ? new Date(item.assignedAt).toLocaleString() : "-"} | assigned_by: {item.assignedBy || "-"}
                  </p>
                  <p className="sub" style={{ marginTop: 0 }}>
                    assignment_note: {item.assignmentNote || "-"}
                  </p>
                  <p className="sub" style={{ marginTop: 0 }}>
                    updated: {new Date(item.updatedAt).toLocaleString()} | resolved:{" "}
                    {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : "-"} | dismissed:{" "}
                    {item.dismissedAt ? new Date(item.dismissedAt).toLocaleString() : "-"}
                  </p>

                  <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
                    <select
                      className="input"
                      value={draft.assigneeUserId}
                      onChange={(event) =>
                        setAlertDrafts((prev) => ({
                          ...prev,
                          [item.id]: { ...draft, assigneeUserId: event.target.value },
                        }))
                      }
                    >
                      <option value="">unassigned</option>
                      {assigneeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.displayName || option.id} ({option.role})
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      value={draft.assignmentNote}
                      onChange={(event) =>
                        setAlertDrafts((prev) => ({
                          ...prev,
                          [item.id]: { ...draft, assignmentNote: event.target.value },
                        }))
                      }
                      placeholder="assignment note"
                    />
                    <div className="actions">
                      <button type="button" className="fdPillBtn" onClick={() => void assignAlert(item.id)} disabled={submitting}>
                        Save Assignment
                      </button>
                    </div>
                  </div>

                  <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
                    <select
                      className="input"
                      value={draft.status}
                      onChange={(event) =>
                        setAlertDrafts((prev) => ({
                          ...prev,
                          [item.id]: { ...draft, status: event.target.value as AlertStatus },
                        }))
                      }
                    >
                      <option value="open">open</option>
                      <option value="acknowledged">acknowledged</option>
                      <option value="investigating">investigating</option>
                      <option value="resolved">resolved</option>
                      <option value="dismissed">dismissed</option>
                    </select>
                    <input
                      className="input"
                      value={draft.note}
                      onChange={(event) =>
                        setAlertDrafts((prev) => ({
                          ...prev,
                          [item.id]: { ...draft, note: event.target.value },
                        }))
                      }
                      placeholder="note"
                    />
                    <input
                      className="input"
                      value={draft.resolutionNote}
                      onChange={(event) =>
                        setAlertDrafts((prev) => ({
                          ...prev,
                          [item.id]: { ...draft, resolutionNote: event.target.value },
                        }))
                      }
                      placeholder="resolution note"
                    />
                  </div>

                  <div className="actions" style={{ marginTop: 8 }}>
                    <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void updateAlert(item.id)} disabled={submitting}>
                      Save Update
                    </button>
                    <Link className="fdPillBtn" href={buildTenantDrilldownHref(item.tenantId, filters)}>
                      Tenant Drilldown
                    </Link>
                  </div>
                </div>
              );
            })}
            {alerts.length === 0 ? <p className="fdGlassText">No alerts in current scope.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
