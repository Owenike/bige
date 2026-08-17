"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "../i18n-provider";
import styles from "./page.module.css";

export default function LogoutPage() {
  const router = useRouter();
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [error, setError] = useState<string | null>(null);

  const logout = useCallback(async () => {
    const startedAt = Date.now();
    setError(null);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error(zh ? "登出服務暫時無法使用，請再試一次。" : "The sign-out service is temporarily unavailable.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "登出失敗" : "Logout failed");
      return;
    }

    const remainingTransitionTime = 900 - (Date.now() - startedAt);
    if (remainingTransitionTime > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, remainingTransitionTime));
    }

    router.replace("/login");
  }, [router, zh]);

  useEffect(() => {
    void logout();
  }, [logout]);

  return (
    <main className={`trainingTopicPage ${styles.page}`}>
      <section className={`trainingTopicHero ${styles.hero}`}>
        <div className="trainingTopicHeroMedia" aria-hidden="true">
          <Image
            src="/home-images/card-boxing-training.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="trainingTopicHeroImage"
          />
          <div className="trainingTopicHeroShade" />
        </div>

        <div className={`trainingTopicHeroInner ${styles.heroInner}`}>
          <p className="trainingTopicEyebrow">BIGE SECURE SESSION</p>
          <h1>{error ? (zh ? "登出未完成" : "Sign-out paused") : zh ? "登出中" : "Signing out"}</h1>
          <p className="trainingTopicLead">
            {error
              ? zh
                ? "連線暫時中斷，你的登入狀態尚未完全清除。"
                : "The connection was interrupted and your session may still be active."
              : zh
                ? "正在安全清除你的登入狀態，完成後將帶你回到登入頁。"
                : "We are securely clearing your session and will return you to the sign-in page."}
          </p>

          <div
            className={`${styles.statusCard} ${error ? styles.statusCardError : ""}`}
            role="status"
            aria-live="polite"
          >
            <div className={styles.statusHeader}>
              <span className={error ? styles.errorMark : styles.spinner} aria-hidden="true">
                {error ? "!" : ""}
              </span>
              <div>
                <span className={styles.statusEyebrow}>
                  {error ? (zh ? "需要重新嘗試" : "ACTION REQUIRED") : zh ? "工作階段保護" : "SESSION SECURED"}
                </span>
                <strong>
                  {error ? (zh ? "無法完成登出" : "Unable to sign out") : zh ? "正在結束工作階段" : "Closing your session"}
                </strong>
              </div>
            </div>

            {error ? (
              <>
                <p className={styles.statusMessage}>{error}</p>
                <button
                  type="button"
                  className={`trainingTopicButton trainingTopicButtonPrimary ${styles.retryButton}`}
                  onClick={() => void logout()}
                >
                  {zh ? "再試一次" : "Try again"}
                </button>
              </>
            ) : (
              <>
                <p className={styles.statusMessage}>
                  {zh ? "請稍候，這通常只需要幾秒鐘。" : "Please wait. This usually takes only a few seconds."}
                </p>
                <div className={styles.progressTrack} aria-hidden="true">
                  <span className={styles.progressBar} />
                </div>
              </>
            )}
          </div>

          <p className={styles.securityNote}>
            {zh ? "離開共用裝置前，請確認畫面已回到登入頁。" : "On a shared device, wait until the sign-in page appears before leaving."}
          </p>
        </div>
      </section>
    </main>
  );
}
