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
      imagePosition="center 42%"
      mobileImagePosition="center 40%"
      introTitle="從身體使用習慣開始重新整理"
      intro="功能性調整會從動作模式、緊繃感與身體使用習慣開始觀察，搭配放鬆、活動度與基礎修正訓練，協助你找回更順暢的身體狀態。這不是醫療治療，而是幫助你更了解自己的身體使用方式。"
      priceLabel="首次體驗 NT$1,500"
      priceDescription="功能性調整首次體驗 NT$1,500，協助你從放鬆、活動度與動作品質找回更順暢的身體狀態。"
      flowSteps={[
        {
          title: "了解身體狀態與緊繃感",
          description: "教練會先了解你的日常習慣、訓練經驗與目前身體狀態，確認適合的調整方向。",
          icon: "user",
        },
        {
          title: "觀察動作模式與活動限制",
          description: "透過簡單動作觀察，找出目前身體使用上比較需要整理的環節。",
          icon: "scan",
        },
        {
          title: "進行放鬆與活動度調整",
          description: "依照身體狀態安排放鬆、活動度與基礎修正內容，讓你實際感受調整方式。",
          icon: "waves",
        },
        {
          title: "說明後續自我照顧與訓練建議",
          description: "體驗結束後，教練會依照你的狀態提供後續自我照顧與訓練方向。",
          icon: "heart",
        },
      ]}
      relatedTopics={[
        { title: "重量訓練", href: "/training/weight-training", eyebrow: "WEIGHT TRAINING" },
        { title: "器械皮拉提斯", href: "/training/pilates", eyebrow: "REFORMER PILATES" },
        { title: "拳擊體能訓練", href: "/training/boxing", eyebrow: "BOXING FITNESS" },
      ]}
      features={[
        {
          title: "觀察動作模式",
          description: "從走、蹲、轉身與基礎發力方式開始，找出身體容易卡住的環節。",
          icon: "scan",
        },
        {
          title: "搭配放鬆與活動度調整",
          description: "依照身體狀態安排放鬆與活動度練習，讓後續訓練更順暢。",
          icon: "waves",
        },
        {
          title: "改善動作品質",
          description: "透過基礎修正訓練，協助你用更穩定、更有效率的方式完成動作。",
          icon: "activity",
        },
        {
          title: "提升活動舒適度",
          description: "讓日常活動與訓練前後的身體感受更清楚，也更容易持續調整。",
          icon: "sparkles",
        },
      ]}
      audiences={[
        {
          title: "久坐或身體容易緊繃的人",
          description: "適合想從日常習慣開始整理身體狀態，降低長時間固定姿勢的不適感。",
          icon: "user",
        },
        {
          title: "訓練時容易卡關的人",
          description: "透過動作觀察找出限制，讓重量訓練或其他課程更容易銜接。",
          icon: "target",
        },
        {
          title: "想改善動作品質的人",
          description: "從控制、穩定與活動範圍著手，讓身體使用方式更有意識。",
          icon: "scan",
        },
        {
          title: "想提升活動舒適度的人",
          description: "適合想讓日常活動更順、更放鬆，也更了解自身狀態的人。",
          icon: "heart",
        },
      ]}
    />
  );
}
