"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  MANAGER_EDITABLE_ROLE_KEYS,
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  fetchApiJson,
  type NotificationChannelKey,
  type NotificationEventKey,
  type NotificationPreferenceFormPayload,
} from "../../../lib/notification-productization-ui";
import ManagerNotificationsDomainNav from "../../../components/manager-notifications-domain-nav";

type RolePreferenceItem = {
  id: string;
  role: string;
  event_type: string;
  is_enabled: boolean;
  channels: Record<string, boolean>;
  note: string | null;
  updated_at: string;
};

type UserPreferenceItem = {
  id: string;
  user_id: string;
  event_type: string;
  is_enabled: boolean;
  channels: Record<string, boolean>;
  note: string | null;
  updated_at: string;
};

type PreferencesResponse = {
  tenantId: string;
  rolePreferences: RolePreferenceItem[];
  userPreferences: UserPreferenceItem[];
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

function buildChannels(selectedChannel: NotificationChannelKey, enabled: boolean) {
  const channels: Record<NotificationChannelKey, boolean> = {
    in_app: true,
    email: false,
    line: false,
    sms: false,
    webhook: false,
  };
  channels[selectedChannel] = enabled;
  return channels;
}

function readChannelState(channels: Record<string, boolean> | null | undefined) {
  if (!channels) return { channel: "in_app" as NotificationChannelKey, enabled: true };
  for (const key of NOTIFICATION_CHANNEL_KEYS) {
    if (channels[key]) return { channel: key, enabled: true };
  }
  return { channel: "in_app" as NotificationChannelKey, enabled: true };
}

function toLocalTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ManagerNotificationsPreferencesPage() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [roleItems, setRoleItems] = useState<RolePreferenceItem[]>([]);
  const [userItems, setUserItems] = useState<UserPreferenceItem[]>([]);
  const [integrity, setIntegrity] = useState<ConfigIntegrityResponse["integrity"] | null>(null);
  const [activeTab, setActiveTab] = useState<"role" | "user">("role");

  const [eventType, setEventType] = useState<NotificationEventKey>(NOTIFICATION_EVENT_KEYS[0]);
  const [role, setRole] = useState<(typeof MANAGER_EDITABLE_ROLE_KEYS)[number]>("manager");
  const [userId, setUserId] = useState("");
  const [channel, setChannel] = useState<NotificationChannelKey>("in_app");
  const [channelEnabled, setChannelEnabled] = useState(true);
  const [ruleEnabled, setRuleEnabled] = useState(true);
  const [note, setNote] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (mode === "role" || mode === "user") setActiveTab(mode);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("mode", activeTab);
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [activeTab]);

  function resetForm() {
    setActiveTab("role");
    setEventType(NOTIFICATION_EVENT_KEYS[0]);
    setRole("manager");
    setUserId("");
    setChannel("in_app");
    setChannelEnabled(true);
    setRuleEnabled(true);
    setNote("");
  }

  async function load() {
    setLoading(true);
    setFeedback(null);
    const [result, integrityResult] = await Promise.all([
      fetchApiJson<PreferencesResponse>("/api/manager/notifications/preferences"),
      fetchApiJson<ConfigIntegrityResponse>("/api/manager/notifications/config-integrity"),
    ]);
    if (!result.ok) {
      setFeedback({ type: "error", message: result.message });
      setLoading(false);
      setHasLoaded(true);
      return;
    }
    setRoleItems(result.data.rolePreferences || []);
    setUserItems(result.data.userPreferences || []);
    if (integrityResult.ok) {
      setIntegrity(integrityResult.data.integrity);
    } else {
      setIntegrity(null);
    }
    setLoading(false);
    setHasLoaded(true);
  }

  function fillRoleForm(item: RolePreferenceItem) {
    setActiveTab("role");
    if (MANAGER_EDITABLE_ROLE_KEYS.includes(item.role as (typeof MANAGER_EDITABLE_ROLE_KEYS)[number])) {
      setRole(item.role as (typeof MANAGER_EDITABLE_ROLE_KEYS)[number]);
    }
    if (NOTIFICATION_EVENT_KEYS.includes(item.event_type as NotificationEventKey)) {
      setEventType(item.event_type as NotificationEventKey);
    }
    const channelState = readChannelState(item.channels);
    setChannel(channelState.channel);
    setChannelEnabled(channelState.enabled);
    setRuleEnabled(item.is_enabled);
    setNote(item.note || "");
    setFeedback({ type: "success", message: "Loaded role preference into form." });
  }

  function fillUserForm(item: UserPreferenceItem) {
    setActiveTab("user");
    setUserId(item.user_id);
    if (NOTIFICATION_EVENT_KEYS.includes(item.event_type as NotificationEventKey)) {
      setEventType(item.event_type as NotificationEventKey);
    }
    const channelState = readChannelState(item.channels);
    setChannel(channelState.channel);
    setChannelEnabled(channelState.enabled);
    setRuleEnabled(item.is_enabled);
    setNote(item.note || "");
    setFeedback({ type: "success", message: "Loaded user preference into form." });
  }

  async function save() {
    if (activeTab === "user" && userId.trim().length === 0) {
      setFeedback({ type: "error", message: "user_id is required for user scope." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    const payload: NotificationPreferenceFormPayload = {
      mode: activeTab,
      eventType,
      role: activeTab === "role" ? role : undefined,
      userId: activeTab === "user" ? userId.trim() : undefined,
      channels: buildChannels(channel, channelEnabled),
      isEnabled: ruleEnabled,
      source: activeTab === "role" ? "custom" : undefined,
      note: note.trim() || null,
    };
    const result = await fetchApiJson<{ mode: string }>("/api/manager/notifications/preferences", {
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
    setFeedback({ type: "success", message: "Preference saved successfully." });
    setSaving(false);
  }

  return (
    <main className="fdGlassScene" data-notifications-preferences-page>
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">NOTIFICATION PRODUCTIZATION</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 32 }}>Manager Notification Preferences</h1>
            <p className="fdGlassText">
              This page owns role / event / channel preferences and preference completeness. It does not manage provider
              credentials, retry execution, or notification runtime operations.
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/manager">Back</Link>
              <Link className="fdPillBtn" href="/manager/notifications">Notifications</Link>
              <Link className="fdPillBtn" href="/manager/notifications-config-integrity">Config Integrity</Link>
              <button type="button" className="fdPillBtn" data-notifications-preferences-load disabled={loading} onClick={() => void load()}>
                {loading ? "Loading..." : "Load Preferences"}
              </button>
            </div>
          </div>
        </section>

        <ManagerNotificationsDomainNav />

        {feedback?.type === "error" ? <div className="error" style={{ marginBottom: 12 }} data-notifications-preferences-error>{feedback.message}</div> : null}
        {feedback?.type === "success" ? <div className="ok" style={{ marginBottom: 12 }} data-notifications-preferences-message>{feedback.message}</div> : null}

        <section className="fdInventorySummary" style={{ marginBottom: 14 }} data-notifications-preferences-summary>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Role Rules</div>
            <strong className="fdInventorySummaryValue" data-notifications-preferences-role-count>{roleItems.length}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">User Rules</div>
            <strong className="fdInventorySummaryValue" data-notifications-preferences-user-count>{userItems.length}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Configured Role/Event Pairs</div>
            <strong className="fdInventorySummaryValue">
              {integrity ? `${integrity.summary.configuredRoleEventPairs}/${integrity.summary.expectedRoleEventPairs}` : "-"}
            </strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Missing Preference Pairs</div>
            <strong className="fdInventorySummaryValue" data-notifications-preferences-missing-count>
              {integrity ? integrity.missingItems.missingRoleEventPairs.length : "-"}
            </strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">Integrity Health</div>
            <strong className="fdInventorySummaryValue" data-notifications-preferences-health>
              {integrity ? integrity.healthStatus : "-"}
            </strong>
          </div>
        </section>

        <section className="fdTwoCol" style={{ marginBottom: 14 }}>
          <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-preferences-missing-pairs>
            <h2 className="sectionTitle">Missing Role / Event Pairs</h2>
            <p className="sub">Completeness gaps pulled from notification config integrity.</p>
            {integrity?.missingItems.missingRoleEventPairs.length ? (
              <div className="fdDataGrid" style={{ marginTop: 8 }}>
                {integrity.missingItems.missingRoleEventPairs.slice(0, 20).map((item) => (
                  <p key={`${item.role}:${item.eventType}`} className="sub" style={{ marginTop: 0 }}>
                    {item.role} / {item.eventType}
                  </p>
                ))}
              </div>
            ) : (
              <p className="fdGlassText">No missing role/event preference pairs in the current dataset.</p>
            )}
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-preferences-coverage>
            <h2 className="sectionTitle">Completeness Impact</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                Expected role/event pairs: {integrity?.summary.expectedRoleEventPairs ?? "-"}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Configured role/event pairs: {integrity?.summary.configuredRoleEventPairs ?? "-"}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Missing templates also affect deliverability: {integrity?.missingItems.missingTemplatePairs.length ?? "-"}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                Enabled channels without template: {integrity?.missingItems.enabledChannelsWithoutTemplate.length ?? "-"}
              </p>
            </div>
          </section>
        </section>

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-preferences-form>
            <h2 className="sectionTitle">Preference Form</h2>
            <p className="sub">Role scope requires role_key. User scope requires user_id.</p>
            <div className="actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                data-notifications-preferences-tab-role
                className={`fdPillBtn ${activeTab === "role" ? "fdPillBtnPrimary" : ""}`}
                onClick={() => setActiveTab("role")}
              >
                Role Scope
              </button>
              <button
                type="button"
                data-notifications-preferences-tab-user
                className={`fdPillBtn ${activeTab === "user" ? "fdPillBtnPrimary" : ""}`}
                onClick={() => setActiveTab("user")}
              >
                User Scope
              </button>
            </div>

            <div className="fdDataGrid" style={{ marginTop: 10 }}>
              <label className="sub">
                event_key *
                <select className="input" data-notifications-preferences-event value={eventType} onChange={(event) => setEventType(event.target.value as NotificationEventKey)}>
                  {NOTIFICATION_EVENT_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>

              {activeTab === "role" ? (
                <label className="sub">
                  role_key *
                  <select className="input" data-notifications-preferences-role value={role} onChange={(event) => setRole(event.target.value as (typeof MANAGER_EDITABLE_ROLE_KEYS)[number])}>
                    {MANAGER_EDITABLE_ROLE_KEYS.map((key) => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="sub">
                  user_id *
                  <input className="input" data-notifications-preferences-user value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="user uuid" />
                </label>
              )}

              <label className="sub">
                channel *
                <select className="input" data-notifications-preferences-channel value={channel} onChange={(event) => setChannel(event.target.value as NotificationChannelKey)}>
                  {NOTIFICATION_CHANNEL_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>

              <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input data-notifications-preferences-channel-enabled type="checkbox" checked={channelEnabled} onChange={(event) => setChannelEnabled(event.target.checked)} />
                selected channel enabled
              </label>

              <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input data-notifications-preferences-rule-enabled type="checkbox" checked={ruleEnabled} onChange={(event) => setRuleEnabled(event.target.checked)} />
                rule enabled
              </label>

              <label className="sub">
                note (optional)
                <input className="input" data-notifications-preferences-note value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional note" />
              </label>

              <div className="actions">
                <button type="button" data-notifications-preferences-save className="fdPillBtn fdPillBtnPrimary" disabled={saving} onClick={() => void save()}>
                  {saving ? "Saving..." : "Save"}
                </button>
                <button type="button" data-notifications-preferences-reset className="fdPillBtn" onClick={resetForm}>
                  Cancel / Reset Form
                </button>
              </div>
            </div>
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }} data-notifications-preferences-lists>
            <h2 className="sectionTitle">Role Preferences</h2>
            {!hasLoaded ? <p className="sub">Load data to view preferences.</p> : null}
            {loading ? <p className="sub">Loading...</p> : null}
            {hasLoaded && !loading && roleItems.length === 0 ? <p className="sub">No role preferences found.</p> : null}
            {hasLoaded && !loading && roleItems.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table className="table" data-notifications-preferences-role-table>
                  <thead>
                    <tr>
                      <th>event</th>
                      <th>role</th>
                      <th>channel</th>
                      <th>enabled</th>
                      <th>updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {roleItems.map((item) => {
                      const channelState = readChannelState(item.channels);
                      return (
                        <tr key={item.id}>
                          <td>{item.event_type}</td>
                          <td>{item.role}</td>
                          <td>{channelState.channel}</td>
                          <td>{String(item.is_enabled)}</td>
                          <td>{toLocalTime(item.updated_at)}</td>
                          <td>
                            <button type="button" className="fdPillBtn" onClick={() => fillRoleForm(item)}>Edit</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            <h2 className="sectionTitle" style={{ marginTop: 16 }}>User Preferences</h2>
            {hasLoaded && !loading && userItems.length === 0 ? <p className="sub">No user preferences found.</p> : null}
            {hasLoaded && !loading && userItems.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table className="table" data-notifications-preferences-user-table>
                  <thead>
                    <tr>
                      <th>event</th>
                      <th>user_id</th>
                      <th>channel</th>
                      <th>enabled</th>
                      <th>updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {userItems.map((item) => {
                      const channelState = readChannelState(item.channels);
                      return (
                        <tr key={item.id}>
                          <td>{item.event_type}</td>
                          <td>{item.user_id}</td>
                          <td>{channelState.channel}</td>
                          <td>{String(item.is_enabled)}</td>
                          <td>{toLocalTime(item.updated_at)}</td>
                          <td>
                            <button type="button" className="fdPillBtn" onClick={() => fillUserForm(item)}>Edit</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-notifications-preferences-boundaries>
          <h2 className="sectionTitle">Responsibility boundaries</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            <p className="sub" style={{ marginTop: 0 }}>
              This page owns role / event / channel preference rules and preference completeness gaps.
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              Config integrity summary stays in `/manager/notifications-config-integrity`. Runtime blocking stays in `/manager/notifications/readiness`.
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              Retry / remediation execution stays in `/manager/notification-retry`. This page does not manage credentials, queues, or provider setup.
            </p>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }} data-notifications-preferences-out-of-scope>
          <h2 className="sectionTitle">Out of scope</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            <p className="sub" style={{ marginTop: 0 }}>
              No provider credential editor, OAuth flow, webhook setup, or auth / activation work.
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              No retry workbench, no audit trace explorer, no integrations catalog, and no global operations settings.
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

