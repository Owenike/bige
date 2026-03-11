"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  buildNotificationConfigIntegrityUiSearchParams,
  fetchNotificationConfigIntegrityUiData,
  parseNotificationConfigIntegrityUiQuery,
  type NotificationConfigIntegrityApiPayload,
  type NotificationConfigIntegrityQuery,
  type NotificationGovernanceMode,
} from "../lib/notification-governance-read-ui";
import {
  buildConfigIntegrityViewModel,
  formatStatusLabel,
  getNotificationGovernanceToneStyle,
  truncateDisplayValue,
} from "../lib/notification-governance-view-model";
import NotificationGovernanceNav from "./notification-governance-nav";

type NotificationConfigIntegrityDashboardProps = { mode: NotificationGovernanceMode };

export default function NotificationConfigIntegrityDashboard(props: NotificationConfigIntegrityDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(
    () => parseNotificationConfigIntegrityUiQuery(searchParams, props.mode),
    [searchParams, props.mode],
  );

  const [tenantInput, setTenantInput] = useState(query.tenantId || "");
  const [defaultLocaleInput, setDefaultLocaleInput] = useState(query.defaultLocale || "zh-TW");
  const [payload, setPayload] = useState<NotificationConfigIntegrityApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setTenantInput(query.tenantId || "");
    setDefaultLocaleInput(query.defaultLocale || "zh-TW");
  }, [query.defaultLocale, query.tenantId]);

  useEffect(() => {
    if (props.mode === "platform" && !query.tenantId) {
      setPayload(null);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    void fetchNotificationConfigIntegrityUiData(props.mode, query).then((result) => {
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

  function pushQuery(next: NotificationConfigIntegrityQuery) {
    const params = buildNotificationConfigIntegrityUiSearchParams(next, props.mode);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname);
  }

  function applyFilters() {
    pushQuery({
      tenantId: props.mode === "platform" ? tenantInput.trim() || null : null,
      defaultLocale: defaultLocaleInput.trim() || "zh-TW",
    });
  }

  function resetFilters() {
    pushQuery({
      tenantId: null,
      defaultLocale: "zh-TW",
    });
  }

  const viewModel = useMemo(() => (payload ? buildConfigIntegrityViewModel(payload) : null), [payload]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{props.mode === "platform" ? "PLATFORM INTEGRITY" : "TENANT INTEGRITY"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Notification Config Integrity
            </h1>
            <p className="fdGlassText">Read-only completeness report for preferences/templates/channel coverage.</p>
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
                value={tenantInput}
                onChange={(event) => setTenantInput(event.target.value)}
                placeholder="tenantId (required)"
              />
            ) : (
              <input className="input" value="Tenant scope enforced by API guard" readOnly />
            )}
            <input
              className="input"
              value={defaultLocaleInput}
              onChange={(event) => setDefaultLocaleInput(event.target.value)}
              placeholder="defaultLocale (zh-TW)"
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

        {props.mode === "platform" && !query.tenantId ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Set a tenantId to load integrity report.</p>
          </section>
        ) : null}

        {error ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <div className="error">{error}</div>
          </section>
        ) : null}

        {loading ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading config integrity...</p>
          </section>
        ) : null}

        {!loading && payload && viewModel ? (
          <>
            <section className="fdInventorySummary" style={{ marginBottom: 14 }}>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Tenant</div>
                <strong className="fdInventorySummaryValue">{payload.tenantId}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Health Score</div>
                <strong className="fdInventorySummaryValue">{viewModel.score}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Health Status</div>
                <strong className="fdInventorySummaryValue">
                  <span className="fdPillBtn" style={getNotificationGovernanceToneStyle(viewModel.tone)}>
                    {formatStatusLabel(viewModel.healthStatus)}
                  </span>
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Template Coverage</div>
                <strong className="fdInventorySummaryValue">
                  {payload.integrity.summary.coveredTemplatePairs}/{payload.integrity.summary.expectedTemplatePairs}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Template Completeness</div>
                <strong className="fdInventorySummaryValue">{viewModel.templateCompleteness}%</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Preference Completeness</div>
                <strong className="fdInventorySummaryValue">{viewModel.preferenceCompleteness}%</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Total Missing Items</div>
                <strong className="fdInventorySummaryValue">{viewModel.totalMissing}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Warnings</div>
                <strong className="fdInventorySummaryValue">{payload.integrity.warnings.length}</strong>
              </div>
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Missing Role/Event Preferences</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  Missing: {payload.integrity.missingItems.missingRoleEventPairs.length}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.integrity.missingItems.missingRoleEventPairs.slice(0, 100).map((item) => (
                    <p key={`${item.role}:${item.eventType}`} className="sub" style={{ marginTop: 0 }}>
                      {truncateDisplayValue(item.role, 20)} / {truncateDisplayValue(item.eventType, 40)}
                    </p>
                  ))}
                  {payload.integrity.missingItems.missingRoleEventPairs.length === 0 ? (
                    <p className="fdGlassText">No missing role/event preference pairs.</p>
                  ) : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Missing Event/Channel Templates</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  Missing: {payload.integrity.missingItems.missingTemplatePairs.length}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.integrity.missingItems.missingTemplatePairs.slice(0, 100).map((item) => (
                    <p key={`${item.eventType}:${item.channel}`} className="sub" style={{ marginTop: 0 }}>
                      {truncateDisplayValue(item.eventType, 40)} / {item.channel}
                    </p>
                  ))}
                  {payload.integrity.missingItems.missingTemplatePairs.length === 0 ? (
                    <p className="fdGlassText">No missing event/channel templates.</p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">Enabled Channels Without Template</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {payload.integrity.missingItems.enabledChannelsWithoutTemplate.map((item) => (
                  <p key={item.channel} className="sub" style={{ marginTop: 0 }}>
                    {item.channel}: {truncateDisplayValue(item.eventTypes.join(", "), 120)}
                  </p>
                ))}
                {payload.integrity.missingItems.enabledChannelsWithoutTemplate.length === 0 ? (
                  <p className="fdGlassText">No enabled-channel template gaps found.</p>
                ) : null}
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14 }}>
              <h2 className="sectionTitle">Warnings</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {payload.integrity.warnings.map((warning) => (
                  <p key={warning} className="sub" style={{ marginTop: 0 }}>
                    {truncateDisplayValue(warning, 180)}
                  </p>
                ))}
                {payload.integrity.warnings.length === 0 ? <p className="fdGlassText">No warnings.</p> : null}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
