export const TRIAL_BOOKING_STAFF_NOTE_MAX_LENGTH = 500;

export type TrialBookingStaffNoteParseResult =
  | { ok: true; note: string | null }
  | { ok: false; error: string };

export function parseTrialBookingStaffNote(value: unknown): TrialBookingStaffNoteParseResult {
  if (typeof value !== "string") {
    return { ok: false, error: "備註格式不正確。" };
  }

  const note = value.trim();
  if (note.length > TRIAL_BOOKING_STAFF_NOTE_MAX_LENGTH) {
    return { ok: false, error: `備註不可超過 ${TRIAL_BOOKING_STAFF_NOTE_MAX_LENGTH} 字。` };
  }

  return { ok: true, note: note || null };
}

export function trialBookingStaffNoteUpdateMatch(bookingId: string) {
  return { id: bookingId };
}
