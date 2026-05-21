import type { Metadata } from "next";
import { TrainingTopicPage } from "@/components/training-topic-page";

export const metadata: Metadata = {
  title: "功能性調整 | 巨挺健身館 BigE",
  description:
    "BigE 巨挺健身館提供仁武功能性調整，透過動作觀察、放鬆與基礎修正訓練，協助改善動作品質與活動舒適度。",
};

export default function FunctionalAdjustmentPage() {
  return (
    <TrainingTopicPage
      eyebrow="FUNCTIONAL ADJUSTMENT"
      title="功能性調整"
      subtitle="針對動作代償、疲勞與緊繃狀態進行調整，協助恢復更有效率的身體機制。"
      imageSrc="/home-images/card-functional-training.png"
      imageAlt="BigE 功能性調整"
      introTitle="先看懂身體限制，再安排更合適的訓練起點。"
      intro="功能性調整會透過動作觀察、活動度練習與放鬆安排，協助你理解身體目前的限制與代償模式，讓後續訓練更順暢、更有感。"
      features={[
        "觀察動作模式與身體限制",
        "搭配放鬆與活動度調整",
        "協助改善緊繃與代償",
        "提升訓練前後的身體舒適度",
      ]}
      audiences={[
        "久坐或身體容易緊繃的人",
        "訓練時容易卡關的人",
        "想改善動作品質的人",
        "想提升活動舒適度的人",
      ]}
    />
  );
}
