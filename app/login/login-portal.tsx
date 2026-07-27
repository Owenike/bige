"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "../i18n-provider";
import LangSwitch from "../lang-switch";

type Role = "platform_admin" | "manager" | "supervisor" | "branch_manager" | "frontdesk" | "coach" | "sales" | "member";

type MeResponse = {
  userId: string;
  role: Role;
  tenantId: string | null;
  branchId: string | null;
  mustChangePassword?: boolean;
  staffActivationStatus?: string | null;
};

type MemberActivationRequestResponse = {
  accepted?: boolean;
  maskedEmail?: string;
  expiresAt?: string;
  error?: string;
};

type LoginPanel = "staff" | "member" | "activation";
export type LoginPortal = "staff" | "member";

type LoginEntryCopy = {
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
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

function staffLoginErrorMessage(message: unknown, zh: boolean) {
  const normalized = typeof message === "string" ? message.trim() : "";
  if (normalized === "Invalid credentials") {
    return zh
      ? "員工編號、正式密碼或一次性啟用碼不正確。"
      : "The employee number, password, or activation code is incorrect.";
  }
  return normalized || (zh ? "員工登入失敗，請稍後再試。" : "Staff sign-in failed. Please try again.");
}

function resolveLoginEntryCopy(panel: LoginPanel, returnTo: string | null, zh: boolean): LoginEntryCopy {
  if (panel === "member") {
    return {
      eyebrow: zh ? "會員登入入口" : "Member Login Entry",
      title: zh ? "會員登入" : "Member Sign In",
      description: zh
        ? "會員請使用手機號碼與密碼登入，查看個人資料與相關服務。"
        : "Members should sign in with phone number and password to view profile and service details.",
    };
  }

  if (panel === "activation") {
    return {
      eyebrow: zh ? "會員啟用入口" : "Member Activation Entry",
      title: zh ? "首次啟用會員帳號" : "Activate Member Account",
      description: zh
        ? "尚未設定密碼的會員，請先輸入手機號碼寄送啟用信。"
        : "Members who have not set a password should enter a phone number to receive an activation email.",
    };
  }

  if (returnTo === "/admin/trial-bookings") {
    return {
      eyebrow: zh ? "管理後台入口" : "Admin Entry",
      title: zh ? "首次體驗預約管理登入" : "Trial Booking Admin Sign In",
      description: zh
        ? "登入後會前往首次體驗預約管理頁，查看預約名單、付款狀態與預約狀態。"
        : "After sign-in you will open the trial booking admin page to review bookings, payment status, and booking status.",
      badge: zh ? "登入後前往：首次體驗預約管理" : "After sign-in: Trial Booking Admin",
    };
  }

  if (returnTo === "/admin/student-check-ins") {
    return {
      eyebrow: zh ? "管理後台入口" : "Admin Entry",
      title: zh ? "自主運動報到管理登入" : "Student Check-in Admin Sign In",
      description: zh
        ? "登入後會前往自主運動報到管理頁，確認現場學員身分並處理放行。"
        : "After sign-in you will open the student check-in admin page to verify members and approve entry.",
      badge: zh ? "登入後前往：自主運動報到管理" : "After sign-in: Student Check-in Admin",
    };
  }

  if (returnTo === "/platform-admin") {
    return {
      eyebrow: zh ? "平台管理入口" : "Platform Admin Entry",
      title: zh ? "平台管理登入" : "Platform Admin Sign In",
      description: zh
        ? "登入後會前往租戶與帳號控制台，管理平台設定、租戶與功能開關。"
        : "After sign-in you will open the tenant and account console for platform settings, tenants, and feature flags.",
      badge: zh ? "登入後前往：平台管理" : "After sign-in: Platform Admin",
    };
  }

  return {
    eyebrow: zh ? "員工登入入口" : "Staff Login Entry",
    title: zh ? "員工後台登入" : "Staff Sign In",
    description: zh
      ? "首次登入使用員工編號與一次性啟用碼；完成啟用後改用員工編號與正式密碼。"
      : "Use employee number and a one-time activation code first, then employee number and permanent password.",
  };
}

function LoginContent({ portal }: { portal: LoginPortal }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const zh = locale !== "en";

  const returnTo = useMemo(() => {
    const requestedReturnTo = searchParams.get("returnTo");
    if (isSafeReturnTo(requestedReturnTo)) {
      return portal === "member" && !requestedReturnTo.startsWith("/member") ? null : requestedReturnTo;
    }

    const legacyRedirect = searchParams.get("redirect");
    if (isSafeReturnTo(legacyRedirect)) {
      return portal === "member" && !legacyRedirect.startsWith("/member") ? null : legacyRedirect;
    }

    const legacyNext = searchParams.get("next");
    if (isSafeReturnTo(legacyNext)) {
      return portal === "member" && !legacyNext.startsWith("/member") ? null : legacyNext;
    }

    return null;
  }, [portal, searchParams]);
  const isFocusedBackofficeEntry =
    returnTo === "/admin/trial-bookings" ||
    returnTo === "/admin/student-check-ins" ||
    returnTo === "/platform-admin";
  const isStudentCheckInAdminEntry = returnTo === "/admin/student-check-ins";
  const selectedPanel = useMemo(() => {
    if (portal === "staff" || isFocusedBackofficeEntry) return "staff";
    return searchParams.get("tab") === "activation" ? "activation" : "member";
  }, [isFocusedBackofficeEntry, portal, searchParams]);
  const [activePanel, setActivePanel] = useState<LoginPanel>(() => selectedPanel);

  useEffect(() => {
    setActivePanel(selectedPanel);
  }, [selectedPanel]);

  const entryCopy = useMemo(() => resolveLoginEntryCopy(activePanel, returnTo, zh), [activePanel, returnTo, zh]);

  const [employeeNumber, setEmployeeNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showStaffPassword, setShowStaffPassword] = useState(false);
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
        body: JSON.stringify({ employeeNumber, password }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(staffLoginErrorMessage(payload?.error, zh));

      const meRes = await fetch("/api/auth/me");
      const mePayload = (await meRes.json().catch(() => null)) as MeResponse | null;
      if (!meRes.ok || !mePayload?.role) throw new Error((mePayload as { error?: string } | null)?.error || "Profile not ready");
      if (mePayload.role === "member") {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
        throw new Error(zh ? "會員請使用會員登入入口。" : "Members must use the member login.");
      }

      router.replace(
        mePayload.staffActivationStatus && mePayload.staffActivationStatus !== "completed"
          ? "/staff/activate"
          : mePayload.mustChangePassword
            ? "/staff/change-password"
            : returnTo || roleHome(mePayload.role),
      );
    } catch (err) {
      setError(staffLoginErrorMessage(err instanceof Error ? err.message : null, zh));
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

      router.replace(mePayload.mustChangePassword ? "/staff/change-password" : returnTo || roleHome(mePayload.role));
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
    <main
      className={isStudentCheckInAdminEntry ? "studentAdminLoginPage" : "container"}
      style={isStudentCheckInAdminEntry ? undefined : { paddingTop: 28, paddingBottom: 48 }}
    >
      <section
        className={isStudentCheckInAdminEntry ? "studentAdminLoginPanel" : "card formCard"}
        style={isStudentCheckInAdminEntry ? undefined : { display: "grid", gap: 16, maxWidth: 640, margin: "0 auto" }}
      >
        {!isStudentCheckInAdminEntry ? (
          <div style={{ alignItems: "center", display: "flex", gap: 16, justifyContent: "space-between" }}>
            <Link href="/" aria-label={zh ? "返回 BigE Fitness 首頁" : "Back to BigE Fitness home"} style={{ color: "inherit", textDecoration: "none" }}>
              <strong style={{ fontSize: "1.15rem" }}>BIGE</strong>
            </Link>
            <LangSwitch />
          </div>
        ) : null}

        {isStudentCheckInAdminEntry ? (
          <Link className="studentAdminLoginBrand" href="/" aria-label="返回 BigE Fitness 首頁">
            <strong>BIGE</strong>
            <span>FITNESS</span>
          </Link>
        ) : null}

        {isStudentCheckInAdminEntry || portal === "member" ? (
          <div className={isStudentCheckInAdminEntry ? "studentAdminLoginHeading" : undefined} style={{ display: "grid", gap: 8 }}>
            <div className={isStudentCheckInAdminEntry ? "studentAdminLoginEyebrow" : "kvLabel"}>
              {isStudentCheckInAdminEntry ? "STAFF SIGN IN" : entryCopy.eyebrow}
            </div>
            <h1 className={isStudentCheckInAdminEntry ? "studentAdminLoginTitle" : "sectionTitle"}>
              {isStudentCheckInAdminEntry ? (zh ? "自主運動報到管理" : "Student Check-in Admin") : entryCopy.title}
            </h1>
            {!isStudentCheckInAdminEntry ? <p className="sub">{entryCopy.description}</p> : null}
            {!isStudentCheckInAdminEntry && entryCopy.badge ? (
              <div
                className="pill"
                style={{
                  width: "fit-content",
                  maxWidth: "100%",
                  color: "var(--ink)",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {entryCopy.badge}
              </div>
            ) : null}
          </div>
        ) : null}

        {!isStudentCheckInAdminEntry && portal === "member" ? <div
          aria-label={zh ? "登入方式" : "Sign-in method"}
          role="tablist"
          style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
        >
          <button
            aria-selected={activePanel === "member"}
            className={`btn ${activePanel === "member" ? "btnPrimary" : ""}`}
            onClick={() => setActivePanel("member")}
            role="tab"
            type="button"
          >
            {zh ? "會員登入" : "Member Login"}
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
        </div> : null}

        {activePanel === "staff" ? (
          <section
            id="staff-login"
            className={isStudentCheckInAdminEntry ? "studentAdminLoginFormSection" : undefined}
            role={isStudentCheckInAdminEntry ? undefined : "tabpanel"}
            style={{ display: "grid", gap: 12 }}
          >
            {error ? <div className="error">{error}</div> : null}

            <form
              className={isStudentCheckInAdminEntry ? "studentAdminLoginForm" : undefined}
              onSubmit={submit}
              style={{ display: "grid", gap: 12 }}
            >
              <label className="field">
                <span className={isStudentCheckInAdminEntry ? "studentAdminLoginLabel" : "kvLabel"} style={{ textTransform: "none" }}>
                  {zh ? "員工編號" : "Employee number"}
                </span>
                <input
                  autoComplete="username"
                  autoCapitalize="characters"
                  autoFocus={activePanel === "staff"}
                  className="input"
                  onChange={(e) => setEmployeeNumber(e.target.value.toUpperCase())}
                  placeholder="E000001"
                  required
                  type="text"
                  value={employeeNumber}
                />
              </label>

              <div className="field">
                <label
                  className={isStudentCheckInAdminEntry ? "studentAdminLoginLabel" : "kvLabel"}
                  htmlFor="staff-password"
                  style={{ textTransform: "none" }}
                >
                  {zh ? "正式密碼／一次性啟用碼" : "Permanent password / activation code"}
                </label>
                <div className={isStudentCheckInAdminEntry ? "studentAdminLoginPasswordField" : undefined}>
                  <input
                    autoComplete="current-password"
                    className="input"
                    id="staff-password"
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={zh ? "首次登入請向主管索取啟用碼" : "First sign-in: request a code from your supervisor"}
                    required
                    type={isStudentCheckInAdminEntry && showStaffPassword ? "text" : "password"}
                    value={password}
                  />
                  {isStudentCheckInAdminEntry ? (
                    <button
                      aria-label={showStaffPassword ? "隱藏密碼" : "顯示密碼"}
                      className="studentAdminLoginPasswordToggle"
                      onClick={() => setShowStaffPassword((visible) => !visible)}
                      title={showStaffPassword ? "隱藏密碼" : "顯示密碼"}
                      type="button"
                    >
                      {showStaffPassword ? "隱藏" : "顯示"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className={isStudentCheckInAdminEntry ? "studentAdminLoginActions" : "actions"} style={{ marginTop: 2 }}>
                <button
                  className={isStudentCheckInAdminEntry ? "studentAdminLoginSubmit" : `btn ${busy ? "" : "btnPrimary"}`}
                  disabled={busy}
                  type="submit"
                >
                  {busy ? t("auth.signing_in") : isStudentCheckInAdminEntry ? (zh ? "登入後台" : "Sign In") : t("auth.sign_in")}
                </button>
                <Link className={isStudentCheckInAdminEntry ? "studentAdminLoginLink" : "btn"} href="/forgot-password">
                  {zh ? "忘記密碼" : "Forgot Password"}
                </Link>
                <Link className={isStudentCheckInAdminEntry ? "studentAdminLoginLink" : "btn"} href="/">
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

export default function LoginPortalPage({ portal }: { portal: LoginPortal }) {
  const { t } = useI18n();
  return (
    <Suspense fallback={<main className="container">{t("common.loading")}</main>}>
      <LoginContent portal={portal} />
    </Suspense>
  );
}
