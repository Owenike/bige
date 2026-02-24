"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n-provider";
import { MemberTabs } from "./_components/MemberTabs";

type MemberMePayload = {
  member?: {
    full_name?: string | null;
  } | null;
  activeSubscription?: {
    valid_to?: string | null;
  } | null;
  activePasses?: Array<{
    remaining?: number | null;
    expires_at?: string | null;
  }>;
  checkins?: Array<{
    checked_at?: string | null;
    result?: string | null;
  }>;
};

type BookingItem = {
  id: string;
  service_name: string | null;
  starts_at: string;
  status: string | null;
};

type BookingPayload = {
  items?: BookingItem[];
};

function formatDateTime(input: string | null | undefined) {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleString();
}

function isSameLocalDay(input: string, now: Date) {
  const date = new Date(input);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function daysUntil(input: string | null | undefined) {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export default function MemberHomePage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<MemberMePayload | null>(null);
  const [bookings, setBookings] = useState<BookingItem[]>([]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, bookingRes] = await Promise.all([
        fetch("/api/member/me", { cache: "no-store" }),
        fetch("/api/member/bookings", { cache: "no-store" }),
      ]);

      const mePayload = (await meRes.json().catch(() => null)) as MemberMePayload | { error?: string } | null;
      const bookingPayload = (await bookingRes.json().catch(() => null)) as BookingPayload | { error?: string } | null;

      if (!meRes.ok) {
        throw new Error((mePayload as { error?: string } | null)?.error || (zh ? "載入會員首頁失敗" : "Failed to load dashboard"));
      }
      if (!bookingRes.ok) {
        throw new Error((bookingPayload as { error?: string } | null)?.error || (zh ? "載入預約資料失敗" : "Failed to load bookings"));
      }

      setMe(mePayload as MemberMePayload);
      const bookingItems =
        bookingPayload && typeof bookingPayload === "object" && Array.isArray((bookingPayload as BookingPayload).items)
          ? (bookingPayload as BookingPayload).items || []
          : [];
      setBookings(bookingItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "載入會員首頁失敗" : "Failed to load dashboard");
      setMe(null);
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const summary = useMemo(() => {
    const now = new Date();
    const todayCheckedIn = (me?.checkins || []).some((item) => {
      if (!item?.checked_at) return false;
      if ((item.result || "").toLowerCase() !== "allow") return false;
      return isSameLocalDay(item.checked_at, now);
    });

    const upcomingBookings = bookings
      .filter((item) => {
        if (!item.starts_at) return false;
        const startsAt = new Date(item.starts_at).getTime();
        if (Number.isNaN(startsAt)) return false;
        return startsAt >= Date.now() && (item.status || "") !== "cancelled";
      })
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

    const remainingSessions = (me?.activePasses || []).reduce((total, item) => {
      const remaining = Number(item?.remaining ?? 0);
      if (!Number.isFinite(remaining) || remaining < 0) return total;
      return total + remaining;
    }, 0);

    const membershipExpireInDays = daysUntil(me?.activeSubscription?.valid_to || null);
    const nextPassExpiry = (me?.activePasses || [])
      .map((item) => item.expires_at)
      .filter((item): item is string => Boolean(item))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];

    return {
      todayCheckedIn,
      upcomingBookings,
      remainingSessions,
      membershipExpireInDays,
      nextPassExpiry: nextPassExpiry || null,
    };
  }, [bookings, me?.activePasses, me?.activeSubscription?.valid_to, me?.checkins]);

  const reminders = useMemo(() => {
    const items: string[] = [];

    if (!summary.todayCheckedIn) {
      items.push(zh ? "今天還沒簽到，入場前記得先開啟 QR。" : "You have not checked in today. Open your entry QR before arrival.");
    }

    if (summary.upcomingBookings.length > 0) {
      const next = summary.upcomingBookings[0];
      items.push(
        zh
          ? `下一堂課：${next.service_name || "課程"}，${formatDateTime(next.starts_at)}`
          : `Next booking: ${next.service_name || "Class"} at ${formatDateTime(next.starts_at)}`,
      );
    }

    if (summary.membershipExpireInDays !== null && summary.membershipExpireInDays <= 7) {
      items.push(
        zh
          ? `會籍將在 ${Math.max(summary.membershipExpireInDays, 0)} 天內到期，請提前續約。`
          : `Membership expires in ${Math.max(summary.membershipExpireInDays, 0)} day(s). Renew soon.`,
      );
    }

    if (summary.nextPassExpiry) {
      const passExpireInDays = daysUntil(summary.nextPassExpiry);
      if (passExpireInDays !== null && passExpireInDays <= 7) {
        items.push(
          zh
            ? `最近堂數到期日：${formatDateTime(summary.nextPassExpiry)}`
            : `Nearest pass expiry: ${formatDateTime(summary.nextPassExpiry)}`,
        );
      }
    }

    if (items.length === 0) {
      items.push(zh ? "今天的提醒已完成，保持節奏。" : "No urgent reminders today.");
    }

    return items;
  }, [summary.membershipExpireInDays, summary.nextPassExpiry, summary.todayCheckedIn, summary.upcomingBookings, zh]);

  return (
    <main className="container">
      <section className="hero">
        <div className="card kv" style={{ padding: 18 }}>
          <div className="kvLabel">{zh ? "會員" : "MEMBER"}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            {zh ? "會員中心" : "Member Center"}
          </h1>
          <p className="sub">
            {zh
              ? `Hi ${me?.member?.full_name || ""}，今天要做什麼：簽到、預約、查看剩餘堂數與到期提醒。`
              : `Hi ${me?.member?.full_name || ""}. Today: check-in, bookings, remaining sessions, and expiry reminders.`}
          </p>

          <MemberTabs />

          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={() => void loadDashboard()} disabled={loading}>
              {loading ? (zh ? "更新中..." : "Refreshing...") : zh ? "重新整理" : "Refresh"}
            </button>
            <a className="btn btnPrimary" href="/member/entry-qr">
              {zh ? "前往簽到 QR" : "Open Entry QR"}
            </a>
          </div>

          {error ? (
            <p className="sub" style={{ marginTop: 10, color: "var(--danger, #b00020)" }}>
              {error}
            </p>
          ) : null}

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
            }}
          >
            <article className="card" style={{ padding: 12 }}>
              <div className="kvLabel">{zh ? "簽到" : "Check-in"}</div>
              <div className="kvValue" style={{ marginTop: 8 }}>
                {summary.todayCheckedIn ? (zh ? "今日已簽到" : "Done today") : zh ? "今日未簽到" : "Pending"}
              </div>
            </article>
            <article className="card" style={{ padding: 12 }}>
              <div className="kvLabel">{zh ? "預約" : "Bookings"}</div>
              <div className="kvValue" style={{ marginTop: 8 }}>
                {summary.upcomingBookings.length}
              </div>
              <p className="sub" style={{ marginTop: 6 }}>
                {summary.upcomingBookings[0]
                  ? formatDateTime(summary.upcomingBookings[0].starts_at)
                  : zh
                    ? "目前沒有待上課程"
                    : "No upcoming class"}
              </p>
            </article>
            <article className="card" style={{ padding: 12 }}>
              <div className="kvLabel">{zh ? "剩餘堂數" : "Remaining Sessions"}</div>
              <div className="kvValue" style={{ marginTop: 8 }}>
                {summary.remainingSessions}
              </div>
            </article>
            <article className="card" style={{ padding: 12 }}>
              <div className="kvLabel">{zh ? "到期提醒" : "Expiry Reminder"}</div>
              <div className="kvValue" style={{ marginTop: 8 }}>
                {summary.membershipExpireInDays === null
                  ? "-"
                  : summary.membershipExpireInDays < 0
                    ? (zh ? "已到期" : "Expired")
                    : `${summary.membershipExpireInDays} ${zh ? "天" : "days"}`}
              </div>
              <p className="sub" style={{ marginTop: 6 }}>
                {summary.nextPassExpiry ? formatDateTime(summary.nextPassExpiry) : zh ? "無近期到期堂數" : "No pass expiring soon"}
              </p>
            </article>
          </div>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "今天要做什麼" : "Today Checklist"}</div>
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              {reminders.map((item) => (
                <li key={item} className="sub" style={{ marginTop: 6 }}>
                  {item}
                </li>
              ))}
            </ul>
            <div className="actions" style={{ marginTop: 10 }}>
              <a className="btn" href="/member/bookings">
                {zh ? "管理我的預約" : "Manage Bookings"}
              </a>
              <a className="btn" href="/member/entitlements">
                {zh ? "查看方案與堂數" : "View Plans"}
              </a>
              <a className="btn" href="/member/profile">
                {zh ? "更新會員資料" : "Update Profile"}
              </a>
              <a className="btn" href="/member/notifications">
                {zh ? "通知中心" : "Notifications"}
              </a>
              <a className="btn" href="/member/support">
                {zh ? "客服工單" : "Support"}
              </a>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
