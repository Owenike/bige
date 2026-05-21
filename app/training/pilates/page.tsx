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
      features={[
        {
          title: "建立核心穩定",
          description: "在器械支撐與阻力中學會控制呼吸、骨盆與軀幹，讓力量更集中。",
        },
        {
          title: "改善身體覺察",
          description: "透過細緻動作練習，理解身體排列與代償習慣，提升動作品質。",
        },
        {
          title: "低衝擊且可調整",
          description: "器械提供輔助與阻力變化，讓不同能力的人都能找到合適強度。",
        },
        {
          title: "提升線條與活動度",
          description: "在穩定控制中延展身體，幫助建立更俐落的線條與活動舒適度。",
        },
      ]}
      audiences={[
        {
          title: "想改善體態的人",
          description: "適合想讓站姿、坐姿與身體線條更穩定、更有覺察的人。",
        },
        {
          title: "核心無力或久坐緊繃的人",
          description: "從低衝擊動作開始，慢慢找回核心參與與身體支撐感。",
        },
        {
          title: "想用低衝擊方式訓練的人",
          description: "不需要高強度跳躍，也能透過精準控制建立訓練效果。",
        },
        {
          title: "想提升身體線條與控制感的人",
          description: "透過器械輔助與教練引導，讓每個動作更細膩、更有目的。",
        },
      ]}
    />
  );
}
