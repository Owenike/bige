export const TRIAL_BOOKING_SCHEDULE_NOTE_MAX_LENGTH = 500;

export function normalizeTrialBookingScheduleNote(value: string | null | undefined) {
  const normalized = value?.trim() || "";
  if (!normalized || normalized.length > TRIAL_BOOKING_SCHEDULE_NOTE_MAX_LENGTH) return null;
  return normalized;
}

export function createTrialBookingScheduleNotePatch(value: string | null | undefined) {
  return {
    schedule_note: normalizeTrialBookingScheduleNote(value),
  } as const;
}
