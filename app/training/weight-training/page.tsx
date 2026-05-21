import type { Metadata } from "next";
import { TrainingTopicPage } from "@/components/training-topic-page";

export const metadata: Metadata = {
  title: "重量訓練 | 巨挺健身館 BigE",
  description:
    "BigE 巨挺健身館提供仁武重量訓練與一對一健身教練指導，協助建立正確動作品質、提升肌力、體態與日常活動能力。",
};

export default function WeightTrainingPage() {
  return (
    <TrainingTopicPage
      eyebrow="WEIGHT TRAINING"
      title="重量訓練"
      subtitle="透過一對一教練指導，建立正確動作品質，提升肌力、體態與日常活動能力。"
      imageSrc="/home-images/card-weight-training.png"
      imageAlt="BigE 重量訓練"
      imagePosition="center 38%"
      mobileImagePosition="center 34%"
      introTitle="先建立能長久進步的動作基礎"
      intro="BigE 的重量訓練不是一開始就追求大重量，而是先建立正確動作品質。教練會依照你的身體狀況、訓練經驗與目標，安排適合的動作與強度，幫助你安全地提升肌力、體態與日常活動能力。"
      priceLabel="首次體驗 NT$880"
      priceDescription="重量訓練首次體驗 NT$880，由教練協助安排適合你的第一堂課。"
      flowSteps={[
        {
          title: "了解目標與身體狀態",
          description: "教練會先了解你的訓練目標、運動經驗與目前身體狀態，確認適合的體驗方向。",
          icon: "user",
        },
        {
          title: "基礎動作與需求觀察",
          description: "透過簡單動作或身體狀態觀察，找出目前最適合你的訓練起點。",
          icon: "scan",
        },
        {
          title: "進行體驗內容",
          description: "依照重量訓練項目安排體驗內容，讓你實際感受 BigE 的教練引導與訓練方式。",
          icon: "dumbbell",
        },
        {
          title: "說明後續建議",
          description: "體驗結束後，教練會依照你的狀態提供後續訓練方向與建議。",
          icon: "target",
        },
      ]}
      relatedTopics={[
        { title: "器械皮拉提斯", href: "/training/pilates", eyebrow: "REFORMER PILATES" },
        { title: "拳擊體能訓練", href: "/training/boxing", eyebrow: "BOXING FITNESS" },
        { title: "功能性調整", href: "/training/functional-adjustment", eyebrow: "FUNCTIONAL ADJUSTMENT" },
      ]}
      features={[
        {
          title: "建立正確動作品質",
          description: "從深蹲、推、拉與髖關節動作開始，讓每一次訓練都更穩定且有效率。",
          icon: "dumbbell",
        },
        {
          title: "依能力安排強度",
          description: "教練會依照你的經驗、體能與目標調整訓練內容，不需要一開始就追求大重量。",
          icon: "gauge",
        },
        {
          title: "提升肌力與體態控制",
          description: "透過循序漸進的訓練，建立肌力、肌耐力與身體控制感。",
          icon: "trending",
        },
        {
          title: "適合初學與重新開始",
          description: "不論是第一次接觸重訓，或想重新建立運動習慣，都能找到適合自己的起點。",
          icon: "rotate",
        },
      ]}
      audiences={[
        {
          title: "想增肌減脂的人",
          description: "透過重量訓練提升肌肉量與日常消耗，讓體態改變更有方向。",
          icon: "target",
        },
        {
          title: "久坐與體態不佳的人",
          description: "從基礎動作與控制能力開始，重新建立身體使用方式。",
          icon: "user",
        },
        {
          title: "想學會正確重訓動作的人",
          description: "由教練帶你理解動作細節，降低盲目模仿造成的挫折感。",
          icon: "focus",
        },
        {
          title: "想提升日常體能的人",
          description: "讓上下樓、搬重物與日常活動更有力，也讓運動習慣更容易持續。",
          icon: "activity",
        },
      ]}
    />
  );
}
