import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

export type TrainingTopicCard = {
  title: string;
  description: string;
  icon: TrainingIconName;
};

type TrainingTopicLink = {
  title: string;
  href: string;
  eyebrow: string;
};

type TrainingIconName =
  | "activity"
  | "dumbbell"
  | "eye"
  | "flame"
  | "focus"
  | "gauge"
  | "heart"
  | "rotate"
  | "scan"
  | "sliders"
  | "sparkles"
  | "target"
  | "trending"
  | "user"
  | "users"
  | "waves"
  | "wind"
  | "zap";

type TrainingTopicPageProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  imageSrc: string;
  imageAlt: string;
  imagePosition?: string;
  mobileImagePosition?: string;
  heroClassName?: string;
  introTitle: string;
  intro: string;
  priceLabel: string;
  priceDescription: string;
  flowSteps: TrainingTopicCard[];
  relatedTopics: TrainingTopicLink[];
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
  heroClassName,
  introTitle,
  intro,
  priceLabel,
  priceDescription,
  flowSteps,
  relatedTopics,
  features,
  audiences,
}: TrainingTopicPageProps) {
  const heroStyle = {
    "--training-hero-position": imagePosition,
    "--training-hero-mobile-position": mobileImagePosition ?? imagePosition,
  } as CSSProperties;

  return (
    <main className="trainingTopicPage">
      <section className={["trainingTopicHero", heroClassName].filter(Boolean).join(" ")} style={heroStyle}>
        <div className="trainingTopicHeroMedia" aria-hidden>
          <Image src={imageSrc} alt="" fill priority sizes="100vw" className="trainingTopicHeroImage" />
          <div className="trainingTopicHeroShade" />
        </div>
        <div className="trainingTopicHeroInner">
          <p className="trainingTopicEyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="trainingTopicLead">{subtitle}</p>
          <div className="trainingTopicHeroPrice">
            <span>{priceLabel}</span>
            <p>{priceDescription}</p>
          </div>
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
              <div className="trainingTopicCardTop">
                <TrainingCardIcon name={feature.icon} />
                <span aria-hidden>{String(index + 1).padStart(2, "0")}</span>
              </div>
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
              <div className="trainingTopicCardTop">
                <TrainingCardIcon name={audience.icon} />
                <span aria-hidden>FOR</span>
              </div>
              <h3>{audience.title}</h3>
              <p>{audience.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicPanel">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">FIRST EXPERIENCE</p>
          <h2>第一次體驗流程</h2>
          <p className="trainingTopicSectionLead">
            不用擔心自己是否有經驗，BigE 團隊會依照你的狀態安排適合的開始方式。
          </p>
        </div>
        <div className="trainingTopicFlowGrid">
          {flowSteps.map((step, index) => (
            <article className="trainingTopicFlowCard" key={step.title}>
              <div className="trainingTopicFlowIndex">{String(index + 1).padStart(2, "0")}</div>
              <TrainingCardIcon name={step.icon} />
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicPanel trainingTopicRelated">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">EXPLORE MORE</p>
          <h2>也可以了解其他訓練方式</h2>
          <p className="trainingTopicSectionLead">
            如果你還不確定適合哪一種方式，可以先比較不同項目，再選擇最想體驗的方向。
          </p>
        </div>
        <div className="trainingTopicRelatedGrid">
          {relatedTopics.map((topic) => (
            <Link href={topic.href} className="trainingTopicRelatedCard" key={topic.href}>
              <span>{topic.eyebrow}</span>
              <strong>{topic.title}</strong>
              <em>了解更多</em>
            </Link>
          ))}
        </div>
      </section>

      <section className="trainingTopicFinalCta">
        <p>{priceLabel}</p>
        <h2>讓 BigE 團隊協助你找到適合自己的第一堂課。</h2>
        <p className="trainingTopicFinalNote">{priceDescription}</p>
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

function TrainingCardIcon({ name }: { name: TrainingIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.65,
  };

  return (
    <svg className="trainingTopicCardIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "activity" ? <polyline {...common} points="22 12 18 12 15 21 9 3 6 12 2 12" /> : null}
      {name === "dumbbell" ? (
        <>
          <path {...common} d="M6 7v10M18 7v10M3.5 9v6M20.5 9v6M6 12h12" />
        </>
      ) : null}
      {name === "eye" ? (
        <>
          <path {...common} d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle {...common} cx="12" cy="12" r="2.5" />
        </>
      ) : null}
      {name === "flame" ? (
        <path {...common} d="M13 2s1 4-2 6c-2 1.4-4 3.4-4 6a5 5 0 0 0 10 0c0-2.5-1.5-4.1-3.1-5.8C12.8 7 13 4.5 13 2Z" />
      ) : null}
      {name === "focus" ? (
        <>
          <circle {...common} cx="12" cy="12" r="3" />
          <path {...common} d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        </>
      ) : null}
      {name === "gauge" ? (
        <>
          <path {...common} d="M4 15a8 8 0 1 1 16 0" />
          <path {...common} d="m12 15 4-5" />
          <path {...common} d="M8 15h8" />
        </>
      ) : null}
      {name === "heart" ? (
        <path {...common} d="M20.5 8.5c0 5-8.5 10-8.5 10s-8.5-5-8.5-10a4.5 4.5 0 0 1 8.5-2 4.5 4.5 0 0 1 8.5 2Z" />
      ) : null}
      {name === "rotate" ? (
        <>
          <path {...common} d="M4 12a8 8 0 0 1 13.6-5.7L20 8" />
          <path {...common} d="M20 4v4h-4" />
          <path {...common} d="M20 12a8 8 0 0 1-13.6 5.7L4 16" />
          <path {...common} d="M4 20v-4h4" />
        </>
      ) : null}
      {name === "scan" ? (
        <>
          <path {...common} d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
          <path {...common} d="M7 12h10" />
        </>
      ) : null}
      {name === "sliders" ? (
        <>
          <path {...common} d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h11M19 18h1" />
          <circle {...common} cx="14" cy="6" r="2" />
          <circle {...common} cx="9" cy="12" r="2" />
          <circle {...common} cx="17" cy="18" r="2" />
        </>
      ) : null}
      {name === "sparkles" ? (
        <>
          <path {...common} d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" />
          <path {...common} d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" />
          <path {...common} d="m19 14 .6 1.4L21 16l-1.4.6L19 18l-.6-1.4L17 16l1.4-.6L19 14Z" />
        </>
      ) : null}
      {name === "target" ? (
        <>
          <circle {...common} cx="12" cy="12" r="8" />
          <circle {...common} cx="12" cy="12" r="4" />
          <circle {...common} cx="12" cy="12" r="1" />
        </>
      ) : null}
      {name === "trending" ? (
        <>
          <path {...common} d="m4 16 6-6 4 4 6-7" />
          <path {...common} d="M15 7h5v5" />
        </>
      ) : null}
      {name === "user" ? (
        <>
          <circle {...common} cx="12" cy="8" r="3.2" />
          <path {...common} d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </>
      ) : null}
      {name === "users" ? (
        <>
          <circle {...common} cx="9" cy="8" r="3" />
          <path {...common} d="M3.8 19a5.2 5.2 0 0 1 10.4 0" />
          <path {...common} d="M16 11a2.8 2.8 0 1 0-1.4-5.2" />
          <path {...common} d="M16.5 14.2A5 5 0 0 1 21 19" />
        </>
      ) : null}
      {name === "waves" ? (
        <>
          <path {...common} d="M3 8c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2" />
          <path {...common} d="M3 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2" />
          <path {...common} d="M3 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2" />
        </>
      ) : null}
      {name === "wind" ? (
        <>
          <path {...common} d="M3 8h11a3 3 0 1 0-3-3" />
          <path {...common} d="M3 13h15a3 3 0 1 1-3 3" />
          <path {...common} d="M3 18h7" />
        </>
      ) : null}
      {name === "zap" ? <path {...common} d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /> : null}
    </svg>
  );
}
