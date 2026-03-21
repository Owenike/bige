"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_PRIORITY_KEYS,
  fetchApiJson,
  normalizeTemplatePayload,
  parseJsonObjectText,
  type NotificationChannelKey,
  type NotificationEventKey,
  type NotificationPriorityKey,
  type NotificationTemplateFormPayload,
  type NotificationTemplateRecord,
} from "../../../../lib/notification-productization-ui";
import ManagerNotificationsDomainNav from "../../../../components/manager-notifications-domain-nav";

type TemplatesResponse = {
  tenantId: string;
  includeGlobal: boolean;
  items: NotificationTemplateRecord[];
};

type ConfigIntegrityResponse = {
  scope: string;
  tenantId: string;
  integrity: {
    score: number;
    healthStatus: string;
    summary: {
      expectedRoleEventPairs: number;
      configuredRoleEventPairs: number;
      expectedTemplatePairs: number;
      coveredTemplatePairs: number;
      channelReadinessRate: number;
    };
    missingItems: {
      missingRoleEventPairs: Array<{ role: string; eventType: string }>;
      missingTemplatePairs: Array<{ eventType: string; channel: string }>;
      enabledChannelsWithoutTemplate: Array<{ channel: string; eventTypes: string[] }>;
    };
    warnings: string[];
  };
};

type Feedback = { type: "success" | "error"; message: string };

function toLocalTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function buildTenantTemplateKey(eventType: string, channel: string, locale: string) {
  return `tenant:<current>:${eventType}:${channel}:${locale}`;
}

