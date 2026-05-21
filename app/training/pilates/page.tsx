import type { Metadata } from "next";
import { TrainingTopicPage } from "@/components/training-topic-page";

export const metadata: Metadata = {
  title: "器械皮拉提斯 | 巨挺健身館 BigE",
  description:
    "BigE 巨挺健身館提供仁武器械皮拉提斯課程，透過器械輔助建立核心控制、身體覺察與線條雕塑，適合想改善體態與核心穩定的人。",
};

export default function PilatesPage() {
  return (
    <TrainingTopicPage
      eyebrow="REFORMER PILATES"
      title="器械皮拉提斯"
      subtitle="透過器械輔助建立核心控制、身體覺察與線條雕塑，讓動作更精準、體態更穩定。"
      imageSrc="/home-images/card-pilates-core.png"
      imageAlt="BigE 器械皮拉提斯"
      imagePosition="center 34%"
      mobileImagePosition="center 32%"
      heroClassName="trainingTopicHeroMobileLower"
      introTitle="用更精準的方式感受身體控制"
      intro="器械皮拉提斯透過器械輔助與阻力控制，幫助你更精準感受核心、姿勢與身體排列。BigE 會依照你的能力安排動作，讓訓練同時兼具穩定、控制與線條感。"
      priceLabel="首次體驗 NT$880"
      priceDescription="器械皮拉提斯首次體驗 NT$880，透過器械輔助建立核心控制與身體覺察。"
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
          icon: "focus",
        },
        {
          title: "說明後續建議",
          description: "體驗後提供適合你的訓練方向與安排建議。",
          icon: "sparkles",
        },
      ]}
      relatedTopics={[
        { title: "重量訓練", href: "/training/weight-training", eyebrow: "WEIGHT TRAINING" },
        { title: "拳擊體能訓練", href: "/training/boxing", eyebrow: "BOXING FITNESS" },
        { title: "功能性調整", href: "/training/functional-adjustment", eyebrow: "FUNCTIONAL ADJUSTMENT" },
      ]}
      features={[
        {
          title: "建立核心穩定",
          description: "在器械支撐中練習呼吸、骨盆與軀幹控制。",
          icon: "focus",
        },
        {
          title: "改善身體覺察",
          description: "透過細緻動作，提升排列感與身體覺察。",
          icon: "eye",
        },
        {
          title: "低衝擊且可調整",
          description: "器械可調整輔助與阻力，找到適合自己的強度。",
          icon: "sliders",
        },
        {
          title: "提升線條與活動度",
          description: "在穩定控制中延展身體，建立線條與活動度。",
          icon: "waves",
        },
      ]}
      audiences={[
        {
          title: "想改善體態的人",
          description: "讓站姿、坐姿與身體線條更穩定有感。",
          icon: "user",
        },
        {
          title: "核心無力或久坐緊繃的人",
          description: "從低衝擊動作開始，找回核心參與感。",
          icon: "focus",
        },
        {
          title: "想用低衝擊方式訓練的人",
          description: "不需高強度跳躍，也能透過控制建立訓練感。",
          icon: "sliders",
        },
        {
          title: "想提升身體線條與控制感的人",
          description: "透過器械與教練引導，讓動作更細膩有目的。",
          icon: "sparkles",
        },
      ]}
    />
  );
}
