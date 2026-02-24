"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "../i18n-provider";

type MeResponse = {
  userId: string;
  role: "platform_admin" | "manager" | "frontdesk" | "coach" | "member";
  tenantId: string | null;
  branchId: string | null;
};

type MemberActivationRequestResponse = {
  accepted?: boolean;
  maskedEmail?: string;
  expiresAt?: string;
  error?: string;
};

function roleHome(role: MeResponse["role"]) {
  switch (role) {
    case "platform_admin":
      return "/platform-admin";
    case "manager":
      return "/manager";
    case "frontdesk":
      return "/frontdesk";
    case "coach":
      return "/coach";
    case "member":
      return "/member";
    default:
      return "/";
  }
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const zh = locale !== "en";

  const redirectTo = useMemo(() => {
    const v = searchParams.get("redirect");
    // Keep redirects on-site only.
    if (!v || !v.startsWith("/")) return null;
    return v;
  }, [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberLoginBusy, setMemberLoginBusy] = useState(false);
  const [memberLoginError, setMemberLoginError] = useState<string | null>(null);
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationMessage, setActivationMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || "Login failed");

      const meRes = await fetch("/api/auth/me");
      const mePayload = (await meRes.json().catch(() => null)) as MeResponse | null;
      if (!meRes.ok || !mePayload?.role) throw new Error((mePayload as any)?.error || "Profile not ready");

      router.replace(redirectTo || roleHome(mePayload.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitPhoneActivation(event: FormEvent) {
    event.preventDefault();
    setActivationBusy(true);
    setMemberLoginError(null);
    setActivationError(null);
    setActivationMessage(null);

    try {
      const res = await fetch("/api/auth/member-activation/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      const payload = (await res.json().catch(() => null)) as MemberActivationRequestResponse | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "發送啟用信失敗" : "Failed to send activation email"));

      const hint = payload?.maskedEmail
        ? (zh ? `啟用信已寄到 ${payload.maskedEmail}` : `Activation email sent to ${payload.maskedEmail}`)
        : zh
          ? "啟用信已寄出，請至綁定信箱收信。"
          : "Activation email sent. Please check your email.";
      setActivationMessage(hint);
    } catch (err) {
      setActivationError(err instanceof Error ? err.message : zh ? "發送啟用信失敗" : "Failed to send activation email");
    } finally {
      setActivationBusy(false);
    }
  }

  async function submitPhoneLogin(event: FormEvent) {
    event.preventDefault();
    setMemberLoginBusy(true);
    setMemberLoginError(null);
    setActivationError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password: memberPassword }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || (zh ? "電話登入失敗" : "Phone login failed"));

      const meRes = await fetch("/api/auth/me");
      const mePayload = (await meRes.json().catch(() => null)) as MeResponse | null;
      if (!meRes.ok || !mePayload?.role) throw new Error((mePayload as any)?.error || "Profile not ready");

      router.replace(redirectTo || roleHome(mePayload.role));
    } catch (err) {
      setMemberLoginError(err instanceof Error ? err.message : zh ? "電話登入失敗" : "Phone login failed");
    } finally {
      setMemberLoginBusy(false);
    }
  }

  return (
    <main className="container">
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <div className="card formCard">
          <div className="kvLabel">{zh ? "後台與員工" : "Staff Access"}</div>
          <h1 className="sectionTitle" style={{ marginTop: 10 }}>
            {t("auth.sign_in")}
          </h1>

          {error ? (
            <div className="error" style={{ marginTop: 12 }}>
              {error}
            </div>
          ) : null}

          <form onSubmit={submit} style={{ marginTop: 12 }}>
            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>
                {t("auth.email")}
              </span>
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                required
              />
            </label>

            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>
                {t("auth.password")}
              </span>
              <input
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>

            <div className="actions" style={{ marginTop: 14 }}>
              <button type="submit" disabled={busy} className={`btn ${busy ? "" : "btnPrimary"}`}>
                {busy ? t("auth.signing_in") : t("auth.sign_in")}
              </button>
              <Link className="btn" href="/forgot-password">
                {zh ? "忘記密碼" : "Forgot Password"}
              </Link>
              <Link className="btn" href="/">
                {t("common.back_home")}
              </Link>
            </div>
          </form>
        </div>

        <div className="card formCard">
          <div className="kvLabel">{zh ? "會員電話登入" : "Member Phone Login"}</div>
          <h2 className="sectionTitle" style={{ marginTop: 10 }}>
            {zh ? "電話登入與帳號啟用" : "Phone Login and Activation"}
          </h2>
          <p className="sub" style={{ marginTop: 8 }}>
            {zh
              ? "僅限櫃台已建檔會員。已啟用帳號可用電話+密碼登入；未啟用可寄送啟用信到綁定 Email。"
              : "Frontdesk-created members only. Activated members can sign in with phone + password; otherwise send activation email to the bound email."}
          </p>

          {activationError ? (
            <div className="error" style={{ marginTop: 12 }}>
              {activationError}
            </div>
          ) : null}
          {memberLoginError ? (
            <div className="error" style={{ marginTop: 12 }}>
              {memberLoginError}
            </div>
          ) : null}

          {activationMessage ? (
            <div className="ok" style={{ marginTop: 12 }}>
              {activationMessage}
            </div>
          ) : null}

          <form onSubmit={submitPhoneLogin} style={{ marginTop: 12 }}>
            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>
                {zh ? "手機號碼" : "Phone"}
              </span>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={zh ? "09xxxxxxxx" : "Phone number"}
                type="tel"
                autoComplete="tel"
                required
              />
            </label>

            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>
                {zh ? "密碼" : "Password"}
              </span>
              <input
                className="input"
                value={memberPassword}
                onChange={(e) => setMemberPassword(e.target.value)}
                placeholder="********"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>

            <div className="actions" style={{ marginTop: 14 }}>
              <button type="submit" disabled={memberLoginBusy} className={`btn ${memberLoginBusy ? "" : "btnPrimary"}`}>
                {memberLoginBusy
                  ? zh
                    ? "登入中..."
                    : "Signing in..."
                  : zh
                    ? "電話登入"
                    : "Phone Login"}
              </button>
            </div>
          </form>

          <form onSubmit={submitPhoneActivation} style={{ marginTop: 10 }}>
            <div className="actions">
              <button type="submit" disabled={activationBusy} className={`btn ${activationBusy ? "" : "btnPrimary"}`}>
                {activationBusy
                  ? zh
                    ? "發送中..."
                    : "Sending..."
                  : zh
                    ? "寄送啟用信"
                    : "Send Activation Email"}
              </button>
              <Link className="btn" href="/member/activate">
                {zh ? "前往啟用頁" : "Open Activation Page"}
              </Link>
            </div>
          </form>
          <div className="sub" style={{ marginTop: 10, opacity: 0.8 }}>
            {zh ? "若尚未收到信件，請先確認櫃台已填寫此會員 Email。" : "If no email arrives, ask frontdesk to verify the member email record."}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<main className="container">{t("common.loading")}</main>}>
      <LoginContent />
    </Suspense>
  );
}
