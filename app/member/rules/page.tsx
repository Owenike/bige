"use client";

import { useI18n } from "../../i18n-provider";
import { MemberTabs } from "../_components/MemberTabs";

export default function MemberRulesPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">{zh ? "規則" : "RULES"}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>{zh ? "會員規則" : "Member Rules"}</h1>
          <p className="sub">
            {zh
              ? "以下為會員端使用、預約、取消、入場與帳務的重要規則摘要。"
              : "Core policy summary for member usage, booking, cancellation, entry, and billing."}
          </p>
          <MemberTabs />

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "預約與取消" : "Booking & Cancellation"}</div>
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              <li className="sub">
                {zh ? "課程開始前 120 分鐘內不可自行取消或改期。" : "No self-cancel/reschedule within 120 minutes before class."}
              </li>
              <li className="sub">
                {zh ? "取消/改期需填寫原因，系統會保留紀錄。" : "Reason is required for cancel/reschedule and recorded in logs."}
              </li>
            </ul>
          </section>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "入場與簽到" : "Entry & Check-in"}</div>
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              <li className="sub">
                {zh ? "請使用會員 QR Code 入場，QR 會自動更新。" : "Use member QR for entry; token refreshes automatically."}
              </li>
              <li className="sub">
                {zh ? "異常狀況（重複入場、No-show）將由櫃台依規則處理。" : "Entry anomalies (duplicate/no-show) are processed by frontdesk policies."}
              </li>
            </ul>
          </section>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "帳務與退款" : "Billing & Refund"}</div>
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              <li className="sub">
                {zh ? "消費與扣課以系統紀錄為準。" : "System records are the source of truth for billing and pass redemption."}
              </li>
              <li className="sub">
                {zh ? "如有異常，請到客服工單回報並附上明細時間。" : "For billing issues, submit a support ticket with relevant timestamps."}
              </li>
            </ul>
          </section>
        </div>
      </section>
    </main>
  );
}
