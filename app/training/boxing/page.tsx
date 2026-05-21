import type { Metadata } from "next";
import { TrainingTopicPage } from "@/components/training-topic-page";

export const metadata: Metadata = {
  title: "拳擊體能訓練 | 巨挺健身館 BigE",
  description:
    "BigE 巨挺健身館提供仁武拳擊體能訓練，結合拳擊動作、心肺訓練、反應與協調，適合想燃脂、流汗與提升體能的人。",
};

export default function BoxingPage() {
  return (
    <TrainingTopicPage
      eyebrow="BOXING FITNESS"
      title="拳擊體能訓練"
      subtitle="結合拳擊動作、敏捷反應與心肺訓練，提升燃脂效率、協調性與全身爆發力。"
      imageSrc="/home-images/card-boxing-training.png"
      imageAlt="BigE 拳擊體能訓練"
      imagePosition="center 40%"
      mobileImagePosition="center 36%"
      introTitle="讓訓練有節奏，也有挑戰感"
      intro="拳擊體能訓練結合拳擊動作、步伐、反應與心肺訓練，讓運動不只是重複器械動作，而是更有節奏與挑戰感。透過教練指導，你可以在安全範圍內提升協調性、敏捷度與全身爆發力。"
      priceLabel="首次體驗 NT$880"
      priceDescription="拳擊體能訓練首次體驗 NT$880，從基本動作與節奏開始，帶你安全進入訓練狀態。"
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
          description: "依照拳擊體能訓練安排體驗內容，讓你實際感受 BigE 的教練引導與訓練方式。",
          icon: "target",
        },
        {
          title: "說明後續建議",
          description: "體驗結束後，教練會依照你的狀態提供後續訓練方向與建議。",
          icon: "sparkles",
        },
      ]}
      relatedTopics={[
        { title: "重量訓練", href: "/training/weight-training", eyebrow: "WEIGHT TRAINING" },
        { title: "器械皮拉提斯", href: "/training/pilates", eyebrow: "REFORMER PILATES" },
        { title: "功能性調整", href: "/training/functional-adjustment", eyebrow: "FUNCTIONAL ADJUSTMENT" },
      ]}
      features={[
        {
          title: "建立拳擊基本動作",
          description: "從站姿、步伐、出拳與防守開始，逐步掌握節奏與身體協調。",
          icon: "target",
        },
        {
          title: "提升心肺與反應能力",
          description: "透過間歇式訓練與反應練習，讓體能、敏捷度與專注力同步提升。",
          icon: "zap",
        },
        {
          title: "高效率流汗與燃脂",
          description: "拳擊動作結合全身發力，讓短時間訓練也能有明確的運動感。",
          icon: "flame",
        },
        {
          title: "釋放壓力與建立節奏感",
          description: "用擊打、移動與呼吸找回節奏，讓訓練過程更有投入感。",
          icon: "wind",
        },
      ]}
      audiences={[
        {
          title: "想大量流汗的人",
          description: "適合想用更有動感的方式提高運動量，享受訓練後的暢快感。",
          icon: "activity",
        },
        {
          title: "想提升體能與敏捷度的人",
          description: "透過步伐與反應訓練，建立更靈活的身體控制能力。",
          icon: "zap",
        },
        {
          title: "想用拳擊釋放壓力的人",
          description: "在安全指導下透過擊打節奏轉換壓力，讓運動更有情緒出口。",
          icon: "heart",
        },
        {
          title: "覺得一般訓練太無聊的人",
          description: "用更有互動感的課程形式，讓每一次訓練都有新鮮感與挑戰。",
          icon: "sparkles",
        },
      ]}
    />
  );
}
