"use client";

import { CheckCircle2, KeyRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("缺少登入環境設定");
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
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
    return "這個驗證連結已使用或逾期，請使用最新一封驗證信，或請主管重新寄送。";
  }
  return message || "無法驗證員工帳號，請請主管重新寄送驗證信。";
}

export default function StaffChangePasswordPage() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const supabase = browserClient();
        setClient(supabase);
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const linkError = query.get("error_description") || hash.get("error_description");
        if (linkError) throw new Error(linkError);

        const code = query.get("code");
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (code) {
          const result = await supabase.auth.exchangeCodeForSession(code);
          if (result.error) throw result.error;
        } else if (accessToken && refreshToken) {
          const result = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (result.error) throw result.error;
        }

        const session = await supabase.auth.getSession();
        if (session.error) throw session.error;
        if (!session.data.session) {
          throw new Error("驗證連結已失效，請重新登入或請主管再次發送");
        }
        if (active) {
          window.history.replaceState(null, "", window.location.pathname);
          setReady(true);
        }
      } catch (caught) {
        if (active) setError(verificationErrorMessage(caught));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const valid = useMemo(
    () => password.length >= 10 && password === confirm && ready && !busy,
    [busy, confirm, password, ready],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !valid) return;
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
      setError(payload?.error?.message || payload?.message || "無法完成密碼設定");
      setBusy(false);
      return;
    }
    setDone(true);
    window.setTimeout(() => {
      window.location.assign(payload?.data?.home || payload?.home || "/login");
    }, 900);
  };

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
      <section
        className="formCard"
        style={{
          width: "min(480px, 100%)",
          padding: 24,
          border: "1px solid rgba(255,255,255,.85)",
          borderRadius: 8,
          background: "rgba(255,255,255,.58)",
          boxShadow: "0 28px 80px rgba(68,83,107,.18)",
          backdropFilter: "blur(28px) saturate(1.4)",
        }}
      >
        <KeyRound size={26} />
        <p style={{ color: "#75622e", fontSize: 12, fontWeight: 800 }}>BIG E STAFF SECURITY</p>
        <h1 style={{ margin: "6px 0 8px", letterSpacing: 0 }}>設定您的後台密碼</h1>
        <p style={{ color: "#667287" }}>
          完成 Email 驗證後，請設定只有您本人知道的新密碼。驗證連結僅能使用一次。
        </p>
        {error ? <p style={{ color: "#942d3b", background: "#ffe8ec", padding: 10, borderRadius: 7 }}>{error}</p> : null}
        {done ? (
          <p style={{ color: "#22613f", display: "flex", gap: 8, alignItems: "center" }}>
            <CheckCircle2 size={18} /> 設定完成，正在進入營運後台。
          </p>
        ) : (
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <label>
              <span style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 750 }}>新密碼</span>
              <input
                style={{ width: "100%", minHeight: 46, padding: "10px 12px", borderRadius: 7, border: "1px solid #c9d2df" }}
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
                style={{ width: "100%", minHeight: 46, padding: "10px 12px", borderRadius: 7, border: "1px solid #c9d2df" }}
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
              />
            </label>
            {confirm && password !== confirm ? <span style={{ color: "#942d3b" }}>兩次密碼不一致</span> : null}
            <button
              type="submit"
              disabled={!valid}
              style={{
                minHeight: 46,
                border: 0,
                borderRadius: 7,
                color: "#fff",
                background: "#26364d",
                fontWeight: 800,
                opacity: valid ? 1 : 0.5,
              }}
            >
              {busy ? "設定中..." : "完成驗證並進入後台"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
