import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";

const siteUrl = "https://bigefitness.com";
const pageUrl = `${siteUrl}/renwu-sports-massage`;
const pageDescription =
  "想找仁武運動按摩或筋膜放鬆？BigE 巨挺健身館提供運動按摩與痠痛調整服務，適合久坐肩頸緊繃、訓練後痠痛、活動度受限與想改善身體緊繃的人，地點位於高雄市仁武區八德北路728號。";

export const metadata: Metadata = {
  title: "仁武運動按摩｜筋膜放鬆・痠痛調整｜巨挺健身館 BigE",
  description: pageDescription,
};

const heroStyle = {
  "--training-hero-position": "center 28%",
  "--training-hero-mobile-position": "center 32%",
} as CSSProperties;

const suitableFor = [
  "久坐辦公、肩頸緊繃，常覺得上背與脖子很難放鬆的人。",
  "腰背痠痛、臀腿緊繃，想先整理身體張力與活動感的人。",
  "重量訓練、拳擊或跑步後痠痛明顯，需要協助恢復的人。",
  "深蹲、髖關節、肩膀或胸椎活動度受限，訓練時容易卡住的人。",
  "覺得筋膜緊繃、肌肉拉扯感明顯，想用運動按摩放鬆的人。",
  "常覺得身體卡卡、左右不平衡，想找出可能的代償線索的人。",
];

const cautionItems = [
  "目前有急性疼痛、紅腫熱痛、傷口或症狀正在加劇。",
  "剛受傷、剛手術，或仍在醫療復健初期。",
  "有不明原因麻木、無力、胸悶、暈眩或劇烈疼痛。",
  "懷孕中、產後恢復期，或有特殊身體狀況需要先評估。",
  "有慢性疾病、皮膚狀況、用藥或任何需要事先告知的狀況。",
];

const massageHelps = [
  {
    title: "放鬆緊繃",
    description: "針對肩頸、背部、臀腿與訓練後緊繃區域，協助身體從高張力狀態降下來。",
  },
  {
    title: "改善活動度",
    description: "搭配筋膜放鬆與關節活動引導，幫助肩膀、胸椎、髖關節與腿後側恢復更順的活動感。",
  },
  {
    title: "降低不適感",
    description: "不是醫療治療，但能協助整理久坐、訓練累積與日常姿勢造成的緊繃不適。",
  },
  {
    title: "幫助訓練恢復",
    description: "在高強度訓練後安排運動按摩，有助於恢復身體狀態，讓下一次訓練品質更穩。",
  },
  {
    title: "找出代償線索",
    description: "透過觸感、動作與緊繃分布觀察，協助你理解哪些部位可能長期過度出力。",
  },
];

const relationshipItems = [
  {
    title: "按摩不是取代訓練",
    description:
      "運動按摩可以協助恢復與放鬆，但肌力、穩定與動作控制仍需要透過訓練慢慢建立。",
  },
  {
    title: "恢復會影響訓練品質",
    description:
      "當肩頸、背部或髖關節長期緊繃，訓練動作容易受限；先整理身體狀態，後續訓練通常更順。",
  },
  {
    title: "可以搭配重量訓練或皮拉提斯",
    description:
      "BigE 可依你的緊繃位置與訓練目標，建議運動按摩、重量訓練或器械皮拉提斯的搭配方式。",
  },
];

const trialSteps = [
  "先了解你的緊繃位置、日常習慣、訓練內容與目前不適感。",
  "透過簡單活動度與姿勢觀察，判斷需要優先整理的區域。",
  "依照狀態安排運動按摩、筋膜放鬆與局部痠痛調整。",
  "過程中會確認力道與感受，不用硬忍疼痛或追求越痛越有效。",
  "運動按摩體驗 NT$1500，結束後提供簡單自我照顧與後續建議。",
];

