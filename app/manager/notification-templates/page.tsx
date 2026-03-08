"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  NOTIFICATION_CHANNEL_KEYS,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_PRIORITY_KEYS,
  fetchApiJson,
  normalizeTemplatePayload,
  type NotificationChannelKey,
  type NotificationEventKey,
  type NotificationPriorityKey,
  type NotificationTemplateFormPayload,
  type NotificationTemplateRecord,
} from "../../../lib/notification-productization-ui";

type TemplatesResponse = {
  tenantId: string;
  includeGlobal: boolean;
  items: NotificationTemplateRecord[];
};

function toLocalTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function buildTenantTemplateKey(eventType: string, channel: string, locale: string) {
  return `tenant:<current>:${eventType}:${channel}:${locale}`;
}

export default function ManagerNotificationTemplatesPage() {
  const [includeGlobal, setIncludeGlobal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationTemplateRecord[]>([]);

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

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

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
    setMessage("已帶入模板，可直接修改後儲存");
  }

  async function load() {
    setLoading(true);
    resetFeedback();
    const query = new URLSearchParams();
    query.set("includeGlobal", includeGlobal ? "true" : "false");
    query.set("activeOnly", "false");
    const result = await fetchApiJson<TemplatesResponse>(`/api/manager/notifications/templates?${query.toString()}`);
    if (!result.ok) {
      setError(result.message);
      setLoading(false);
      return;
    }
    setItems(result.data.items || []);
    setLoading(false);
  }

  async function save() {
    if (!titleTemplate.trim() || !messageTemplate.trim()) {
      setError("title 與 message 為必填");
      return;
    }
    let parsedPolicy: Record<string, unknown>;
    try {
      const parsed = JSON.parse(channelPolicyText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("channel_policy 必須是 JSON object");
        return;
      }
      parsedPolicy = parsed as Record<string, unknown>;
    } catch {
      setError("channel_policy JSON 格式錯誤");
      return;
    }

    setSaving(true);
    resetFeedback();
    const payload = normalizeTemplatePayload({
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
      templateKey: previewTemplateKey,
    } as NotificationTemplateFormPayload);

    const result = await fetchApiJson<{ item: NotificationTemplateRecord }>("/api/manager/notifications/templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!result.ok) {
      setError(result.message);
      setSaving(false);
      return;
    }
    setMessage(editingId ? "Template updated" : "Template created");
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
            <h1 className="h1" style={{ marginTop: 10, fontSize: 32 }}>Manager Notification Templates</h1>
            <p className="fdGlassText">可操作版本：tenant scope 模板清單、編輯、preview。</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/manager">Back</Link>
            </div>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdTwoCol">
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Scope & Form</h2>
            <p className="sub">Manager 只可管理本 tenant 模板，可選擇是否同時檢視 global。</p>
            <div className="fdDataGrid">
              <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={includeGlobal} onChange={(event) => setIncludeGlobal(event.target.checked)} />
                include global templates when loading
              </label>
              <div className="actions">
                <button type="button" className="fdPillBtn" disabled={loading} onClick={() => void load()}>
                  {loading ? "Loading..." : "Load"}
                </button>
                <button type="button" className="fdPillBtn" onClick={resetForm}>
                  Clear Form
                </button>
              </div>
              <label className="sub">
                template_key
                <input className="input" value={previewTemplateKey} readOnly />
              </label>
              <label className="sub">
                event_key
                <select className="input" value={eventType} onChange={(event) => setEventType(event.target.value as NotificationEventKey)}>
                  {NOTIFICATION_EVENT_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>
              <label className="sub">
                channel
                <select className="input" value={channel} onChange={(event) => setChannel(event.target.value as NotificationChannelKey)}>
                  {NOTIFICATION_CHANNEL_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>
              <label className="sub">
                locale
                <input className="input" value={locale} onChange={(event) => setLocale(event.target.value)} />
              </label>
              <label className="sub">
                priority
                <select className="input" value={priority} onChange={(event) => setPriority(event.target.value as NotificationPriorityKey)}>
                  {NOTIFICATION_PRIORITY_KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </label>
              <label className="sub">
                title
                <input className="input" value={titleTemplate} onChange={(event) => setTitleTemplate(event.target.value)} />
              </label>
              <label className="sub">
                message
                <textarea className="input" value={messageTemplate} onChange={(event) => setMessageTemplate(event.target.value)} />
              </label>
              <label className="sub">
                email_subject
                <input className="input" value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} />
              </label>
              <label className="sub">
                action_url
                <input className="input" value={actionUrl} onChange={(event) => setActionUrl(event.target.value)} placeholder="/manager/..." />
              </label>
              <label className="sub">
                channel_policy (json)
                <textarea className="input" value={channelPolicyText} onChange={(event) => setChannelPolicyText(event.target.value)} />
              </label>
              <label className="sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
                is_active
              </label>
              <div className="actions">
                <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={saving} onClick={() => void save()}>
                  {saving ? "Saving..." : editingId ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Preview</h2>
            <div className="fdDataGrid">
              <p className="sub"><b>title:</b> {titleTemplate || "-"}</p>
              <p className="sub"><b>message:</b> {messageTemplate || "-"}</p>
              <p className="sub"><b>email_subject:</b> {emailSubject || "-"}</p>
              <p className="sub"><b>action_url:</b> {actionUrl || "-"}</p>
            </div>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">Template List</h2>
          {loading ? <p className="sub">Loading...</p> : null}
          {!loading && items.length === 0 ? <p className="sub">No templates</p> : null}
          {!loading && items.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>tenant</th>
                    <th>event</th>
                    <th>channel</th>
                    <th>priority</th>
                    <th>policy</th>
                    <th>updated</th>
                    <th>active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.tenant_id || "global"}</td>
                      <td>{item.event_type}</td>
                      <td>{item.channel}</td>
                      <td>{item.priority}</td>
                      <td>{Object.keys(item.channel_policy || {}).join(", ") || "-"}</td>
                      <td>{toLocalTime(item.updated_at)}</td>
                      <td>{String(item.is_active)}</td>
                      <td>
                        <button type="button" className="fdPillBtn" onClick={() => applyItem(item)}>
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
      </section>
    </main>
  );
}
