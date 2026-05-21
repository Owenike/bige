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
      introTitle="用拳擊節奏帶動體能，讓訓練更有速度與專注感。"
      intro="課程會從拳擊基本動作、步伐與節奏開始，搭配心肺與協調訓練，讓你在流汗與專注中提升體能、反應與全身控制能力。"
      features={[
        "拳擊基本動作與節奏訓練",
        "心肺、反應與協調訓練",
        "高效率燃脂與壓力釋放",
        "提升核心與全身控制能力",
      ]}
      audiences={[
        "想大量流汗的人",
        "想提升心肺與體能的人",
        "想透過拳擊釋放壓力的人",
        "想用更有趣方式運動的人",
      ]}
    />
  );
}
