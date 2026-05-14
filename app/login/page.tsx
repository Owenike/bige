"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "../i18n-provider";

type Role = "platform_admin" | "manager" | "supervisor" | "branch_manager" | "frontdesk" | "coach" | "sales" | "member";

type MeResponse = {
  userId: string;
  role: Role;
  tenantId: string | null;
  branchId: string | null;
};

type MemberActivationRequestResponse = {
  accepted?: boolean;
  maskedEmail?: string;
  expiresAt?: string;
  error?: string;
};

type LoginIntent = "shared" | "frontdesk_entry" | "frontdesk_bookings" | "manager" | "coach" | "platform" | "member";

type LoginPanel = "staff" | "member" | "activation";

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
      ? "啟用信已寄出，請檢查 Email。"
      : "Activation email sent. Please check your email.";

  if (!params.expiresAt) return emailHint;

  const expiry = new Date(params.expiresAt);
  if (Number.isNaN(expiry.getTime())) return emailHint;

  const expiryHint = expiry.toLocaleString(params.locale === "en" ? "en-US" : "zh-TW");
  return params.zh ? `${emailHint} 有效期限：${expiryHint}` : `${emailHint} (link valid until ${expiryHint})`;
}

function roleHome(role: Role) {
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
  if (redirectTo === "/frontdesk/bookings" || redirectTo.startsWith("/frontdesk/bookings/")) return "frontdesk_bookings";
  if (redirectTo === "/frontdesk" || redirectTo.startsWith("/frontdesk/")) return "frontdesk_entry";
  if (redirectTo === "/manager" || redirectTo.startsWith("/manager/")) return "manager";
  if (redirectTo === "/coach" || redirectTo.startsWith("/coach/")) return "coach";
  if (redirectTo === "/platform-admin" || redirectTo.startsWith("/platform-admin/")) return "platform";
  if (redirectTo === "/member" || redirectTo.startsWith("/member/")) return "member";
  return "shared";
}

function resolveReturnLabel(intent: LoginIntent, zh: boolean) {
  switch (intent) {
    case "frontdesk_entry":
      return zh ? "登入後將返回櫃檯入口。" : "After sign-in you will return to the frontdesk entry page.";
    case "frontdesk_bookings":
      return zh ? "登入後將返回櫃檯排班作業台。" : "After sign-in you will return to the booking board.";
    case "manager":
      return zh ? "登入後將返回管理後台。" : "After sign-in you will return to the manager console.";
    case "coach":
      return zh ? "登入後將返回教練工作台。" : "After sign-in you will return to the coach workspace.";
    case "platform":
      return zh ? "登入後將返回平台管理後台。" : "After sign-in you will return to the platform admin console.";
    case "member":
      return zh ? "登入後將返回會員中心。" : "After sign-in you will return to the member portal.";
    default:
      return null;
  }
}

function resolveLoginPanel(tab: string | null): LoginPanel {
  if (tab === "member" || tab === "activation" || tab === "staff") return tab;
  return "staff";
}

