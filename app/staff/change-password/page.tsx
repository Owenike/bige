"use client";

import { CheckCircle2, KeyRound, MailCheck, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr/dist/module/createBrowserClient";
import type { SupabaseClient } from "@supabase/supabase-js";

type Phase = "loading" | "email" | "password" | "verified_without_session" | "done";

type MePayload = {
  displayName?: string | null;
  englishName?: string | null;
  employeeNumber?: string | null;
  mustChangePassword?: boolean;
  staffEmailVerifiedAt?: string | null;
};

function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("登入服務尚未完成設定");
  return createBrowserClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
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

function verificationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  if (
    normalized.includes("expired") ||
    normalized.includes("invalid") ||
    normalized.includes("otp") ||
    normalized.includes("token")
  ) {
    return "驗證連結已失效或使用過，請重新登入後再寄一次驗證信。";
  }
  return message || "無法完成帳號驗證，請重新登入後再試一次。";
}

const cardStyle = {
  width: "min(520px, 100%)",
  padding: 28,
  border: "1px solid rgba(255,255,255,.86)",
  borderRadius: 8,
  background: "rgba(255,255,255,.62)",
  boxShadow: "0 28px 80px rgba(68,83,107,.18)",
  backdropFilter: "blur(28px) saturate(1.4)",
} as const;

const inputStyle = {
  width: "100%",
  minHeight: 48,
  padding: "10px 12px",
  borderRadius: 7,
  border: "1px solid #c9d2df",
  background: "rgba(255,255,255,.7)",
} as const;

