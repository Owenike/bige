export const TRIAL_BOOKING_CONTACT_NOTE_MAX_LENGTH = 500;

export function normalizeTrialBookingContactNote(value: unknown) {
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (!note || note.length > TRIAL_BOOKING_CONTACT_NOTE_MAX_LENGTH) return null;
  return note;
}
