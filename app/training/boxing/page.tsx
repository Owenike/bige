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
