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
            badge: "FRONTDESK",
            title: "\u6ac3\u6aaf\u4f5c\u696d\u4e2d\u6a1e",
            sub: "\u96c6\u4e2d\u8655\u7406\u5831\u5230\u3001\u5efa\u6a94\u3001\u6536\u6b3e\u8207\u4ea4\u73ed\uff0c\u8b93\u73ed\u52d9\u66f4\u7a69\u5b9a\u3002",
            primary: "\u958b\u59cb\u5831\u5230\u6383\u78bc",
            secondary: "\u6703\u54e1\u67e5\u8a62 / \u5efa\u6a94",
            statusTitle: "\u7576\u524d\u73ed\u52d9",
            statusOpen: "\u73ed\u5225\u72c0\u614b",
            statusOpenValue: "\u5df2\u958b\u73ed",
            statusTasks: "\u5f85\u8655\u7406",
            statusTasksValue: "3 \u9805",
            statusTip: "\u5efa\u8b70\u5148\u5b8c\u6210\u5831\u5230\u8207\u6536\u6b3e\uff0c\u518d\u9032\u884c\u4ea4\u73ed\u3002",
            cards: [
              { href: "/frontdesk/checkin", title: "\u5831\u5230\u6383\u78bc", desc: "\u6383\u63cf\u6703\u54e1\u52d5\u614b QR\uff0c\u5feb\u901f\u5b8c\u6210\u5165\u5834\u9a57\u8b49\u3002", tag: "ENTRY" },
              { href: "/frontdesk/member-search", title: "\u6703\u54e1\u67e5\u8a62 / \u5efa\u6a94", desc: "\u67e5\u770b\u6703\u54e1\u8cc7\u6599\uff0c\u4e26\u53ef\u76f4\u63a5\u5efa\u7acb\u65b0\u6703\u54e1\u3002", tag: "MEMBER" },
              { href: "/frontdesk/orders/new", title: "\u65b0\u589e\u8a02\u55ae + \u6536\u6b3e", desc: "\u73fe\u5834\u5efa\u7acb\u8a02\u55ae\u4e26\u8a18\u9304\u4ed8\u6b3e\u6d41\u7a0b\u3002", tag: "PAYMENT" },
              { href: "/frontdesk/bookings", title: "\u9810\u7d04\u5354\u52a9", desc: "\u5354\u52a9\u8abf\u6574\u3001\u53d6\u6d88\u8207\u5b89\u6392\u6642\u6bb5\u3002", tag: "BOOKING" },
              { href: "/frontdesk/handover", title: "\u4ea4\u73ed", desc: "\u6574\u7406\u672c\u73ed\u6458\u8981\uff0c\u5b8c\u6210\u4ea4\u63a5\u3002", tag: "SHIFT" },
            ] as ActionCard[],
          }
        : {
            badge: "FRONTDESK",
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
    <main className="fdGlassScene">
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
                className="fdActionCard fdEnter"
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
