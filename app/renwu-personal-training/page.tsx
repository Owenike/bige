import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";

const siteUrl = "https://bigefitness.com";
const pageUrl = `${siteUrl}/renwu-personal-training`;
const pageDescription =
  "想找仁武健身教練或重量訓練課程？BigE 巨挺健身館提供一對一教練指導與首次體驗，適合想增肌減脂、改善體態、建立正確動作品質與提升日常活動能力的人，地點位於高雄市仁武區八德北路728號。";

export const metadata: Metadata = {
  title: "仁武健身教練｜重量訓練・體態評估｜巨挺健身館 BigE",
  description: pageDescription,
};

const heroStyle = {
  "--training-hero-position": "center 36%",
  "--training-hero-mobile-position": "center 34%",
} as CSSProperties;

const suitableFor = [
  "想增肌減脂，但不確定該怎麼安排重量、組數與訓練節奏的人。",
  "想改善體態，讓肩頸、背部、臀腿線條與站姿更有支撐感的人。",
  "重量訓練初學者，希望有人從基本動作開始帶，不想只靠影片模仿的人。",
  "對健身房器材不熟，看到槓鈴、啞鈴與機械式器材會不知道從哪裡開始的人。",
  "深蹲、硬舉、推、拉動作容易代償，想先建立正確動作品質的人。",
  "久坐上班族想提升肌力、活動能力與日常精神，不只追求短期流汗的人。",
  "銀髮族或重新開始運動的人，希望用安全、可調整的方式提升體能的人。",
];

const cautionItems = [
  "目前有急性疼痛、關節腫脹或症狀正在加劇。",
  "剛受傷、剛手術，或仍在醫療復健初期。",
  "醫師已限制運動，或有尚未確認原因的胸悶、暈眩與不適。",
  "懷孕中、產後恢復期，或有特殊身體狀況需要先評估。",
  "有慢性疾病、舊傷、用藥或任何需要教練事先知道的狀況。",
];

const trainingHelps = [
  {
    title: "建立肌力與肌肉量",
    description: "透過循序漸進的負重，讓身體有明確刺激，幫助增肌減脂與體態改變更穩定。",
  },
  {
    title: "改善動作品質",
    description: "教練會觀察你的深蹲、推、拉、髖關節與核心控制，調整容易代償的地方。",
  },
  {
    title: "提升日常活動能力",
    description: "訓練不只為了健身房表現，也讓搬重物、爬樓梯、久站與日常活動更有力量。",
  },
];

const comparisonItems = [
  {
    title: "重量訓練",
    description:
      "重點在肌力、肌肉量、負重能力與動作模式建立，適合想增肌減脂、提升體能與學會正確重訓的人。",
  },
  {
    title: "器械皮拉提斯",
    description:
      "更細緻地訓練核心控制、身體覺察與排列穩定，適合想改善控制感、低衝擊入門或輔助重訓的人。",
  },
  {
    title: "可以互補安排",
    description:
      "如果你同時需要力量與控制，BigE 教練可依照狀態建議兩種訓練的比例，讓進步更完整。",
  },
];

const trialSteps = [
  "先了解你的目標、運動經驗、生活型態與是否有舊傷或限制。",
  "進行簡單姿勢與動作觀察，找出適合你的訓練起點。",
  "由教練帶你熟悉器材，學習基本推、拉、蹲、髖關節與核心控制。",
  "依照當天狀態調整重量與強度，避免一開始就硬推高強度。",
  "首次體驗 NT$880，體驗後再討論後續安排，不需要一開始就綁約。",
];

const faqs = [
  {
    question: "完全沒有重訓經驗可以預約嗎？",
    answer:
      "可以。BigE 的仁武健身教練會從你的狀態與目標開始評估，先建立安全的基本動作，再逐步增加強度。",
  },
  {
    question: "重量訓練一定會練得很壯嗎？",
    answer:
      "不一定。訓練方向會依照目標安排，可以是增肌、減脂、體態改善、提升日常體能或建立運動習慣。",
  },
  {
    question: "我不熟器材，會不會很尷尬？",
    answer:
      "不會。首次體驗會由教練帶你認識器材與動作，不需要自己猜怎麼用，也不需要先有健身房經驗。",
  },
  {
    question: "重量訓練跟器械皮拉提斯怎麼選？",
    answer:
      "想提升肌力、肌肉量與負重能力，可以先選重量訓練；想加強核心控制、身體覺察與低衝擊入門，可以比較器械皮拉提斯。兩者也可以互補。",
  },
  {
    question: "第一次體驗需要準備什麼？",
    answer:
      "穿著好活動的服裝，帶水與毛巾即可。若有舊傷、慢性疾病、用藥或近期不適，請在體驗前先告知教練。",
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
  name: "仁武健身教練重量訓練首次體驗",
  serviceType: "一對一健身教練與重量訓練",
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
    price: "880",
    priceCurrency: "TWD",
    name: "重量訓練首次體驗",
  },
};

