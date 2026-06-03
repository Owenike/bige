import Image from "next/image";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HomeHoverVideo } from "@/components/home-hover-video";
import { getLocaleFromCookies, getT } from "../lib/i18n-server";
import HomeScrollEffects from "./home-scroll-effects";

const siteUrl = "https://bigefitness.com";
const homeSeoTitle = "巨挺健身館 BigE Fitness｜高雄仁武健身房・器械皮拉提斯・私人教練・運動按摩";
const homeSeoDescription =
  "巨挺健身館 BigE Fitness 位於高雄仁武區，提供一對一私人教練、重量訓練、Reformer 器械皮拉提斯、拳擊體能、樂齡訓練、運動按摩與功能性調整。新手友善、免綁約，適合想改善體態、增肌減脂、建立運動習慣的你。";
const homeOgImage = "/home-images/home-hero-main.png";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: homeSeoTitle,
  description: homeSeoDescription,
  keywords: [
    "高雄仁武健身房",
    "仁武區健身房",
    "仁武私人教練",
    "仁武器械皮拉提斯",
    "仁武運動按摩",
    "重量訓練",
    "Reformer 器械皮拉提斯",
    "拳擊體能",
    "樂齡訓練",
    "運動按摩",
    "功能性調整",
  ],
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: homeSeoTitle,
    description: homeSeoDescription,
    url: siteUrl,
    siteName: "巨挺健身館 BigE Fitness",
    type: "website",
    locale: "zh_TW",
    images: [
      {
        url: homeOgImage,
        alt: "巨挺健身館 BigE Fitness 高雄仁武健身房",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: homeSeoTitle,
    description: homeSeoDescription,
    images: [homeOgImage],
  },
};

const homeJsonLd = {
  "@context": "https://schema.org",
  "@type": "HealthClub",
  name: "巨挺健身館 BigE Fitness",
  alternateName: "BigE Fitness",
  url: siteUrl,
  description: homeSeoDescription,
  image: `${siteUrl}${homeOgImage}`,
  address: {
    "@type": "PostalAddress",
    addressCountry: "TW",
    addressRegion: "高雄市",
    addressLocality: "仁武區",
    streetAddress: "八德北路728號",
  },
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      opens: "10:00",
      closes: "22:00",
    },
  ],
  areaServed: "高雄仁武區",
  serviceType: ["重量訓練", "器械皮拉提斯", "拳擊體能", "樂齡訓練", "運動按摩", "功能性調整", "INBODY 測量"],
};

type GridItem = {
  badge: string;
  title: string;
  description: string;
  href: string;
  mediaClass: string;
  cta: string;
  videoSrc?: string;
  videoLabel?: string;
  titleDisplay?: ReactNode;
  clickHint?: string;
  ctaTone?: "primary" | "secondary" | "tertiary";
};

function PorscheCard({ item, mobileReveal = false }: { item: GridItem; mobileReveal?: boolean }) {
  return (
    <article
      className="homeLuxuryPorscheCard"
      data-reveal-item
      data-parallax-card
      data-mobile-service-card={mobileReveal ? "" : undefined}
    >
      <div className="homeLuxuryPorscheLink">
        <div
          className={`homeLuxuryGridMedia homeLuxuryPorscheMedia${item.videoSrc ? " homeLuxuryMediaVideoCard" : ""} ${item.mediaClass}`}
        >
          {item.videoSrc ? (
            <HomeHoverVideo src={item.videoSrc} label={item.videoLabel ?? item.title} />
          ) : null}
          <div className="homeLuxuryPorscheOverlay">
            <p className="homeLuxuryPorscheBadge">{item.badge}</p>
            <h3>{item.titleDisplay ?? item.title}</h3>
          </div>
        </div>
      </div>
    </article>
  );
}

function GridCard({ item, clickable = false }: { item: GridItem; clickable?: boolean }) {
  const cardContent = (
    <div className={`homeLuxuryGridMedia ${item.mediaClass}`}>
      <div className="homeLuxuryGridOverlay">
        <p className="homeLuxuryGridBadge">{item.badge}</p>
        <h3>{item.titleDisplay ?? item.title}</h3>
        <p>{item.description}</p>
        {item.clickHint ? <span className="homeLuxuryGridCardCta">{item.clickHint}</span> : null}
      </div>
    </div>
  );

  return (
    <article
      className={`homeLuxuryGridCard${item.ctaTone ? ` homeLuxuryGridCardTone${item.ctaTone[0].toUpperCase()}${item.ctaTone.slice(1)}` : ""}`}
      data-reveal-item
      data-parallax-card
    >
      {clickable ? (
        <a className="homeLuxuryGridCardLink" href={item.href} aria-label={item.title}>
          {cardContent}
        </a>
      ) : (
        <div className="homeLuxuryGridCardFrame">{cardContent}</div>
      )}
    </article>
  );
}

