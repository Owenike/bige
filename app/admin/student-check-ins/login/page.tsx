"use client";

import Link from "next/link";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STUDENT_CHECK_INS_ADMIN_PATH = "/admin/student-check-ins";
const STUDENT_DROP_IN_ADMIN_PATH = "/admin/student-check-ins/drop-in";

function isSafeReturnTo(value: string | null): value is string {
  return value === STUDENT_CHECK_INS_ADMIN_PATH || value === STUDENT_DROP_IN_ADMIN_PATH;
}

function StudentCheckInAdminLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = useMemo(
    () => {
      const requestedPath = searchParams.get("returnTo") || searchParams.get("redirect");
      return isSafeReturnTo(requestedPath) ? requestedPath : STUDENT_CHECK_INS_ADMIN_PATH;
    },
    [searchParams],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/student-check-ins/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "登入失敗，請稍後再試。");
      }
      router.replace(returnTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登入失敗，請稍後再試。");
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
          <div className="studentAdminLoginEyebrow">CHECK-IN ADMIN</div>
          <h1 className="studentAdminLoginTitle">會員報到管理</h1>
        </div>

        <section className="studentAdminLoginFormSection">
          {error ? <div className="error">{error}</div> : null}

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

            <div className="field">
              <label className="studentAdminLoginLabel" htmlFor="student-checkin-admin-password">
                密碼
              </label>
              <div className="studentAdminLoginPasswordField">
                <input
                  autoComplete="current-password"
                  className="input"
                  id="student-checkin-admin-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="********"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
                  className="studentAdminLoginPasswordToggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  title={showPassword ? "隱藏密碼" : "顯示密碼"}
                  type="button"
                >
                  {showPassword ? "隱藏" : "顯示"}
                </button>
              </div>
            </div>

            <div className="studentAdminLoginActions">
              <button className="studentAdminLoginSubmit" disabled={busy} type="submit">
                {busy ? "登入中..." : "登入報到管理"}
              </button>
              <Link className="studentAdminLoginLink" href="/forgot-password?returnTo=/admin/student-check-ins/login">
                忘記密碼
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

export default function StudentCheckInAdminLoginPage() {
  return (
    <Suspense fallback={<main className="studentAdminLoginPage" />}>
      <StudentCheckInAdminLoginContent />
    </Suspense>
  );
}
