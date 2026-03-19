"use client";

import Link from "next/link";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "../../i18n-provider";

type ConfirmResponse = {
  activated?: boolean;
  error?: string;
};

function getRecoveryMessage(params: { zh: boolean; error: string | null; tokenReady: boolean; done: boolean }) {
  if (params.done) {
    return params.zh
      ? "已完成啟用後，請返回登入頁用電話與新密碼登入。"
      : "After activation, return to login and sign in with your phone number and new password.";
  }

  if (params.error) {
    return params.zh
      ? "若連結已失效或無效，請回登入頁重新寄送啟用信；若仍失敗，請請櫃台協助確認會員 Email 與入口狀態。"
      : "If the link is expired or invalid, return to login and send a new activation email. If it still fails, ask frontdesk to verify the member email and portal status.";
  }

  if (!params.tokenReady) {
    return params.zh
      ? "建議直接從啟用信開啟此頁；若手動貼上 Token，請確認內容完整且仍有效。"
      : "Open this page from the activation email when possible. If you paste a token manually, make sure it is complete and still valid.";
  }

  return params.zh
    ? "若啟用失敗，請返回登入頁重新寄送啟用信。"
    : "If activation fails, return to login and request a new activation email.";
}

function ActivateContent() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const searchParams = useSearchParams();
  const tokenFromQuery = searchParams.get("token") || "";
  const tokenReady = useMemo(() => tokenFromQuery.trim(), [tokenFromQuery]);

  const [tokenInput, setTokenInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const recoveryMessage = useMemo(
    () => getRecoveryMessage({ zh, error, tokenReady: Boolean(tokenReady), done }),
    [done, error, tokenReady, zh],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const token = (tokenReady || tokenInput).trim();
    if (!token) {
      setError(zh ? "缺少啟用 Token，請從信件連結進入。" : "Missing activation token. Please open from email link.");
      return;
    }
    if (password.length < 8) {
      setError(zh ? "密碼至少 8 碼。" : "Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError(zh ? "兩次輸入密碼不一致。" : "Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/member-activation/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const payload = (await res.json().catch(() => null)) as ConfirmResponse | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "啟用失敗" : "Activation failed"));

      setDone(true);
      setMessage(zh ? "帳號啟用完成，請返回登入。" : "Account activated. Please sign in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "啟用失敗" : "Activation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <div className="card formCard" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="kvLabel">{zh ? "會員啟用" : "MEMBER ACTIVATION"}</div>
        <h1 className="sectionTitle" style={{ marginTop: 10 }}>
          {zh ? "設定密碼並啟用帳號" : "Set Password and Activate"}
        </h1>
        <p className="sub" style={{ marginTop: 8 }}>
          {zh
            ? "此頁會將電話登入對應的會員帳號啟用。"
            : "This page activates your member account from phone-login email verification."}
        </p>

        <p className="sub" style={{ marginTop: 8 }}>
          {recoveryMessage}
        </p>

        {error ? (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="ok" style={{ marginTop: 12 }}>
            {message}
          </div>
        ) : null}

        <form onSubmit={submit} style={{ marginTop: 12 }}>
          {!tokenReady ? (
            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>
                Token
              </span>
              <input
                className="input"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder={zh ? "請貼上啟用 Token" : "Paste activation token"}
                required
              />
            </label>
          ) : null}

          <label className="field">
            <span className="kvLabel" style={{ textTransform: "none" }}>
              {zh ? "新密碼" : "New Password"}
            </span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          <label className="field">
            <span className="kvLabel" style={{ textTransform: "none" }}>
              {zh ? "確認密碼" : "Confirm Password"}
            </span>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          <div className="actions" style={{ marginTop: 14 }}>
            <button type="submit" className={`btn ${busy ? "" : "btnPrimary"}`} disabled={busy || done}>
              {busy ? (zh ? "啟用中..." : "Activating...") : zh ? "啟用帳號" : "Activate Account"}
            </button>
            <Link href="/login" className="btn">
              {zh ? "回登入頁" : "Back to Login"}
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function MemberActivatePage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<main className="container">{t("common.loading")}</main>}>
      <ActivateContent />
    </Suspense>
  );
}
