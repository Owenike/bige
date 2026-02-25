import { getT } from "../lib/i18n-server";

type GridItem = {
  badge: string;
  title: string;
  description: string;
  href: string;
  mediaClass: string;
  cta: string;
};

function GridCard({ item }: { item: GridItem }) {
  return (
    <article className="homeLuxuryGridCard">
      <div className={`homeLuxuryGridMedia ${item.mediaClass}`} />
      <div className="homeLuxuryGridBody">
        <p className="homeLuxuryGridBadge">{item.badge}</p>
        <h3>{item.title}</h3>
        <p>{item.description}</p>
        <a className="homeLuxuryGridLink" href={item.href}>{item.cta}</a>
      </div>
    </article>
  );
}

export default async function Home() {
  const t = await getT();
  const heroTitleLines = t("home.hero_title").split("\n");

  const sectionTwoItems: GridItem[] = [
    {
      badge: t("home.flow"),
      title: t("home.member_area"),
      description: t("home.flow_desc"),
      href: "/member",
      mediaClass: "homeLuxuryMediaS2A",
      cta: "Open",
    },
    {
      badge: t("home.clarity"),
      title: t("home.frontdesk_desk"),
      description: t("home.clarity_desc"),
      href: "/frontdesk",
      mediaClass: "homeLuxuryMediaS2B",
      cta: "Open",
    },
    {
      badge: t("home.quick_links"),
      title: t("home.coach_console"),
      description: t("home.calm_ui_desc"),
      href: "/coach",
      mediaClass: "homeLuxuryMediaS2C",
      cta: "Open",
    },
    {
      badge: t("home.quick_links"),
      title: t("home.manager_ops"),
      description: t("home.section_body_awareness"),
      href: "/manager",
      mediaClass: "homeLuxuryMediaS2D",
      cta: "Open",
    },
  ];

  const sectionFourItems: GridItem[] = [
    {
      badge: "Access",
      title: t("home.cta_login"),
      description: t("home.hero_sub"),
      href: "/login",
      mediaClass: "homeLuxuryMediaS4A",
      cta: "Go",
    },
    {
      badge: "Member",
      title: t("home.member_dynamic_qr"),
      description: t("home.flow_desc"),
      href: "/member/entry-qr",
      mediaClass: "homeLuxuryMediaS4B",
      cta: "Open",
    },
    {
      badge: "Desk",
      title: t("home.frontdesk_checkin"),
      description: t("home.clarity_desc"),
      href: "/frontdesk/checkin",
      mediaClass: "homeLuxuryMediaS4C",
      cta: "Open",
    },
    {
      badge: "Admin",
      title: t("home.platform_admin"),
      description: t("home.calm_ui_desc"),
      href: "/platform-admin",
      mediaClass: "homeLuxuryMediaS4D",
      cta: "Open",
    },
  ];

  const sectionSixItems: GridItem[] = [
    {
      badge: "Role",
      title: t("home.member_area"),
      description: t("home.hero_sub"),
      href: "/member",
      mediaClass: "homeLuxuryMediaS6A",
      cta: "Open",
    },
    {
      badge: "Role",
      title: t("home.coach_console"),
      description: t("home.flow_desc"),
      href: "/coach",
      mediaClass: "homeLuxuryMediaS6B",
      cta: "Open",
    },
    {
      badge: "Role",
      title: t("home.manager_ops"),
      description: t("home.clarity_desc"),
      href: "/manager",
      mediaClass: "homeLuxuryMediaS6C",
      cta: "Open",
    },
    {
      badge: "Role",
      title: t("home.platform_admin"),
      description: t("home.calm_ui_desc"),
      href: "/platform-admin",
      mediaClass: "homeLuxuryMediaS6D",
      cta: "Open",
    },
  ];

  const sectionEightItems: GridItem[] = [
    {
      badge: "Fast Entry",
      title: t("home.member_dynamic_qr"),
      description: t("home.flow_desc"),
      href: "/member/entry-qr",
      mediaClass: "homeLuxuryMediaS8A",
      cta: "Open",
    },
    {
      badge: "On Site",
      title: t("home.frontdesk_checkin"),
      description: t("home.clarity_desc"),
      href: "/frontdesk/checkin",
      mediaClass: "homeLuxuryMediaS8B",
      cta: "Open",
    },
    {
      badge: "Session",
      title: t("auth.logout"),
      description: t("home.calm_ui_desc"),
      href: "/logout",
      mediaClass: "homeLuxuryMediaS8C",
      cta: "Open",
    },
  ];

  return (
    <main className="homeLuxury">
      <section className="homeLuxuryHero homeLuxuryFullImageSection homeLuxuryHeroImage">
        <div className="homeLuxuryFullShade" />
        <div className="homeLuxuryOverlayContent">
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

      <section className="homeLuxuryGridSection">
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle">{t("home.quick_links")}</h2>
          <div className="homeLuxuryGridFour">
            {sectionTwoItems.map((item) => (
              <GridCard key={`${item.title}-${item.href}`} item={item} />
            ))}
          </div>
        </div>
      </section>

      <section className="homeLuxuryFullImageSection homeLuxurySectionImageA">
        <div className="homeLuxuryFullShade" />
        <div className="homeLuxuryOverlayContent homeLuxuryOverlayCompact">
          <p className="homeLuxuryEyebrow">{t("home.calm_ui")}</p>
          <h2 className="homeLuxuryOverlayTitle">{t("home.section_body_awareness")}</h2>
          <a className="homeLuxuryBtn" href="/member">{t("home.member_area")}</a>
        </div>
      </section>

      <section className="homeLuxuryGridSection">
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle">Operational Paths</h2>
          <div className="homeLuxuryGridFour">
            {sectionFourItems.map((item) => (
              <GridCard key={`${item.title}-${item.href}`} item={item} />
            ))}
          </div>
        </div>
      </section>

      <section className="homeLuxuryFullImageSection homeLuxurySectionImageC">
        <div className="homeLuxuryFullShade" />
        <div className="homeLuxuryOverlayContent homeLuxuryOverlayCompact">
          <p className="homeLuxuryEyebrow">{t("home.flow")}</p>
          <h2 className="homeLuxuryOverlayTitle">{t("home.frontdesk_desk")}</h2>
          <a className="homeLuxuryBtn" href="/frontdesk">Open Frontdesk</a>
        </div>
      </section>

      <section className="homeLuxuryGridSection">
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle">Role Centers</h2>
          <div className="homeLuxuryGridFour">
            {sectionSixItems.map((item) => (
              <GridCard key={`${item.title}-${item.href}`} item={item} />
            ))}
          </div>
        </div>
      </section>

      <section className="homeLuxuryFullImageSection homeLuxurySectionImageB">
        <div className="homeLuxuryFullShade" />
        <div className="homeLuxuryOverlayContent homeLuxuryOverlayCompact">
          <p className="homeLuxuryEyebrow">{t("home.clarity")}</p>
          <h2 className="homeLuxuryOverlayTitle">{t("home.platform_admin")}</h2>
          <a className="homeLuxuryBtn" href="/platform-admin">Open Admin</a>
        </div>
      </section>

      <section className="homeLuxuryGridSection homeLuxuryGridSectionLast">
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle">Final Actions</h2>
          <div className="homeLuxuryGridThree">
            {sectionEightItems.map((item) => (
              <GridCard key={`${item.title}-${item.href}`} item={item} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
