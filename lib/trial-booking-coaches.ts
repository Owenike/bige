export type TrialBookingCoachProfile = {
  id: string;
  display_name: string | null;
  english_name: string | null;
  branch_id: string | null;
};

export type TrialBookingCoachOption = {
  id: string;
  label: string;
  branchId: string | null;
};

export const defaultTrialBookingDeskOptions = ["櫃台Annie", "櫃台Miffy"] as const;

export function trialBookingCoachLabel(
  profile: Pick<TrialBookingCoachProfile, "display_name" | "english_name">,
) {
  return profile.english_name?.trim() || profile.display_name?.trim() || "Coach";
}

export function trialBookingCoachOptions(
  profiles: readonly TrialBookingCoachProfile[],
): TrialBookingCoachOption[] {
  return profiles.map((profile) => ({
    id: profile.id,
    label: trialBookingCoachLabel(profile),
    branchId: profile.branch_id,
  }));
}

export function trialBookingAssigneeOptions(coachLabels: readonly string[]) {
  const seen = new Set<string>();

  return [...defaultTrialBookingDeskOptions, ...coachLabels].reduce<string[]>((options, value) => {
    const trimmed = value.trim();
    const normalized = trimmed.toLocaleLowerCase("en");
    if (!normalized || seen.has(normalized)) return options;
    seen.add(normalized);
    options.push(trimmed);
    return options;
  }, []);
}
