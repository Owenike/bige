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
      imagePosition="center 36%"
      mobileImagePosition="center 34%"
      introTitle="先建立能長久進步的動作基礎"
      intro="BigE 的重量訓練不是一開始就追求大重量，而是先建立正確動作品質。教練會依照你的身體狀況、訓練經驗與目標，安排適合的動作與強度，幫助你安全地提升肌力、體態與日常活動能力。"
      priceLabel="首次體驗 NT$880"
      priceDescription="重量訓練首次體驗 NT$880，由教練協助安排適合你的第一堂課。"
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
          icon: "dumbbell",
        },
        {
          title: "說明後續建議",
          description: "體驗後提供適合你的訓練方向與安排建議。",
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
          description: "從深蹲、推、拉開始，讓訓練更穩定有效率。",
          icon: "dumbbell",
        },
        {
          title: "依能力安排強度",
          description: "依照你的經驗與體能安排強度，從適合的重量開始進步。",
          icon: "gauge",
        },
        {
          title: "提升肌力與體態控制",
          description: "循序建立肌力、肌耐力與身體控制感。",
          icon: "trending",
        },
        {
          title: "適合初學與重新開始",
          description: "第一次接觸或重新開始，都能找到合適起點。",
          icon: "rotate",
        },
      ]}
      audiences={[
        {
          title: "想增肌減脂的人",
          description: "用重量訓練提升肌肉量，讓體態改變更有方向。",
          icon: "target",
        },
        {
          title: "久坐與體態不佳的人",
          description: "從基礎動作開始，重新建立身體使用方式。",
          icon: "user",
        },
        {
          title: "想學會正確重訓動作的人",
          description: "由教練帶你理解動作細節，少走模仿摸索的路。",
          icon: "focus",
        },
        {
          title: "想提升日常體能的人",
          description: "讓日常活動更有力，也讓運動習慣更容易持續。",
          icon: "activity",
        },
      ]}
    />
  );
}
