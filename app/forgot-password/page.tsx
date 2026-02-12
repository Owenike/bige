"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@supabase/supabase-js";

export default function ForgotPasswordPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("缺少 Supabase 環境設定");
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      const appUrl =
        (typeof window !== "undefined" && window.location?.origin) ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "https://bige-nu.vercel.app";

      const { error: recoverError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl}/reset-password`,
      });

      if (recoverError) throw recoverError;

      setMessage("重設密碼信已寄出，請到信箱點擊最新連結。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "寄送失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <div className="card formCard" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="kvLabel">會員區</div>
        <h1 className="sectionTitle" style={{ marginTop: 10 }}>
          忘記密碼
        </h1>
        <p style={{ opacity: 0.85, marginTop: 8 }}>輸入你的 Email，我們會寄送重設密碼連結。</p>

        {message ? (
          <div style={{ marginTop: 12, color: "#2b7a6b", fontWeight: 600 }}>{message}</div>
        ) : null}
        {error ? (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        <form onSubmit={submit} style={{ marginTop: 12 }}>
          <label className="field">
            <span className="kvLabel" style={{ textTransform: "none" }}>
              電子信箱
            </span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <div className="actions" style={{ marginTop: 14 }}>
            <button type="submit" className={`btn ${busy ? "" : "btnPrimary"}`} disabled={busy}>
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