export default async function Home() {
  const locale = await getLocaleFromCookies();
  const t = await getT();
  const isEn = locale === "en";
  const heroTitleLines = t("home.hero_title").split("\n");
  const heroSubText = t("home.hero_sub");
  const heroSubDisplayText = heroSubText;

  const sectionTwoItems: GridItem[] = [
    {
      badge: "線條雕碩",
      title: "器械皮拉提斯",
      description: t("home.flow_desc"),
      href: "/member",
      mediaClass: "homeLuxuryMediaS2A",
      cta: "Open",
      videoSrc: "/home-videos/card-pilates-showcase.mp4",
      videoLabel: "器械皮拉提斯影片背景",
    },
    {
      badge: "增肌減脂",
      title: "重量訓練",
      description: t("home.clarity_desc"),
      href: "/frontdesk",
      mediaClass: "homeLuxuryMediaS2B",
      cta: "Open",
      videoSrc: "/home-videos/card-weight-training-showcase.mp4",
      videoLabel: "重量訓練影片背景",
    },
    {
      badge: "燃脂紓壓",
      title: "拳擊體能訓練",
      description: t("home.calm_ui_desc"),
      href: "/coach",
      mediaClass: "homeLuxuryMediaS2C",
      cta: "Open",
      videoSrc: "/home-videos/card-boxing-showcase.mp4",
      videoLabel: "拳擊體能訓練影片背景",
    },
    {
      badge: "疲勞釋放",
      title: "運動按摩",
      description: t("home.section_body_awareness"),
      href: "/manager",
      mediaClass: "homeLuxuryMediaS2D",
      cta: "Open",
      videoSrc: "/home-videos/card-massage-showcase.mp4",
      videoLabel: "運動按摩影片背景",
    },
  ];

  const sectionFourItems: GridItem[] = [
    {
      badge: "WEIGHT",
      title: isEn ? "Weight Training" : "重量訓練",
      description: isEn
        ? "Build strength, improve movement quality, and support better posture with focused one-on-one coaching."
        : "透過一對一教練指導，建立正確動作品質，提升肌力、體態與日常活動能力。",
      href: "/training/weight-training",
      mediaClass: "homeLuxuryMediaS4A",
      cta: "Go",
      clickHint: isEn ? "Learn more ->" : "了解更多 →",
    },
    {
      badge: "BOXING",
      title: isEn ? "Boxing Conditioning Training" : "拳擊體能訓練",
      description: isEn
        ? "Combine boxing drills, agile footwork, and cardio intervals to improve fat burning, coordination, and explosive power."
        : "結合拳擊動作、敏捷反應與心肺訓練，提升燃脂效率、協調性與全身爆發力。",
      href: "/training/boxing",
      mediaClass: "homeLuxuryMediaS4B",
      cta: "Open",
      clickHint: isEn ? "Learn more ->" : "了解更多 →",
    },
    {
      badge: "PILATES",
      title: isEn ? "Reformer Pilates" : "器械皮拉提斯",
      description: isEn
        ? "Use Pilates equipment to improve core stability, body control, posture, and movement quality."
        : "運用器械皮拉提斯建立核心穩定與身體控制，改善姿勢、線條與動作品質。",
      href: "/training/pilates",
      mediaClass: "homeLuxuryMediaS4C",
      cta: "Open",
      clickHint: isEn ? "Learn more ->" : "了解更多 →",
    },
    {
      badge: "Functional",
      title: isEn ? "Sports Massage & Functional Adjustment" : "運動按摩與功能性調整",
      description: isEn
        ? "Blend recovery massage, mobility work, and functional adjustment to help the body move more comfortably."
        : "結合運動按摩、放鬆與活動度調整，協助身體回到更順暢的使用狀態。",
      href: "/training/functional-adjustment",
      mediaClass: "homeLuxuryMediaS4D",
      cta: "Open",
      clickHint: isEn ? "Learn more ->" : "了解更多 →",
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
      badge: "Book Trial",
      title: isEn ? "Book a Trial Session" : "立即預約首次體驗",
      description: isEn
        ? "Choose your preferred program and time, then let the BigE team arrange the first experience with you."
        : "選擇想體驗的項目，讓 BigE 團隊協助安排你的第一堂課。",
      href: "/trial-booking",
      mediaClass: "homeLuxuryMediaS8B",
      cta: "Open",
      ctaTone: "primary",
    },
    {
      badge: "LINE",
      title: isEn ? "LINE Consultation" : "LINE 諮詢",
      description: isEn
        ? "Message us anytime and we will help you choose the right plan and schedule."
        : "還不確定適合哪一種訓練？用 LINE 讓專人協助你判斷方向。",
      href: "https://lin.ee/0GWm0oZ",
      mediaClass: "homeLuxuryMediaS8A",
      cta: "Open",
      ctaTone: "secondary",
    },
    {
      badge: "Map",
      title: isEn ? "View Map" : "查看地圖",
      description: isEn
        ? "Open map directions and navigate to the gym with the fastest route."
        : "一鍵查看地圖路線，快速找到場館位置與交通方式。",
      href: "https://www.google.com/maps/search/?api=1&query=%E5%B7%A8%E6%8C%BA%E5%81%A5%E8%BA%AB%E9%A4%A8",
      mediaClass: "homeLuxuryMediaS8C",
      cta: "Open",
      ctaTone: "tertiary",
    },
  ];

  return (
    <main className="homeLuxury">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd) }} />
      <HomeScrollEffects />
      <section className="homeLuxuryHero homeLuxuryFullImageSection homeLuxuryHeroImage">
        <div className="homeLuxuryFullShade" />
        <div className="homeLuxuryOverlayContent">
          <div className="homeLuxuryHeroLayout">
            <div className="homeLuxuryHeroCopy">
              <p className="homeLuxuryEyebrow">BIGE</p>
              <h1 className="homeLuxuryHeroTitle">
                {heroTitleLines.map((line, index) => (
                  <span key={`${line}-${index}`}>
                    {index > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
              </h1>
              <p className="homeLuxuryHeroSub">{heroSubDisplayText}</p>
              <p className="homeLuxuryHeroSeo">高雄仁武健身房｜重量訓練｜器械皮拉提斯｜運動按摩</p>
              <div className="homeLuxuryHeroActions">
                <a className="homeLuxuryBtn homeLuxuryBtnPrimary" href="/trial-booking">
                  立即預約首次體驗
                </a>
              </div>
            </div>
            <div className="homeLuxuryHeroMediaPanel" aria-hidden>
              <video className="homeLuxuryHeroVideo" autoPlay muted loop playsInline poster="/home-videos/hero-poster.jpg">
                <source src="/home-videos/hero-mobile.mp4" media="(max-width: 767px)" type="video/mp4" />
                <source src="/home-videos/hero-desktop.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </div>
      </section>

      <section className="homeLuxuryGridSection homeLuxuryGridSectionPorsche" data-reveal data-mobile-service-section>
        <div className="homeLuxuryMobileServiceBackdrop" aria-hidden>
          <span className="homeLuxuryMobileServiceBackdropLayer homeLuxuryMobileServiceBackdropS2A" />
          <span className="homeLuxuryMobileServiceBackdropLayer homeLuxuryMobileServiceBackdropS2B" />
          <span className="homeLuxuryMobileServiceBackdropLayer homeLuxuryMobileServiceBackdropS2C" />
          <span className="homeLuxuryMobileServiceBackdropLayer homeLuxuryMobileServiceBackdropS2D" />
          <span className="homeLuxuryMobileServiceBackdropShade" />
        </div>
        <div className="homeLuxuryGridInner">
          <div className="homeLuxurySectionTitleWithLogo">
            <h2 className="homeLuxurySectionTitle homeLuxurySectionTitlePorsche homeLuxurySectionTitleInline">
              <span className="homeLuxurySectionTitleText">
              {isEn ? "Bige Fitness Club" : "巨挺健身館"}
            </span>
            </h2>
            <span className="homeLuxuryCircleLogo" aria-hidden>
              <Image src="/LOGO.jpg" alt="" width={128} height={128} className="homeLuxuryCircleLogoImage" />
            </span>
          </div>
          <div
            className="homeLuxuryGridShowcase homeLuxuryShowcaseVideoGrid"
            data-swipe-track="showcase"
            data-mobile-service-track
          >
            {sectionTwoItems.map((item) => (
              <PorscheCard key={`${item.title}-${item.href}`} item={item} mobileReveal />
            ))}
          </div>
          <div className="homeSwipeDots" data-swipe-dots="showcase" aria-hidden />
        </div>
      </section>

      <section className="homeLuxuryFullImageSection homeLuxurySectionImageA">
        <div className="homeLuxuryFullShade" />
        <div className="homeLuxuryOverlayContent homeLuxuryOverlayCompact">
          <p className="homeLuxuryEyebrow">{isEn ? t("home.calm_ui") : "心靈之旅"}</p>
          <h2 className="homeLuxuryOverlayTitle">{t("home.section_body_awareness")}</h2>
        </div>
      </section>

      <section
        className="homeLuxuryGridSection homeLuxuryGridSectionFadeFromDark"
        data-scroll-fade="dark-to-light"
        data-reveal
        data-theme-swap="hard"
        data-pin-section
      >
        <div className="homeLuxuryGridInner homeLuxuryPinFrame">
          <h2 className="homeLuxurySectionTitle">
            <span className="homeLuxurySectionTitleText">{isEn ? "Explore Training Programs" : "\u4e86\u89e3\u5168\u65b9\u4f4d\u8a13\u7df4"}</span>
          </h2>
          <p className="homeLuxurySectionSubtitle">
            {isEn
              ? "Choose a program to see the training focus, ideal fit, and first-experience options."
              : "\u9ede\u9078\u9805\u76ee\uff0c\u67e5\u770b\u8a13\u7df4\u5167\u5bb9\u3001\u9069\u5408\u5c0d\u8c61\u8207\u9996\u6b21\u9ad4\u9a57\u65b9\u5f0f\u3002"}
          </p>
          <div className="homeLuxuryGridFour" data-swipe-track="training">
            {sectionFourItems.map((item) => (
              <GridCard key={`${item.title}-${item.href}`} item={item} clickable />
            ))}
          </div>
          <div className="homeSwipeDots" data-swipe-dots="training" aria-hidden />
        </div>
      </section>

      <section className="homeLuxuryFullVideoSection">
        <iframe
          className="homeLuxuryYouTubeEmbed"
          src="https://www.youtube-nocookie.com/embed/9NHEvByM5tk?autoplay=1&mute=1&loop=1&playlist=9NHEvByM5tk&controls=0&rel=0&playsinline=1&modestbranding=1"
          title="Homepage showcase video"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
        <div className="homeLuxuryFullShade" />
      </section>

      <section className="homeLuxuryGridSection" data-reveal>
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle">
            <span className="homeLuxurySectionTitleText">{isEn ? "Start in a Way That Fits You" : "用適合你的方式開始"}</span>
          </h2>
          <p className="homeLuxurySectionSubtitle">
            {isEn
              ? "Whether you want a single visit, steady training, or coaching to find your direction, BigE gives you flexible ways to begin."
              : "不論你想單次體驗、穩定訓練，或由教練陪你建立方向，BigE 都能提供彈性的開始方式。"}
          </p>
          <div className="homeLuxuryGridFour" data-swipe-track="choices">
            {sectionSixItems.map((item) => (
              <GridCard key={`${item.title}-${item.href}`} item={item} />
            ))}
          </div>
          <div className="homeSwipeDots" data-swipe-dots="choices" aria-hidden />
        </div>
      </section>

      <section className="homeLuxuryFullImageSection homeLuxurySectionImageB">
        <div className="homeLuxuryFullShade" />
        <div className="homeLuxuryOverlayContent homeLuxuryOverlayCompact">
          {isEn ? <p className="homeLuxuryEyebrow">{t("home.clarity")}</p> : null}
          <h2 className="homeLuxuryOverlayTitle">{isEn ? t("home.platform_admin") : "掌握身體 才能體驗豐富人生"}</h2>
        </div>
      </section>

      <section className="homeLuxuryGridSection homeLuxuryGridSectionLast" data-reveal>
        <div className="homeLuxuryGridInner">
          <h2 className="homeLuxurySectionTitle">
            <span className="homeLuxurySectionTitleText">{isEn ? "Take the First Step" : "邁出第一步"}</span>
          </h2>
          <div className="homeLuxuryGridThree">
            {sectionEightItems.map((item) => (
              <GridCard key={`${item.title}-${item.href}`} item={item} clickable />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
