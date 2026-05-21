import Image from "next/image";
import type { ReactNode } from "react";
import { FloatingLineButton } from "@/components/floating-line-button";
import { HomeHoverVideo } from "@/components/home-hover-video";
import { getLocaleFromCookies, getT } from "../lib/i18n-server";
import HomeScrollEffects from "./home-scroll-effects";

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
};

function PorscheCard({ item, mobileReveal = false }: { item: GridItem; mobileReveal?: boolean }) {
  return (
    <article
      className="homeLuxuryPorscheCard"
      data-reveal-item
      data-parallax-card
      data-mobile-service-card={mobileReveal ? "" : undefined}
    >
      <a className="homeLuxuryPorscheLink" href={item.href} aria-label={item.title}>
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
      </a>
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
    <article className="homeLuxuryGridCard" data-reveal-item data-parallax-card>
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
      title: "拳擊訓練",
      description: t("home.calm_ui_desc"),
      href: "/coach",
      mediaClass: "homeLuxuryMediaS2C",
      cta: "Open",
      videoSrc: "/home-videos/card-boxing-showcase.mp4",
      videoLabel: "拳擊訓練影片背景",
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
      title: isEn ? "Pilates Core Training" : "器械皮拉提斯核心訓練",
      titleDisplay: isEn ? "Pilates Core Training" : <><span>器械皮拉提斯</span><br /><span>核心訓練</span></>,
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
      title: isEn ? "Functional Adjustment" : "功能性調整",
      description: isEn
        ? "Targeted movement correction to release fatigue patterns and restore efficient mechanics."
        : "針對動作代償與疲勞模式進行調整，恢復更有效率的身體機制。",
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
      badge: "Contact Us",
      title: isEn ? "Contact Us" : "聯繫我們",
      description: isEn
        ? "Message us anytime and we will help you choose the right plan and schedule."
        : "歡迎隨時聯繫我們，將由專人協助你挑選最適合的方案與時段。",
      href: "https://lin.ee/0GWm0oZ",
      mediaClass: "homeLuxuryMediaS8A",
      cta: "Open",
    },
    {
      badge: "Book Now",
      title: isEn ? "Book Now" : "立即預約",
      description: isEn
        ? "Book your visit or trial class in minutes and secure your preferred time."
        : "線上快速完成預約，提前鎖定你想要的訓練時段。",
      href: "/trial-booking",
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
      <HomeScrollEffects />
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
          src="https://www.youtube-nocookie.com/embed/V33I8IozKgc?autoplay=1&mute=1&loop=1&playlist=V33I8IozKgc&controls=0&rel=0&playsinline=1&modestbranding=1"
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
            <span className="homeLuxurySectionTitleText">{isEn ? "More Choices, Less Pressure" : "多元選擇 輕鬆無負擔"}</span>
          </h2>
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
      <FloatingLineButton href="https://lin.ee/0GWm0oZ" ariaLabel={isEn ? "Open LINE" : "開啟 LINE"} />
    </main>
  );
}
