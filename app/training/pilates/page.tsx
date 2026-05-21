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
      introTitle="以器械輔助動作控制，重新感受身體的穩定與線條。"
      intro="BigE 的器械皮拉提斯著重核心穩定、姿勢控制與身體覺察，透過可調整的器械阻力與引導，幫助你用低衝擊方式建立更精準的動作品質。"
      features={[
        "建立核心穩定與身體控制",
        "改善姿勢與身體覺察",
        "低衝擊且可依能力調整",
        "幫助線條雕塑與活動度提升",
      ]}
      audiences={[
        "想改善體態的人",
        "核心無力或久坐緊繃的人",
        "想用低衝擊方式訓練的人",
        "想提升身體線條與控制感的人",
      ]}
    />
  );
}
