import { getT } from "../lib/i18n-server";

export default async function Home() {
  const t = await getT();
  const heroTitleLines = t("home.hero_title").split("\n");

  return (
    <main className="homeLuxury">
      <section className="homeLuxuryHero">
        <video
          className="homeLuxuryHeroVideo"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          poster="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1920&q=80"
        >
          <source src="https://player.vimeo.com/external/371433846.sd.mp4?s=236d0365417e992cf83f8d4d32dcff3ce2fe04dd&profile_id=165&oauth2_token_id=57447761" type="video/mp4" />
        </video>
        <div className="homeLuxuryHeroShade" />
        <div className="homeLuxuryHeroContent">
          <p className="homeLuxuryEyebrow">BIGE</p>
          <h1 className="homeLuxuryHeroTitle">
            {heroTitleLines[0] || t("home.hero_title")}
            <br />
            {heroTitleLines[1] || ""}
          </h1>
          <p className="homeLuxuryHeroSub">{t("home.hero_sub")}</p>
          <div className="homeLuxuryHeroActions">
            <a className="homeLuxuryBtn homeLuxuryBtnPrimary" href="/login">{t("home.cta_login")}</a>
            <a className="homeLuxuryBtn" href="/member/entry-qr">{t("home.member_dynamic_qr")}</a>
            <a className="homeLuxuryBtn" href="/frontdesk/checkin">{t("home.frontdesk_checkin")}</a>
          </div>
        </div>
      </section>

      <section className="homeLuxuryEditorial">
        <article className="homeLuxuryFeatureCard">
          <div className="homeLuxuryFeatureMedia homeLuxuryFeatureMediaOne" />
          <div className="homeLuxuryFeatureBody">
            <p className="homeLuxuryCardLabel">{t("home.flow")}</p>
            <h2>{t("home.member_area")}</h2>
            <p>{t("home.flow_desc")}</p>
            <a className="homeLuxuryTextLink" href="/member">Explore Member</a>
          </div>
        </article>
        <article className="homeLuxuryFeatureCard">
          <div className="homeLuxuryFeatureMedia homeLuxuryFeatureMediaTwo" />
          <div className="homeLuxuryFeatureBody">
            <p className="homeLuxuryCardLabel">{t("home.clarity")}</p>
            <h2>{t("home.frontdesk_desk")}</h2>
            <p>{t("home.clarity_desc")}</p>
            <a className="homeLuxuryTextLink" href="/frontdesk">Explore Frontdesk</a>
          </div>
        </article>
      </section>

      <section className="homeLuxuryTiles">
        <article className="homeLuxuryTile">
          <div className="homeLuxuryTileMedia homeLuxuryTileMediaOne" />
          <div className="homeLuxuryTileBody">
            <p className="homeLuxuryCardLabel">{t("home.quick_links")}</p>
            <h3>{t("home.coach_console")}</h3>
            <a className="homeLuxuryTextLink" href="/coach">Open</a>
          </div>
        </article>
        <article className="homeLuxuryTile">
          <div className="homeLuxuryTileMedia homeLuxuryTileMediaTwo" />
          <div className="homeLuxuryTileBody">
            <p className="homeLuxuryCardLabel">{t("home.quick_links")}</p>
            <h3>{t("home.manager_ops")}</h3>
            <a className="homeLuxuryTextLink" href="/manager">Open</a>
          </div>
        </article>
        <article className="homeLuxuryTile">
          <div className="homeLuxuryTileMedia homeLuxuryTileMediaThree" />
          <div className="homeLuxuryTileBody">
            <p className="homeLuxuryCardLabel">{t("home.quick_links")}</p>
            <h3>{t("home.platform_admin")}</h3>
            <a className="homeLuxuryTextLink" href="/platform-admin">Open</a>
          </div>
        </article>
      </section>

      <section className="homeLuxuryBand">
        <div>
          <p className="homeLuxuryCardLabel">{t("home.calm_ui")}</p>
          <h2>{t("home.section_body_awareness")}</h2>
          <p>{t("home.calm_ui_desc")}</p>
        </div>
        <div className="homeLuxuryBandActions">
          <a className="homeLuxuryBtn" href="/logout">{t("auth.logout")}</a>
        </div>
      </section>
    </main>
  );
}
