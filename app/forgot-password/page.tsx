"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

export default function ForgotPasswordPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const appUrl =
    (typeof window !== "undefined" ? window.location.origin : null) ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://bige-nu.vercel.app";

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [debug, setDebug] = useState<string>("");

  const envMissing = useMemo(() => !supabaseUrl || !supabaseAnonKey, [supabaseUrl, supabaseAnonKey]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setDebug("");

    try {
      if (envMissing) throw new Error("缺少 Supabase 環境變數設定。");
      const supabase = createClient(supabaseUrl!, supabaseAnonKey!);

      const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${appUrl}/reset-password`,
      });
      if (sendError) throw sendError;

      setMessage("重設密碼信已寄出，請到信箱點擊最新連結。");
      setDebug(`sent via ${supabaseUrl} -> redirectTo ${appUrl}/reset-password`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "寄送失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
      <div className="card formCard">
        <div className="kvLabel">會員區</div>
        <h1 className="sectionTitle" style={{ marginTop: 10 }}>
          忘記密碼
        </h1>
        <p style={{ opacity: 0.85, marginTop: 8 }}>輸入你的 Email，我們會寄送重設密碼連結。</p>

        {error ? (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        {message ? (
          <div style={{ marginTop: 12, color: "#2f7a66" }}>
            {message}
          </div>
        ) : null}

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          current supabase: {supabaseUrl || "(missing)"} | appUrl: {appUrl}
        </div>
        {debug ? (
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>{debug}</div>
        ) : null}

        <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
          <label className="field">
            <span className="kvLabel" style={{ textTransform: "none" }}>
              電子信箱
            </span>
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </label>

          <div className="actions" style={{ marginTop: 14 }}>
            <button type="submit" disabled={busy} className={`btn ${busy ? "" : "btnPrimary"}`}>
              {busy ? "寄送中..." : "寄送重設信"}
            </button>
            <Link href="/login" className="btn">
              回登入
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
