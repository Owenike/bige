"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ViewState = "loading" | "ready" | "invalid" | "submitting" | "done";

type RecoveryStatus = {
  state: ViewState;
  message: string;
};

const invalidLinkMessage = "此重設密碼連結已失效或不完整，請重新寄送密碼重設信。";

function createBrowserSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase browser environment variables.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

async function resolveRecoverySession(client: SupabaseClient): Promise<RecoveryStatus> {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  const errorCode = query.get("error_code") || hash.get("error_code");
  if (errorCode) {
    return { state: "invalid", message: invalidLinkMessage };
  }

  const code = query.get("code");
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) return { state: "invalid", message: invalidLinkMessage };

    window.history.replaceState(null, "", window.location.pathname);
    return { state: "ready", message: "請輸入新的登入密碼，完成後即可使用新密碼登入。" };
  }

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) return { state: "invalid", message: invalidLinkMessage };

    window.history.replaceState(null, "", window.location.pathname);
    return { state: "ready", message: "請輸入新的登入密碼，完成後即可使用新密碼登入。" };
  }

  const tokenHash = query.get("token_hash");
  const type = query.get("type");
  if (tokenHash && type === "recovery") {
    const { error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (error) return { state: "invalid", message: invalidLinkMessage };

    window.history.replaceState(null, "", window.location.pathname);
    return { state: "ready", message: "請輸入新的登入密碼，完成後即可使用新密碼登入。" };
  }

  const { data, error } = await client.auth.getSession();
  if (error || !data.session) {
    return { state: "invalid", message: invalidLinkMessage };
  }

  return { state: "ready", message: "請輸入新的登入密碼，完成後即可使用新密碼登入。" };
}

export default function ResetPasswordPage() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [recoveryMode, setRecoveryMode] = useState<"account" | "student">("account");
  const [state, setState] = useState<ViewState>("loading");
  const [message, setMessage] = useState("正在驗證重設密碼連結...");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const canSubmit = useMemo(() => state === "ready" && password.length > 0 && confirmPassword.length > 0, [
    confirmPassword,
    password,
    state,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const isStudentRecovery = new URLSearchParams(window.location.search).get("mode") === "student";
      if (!cancelled && isStudentRecovery) setRecoveryMode("student");
      let supabase: SupabaseClient;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        if (!cancelled) {
          setState("invalid");
          setMessage("目前缺少前端 Supabase 設定，請聯繫管理員。");
        }
        return;
      }

      if (!cancelled) setClient(supabase);

      const result = await resolveRecoverySession(supabase).catch(() => ({
        state: "invalid" as const,
        message: invalidLinkMessage,
      }));

      if (cancelled) return;
      setState(result.state);
      setMessage(result.message);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || state !== "ready") return;

    setFieldError(null);

    if (!password) {
      setFieldError("請輸入新密碼。");
      return;
    }

    if (!confirmPassword) {
      setFieldError("請再次輸入新密碼。");
      return;
    }

    if (password.length < 6) {
      setFieldError("新密碼至少需要 6 碼。");
      return;
    }

    if (password !== confirmPassword) {
      setFieldError("兩次輸入的密碼不一致。");
      return;
    }

    setState("submitting");
    setMessage("正在更新密碼...");

    let updateError = "";
    if (recoveryMode === "student") {
      const session = await client.auth.getSession();
      const accessToken = session.data.session?.access_token;
      if (!accessToken) {
        updateError = "重設連結已失效，請重新寄送。";
      } else {
        const response = await fetch("/api/student-checkin/password-reset/confirm", {
          method: "POST",
          headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!response.ok || !payload?.ok) updateError = payload?.error || "密碼更新失敗，請稍後再試。";
      }
    } else {
      const result = await client.auth.updateUser({ password });
      updateError = result.error?.message || "";
    }

    if (updateError) {
      setState("ready");
      setMessage("密碼更新失敗，請重新確認連結或稍後再試。");
      setFieldError(updateError);
      return;
    }

    await client.auth.signOut().catch(() => null);
    setPassword("");
    setConfirmPassword("");
    setFieldError(null);
    setState("done");
    setMessage("密碼已更新成功。請使用新密碼重新登入。");
  }

  return (
    <main className={recoveryMode === "student" ? "studentCheckInPage" : "resetPasswordPage"}>
      <section className={recoveryMode === "student" ? "studentCheckInCard resetPasswordCard" : "resetPasswordCard"} aria-labelledby="reset-password-title">
        <div className="kvLabel">{recoveryMode === "student" ? "BIGE CHECK-IN" : "Account Recovery"}</div>
        <h1 id="reset-password-title" className="sectionTitle">
          {recoveryMode === "student" ? "重設學員密碼" : "重設密碼"}
        </h1>
        <p className="sub">請輸入新的登入密碼，完成後即可使用新密碼登入。</p>

        <div
          className={
            state === "invalid"
              ? "resetPasswordMessage resetPasswordError"
              : state === "done"
                ? "resetPasswordMessage resetPasswordSuccess"
                : "resetPasswordMessage"
          }
          role={state === "invalid" || fieldError ? "alert" : "status"}
        >
          {fieldError || message}
        </div>

        {(state === "ready" || state === "submitting") && (
          <form className="resetPasswordForm" onSubmit={onSubmit}>
            <label className="resetPasswordField">
              <span>新密碼</span>
              <input
                className="resetPasswordInput"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>

            <label className="resetPasswordField">
              <span>確認新密碼</span>
              <input
                className="resetPasswordInput"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>

            <div className="actions">
              <button className="resetPasswordButton" type="submit" disabled={!canSubmit || state === "submitting"}>
                {state === "submitting" ? "更新中..." : "更新密碼"}
              </button>
              <Link className="btn" href={recoveryMode === "student" ? "/check-in" : "/login"}>
                {recoveryMode === "student" ? "返回報到登入" : "前往登入"}
              </Link>
            </div>
          </form>
        )}

        {(state === "invalid" || state === "done") && (
          <div className="actions">
            <Link className="resetPasswordButton" href={recoveryMode === "student" ? "/check-in" : "/login"}>
              {recoveryMode === "student" ? "返回報到登入" : "前往登入"}
            </Link>
            {state === "invalid" ? (
              <Link className="btn" href={recoveryMode === "student" ? "/check-in/forgot-password" : "/forgot-password"}>
                重新寄送密碼重設信
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
