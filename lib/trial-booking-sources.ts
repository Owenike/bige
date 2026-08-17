export const trialBookingSourceValues = [
  "website",
  "official_line",
  "walk_in",
  "phone_booking",
  "br",
  "legacy_schedule_import",
] as const;

export type TrialBookingSource = (typeof trialBookingSourceValues)[number];

export const trialBookingSourceLabels: Record<TrialBookingSource, string> = {
  website: "網站",
  official_line: "官方 LINE",
  walk_in: "現場",
  phone_booking: "來電預約",
  br: "BR",
  legacy_schedule_import: "舊預約本匯入",
};

export function normalizeTrialBookingSource(value: string | null | undefined): TrialBookingSource {
  return trialBookingSourceValues.includes(value as TrialBookingSource)
    ? (value as TrialBookingSource)
    : "website";
}

export function trialBookingSourceLabel(value: string | null | undefined) {
  return trialBookingSourceLabels[normalizeTrialBookingSource(value)];
}