function isSafeReturnTo(value: string | null): value is string {
  if (!value) return false;
  const lowerValue = value.toLowerCase();
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !lowerValue.includes("http://") &&
    !lowerValue.includes("https://")
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const zh = locale !== "en";

  const returnTo = useMemo(() => {
    const requestedReturnTo = searchParams.get("returnTo");
    if (isSafeReturnTo(requestedReturnTo)) return requestedReturnTo;

    const legacyRedirect = searchParams.get("redirect");
    if (isSafeReturnTo(legacyRedirect)) return legacyRedirect;

    const legacyNext = searchParams.get("next");
    if (isSafeReturnTo(legacyNext)) return legacyNext;

    return null;
  }, [searchParams]);
  const selectedPanel = useMemo(() => resolveLoginPanel(searchParams.get("tab")), [searchParams]);
  const loginIntent = useMemo(() => resolveLoginIntent(returnTo), [returnTo]);
  const returnLabel = useMemo(() => resolveReturnLabel(loginIntent, zh), [loginIntent, zh]);
  const [activePanel, setActivePanel] = useState<LoginPanel>(() => selectedPanel);

  useEffect(() => {
    setActivePanel(selectedPanel);
  }, [selectedPanel]);

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
      if (!meRes.ok || !mePayload?.role) throw new Error((mePayload as { error?: string } | null)?.error || "Profile not ready");

      router.replace(returnTo || roleHome(mePayload.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
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
      if (!res.ok) throw new Error(payload?.error || (zh ? "會員登入失敗" : "Phone login failed"));

      const meRes = await fetch("/api/auth/me");
      const mePayload = (await meRes.json().catch(() => null)) as MeResponse | null;
      if (!meRes.ok || !mePayload?.role) throw new Error((mePayload as { error?: string } | null)?.error || "Profile not ready");

      router.replace(returnTo || roleHome(mePayload.role));
    } catch (err) {
      setMemberLoginError(err instanceof Error ? err.message : zh ? "會員登入失敗" : "Phone login failed");
    } finally {
      setMemberLoginBusy(false);
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
      if (!res.ok) throw new Error(payload?.error || (zh ? "無法寄送啟用信" : "Failed to send activation email"));

      setActivationMessage(
        formatActivationDeliveryMessage({
          zh,
          locale,
          maskedEmail: payload?.maskedEmail,
          expiresAt: payload?.expiresAt,
        }),
      );
    } catch (err) {
      setActivationError(err instanceof Error ? err.message : zh ? "無法寄送啟用信" : "Failed to send activation email");
    } finally {
      setActivationBusy(false);
    }
  }

  return (
    <main className="container" style={{ paddingTop: 28, paddingBottom: 48 }}>
      <section className="card formCard" style={{ display: "grid", gap: 16, maxWidth: 640, margin: "0 auto" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div className="kvLabel">{zh ? "共用登入入口" : "Shared Login Hub"}</div>
          <h1 className="sectionTitle">{zh ? "登入與帳號存取" : "Sign In and Account Access"}</h1>
          <p className="sub">
            {zh
              ? "請依身分選擇登入方式。每次只會顯示一個表單，避免誤用入口。"
              : "Choose the sign-in path for your role. Only one form is shown at a time."}
          </p>
          {returnLabel ? (
            <div className="sub" style={{ opacity: 0.82 }}>
              {returnLabel}
            </div>
          ) : null}
          {returnTo ? (
            <div className="sub" style={{ opacity: 0.68 }}>
              {`Return path: ${returnTo}`}
            </div>
          ) : null}
        </div>

        <div
          aria-label={zh ? "登入方式" : "Sign-in method"}
          role="tablist"
          style={{
            display: "grid",
            gap: 8,
            gridTemplateColumns: "repeat(auto-fit, minmax(138px, 1fr))",
          }}
        >
          <button
            aria-selected={activePanel === "staff"}
            className={`btn ${activePanel === "staff" ? "btnPrimary" : ""}`}
            onClick={() => setActivePanel("staff")}
            role="tab"
            type="button"
          >
            {zh ? "員工 / 後台" : "Staff"}
          </button>
          <button
            aria-selected={activePanel === "member"}
            className={`btn ${activePanel === "member" ? "btnPrimary" : ""}`}
            onClick={() => setActivePanel("member")}
            role="tab"
            type="button"
          >
            {zh ? "會員登入" : "Member"}
          </button>
          <button
            aria-selected={activePanel === "activation"}
            className={`btn ${activePanel === "activation" ? "btnPrimary" : ""}`}
            onClick={() => setActivePanel("activation")}
            role="tab"
            type="button"
          >
            {zh ? "首次啟用" : "Activation"}
          </button>
        </div>

        {activePanel === "staff" ? (
          <section id="staff-login" role="tabpanel" style={{ display: "grid", gap: 12 }}>
            <div>
              <div className="kvLabel">{zh ? "員工 / 後台登入" : "Staff / Backoffice"}</div>
              <h2 className="sectionTitle" style={{ fontSize: "1.28rem", marginTop: 8 }}>
                {zh ? "Email + 密碼登入" : "Email + Password"}
              </h2>
              <p className="sub" style={{ marginTop: 8 }}>
                {zh
                  ? "櫃檯、教練、管理、平台角色請使用 Email 與密碼登入。"
                  : "Frontdesk, coach, manager, and platform roles should sign in with email and password."}
              </p>
            </div>

            {error ? <div className="error">{error}</div> : null}

            <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {t("auth.email")}
                </span>
                <input
                  autoComplete="email"
                  autoFocus={activePanel === "staff"}
                  className="input"
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                />
              </label>

              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {t("auth.password")}
                </span>
                <input
                  autoComplete="current-password"
                  className="input"
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="********"
                  required
                  type="password"
                  value={password}
                />
              </label>

              <div className="actions" style={{ marginTop: 2 }}>
                <button className={`btn ${busy ? "" : "btnPrimary"}`} disabled={busy} type="submit">
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
        ) : null}

        {activePanel === "member" ? (
          <section id="member-login" role="tabpanel" style={{ display: "grid", gap: 12 }}>
            <div>
              <div className="kvLabel">{zh ? "會員登入" : "Member Login"}</div>
              <h2 className="sectionTitle" style={{ fontSize: "1.28rem", marginTop: 8 }}>
                {zh ? "手機 + 密碼登入" : "Phone + Password"}
              </h2>
              <p className="sub" style={{ marginTop: 8 }}>
                {zh ? "會員請使用手機號碼與密碼登入。" : "Members should sign in with phone number and password."}
              </p>
            </div>

            {memberLoginError ? <div className="error">{memberLoginError}</div> : null}

            <form onSubmit={submitPhoneLogin} style={{ display: "grid", gap: 12 }}>
              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {zh ? "手機號碼" : "Phone"}
                </span>
                <input
                  autoComplete="tel"
                  className="input"
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={zh ? "09xxxxxxxx" : "Phone number"}
                  required
                  type="tel"
                  value={phone}
                />
              </label>

              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {zh ? "密碼" : "Password"}
                </span>
                <input
                  autoComplete="current-password"
                  className="input"
                  onChange={(e) => setMemberPassword(e.target.value)}
                  placeholder="********"
                  required
                  type="password"
                  value={memberPassword}
                />
              </label>

              <div className="actions" style={{ marginTop: 2 }}>
                <button className={`btn ${memberLoginBusy ? "" : "btnPrimary"}`} disabled={memberLoginBusy} type="submit">
                  {memberLoginBusy ? (zh ? "登入中..." : "Signing in...") : zh ? "會員登入" : "Phone Login"}
                </button>
                <Link className="btn" href="/">
                  {t("common.back_home")}
                </Link>
              </div>
            </form>
          </section>
        ) : null}

        {activePanel === "activation" ? (
          <section id="member-activation" role="tabpanel" style={{ display: "grid", gap: 12 }}>
            <div>
              <div className="kvLabel">{zh ? "會員首次啟用" : "Member Activation"}</div>
              <h2 className="sectionTitle" style={{ fontSize: "1.28rem", marginTop: 8 }}>
                {zh ? "寄送啟用信" : "Send Activation Email"}
              </h2>
              <p className="sub" style={{ marginTop: 8 }}>
                {zh
                  ? "尚未設定密碼的會員，請先輸入手機號碼寄送啟用信。"
                  : "Members without a password should enter their phone number to receive an activation email."}
              </p>
            </div>

            {activationError ? <div className="error">{activationError}</div> : null}
            {activationMessage ? <div className="ok">{activationMessage}</div> : null}

            <form onSubmit={submitPhoneActivation} style={{ display: "grid", gap: 12 }}>
              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {zh ? "手機號碼" : "Phone"}
                </span>
                <input
                  autoComplete="tel"
                  className="input"
                  onChange={(e) => setActivationPhone(e.target.value)}
                  placeholder={zh ? "09xxxxxxxx" : "Phone number"}
                  required
                  type="tel"
                  value={activationPhone}
                />
              </label>

              <div className="actions" style={{ marginTop: 2 }}>
                <button className={`btn ${activationBusy ? "" : "btnPrimary"}`} disabled={activationBusy} type="submit">
                  {activationBusy ? (zh ? "寄送中..." : "Sending...") : zh ? "寄送啟用信" : "Send Activation Email"}
                </button>
                <Link className="btn" href="/member/activate">
                  {zh ? "開啟啟用頁" : "Open Activation Page"}
                </Link>
                <Link className="btn" href="/">
                  {t("common.back_home")}
                </Link>
              </div>
            </form>
          </section>
        ) : null}
      </section>
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
