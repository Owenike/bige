"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "../i18n-provider";
import LangSwitch from "../lang-switch";
import loginStyles from "../login/login-portal.module.css";
import StaffAuthBackdrop from "../login/staff-auth-backdrop";
import styles from "./forbidden.module.css";

function getReasonText(code: string | null, zh: boolean) {
  if (code === "INACTIVE_ACCOUNT") {
    return zh ? "帳號尚未啟用或已停用，請聯絡管理員。" : "This account is inactive. Please contact your administrator.";
  }
  if (code === "BRANCH_SCOPE_DENIED") {
    return zh ? "目前帳號缺少分店權限，請聯絡管理員設定分店範圍。" : "This account is missing branch scope permissions.";
  }
  if (code === "TENANT_INACTIVE" || code === "SUBSCRIPTION_INACTIVE") {
    return zh ? "租戶或訂閱狀態限制，請聯絡管理員確認。" : "Tenant or subscription status is blocking access.";
  }
  return zh ? "您目前沒有這個頁面的存取權限。" : "You do not have access to this page.";
}

export default function ForbiddenContent({ code }: { code: string | null }) {
  const { locale } = useI18n();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const zh = locale !== "en";

  async function signInAgain() {
    if (signingOut) return;
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login/staff");
  }

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  return (
    <main className={`${loginStyles.staffLoginPage} ${styles.page}`}>
      <StaffAuthBackdrop />

      <section className={`${loginStyles.staffLoginPanel} ${styles.panel}`} aria-labelledby="forbidden-title">
        <header className={loginStyles.staffLoginHeader}>
          <Link
            className={loginStyles.staffLoginBrand}
            href="/"
            aria-label={zh ? "返回 BigE Fitness 首頁" : "Back to BigE Fitness home"}
          >
            <strong>BIGE</strong>
            <span>FITNESS</span>
          </Link>
          <LangSwitch />
        </header>

        <div className={styles.statusMark} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 3 5.5 5.6v5.7c0 4.3 2.6 8.2 6.5 9.7 3.9-1.5 6.5-5.4 6.5-9.7V5.6L12 3Z" />
            <path d="M9.5 9.5 14.5 14.5M14.5 9.5l-5 5" />
          </svg>
        </div>

        <div className={styles.heading}>
          <div className={styles.eyebrow}>{zh ? "存取受限" : "ACCESS RESTRICTED"}</div>
          <h1 id="forbidden-title">{zh ? "無法存取" : "Access denied"}</h1>
          <p>{getReasonText(code, zh)}</p>
        </div>

        {code ? (
          <div className={styles.codeRow}>
            <span>{zh ? "錯誤代碼" : "Error code"}</span>
            <code>{code}</code>
          </div>
        ) : null}

        <div className={styles.actions}>
          <button className={styles.primaryAction} type="button" onClick={signInAgain} disabled={signingOut}>
            {signingOut ? (zh ? "正在登出…" : "Signing out…") : zh ? "重新登入" : "Sign in again"}
          </button>
          <button className={styles.secondaryAction} type="button" onClick={goBack}>
            {zh ? "返回上一頁" : "Go back"}
          </button>
        </div>

        <p className={styles.supportHint}>
          {zh ? "若您認為權限設定有誤，請聯絡主管或系統管理員。" : "If you believe this is a mistake, contact your manager or system administrator."}
        </p>
      </section>
    </main>
  );
}
