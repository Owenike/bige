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
            badge: "櫃檯中心",
            title: "櫃檯工作台",
            sub: "整合入場驗證、會員查詢、收款與交班流程。",
            primary: "開始掃碼入場",
            secondary: "會員查詢 / 建立",
            statusTitle: "今日班次",
            statusOpen: "班次狀態",
            statusOpenValue: "進行中",
            statusTasks: "待辦",
            statusTasksValue: "3 項",
            statusTip: "先完成入場與收款，再進行交班結算。",
            shiftOverview: "班次總覽",
            cards: [
              { href: "/frontdesk/checkin", title: "入場驗證", desc: "掃描會員動態 QR，快速完成入場確認。", tag: "ENTRY" },
              { href: "/frontdesk/member-search", title: "會員查詢 / 建立", desc: "查找既有會員，必要時直接建立新會員。", tag: "MEMBER" },
              { href: "/frontdesk/orders/new", title: "新增訂單 + 收款", desc: "建立櫃檯訂單並記錄付款。", tag: "PAYMENT" },
              { href: "/frontdesk/bookings", title: "預約管理", desc: "協助建立、取消與更新預約。", tag: "BOOKING" },
              { href: "/frontdesk/handover", title: "交班", desc: "整理班次金流與備註，完成交接。", tag: "SHIFT" },
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
            shiftOverview: "Shift Overview",
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
              {lang === "zh" ? "嗨，櫃檯夥伴" : "Hi Frontdesk"}
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
            <h2 className="fdGlassTitle">{t.shiftOverview}</h2>
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
