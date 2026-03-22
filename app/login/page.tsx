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

type LoginIntent =
  | "shared"
  | "frontdesk_entry"
  | "frontdesk_bookings"
  | "manager"
  | "coach"
  | "platform"
  | "member";

type IntentContent = {
  hubLabel: string;
  title: string;
  subtitle: string;
  returnLabel: string | null;
  staffDescription: string;
  memberDescription: string;
  activationDescription: string;
};

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
      ? "啟用信已送出，請檢查你的 Email。"
      : "Activation email sent. Please check your email.";

  if (!params.expiresAt) return emailHint;

  const expiry = new Date(params.expiresAt);
  if (Number.isNaN(expiry.getTime())) return emailHint;

  const expiryHint = expiry.toLocaleString(params.locale === "en" ? "en-US" : "zh-TW");
  return params.zh ? `${emailHint} 連結有效至 ${expiryHint}` : `${emailHint} (link valid until ${expiryHint})`;
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
  if (redirectTo === "/frontdesk/bookings" || redirectTo.startsWith("/frontdesk/bookings/")) return "frontdesk_bookings";
  if (redirectTo === "/frontdesk" || redirectTo.startsWith("/frontdesk/")) return "frontdesk_entry";
  if (redirectTo === "/manager" || redirectTo.startsWith("/manager/")) return "manager";
  if (redirectTo === "/coach" || redirectTo.startsWith("/coach/")) return "coach";
  if (redirectTo === "/platform-admin" || redirectTo.startsWith("/platform-admin/")) return "platform";
  if (redirectTo === "/member" || redirectTo.startsWith("/member/")) return "member";
  return "shared";
}

