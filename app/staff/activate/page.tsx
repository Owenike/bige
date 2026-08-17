"use client";

import { Check, LogOut, ShieldCheck, UserCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  departmentLabel,
  positionLabel,
  type StaffDepartment,
  type StaffPosition,
} from "../../../lib/staff-organization";
import styles from "./page.module.css";

type MePayload = {
  role?: string;
  displayName?: string | null;
  englishName?: string | null;
  employeeNumber?: string | null;
  department?: StaffDepartment | null;
  position?: StaffPosition | null;
  staffActivationStatus?: string | null;
};

function roleHome(role: string | undefined) {
  if (role === "platform_admin") return "/manager/fitness";
  if (role === "frontdesk") return "/frontdesk/fitness";
  if (role === "coach" || role === "therapist") return "/coach/fitness";
  return "/manager/fitness";
}

function readError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as { error?: string | { message?: string }; message?: string };
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && body.error.message) {
    return body.error.message;
  }
  return body.message || fallback;
}

export default function StaffActivatePage() {
  const [profile, setProfile] = useState<MePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as MePayload | null;
      if (!active) return;
      if (!response.ok || !payload) {
        window.location.replace("/login/staff");
        return;
      }
      if (payload.staffActivationStatus === "identity_confirmed") {
        window.location.replace("/staff/change-password");
        return;
      }
      if (payload.staffActivationStatus === "completed") {
        window.location.replace(roleHome(payload.role));
        return;
      }
      setProfile(payload);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function decide(decision: "confirm" | "deny") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/staff-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(payload, "本人確認失敗"));
      if (decision === "deny") {
        setDenied(true);
        return;
      }
      window.location.assign("/staff/change-password");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "本人確認失敗");
    } finally {
      setBusy(false);
    }
  }

  async function returnToLogin() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/login/staff");
  }

  return (
    <main className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true" />
      <section className={styles.dialog} aria-labelledby="identity-title">
        <div className={styles.icon}>
          {denied ? <ShieldCheck size={28} /> : <UserCheck size={28} />}
        </div>

        {denied ? (
          <>
            <p className={styles.eyebrow}>首次啟用已中斷</p>
            <h1 id="identity-title" className={styles.title}>已通知主管確認</h1>
            <p className={styles.description}>
              這個帳號不會繼續啟用。請直接聯絡主管，由主管當面確認身分後重新產生一次性啟用碼。
            </p>
            <button className={styles.primaryButton} type="button" onClick={() => void returnToLogin()}>
              <LogOut size={18} />
              返回員工登入
            </button>
          </>
        ) : profile ? (
          <>
            <p className={styles.eyebrow}>員工首次啟用</p>
            <h1 id="identity-title" className={styles.title}>請確認是否為本人</h1>
            <p className={styles.description}>
              請核對以下資料。確認後才能綁定個人 Email 並設定正式密碼。
            </p>

            <dl className={styles.details}>
              <div>
                <dt>員工編號</dt>
                <dd>{profile.employeeNumber || "-"}</dd>
              </div>
              <div>
                <dt>真實姓名</dt>
                <dd>{profile.displayName || "-"}</dd>
              </div>
              <div>
                <dt>英文姓名</dt>
                <dd>{profile.englishName || "-"}</dd>
              </div>
              <div>
                <dt>部門／職務</dt>
                <dd>
                  {departmentLabel(profile.department)}／{positionLabel(profile.position)}
                </dd>
              </div>
            </dl>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <div className={styles.actions}>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={busy}
                onClick={() => void decide("deny")}
              >
                <X size={18} />
                不是本人
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={busy}
                onClick={() => void decide("confirm")}
              >
                <Check size={18} />
                是，我是本人
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>BIG E STAFF SECURITY</p>
            <h1 id="identity-title" className={styles.title}>正在核對員工資料</h1>
            <p className={styles.description}>請稍候。</p>
          </>
        )}
      </section>
    </main>
  );
}
