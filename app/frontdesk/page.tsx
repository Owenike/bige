"use client";

import { useMemo } from "react";
import { useI18n } from "../i18n-provider";

type ActionCard = {
  href: string;
  title: string;
  desc: string;
  tag: string;
};

export default function FrontdeskPortalPage() {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "Frontdesk",
            title: "櫃檯作業中樞",
            sub: "集中處理報到、建檔、收款與交班，讓櫃檯流程更快更穩定。",
            primary: "開始報到掃碼",
            secondary: "會員查詢 / 建檔",
            statusTitle: "當前班務",
            statusOpen: "班別狀態",
            statusOpenValue: "已開班",
            statusTasks: "待處理",
            statusTasksValue: "3 項",
            statusTip: "建議先完成報到與收款，再進行交班。",
            cards: [
              { href: "/frontdesk/checkin", title: "報到掃碼", desc: "掃描會員動態 QR，快速完成入場驗證。", tag: "ENTRY" },
              { href: "/frontdesk/member-search", title: "會員查詢 / 建檔", desc: "搜尋會員資料，必要時直接建立新會員。", tag: "MEMBER" },
              { href: "/frontdesk/orders/new", title: "新增訂單 + 收款", desc: "現場建立訂單並記錄付款流程。", tag: "PAYMENT" },
              { href: "/frontdesk/bookings", title: "預約協助", desc: "協助修改、取消與安排時段。", tag: "BOOKING" },
              { href: "/frontdesk/handover", title: "交班", desc: "整理班務摘要並完成交接。", tag: "SHIFT" },
            ] as ActionCard[],
          }
        : {
            badge: "Frontdesk",
            title: "Frontdesk Operations Hub",
            sub: "Handle check-in, member onboarding, payment, and handover from one place.",
            primary: "Start Check-in Scanner",
            secondary: "Member Search / Create",
            statusTitle: "Current Shift",
            statusOpen: "Shift State",
            statusOpenValue: "Open",
            statusTasks: "Pending",
            statusTasksValue: "3 items",
            statusTip: "Complete check-in and payments first, then finalize handover.",
            cards: [
              { href: "/frontdesk/checkin", title: "Check-in Scanner", desc: "Scan member dynamic QR and verify entry fast.", tag: "ENTRY" },
              { href: "/frontdesk/member-search", title: "Member Search / Create", desc: "Find member records and create new ones when needed.", tag: "MEMBER" },
              { href: "/frontdesk/orders/new", title: "New Order + Payment", desc: "Create desk orders and capture payment flow.", tag: "PAYMENT" },
              { href: "/frontdesk/bookings", title: "Booking Assist", desc: "Help with reschedule, cancel, and slot support.", tag: "BOOKING" },
              { href: "/frontdesk/handover", title: "Shift Handover", desc: "Wrap up shift summary and hand off cleanly.", tag: "SHIFT" },
            ] as ActionCard[],
          },
    [lang],
  );

  return (
    <main className="container">
      <section className="hero">
        <div className="heroGrid">
          <div className="card kv fdHero fdEnter">
            <div className="kvLabel">{t.badge}</div>
            <h1 className="h1" style={{ marginTop: 10 }}>
              {t.title}
            </h1>
            <p className="sub">{t.sub}</p>

            <div className="actions">
              <a className="btn btnPrimary" href="/frontdesk/checkin">
                {t.primary}
              </a>
              <a className="btn" href="/frontdesk/member-search">
                {t.secondary}
              </a>
            </div>
          </div>

          <div className="card kv fdStatus fdEnter">
            <h2 className="sectionTitle" style={{ marginBottom: 12 }}>
              {t.statusTitle}
            </h2>
            <div className="fdStatusGrid">
              <div className="card kv">
                <div className="kvLabel">{t.statusOpen}</div>
                <div className="fdBig">{t.statusOpenValue}</div>
              </div>
              <div className="card kv">
                <div className="kvLabel">{t.statusTasks}</div>
                <div className="fdBig">{t.statusTasksValue}</div>
              </div>
            </div>
            <p className="sub" style={{ marginTop: 12 }}>
              {t.statusTip}
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 8 }}>
        <div className="fdCards">
          {t.cards.map((card, idx) => (
            <a
              key={card.href}
              href={card.href}
              className="card kv fdCard fdEnter"
              style={{ animationDelay: `${80 + idx * 60}ms` }}
            >
              <div className="fdCardHead">
                <span className="kvLabel">{card.tag}</span>
                <span className="fdArrow">{"->"}</span>
              </div>
              <h3 className="fdCardTitle">{card.title}</h3>
              <p className="sub" style={{ marginTop: 8 }}>
                {card.desc}
              </p>
            </a>
          ))}
        </div>
      </section>

      <style jsx>{`
        .fdHero {
          padding: 20px;
          background:
            radial-gradient(360px 120px at 0% -10%, rgba(127, 185, 173, 0.2), transparent 65%),
            radial-gradient(260px 90px at 100% 0%, rgba(202, 163, 106, 0.18), transparent 70%),
            var(--surface);
        }
        .fdStatus {
          padding: 20px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(245, 243, 238, 0.92));
        }
        .fdStatusGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .fdBig {
          margin-top: 8px;
          font-size: 24px;
          line-height: 1.1;
          font-weight: 700;
          font-family: var(--font-serif, ui-serif, "Noto Serif TC", serif);
        }
        .fdCards {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .fdCard {
          padding: 16px;
          transition: transform 150ms ease, box-shadow 180ms ease, border-color 180ms ease;
          text-decoration: none;
        }
        .fdCard:hover {
          transform: translateY(-2px);
          border-color: rgba(47, 122, 111, 0.28);
          box-shadow: var(--shadow-1);
          text-decoration: none;
        }
        .fdCard:focus-visible {
          outline: none;
          box-shadow: 0 0 0 4px rgba(127, 185, 173, 0.22), var(--shadow-1);
          border-color: rgba(47, 122, 111, 0.35);
        }
        .fdCardHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .fdArrow {
          color: var(--muted);
          font-size: 14px;
          line-height: 1;
        }
        .fdCardTitle {
          margin: 8px 0 0;
          font-family: var(--font-serif, ui-serif, "Noto Serif TC", serif);
          font-size: 22px;
          line-height: 1.2;
        }
        .fdEnter {
          animation: fdFadeUp 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
        }
        @keyframes fdFadeUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (max-width: 900px) {
          .fdCards {
            grid-template-columns: 1fr;
          }
          .fdStatusGrid {
            grid-template-columns: 1fr;
          }
          .fdCardTitle {
            font-size: 20px;
          }
        }
      `}</style>
    </main>
  );
}
