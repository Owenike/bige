"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "../i18n-provider";

export default function LogoutPage() {
  const router = useRouter();
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch (err) {
        setError(err instanceof Error ? err.message : zh ? "登出失敗" : "Logout failed");
        return;
      }
      router.replace("/login");
    }
    void run();
  }, [router]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="card fdGlassPanel">
            <div className="fdEyebrow">{zh ? "工作階段" : "SESSION"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "登出中..." : "Signing out..."}
            </h1>
            {error ? (
              <div className="error" style={{ marginTop: 10 }}>
                {error}
              </div>
            ) : (
              <p className="fdGlassText">{zh ? "正在清除你的登入狀態，請稍候。" : "Please wait while your session is being cleared."}</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
