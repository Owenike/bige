 "use client";

import { useMemo } from "react";
import { useI18n } from "../i18n-provider";

export default function FrontdeskPortalPage() {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            title: "\u6ac3\u6aaf\u4f5c\u696d\u9996\u9801",
            checkin: "\u5831\u5230\u6383\u78bc",
            memberSearch: "\u6703\u54e1\u67e5\u8a62/\u5efa\u6a94",
            newOrder: "\u65b0\u589e\u8a02\u55ae + \u6536\u6b3e",
            bookings: "\u9810\u7d04\u5354\u52a9",
            handover: "\u4ea4\u73ed",
          }
        : {
            title: "Frontdesk Portal",
            checkin: "Check-in Scanner",
            memberSearch: "Member Search/Create",
            newOrder: "New Order + Payment",
            bookings: "Booking Assist",
            handover: "Shift Handover",
          },
    [lang],
  );

  return (
    <main style={{ padding: 24 }}>
      <h1>{t.title}</h1>
      <ul>
        <li><a href="/frontdesk/checkin">{t.checkin}</a></li>
        <li><a href="/frontdesk/member-search">{t.memberSearch}</a></li>
        <li><a href="/frontdesk/orders/new">{t.newOrder}</a></li>
        <li><a href="/frontdesk/bookings">{t.bookings}</a></li>
        <li><a href="/frontdesk/handover">{t.handover}</a></li>
      </ul>
    </main>
  );
}
