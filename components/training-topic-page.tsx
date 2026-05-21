import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

export type TrainingTopicCard = {
  title: string;
  description: string;
};

type TrainingTopicPageProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  imageSrc: string;
  imageAlt: string;
  imagePosition?: string;
  mobileImagePosition?: string;
  introTitle: string;
  intro: string;
  features: TrainingTopicCard[];
  audiences: TrainingTopicCard[];
};

export function TrainingTopicPage({
  eyebrow,
  title,
  subtitle,
  imageSrc,
  imageAlt,
  imagePosition = "center 42%",
  mobileImagePosition,
  introTitle,
  intro,
  features,
  audiences,
}: TrainingTopicPageProps) {
  const heroStyle = {
    "--training-hero-position": imagePosition,
    "--training-hero-mobile-position": mobileImagePosition ?? imagePosition,
  } as CSSProperties;

  return (
    <main className="trainingTopicPage">
      <section className="trainingTopicHero" style={heroStyle}>
        <div className="trainingTopicHeroMedia" aria-hidden>
          <Image src={imageSrc} alt="" fill priority sizes="100vw" className="trainingTopicHeroImage" />
          <div className="trainingTopicHeroShade" />
        </div>
        <div className="trainingTopicHeroInner">
          <p className="trainingTopicEyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="trainingTopicLead">{subtitle}</p>
          <div className="trainingTopicActions">
            <Link href="/trial-booking" className="trainingTopicButton trainingTopicButtonPrimary">
              預約首次體驗
            </Link>
            <Link href="/" className="trainingTopicButton trainingTopicButtonGhost">
              回到首頁
            </Link>
          </div>
        </div>
      </section>

      <section className="trainingTopicIntro">
        <div>
          <p className="trainingTopicSectionKicker">BIGE APPROACH</p>
          <h2>{introTitle}</h2>
        </div>
        <p>{intro}</p>
      </section>

      <section className="trainingTopicPanel">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">FEATURES</p>
          <h2>服務特色</h2>
        </div>
        <div className="trainingTopicGrid">
          {features.map((feature, index) => (
            <article className="trainingTopicCard" key={feature.title}>
              <span aria-hidden>{String(index + 1).padStart(2, "0")}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicPanel trainingTopicPanelSoft">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">BEST FOR</p>
          <h2>適合對象</h2>
        </div>
        <div className="trainingTopicGrid">
          {audiences.map((audience) => (
            <article className="trainingTopicCard" key={audience.title}>
              <span aria-hidden>FOR</span>
              <h3>{audience.title}</h3>
              <p>{audience.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicFinalCta">
        <p>想開始體驗？</p>
        <h2>讓 BigE 團隊協助你找到適合自己的第一堂課。</h2>
        <div className="trainingTopicActions trainingTopicActionsCenter">
          <Link href="/trial-booking" className="trainingTopicButton trainingTopicButtonPrimary">
            預約首次體驗
          </Link>
          <Link href="/" className="trainingTopicButton trainingTopicButtonGhost">
            回到首頁
          </Link>
        </div>
      </section>
    </main>
  );
}
