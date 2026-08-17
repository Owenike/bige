export const BIGE_ACTIVE_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "booked",
  "checked_in",
] as const;

export type BigeScheduleBatchBookingCandidate = {
  id: string;
  member_id: string | null;
  coach_id: string | null;
  service_name?: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  course_type?: string | null;
  is_bige_schedule?: boolean | null;
};

export type BigeScheduleBatchNoteCandidate = {
  id: string;
  coach_id: string;
  starts_at: string;
  ends_at: string;
  content: string;
};

export type BigeScheduleBatchConflict =
  | { kind: "coach_booking"; item: BigeScheduleBatchBookingCandidate }
  | { kind: "coach_note"; item: BigeScheduleBatchNoteCandidate }
  | { kind: "member_booking"; item: BigeScheduleBatchBookingCandidate };

function rangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string,
) {
  const firstStartAt = new Date(firstStart).getTime();
  const firstEndAt = new Date(firstEnd).getTime();
  const secondStartAt = new Date(secondStart).getTime();
  const secondEndAt = new Date(secondEnd).getTime();
  return firstStartAt < secondEndAt && secondStartAt < firstEndAt;
}

/**
 * Mirrors the database's strict BIGE rule for an advisory batch-schedule check.
 * The database trigger/RPC remains the final authority when records are created.
 */
export function findBigeScheduleBatchConflict(params: {
  memberId: string;
  coachId: string;
  startsAt: string;
  endsAt: string;
  bookings: BigeScheduleBatchBookingCandidate[];
  notes: BigeScheduleBatchNoteCandidate[];
}): BigeScheduleBatchConflict | null {
  const activeStatuses = new Set<string>(BIGE_ACTIVE_BOOKING_STATUSES);
  const overlappingBookings = params.bookings.filter(
    (booking) =>
      activeStatuses.has(booking.status) &&
      rangesOverlap(params.startsAt, params.endsAt, booking.starts_at, booking.ends_at),
  );

  const coachBooking = overlappingBookings.find(
    (booking) => booking.is_bige_schedule === true && booking.coach_id === params.coachId,
  );
  if (coachBooking) return { kind: "coach_booking", item: coachBooking };

  const coachNote = params.notes.find(
    (note) =>
      note.coach_id === params.coachId &&
      rangesOverlap(params.startsAt, params.endsAt, note.starts_at, note.ends_at),
  );
  if (coachNote) return { kind: "coach_note", item: coachNote };

  const memberBooking = overlappingBookings.find(
    (booking) => booking.member_id === params.memberId,
  );
  return memberBooking ? { kind: "member_booking", item: memberBooking } : null;
}
