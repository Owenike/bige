import { getLocaleFromCookies, getT } from "../lib/i18n-server";

type GridItem = {
  badge: string;
  title: string;
  description: string;
  href: string;
  mediaClass: string;
  cta: string;
};

function PorscheCard({ item }: { item: GridItem }) {
  return (
    <article className="homeLuxuryPorscheCard">
      <a className="homeLuxuryPorscheLink" href={item.href}>
        <div className={`homeLuxuryGridMedia homeLuxuryPorscheMedia ${item.mediaClass}`}>
          <div className="homeLuxuryPorscheOverlay">
            <p className="homeLuxuryPorscheBadge">{item.badge}</p>
            <h3>{item.title}</h3>
            <div className="homeLuxuryPorscheFooter">
              <span className="homeLuxuryPorscheCta">{item.cta}</span>
              <span className="homeLuxuryPorscheArrow" aria-hidden>→</span>
            </div>
          </div>
        </div>
      </a>
    </article>
  );
}

function GridCard({ item }: { item: GridItem }) {
  return (
    <article className="homeLuxuryGridCard">
      <div className={`homeLuxuryGridMedia ${item.mediaClass}`}>
        <div className="homeLuxuryGridOverlay">
          <p className="homeLuxuryGridBadge">{item.badge}</p>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
          <a className="homeLuxuryGridLink" href={item.href}>{item.cta}</a>
        </div>
      </div>
    </article>
  );
}

export default async function Home() {
  const locale = await getLocaleFromCookies();
  const t = await getT();
  const isEn = locale === "en";
  const heroTitleLines = t("home.hero_title").split("\n");

  const sectionTwoItems: GridItem[] = [
    {
      badge: "線條雕碩",
      title: "器械皮拉提斯",
      description: t("home.flow_desc"),
      href: "/member",
      mediaClass: "homeLuxuryMediaS2A",
      cta: "Open",
    },
    {
      badge: "增肌減脂",
      title: "重量訓練",
      description: t("home.clarity_desc"),
      href: "/frontdesk",
      mediaClass: "homeLuxuryMediaS2B",
      cta: "Open",
    },
    {
      badge: "燃脂紓壓",
      title: "拳擊訓練",
      description: t("home.calm_ui_desc"),
      href: "/coach",
      mediaClass: "homeLuxuryMediaS2C",
      cta: "Open",
    },
    {
      badge: "疲勞釋放",
      title: "運動按摩",
      description: t("home.section_body_awareness"),
      href: "/manager",
      mediaClass: "homeLuxuryMediaS2D",
      cta: "Open",
    },
  ];

  const sectionFourItems: GridItem[] = [
    {
      badge: isEn ? "Senior" : "銀髮族",
      title: isEn ? "Senior Fitness Training" : "銀髮族訓練",
      description: isEn
        ? "Low-impact mobility and balance practice to improve daily stability and confident movement."
        : "低衝擊的活動度與平衡訓練，幫助提升日常穩定與行動自信。",
      href: "/login",
      mediaClass: "homeLuxuryMediaS4A",
      cta: "Go",
    },
    {
      badge: isEn ? "Cardio" : "心肺體能",
      title: isEn ? "Cardio Conditioning Training" : "心肺體能訓練",
      description: isEn
        ? "Rhythm-based aerobic intervals to raise endurance, circulation efficiency, and sustained energy."
        : "透過節奏有氧與間歇訓練，提升心肺耐力、循環效率與持續體能。",
      href: "/member/entry-qr",
      mediaClass: "homeLuxuryMediaS4B",
      cta: "Open",
    },
    {
      badge: isEn ? "Core" : "核心",
      title: isEn ? "Core Training" : "核心訓練",
      description: isEn
        ? "Build trunk control and core strength to support posture quality and stable force output."
        : "強化軀幹控制與核心穩定，改善姿勢品質與發力表現。",
      href: "/frontdesk/checkin",
      mediaClass: "homeLuxuryMediaS4C",
      cta: "Open",
    },
    {
      badge: isEn ? "Functional" : "功能性",
      title: isEn ? "Functional Adjustment" : "功能性調整",
      description: isEn
        ? "Targeted movement correction to release fatigue patterns and restore efficient mechanics."
        : "針對動作代償與疲勞模式進行調整，恢復更有效率的身體機制。",
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
          <div className="homeLuxuryHeroTextBlock">
            <h1 className="homeLuxuryHeroTitle">
              {heroTitleLines[0] || t("home.hero_title")}
              <br />
              {heroTitleLines[1] || ""}
            </h1>
            <p className="homeLuxuryHeroSub">{t("home.hero_sub")}</p>
          </div>
          <div className="homeLuxuryHeroActions">
            <a className="homeLuxuryBtn homeLuxuryBtnPrimary" href="/login">{t("home.cta_login")}</a>
            <a className="homeLuxuryBtn" href="/member/entry-qr">{t("home.member_dynamic_qr")}</a>
            <a className="homeLuxuryBtn" href="/frontdesk/checkin">{t("home.frontdesk_checkin")}</a>
          </div>
        </div>
      </section>

      <section className="homeLuxuryGridSection homeLuxuryGridSectionPorsche">
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle homeLuxurySectionTitlePorsche">{t("home.quick_links")}</h2>
          <div className="homeLuxuryGridShowcase">
            {sectionTwoItems.map((item) => (
              <PorscheCard key={`${item.title}-${item.href}`} item={item} />
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
          <h2 className="homeLuxurySectionTitle">{isEn ? "Training Programs" : "訓練課程"}</h2>
          <div className="homeLuxuryGridFour">
            {sectionFourItems.map((item) => (
              <GridCard key={`${item.title}-${item.href}`} item={item} />
            ))}
          </div>
        </div>
      </section>

      <section className="homeLuxuryFullVideoSection">
        <iframe
          className="homeLuxuryYouTubeEmbed"
          src="https://www.youtube-nocookie.com/embed/V33I8IozKgc?autoplay=1&mute=1&loop=1&playlist=V33I8IozKgc&controls=0&rel=0&playsinline=1&modestbranding=1"
          title="Homepage showcase video"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
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