export default function StaffChangePasswordPage() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<MePayload>({});
  const [email, setEmail] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const supabase = browserClient();
        if (!active) return;
        setClient(supabase);

        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const linkError = query.get("error_description") || hash.get("error_description");
        if (linkError) throw new Error(linkError);

        const staffEmailToken = query.get("token");
        if (staffEmailToken) {
          const response = await fetch("/api/auth/staff-email/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: staffEmailToken }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(readError(payload, "Email 驗證失敗"));
          window.history.replaceState(null, "", window.location.pathname);
        } else {
          const code = query.get("code");
          const accessToken = hash.get("access_token");
          const refreshToken = hash.get("refresh_token");
          if (code) {
            const result = await supabase.auth.exchangeCodeForSession(code);
            if (result.error) throw result.error;
            window.history.replaceState(null, "", window.location.pathname);
          } else if (accessToken && refreshToken) {
            const result = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (result.error) throw result.error;
            window.history.replaceState(null, "", window.location.pathname);
          }
        }

        const sessionResult = await supabase.auth.getSession();
        if (sessionResult.error) throw sessionResult.error;
        if (!sessionResult.data.session) {
          if (staffEmailToken) {
            if (active) setPhase("verified_without_session");
            return;
          }
          throw new Error("登入狀態已失效，請回員工登入頁重新登入。");
        }

        const meResponse = await fetch("/api/auth/me", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${sessionResult.data.session.access_token}`,
          },
        });
        const mePayload = (await meResponse.json().catch(() => null)) as MePayload | null;
        if (!meResponse.ok || !mePayload) {
          throw new Error(readError(mePayload, "無法讀取員工資料"));
        }
        if (!active) return;
        setProfile(mePayload);
        setPhase(mePayload.staffEmailVerifiedAt || staffEmailToken ? "password" : "email");
      } catch (caught) {
        if (active) {
          setError(verificationErrorMessage(caught));
          setPhase("loading");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const passwordValid = useMemo(
    () => password.length >= 10 && password === confirm && phase === "password" && !busy,
    [busy, confirm, password, phase],
  );

  async function requestEmailVerification(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const session = await client?.auth.getSession();
      const response = await fetch("/api/auth/staff-email/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.data.session?.access_token
            ? { Authorization: `Bearer ${session.data.session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(payload, "驗證信寄送失敗"));
      setMaskedEmail(payload?.maskedEmail || email);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "驗證信寄送失敗");
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (!client || !passwordValid) return;
    setBusy(true);
    setError("");
    const update = await client.auth.updateUser({ password });
    if (update.error) {
      setError(update.error.message);
      setBusy(false);
      return;
    }

    const session = await client.auth.getSession();
    const response = await fetch("/api/auth/staff-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session.data.session?.access_token
          ? { Authorization: `Bearer ${session.data.session.access_token}` }
          : {}),
      },
      body: JSON.stringify({ passwordChanged: true }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(readError(payload, "無法完成密碼設定"));
      setBusy(false);
      return;
    }
    setPhase("done");
    window.setTimeout(() => {
      window.location.assign(payload?.data?.home || payload?.home || "/login/staff");
    }, 900);
  }

  const staffName = profile.englishName || profile.displayName || "BIG E 員工";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "linear-gradient(135deg, #eaf3fb, #f3effc)",
      }}
    >
      <section className="formCard" style={cardStyle}>
        <ShieldCheck size={26} />
        <p style={{ color: "#75622e", fontSize: 12, fontWeight: 800 }}>BIG E STAFF SECURITY</p>
        <h1 style={{ margin: "6px 0 8px", letterSpacing: 0 }}>首次登入安全設定</h1>
        {profile.employeeNumber ? (
          <p style={{ color: "#667287", marginTop: 0 }}>
            {staffName} · {profile.employeeNumber}
          </p>
        ) : null}

        {error ? (
          <p role="alert" style={{ color: "#942d3b", background: "#ffe8ec", padding: 10, borderRadius: 7 }}>
            {error}
          </p>
        ) : null}

        {phase === "loading" && !error ? <p style={{ color: "#667287" }}>正在確認登入狀態...</p> : null}

        {phase === "email" ? (
          <form onSubmit={requestEmailVerification} style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                padding: 14,
                borderRadius: 7,
                border: "1px solid rgba(117,98,46,.24)",
                background: "rgba(255,248,220,.7)",
                color: "#5c4d24",
              }}
            >
              <strong>請填寫您本人可正常收信的 Email</strong>
              <p style={{ margin: "6px 0 0", lineHeight: 1.6 }}>
                此 Email 將用於忘記密碼與重要帳號安全通知。驗證完成後才能設定正式密碼。
              </p>
            </div>
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 750 }}>
                本人 Email
              </span>
              <input
                style={inputStyle}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setMaskedEmail("");
                }}
                required
              />
            </label>
            {maskedEmail ? (
              <p style={{ color: "#22613f", display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
                <MailCheck size={18} />
                驗證信已寄至 {maskedEmail}，請於 30 分鐘內點選連結。
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || !email.trim()}
              style={{
                minHeight: 48,
                border: 0,
                borderRadius: 7,
                color: "#fff",
                background: "#26364d",
                fontWeight: 800,
                opacity: busy || !email.trim() ? 0.5 : 1,
              }}
            >
              {busy ? "寄送中..." : maskedEmail ? "重新寄送驗證信" : "寄送驗證信"}
            </button>
          </form>
        ) : null}

        {phase === "password" ? (
          <form onSubmit={submitPassword} style={{ display: "grid", gap: 12 }}>
            <p style={{ color: "#22613f", display: "flex", gap: 8, alignItems: "center" }}>
              <MailCheck size={18} /> Email 已完成驗證，請設定您的正式密碼。
            </p>
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 750 }}>新密碼</span>
              <input
                style={inputStyle}
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 750 }}>再次輸入</span>
              <input
                style={inputStyle}
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
              />
            </label>
            <span style={{ color: "#667287", fontSize: 13 }}>密碼至少 10 位。</span>
            {confirm && password !== confirm ? <span style={{ color: "#942d3b" }}>兩次密碼不一致</span> : null}
            <button
              type="submit"
              disabled={!passwordValid}
              style={{
                minHeight: 48,
                border: 0,
                borderRadius: 7,
                color: "#fff",
                background: "#26364d",
                fontWeight: 800,
                opacity: passwordValid ? 1 : 0.5,
              }}
            >
              {busy ? "設定中..." : "完成設定並進入後台"}
            </button>
          </form>
        ) : null}

        {phase === "verified_without_session" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <p style={{ color: "#22613f", display: "flex", gap: 8, alignItems: "center" }}>
              <CheckCircle2 size={18} /> Email 驗證完成
            </p>
            <p style={{ color: "#667287", lineHeight: 1.6 }}>
              請回到員工登入頁，以員工編號及初始密碼登入，接著設定正式密碼。
            </p>
            <a
              href="/login/staff"
              style={{
                minHeight: 48,
                display: "grid",
                placeItems: "center",
                borderRadius: 7,
                color: "#fff",
                background: "#26364d",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              回員工登入
            </a>
          </div>
        ) : null}

        {phase === "done" ? (
          <p style={{ color: "#22613f", display: "flex", gap: 8, alignItems: "center" }}>
            <CheckCircle2 size={18} /> 設定完成，正在進入後台。
          </p>
        ) : null}

        {phase === "loading" && error ? (
          <a href="/login/staff" style={{ color: "#26364d", fontWeight: 750 }}>
            返回員工登入
          </a>
        ) : null}
      </section>
    </main>
  );
}
