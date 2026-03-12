"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { fetchApiJson } from "../../../../lib/notification-productization-ui";

type JobType = "notification_sweep" | "opportunity_sweep" | "delivery_dispatch" | "reminder_bundle";
type DeliveryChannel = "email" | "line" | "sms" | "webhook";

type SettingsResponse = {
  tenantId: string;
  branchId: string | null;
  jobs: Array<{
    jobType: JobType;
    enabled: boolean;
    windowMinutes: number;
    maxBatchSize: number;
    source: "default" | "tenant" | "branch";
    featureFlag: { key: string; enabled: boolean } | null;
  }>;
  notifications: Array<{
    jobType: JobType;
    isEnabled: boolean;
    channels: Record<"in_app" | "email" | "line" | "sms" | "webhook", boolean>;
    quietHoursStart: number | null;
    quietHoursEnd: number | null;
    source: "default" | "tenant" | "branch";
    featureFlag: { key: string; enabled: boolean } | null;
    channelFeatureFlags: Array<{ channel: string; key: string; enabled: boolean }>;
  }>;
  deliveryChannels: Array<{
    channel: DeliveryChannel;
    isEnabled: boolean;
    provider: string | null;
    rateLimitPerMinute: number | null;
    timeoutMs: number | null;
    source: "default" | "tenant" | "branch";
    featureFlag: { key: string; enabled: boolean } | null;
  }>;
  featureFlags: {
    relevant: Array<{ key: string; enabled: boolean }>;
  };
  warnings: string[];
};

const JOB_TYPES: JobType[] = ["notification_sweep", "opportunity_sweep", "delivery_dispatch", "reminder_bundle"];
const DELIVERY_CHANNELS: DeliveryChannel[] = ["email", "line", "sms", "webhook"];

