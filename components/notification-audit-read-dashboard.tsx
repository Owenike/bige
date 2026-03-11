"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  buildNotificationAuditUiSearchParams,
  formatIsoToLocalDateTimeInput,
  fetchNotificationAuditUiData,
  NOTIFICATION_AUDIT_ACTIONS,
  parseDateTimeInputToIso,
  parseNotificationAuditUiQuery,
  type NotificationAuditApiPayload,
  type NotificationAuditQuery,
  type NotificationGovernanceMode,
} from "../lib/notification-governance-read-ui";
import {
  formatStatusLabel,
  getNotificationGovernanceToneStyle,
  resolveNotificationGovernanceTone,
  summarizeMetadataObject,
  truncateDisplayValue,
} from "../lib/notification-governance-view-model";
import NotificationGovernanceNav from "./notification-governance-nav";

type NotificationAuditReadDashboardProps = {
  mode: NotificationGovernanceMode;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function NotificationAuditReadDashboard(props: NotificationAuditReadDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseNotificationAuditUiQuery(searchParams, props.mode), [searchParams, props.mode]);

  const [tenantIdInput, setTenantIdInput] = useState(query.tenantId || "");
  const [actionInput, setActionInput] = useState(query.action || "");
  const [resourceTypeInput, setResourceTypeInput] = useState(query.resourceType || "");
  const [actorInput, setActorInput] = useState(query.actorUserId || "");
  const [fromInput, setFromInput] = useState(formatIsoToLocalDateTimeInput(query.from));
  const [toInput, setToInput] = useState(formatIsoToLocalDateTimeInput(query.to));
  const [limitInput, setLimitInput] = useState(String(query.limit));
  const [cursorInput, setCursorInput] = useState(formatIsoToLocalDateTimeInput(query.cursor));
  const [payload, setPayload] = useState<NotificationAuditApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setTenantIdInput(query.tenantId || "");
    setActionInput(query.action || "");
    setResourceTypeInput(query.resourceType || "");
    setActorInput(query.actorUserId || "");
    setFromInput(formatIsoToLocalDateTimeInput(query.from));
    setToInput(formatIsoToLocalDateTimeInput(query.to));
    setLimitInput(String(query.limit));
    setCursorInput(formatIsoToLocalDateTimeInput(query.cursor));
  }, [query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void fetchNotificationAuditUiData(props.mode, query).then((result) => {
      if (!active) return;
      if (result.ok === false) {
        setError(result.message);
        setLoading(false);
        return;
      }
      setPayload(result.data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [props.mode, query, refreshKey]);

  function pushQuery(next: NotificationAuditQuery) {
    const params = buildNotificationAuditUiSearchParams(next, props.mode);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname);
  }

  function applyFilters() {
    const limitParsed = Number(limitInput);
    pushQuery({
      tenantId: props.mode === "platform" ? tenantIdInput.trim() || null : null,
      action: (actionInput.trim() || null) as NotificationAuditQuery["action"],
      resourceType: resourceTypeInput.trim() || null,
      actorUserId: actorInput.trim() || null,
      from: parseDateTimeInputToIso(fromInput),
      to: parseDateTimeInputToIso(toInput),
      limit: Number.isFinite(limitParsed) ? Math.min(200, Math.max(1, Math.floor(limitParsed))) : query.limit,
      cursor: parseDateTimeInputToIso(cursorInput),
    });
  }

  function resetFilters() {
    pushQuery({
      tenantId: null,
      action: null,
      resourceType: null,
      actorUserId: null,
      from: null,
      to: null,
      limit: 50,
      cursor: null,
    });
  }

  async function copyText(value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("Copied");
      setTimeout(() => setCopyState(null), 1200);
    } catch {
      setCopyState("Copy failed");
      setTimeout(() => setCopyState(null), 1200);
    }
  }

  function useNextCursor() {
    if (!payload?.nextCursor) return;
    pushQuery({
      ...query,
      cursor: payload.nextCursor,
    });
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{props.mode === "platform" ? "PLATFORM AUDIT" : "TENANT AUDIT"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Notification Admin Audit
            </h1>
            <p className="fdGlassText">Read-only audit trail explorer. No write operations are exposed in this page.</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href={props.mode === "platform" ? "/platform-admin" : "/manager"}>
                Back
              </Link>
              <button type="button" className="fdPillBtn" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>
                Refresh
              </button>
            </div>
          </div>
        </section>
        <NotificationGovernanceNav mode={props.mode} />

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Filters</h2>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            {props.mode === "platform" ? (
              <input
                className="input"
                value={tenantIdInput}
                onChange={(event) => setTenantIdInput(event.target.value)}
                placeholder="tenantId (optional)"
              />
            ) : (
              <input className="input" value="Tenant scope enforced by API guard" readOnly />
            )}
            <select className="input" value={actionInput} onChange={(event) => setActionInput(event.target.value)}>
              <option value="">action: all</option>
              {NOTIFICATION_AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
            <input
              className="input"
              value={resourceTypeInput}
              onChange={(event) => setResourceTypeInput(event.target.value)}
              placeholder="resourceType"
            />
          </div>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input
              className="input"
              value={actorInput}
              onChange={(event) => setActorInput(event.target.value)}
              placeholder="actorUserId"
            />
            <input
              type="datetime-local"
              className="input"
              value={fromInput}
              onChange={(event) => setFromInput(event.target.value)}
              placeholder="from"
            />
            <input
              type="datetime-local"
              className="input"
              value={toInput}
              onChange={(event) => setToInput(event.target.value)}
              placeholder="to"
            />
          </div>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input
              className="input"
              value={limitInput}
              onChange={(event) => setLimitInput(event.target.value)}
              placeholder="limit"
            />
            <input
              type="datetime-local"
              className="input"
              value={cursorInput}
              onChange={(event) => setCursorInput(event.target.value)}
              placeholder="cursor"
            />
            <div className="actions" style={{ marginTop: 0 }}>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={applyFilters}>
                Apply
              </button>
              <button type="button" className="fdPillBtn" onClick={resetFilters}>
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

        {loading ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading audit records...</p>
          </section>
        ) : null}

        {!loading && payload && payload.items.length === 0 ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">No audit rows matched current filters.</p>
          </section>
        ) : null}

        {!loading && payload && payload.items.length > 0 ? (
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Records</h2>
            <p className="sub" style={{ marginTop: 0 }}>
              Scope: {payload.scope} | Rows: {payload.items.length} | Next cursor: {payload.nextCursor || "-"}
            </p>
            <div className="actions" style={{ marginTop: 8 }}>
              <span className="fdPillBtn">{payload.items.length > 0 ? "data: loaded" : "data: empty"}</span>
              <span className="fdPillBtn">{payload.nextCursor ? "cursor: available" : "cursor: end"}</span>
              <button type="button" className="fdPillBtn" onClick={useNextCursor} disabled={!payload.nextCursor}>
                Next page via cursor
              </button>
              {copyState ? <span className="fdPillBtn">{copyState}</span> : null}
            </div>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {payload.items.map((item) => (
                <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                  <p className="sub" style={{ marginTop: 0 }}>
                    <strong>
                      <span
                        className="fdPillBtn"
                        style={getNotificationGovernanceToneStyle(resolveNotificationGovernanceTone(item.action.includes("retry") ? "warning" : "healthy"))}
                      >
                        {formatStatusLabel(item.action)}
                      </span>
                    </strong>{" "}
                    | {item.resourceType}:{truncateDisplayValue(item.resourceId || "-", 36)}
                  </p>
                  <p className="sub" style={{ marginTop: 0 }}>
                    actor: {truncateDisplayValue(item.actor.userId || "-", 36)} ({item.actor.role || "-"}) | tenant:{" "}
                    {truncateDisplayValue(item.tenantId || "-", 36)} | scope: {item.scope}
                  </p>
                  <p className="sub" style={{ marginTop: 0 }}>created: {formatDateTime(item.createdAt)}</p>
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button type="button" className="fdPillBtn" onClick={() => void copyText(item.id)}>
                      Copy row id
                    </button>
                    {item.resourceId ? (
                      <button type="button" className="fdPillBtn" onClick={() => void copyText(item.resourceId || "")}>
                        Copy resource id
                      </button>
                    ) : null}
                    {item.actor.userId ? (
                      <button type="button" className="fdPillBtn" onClick={() => void copyText(item.actor.userId || "")}>
                        Copy actor id
                      </button>
                    ) : null}
                  </div>
                  <details style={{ marginTop: 8 }}>
                    <summary className="sub" style={{ cursor: "pointer" }}>
                      metadata summary
                    </summary>
                    <p className="sub" style={{ marginTop: 6 }}>
                      {summarizeMetadataObject(item.metadataSummary)}
                    </p>
                    <pre className="sub" style={{ marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {JSON.stringify(item.metadataSummary, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
