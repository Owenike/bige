"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@supabase/supabase-js";

function appOrigin() {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return window.location.origin.replace(/\/+$/, "");
}

export default function StudentForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) throw new Error("目前無法使用密碼重設，請洽現場人員。");

      const client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const result = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${appOrigin()}/reset-password?mode=student`,
      });
      if (result.error) {
        if (result.error.status === 429) throw new Error("寄送次數過多，請稍後再試。");
        throw new Error("目前無法寄送重設信，請稍後再試或洽現場人員。");
      }
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "目前無法寄送重設信。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="studentCheckInPage">
      <section className="studentCheckInCard">
        <p className="studentCheckInEyebrow">BIGE CHECK-IN</p>
        <h1>忘記密碼</h1>
        {sent ? (
          <div className="studentCheckInCentered">
            <div className="studentCheckInPendingMark" aria-hidden="true">✓</div>
            <h2>請查看 Email</h2>
            <p className="studentCheckInLead">如果這個 Email 已建立學員資料，重設密碼連結會寄到信箱。</p>
            <p className="studentCheckInLead">連結有時會被放進垃圾郵件，請一併確認。</p>
            <Link className="studentCheckInPrimary" href="/check-in">返回報到登入</Link>
          </div>
        ) : (
          <>
            <p className="studentCheckInLead">輸入第一次報到時填寫的 Email，我們會寄送一次性重設連結。</p>
            <form className="studentCheckInForm" onSubmit={submit}>
              <label>
                <span>Email</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required />
              </label>
              {error ? <p className="studentCheckInError" role="alert">{error}</p> : null}
              <button className="studentCheckInPrimary" type="submit" disabled={busy}>{busy ? "寄送中..." : "寄送重設連結"}</button>
              <Link className="studentCheckInTextButton" href="/check-in">返回報到登入</Link>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
