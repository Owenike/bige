"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type QuickAction = {
  href: string;
  icon: string;
  zh: string;
  en: string;
  zhDesc: string;
  enDesc: string;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    href: "/member/bookings",
    icon: "📅",
    zh: "管理我的預約",
    en: "Manage Bookings",
    zhDesc: "查看、改期、取消課程",
    enDesc: "View, reschedule, and cancel classes",
  },
  {
    href: "/member/entitlements",
    icon: "🎟",
    zh: "查看方案與堂數",
    en: "View Plans",
    zhDesc: "確認會籍與剩餘堂數",
    enDesc: "Check memberships and remaining sessions",
  },
  {
    href: "/member/profile",
    icon: "🪪",
    zh: "更新會員資料",
    en: "Update Profile",
    zhDesc: "更新聯絡方式與個人資料",
    enDesc: "Update contact and profile details",
  },
  {
    href: "/member/notifications",
    icon: "🔔",
    zh: "通知中心",
    en: "Notifications",
    zhDesc: "查看系統提醒與活動訊息",
    enDesc: "Check reminders and announcements",
  },
  {
    href: "/member/support",
    icon: "🎫",
    zh: "客服工單",
    en: "Support",
    zhDesc: "提交問題並追蹤處理進度",
    enDesc: "Submit issues and track progress",
  },
  {
    href: "/member/progress",
    icon: "📈",
    zh: "訓練進度",
    en: "Progress",
    zhDesc: "查看訓練成果與目標",
    enDesc: "Review training progress and goals",
  },
];

function formatDateTime(input: string | null | undefined) {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleString();
}

