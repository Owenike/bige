"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  buildNotificationPreflightUiSearchParams,
  fetchNotificationPreflightUiData,
  parseNotificationPreflightUiQuery,
  type NotificationGovernanceMode,
  type NotificationPreflightApiPayload,
  type NotificationPreflightQuery,
} from "../lib/notification-governance-read-ui";
import { NOTIFICATION_CHANNEL_KEYS, NOTIFICATION_EVENT_KEYS, NOTIFICATION_ROLE_KEYS } from "../lib/notification-productization";
import {
  buildPreflightViewModel,
  formatPreflightSkippedReason,
  formatPreflightTemplateResolution,
  formatPreferenceTraceLine,
  formatStatusLabel,
  getNotificationGovernanceToneStyle,
  summarizeMetadataObject,
  truncateDisplayValue,
} from "../lib/notification-governance-view-model";
import NotificationGovernanceNav from "./notification-governance-nav";

type NotificationPreflightDashboardProps = {
  mode: NotificationGovernanceMode;
};

function formatChannels(channels: Record<string, boolean>) {
  return Object.entries(channels)
    .filter(([, enabled]) => enabled)
    .map(([channel]) => channel)
    .join(", ");
}

export default function NotificationPreflightDashboard(props: NotificationPreflightDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseNotificationPreflightUiQuery(searchParams, props.mode), [searchParams, props.mode]);

  const [tenantInput, setTenantInput] = useState(query.tenantId || "");
  const [eventInput, setEventInput] = useState(query.eventKey);
  const [roleInput, setRoleInput] = useState(query.roleKey || "");
  const [userInput, setUserInput] = useState(query.userId || "");
  const [channelInput, setChannelInput] = useState(query.channelHint || "");
  const [localeInput, setLocaleInput] = useState(query.locale || "zh-TW");
  const [defaultLocaleInput, setDefaultLocaleInput] = useState(query.defaultLocale || "zh-TW");
  const [recipientLimitInput, setRecipientLimitInput] = useState(String(query.recipientLimit));
  const [payload, setPayload] = useState<NotificationPreflightApiPayload | null>(null);
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
  }, [query]);

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
    void fetchNotificationPreflightUiData(props.mode, query).then((result) => {
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

  function pushQuery(next: NotificationPreflightQuery) {
    const params = buildNotificationPreflightUiSearchParams(next, props.mode);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname);
  }

  function applyFilters() {
    const limitParsed = Number(recipientLimitInput);
    pushQuery({
      tenantId: props.mode === "platform" ? tenantInput.trim() || null : null,
      eventKey: eventInput,
      roleKey: roleInput.trim() || null,
      userId: userInput.trim() || null,
      channelHint: channelInput.trim() || null,
      locale: localeInput.trim() || "zh-TW",
      defaultLocale: defaultLocaleInput.trim() || "zh-TW",
      recipientLimit: Number.isFinite(limitParsed) ? Math.min(100, Math.max(1, Math.floor(limitParsed))) : query.recipientLimit,
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
    });
  }

  const viewModel = useMemo(() => (payload ? buildPreflightViewModel(payload) : null), [payload]);
  const decisionSummary = useMemo(() => {
    if (!payload) {
      return {
        sendableCount: 0,
        blockedCount: 0,
        skippedCount: 0,
        degradedCount: 0,
      };
    }

    const sendableCount = payload.preflight.deliveryPlanning.ready
      ? payload.preflight.deliveryPlanning.plannedRecipientsCount
      : 0;
    const blockedCount =
      payload.preflight.coverage.missingForSelectedEvent.length +
      (payload.preflight.preference.enabled ? 0 : 1);
    const skippedCount = payload.preflight.deliveryPlanning.skippedReasons.length;
    const degradedCount = payload.preflight.templates.resolutions.filter(
      (item) => item.found && item.strategy !== "tenant_locale",
    ).length;

    return {
      sendableCount,
      blockedCount,
      skippedCount,
      degradedCount,
    };
  }, [payload]);

  return (
    <main className="fdGlassScene" data-notifications-preflight-page>
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{props.mode === "platform" ? "PLATFORM PREFLIGHT" : "TENANT PREFLIGHT"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Notification Runtime Preflight
            </h1>
            <p className="fdGlassText">
              Read-only sendability and resolution report. This page explains template / preference / readiness impact,
              but never dispatches notifications.
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href={props.mode === "platform" ? "/platform-admin" : "/manager"}>
                Back
              </Link>
              <button
                type="button"
                className="fdPillBtn"
                data-notifications-preflight-refresh
                onClick={() => setRefreshKey((value) => value + 1)}
                disabled={loading}
              >
                Refresh
              </button>
            </div>
          </div>
        </section>
        <NotificationGovernanceNav mode={props.mode} />

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-notifications-preflight-filters>
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
            <p className="fdGlassText">Set a tenantId to run preflight report.</p>
          </section>
        ) : null}

        {error ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <div className="error" data-notifications-preflight-error>{error}</div>
          </section>
        ) : null}

        {loading ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="fdGlassText" data-notifications-preflight-loading>Loading preflight report...</p>
          </section>
        ) : null}

        {!loading && payload && viewModel ? (
          <>
            <section className="fdInventorySummary" style={{ marginBottom: 14 }} data-notifications-preflight-summary>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Sendable</div>
                <strong className="fdInventorySummaryValue" data-notifications-preflight-sendable>
                  {decisionSummary.sendableCount}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Blocked</div>
                <strong className="fdInventorySummaryValue" data-notifications-preflight-blocked>
                  {decisionSummary.blockedCount}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Skipped</div>
                <strong className="fdInventorySummaryValue" data-notifications-preflight-skipped>
                  {decisionSummary.skippedCount}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Degraded</div>
                <strong className="fdInventorySummaryValue" data-notifications-preflight-degraded>
                  {decisionSummary.degradedCount}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Ready</div>
                <strong className="fdInventorySummaryValue" data-notifications-preflight-ready>
                  {String(payload.preflight.deliveryPlanning.ready)}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Selected Channels</div>
                <strong className="fdInventorySummaryValue" data-notifications-preflight-selected-channels>
                  {viewModel.selectedChannels.join(", ") || "-"}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Warnings</div>
                <strong className="fdInventorySummaryValue" data-notifications-preflight-warnings>
                  {viewModel.warningCount}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Fallback/Missing</div>
                <strong className="fdInventorySummaryValue" data-notifications-preflight-fallback-missing>
                  {
                    payload.preflight.templates.resolutions.filter((item) => item.found && item.strategy !== "tenant_locale").length
                  }
                  /
                  {payload.preflight.templates.resolutions.filter((item) => !item.found).length}
                </strong>
              </div>
              <div className="fdGlassSubPanel fdInventorySummaryItem">
                <div className="kvLabel">Coverage Status</div>
                <strong className="fdInventorySummaryValue" data-notifications-preflight-coverage-status>
                  <span className="fdPillBtn" style={getNotificationGovernanceToneStyle(viewModel.coverageTone)}>
                    {formatStatusLabel(payload.preflight.coverage.integrityHealthStatus)}
                  </span>
                </strong>
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-notifications-preflight-preference>
              <h2 className="sectionTitle">Preference Resolution</h2>
              <p className="sub" style={{ marginTop: 0 }}>
                source: {payload.preflight.preference.source} | enabled: {String(payload.preflight.preference.enabled)}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                reason: {payload.preflight.preference.reason} | explain: {truncateDisplayValue(payload.preflight.preference.explain, 180)}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                channels: {formatChannels(payload.preflight.preference.channels) || "none"}
              </p>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {payload.preflight.preference.trace.map((item) => (
                  <p key={`${item.source}:${item.reason}`} className="sub" style={{ marginTop: 0 }}>
                    {formatPreferenceTraceLine(item)}
                  </p>
                ))}
              </div>
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-preflight-template-resolution>
                <h2 className="sectionTitle">Template Resolution</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.preflight.templates.resolutions.map((item) => (
                    <p key={item.channel} className="sub" style={{ marginTop: 0 }}>
                      {formatPreflightTemplateResolution(item)} | template={truncateDisplayValue(item.templateId || "-", 36)} | locale=
                      {item.locale || "-"} | priority={item.priority || "-"}
                    </p>
                  ))}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-preflight-planning>
                <h2 className="sectionTitle">Delivery Planning Draft</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  ready: {String(payload.preflight.deliveryPlanning.ready)} | planned channels:{" "}
                  {payload.preflight.deliveryPlanning.plannedChannels.join(", ") || "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  recipients: {payload.preflight.deliveryPlanning.plannedRecipientsCount}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.preflight.deliveryPlanning.plannedRecipientsPreview.map((item) => (
                    <p key={item.userId} className="sub" style={{ marginTop: 0 }}>
                      {item.userId} ({item.role || "-"})
                    </p>
                  ))}
                  {payload.preflight.deliveryPlanning.plannedRecipientsPreview.length === 0 ? (
                    <p className="fdGlassText">No recipient preview rows.</p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="fdTwoCol" style={{ marginBottom: 14 }}>
              <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-preflight-missing-coverage>
                <h2 className="sectionTitle">Missing Coverage</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  integrity score: {payload.preflight.coverage.integrityScore} | status:{" "}
                  {payload.preflight.coverage.integrityHealthStatus}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  missing role/event pairs: {payload.preflight.coverage.missingRoleEventPairs}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  missing template pairs: {payload.preflight.coverage.missingTemplatePairs}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  enabled channels without template: {payload.preflight.coverage.enabledChannelsWithoutTemplate}
                </p>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.preflight.coverage.missingForSelectedEvent.map((item) => (
                    <p key={`${item.channel}:${item.reason}`} className="sub" style={{ marginTop: 0 }}>
                      {item.channel}: {item.reason}
                    </p>
                  ))}
                  {payload.preflight.coverage.missingForSelectedEvent.length === 0 ? (
                    <p className="fdGlassText">No missing channels for selected event.</p>
                  ) : null}
                </div>
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-preflight-skipped-warnings>
                <h2 className="sectionTitle">Skipped Reasons / Warnings</h2>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.preflight.deliveryPlanning.skippedReasons.map((item) => (
                    <p key={`${item.code}:${item.message}`} className="sub" style={{ marginTop: 0 }}>
                      {formatPreflightSkippedReason(item)}
                    </p>
                  ))}
                  {payload.preflight.deliveryPlanning.skippedReasons.length === 0 ? (
                    <p className="fdGlassText">No skipped reasons.</p>
                  ) : null}
                </div>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {payload.preflight.warnings.map((warning) => (
                    <p key={warning} className="sub" style={{ marginTop: 0 }}>
                      {truncateDisplayValue(warning, 180)}
                    </p>
                  ))}
                  {payload.preflight.warnings.length === 0 ? <p className="fdGlassText">No warnings.</p> : null}
                </div>
              </section>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-preflight-content-skeleton>
              <h2 className="sectionTitle">Content Skeleton</h2>
              <p className="sub" style={{ marginTop: 0 }}>
                {summarizeMetadataObject(payload.preflight.deliveryPlanning.contentSkeleton, 220)}
              </p>
              <details>
                <summary className="sub" style={{ cursor: "pointer" }}>Expand JSON</summary>
                <pre className="sub" style={{ marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {JSON.stringify(payload.preflight.deliveryPlanning.contentSkeleton, null, 2)}
                </pre>
              </details>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-notifications-preflight-boundaries>
              <h2 className="sectionTitle">Responsibility boundaries</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  This page owns pre-dispatch resolution, sendability, and blocked / skipped / degraded explanations.
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Preferences stay in `/manager/notifications-preferences`, templates stay in `/manager/notifications/templates`,
                  and readiness gaps stay in `/manager/notifications/readiness`.
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  Retry, audit, integrations, and operations remain outside this page. This page never dispatches notifications.
                </p>
              </div>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-notifications-preflight-out-of-scope>
              <h2 className="sectionTitle">Out of scope</h2>
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  No provider credential editor, OAuth flow, webhook platform, queue / worker control, or auth / activation work.
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  No retry execution, no audit history explorer, no readiness maintenance, and no template or preference editing on this page.
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  No frontdesk booking, scheduling, services, plans, packages, or other master-data maintenance.
                </p>
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
