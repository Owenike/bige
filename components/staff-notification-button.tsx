"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./staff-notification-button.module.css";

export default function StaffNotificationButton() {
  const [unread, setUnread] = useState(0);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const response = await fetch("/api/notifications?status=unread&limit=1", {
        cache: "no-store",
      }).catch(() => null);
      if (!active || !response?.ok) return;
      const payload = await response.json().catch(() => null);
      const data = payload?.data || payload;
      setUnread(Number(data?.unreadCount || 0));
      setAvailable(true);
    }

    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!available) return null;

  return (
    <Link
      className={styles.button}
      href="/staff/notifications"
      aria-label={unread > 0 ? `通知中心，${unread} 則未讀` : "通知中心"}
      title="通知中心"
    >
      <Bell size={20} />
      {unread > 0 ? <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span> : null}
    </Link>
  );
}
