"use client";

import { useEffect, useMemo, useRef } from "react";
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
  const sceneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onScroll = () => {
      if (!sceneRef.current) return;
      const y = Math.min(window.scrollY || 0, 320);
      sceneRef.current.style.setProperty("--fd-scroll", `${y}px`);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "FRONTDESK",
            title: "櫃檯工作台",
            sub: "統一處理報到、建檔、收款與交班，保持流程清楚且穩定。",
            primary: "開始報到掃碼",
            secondary: "會員查詢 / 建檔",
            statusTitle: "今日班務",
            statusOpen: "班別狀態",
            statusOpenValue: "已開班",
            statusTasks: "待處理",
            statusTasksValue: "3 項",
            statusTip: "建議先完成報到與收款，再進行交班。",
            cards: [
              { href: "/frontdesk/checkin", title: "報到掃碼", desc: "掃描會員動態 QR，快速完成入場驗證。", tag: "ENTRY" },
              { href: "/frontdesk/member-search", title: "會員查詢 / 建檔", desc: "查看會員資料，並可直接建立新會員。", tag: "MEMBER" },
              { href: "/frontdesk/orders/new", title: "新增訂單 + 收款", desc: "現場建立訂單並記錄付款流程。", tag: "PAYMENT" },
              { href: "/frontdesk/bookings", title: "預約協助", desc: "協助調整、取消與安排時段。", tag: "BOOKING" },
              { href: "/frontdesk/handover", title: "交班", desc: "整理本班摘要，完成交接。", tag: "SHIFT" },
            ] as ActionCard[],
          }
        : {
            badge: "FRONTDESK",
            title: "Frontdesk Workspace",
            sub: "Handle check-in, member onboarding, payment, and handover with clear flow.",
            primary: "Start Check-in Scanner",
            secondary: "Member Search / Create",
            statusTitle: "Today Shift",
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
    <main ref={sceneRef} className="fdGlassScene">
      <section className="fdGlassBackdrop fdEnter">
        <div className="fdGlassTop">
          <article className="fdGlassPanel fdGlassTall">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.badge}</span>
              <span className="fdChip">{t.statusOpenValue}</span>
            </div>
            <h2 className="fdGlassTitle">{t.title}</h2>
            <p className="fdGlassText">{t.sub}</p>
            <div className="fdGaugeWrap">
              <div className="fdGaugeRing" />
              <div className="fdGaugeValue">64%</div>
            </div>
          </article>

          <article className="fdGlassPanel">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.statusTitle}</span>
              <span className="fdChip">{t.statusTasksValue}</span>
            </div>
            <h2 className="fdGlassTitle" style={{ marginTop: 16 }}>
              {lang === "zh" ? "Hi 櫃檯夥伴" : "Hi Frontdesk"}
            </h2>
            <p className="fdGlassText">{t.statusTip}</p>
            <div className="fdPillActions">
              <a className="fdPillBtn fdPillBtnPrimary" href="/frontdesk/checkin">
                {t.primary}
              </a>
              <a className="fdPillBtn" href="/frontdesk/member-search">
                {t.secondary}
              </a>
            </div>
          </article>

          <article className="fdGlassPanel fdGlassTall">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.statusOpen}</span>
              <span className="fdChip">{t.statusTasks}</span>
            </div>
            <h2 className="fdGlassTitle">{lang === "zh" ? "班務概況" : "Shift Overview"}</h2>
            <div className="fdDial">
              <div className="fdDialInner">24°C</div>
            </div>
            <div className="fdMetricLine">
              <span>{t.statusOpen}</span>
              <strong>{t.statusOpenValue}</strong>
            </div>
            <div className="fdMetricLine">
              <span>{t.statusTasks}</span>
              <strong>{t.statusTasksValue}</strong>
            </div>
          </article>
        </div>

        <section style={{ marginTop: 14 }}>
          <div className="fdActionGrid">
            {t.cards.map((card, idx) => (
              <a
                key={card.href}
                href={card.href}
                className="fdGlassSubPanel fdActionCard fdEnter"
                style={{ animationDelay: `${120 + idx * 60}ms` }}
              >
                <div className="fdActionHead">
                  <span className="kvLabel">{card.tag}</span>
                  <span className="fdArrow">{">>"}</span>
                </div>
                <h3 className="fdActionTitle">{card.title}</h3>
                <p className="sub" style={{ marginTop: 8 }}>
                  {card.desc}
                </p>
              </a>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

