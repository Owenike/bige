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
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Signing out...</h1>
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
      </div>
    </main>
  );
}
