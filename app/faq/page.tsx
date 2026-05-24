import type { Metadata } from "next";
import Link from "next/link";

const LINE_URL = "https://lin.ee/0GWm0oZ";

const faqItems = [
  {
    category: "首次體驗",
    question: "首次體驗有哪些項目？",
    answer: "目前可預約重量訓練、器械皮拉提斯與運動按摩。若還不確定方向，BigE 團隊也可以先協助你判斷適合的開始方式。",
  },
  {
    category: "費用",
    question: "首次體驗費用是多少？",
    answer: "重量訓練首次體驗 NT$880，器械皮拉提斯首次體驗 NT$880，運動按摩首次體驗 NT$1,500。",
  },
  {
    category: "課程選擇",
    question: "我不知道適合哪一種課程怎麼辦？",
    answer: "可以先透過 LINE 諮詢，告訴我們你的目標、運動經驗與目前狀態，團隊會協助你整理比較適合的體驗方向。",
  },
  {
    category: "新手友善",
    question: "需要有運動經驗才能預約嗎？",
    answer: "不需要。首次體驗會依照你的狀態安排內容，教練會從動作品質、強度與安全感開始調整。",
  },
  {
    category: "器械皮拉提斯",
    question: "器械皮拉提斯適合新手嗎？",
    answer: "適合。課程會依照體態、核心控制、活動度與身體覺察安排，透過器械輔助讓動作更穩定、更容易理解。",
  },
  {
    category: "運動按摩",
    question: "運動按摩是醫療治療嗎？",
    answer: "不是醫療治療。BigE 的運動按摩主要協助放鬆、恢復與活動度調整；若有醫療問題或急性不適，建議先諮詢醫師。",
  },
  {
    category: "預約",
    question: "如何預約首次體驗？",
    answer: "可以點擊「立即預約」進入預約頁，選擇想體驗的項目並留下可聯繫資訊，BigE 團隊會再協助確認時段。",
  },
  {
    category: "預約確認",
    question: "預約後會有人聯繫我嗎？",
    answer: "會。送出預約後，BigE 團隊會與你確認合適時段、體驗內容與現場注意事項。",
  },
  {
    category: "地點",
    question: "場館在哪裡？",
    answer: "BigE 位於高雄仁武區。你可以點擊首頁的「查看地圖」，或透過 LINE 詢問詳細交通與停車資訊。",
  },
  {
    category: "LINE 諮詢",
    question: "可以只諮詢不預約嗎？",
    answer: "可以。你可以先透過 LINE 了解課程差異、體驗方式與適合方向，再決定是否預約。",
  },
];

export const metadata: Metadata = {
  title: "常見問題｜巨挺健身館 BigE",
  description: "整理 BigE 首次體驗、重量訓練、器械皮拉提斯、運動按摩、預約與 LINE 諮詢常見問題。",
};

export default function FaqPage() {
  return (
    <main className="faqPage">
      <section className="faqHeroSection">
        <div className="faqHeroInner">
          <p className="faqEyebrow">BIGE FAQ</p>
          <h1>常見問題</h1>
          <p className="faqHeroLead">預約前，你可能想先了解的事。</p>
        </div>
      </section>

      <section className="faqListSection" aria-label="常見問題列表">
        <div className="faqListInner">
          {faqItems.map((item, index) => (
            <article className="faqCard" key={item.question}>
              <div className="faqCardMeta">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>{item.category}</span>
              </div>
              <div className="faqCardContent">
                <h2>{item.question}</h2>
                <p>{item.answer}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="faqCtaSection" aria-label="下一步">
        <div className="faqCtaCard">
          <p className="faqEyebrow">NEXT STEP</p>
          <h2>還有其他問題？我們可以一起整理適合你的開始方式。</h2>
          <div className="faqCtaActions">
            <Link className="faqButton faqButtonPrimary" href="/trial-booking">
              立即預約首次體驗
            </Link>
            <a className="faqButton faqButtonSecondary" href={LINE_URL} target="_blank" rel="noopener noreferrer">
              LINE 諮詢
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
