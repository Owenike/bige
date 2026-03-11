"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_ROLE_KEYS,
  fetchApiJson,
  type NotificationChannelKey,
  type NotificationEventKey,
  type NotificationPreferenceFormPayload,
  type NotificationRoleKey,
} from "../../../lib/notification-productization-ui";

type RolePreferenceItem = {
  id: string;
  role: string;
  event_type: string;
  is_enabled: boolean;
  channels: Record<string, boolean>;
  source: string;
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
  const defaults = { channel: "in_app" as NotificationChannelKey, enabled: true };
  if (!channels) return defaults;
  for (const key of NOTIFICATION_CHANNEL_KEYS) {
    if (channels[key]) return { channel: key, enabled: true };
  }
  return defaults;
}

function toLocalTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function PlatformNotificationsPreferencesPage() {
  const [tenantId, setTenantId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [roleItems, setRoleItems] = useState<RolePreferenceItem[]>([]);
  const [userItems, setUserItems] = useState<UserPreferenceItem[]>([]);
  const [activeTab, setActiveTab] = useState<"role" | "user">("role");

  const [eventType, setEventType] = useState<NotificationEventKey>(NOTIFICATION_EVENT_KEYS[0]);
  const [role, setRole] = useState<NotificationRoleKey>("manager");
  const [userId, setUserId] = useState("");
  const [channel, setChannel] = useState<NotificationChannelKey>("in_app");
  const [channelEnabled, setChannelEnabled] = useState(true);
  const [ruleEnabled, setRuleEnabled] = useState(true);
  const [note, setNote] = useState("");

  const canLoad = useMemo(() => tenantId.trim().length > 0, [tenantId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialTenant = params.get("tenantId");
    const initialMode = params.get("mode");
    if (initialTenant) setTenantId(initialTenant);
    if (initialMode === "role" || initialMode === "user") setActiveTab(initialMode);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (tenantId.trim()) params.set("tenantId", tenantId.trim());
    else params.delete("tenantId");
    params.set("mode", activeTab);
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [tenantId, activeTab]);

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
    if (!canLoad) {
      setFeedback({ type: "error", message: "tenant_id is required." });
      return;
    }
    setLoading(true);
    setFeedback(null);
    const query = new URLSearchParams({ tenantId: tenantId.trim() });
    const result = await fetchApiJson<PreferencesResponse>(`/api/platform/notifications/preferences?${query.toString()}`);
    if (!result.ok) {
      setFeedback({ type: "error", message: result.message });
      setLoading(false);
      setHasLoaded(true);
      return;
    }
    setRoleItems(result.data.rolePreferences || []);
    setUserItems(result.data.userPreferences || []);
    setLoading(false);
    setHasLoaded(true);
  }

  function fillRoleForm(item: RolePreferenceItem) {
    setActiveTab("role");
    setRole((NOTIFICATION_ROLE_KEYS.includes(item.role as NotificationRoleKey) ? item.role : "manager") as NotificationRoleKey);
    setEventType((NOTIFICATION_EVENT_KEYS.includes(item.event_type as NotificationEventKey) ? item.event_type : NOTIFICATION_EVENT_KEYS[0]) as NotificationEventKey);
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
    setEventType((NOTIFICATION_EVENT_KEYS.includes(item.event_type as NotificationEventKey) ? item.event_type : NOTIFICATION_EVENT_KEYS[0]) as NotificationEventKey);
    const channelState = readChannelState(item.channels);
    setChannel(channelState.channel);
    setChannelEnabled(channelState.enabled);
    setRuleEnabled(item.is_enabled);
    setNote(item.note || "");
    setFeedback({ type: "success", message: "Loaded user preference into form." });
  }

  async function save() {
    if (!canLoad) {
      setFeedback({ type: "error", message: "tenant_id is required." });
      return;
    }
    if (activeTab === "user" && userId.trim().length === 0) {
      setFeedback({ type: "error", message: "user_id is required for user scope." });
      return;
    }
    setSaving(true);
    setFeedback(null);

    const payload: NotificationPreferenceFormPayload = {
      tenantId: tenantId.trim(),
      mode: activeTab,
      eventType,
      role: activeTab === "role" ? role : undefined,
      userId: activeTab === "user" ? userId.trim() : undefined,
      channels: buildChannels(channel, channelEnabled),
      isEnabled: ruleEnabled,
      source: activeTab === "role" ? "custom" : undefined,
      note: note.trim() || null,
    };

    const result = await fetchApiJson<{ mode: string }>(`/api/platform/notifications/preferences`, {
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
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">NOTIFICATION PRODUCTIZATION</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 32 }}>Platform Notification Preferences</h1>
            <p className="fdGlassText">
              Platform admin can manage role-level and user-level notification preferences for any tenant.
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/platform-admin">Back</Link>
            </div>
          </div>
        </section>

        {feedback?.type === "error" ? <div className="error" style={{ marginBottom: 12 }}>{feedback.message}</div> : null}
        {feedback?.type === "success" ? <div className="ok" style={{ marginBottom: 12 }}>{feedback.message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Tenant Scope</h2>
          <p className="sub">Required: tenant_id. Manager pages are tenant-bound, but platform can switch tenant here.</p>
          <div className="actions" style={{ marginTop: 8 }}>
            <input
              className="input"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="tenant_id (required)"
            />
            <button type="button" className="fdPillBtn" disabled={loading || !canLoad} onClick={() => void load()}>
              {loading ? "Loading..." : "Load Preferences"}
            </button>
          </div>
        </section>

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Preference Form</h2>
            <p className="sub">
              Scope required fields: role scope needs role_key; user scope needs user_id.
            </p>
            <div className="actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={`fdPillBtn ${activeTab === "role" ? "fdPillBtnPrimary" : ""}`}
                onClick={() => setActiveTab("role")}
              >
                Role Scope
              </button>
              <button
                type="button"
                className={`fdPillBtn ${activeTab === "user" ? "fdPillBtnPrimary" : ""}`}
                onClick={() => setActiveTab("user")}
              >
                User Scope
              </button>
            </div>

            <div className="fdDataGrid" style={{ marginTop: 10 }}>
              <label className="sub">
                event_key *
                <select className="input" value={eventType} onChange={(event) => setEventType(event.target.value as NotificationEventKey)}>
                  {NOTIFICATION_EVENT_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>

              {activeTab === "role" ? (
                <label className="sub">
                  role_key *
                  <select className="input" value={role} onChange={(event) => setRole(event.target.value as NotificationRoleKey)}>
                    {NOTIFICATION_ROLE_KEYS.map((key) => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="sub">
                  user_id *
                  <input className="input" value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="user uuid" />
                </label>
              )}

              <label className="sub">
                channel *
                <select className="input" value={channel} onChange={(event) => setChannel(event.target.value as NotificationChannelKey)}>
                  {NOTIFICATION_CHANNEL_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>

              <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={channelEnabled} onChange={(event) => setChannelEnabled(event.target.checked)} />
                selected channel enabled
              </label>

              <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={ruleEnabled} onChange={(event) => setRuleEnabled(event.target.checked)} />
                rule enabled
              </label>

              <label className="sub">
                note (optional)
                <input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional note" />
              </label>

              <div className="actions">
                <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={saving || !canLoad} onClick={() => void save()}>
                  {saving ? "Saving..." : "Save"}
                </button>
                <button type="button" className="fdPillBtn" onClick={resetForm}>
                  Cancel / Reset Form
                </button>
              </div>
            </div>
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Role Preferences</h2>
            {!hasLoaded ? <p className="sub">Load data to view preferences.</p> : null}
            {loading ? <p className="sub">Loading...</p> : null}
            {hasLoaded && !loading && roleItems.length === 0 ? <p className="sub">No role preferences found.</p> : null}
            {hasLoaded && !loading && roleItems.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
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
                <table className="table">
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
      </section>
    </main>
  );
}