const faqs = [
  {
    question: "運動按摩是醫療治療嗎？",
    answer:
      "不是。BigE 的運動按摩主要協助放鬆、恢復與活動度調整；若有急性疼痛、受傷或醫療問題，建議先諮詢醫師或物理治療師。",
  },
  {
    question: "運動按摩會很痛嗎？",
    answer:
      "不需要硬忍。服務過程會依照你的狀態與感受調整力道，目標是讓身體放鬆與恢復，不是追求越痛越有效。",
  },
  {
    question: "久坐肩頸緊繃適合嗎？",
    answer:
      "適合先評估。久坐造成的肩頸、上背與胸口緊繃，常可以透過筋膜放鬆、活動度整理與自我照顧建議一起改善。",
  },
  {
    question: "訓練後痠痛可以做運動按摩嗎？",
    answer:
      "可以，但會依照痠痛程度調整方式。若是急性拉傷、腫脹或疼痛加劇，建議先暫停並尋求醫療評估。",
  },
  {
    question: "第一次體驗需要準備什麼？",
    answer:
      "穿著好活動的服裝，帶水即可。若有舊傷、皮膚狀況、慢性疾病、用藥或近期不適，請在體驗前先告知。",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

const serviceJsonLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "仁武運動按摩體驗",
  serviceType: "運動按摩與筋膜放鬆",
  url: pageUrl,
  description: pageDescription,
  provider: {
    "@type": "HealthClub",
    name: "巨挺健身館 BigE",
    telephone: "0972-484686",
    address: {
      "@type": "PostalAddress",
      streetAddress: "八德北路728號",
      addressLocality: "仁武區",
      addressRegion: "高雄市",
      addressCountry: "TW",
    },
  },
  areaServed: ["高雄仁武", "仁武區", "八德北路"],
  offers: {
    "@type": "Offer",
    price: "1500",
    priceCurrency: "TWD",
    name: "運動按摩體驗",
  },
};

export default function RenwuSportsMassagePage() {
  return (
    <main className="trainingTopicPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />

      <section className="trainingTopicHero" style={heroStyle}>
        <div className="trainingTopicHeroMedia" aria-hidden>
          <Image
            src="/home-images/card-functional-training.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="trainingTopicHeroImage"
          />
          <div className="trainingTopicHeroShade" />
        </div>
        <div className="trainingTopicHeroInner">
          <p className="trainingTopicEyebrow">RENWU SPORTS MASSAGE</p>
          <h1>運動按摩適合我嗎？</h1>
          <p className="trainingTopicLead">
            如果你正在找仁武運動按摩、仁武筋膜放鬆或仁武痠痛調整，BigE 巨挺健身館會先了解你的緊繃來源、
            訓練狀態與活動限制，再安排適合的放鬆與恢復方式。
          </p>
          <div className="trainingTopicHeroPrice">
            <span>運動按摩體驗 NT$1500</span>
            <p>適合久坐肩頸緊繃、訓練後痠痛、活動度受限與想改善身體卡卡感的人。</p>
          </div>
          <div className="trainingTopicActions">
            <Link href="/trial-booking" className="trainingTopicButton trainingTopicButtonPrimary">
              預約運動按摩體驗
            </Link>
            <Link href="#first-experience" className="trainingTopicButton trainingTopicButtonGhost">
              先看體驗流程
            </Link>
          </div>
        </div>
      </section>

      <section className="trainingTopicIntro">
        <div>
          <p className="trainingTopicSectionKicker">START HERE</p>
          <h2>先整理緊繃，再讓身體回到更順的狀態</h2>
        </div>
        <p>
          運動按摩不是單純按到很痛，也不是取代訓練。BigE 巨挺健身館位於高雄仁武八德北路，
          會依照你的日常姿勢、訓練內容與身體感受，安排筋膜放鬆、痠痛調整與活動度整理。
          目標是幫助身體恢復，讓後續訓練與日常活動更舒服。
        </p>
      </section>

      <section className="trainingTopicPanel">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">BEST FOR</p>
          <h2>適合對象</h2>
          <p className="trainingTopicSectionLead">
            如果你覺得身體長期緊繃、訓練後恢復慢，或某些動作一直卡住，可以先從運動按摩體驗開始。
          </p>
        </div>
        <div className="trainingTopicGrid">
          {suitableFor.map((item, index) => (
            <article className="trainingTopicCard" key={item}>
              <div className="trainingTopicCardTop">
                <span aria-hidden>{String(index + 1).padStart(2, "0")}</span>
                <span aria-hidden>FIT</span>
              </div>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicPanel trainingTopicPanelSoft">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">CHECK FIRST</p>
          <h2>開始前，這些狀況請先讓我們知道</h2>
          <p className="trainingTopicSectionLead">
            BigE 會依照你的狀態調整力道與方式。若有以下情況，會先確認是否適合進行，必要時建議先諮詢醫療專業。
          </p>
        </div>
        <article className="trainingTopicCard trainingTopicCautionCard">
          <ul className="trainingTopicCautionList">
            {cautionItems.map((item) => (
              <li className="trainingTopicCautionItem" key={item}>
                <span className="trainingTopicCautionDot" aria-hidden="true" />
                <span>{item.replace(/。$/, "")}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="trainingTopicPanel">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">RECOVERY BENEFITS</p>
          <h2>運動按摩可以幫你什麼？</h2>
        </div>
        <div className="trainingTopicGrid">
          {massageHelps.map((item) => (
            <article className="trainingTopicCard" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicPanel trainingTopicPanelSoft">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">MASSAGE AND TRAINING</p>
          <h2>運動按摩跟訓練的關係</h2>
        </div>
        <div className="trainingTopicGrid">
          {relationshipItems.map((item) => (
            <article className="trainingTopicCard" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicPanel" id="first-experience">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">FIRST EXPERIENCE</p>
          <h2>BigE 運動按摩體驗流程</h2>
          <p className="trainingTopicSectionLead">
            第一次來不用知道自己該按哪裡。服務前會先討論狀態，再依照緊繃分布安排放鬆與調整。
          </p>
        </div>
        <div className="trainingTopicFlowGrid">
          {trialSteps.map((step, index) => (
            <article className="trainingTopicFlowCard" key={step}>
              <div className="trainingTopicFlowIndex">{String(index + 1).padStart(2, "0")}</div>
              <h3>{step}</h3>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicPanel">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">RENWU BIGE</p>
          <h2>高雄仁武區的運動按摩起點</h2>
          <p className="trainingTopicSectionLead">
            巨挺健身館 BigE 位於高雄市仁武區八德北路728號，適合正在搜尋仁武運動按摩、仁武筋膜放鬆、
            仁武痠痛調整，或想在高雄仁武改善久坐緊繃與訓練恢復的人。你可以先用運動按摩體驗了解身體狀態，
            再決定後續是否搭配訓練或功能性調整。
          </p>
        </div>
      </section>

      <section className="trainingTopicPanel trainingTopicRelated">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">FAQ</p>
          <h2>常見問題</h2>
        </div>
        <div className="trainingTopicGrid">
          {faqs.map((faq) => (
            <article className="trainingTopicCard" key={faq.question}>
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicFinalCta">
        <p>仁武運動按摩體驗 NT$1500</p>
        <h2>讓 BigE 協助你整理緊繃，找回更舒服的活動感。</h2>
        <p className="trainingTopicFinalNote">
          從肩頸、腰背、臀腿到訓練後恢復，先了解身體卡住的原因，再安排適合的放鬆方式。
        </p>
        <div className="trainingTopicActions trainingTopicActionsCenter">
          <Link href="/trial-booking" className="trainingTopicButton trainingTopicButtonPrimary">
            預約運動按摩體驗
          </Link>
          <Link href="/training/functional-adjustment" className="trainingTopicButton trainingTopicButtonGhost">
            回到功能性調整介紹
          </Link>
        </div>
      </section>
    </main>
  );
}
