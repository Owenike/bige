"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useI18n } from "../i18n-provider";

type ViewState = "loading" | "ready" | "invalid" | "submitting" | "done";

export default function ResetPasswordPage() {
  const { t } = useI18n();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [message, setMessage] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const envMissing = useMemo(() => !supabaseUrl || !supabaseAnonKey, [supabaseUrl, supabaseAnonKey]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (envMissing) {
        if (!cancelled) {
          setState("invalid");
          setMessage("系統設定缺少 Supabase 環境變數。");
        }
        return;
      }

      if (!cancelled) setMessage("正在檢查重設連結...");

      const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });

      if (!cancelled) setClient(supabase);

      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;

      if (error || !data.session) {
        setState("invalid");
        setMessage("重設連結無效或已過期，請重新申請。");
        return;
      }

      setState("ready");
      setMessage("請輸入新密碼。");
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [envMissing, supabaseAnonKey, supabaseUrl]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;

    if (password.length < 8) {
      setMessage("密碼至少需要 8 碼。");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("兩次輸入的密碼不一致。");
      return;
    }

    setState("submitting");
    setMessage("正在更新密碼...");

    const { error } = await client.auth.updateUser({ password });
    if (error) {
      setState("ready");
      setMessage(error.message || "更新密碼失敗。");
      return;
    }

    setState("done");
    setMessage("密碼已更新，請重新登入。");
  }

  return (
    <main className="container" style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
      <div className="card formCard">
        <div className="kvLabel">會員區</div>
        <h1 className="sectionTitle" style={{ marginTop: 10 }}>
          重設密碼
        </h1>
        <p style={{ opacity: 0.85, marginTop: 8 }}>{message}</p>

        {(state === "ready" || state === "submitting") && (
          <form onSubmit={onSubmit} style={{ marginTop: 14 }}>
            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>
                新密碼
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
                確認新密碼
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
              <button type="submit" className={`btn ${state === "submitting" ? "" : "btnPrimary"}`} disabled={state === "submitting"}>
                {state === "submitting" ? "更新中..." : "更新密碼"}
              </button>
              <Link href="/login" className="btn">
                回登入
              </Link>
            </div>
          </form>
        )}

        {(state === "invalid" || state === "done") && (
          <div className="actions" style={{ marginTop: 14 }}>
            <Link href="/login" className="btn btnPrimary">
              回登入
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}