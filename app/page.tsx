import { getT } from "../lib/i18n-server";

export default async function Home() {
  const t = await getT();
  return (
    <main className="container">
      <section className="hero">
        <div className="heroGrid">
          <div className="card kv" style={{ padding: 18 }}>
            <div className="kvLabel">{t("home.baseline")}</div>
            <h1 className="h1" style={{ marginTop: 10 }}>
              {t("home.hero_title").split("\n")[0]}
              <br />
              {t("home.hero_title").split("\n")[1]}
            </h1>
            <p className="sub">{t("home.hero_sub")}</p>

            <div className="actions">
              <a className="btn btnPrimary" href="/login">
                {t("home.cta_login")}
              </a>
              <a className="btn" href="/member/entry-qr">
                {t("home.member_dynamic_qr")}
              </a>
              <a className="btn" href="/frontdesk/checkin">
                {t("home.frontdesk_checkin")}
              </a>
            </div>
          </div>

          <div className="card kv" style={{ padding: 18 }}>
            <div className="kvLabel">{t("home.quick_links")}</div>
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <a className="pill" href="/member">
                {t("home.member_area")}
              </a>
              <a className="pill" href="/coach">
                {t("home.coach_console")}
              </a>
              <a className="pill" href="/frontdesk">
                {t("home.frontdesk_desk")}
              </a>
              <a className="pill" href="/manager">
                {t("home.manager_ops")}
              </a>
              <a className="pill" href="/platform-admin">
                {t("home.platform_admin")}
              </a>
              <a className="pill" href="/logout">
                {t("auth.logout")}
              </a>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2 className="sectionTitle">{t("home.section_body_awareness")}</h2>
        <div className="grid">
          <div className="card kv">
            <div className="kvLabel">{t("home.flow")}</div>
            <div className="kvValue">{t("home.flow_desc")}</div>
          </div>
          <div className="card kv">
            <div className="kvLabel">{t("home.clarity")}</div>
            <div className="kvValue">{t("home.clarity_desc")}</div>
          </div>
          <div className="card kv">
            <div className="kvLabel">{t("home.calm_ui")}</div>
            <div className="kvValue">{t("home.calm_ui_desc")}</div>
          </div>
        </div>
      </section>
    </main>
  );
}
