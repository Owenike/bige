"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useI18n } from "../i18n-provider";

export default function ForgotPasswordPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
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
        throw new Error(zh ? "缺少 Supabase 環境變數。" : "Missing Supabase environment variables.");
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
      setMessage(
        zh ? "已寄出重設密碼連結，請到信箱收信。" : "Password reset link sent. Please check your inbox.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : zh ? "送出失敗" : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <div className="card formCard" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="kvLabel">{zh ? "會員區" : "MEMBER"}</div>
        <h1 className="sectionTitle" style={{ marginTop: 10 }}>
          {zh ? "忘記密碼" : "Forgot Password"}
        </h1>
        <p style={{ opacity: 0.85, marginTop: 8 }}>
          {zh
            ? "輸入你的 Email，我們會寄送重設密碼連結。"
            : "Enter your email and we will send a reset-password link."}
        </p>

        {message ? <div style={{ marginTop: 12, color: "#2b7a6b", fontWeight: 600 }}>{message}</div> : null}
        {error ? (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        <form onSubmit={submit} style={{ marginTop: 12 }}>
          <label className="field">
            <span className="kvLabel" style={{ textTransform: "none" }}>
              {zh ? "登入信箱" : "Email"}
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
              {busy ? (zh ? "送出中..." : "Submitting...") : zh ? "送出重設連結" : "Send Reset Link"}
            </button>
            <Link href="/login" className="btn">
              {zh ? "回登入" : "Back to Login"}
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
