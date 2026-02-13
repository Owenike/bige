"use client";

import { useI18n } from "../i18n-provider";

export default function ForbiddenPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="card fdGlassPanel">
            <div className="fdEyebrow">{zh ? "權限控管" : "ACCESS CONTROL"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "無權限" : "Forbidden"}
            </h1>
            <p className="fdGlassText">{zh ? "你沒有此頁面的存取權限。" : "You do not have access to this page."}</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <a className="fdPillBtn fdPillBtnPrimary" href="/login">
                {zh ? "前往登入" : "Go to login"}
              </a>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
