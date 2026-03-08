"use client";

import Link from "next/link";
import { useState } from "react";
import {
  MANAGER_EDITABLE_ROLE_KEYS,
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  fetchApiJson,
  type NotificationChannelKey,
  type NotificationEventKey,
  type NotificationPreferenceFormPayload,
} from "../../../lib/notification-productization-ui";

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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [roleItems, setRoleItems] = useState<RolePreferenceItem[]>([]);
  const [userItems, setUserItems] = useState<UserPreferenceItem[]>([]);
  const [activeTab, setActiveTab] = useState<"role" | "user">("role");

  const [eventType, setEventType] = useState<NotificationEventKey>(NOTIFICATION_EVENT_KEYS[0]);
  const [role, setRole] = useState<(typeof MANAGER_EDITABLE_ROLE_KEYS)[number]>("manager");
  const [userId, setUserId] = useState("");
  const [channel, setChannel] = useState<NotificationChannelKey>("in_app");
  const [channelEnabled, setChannelEnabled] = useState(true);
  const [ruleEnabled, setRuleEnabled] = useState(true);
  const [note, setNote] = useState("");

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

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  async function load() {
    setLoading(true);
    resetFeedback();
    const result = await fetchApiJson<PreferencesResponse>("/api/manager/notifications/preferences");
    if (!result.ok) {
      setError(result.message);
      setLoading(false);
      return;
    }
    setRoleItems(result.data.rolePreferences || []);
    setUserItems(result.data.userPreferences || []);
    setLoading(false);
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
    setMessage("已帶入 role preference，可直接修改後儲存");
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
    setMessage("已帶入 user preference，可直接修改後儲存");
  }

  async function save() {
    if (activeTab === "user" && userId.trim().length === 0) {
      setError("user scope 需要 user_id");
      return;
    }
    setSaving(true);
    resetFeedback();
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
      setError(result.message);
      setSaving(false);
      return;
    }
    setMessage("儲存成功");
    await load();
    resetForm();
    setSaving(false);
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">NOTIFICATION PRODUCTIZATION</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 32 }}>Manager Notification Preferences</h1>
            <p className="fdGlassText">可操作版本：manager tenant scope 偏好管理。</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/manager">Back</Link>
              <button type="button" className="fdPillBtn" disabled={loading} onClick={() => void load()}>
                {loading ? "Loading..." : "Load"}
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Preference Form</h2>
            <p className="sub">Manager 僅可操作目前 tenant 的偏好設定，不可跨租戶。</p>
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
                event_key
                <select className="input" value={eventType} onChange={(event) => setEventType(event.target.value as NotificationEventKey)}>
                  {NOTIFICATION_EVENT_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>

              {activeTab === "role" ? (
                <label className="sub">
                  role_key
                  <select className="input" value={role} onChange={(event) => setRole(event.target.value as (typeof MANAGER_EDITABLE_ROLE_KEYS)[number])}>
                    {MANAGER_EDITABLE_ROLE_KEYS.map((key) => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="sub">
                  user_id
                  <input className="input" value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="user uuid" />
                </label>
              )}

              <label className="sub">
                channel
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
                note
                <input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional note" />
              </label>

              <div className="actions">
                <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={saving} onClick={() => void save()}>
                  {saving ? "Saving..." : "Save"}
                </button>
                <button type="button" className="fdPillBtn" onClick={resetForm}>
                  Cancel / Reset
                </button>
              </div>
            </div>
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Role Preferences</h2>
            {loading ? <p className="sub">Loading...</p> : null}
            {!loading && roleItems.length === 0 ? <p className="sub">No role preferences</p> : null}
            {!loading && roleItems.length > 0 ? (
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
            {!loading && userItems.length === 0 ? <p className="sub">No user preferences</p> : null}
            {!loading && userItems.length > 0 ? (
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
