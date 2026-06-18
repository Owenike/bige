import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";

const siteUrl = "https://bigefitness.com";
const pageUrl = `${siteUrl}/renwu-pilates`;
const pageDescription =
  "想找仁武器械皮拉提斯？BigE 巨挺健身館提供器械皮拉提斯首次體驗，適合久坐、腰痠背痛、核心無力、姿勢不穩與想改善身體控制的人，地點位於高雄市仁武區八德北路728號。";

export const metadata: Metadata = {
  title: "仁武器械皮拉提斯｜核心訓練・體態調整｜巨挺健身館 BigE",
  description: pageDescription,
};

const heroStyle = {
  "--training-hero-position": "center 34%",
  "--training-hero-mobile-position": "center 32%",
} as CSSProperties;

const suitableFor = [
  "久坐、肩頸緊繃、腰痠背痛，想用低衝擊方式重新建立活動感的人。",
  "核心比較弱，做動作容易用腰、肩膀或大腿代償的人。",
  "姿勢不穩、體態想調整，希望站姿與坐姿更有支撐感的人。",
  "運動時常不知道哪裡該出力，需要教練用更細緻的方式引導的人。",
  "想讓重訓動作品質更穩定，先把核心控制與身體覺察補起來的人。",
  "銀髮族或初學者想安全開始訓練，希望從可調整強度的器械開始的人。",
];

const cautionItems = [
  "目前有急性疼痛或疼痛正在加劇。",
  "剛受傷、剛手術，或仍在復健初期。",
  "醫師已限制運動，或有尚未確認原因的不適。",
  "懷孕中或產後身體狀態需要特別評估。",
  "有特殊病史、慢性疾病或任何需要教練事先知道的狀況。",
];

const trialSteps = [
  "先了解你的身體狀況、生活型態與訓練目標。",
  "觀察姿勢、呼吸與基本核心控制，找出容易代償的地方。",
  "由教練帶你操作器械，感受輔助、阻力與身體排列。",
  "依照當天狀態調整強度，找出適合你的訓練方向。",
  "首次體驗 NT$880，體驗後再討論後續安排，不需要一開始就綁約。",
];