export default function RenwuPersonalTrainingPage() {
  return (
    <main className="trainingTopicPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />

      <section className="trainingTopicHero" style={heroStyle}>
        <div className="trainingTopicHeroMedia" aria-hidden>
          <Image
            src="/home-images/card-weight-training.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="trainingTopicHeroImage"
          />
          <div className="trainingTopicHeroShade" />
        </div>
        <div className="trainingTopicHeroInner">
          <p className="trainingTopicEyebrow">RENWU PERSONAL TRAINING</p>
          <h1>重量訓練適合我嗎？</h1>
          <p className="trainingTopicLead">
            如果你正在找仁武健身教練、仁武私人教練或仁武重量訓練，BigE 巨挺健身館會先從體態評估、
            動作品質與目標開始，協助你安全建立第一堂課。
          </p>
          <div className="trainingTopicHeroPrice">
            <span>首次體驗 NT$880</span>
            <p>一對一教練指導，適合想增肌減脂、改善體態、熟悉器材與建立正確動作的人。</p>
          </div>
          <div className="trainingTopicActions">
            <Link href="/trial-booking" className="trainingTopicButton trainingTopicButtonPrimary">
              預約首次體驗
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
          <h2>先知道你的身體需要什麼，再開始加重量</h2>
        </div>
        <p>
          重量訓練不是只把重量越加越重。BigE 巨挺健身館位於高雄仁武八德北路，教練會先了解你的目標、
          身體狀態與動作習慣，再安排適合的訓練內容。對初學者、上班族、銀髮族或重新開始運動的人來說，
          這會比自己摸索更穩，也更容易持續。
        </p>
      </section>

      <section className="trainingTopicPanel">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">BEST FOR</p>
          <h2>適合對象</h2>
          <p className="trainingTopicSectionLead">
            你不需要先練得很好才找教練。真正需要仁武私人教練的人，往往是想把第一步走穩的人。
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
          <h2>開始前，這些狀況請先讓教練知道</h2>
          <p className="trainingTopicSectionLead">
            BigE 會以安全、保守與可調整的方式評估。若有以下情況，首次體驗會先確認適合的範圍，
            必要時建議先諮詢醫療專業。
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
          <p className="trainingTopicSectionKicker">TRAINING BENEFITS</p>
          <h2>重量訓練可以幫你什麼？</h2>
        </div>
        <div className="trainingTopicGrid">
          {trainingHelps.map((item) => (
            <article className="trainingTopicCard" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trainingTopicPanel trainingTopicPanelSoft">
        <div className="trainingTopicSectionHeader">
          <p className="trainingTopicSectionKicker">STRENGTH OR PILATES</p>
          <h2>重量訓練與器械皮拉提斯差異</h2>
        </div>
        <div className="trainingTopicGrid">
          {comparisonItems.map((item) => (
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
          <h2>BigE 首次體驗流程</h2>
          <p className="trainingTopicSectionLead">
            第一次來不用先會器材。教練會帶你從評估、示範、修正到訓練方向，逐步建立安全感。
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
          <h2>高雄仁武八德北路的重量訓練起點</h2>
          <p className="trainingTopicSectionLead">
            巨挺健身館 BigE 位於高雄市仁武區八德北路728號，適合正在搜尋仁武健身教練、仁武私人教練、
            仁武重量訓練或想在高雄仁武建立運動習慣的人。你可以先用首次體驗了解教練方式，
            再決定後續是否安排固定課程。
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
        <p>仁武重量訓練首次體驗 NT$880</p>
        <h2>讓 BigE 教練協助你找到適合自己的第一堂重量訓練。</h2>
        <p className="trainingTopicFinalNote">
          從體態評估、器材熟悉到動作品質建立，先把起點走穩，再談長期進步。
        </p>
        <div className="trainingTopicActions trainingTopicActionsCenter">
          <Link href="/trial-booking" className="trainingTopicButton trainingTopicButtonPrimary">
            預約首次體驗
          </Link>
          <Link href="/training/weight-training" className="trainingTopicButton trainingTopicButtonGhost">
            回到重量訓練介紹
          </Link>
        </div>
      </section>
    </main>
  );
}
