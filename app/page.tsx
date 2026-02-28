import Image from "next/image";
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
          </div>
        </div>
      </a>
    </article>
  );
}

function GridCard({ item }: { item: GridItem }) {
  return (
    <article className="homeLuxuryGridCard">
      <a className="homeLuxuryGridCardLink" href={item.href} aria-label={item.title}>
        <div className={`homeLuxuryGridMedia ${item.mediaClass}`}>
          <div className="homeLuxuryGridOverlay">
            <p className="homeLuxuryGridBadge">{item.badge}</p>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </div>
        </div>
      </a>
    </article>
  );
}

export default async function Home() {
  const locale = await getLocaleFromCookies();
  const t = await getT();
  const isEn = locale === "en";
  const heroTitleLines = t("home.hero_title").split("\n");
  const heroSubText = t("home.hero_sub");
  const zhHeroSubItems = ["器械皮拉提斯", "重量訓練", "樂齡訓練", "拳擊體能訓練", "核心燃脂訓練"];
  const heroSubItems = isEn ? heroSubText.trim().split(/\s+/) : zhHeroSubItems;
  const heroSubDisplayText = isEn ? heroSubText : zhHeroSubItems.join(" ");
  const useZhHeroSubGrid = !isEn;

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
      badge: "Senior",
      title: isEn ? "Senior Fitness Training" : "銀髮族訓練",
      description: isEn
        ? "Low-impact mobility and balance practice to improve daily stability and confident movement."
        : "低衝擊的活動度與平衡訓練，幫助提升日常穩定與行動自信。",
      href: "/login",
      mediaClass: "homeLuxuryMediaS4A",
      cta: "Go",
    },
    {
      badge: "Cardio",
      title: isEn ? "Cardio Conditioning Training" : "心肺體能訓練",
      description: isEn
        ? "Rhythm-based aerobic intervals to raise endurance, circulation efficiency, and sustained energy."
        : "透過節奏有氧與間歇訓練，提升心肺耐力、循環效率與持續體能。",
      href: "/member/entry-qr",
      mediaClass: "homeLuxuryMediaS4B",
      cta: "Open",
    },
    {
      badge: "Core",
      title: isEn ? "Core Training" : "核心訓練",
      description: isEn
        ? "Build trunk control and core strength to support posture quality and stable force output."
        : "強化軀幹控制與核心穩定，改善姿勢品質與發力表現。",
      href: "/frontdesk/checkin",
      mediaClass: "homeLuxuryMediaS4C",
      cta: "Open",
    },
    {
      badge: "Functional",
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
      badge: "Entry",
      title: isEn ? "Single Pass" : "單次入場",
      description: isEn
        ? "Flexible pay-per-visit entry. Train when you want without long-term commitment."
        : "彈性單次入場，想練就來，不被長約綁住。",
      href: "/member/entry-qr",
      mediaClass: "homeLuxuryMediaS6A",
      cta: "Open",
    },
    {
      badge: "Membership",
      title: isEn ? "Monthly Plan" : "月費",
      description: isEn
        ? "Flat monthly pricing with full gym access to help you stay consistent every week."
        : "固定月費方案，完整使用器材與空間，穩定建立每週運動習慣。",
      href: "/member",
      mediaClass: "homeLuxuryMediaS6B",
      cta: "Open",
    },
    {
      badge: "Coaching",
      title: isEn ? "Coaching Program" : "教練課程",
      description: isEn
        ? "Personal and small-group coaching programs built around your goals and training pace."
        : "一對一教練課程，依你的目標與節奏安排進度。",
      href: "/coach",
      mediaClass: "homeLuxuryMediaS6C",
      cta: "Open",
    },
    {
      badge: "Assessment",
      title: isEn ? "Body Assessment" : "體態測量",
      description: isEn
        ? "Track body shape and key metrics over time, so each stage of progress is visible."
        : "透過體態與關鍵數據追蹤變化，讓每個階段成果都看得見。",
      href: "/member/progress",
      mediaClass: "homeLuxuryMediaS6D",
      cta: "Open",
    },
  ];

  const sectionEightItems: GridItem[] = [
    {
      badge: "Contact Us",
      title: isEn ? "Contact Us" : "聯繫我們",
      description: isEn
        ? "Message us anytime and we will help you choose the right plan and schedule."
        : "歡迎隨時聯繫我們，將由專人協助你挑選最適合的方案與時段。",
      href: "/member/support",
      mediaClass: "homeLuxuryMediaS8A",
      cta: "Open",
    },
    {
      badge: "Book Now",
      title: isEn ? "Book Now" : "立即預約",
      description: isEn
        ? "Book your visit or trial class in minutes and secure your preferred time."
        : "線上快速完成預約，提前鎖定你想要的訓練時段。",
      href: "/member/bookings",
      mediaClass: "homeLuxuryMediaS8B",
      cta: "Open",
    },
    {
      badge: "Map Guide",
      title: isEn ? "Map Guide" : "地圖導覽",
      description: isEn
        ? "Open map directions and navigate to the gym with the fastest route."
        : "一鍵查看地圖路線，快速找到場館位置與交通方式。",
      href: "https://www.google.com/maps/search/?api=1&query=%E5%B7%A8%E6%8C%BA%E5%81%A5%E8%BA%AB%E9%A4%A8",
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
            <br />{heroTitleLines[1] || ""}
          </h1>
          {useZhHeroSubGrid ? (
            <p className="homeLuxuryHeroSub homeLuxuryHeroSubZh" aria-label={heroSubDisplayText}>
              {heroSubItems.map((item, index) => (
                <span
                  key={`${item}-${index}`}
                  className="homeLuxuryHeroSubItem"
                >
                  {item}
                </span>
              ))}
            </p>
          ) : (
            <p className="homeLuxuryHeroSub">{heroSubDisplayText}</p>
          )}
          <div className="homeLuxuryHeroActions">
            <a className="homeLuxuryBtn homeLuxuryBtnMobileOnly" href="/member/entry-qr">{t("home.member_dynamic_qr")}</a>
          </div>
        </div>
      </section>

      <section className="homeLuxuryGridSection homeLuxuryGridSectionPorsche">
        <div className="homeLuxuryGridInner">
          <div className="homeLuxurySectionTitleWithLogo">
            <h2 className="homeLuxurySectionTitle homeLuxurySectionTitlePorsche homeLuxurySectionTitleInline">
              {isEn ? "Bige Fitness Club" : "巨挺健身館"}
            </h2>
            <span className="homeLuxuryCircleLogo" aria-hidden>
              <Image src="/LOGO.jpg" alt="" width={128} height={128} className="homeLuxuryCircleLogoImage" />
            </span>
          </div>
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
          <p className="homeLuxuryEyebrow">{isEn ? t("home.calm_ui") : "心靈之旅"}</p>
          <h2 className="homeLuxuryOverlayTitle">{t("home.section_body_awareness")}</h2>
        </div>
      </section>

      <section className="homeLuxuryGridSection">
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle">{isEn ? "Training Programs" : "全方位訓練"}</h2>
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
      </section>

      <section className="homeLuxuryGridSection">
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle">{isEn ? "More Choices, Less Pressure" : "多元選擇 輕鬆無負擔"}</h2>
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
          {isEn ? <p className="homeLuxuryEyebrow">{t("home.clarity")}</p> : null}
          <h2 className="homeLuxuryOverlayTitle">{isEn ? t("home.platform_admin") : "掌握身體 才能體驗豐富人生"}</h2>
        </div>
      </section>

      <section className="homeLuxuryGridSection homeLuxuryGridSectionLast">
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle">{isEn ? "Take the First Step" : "邁出第一步"}</h2>
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