export default function ManagerNotificationsTemplatesPage() {
  const [includeGlobal, setIncludeGlobal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [items, setItems] = useState<NotificationTemplateRecord[]>([]);
  const [integrity, setIntegrity] = useState<ConfigIntegrityResponse["integrity"] | null>(null);

  const [editingId, setEditingId] = useState("");
  const [eventType, setEventType] = useState<NotificationEventKey>(NOTIFICATION_EVENT_KEYS[0]);
  const [channel, setChannel] = useState<NotificationChannelKey>("in_app");
  const [locale, setLocale] = useState("zh-TW");
  const [priority, setPriority] = useState<NotificationPriorityKey>("info");
  const [titleTemplate, setTitleTemplate] = useState("");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [channelPolicyText, setChannelPolicyText] = useState("{}");
  const [isActive, setIsActive] = useState(true);

  const previewTemplateKey = useMemo(
    () => buildTenantTemplateKey(eventType, channel, locale.trim() || "zh-TW"),
    [eventType, channel, locale],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialIncludeGlobal = params.get("includeGlobal");
    if (initialIncludeGlobal === "false") setIncludeGlobal(false);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("includeGlobal", includeGlobal ? "true" : "false");
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [includeGlobal]);

  function resetForm() {
    setEditingId("");
    setEventType(NOTIFICATION_EVENT_KEYS[0]);
    setChannel("in_app");
    setLocale("zh-TW");
    setPriority("info");
    setTitleTemplate("");
    setMessageTemplate("");
    setEmailSubject("");
    setActionUrl("");
    setChannelPolicyText("{}");
    setIsActive(true);
  }

  async function load() {
    setLoading(true);
    setFeedback(null);
    const query = new URLSearchParams();
    query.set("includeGlobal", includeGlobal ? "true" : "false");
    query.set("activeOnly", "false");
    const [templatesResult, integrityResult] = await Promise.all([
      fetchApiJson<TemplatesResponse>(`/api/manager/notifications/templates?${query.toString()}`),
      fetchApiJson<ConfigIntegrityResponse>("/api/manager/notifications/config-integrity"),
    ]);

    if (!templatesResult.ok) {
      setFeedback({ type: "error", message: templatesResult.message });
      setLoading(false);
      setHasLoaded(true);
      return;
    }

    setItems(templatesResult.data.items || []);
    if (integrityResult.ok) {
      setIntegrity(integrityResult.data.integrity);
    } else {
      setIntegrity(null);
    }
    setLoading(false);
    setHasLoaded(true);
  }

  function applyItem(item: NotificationTemplateRecord) {
    setEditingId(item.id);
    setEventType(item.event_type as NotificationEventKey);
    setChannel(item.channel as NotificationChannelKey);
    setLocale(item.locale || "zh-TW");
    setPriority(item.priority as NotificationPriorityKey);
    setTitleTemplate(item.title_template || "");
    setMessageTemplate(item.message_template || "");
    setEmailSubject(item.email_subject || "");
    setActionUrl(item.action_url || "");
    setChannelPolicyText(JSON.stringify(item.channel_policy || {}, null, 2));
    setIsActive(item.is_active !== false);
    setFeedback({ type: "success", message: "Template loaded into form." });
  }

  async function save() {
    if (!titleTemplate.trim() || !messageTemplate.trim()) {
      setFeedback({ type: "error", message: "title and message are required." });
      return;
    }

    let parsedPolicy: Record<string, unknown>;
    try {
      parsedPolicy = parseJsonObjectText(channelPolicyText, "channel_policy");
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Invalid channel policy JSON." });
      return;
    }

    setSaving(true);
    setFeedback(null);

    const payload: NotificationTemplateFormPayload = normalizeTemplatePayload({
      id: editingId || undefined,
      eventType,
      channel,
      locale,
      titleTemplate,
      messageTemplate,
      emailSubject,
      actionUrl,
      priority,
      channelPolicy: parsedPolicy,
      isActive,
    });

    const result = await fetchApiJson<{ item: NotificationTemplateRecord }>("/api/manager/notifications/templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      setFeedback({ type: "error", message: result.message });
      setSaving(false);
      return;
    }

    await load();
    resetForm();
    setFeedback({ type: "success", message: editingId ? "Template updated successfully." : "Template created successfully." });
    setSaving(false);
  }

  return (
    <main className="fdGlassScene" data-notifications-templates-page>
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">NOTIFICATION PRODUCTIZATION</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 32 }}>Manager Notification Templates</h1>
            <p className="fdGlassText">
              This page owns event / channel template coverage and minimal tenant-scope template editing. It does not
              manage credentials, retries, runtime readiness, or global operations settings.
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/manager">Back</Link>
              <Link className="fdPillBtn" href="/manager/notifications">Notifications</Link>
              <Link className="fdPillBtn" href="/manager/notifications-config-integrity">Config Integrity</Link>
              <button
                type="button"
                className="fdPillBtn"
                data-notifications-templates-load
                disabled={loading}
                onClick={() => void load()}
              >
                {loading ? "Loading..." : "Load Templates"}
              </button>
            </div>
          </div>
        </section>

        <ManagerNotificationsDomainNav />

        {feedback?.type === "error" ? <div className="error" style={{ marginBottom: 12 }} data-notifications-templates-error>{feedback.message}</div> : null}
        {feedback?.type === "success" ? <div className="ok" style={{ marginBottom: 12 }} data-notifications-templates-message>{feedback.message}</div> : null}

        <section className="fdInventorySummary" style={{ marginBottom: 14 }} data-notifications-templates-summary>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Templates</div>
            <strong className="fdInventorySummaryValue" data-notifications-templates-count>{items.length}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Template Coverage</div>
            <strong className="fdInventorySummaryValue" data-notifications-templates-coverage>
              {integrity ? `${integrity.summary.coveredTemplatePairs}/${integrity.summary.expectedTemplatePairs}` : "-"}
            </strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Missing Template Pairs</div>
            <strong className="fdInventorySummaryValue" data-notifications-templates-missing-count>
              {integrity ? integrity.missingItems.missingTemplatePairs.length : "-"}
            </strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Enabled Without Template</div>
            <strong className="fdInventorySummaryValue" data-notifications-templates-enabled-gap-count>
              {integrity ? integrity.missingItems.enabledChannelsWithoutTemplate.length : "-"}
            </strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Integrity Health</div>
            <strong className="fdInventorySummaryValue" data-notifications-templates-health>
              {integrity ? integrity.healthStatus : "-"}
            </strong>
          </div>
        </section>

        <section className="fdTwoCol" style={{ marginBottom: 14 }}>
          <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-templates-missing-pairs>
            <h2 className="sectionTitle">Missing Event / Channel Template Pairs</h2>
            <p className="sub">Coverage gaps pulled from notification config integrity.</p>
            {integrity?.missingItems.missingTemplatePairs.length ? (
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {integrity.missingItems.missingTemplatePairs.slice(0, 24).map((item) => (
                  <p key={`${item.eventType}:${item.channel}`} className="sub" style={{ marginTop: 0 }}>
                    {item.eventType} / {item.channel}
                  </p>
                ))}
              </div>
            ) : (
              <p className="fdGlassText">No missing event/channel template gaps in the current dataset.</p>
            )}
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-templates-impact>
            <h2 className="sectionTitle">Coverage Impact</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                Expected template pairs: {integrity?.summary.expectedTemplatePairs ?? "-"}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Covered template pairs: {integrity?.summary.coveredTemplatePairs ?? "-"}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Enabled channels without template: {integrity?.missingItems.enabledChannelsWithoutTemplate.length ?? "-"}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Warnings: {integrity?.warnings.length ?? "-"}
              </p>
            </div>
          </section>
        </section>

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-templates-form>
            <h2 className="sectionTitle">Template Form</h2>
            <p className="sub">Tenant scope is auto-applied. Required: event key, channel, title, message.</p>

            <div className="fdDataGrid" style={{ marginTop: 10 }}>
              <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  data-notifications-templates-include-global
                  type="checkbox"
                  checked={includeGlobal}
                  onChange={(event) => setIncludeGlobal(event.target.checked)}
                />
                include global templates when loading
              </label>

              <label className="sub">
                template_key
                <input className="input" data-notifications-templates-key value={previewTemplateKey} readOnly />
              </label>

              <label className="sub">
                event_key *
                <select
                  className="input"
                  data-notifications-templates-event
                  value={eventType}
                  onChange={(event) => setEventType(event.target.value as NotificationEventKey)}
                >
                  {NOTIFICATION_EVENT_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>

              <label className="sub">
                channel *
                <select
                  className="input"
                  data-notifications-templates-channel
                  value={channel}
                  onChange={(event) => setChannel(event.target.value as NotificationChannelKey)}
                >
                  {NOTIFICATION_CHANNEL_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>

              <label className="sub">
                locale
                <input className="input" data-notifications-templates-locale value={locale} onChange={(event) => setLocale(event.target.value)} />
              </label>

              <label className="sub">
                priority
                <select
                  className="input"
                  data-notifications-templates-priority
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as NotificationPriorityKey)}
                >
                  {NOTIFICATION_PRIORITY_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>

              <label className="sub">
                title *
                <input className="input" data-notifications-templates-title value={titleTemplate} onChange={(event) => setTitleTemplate(event.target.value)} />
              </label>

              <label className="sub">
                message *
                <textarea className="input" data-notifications-templates-message-input value={messageTemplate} onChange={(event) => setMessageTemplate(event.target.value)} />
              </label>

              <label className="sub">
                email_subject
                <input className="input" data-notifications-templates-email-subject value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} />
              </label>

              <label className="sub">
                action_url
                <input className="input" data-notifications-templates-action-url value={actionUrl} onChange={(event) => setActionUrl(event.target.value)} placeholder="/manager/..." />
              </label>

              <label className="sub">
                channel_policy JSON
                <textarea className="input" data-notifications-templates-policy value={channelPolicyText} onChange={(event) => setChannelPolicyText(event.target.value)} />
              </label>

              <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  data-notifications-templates-enabled
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                />
                template enabled
              </label>

              <div className="actions">
                <button
                  type="button"
                  className="fdPillBtn fdPillBtnPrimary"
                  data-notifications-templates-save
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? "Saving..." : editingId ? "Update Template" : "Create Template"}
                </button>
                <button type="button" className="fdPillBtn" data-notifications-templates-reset onClick={resetForm}>
                  Cancel / Reset Form
                </button>
              </div>
            </div>
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-templates-preview>
            <h2 className="sectionTitle">Preview</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}><b>title:</b> {titleTemplate || "-"}</p>
              <p className="sub" style={{ marginTop: 0 }}><b>message:</b> {messageTemplate || "-"}</p>
              <p className="sub" style={{ marginTop: 0 }}><b>email_subject:</b> {emailSubject || "-"}</p>
              <p className="sub" style={{ marginTop: 0 }}><b>action_url:</b> {actionUrl || "-"}</p>
            </div>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-notifications-templates-table-wrap>
          <h2 className="sectionTitle">Template List</h2>
          {!hasLoaded ? <p className="sub">Load templates to view list.</p> : null}
          {loading ? <p className="sub">Loading...</p> : null}
          {hasLoaded && !loading && items.length === 0 ? <p className="sub">No templates found.</p> : null}
          {hasLoaded && !loading && items.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table className="table" data-notifications-templates-table>
                <thead>
                  <tr>
                    <th>event</th>
                    <th>channel</th>
                    <th>locale</th>
                    <th>priority</th>
                    <th>updated</th>
                    <th>active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.event_type}</td>
                      <td>{item.channel}</td>
                      <td>{item.locale}</td>
                      <td>{item.priority}</td>
                      <td>{toLocalTime(item.updated_at)}</td>
                      <td>{String(item.is_active)}</td>
                      <td>
                        <button
                          type="button"
                          className="fdPillBtn"
                          data-template-edit-id={item.id}
                          onClick={() => applyItem(item)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-notifications-templates-boundaries>
          <h2 className="sectionTitle">Responsibility boundaries</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            <p className="sub" style={{ marginTop: 0 }}>
              This page owns event / channel template coverage and minimal template master data within current tenant scope.
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              Config integrity summary stays in `/manager/notifications-config-integrity`. Readiness stays in `/manager/notifications/readiness`.
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              Preferences stay in `/manager/notifications-preferences`. Retry, remediation, audit, and operations remain outside this page.
            </p>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-notifications-templates-out-of-scope>
          <h2 className="sectionTitle">Out of scope</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            <p className="sub" style={{ marginTop: 0 }}>
              No provider credential editor, OAuth flow, webhook platform, or auth / activation work.
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              No retry workbench, audit history explorer, readiness runtime control, integrations catalog, or global operations settings.
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              No frontdesk booking, scheduling, services, plans, packages, or other master-data maintenance.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
