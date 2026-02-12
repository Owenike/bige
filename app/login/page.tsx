"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "../i18n-provider";

type MeResponse = {
  userId: string;
  role: "platform_admin" | "manager" | "frontdesk" | "coach" | "member";
  tenantId: string | null;
  branchId: string | null;
};

function roleHome(role: MeResponse["role"]) {
  switch (role) {
    case "platform_admin":
      return "/platform-admin";
    case "manager":
      return "/manager";
    case "frontdesk":
      return "/frontdesk";
    case "coach":
      return "/coach";
    case "member":
      return "/member";
    default:
      return "/";
  }
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const redirectTo = useMemo(() => {
    const v = searchParams.get("redirect");
    // Keep redirects on-site only.
    if (!v || !v.startsWith("/")) return null;
    return v;
  }, [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || "Login failed");

      const meRes = await fetch("/api/auth/me");
      const mePayload = (await meRes.json().catch(() => null)) as MeResponse | null;
      if (!meRes.ok || !mePayload?.role) throw new Error((mePayload as any)?.error || "Profile not ready");

      router.replace(redirectTo || roleHome(mePayload.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <div className="card formCard">
        <div className="kvLabel">{t("home.member_area")}</div>
        <h1 className="sectionTitle" style={{ marginTop: 10 }}>
          {t("auth.sign_in")}
        </h1>

        {error ? (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        <form onSubmit={submit} style={{ marginTop: 12 }}>
          <label className="field">
            <span className="kvLabel" style={{ textTransform: "none" }}>
              {t("auth.email")}
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

          <label className="field">
            <span className="kvLabel" style={{ textTransform: "none" }}>
              {t("auth.password")}
            </span>
            <input
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          <div className="actions" style={{ marginTop: 14 }}>
            <button type="submit" disabled={busy} className={`btn ${busy ? "" : "btnPrimary"}`}>
              {busy ? t("auth.signing_in") : t("auth.sign_in")}
            </button>
            <Link className="btn" href="/forgot-password">
              忘記密碼
            </Link>
            <Link className="btn" href="/">
              {t("common.back_home")}
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<main className="container">{t("common.loading")}</main>}>
      <LoginContent />
    </Suspense>
  );
}
