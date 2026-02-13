"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useI18n } from "../i18n-provider";

type ViewState = "loading" | "ready" | "invalid" | "submitting" | "done";

export default function ResetPasswordPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [message, setMessage] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!supabaseUrl || !supabaseAnonKey) {
        if (!cancelled) {
          setState("invalid");
          setMessage(zh ? "缺少 Supabase 環境變數。" : "Missing Supabase environment variables.");
        }
        return;
      }

      if (!cancelled) setMessage(zh ? "正在驗證重設連結..." : "Validating reset link...");

      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      if (!cancelled) setClient(supabase);

      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // ignore stale local session cleanup errors
      }

      try {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const query = new URLSearchParams(window.location.search);

        let sessionReady = false;

        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        const tokenHash = query.get("token_hash");
        const type = query.get("type");
        const code = query.get("code");
        const errCode = query.get("error_code") || hash.get("error_code");

        if (errCode) {
          throw new Error(zh ? "重設連結無效或已過期。" : "Reset link is invalid or expired.");
        }

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!error) sessionReady = true;
        } else if (tokenHash && type === "recovery") {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });
          if (!error) sessionReady = true;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) sessionReady = true;
        }

        if (!sessionReady) {
          const { data, error } = await supabase.auth.getSession();
          if (error || !data.session) {
            throw new Error(zh ? "重設連結無效或已過期。" : "Reset link is invalid or expired.");
          }
        }
      } catch (e) {
        if (cancelled) return;
        setState("invalid");
        setMessage(e instanceof Error ? e.message : zh ? "重設連結驗證失敗。" : "Failed to validate reset link.");
        return;
      }

      if (cancelled) return;
      setState("ready");
      setMessage(zh ? "請輸入新密碼。" : "Please enter your new password.");
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [supabaseAnonKey, supabaseUrl, zh]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;

    if (password.length < 8) {
      setMessage(zh ? "密碼長度至少需要 8 碼。" : "Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage(zh ? "兩次輸入的密碼不一致。" : "Passwords do not match.");
      return;
    }

    setState("submitting");
    setMessage(zh ? "正在更新密碼..." : "Updating password...");

    const { error } = await client.auth.updateUser({ password });
    if (error) {
      setState("ready");
      setMessage(error.message || (zh ? "更新密碼失敗。" : "Failed to update password."));
      return;
    }

    setState("done");
    setMessage(zh ? "密碼已更新，請重新登入。" : "Password updated. Please sign in again.");
  }

  return (
    <main className="container" style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
      <div className="card formCard">
        <div className="kvLabel">{zh ? "會員區" : "MEMBER"}</div>
        <h1 className="sectionTitle" style={{ marginTop: 10 }}>
          {zh ? "重設密碼" : "Reset Password"}
        </h1>
        <p style={{ opacity: 0.85, marginTop: 8 }}>{message}</p>

        {(state === "ready" || state === "submitting") && (
          <form onSubmit={onSubmit} style={{ marginTop: 14 }}>
            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>
                {zh ? "新密碼" : "New Password"}
              </span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>

            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>
                {zh ? "確認新密碼" : "Confirm Password"}
              </span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>

            <div className="actions" style={{ marginTop: 14 }}>
              <button
                type="submit"
                className={`btn ${state === "submitting" ? "" : "btnPrimary"}`}
                disabled={state === "submitting"}
              >
                {state === "submitting" ? (zh ? "更新中..." : "Updating...") : zh ? "更新密碼" : "Update Password"}
              </button>
              <Link href="/login" className="btn">
                {zh ? "回登入" : "Back to Login"}
              </Link>
            </div>
          </form>
        )}

        {(state === "invalid" || state === "done") && (
          <div className="actions" style={{ marginTop: 14 }}>
            <Link href="/login" className="btn btnPrimary">
              {zh ? "前往登入" : "Go to Login"}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
