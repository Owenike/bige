"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  buildNotificationRuntimeReadinessUiSearchParams,
  fetchNotificationRuntimeReadinessUiData,
  parseNotificationRuntimeReadinessUiQuery,
  type NotificationGovernanceMode,
  type NotificationRuntimeReadinessApiPayload,
  type NotificationRuntimeReadinessQuery,
} from "../lib/notification-governance-read-ui";
import { NOTIFICATION_CHANNEL_KEYS, NOTIFICATION_EVENT_KEYS, NOTIFICATION_ROLE_KEYS } from "../lib/notification-productization";
import {
  buildRuntimeReadinessViewModel,
  formatDeliveryPlanningSkeletonPreview,
  formatPreferenceTraceLine,
  formatRuntimeTemplateFallbackLine,
  formatStatusLabel,
  getNotificationGovernanceToneStyle,
  summarizeMetadataObject,
  truncateDisplayValue,
} from "../lib/notification-governance-view-model";
import NotificationGovernanceNav from "./notification-governance-nav";

const RUNTIME_READINESS_SCENARIOS = [
  { value: "", label: "live data" },
  { value: "complete_tenant_ready", label: "fixture: complete tenant" },
  { value: "missing_template_tenant", label: "fixture: missing template" },
  { value: "missing_preference_tenant", label: "fixture: missing preference" },
  { value: "user_override_disabled", label: "fixture: user override disabled" },
  { value: "role_fallback_tenant_default", label: "fixture: role fallback" },
  { value: "skipped_disabled_scenario", label: "fixture: skipped/disabled" },
];

type NotificationRuntimeReadinessDashboardProps = {
  mode: NotificationGovernanceMode;
};

