"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const TRACKED_PREFIXES = [
  "/manager",
  "/frontdesk",
  "/coach",
  "/staff",
  "/platform-admin",
  "/admin",
];

function shouldTrack(pathname: string) {
  if (pathname.startsWith("/login") || pathname.startsWith("/staff/activate")) return false;
  return TRACKED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function StaffPageTelemetry() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || !shouldTrack(pathname)) return;

    let stopped = false;
    let sessionId: string | null = null;

    const post = (body: Record<string, unknown>, keepalive = false) =>
      fetch("/api/staff-usage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        keepalive,
        body: JSON.stringify(body),
      }).catch(() => null);

    void post({ action: "start", path: pathname })
      .then(async (response) => {
        if (!response || !response.ok || stopped) return;
        const payload = await response.json().catch(() => null);
        sessionId = payload?.data?.sessionId || payload?.sessionId || null;
      });

    const heartbeat = window.setInterval(() => {
      if (sessionId && document.visibilityState === "visible") {
        void post({ action: "heartbeat", sessionId });
      }
    }, 30_000);

    const onVisibilityChange = () => {
      if (sessionId && document.visibilityState === "hidden") {
        void post({ action: "heartbeat", sessionId }, true);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (sessionId) void post({ action: "end", sessionId }, true);
    };
  }, [pathname]);

  return null;
}
