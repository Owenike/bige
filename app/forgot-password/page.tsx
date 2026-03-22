"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useI18n } from "../i18n-provider";

function resolveAppOrigin() {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }

  return "http://localhost:3000";
}

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
        throw new Error(zh ? "缺少 Supabase 環境設定。" : "Missing Supabase environment variables.");
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      const appUrl = resolveAppOrigin();

      const { error: recoverError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl}/reset-password`,
      });

      if (recoverError) throw recoverError;
      setMessage(
        zh
          ? "重設密碼連結已寄出。這是共用 Email recovery 入口，適用於員工與會員帳號。"
          : "Password reset link sent. This shared email recovery flow can be used by both staff and member accounts.",
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
        <div className="kvLabel">{zh ? "共用帳號復原" : "Shared Account Recovery"}</div>
        <h1 className="sectionTitle" style={{ marginTop: 10 }}>
          {zh ? "忘記密碼 / 寄送重設信" : "Forgot Password / Send Reset Link"}
        </h1>
        <p style={{ opacity: 0.85, marginTop: 8 }}>
          {zh
            ? "這是共用的 Email-based recovery 入口，不只會員可用。請輸入帳號 Email，我們會寄送重設密碼連結。"
            : "This is a shared email-based recovery page, not member-only. Enter the account email and we will send a password reset link."}
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
              {zh ? "Email" : "Email"}
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
              {busy ? (zh ? "送出中..." : "Submitting...") : zh ? "寄送重設連結" : "Send Reset Link"}
            </button>
            <Link href="/login" className="btn">
              {zh ? "返回登入" : "Back to Login"}
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
