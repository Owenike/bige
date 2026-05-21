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
      imagePosition="center 45%"
      mobileImagePosition="center 42%"
      introTitle="用更精準的方式感受身體控制"
      intro="器械皮拉提斯透過器械輔助與阻力控制，幫助你更精準感受核心、姿勢與身體排列。BigE 會依照你的能力安排動作，讓訓練同時兼具穩定、控制與線條感。"
      priceLabel="首次體驗 NT$880"
      priceDescription="器械皮拉提斯首次體驗 NT$880，透過器械輔助建立核心控制與身體覺察。"
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
          description: "依照器械皮拉提斯安排體驗內容，讓你實際感受 BigE 的教練引導與訓練方式。",
          icon: "focus",
        },
        {
          title: "說明後續建議",
          description: "體驗結束後，教練會依照你的狀態提供後續訓練方向與建議。",
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
          description: "在器械支撐與阻力中學會控制呼吸、骨盆與軀幹，讓力量更集中。",
          icon: "focus",
        },
        {
          title: "改善身體覺察",
          description: "透過細緻動作練習，理解身體排列與代償習慣，提升動作品質。",
          icon: "eye",
        },
        {
          title: "低衝擊且可調整",
          description: "器械提供輔助與阻力變化，讓不同能力的人都能找到合適強度。",
          icon: "sliders",
        },
        {
          title: "提升線條與活動度",
          description: "在穩定控制中延展身體，幫助建立更俐落的線條與活動舒適度。",
          icon: "waves",
        },
      ]}
      audiences={[
        {
          title: "想改善體態的人",
          description: "適合想讓站姿、坐姿與身體線條更穩定、更有覺察的人。",
          icon: "user",
        },
        {
          title: "核心無力或久坐緊繃的人",
          description: "從低衝擊動作開始，慢慢找回核心參與與身體支撐感。",
          icon: "focus",
        },
        {
          title: "想用低衝擊方式訓練的人",
          description: "不需要高強度跳躍，也能透過精準控制建立訓練效果。",
          icon: "sliders",
        },
        {
          title: "想提升身體線條與控制感的人",
          description: "透過器械輔助與教練引導，讓每個動作更細膩、更有目的。",
          icon: "sparkles",
        },
      ]}
    />
  );
}
