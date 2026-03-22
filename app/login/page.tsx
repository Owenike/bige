"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "../i18n-provider";

type MeResponse = {
  userId: string;
  role: "platform_admin" | "manager" | "supervisor" | "branch_manager" | "frontdesk" | "coach" | "sales" | "member";
  tenantId: string | null;
  branchId: string | null;
};

type MemberActivationRequestResponse = {
  accepted?: boolean;
  maskedEmail?: string;
  expiresAt?: string;
  error?: string;
};

type LoginIntent = "shared" | "frontdesk" | "manager" | "coach" | "platform" | "member";

function formatActivationDeliveryMessage(params: {
  zh: boolean;
  locale: string;
  maskedEmail?: string;
  expiresAt?: string;
}) {
  const emailHint = params.maskedEmail
    ? params.zh
      ? `啟用信已寄到 ${params.maskedEmail}`
      : `Activation email sent to ${params.maskedEmail}`
    : params.zh
      ? "啟用信已寄出，請至綁定信箱收信。"
      : "Activation email sent. Please check your email.";

  if (!params.expiresAt) return emailHint;

  const expiry = new Date(params.expiresAt);
  if (Number.isNaN(expiry.getTime())) return emailHint;

  const expiryHint = expiry.toLocaleString(params.locale === "en" ? "en-US" : "zh-TW");
  return params.zh ? `${emailHint}（連結有效至 ${expiryHint}）` : `${emailHint} (link valid until ${expiryHint})`;
}

function roleHome(role: MeResponse["role"]) {
  switch (role) {
    case "platform_admin":
      return "/platform-admin";
    case "manager":
    case "supervisor":
    case "branch_manager":
      return "/manager";
    case "frontdesk":
      return "/frontdesk";
    case "coach":
      return "/coach";
    case "sales":
      return "/";
    case "member":
      return "/member";
    default:
      return "/";
  }
}

function resolveLoginIntent(redirectTo: string | null): LoginIntent {
  if (!redirectTo) return "shared";
  if (redirectTo === "/frontdesk" || redirectTo.startsWith("/frontdesk/")) return "frontdesk";
  if (redirectTo === "/manager" || redirectTo.startsWith("/manager/")) return "manager";
  if (redirectTo === "/coach" || redirectTo.startsWith("/coach/")) return "coach";
  if (redirectTo === "/platform-admin" || redirectTo.startsWith("/platform-admin/")) return "platform";
  if (redirectTo === "/member" || redirectTo.startsWith("/member/")) return "member";
  return "shared";
}

