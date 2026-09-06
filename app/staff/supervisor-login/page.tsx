"use client";

import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import styles from "../supervisor-auth.module.css";

type ApprovalDetails = {
  employeeNumber: string | null;
  displayName: string | null;
  platform: string;
  browser: string;
  expiresAt: string;
};

type ApprovalOptions = {
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeId: string;
  request: ApprovalDetails;
};

function readError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: string; message?: string };
  return value.error || value.message || fallback;
}

export default function SupervisorLoginApprovalPage() {
  const [requestId, setRequestId] = useState("");
  const [token, setToken] = useState("");
  const [approval, setApproval] = useState<ApprovalOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const resolvedRequestId = query.get("request") || "";
    const incomingToken = hash.get("token") || "";
    const storageKey = `bige_supervisor_login_${resolvedRequestId}`;
    const resolvedToken = incomingToken || window.sessionStorage.getItem(storageKey) || "";
    if (incomingToken) window.sessionStorage.setItem(storageKey, incomingToken);
    window.history.replaceState(null, "", `${window.location.pathname}?request=${encodeURIComponent(resolvedRequestId)}`);
    setRequestId(resolvedRequestId);
    setToken(resolvedToken);
    if (!resolvedRequestId || !resolvedToken) {
      setError("登入核准連結不存在或已失效，請回電腦重新操作。");
      return;
    }
    void (async () => {
      const response = await fetch("/api/auth/supervisor-login/approval/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: resolvedRequestId, token: resolvedToken }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readError(payload, "無法讀取登入要求。"));
        return;
      }
      setApproval(payload as ApprovalOptions);
    })();
  }, []);

  async function approve() {
    if (!approval || busy) return;
    setBusy(true);
    setError("");
    try {
      const credential = await startAuthentication({ optionsJSON: approval.options });
      const response = await fetch("/api/auth/supervisor-login/approval/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, token, challengeId: approval.challengeId, response: credential }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(payload, "生物辨識未通過。"));
      window.sessionStorage.removeItem(`bige_supervisor_login_${requestId}`);
      setMessage("驗證成功，電腦正在自動登入。您可以關閉這個畫面。");
      setApproval(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生物辨識未通過。");
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    if (!requestId || !token || busy) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/supervisor-login/approval/deny", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, token }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(readError(payload, "拒絕登入失敗。"));
    } else {
      window.sessionStorage.removeItem(`bige_supervisor_login_${requestId}`);
      setMessage("已拒絕這次登入。若不是您本人操作，請立即通知 01。");
      setApproval(null);
    }
    setBusy(false);
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>BIG E LOGIN APPROVAL</p>
        <h1 className={styles.title}>確認主管登入</h1>
        {approval ? (
          <div className={styles.details}>
            <span>登入帳號</span>
            <strong>{approval.request.displayName || "主管"} · {approval.request.employeeNumber}</strong>
            <span>要求登入的電腦</span>
            <strong>{approval.request.platform} · {approval.request.browser}</strong>
          </div>
        ) : !error && !message ? <p className={styles.copy}>正在讀取登入要求…</p> : null}
        <p className={styles.copy}>只有在您本人剛剛於電腦要求登入時才可核准。</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.message} role="status">{message}</p> : null}
        {approval ? (
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => void approve()} disabled={busy}>
              {busy ? "驗證中…" : "使用生物辨識核准"}
            </button>
            <button className={`${styles.button} ${styles.danger}`} type="button" onClick={() => void deny()} disabled={busy}>
              不是我，拒絕登入
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