function getIntentContent(intent: LoginIntent, zh: boolean): IntentContent {
  switch (intent) {
    case "frontdesk_entry":
      return {
        hubLabel: zh ? "櫃檯入口登入" : "Frontdesk Entry Sign In",
        title: zh ? "登入櫃檯入口頁" : "Sign In to Frontdesk Entry",
        subtitle: zh
          ? "登入後將前往櫃檯入口頁。請使用櫃檯或其他員工帳號。"
          : "After sign-in you will be taken to the frontdesk entry page. Use a frontdesk or staff account.",
        returnLabel: zh ? "登入後將返回櫃檯入口頁" : "After sign-in you will return to the frontdesk entry page.",
        staffDescription: zh
          ? "櫃檯、管理、教練與平台帳號都使用 Email + 密碼登入。這個 intent 會帶你回到櫃檯入口頁。"
          : "Frontdesk, manager, coach, and platform accounts all use email + password sign-in. This intent returns you to the frontdesk entry page.",
        memberDescription: zh
          ? "會員登入區仍可使用，但櫃檯入口通常由員工帳號進入。"
          : "The member section remains available, but the frontdesk entry normally uses a staff account.",
        activationDescription: zh
          ? "若會員尚未啟用，請在這裡寄送啟用信；櫃檯入口登入本身仍使用員工帳號。"
          : "Use this section only to activate member accounts. Frontdesk entry sign-in itself still uses a staff account.",
      };
    case "frontdesk_bookings":
      return {
        hubLabel: zh ? "櫃檯排班工作台登入" : "Frontdesk Booking Board Sign In",
        title: zh ? "登入櫃檯排班工作台" : "Sign In to Frontdesk Booking Board",
        subtitle: zh
          ? "登入後將前往排班作業台。請使用櫃檯或其他員工帳號。"
          : "After sign-in you will be taken to the booking board. Use a frontdesk or staff account.",
        returnLabel: zh ? "登入後將返回排班作業台" : "After sign-in you will return to the booking board.",
        staffDescription: zh
          ? "這是櫃檯排班工作台登入。櫃檯、管理、教練與平台帳號都使用 Email + 密碼登入。"
          : "This sign-in is for the frontdesk booking board. Frontdesk, manager, coach, and platform accounts all use email + password sign-in.",
        memberDescription: zh
          ? "會員登入區保留在共用登入頁，但排班工作台本身不是會員入口。"
          : "The member section remains on the shared login page, but the booking board itself is not a member entry point.",
        activationDescription: zh
          ? "會員啟用入口保留在同一頁，但進入排班工作台請使用員工帳號。"
          : "Member activation stays on the same page, but the booking board should be accessed with a staff account.",
      };
    case "manager":
      return {
        hubLabel: zh ? "管理後台登入" : "Manager Console Sign In",
        title: zh ? "登入管理後台" : "Sign In to Manager Console",
        subtitle: zh
          ? "登入後將前往管理後台。請使用管理或員工帳號。"
          : "After sign-in you will be taken to the manager console. Use a manager or staff account.",
        returnLabel: zh ? "登入後將返回管理後台" : "After sign-in you will return to the manager console.",
        staffDescription: zh
          ? "管理、主管、櫃檯、教練與平台帳號都使用 Email + 密碼登入；此 intent 主要服務後台角色。"
          : "Manager, supervisor, frontdesk, coach, and platform accounts all use email + password sign-in; this intent mainly serves staff roles.",
        memberDescription: zh
          ? "會員登入區保留在共用登入頁，但管理後台不是會員入口。"
          : "The member section remains on the shared login page, but the manager console is not a member entry point.",
        activationDescription: zh
          ? "會員啟用入口保留在同一頁；若你要進入管理後台，請使用員工帳號。"
          : "Member activation stays on the same page; use a staff account if you are entering the manager console.",
      };
    case "coach":
      return {
        hubLabel: zh ? "教練工作台登入" : "Coach Workspace Sign In",
        title: zh ? "登入教練工作台" : "Sign In to Coach Workspace",
        subtitle: zh
          ? "登入後將前往教練工作台。請使用教練帳號。"
          : "After sign-in you will be taken to the coach workspace. Use a coach account.",
        returnLabel: zh ? "登入後將返回教練工作台" : "After sign-in you will return to the coach workspace.",
        staffDescription: zh
          ? "教練與平台帳號使用 Email + 密碼登入；這個 intent 會帶你回到教練工作台。"
          : "Coach and platform accounts use email + password sign-in; this intent returns you to the coach workspace.",
        memberDescription: zh
          ? "會員登入區保留在共用登入頁，但教練工作台不是會員入口。"
          : "The member section remains on the shared login page, but the coach workspace is not a member entry point.",
        activationDescription: zh
          ? "會員啟用入口保留在同一頁；若你要進入教練工作台，請使用教練帳號。"
          : "Member activation stays on the same page; use a coach account if you are entering the coach workspace.",
      };
    case "platform":
      return {
        hubLabel: zh ? "平台管理登入" : "Platform Admin Sign In",
        title: zh ? "登入平台管理台" : "Sign In to Platform Admin",
        subtitle: zh
          ? "登入後將前往平台管理台。請使用平台管理帳號。"
          : "After sign-in you will be taken to the platform admin console. Use a platform admin account.",
        returnLabel: zh ? "登入後將返回平台管理台" : "After sign-in you will return to the platform admin console.",
        staffDescription: zh
          ? "平台管理帳號使用 Email + 密碼登入；這個 intent 會帶你回到平台管理台。"
          : "Platform admin accounts use email + password sign-in; this intent returns you to the platform admin console.",
        memberDescription: zh
          ? "會員登入區保留在共用登入頁，但平台管理台不是會員入口。"
          : "The member section remains on the shared login page, but the platform admin console is not a member entry point.",
        activationDescription: zh
          ? "會員啟用入口保留在同一頁；若你要進入平台管理台，請使用平台管理帳號。"
          : "Member activation stays on the same page; use a platform admin account if you are entering the platform console.",
      };
    case "member":
      return {
        hubLabel: zh ? "會員登入" : "Member Sign In",
        title: zh ? "登入會員入口" : "Sign In to Member Portal",
        subtitle: zh
          ? "登入後將前往會員入口。會員使用手機 + 密碼登入；若尚未啟用，請先寄送啟用信。"
          : "After sign-in you will be taken to the member portal. Members use phone + password sign-in; if not activated yet, send an activation email first.",
        returnLabel: zh ? "登入後將返回會員入口" : "After sign-in you will return to the member portal.",
        staffDescription: zh
          ? "員工 / 後台登入區仍可使用，但會員入口通常使用手機 + 密碼登入。"
          : "The staff section remains available, but the member portal normally uses phone + password sign-in.",
        memberDescription: zh
          ? "會員請使用手機 + 密碼登入；若帳號尚未啟用，請使用會員啟用入口。"
          : "Members should use phone + password sign-in. If the account is not activated yet, use the member activation section.",
        activationDescription: zh
          ? "會員啟用入口會先寄送啟用信，再到啟用頁設定密碼。"
          : "Member activation sends an activation email first, then the password is set on the activation page.",
      };
    default:
      return {
        hubLabel: zh ? "共享登入入口" : "Shared Login Hub",
        title: zh ? "登入與帳號存取" : "Sign In and Account Access",
        subtitle: zh
          ? "這是共用登入頁。請依你的角色選擇員工登入、會員登入或會員啟用入口。"
          : "This is the shared sign-in page. Choose staff sign-in, member sign-in, or member activation based on your role.",
        returnLabel: null,
        staffDescription: zh
          ? "櫃檯 / 教練 / 管理 / 平台角色都使用 Email + 密碼登入。"
          : "Frontdesk, coach, manager, and platform roles all use email + password sign-in.",
        memberDescription: zh
          ? "會員使用手機 + 密碼登入；若帳號尚未啟用，請使用會員啟用入口。"
          : "Members use phone + password sign-in. If the account is not activated yet, use member activation.",
        activationDescription: zh
          ? "會員啟用入口會寄送啟用信，再到啟用頁設定密碼。"
          : "Member activation sends an activation email first, then the password is set on the activation page.",
      };
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
  const intentContent = useMemo(() => getIntentContent(loginIntent, zh), [loginIntent, zh]);
  const staffFocused =
    loginIntent === "frontdesk_entry" ||
    loginIntent === "frontdesk_bookings" ||
    loginIntent === "manager" ||
    loginIntent === "coach" ||
    loginIntent === "platform";
  const memberDeemphasized = staffFocused;

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

      router.replace(redirectTo || roleHome(mePayload.role));
    } catch (err) {
      setMemberLoginError(err instanceof Error ? err.message : zh ? "會員登入失敗" : "Phone login failed");
    } finally {
      setMemberLoginBusy(false);
    }
  }

  return (
    <main className="container">
      <div style={{ display: "grid", gap: 12 }}>
        <section className="card formCard" style={{ display: "grid", gap: 10 }}>
          <div className="kvLabel">{intentContent.hubLabel}</div>
          <h1 className="sectionTitle">{intentContent.title}</h1>
          <p className="sub">{intentContent.subtitle}</p>
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
          {intentContent.returnLabel ? (
            <div className="sub" style={{ opacity: 0.8 }}>
              {intentContent.returnLabel}
            </div>
          ) : null}
          {redirectTo ? (
            <div className="sub" style={{ opacity: 0.68 }}>
              {`Redirect path: ${redirectTo}`}
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
              {intentContent.staffDescription}
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

          <section
            id="member-login"
            className="card formCard"
            style={memberDeemphasized ? { opacity: 0.78, borderColor: "rgba(148, 163, 184, 0.32)" } : undefined}
          >
            <div className="kvLabel">{zh ? "會員登入" : "Member Login"}</div>
            <h2 className="sectionTitle" style={{ marginTop: 10 }}>
              {zh ? "手機 + 密碼登入" : "Phone + Password Sign In"}
            </h2>
            <p className="sub" style={{ marginTop: 8 }}>
              {intentContent.memberDescription}
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
                  {memberLoginBusy ? (zh ? "登入中..." : "Signing in...") : zh ? "會員登入" : "Phone Login"}
                </button>
              </div>
            </form>
          </section>

          <section
            id="member-activation"
            className="card formCard"
            style={memberDeemphasized ? { opacity: 0.82, borderColor: "rgba(148, 163, 184, 0.32)" } : undefined}
          >
            <div className="kvLabel">{zh ? "會員啟用入口" : "Member Activation"}</div>
            <h2 className="sectionTitle" style={{ marginTop: 10 }}>
              {zh ? "寄送啟用信 / 設定密碼" : "Send Activation Email / Set Password"}
            </h2>
            <p className="sub" style={{ marginTop: 8 }}>
              {intentContent.activationDescription}
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
                  {activationBusy ? (zh ? "寄送中..." : "Sending...") : zh ? "寄送啟用信" : "Send Activation Email"}
                </button>
                <Link className="btn" href="/member/activate">
                  {zh ? "開啟啟用頁" : "Open Activation Page"}
                </Link>
              </div>
            </form>

            <div className="sub" style={{ marginTop: 10, opacity: 0.8 }}>
              {zh ? "若沒有收到 Email，請請櫃檯確認會員 Email 資料是否正確。" : "If no email arrives, ask frontdesk to verify the member email record."}
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
