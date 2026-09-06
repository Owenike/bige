"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useMemo, useState } from "react";
import styles from "../supervisor-auth.module.css";

const TOKEN_STORAGE_KEY = "bige_supervisor_binding_token";

function readError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: string; message?: string };
  return value.error || value.message || fallback;
}

function base64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function isIosBrowser() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

export default function SupervisorDeviceBindingPage() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const incoming = hash.get("token") || "";
    const saved = window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
    const resolved = incoming || saved;
    if (resolved) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, resolved);
      setToken(resolved);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const needsIosInstall = useMemo(
    () => typeof navigator !== "undefined" && isIosBrowser() && !isStandalone(),
    [],
  );

  async function bindDevice() {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (needsIosInstall) {
        throw new Error("iPhone 請先點 Safari 的分享按鈕，選擇「加入主畫面」，再從主畫面開啟 BIG E 驗證完成綁定。");
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("這支手機的瀏覽器不支援安全通知，請改用最新版 Safari 或 Chrome。");
      }
      const optionsResponse = await fetch("/api/auth/supervisor-device/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const optionsPayload = await optionsResponse.json().catch(() => null);
      if (!optionsResponse.ok || !optionsPayload?.options || !optionsPayload?.vapidPublicKey) {
        throw new Error(readError(optionsPayload, "無法開始手機綁定。"));
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("必須允許 BIG E 傳送通知，電腦登入時手機才會收到核准要求。");
      }
      const registration = await navigator.serviceWorker.register("/supervisor-auth-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlBytes(optionsPayload.vapidPublicKey),
        });
      }
      const registrationResponse = await startRegistration({ optionsJSON: optionsPayload.options });
      const verifyResponse = await fetch("/api/auth/supervisor-device/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          challengeId: optionsPayload.challengeId,
          response: registrationResponse,
          subscription: subscription.toJSON(),
        }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => null);
      if (!verifyResponse.ok) throw new Error(readError(verifyPayload, "手機綁定失敗。"));
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      setMessage(`${optionsPayload.profile?.employeeNumber || "主管帳號"} 已完成手機生物辨識綁定。之後電腦登入不再使用密碼。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "手機綁定失敗，請重新操作。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>BIG E SUPERVISOR SECURITY</p>
        <h1 className={styles.title}>綁定主管手機</h1>
        <p className={styles.copy}>
          綁定會使用這支手機的 Face ID、指紋或裝置解鎖功能。生物特徵只留在手機內，不會上傳到 BIG E。
        </p>
        {needsIosInstall ? (
          <p className={styles.error}>
            iPhone 請先用 Safari 的分享按鈕選擇「加入主畫面」，再從主畫面開啟 BIG E 驗證。
          </p>
        ) : null}
        {!token ? <p className={styles.error}>綁定連結不存在或已被瀏覽器清除，請 01 重新產生。</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.message} role="status">{message}</p> : null}
        {!message ? (
          <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => void bindDevice()} disabled={!token || busy}>
            {busy ? "正在綁定…" : "使用生物辨識綁定這支手機"}
          </button>
        ) : null}
      </section>
    </main>
  );
}