export default function NotificationRuntimeReadinessDashboard(props: NotificationRuntimeReadinessDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseNotificationRuntimeReadinessUiQuery(searchParams, props.mode), [searchParams, props.mode]);

  const [tenantInput, setTenantInput] = useState(query.tenantId || "");
  const [eventInput, setEventInput] = useState(query.eventKey);
  const [roleInput, setRoleInput] = useState(query.roleKey || "");
  const [userInput, setUserInput] = useState(query.userId || "");
  const [channelInput, setChannelInput] = useState(query.channelHint || "");
  const [localeInput, setLocaleInput] = useState(query.locale || "zh-TW");
  const [defaultLocaleInput, setDefaultLocaleInput] = useState(query.defaultLocale || "zh-TW");
  const [recipientLimitInput, setRecipientLimitInput] = useState(String(query.recipientLimit));
  const [scenarioInput, setScenarioInput] = useState(query.scenarioId || "");
  const [payload, setPayload] = useState<NotificationRuntimeReadinessApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setTenantInput(query.tenantId || "");
    setEventInput(query.eventKey);
    setRoleInput(query.roleKey || "");
    setUserInput(query.userId || "");
    setChannelInput(query.channelHint || "");
    setLocaleInput(query.locale || "zh-TW");
    setDefaultLocaleInput(query.defaultLocale || "zh-TW");
    setRecipientLimitInput(String(query.recipientLimit));
    setScenarioInput(query.scenarioId || "");
  }, [query]);

  useEffect(() => {
    if (props.mode === "platform" && !query.tenantId && !query.scenarioId) {
      setPayload(null);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    void fetchNotificationRuntimeReadinessUiData(props.mode, query).then((result) => {
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

  function pushQuery(next: NotificationRuntimeReadinessQuery) {
    const params = buildNotificationRuntimeReadinessUiSearchParams(next, props.mode);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname);
  }

  function applyFilters() {
    const parsed = Number(recipientLimitInput);
    pushQuery({
      tenantId: props.mode === "platform" ? tenantInput.trim() || null : null,
      eventKey: eventInput,
      roleKey: roleInput.trim() || null,
      userId: userInput.trim() || null,
      channelHint: channelInput.trim() || null,
      locale: localeInput.trim() || "zh-TW",
      defaultLocale: defaultLocaleInput.trim() || "zh-TW",
      recipientLimit: Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.floor(parsed))) : query.recipientLimit,
      scenarioId: scenarioInput.trim() || null,
    });
  }

  function resetFilters() {
    pushQuery({
      tenantId: null,
      eventKey: "opportunity_due",
      roleKey: null,
      userId: null,
      channelHint: null,
      locale: "zh-TW",
      defaultLocale: "zh-TW",
      recipientLimit: 20,
      scenarioId: null,
    });
  }

  const viewModel = useMemo(() => (payload ? buildRuntimeReadinessViewModel(payload) : null), [payload]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{props.mode === "platform" ? "PLATFORM READINESS" : "TENANT READINESS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Notification Runtime Readiness
            </h1>
            <p className="fdGlassText">Read-only readiness report. This page never sends notifications.</p>
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
                placeholder="tenantId (required for live mode)"
              />
            ) : (
              <input className="input" value="Tenant scope enforced by API guard" readOnly />
            )}
            <select className="input" value={eventInput} onChange={(event) => setEventInput(event.target.value as typeof eventInput)}>
              {NOTIFICATION_EVENT_KEYS.map((eventKey) => (
                <option key={eventKey} value={eventKey}>
                  {eventKey}
                </option>
              ))}
            </select>
            <select className="input" value={roleInput} onChange={(event) => setRoleInput(event.target.value)}>
              <option value="">role: none</option>
              {NOTIFICATION_ROLE_KEYS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input className="input" value={userInput} onChange={(event) => setUserInput(event.target.value)} placeholder="userId (optional)" />
            <select className="input" value={channelInput} onChange={(event) => setChannelInput(event.target.value)}>
              <option value="">channel hint: auto</option>
              {NOTIFICATION_CHANNEL_KEYS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
            <input
              className="input"
              value={recipientLimitInput}
              onChange={(event) => setRecipientLimitInput(event.target.value)}
              placeholder="recipientLimit"
            />
          </div>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input className="input" value={localeInput} onChange={(event) => setLocaleInput(event.target.value)} placeholder="locale" />
            <input
              className="input"
              value={defaultLocaleInput}
              onChange={(event) => setDefaultLocaleInput(event.target.value)}
              placeholder="defaultLocale"
            />
            <select className="input" value={scenarioInput} onChange={(event) => setScenarioInput(event.target.value)}>
              {RUNTIME_READINESS_SCENARIOS.map((item) => (
                <option key={item.value || "live"} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={applyFilters}>
              Apply
            </button>
            <button type="button" className="fdPillBtn" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </section>

        {props.mode === "platform" && !query.tenantId && !query.scenarioId ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Set tenantId for live readiness report, or choose a fixture scenario.</p>
          </section>
        ) : null}

        {error ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <div className="error">{error}</div>
          </section>
        ) : null}

        {loading ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText">Loading runtime readiness...</p>
          </section>
        ) : null}

        {!loading && payload && viewModel ? (
          <>
            <section className="fdInventorySummary" style={{ marginBottom: 14 }}>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Readiness</div>
                <strong className="fdInventorySummaryValue">
                  <span className="fdPillBtn" style={getNotificationGovernanceToneStyle(viewModel.tone)}>
                    {viewModel.ready ? "ready" : "not ready"}
                  </span>
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Source</div>
                <strong className="fdInventorySummaryValue">
                  {viewModel.source}
                  {viewModel.scenarioId ? ` (${viewModel.scenarioId})` : ""}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Missing</div>
                <strong className="fdInventorySummaryValue">{viewModel.missingCount}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Fallbacks</div>
                <strong className="fdInventorySummaryValue">{viewModel.fallbackCount}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Warnings</div>
                <strong className="fdInventorySummaryValue">{viewModel.warningCount}</strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Skipped</div>
                <strong className="fdInventorySummaryValue">{viewModel.skippedCount}</strong>
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">Preference Resolution</h2>
              <p className="sub" style={{ marginTop: 0 }}>
                enabled: {String(payload.report.preference.enabled)} | source: {payload.report.preference.source}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                explain: {truncateDisplayValue(payload.report.preference.explain, 200)}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                channels:{" "}
                {Object.entries(payload.report.preference.channels)
                  .filter(([, enabled]) => enabled)
                  .map(([channel]) => channel)
                  .join(", ") || "none"}
              </p>
              <details style={{ marginTop: 8 }}>
                <summary className="sub" style={{ cursor: "pointer" }}>Preference trace</summary>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.report.preference.trace.map((item) => (
                    <p key={`${item.source}:${item.reason}`} className="sub" style={{ marginTop: 0 }}>
                      {formatPreferenceTraceLine(item)}
                    </p>
                  ))}
                  {payload.report.preference.trace.length === 0 ? (
                    <p className="fdGlassText">No preference trace rows.</p>
                  ) : null}
                </div>
              </details>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
              <h2 className="sectionTitle">Template Resolution</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {payload.report.templates.map((item) => (
                  <div key={item.channel} className="fdGlassSubPanel" style={{ padding: 10 }}>
                    <p className="sub" style={{ marginTop: 0 }}>
                      <strong>{item.channel}</strong> | found: {String(item.found)} | source: {item.source}
                    </p>
                    <p className="sub" style={{ marginTop: 0 }}>
                      {formatRuntimeTemplateFallbackLine({
                        channel: item.channel,
                        strategy: item.strategy,
                        fallbackReason: item.fallbackReason,
                        missingReason: item.missingReason,
                      })}
                    </p>
                    <p className="sub" style={{ marginTop: 0 }}>
                      template: {truncateDisplayValue(item.template?.id || "-", 44)} | locale: {item.template?.locale || "-"} |
                      priority: {item.template?.priority || "-"}
                    </p>
                  </div>
                ))}
                {payload.report.templates.length === 0 ? <p className="fdGlassText">No template resolution rows.</p> : null}
              </div>
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Delivery Planning Draft</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  ready: {String(payload.report.deliveryPlanning.ready)} | planned channels:{" "}
                  {payload.report.deliveryPlanning.plannedChannels.join(", ") || "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  planned recipients: {payload.report.deliveryPlanning.plannedRecipients.length}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.report.deliveryPlanning.plannedRecipients.map((item) => (
                    <p key={item.userId} className="sub" style={{ marginTop: 0 }}>
                      {truncateDisplayValue(item.userId, 44)} ({item.role || "-"}) {"->"} {item.plannedChannels.join(", ") || "-"}
                    </p>
                  ))}
                  {payload.report.deliveryPlanning.plannedRecipients.length === 0 ? (
                    <p className="fdGlassText">No planned recipients.</p>
                  ) : null}
                </div>
                <details style={{ marginTop: 8 }}>
                  <summary className="sub" style={{ cursor: "pointer" }}>
                    Content skeleton ({formatDeliveryPlanningSkeletonPreview(payload.report.deliveryPlanning.plannedContentSkeleton)})
                  </summary>
                  <pre className="sub" style={{ marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {JSON.stringify(payload.report.deliveryPlanning.plannedContentSkeleton, null, 2)}
                  </pre>
                </details>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Readiness Summary</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  missing preferences: {payload.report.readiness.missingPreferences.length}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  missing templates: {payload.report.readiness.missingTemplates.length}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  unavailable channels: {payload.report.readiness.unavailableChannels.length}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  fallbacks: {payload.report.readiness.fallbacks.length}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.report.deliveryPlanning.skippedReasons.map((item) => (
                    <p key={`${item.code}:${item.message}`} className="sub" style={{ marginTop: 0 }}>
                      skipped {formatStatusLabel(item.code)}: {item.message}
                    </p>
                  ))}
                  {payload.report.deliveryPlanning.skippedReasons.length === 0 ? (
                    <p className="fdGlassText">No skipped reasons.</p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="fdTwoCol">
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Missing / Unavailable</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.report.readiness.missingPreferences.map((item) => (
                    <p key={`${item.roleKey}:${item.reason}`} className="sub" style={{ marginTop: 0 }}>
                      missing preference: role={item.roleKey || "-"} event={item.eventKey} | {item.reason}
                    </p>
                  ))}
                  {payload.report.readiness.missingTemplates.map((item) => (
                    <p key={`${item.channel}:${item.reason}`} className="sub" style={{ marginTop: 0 }}>
                      missing template: {item.channel} | {item.reason}
                    </p>
                  ))}
                  {payload.report.readiness.unavailableChannels.map((item) => (
                    <p key={`${item.channel}:${item.reason}`} className="sub" style={{ marginTop: 0 }}>
                      unavailable channel: {item.channel} | {item.reason}
                    </p>
                  ))}
                  {payload.report.readiness.missingPreferences.length === 0 &&
                  payload.report.readiness.missingTemplates.length === 0 &&
                  payload.report.readiness.unavailableChannels.length === 0 ? (
                    <p className="fdGlassText">No missing or unavailable items.</p>
                  ) : null}
                </div>
              </section>
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">Fallbacks / Warnings</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.report.readiness.fallbacks.map((item) => (
                    <p key={`${item.channel}:${item.strategy}`} className="sub" style={{ marginTop: 0 }}>
                      fallback {item.channel}: {formatStatusLabel(item.strategy)} ({item.reason})
                    </p>
                  ))}
                  {payload.report.readiness.fallbacks.length === 0 ? <p className="fdGlassText">No fallbacks.</p> : null}
                </div>
                <details style={{ marginTop: 8 }}>
                  <summary className="sub" style={{ cursor: "pointer" }}>Warnings ({payload.report.warnings.length})</summary>
                  <div className="fdDataGrid" style={{ marginTop: 8 }}>
                    {payload.report.warnings.map((warning, index) => (
                      <p key={`${warning.code}:${index}`} className="sub" style={{ marginTop: 0 }}>
                        {formatStatusLabel(warning.code)}: {truncateDisplayValue(warning.message, 180)}
                      </p>
                    ))}
                    {payload.report.warnings.length === 0 ? <p className="fdGlassText">No warnings.</p> : null}
                  </div>
                </details>
                <p className="sub" style={{ marginTop: 8 }}>
                  event input: {summarizeMetadataObject(payload.report.eventInput, 180)}
                </p>
              </section>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
