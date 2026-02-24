"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";
import { MemberTabs } from "../_components/MemberTabs";

type MePayload = {
  member?: {
    full_name?: string | null;
    phone?: string | null;
    email?: string | null;
    portal_status?: string | null;
  } | null;
  error?: string;
};

type DeviceItem = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  platform: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  isCurrent: boolean;
};

type DevicesPayload = {
  available?: boolean;
  items?: DeviceItem[];
  error?: string;
};

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function MemberSettingsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [member, setMember] = useState<MePayload["member"]>(null);
  const [devicesAvailable, setDevicesAvailable] = useState(true);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeDevices = useMemo(() => devices.filter((item) => !item.revokedAt).length, [devices]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [meRes, deviceRes] = await Promise.all([
          fetch("/api/member/me", { cache: "no-store" }),
          fetch("/api/member/devices", { cache: "no-store" }),
        ]);
        const mePayload = (await meRes.json().catch(() => null)) as MePayload | null;
        const devicePayload = (await deviceRes.json().catch(() => null)) as DevicesPayload | null;

        if (!meRes.ok) throw new Error(mePayload?.error || (zh ? "載入設定失敗" : "Failed to load settings"));
        if (!deviceRes.ok) throw new Error(devicePayload?.error || (zh ? "載入裝置清單失敗" : "Failed to load device list"));

        if (!cancelled) {
          const list = devicePayload?.items || [];
          setMember(mePayload?.member || null);
          setDevicesAvailable(devicePayload?.available !== false);
          setDevices(list);
          setDraftNames(
            list.reduce<Record<string, string>>((acc, item) => {
              acc[item.id] = item.displayName || "";
              return acc;
            }, {}),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : zh ? "載入設定失敗" : "Failed to load settings");
          setMember(null);
          setDevices([]);
          setDraftNames({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zh]);

  async function revokeDevice(deviceId: string) {
    if (deviceBusy) return;
    setDeviceBusy(true);
    setError(null);
    setMessage(null);
    const previous = devices;
    const now = new Date().toISOString();
    setDevices((prev) =>
      prev.map((item) =>
        item.id === deviceId
          ? {
              ...item,
              revokedAt: item.revokedAt || now,
            }
          : item,
      ),
    );
    try {
      const res = await fetch("/api/member/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", deviceId }),
      });
      const payload = (await res.json().catch(() => null)) as DevicesPayload | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "停用裝置失敗" : "Failed to revoke device"));
      setMessage(zh ? "裝置已停用。" : "Device revoked.");
    } catch (err) {
      setDevices(previous);
      setError(err instanceof Error ? err.message : zh ? "停用裝置失敗" : "Failed to revoke device");
    } finally {
      setDeviceBusy(false);
    }
  }

  async function renameDevice(device: DeviceItem) {
    if (deviceBusy || device.revokedAt) return;
    const displayName = (draftNames[device.id] || "").trim();
    setDeviceBusy(true);
    setError(null);
    setMessage(null);
    const previous = devices;
    setDevices((prev) =>
      prev.map((item) =>
        item.id === device.id
          ? {
              ...item,
              displayName: displayName || null,
            }
          : item,
      ),
    );
    try {
      const res = await fetch("/api/member/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", deviceId: device.id, displayName }),
      });
      const payload = (await res.json().catch(() => null)) as DevicesPayload | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "更新裝置名稱失敗" : "Failed to rename device"));
      setMessage(zh ? "裝置名稱已更新。" : "Device name updated.");
    } catch (err) {
      setDevices(previous);
      setError(err instanceof Error ? err.message : zh ? "更新裝置名稱失敗" : "Failed to rename device");
    } finally {
      setDeviceBusy(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">{zh ? "設定" : "SETTINGS"}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>{zh ? "帳號設定" : "Account Settings"}</h1>
          <p className="sub">
            {zh
              ? "管理登入安全、密碼重設，以及會員入口帳號狀態。"
              : "Manage login security, password reset, and member portal status."}
          </p>
          <MemberTabs />

          {error ? <p className="sub" style={{ marginTop: 10, color: "var(--danger, #b00020)" }}>{error}</p> : null}
          {message ? <p className="sub" style={{ marginTop: 10, color: "var(--success, #0b6b3a)" }}>{message}</p> : null}
          {loading ? <p className="sub" style={{ marginTop: 10 }}>{zh ? "載入中..." : "Loading..."}</p> : null}

          {!loading && member ? (
            <section className="card" style={{ marginTop: 12, padding: 12 }}>
              <div className="kvLabel">{zh ? "目前帳號" : "Current Account"}</div>
              <p className="sub" style={{ marginTop: 8 }}>{zh ? "姓名" : "Name"}: {member.full_name || "-"}</p>
              <p className="sub" style={{ marginTop: 4 }}>{zh ? "電話" : "Phone"}: {member.phone || "-"}</p>
              <p className="sub" style={{ marginTop: 4 }}>Email: {member.email || "-"}</p>
              <p className="sub" style={{ marginTop: 4 }}>{zh ? "入口狀態" : "Portal Status"}: {member.portal_status || "-"}</p>
            </section>
          ) : null}

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "安全動作" : "Security Actions"}</div>
            <div className="actions" style={{ marginTop: 10 }}>
              <a className="btn btnPrimary" href="/forgot-password">
                {zh ? "重設密碼" : "Reset Password"}
              </a>
              <a className="btn" href="/logout">
                {zh ? "登出（目前裝置）" : "Sign Out (current session)"}
              </a>
            </div>
            <p className="sub" style={{ marginTop: 8 }}>
              {zh
                ? "若懷疑帳號異常，請先重設密碼，再聯絡櫃台協助檢查。"
                : "If you suspect unauthorized access, reset your password and contact frontdesk."}
            </p>
          </section>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "登入裝置管理" : "Login Device Management"}</div>
            <p className="sub" style={{ marginTop: 8 }}>
              {zh ? `目前活躍裝置：${activeDevices}` : `Active devices: ${activeDevices}`}
            </p>
            {!devicesAvailable ? (
              <p className="sub" style={{ marginTop: 8 }}>
                {zh ? "裝置資料表尚未啟用，請先套用最新 migration。" : "Device table is unavailable. Apply latest migrations first."}
              </p>
            ) : devices.length === 0 ? (
              <p className="sub" style={{ marginTop: 8 }}>{zh ? "目前沒有裝置紀錄。" : "No device records yet."}</p>
            ) : (
              <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
                {devices.map((device) => (
                  <li key={device.id} className="card" style={{ padding: 10, opacity: device.revokedAt ? 0.7 : 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <strong>{device.displayName || device.platform || (zh ? "未知裝置" : "Unknown Device")}</strong>
                      <span className="fdChip">
                        {device.revokedAt
                          ? zh
                            ? "已停用"
                            : "Revoked"
                          : device.isCurrent
                            ? zh
                              ? "目前裝置"
                              : "Current"
                            : zh
                              ? "活躍"
                              : "Active"}
                      </span>
                    </div>
                    <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>{device.userAgent || "-"}</p>
                    <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                      IP: {device.ipAddress || "-"} | {zh ? "最後使用" : "Last seen"}: {fmtDateTime(device.lastSeenAt)}
                    </p>
                    <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                      {zh ? "建立時間" : "Created"}: {fmtDateTime(device.createdAt)}
                    </p>
                    {device.revokedAt ? (
                      <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                        {zh ? "停用時間" : "Revoked at"}: {fmtDateTime(device.revokedAt)}
                      </p>
                    ) : (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 8 }}>
                          <input
                            className="input"
                            value={draftNames[device.id] ?? ""}
                            maxLength={40}
                            onChange={(event) => setDraftNames((prev) => ({ ...prev, [device.id]: event.target.value }))}
                            placeholder={zh ? "裝置名稱（例如：我的 iPhone）" : "Device name (e.g. My iPhone)"}
                          />
                          <button type="button" className="btn" disabled={deviceBusy} onClick={() => void renameDevice(device)}>
                            {zh ? "儲存名稱" : "Save Name"}
                          </button>
                        </div>
                        <div className="actions" style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            className="btn"
                            disabled={deviceBusy || device.isCurrent}
                            onClick={() => void revokeDevice(device.id)}
                          >
                            {zh ? "停用裝置" : "Revoke Device"}
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
