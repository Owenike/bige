export const STUDENT_DROP_IN_ENTRY_PLANS = ["review_50", "standard_100"] as const;

export type StudentDropInEntryPlan = (typeof STUDENT_DROP_IN_ENTRY_PLANS)[number];

export const DEFAULT_STUDENT_DROP_IN_ENTRY_PLAN: StudentDropInEntryPlan = "review_50";

export function studentDropInPlanDetails(plan: StudentDropInEntryPlan) {
  if (plan === "standard_100") {
    return {
      priceTwd: 100,
      reviewPhotoRequired: false,
      unlimitedUses: true,
      label: "100 元入場",
    } as const;
  }

  return {
    priceTwd: 50,
    reviewPhotoRequired: true,
    unlimitedUses: false,
    label: "50 元入場",
  } as const;
}

export function studentDropInRemainingUses(input: {
  plan: StudentDropInEntryPlan;
  totalUses: number;
  usedUses: number;
}) {
  if (studentDropInPlanDetails(input.plan).unlimitedUses) return null;
  return Math.max(0, input.totalUses - input.usedUses);
}
