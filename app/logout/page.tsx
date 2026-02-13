"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Logout failed");
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
            <div className="fdEyebrow">SESSION</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Signing out...
            </h1>
            {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : <p className="fdGlassText">Please wait while your session is being cleared.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}