function isSameLocalDay(input: string, now: Date) {
  const date = new Date(input);
  return (
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
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
        throw new Error((mePayload as { error?: string } | null)?.error || (zh ? "載入會員資料失敗" : "Failed to load dashboard"));
      }
      if (!bookingRes.ok) {
        throw new Error((bookingPayload as { error?: string } | null)?.error || (zh ? "載入預約失敗" : "Failed to load bookings"));
      }

      setMe(mePayload as MemberMePayload);
      const bookingItems =
        bookingPayload && typeof bookingPayload === "object" && Array.isArray((bookingPayload as BookingPayload).items)
          ? (bookingPayload as BookingPayload).items || []
          : [];
      setBookings(bookingItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "載入會員資料失敗" : "Failed to load dashboard");
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
          ? `會籍將於 ${Math.max(summary.membershipExpireInDays, 0)} 天內到期，建議提前續約。`
          : `Membership expires in ${Math.max(summary.membershipExpireInDays, 0)} day(s). Renew soon.`,
      );
    }

    if (summary.nextPassExpiry) {
      const passExpireInDays = daysUntil(summary.nextPassExpiry);
      if (passExpireInDays !== null && passExpireInDays <= 7) {
        items.push(
          zh
            ? `最近到期堂數：${formatDateTime(summary.nextPassExpiry)}`
            : `Nearest pass expiry: ${formatDateTime(summary.nextPassExpiry)}`,
        );
      }
    }

    if (items.length === 0) {
      items.push(zh ? "今天沒有急迫提醒，維持目前節奏即可。" : "No urgent reminders today.");
    }

    return items;
  }, [summary.membershipExpireInDays, summary.nextPassExpiry, summary.todayCheckedIn, summary.upcomingBookings, zh]);

  const nextBooking = summary.upcomingBookings[0];
  const memberName = me?.member?.full_name || (zh ? "會員" : "Member");
  const todayGuide = summary.todayCheckedIn
    ? (zh ? "今天已簽到，接著確認預約與方案。" : "Checked in today. Review your bookings and plan usage.")
    : (zh ? "今天要做什麼：簽到、預約、查看剩餘堂數與到期提醒。" : "Today: check-in, bookings, remaining sessions, and expiry reminders.");

  const expiryValue = summary.membershipExpireInDays === null
    ? (zh ? "目前無有效會籍" : "No active membership")
    : summary.membershipExpireInDays < 0
      ? (zh ? "已到期" : "Expired")
      : `${summary.membershipExpireInDays} ${zh ? "天" : "days"}`;

  const expiryHint = summary.nextPassExpiry
    ? (zh ? `最近堂數到期：${formatDateTime(summary.nextPassExpiry)}` : `Next pass expiry: ${formatDateTime(summary.nextPassExpiry)}`)
    : (zh ? "無近期到期堂數" : "No pass expiring soon");

  return (
    <main className="container">
      <section className="hero">
        <div className="card kv memberDashWrap">
          <header className="memberHeader">
            <div>
              <div className="kvLabel">{zh ? "會員" : "MEMBER"}</div>
              <h1 className="h1 memberTitle">{zh ? "會員中心" : "Member Center"}</h1>
              <p className="sub memberSubtitle">{`Hi ${memberName}，${todayGuide}`}</p>
            </div>
            <div className="memberHeaderIcons">
              <button
                type="button"
                className="memberIconBtn"
                onClick={() => void loadDashboard()}
                disabled={loading}
                aria-label={zh ? "重新整理" : "Refresh"}
                title={zh ? "重新整理" : "Refresh"}
              >
                ↻
              </button>
              <a
                className="memberIconBtn"
                href="/member/notifications"
                aria-label={zh ? "通知中心" : "Notifications"}
                title={zh ? "通知中心" : "Notifications"}
              >
                🔔
              </a>
            </div>
          </header>

          <MemberTabs />

          <section className="card memberPrimaryCta">
            <div>
              <p className="kvLabel">{zh ? "快速開始" : "Quick Start"}</p>
              <p className="sub memberCtaHint">
                {zh ? "先完成入場簽到，再安排今天的課程。" : "Start with check-in, then manage today’s classes."}
              </p>
            </div>
            <div className="memberCtaActions">
              <a className="btn btnPrimary memberPrimaryBtn" href="/member/entry-qr">
                {zh ? "前往簽到 QR" : "Open Entry QR"}
              </a>
              <a className="btn memberSecondaryBtn" href="/member/bookings">
                {zh ? "立即預約 / 管理預約" : "Book / Manage"}
              </a>
            </div>
          </section>

          {error ? (
            <p className="sub" style={{ marginTop: 10, color: "var(--danger, #b00020)" }}>
              {error}
            </p>
          ) : null}

          <section className="memberSummaryGrid">
            <article className="card memberSummaryCard">
              <div>
                <div className="kvLabel">{zh ? "簽到" : "Check-in"}</div>
                <div className="memberSummaryValue">{summary.todayCheckedIn ? (zh ? "今日已簽到" : "Done today") : (zh ? "今日未簽到" : "Pending")}</div>
                <p className="sub memberSummaryHint">
                  {summary.todayCheckedIn
                    ? (zh ? "可以直接前往課程與訓練。" : "You are ready for class.")
                    : (zh ? "入場前請先開啟 QR 完成簽到。" : "Open entry QR before arrival.")}
                </p>
              </div>
              <div className="memberCardAction">
                <a className="btn" href="/member/entry-qr">{zh ? "前往簽到" : "Check In"}</a>
              </div>
            </article>

            <article className="card memberSummaryCard">
              <div>
                <div className="kvLabel">{zh ? "預約" : "Bookings"}</div>
                <div className="memberSummaryValue">
                  {summary.upcomingBookings.length > 0 ? summary.upcomingBookings.length : (zh ? "目前無待上課程" : "No upcoming class")}
                </div>
                <p className="sub memberSummaryHint">
                  {nextBooking
                    ? formatDateTime(nextBooking.starts_at)
                    : (zh ? "可立即安排下一堂課。" : "Schedule your next class now.")}
                </p>
              </div>
              <div className="memberCardAction">
                <a className="btn" href="/member/bookings">{zh ? "查看預約" : "View Bookings"}</a>
              </div>
            </article>

            <article className="card memberSummaryCard">
              <div>
                <div className="kvLabel">{zh ? "剩餘堂數" : "Remaining Sessions"}</div>
                <div className="memberSummaryValue">
                  {summary.remainingSessions > 0 ? summary.remainingSessions : (zh ? "目前無剩餘堂數" : "No remaining sessions")}
                </div>
                <p className="sub memberSummaryHint">
                  {summary.remainingSessions > 0
                    ? (zh ? "可到方案頁查看使用明細。" : "Check usage details in Plans.")
                    : (zh ? "建議加購方案或補充堂數。" : "Consider buying or renewing sessions.")}
                </p>
              </div>
              <div className="memberCardAction">
                <a className="btn" href="/member/entitlements">{zh ? "查看方案" : "View Plans"}</a>
              </div>
            </article>

            <article className="card memberSummaryCard">
              <div>
                <div className="kvLabel">{zh ? "到期提醒" : "Expiry Reminder"}</div>
                <div className="memberSummaryValue">{expiryValue}</div>
                <p className="sub memberSummaryHint">{expiryHint}</p>
              </div>
              <div className="memberCardAction">
                <a className="btn" href="/member/entitlements">{zh ? "查看方案" : "View Plans"}</a>
              </div>
            </article>
          </section>

          <section className="card memberTaskCard">
            <div>
              <div className="kvLabel">{zh ? "今天要做什麼" : "Today Task"}</div>
              <p className="sub memberTaskText">{reminders[0]}</p>
            </div>
            <a className="btn" href="/member/entry-qr">{zh ? "前往簽到" : "Go Check-in"}</a>
          </section>

          <section className="card memberRemindersCard">
            <div className="kvLabel">{zh ? "提醒總覽" : "Reminders"}</div>
            <ul className="memberReminderList">
              {reminders.map((item) => (
                <li key={item} className="sub">
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="memberQuickGrid">
            {QUICK_ACTIONS.map((item) => (
              <a key={item.href} href={item.href} className="card memberQuickItem">
                <div className="memberQuickIcon" aria-hidden="true">{item.icon}</div>
                <div className="memberQuickTitle">{zh ? item.zh : item.en}</div>
                <p className="sub memberQuickDesc">{zh ? item.zhDesc : item.enDesc}</p>
              </a>
            ))}
          </section>
        </div>
      </section>
      <style jsx>{`
        .memberDashWrap {
          padding: 20px;
          display: grid;
          gap: 14px;
        }
        .memberHeader {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .memberTitle {
          margin-top: 8px;
          font-size: clamp(30px, 3.5vw, 42px);
        }
        .memberSubtitle {
          margin-top: 8px;
          margin-bottom: 0;
        }
        .memberHeaderIcons {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        .memberIconBtn {
          width: 40px;
          height: 40px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: linear-gradient(140deg, rgba(255, 255, 255, 0.86), rgba(240, 246, 255, 0.64));
          box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.95), var(--shadow-2);
          text-decoration: none;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        .memberIconBtn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }
        .memberPrimaryCta {
          padding: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .memberCtaHint {
          margin-top: 4px;
          margin-bottom: 0;
        }
        .memberCtaActions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .memberPrimaryBtn {
          min-width: 180px;
          font-weight: 700;
        }
        .memberSecondaryBtn {
          min-width: 160px;
        }
        .memberSummaryGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .memberSummaryCard {
          padding: 12px;
          display: grid;
          gap: 8px;
          min-height: 190px;
        }
        .memberSummaryValue {
          margin-top: 8px;
          font-size: clamp(24px, 2.8vw, 34px);
          font-weight: 700;
          line-height: 1.2;
          letter-spacing: -0.01em;
          color: #1b2a3e;
        }
        .memberSummaryHint {
          margin-top: 6px;
          margin-bottom: 0;
          font-size: 14px;
        }
        .memberCardAction {
          margin-top: auto;
          display: flex;
          justify-content: flex-end;
        }
        .memberTaskCard {
          padding: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .memberTaskText {
          margin-top: 8px;
          margin-bottom: 0;
        }
        .memberRemindersCard {
          padding: 12px;
        }
        .memberReminderList {
          margin: 8px 0 0;
          padding-left: 18px;
          display: grid;
          gap: 6px;
        }
        .memberReminderList .sub {
          margin: 0;
        }
        .memberQuickGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .memberQuickItem {
          padding: 12px;
          text-decoration: none;
          display: grid;
          gap: 6px;
          align-content: start;
          min-height: 150px;
        }
        .memberQuickItem:hover {
          text-decoration: none;
        }
        .memberQuickIcon {
          font-size: 22px;
          line-height: 1;
        }
        .memberQuickTitle {
          font-weight: 700;
          color: #1b2a3e;
          font-size: 16px;
          line-height: 1.3;
        }
        .memberQuickDesc {
          margin: 0;
          font-size: 13px;
          line-height: 1.45;
        }
        @media (max-width: 920px) {
          .memberDashWrap {
            padding: 16px;
          }
          .memberSummaryGrid {
            grid-template-columns: 1fr;
          }
          .memberQuickGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      `}</style>
    </main>
  );
}
