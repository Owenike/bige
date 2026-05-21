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
      introTitle="從基礎動作開始，建立能長期進步的訓練節奏。"
      intro="BigE 的重量訓練會依照你的動作經驗、身體狀態與目標安排訓練內容，讓你在安全可理解的節奏中建立肌力、體態控制與日常活動能力。"
      features={[
        "建立正確基礎動作",
        "依照能力安排訓練強度",
        "提升肌力與體態控制",
        "適合初學者與重新開始訓練者",
      ]}
      audiences={[
        "想增肌減脂的人",
        "久坐、體態不佳的人",
        "想學會正確重訓動作的人",
        "想提升日常體能的人",
      ]}
    />
  );
}
