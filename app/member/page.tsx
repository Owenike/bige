"use client";

import React from "react";
import { useI18n } from "../i18n-provider";

export default function MemberHomePage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  return (
    <main className="container">
      <section className="hero">
        <div className="card kv" style={{ padding: 18 }}>
          <div className="kvLabel">{zh ? "會員" : "MEMBER"}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            {zh ? "會員中心" : "Member Center"}
          </h1>
          <p className="sub">{zh ? "查看預約與個人資料。" : "View your bookings and profile."}</p>

          <div className="actions">
            <a className="btn btnPrimary" href="/member/bookings">
              {zh ? "我的預約" : "My Bookings"}
            </a>
            <a className="btn" href="/member/profile">
              {zh ? "個人資料" : "Profile"}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
