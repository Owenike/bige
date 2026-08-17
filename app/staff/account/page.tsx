"use client";

import { ArrowLeft, CheckCircle2, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

type AccountPayload = {
  displayName?: string | null;
  englishName?: string | null;
  employeeNumber?: string | null;
  email?: string | null;
  home?: string;
  error?: string | { message?: string };
  message?: string;
};

function readError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as {
    error?: string | { message?: string };
    message?: string;
  };
  if (typeof body.error === "string") return body.error;
  if (body.error?.message) return body.error.message;
  return body.message || fallback;
}

export default function StaffAccountPage() {
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailBusy, setEmailBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAccount = useCallback(async () => {
    const response = await fetch("/api/auth/staff-account", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as AccountPayload | null;
    if (!response.ok || !payload) {
      if (response.status === 403) {
        window.location.replace("/frontdesk/fitness");
        return;
      }
      throw new Error(readError(payload, "讀取帳號資料失敗"));
    }
    setAccount(payload);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const query = new URLSearchParams(window.location.search);
        const token = query.get("token");
        if (token) {
          const response = await fetch("/api/auth/staff-email/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(readError(payload, "信箱驗證失敗"));
          window.history.replaceState(null, "", "/staff/account#email");
          if (active) setNotice("信箱已變更完成，之後可使用新信箱或員工編號登入。 ");
        }
        await loadAccount();
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "讀取帳號資料失敗");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadAccount]);

  async function requestEmailChange(event: FormEvent) {
    event.preventDefault();
    if (emailBusy) return;
    setEmailBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/staff-email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, currentPassword: emailPassword }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(payload, "寄送驗證信失敗"));
      setNotice(`驗證信已寄到 ${payload?.maskedEmail || newEmail}，請在 30 分鐘內完成驗證。`);
      setNewEmail("");
      setEmailPassword("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "寄送驗證信失敗");
    } finally {
      setEmailBusy(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordBusy) return;
    setError("");
    setNotice("");
    if (newPassword.length < 6) {
      setError("新密碼至少需要 6 個字元");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("兩次輸入的新密碼不一致");
      return;
    }
    setPasswordBusy(true);
    try {
      const response = await fetch("/api/auth/staff-account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(payload, "密碼變更失敗"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("密碼已變更完成，下次登入請使用新密碼。 ");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密碼變更失敗");
    } finally {
      setPasswordBusy(false);
    }
  }

  const name = account?.englishName || account?.displayName || "員工帳號";

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>BIG E STAFF SECURITY</p>
            <h1>帳號安全設定</h1>
            <p>{name}{account?.employeeNumber ? ` · ${account.employeeNumber}` : ""}</p>
          </div>
          <a className={styles.backButton} href={account?.home || "/manager/fitness"}>
            <ArrowLeft size={18} />
            返回營運後台
          </a>
        </header>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status"><CheckCircle2 size={18} />{notice}</p> : null}
        {loading ? <section className={styles.card}>正在讀取帳號資料…</section> : null}

        {!loading && account ? (
          <div className={styles.grid}>
            <section className={styles.card} id="email">
              <div className={styles.cardHeading}>
                <span className={styles.icon}><Mail size={21} /></span>
                <div>
                  <h2>更改信箱</h2>
                  <p>目前信箱：{account.email || "尚未設定"}</p>
                </div>
              </div>
              <p className={styles.hint}>新信箱驗證完成後才會正式替換。信箱變更紀錄只會留在管理端。</p>
              <form className={styles.form} onSubmit={requestEmailChange}>
                <label>
                  <span>新信箱</span>
                  <input type="email" autoComplete="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
                </label>
                <label>
                  <span>目前密碼</span>
                  <input type="password" autoComplete="current-password" required value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} />
                </label>
                <button type="submit" disabled={emailBusy || !newEmail || !emailPassword}>
                  {emailBusy ? "寄送中…" : "寄送新信箱驗證信"}
                </button>
              </form>
            </section>

            <section className={styles.card} id="password">
              <div className={styles.cardHeading}>
                <span className={styles.icon}><KeyRound size={21} /></span>
                <div>
                  <h2>更改密碼</h2>
                  <p>新密碼至少 6 個字元</p>
                </div>
              </div>
              <form className={styles.form} onSubmit={changePassword}>
                <label>
                  <span>目前密碼</span>
                  <input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                </label>
                <label>
                  <span>新密碼</span>
                  <input type="password" autoComplete="new-password" minLength={6} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                </label>
                <label>
                  <span>再次輸入新密碼</span>
                  <input type="password" autoComplete="new-password" minLength={6} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                </label>
                <button type="submit" disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}>
                  {passwordBusy ? "變更中…" : "確認變更密碼"}
                </button>
              </form>
            </section>
          </div>
        ) : null}

        <footer className={styles.securityNote}>
          <ShieldCheck size={18} />
          系統不會顯示或保存任何密碼內容。
        </footer>
      </div>
    </main>
  );
}
