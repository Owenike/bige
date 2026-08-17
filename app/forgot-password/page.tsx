"use client";

import Link from "next/link";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const SAFE_LOGIN_PATHS = new Set([
  "/login",
  "/login/staff",
  "/login/member",
  "/admin/student-check-ins/login",
]);

function resolveAppOrigin() {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
}

function safeReturnPath(value: string | null) {
  if (!value) return "/login";
  const [pathname] = value.split("?");
  return SAFE_LOGIN_PATHS.has(pathname) ? value : "/login";
}

function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const returnTo = useMemo(() => safeReturnPath(searchParams.get("returnTo")), [searchParams]);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("目前無法使用密碼重設，請稍後再試。");
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const resetUrl = new URL("/reset-password", resolveAppOrigin());
      resetUrl.searchParams.set("returnTo", returnTo);
      const { error: recoverError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: resetUrl.toString(),
      });

      if (recoverError) {
        if (recoverError.status === 429) throw new Error("寄送次數過多，請稍後再試。");
        throw new Error("目前無法寄送重設信，請稍後再試。");
      }

      setMessage("如果這個 Email 已建立帳號，重設密碼連結會寄到信箱。請一併確認垃圾郵件。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "目前無法寄送重設信。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="studentAdminLoginPage">
      <section className="studentAdminLoginPanel">
        <Link className="studentAdminLoginBrand" href="/" aria-label="返回 BigE Fitness 首頁">
          <strong>BIGE</strong>
          <span>FITNESS</span>
        </Link>

        <div className="studentAdminLoginHeading">
          <div className="studentAdminLoginEyebrow">ACCOUNT RECOVERY</div>
          <h1 className="studentAdminLoginTitle">忘記密碼</h1>
        </div>

        <section className="studentAdminLoginFormSection">
          <p className="studentAdminLoginCopy">
            輸入登入帳號的 Email，我們會寄送一次性重設密碼連結。
          </p>

          {message ? <div className="studentAdminLoginNotice" role="status">{message}</div> : null}
          {error ? <div className="error" role="alert">{error}</div> : null}

          <form className="studentAdminLoginForm" onSubmit={submit}>
            <label className="field">
              <span className="studentAdminLoginLabel">Email</span>
              <input
                autoComplete="email"
                autoFocus
                className="input"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </label>

            <div className="studentAdminLoginActions">
              <button className="studentAdminLoginSubmit" disabled={busy} type="submit">
                {busy ? "寄送中..." : "寄送重設連結"}
              </button>
              <Link className="studentAdminLoginLink" href={returnTo}>
                返回登入
              </Link>
              <Link className="studentAdminLoginLink" href="/">
                返回首頁
              </Link>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<main className="studentAdminLoginPage" />}>
      <ForgotPasswordContent />
    </Suspense>
  );
}
