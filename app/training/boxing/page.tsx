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
      imagePosition="center 28%"
      mobileImagePosition="center 28%"
      introTitle="讓訓練有節奏，也有挑戰感"
      intro="拳擊體能訓練結合拳擊動作、步伐、反應與心肺訓練，讓運動不只是重複器械動作，而是更有節奏與挑戰感。透過教練指導，你可以在安全範圍內提升協調性、敏捷度與全身爆發力。"
      priceLabel="首次體驗 NT$880"
      priceDescription="拳擊體能訓練首次體驗 NT$880，從基本動作與節奏開始，帶你安全進入訓練狀態。"
      flowSteps={[
        {
          title: "了解目標",
          description: "教練會先了解你的目標、經驗與目前狀態。",
          icon: "user",
        },
        {
          title: "狀態觀察",
          description: "透過簡單動作觀察，找到適合的開始方式。",
          icon: "scan",
        },
        {
          title: "體驗訓練",
          description: "實際感受 BigE 的教練引導與訓練節奏。",
          icon: "target",
        },
        {
          title: "說明後續建議",
          description: "體驗後提供適合你的訓練方向與安排建議。",
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
          description: "從站姿、步伐與出拳開始，掌握節奏與協調。",
          icon: "target",
        },
        {
          title: "提升心肺與反應能力",
          description: "用間歇訓練與反應練習，提升體能與敏捷度。",
          icon: "zap",
        },
        {
          title: "高效率流汗與燃脂",
          description: "拳擊結合全身發力，短時間也能有明確運動感。",
          icon: "flame",
        },
        {
          title: "釋放壓力與建立節奏感",
          description: "用擊打、移動與呼吸找回節奏，讓訓練更投入。",
          icon: "wind",
        },
      ]}
      audiences={[
        {
          title: "想大量流汗的人",
          description: "用更有動感的方式提高運動量，享受流汗感。",
          icon: "activity",
        },
        {
          title: "想提升體能與敏捷度的人",
          description: "透過步伐與反應訓練，建立靈活控制力。",
          icon: "zap",
        },
        {
          title: "想用拳擊釋放壓力的人",
          description: "在安全指導下用擊打節奏轉換壓力。",
          icon: "heart",
        },
        {
          title: "覺得一般訓練太無聊的人",
          description: "用互動感更強的課程，讓訓練更有挑戰。",
          icon: "sparkles",
        },
      ]}
    />
  );
}
