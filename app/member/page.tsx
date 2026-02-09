import React from "react";

export default function MemberHomePage() {
  return (
    <main className="container">
      <section className="hero">
        <div className="card kv" style={{ padding: 18 }}>
          <div className="kvLabel">MEMBER</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            會員中心
          </h1>
          <p className="sub">前往我的預約與個人資料。</p>

          <div className="actions">
            <a className="btn btnPrimary" href="/member/bookings">
              我的預約
            </a>
            <a className="btn" href="/member/profile">
              個人資料
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