const faqs = [
  {
    question: "沒有運動經驗可以上器械皮拉提斯嗎？",
    answer:
      "可以。器械皮拉提斯很適合初學者從低衝擊、可調整強度的方式開始，教練會依照你的狀態安排動作。",
  },
  {
    question: "腰痠背痛可以上嗎？",
    answer:
      "如果是久坐、姿勢緊繃或核心控制不足造成的不適，可以先由教練評估再安排合適內容；若有急性疼痛、受傷或醫師限制運動，建議先諮詢專業醫療人員。",
  },
  {
    question: "器械皮拉提斯會很累嗎？",
    answer:
      "它不一定追求大重量或大量流汗，但會很專注在控制、穩定與細節。第一次體驗會以安全與理解身體為優先。",
  },
  {
    question: "器械皮拉提斯跟重訓可以一起練嗎？",
    answer:
      "可以，而且很互補。器械皮拉提斯幫助你提升核心控制與動作品質，重量訓練則更著重肌力、肌肉量與負重能力。",
  },
  {
    question: "第一次體驗需要準備什麼？",
    answer:
      "穿著好活動的服裝，帶水與毛巾即可。若有舊傷、特殊病史或近期不適，請在體驗前先告知教練。",
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
  name: "仁武器械皮拉提斯首次體驗",
  serviceType: "器械皮拉提斯",
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
  areaServed: ["高雄仁武", "八德北路", "澄觀路", "榮總周邊"],
  offers: {
    "@type": "Offer",
    price: "880",
    priceCurrency: "TWD",
    name: "器械皮拉提斯首次體驗",
  },
};

export default function RenwuPilatesPage() {
  return (
    <main className="trainingTopicPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />

      <section className="trainingTopicHero" style={heroStyle}>
        <div className="trainingTopicHeroMedia" aria-hidden>
          <Image
            src="/home-images/bige-reformer-pilates.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="trainingTopicHeroImage"
          />
          <div className="trainingTopicHeroShade" />
        </div>
        <div className="trainingTopicHeroInner">
          <p className="trainingTopicEyebrow">RENWU REFORMER PILATES</p>
          <h1>器械皮拉提斯適合我嗎？</h1>
          <p className="trainingTopicLead">
            如果你正在找仁武器械皮拉提斯，想透過核心訓練、體態調整改善久坐腰痠與身體控制，BigE
            會從你的姿勢、呼吸與動作品質開始評估。
          </p>
          <div className="trainingTopicHeroPrice">
            <span>首次體驗 NT$880</span>
            <p>適合初學者、久坐族群與想更穩定開始訓練的人。</p>
          </div>
          <div className="trainingTopicActions">
            <Link href="/trial-booking" className="trainingTopicButton trainingTopicButtonPrimary">
              預約首次體驗
            </Link>
            <Link href="#first-experience" className="trainingTopicButton trainingTopicButtonGhost">
              先看課程怎麼上
            </Link>
          </div>
        </div>
      </section>

      <section className="trainingTopicIntro">
        <div>
          <p className="trainingTopicSectionKicker">START HERE</p>
          <h2>先判斷身體需要的是控制、穩定，還是肌力</h2>
        </div>
        <p>
          器械皮拉提斯不是只做伸展，也不是只追求流汗。它更重視你能不能在動作中找到核心、控制骨盆與脊椎排列，
          讓身體知道該怎麼穩定地出力。對久坐、腰痠、姿勢不穩的人來說，這通常是很好的起點。
        </p>
      </section>

      <section className="trainingTopicPanel">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">BEST FOR</p>
          <h2>適合對象</h2>
          <p className="trainingTopicSectionLead">
            以下狀況不代表一定只能做器械皮拉提斯，但很適合先透過教練引導，建立更清楚的身體控制。
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
          <h2>不適合或需要先評估的狀況</h2>
          <p className="trainingTopicSectionLead">
            如果你有以下狀況，請先告知教練。必要時，建議先諮詢專業醫療人員，再安排運動訓練。
            我們會以安全、保守與可調整的方式評估，不急著把強度推高。
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
          <p className="trainingTopicSectionKicker">PILATES OR STRENGTH</p>
          <h2>器械皮拉提斯跟重量訓練差在哪？</h2>
        </div>
        <div className="trainingTopicGrid">
          <article className="trainingTopicCard">
            <h3>器械皮拉提斯</h3>
            <p>
              重點在核心控制、穩定、動作品質與身體覺察。你會學習如何讓身體在比較精準的排列中出力，
              也更容易發現自己平常代償的位置。
            </p>
          </article>
          <article className="trainingTopicCard">
            <h3>重量訓練</h3>
            <p>
              重點在肌力、肌肉量與負重能力。它能幫助你建立更強的身體基礎，對增肌、減脂與提升體能很重要。
            </p>
          </article>
          <article className="trainingTopicCard">
            <h3>兩者可以互補</h3>
            <p>
              器械皮拉提斯和重訓不是二選一。先把核心穩定與身體控制練得更清楚，通常也能讓重訓動作品質更穩。
            </p>
          </article>
        </div>
      </section>

      <section className="trainingTopicPanel trainingTopicPanelSoft" id="first-experience">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">FIRST EXPERIENCE</p>
          <h2>BigE 首次體驗會怎麼進行？</h2>
          <p className="trainingTopicSectionLead">
            第一次不需要急著做很多動作，重點是了解你目前的身體狀態，並找到適合的開始方式。
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
          <h2>為什麼住仁武周邊可以考慮 BigE？</h2>
          <p className="trainingTopicSectionLead">
            巨挺健身館 BigE 位於高雄市仁武區八德北路728號，對住在高雄仁武、八德北路、澄觀路與榮總周邊的人來說，
            是可以穩定安排訓練的仁武健身房選擇。若你正在搜尋仁武器械皮拉提斯，BigE 提供首次體驗與教練評估，
            可以先從身體狀態與訓練方向開始。
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
        <p>仁武器械皮拉提斯首次體驗 NT$880</p>
        <h2>先從一堂課了解自己的身體。</h2>
        <p className="trainingTopicFinalNote">
          BigE 教練會依照你的狀態安排器械皮拉提斯體驗，協助你判斷下一步適合核心訓練、體態調整，或搭配重量訓練。
        </p>
        <div className="trainingTopicActions trainingTopicActionsCenter">
          <Link href="/trial-booking" className="trainingTopicButton trainingTopicButtonPrimary">
            預約首次體驗
          </Link>
          <Link href="/training/pilates" className="trainingTopicButton trainingTopicButtonGhost">
            回到器械皮拉提斯介紹
          </Link>
        </div>
      </section>
    </main>
  );
}
