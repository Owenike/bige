import Image from "next/image";
import Link from "next/link";

type TrainingTopicPageProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  imageSrc: string;
  imageAlt: string;
  introTitle: string;
  intro: string;
  features: string[];
  audiences: string[];
};

export function TrainingTopicPage({
  eyebrow,
  title,
  subtitle,
  imageSrc,
  imageAlt,
  introTitle,
  intro,
  features,
  audiences,
}: TrainingTopicPageProps) {
  return (
    <main className="trainingTopicPage">
      <section className="trainingTopicHero">
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
          {features.map((feature) => (
            <article className="trainingTopicCard" key={feature}>
              <span aria-hidden>+</span>
              <p>{feature}</p>
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
            <article className="trainingTopicCard" key={audience}>
              <span aria-hidden>•</span>
              <p>{audience}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicFinalCta">
        <p>想開始體驗？</p>
        <h2>讓 BigE 團隊協助你安排第一次訓練。</h2>
        <Link href="/trial-booking" className="trainingTopicButton trainingTopicButtonPrimary">
          預約首次體驗
        </Link>
      </section>
    </main>
  );
}