function parseNullableInt(input: string) {
  const value = input.trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

export default function PlatformJobSettingsPage() {
  const [tenantId, setTenantId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<SettingsResponse | null>(null);

  const [jobType, setJobType] = useState<JobType>("notification_sweep");
  const [jobEnabled, setJobEnabled] = useState(true);
  const [windowMinutes, setWindowMinutes] = useState("30");
  const [maxBatchSize, setMaxBatchSize] = useState("500");

  const [notificationJobType, setNotificationJobType] = useState<JobType>("notification_sweep");
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [notificationChannels, setNotificationChannels] = useState<Record<"in_app" | "email" | "line" | "sms" | "webhook", boolean>>({
    in_app: true,
    email: false,
    line: false,
    sms: false,
    webhook: false,
  });
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");

  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>("email");
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryProvider, setDeliveryProvider] = useState("");
  const [deliveryRateLimit, setDeliveryRateLimit] = useState("");
  const [deliveryTimeoutMs, setDeliveryTimeoutMs] = useState("");

  async function loadSettings() {
    if (!tenantId.trim()) {
      setError("tenantId is required");
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    const params = new URLSearchParams({ tenantId: tenantId.trim() });
    if (branchId.trim()) params.set("branchId", branchId.trim());
    const result = await fetchApiJson<SettingsResponse>(`/api/platform/jobs/settings?${params.toString()}`, { cache: "no-store" });
    if (!result.ok) {
      setError(result.message);
      setLoading(false);
      return;
    }
    setData(result.data);
    setLoading(false);
  }

  async function saveJobSetting(event: FormEvent) {
    event.preventDefault();
    if (!tenantId.trim()) {
      setError("tenantId is required");
      return;
    }
    const parsedWindow = parseNullableInt(windowMinutes);
    const parsedBatch = parseNullableInt(maxBatchSize);
    if (parsedWindow === null || parsedBatch === null) {
      setError("windowMinutes and maxBatchSize must be valid integers");
      return;
    }

    setSaving(true);
    setError(null);
    const result = await fetchApiJson<{ item: unknown; resolved: SettingsResponse }>("/api/platform/jobs/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert_job",
        tenantId: tenantId.trim(),
        branchId: branchId.trim() || null,
        jobType,
        enabled: jobEnabled,
        windowMinutes: parsedWindow,
        maxBatchSize: parsedBatch,
      }),
    });
    if (!result.ok) {
      setError(result.message);
      setSaving(false);
      return;
    }
    setData(result.data.resolved);
    setMessage("Job setting saved.");
    setSaving(false);
  }

  async function saveNotificationSetting(event: FormEvent) {
    event.preventDefault();
    if (!tenantId.trim()) {
      setError("tenantId is required");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await fetchApiJson<{ item: unknown; resolved: SettingsResponse }>("/api/platform/jobs/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert_notification",
        tenantId: tenantId.trim(),
        branchId: branchId.trim() || null,
        jobType: notificationJobType,
        isEnabled: notificationEnabled,
        channels: notificationChannels,
        quietHoursStart: parseNullableInt(quietStart),
        quietHoursEnd: parseNullableInt(quietEnd),
      }),
    });
    if (!result.ok) {
      setError(result.message);
      setSaving(false);
      return;
    }
    setData(result.data.resolved);
    setMessage("Notification setting saved.");
    setSaving(false);
  }

  async function saveDeliverySetting(event: FormEvent) {
    event.preventDefault();
    if (!tenantId.trim()) {
      setError("tenantId is required");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await fetchApiJson<{ item: unknown; resolved: SettingsResponse }>("/api/platform/jobs/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert_delivery_channel",
        tenantId: tenantId.trim(),
        branchId: branchId.trim() || null,
        channel: deliveryChannel,
        isEnabled: deliveryEnabled,
        provider: deliveryProvider.trim() || null,
        rateLimitPerMinute: parseNullableInt(deliveryRateLimit),
        timeoutMs: parseNullableInt(deliveryTimeoutMs),
      }),
    });
    if (!result.ok) {
      setError(result.message);
      setSaving(false);
      return;
    }
    setData(result.data.resolved);
    setMessage("Delivery channel setting saved.");
    setSaving(false);
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">PHASE 3 / JOB SETTINGS</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              Tenant & Branch Job Settings
            </h1>
            <p className="fdGlassText">
              Resolver source order: branch override &gt; tenant default &gt; system default, then feature flag overlay.
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/platform-admin/jobs">
                Back to Jobs
              </Link>
              <Link className="fdPillBtn" href="/platform-admin/feature-flags">
                Feature Flags
              </Link>
            </div>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <p className="sub" style={{ marginBottom: 12 }}>{message}</p> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">Scope</h2>
          <div className="fdThreeCol" style={{ marginTop: 8, gap: 10 }}>
            <input className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="tenantId (required)" />
            <input className="input" value={branchId} onChange={(event) => setBranchId(event.target.value)} placeholder="branchId (optional override scope)" />
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void loadSettings()} disabled={loading || saving}>
              {loading ? "Loading..." : "Load Resolved Settings"}
            </button>
          </div>
        </section>

        <section className="fdThreeCol" style={{ gap: 12, marginBottom: 14 }}>
          <form className="fdGlassSubPanel" style={{ padding: 14 }} onSubmit={saveJobSetting}>
            <h2 className="sectionTitle">Job Setting</h2>
            <select className="input" value={jobType} onChange={(event) => setJobType(event.target.value as JobType)}>
              {JOB_TYPES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <label className="sub" style={{ display: "block", marginTop: 8 }}>
              <input type="checkbox" checked={jobEnabled} onChange={(event) => setJobEnabled(event.target.checked)} /> enabled
            </label>
            <input className="input" value={windowMinutes} onChange={(event) => setWindowMinutes(event.target.value)} placeholder="windowMinutes" />
            <input className="input" value={maxBatchSize} onChange={(event) => setMaxBatchSize(event.target.value)} placeholder="maxBatchSize" />
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>Save</button>
          </form>

          <form className="fdGlassSubPanel" style={{ padding: 14 }} onSubmit={saveNotificationSetting}>
            <h2 className="sectionTitle">Notification Setting</h2>
            <select className="input" value={notificationJobType} onChange={(event) => setNotificationJobType(event.target.value as JobType)}>
              {JOB_TYPES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <label className="sub" style={{ display: "block", marginTop: 8 }}>
              <input type="checkbox" checked={notificationEnabled} onChange={(event) => setNotificationEnabled(event.target.checked)} /> isEnabled
            </label>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {(Object.keys(notificationChannels) as Array<keyof typeof notificationChannels>).map((channel) => (
                <label key={channel} className="sub" style={{ marginTop: 0 }}>
                  <input
                    type="checkbox"
                    checked={notificationChannels[channel]}
                    onChange={(event) => setNotificationChannels((prev) => ({ ...prev, [channel]: event.target.checked }))}
                  /> {channel}
                </label>
              ))}
            </div>
            <input className="input" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} placeholder="quietHoursStart (0-23, optional)" />
            <input className="input" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} placeholder="quietHoursEnd (0-23, optional)" />
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>Save</button>
          </form>

          <form className="fdGlassSubPanel" style={{ padding: 14 }} onSubmit={saveDeliverySetting}>
            <h2 className="sectionTitle">Delivery Channel Setting</h2>
            <select className="input" value={deliveryChannel} onChange={(event) => setDeliveryChannel(event.target.value as DeliveryChannel)}>
              {DELIVERY_CHANNELS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <label className="sub" style={{ display: "block", marginTop: 8 }}>
              <input type="checkbox" checked={deliveryEnabled} onChange={(event) => setDeliveryEnabled(event.target.checked)} /> isEnabled
            </label>
            <input className="input" value={deliveryProvider} onChange={(event) => setDeliveryProvider(event.target.value)} placeholder="provider (optional)" />
            <input className="input" value={deliveryRateLimit} onChange={(event) => setDeliveryRateLimit(event.target.value)} placeholder="rateLimitPerMinute (optional)" />
            <input className="input" value={deliveryTimeoutMs} onChange={(event) => setDeliveryTimeoutMs(event.target.value)} placeholder="timeoutMs (optional)" />
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>Save</button>
          </form>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">Resolved Snapshot</h2>
          {!data ? <p className="fdGlassText">No data loaded.</p> : null}
          {data ? (
            <>
              {data.warnings.length > 0 ? (
                <div className="fdDataGrid">
                  {data.warnings.map((item) => (
                    <p key={item} className="sub" style={{ marginTop: 0 }}>warning: {item}</p>
                  ))}
                </div>
              ) : null}
              <pre style={{ marginTop: 8, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {JSON.stringify(
                  {
                    tenantId: data.tenantId,
                    branchId: data.branchId,
                    jobs: data.jobs,
                    notifications: data.notifications,
                    deliveryChannels: data.deliveryChannels,
                    relevantFeatureFlags: data.featureFlags.relevant,
                  },
                  null,
                  2,
                )}
              </pre>
            </>
          ) : null}
        </section>
      </section>
    </main>
  );
}