function describeLoginIntent(intent: LoginIntent, zh: boolean) {
  switch (intent) {
    case "frontdesk":
      return zh ? "你現在要進入櫃檯工作台，請使用員工帳號登入。" : "You are signing in to the frontdesk workbench. Use a staff account.";
    case "manager":
      return zh ? "你現在要進入管理後台，請使用管理/員工帳號登入。" : "You are signing in to the manager console. Use a manager or staff account.";
    case "coach":
      return zh ? "你現在要進入教練工作台，請使用教練帳號登入。" : "You are signing in to the coach workspace. Use a coach account.";
    case "platform":
      return zh ? "你現在要進入平台管理入口，請使用平台管理帳號登入。" : "You are signing in to the platform admin console. Use a platform admin account.";
    case "member":
      return zh ? "你現在要進入會員入口，請使用會員登入或會員啟用入口。" : "You are signing in to the member portal. Use member sign-in or activation.";
    default:
      return zh ? "這是共用登入入口，請依角色選擇下方登入方式。" : "This is a shared login hub. Choose the section that matches your role.";
  }
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const zh = locale !== "en";

  const redirectTo = useMemo(() => {
    const value = searchParams.get("redirect");
    if (!value || !value.startsWith("/")) return null;
    return value;
  }, [searchParams]);
  const loginIntent = useMemo(() => resolveLoginIntent(redirectTo), [redirectTo]);
  const staffFocused = loginIntent === "frontdesk" || loginIntent === "manager" || loginIntent === "coach" || loginIntent === "platform";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberLoginBusy, setMemberLoginBusy] = useState(false);
  const [memberLoginError, setMemberLoginError] = useState<string | null>(null);

  const [activationPhone, setActivationPhone] = useState("");
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
    setActivationError(null);
    setActivationMessage(null);
    setMemberLoginError(null);

    try {
      const res = await fetch("/api/auth/member-activation/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: activationPhone }),
      });

      const payload = (await res.json().catch(() => null)) as MemberActivationRequestResponse | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "發送啟用信失敗" : "Failed to send activation email"));

      setActivationMessage(
        formatActivationDeliveryMessage({
          zh,
          locale,
          maskedEmail: payload?.maskedEmail,
          expiresAt: payload?.expiresAt,
        }),
      );
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
      <div style={{ display: "grid", gap: 12 }}>
        <section className="card formCard" style={{ display: "grid", gap: 10 }}>
          <div className="kvLabel">{zh ? "共用登入入口" : "Shared Login Hub"}</div>
          <h1 className="sectionTitle">{zh ? "登入與帳號入口" : "Sign In and Account Access"}</h1>
          <p className="sub">{describeLoginIntent(loginIntent, zh)}</p>
          <div className="actions">
            <a className={`btn ${staffFocused ? "btnPrimary" : ""}`} href="#staff-login">
              {zh ? "員工 / 後台登入" : "Staff / Backoffice"}
            </a>
            <a className={`btn ${loginIntent === "member" ? "btnPrimary" : ""}`} href="#member-login">
              {zh ? "會員登入" : "Member Login"}
            </a>
            <a className="btn" href="#member-activation">
              {zh ? "會員啟用入口" : "Member Activation"}
            </a>
          </div>
          {redirectTo ? (
            <div className="sub" style={{ opacity: 0.8 }}>
              {zh ? `登入完成後將返回：${redirectTo}` : `After sign-in you will return to: ${redirectTo}`}
            </div>
          ) : null}
        </section>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <section
            id="staff-login"
            className="card formCard"
            style={staffFocused ? { borderColor: "rgba(37, 99, 235, 0.35)", boxShadow: "0 0 0 1px rgba(37, 99, 235, 0.15)" } : undefined}
          >
            <div className="kvLabel">{zh ? "員工 / 後台登入" : "Staff / Backoffice"}</div>
            <h2 className="sectionTitle" style={{ marginTop: 10 }}>
              {zh ? "Email + 密碼登入" : "Email + Password Sign In"}
            </h2>
            <p className="sub" style={{ marginTop: 8 }}>
              {staffFocused
                ? describeLoginIntent(loginIntent, zh)
                : zh
                  ? "適用於櫃檯、管理、教練與平台管理帳號。"
                  : "Use this section for frontdesk, manager, coach, and platform admin accounts."}
            </p>

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
                  autoFocus={staffFocused}
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
          </section>

          <section id="member-login" className="card formCard">
            <div className="kvLabel">{zh ? "會員登入" : "Member Login"}</div>
            <h2 className="sectionTitle" style={{ marginTop: 10 }}>
              {zh ? "手機 + 密碼登入" : "Phone + Password Sign In"}
            </h2>
            <p className="sub" style={{ marginTop: 8 }}>
              {zh
                ? "僅限櫃檯已建檔且已啟用的會員。若尚未啟用，請改用右側的會員啟用入口。"
                : "For activated frontdesk-created members. If the account is not activated yet, use the member activation section."}
            </p>

            {memberLoginError ? (
              <div className="error" style={{ marginTop: 12 }}>
                {memberLoginError}
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
          </section>

          <section id="member-activation" className="card formCard">
            <div className="kvLabel">{zh ? "會員啟用入口" : "Member Activation"}</div>
            <h2 className="sectionTitle" style={{ marginTop: 10 }}>
              {zh ? "寄送啟用信 / 設定密碼" : "Send Activation Email / Set Password"}
            </h2>
            <p className="sub" style={{ marginTop: 8 }}>
              {zh
                ? "給尚未啟用的會員使用。先輸入手機號碼寄送啟用信，再前往啟用頁設定密碼。"
                : "For members who have not activated their account yet. Send an activation email first, then set a password on the activation page."}
            </p>

            {activationError ? (
              <div className="error" style={{ marginTop: 12 }}>
                {activationError}
              </div>
            ) : null}

            {activationMessage ? (
              <div className="ok" style={{ marginTop: 12 }}>
                {activationMessage}
              </div>
            ) : null}

            <form onSubmit={submitPhoneActivation} style={{ marginTop: 12 }}>
              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {zh ? "手機號碼" : "Phone"}
                </span>
                <input
                  className="input"
                  value={activationPhone}
                  onChange={(e) => setActivationPhone(e.target.value)}
                  placeholder={zh ? "09xxxxxxxx" : "Phone number"}
                  type="tel"
                  autoComplete="tel"
                  required
                />
              </label>

              <div className="actions" style={{ marginTop: 14 }}>
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
              {zh ? "若尚未收到信件，請先確認櫃檯已填寫此會員 Email。" : "If no email arrives, ask frontdesk to verify the member email record."}
            </div>
          </section>
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
