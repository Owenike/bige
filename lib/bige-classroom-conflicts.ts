const ACTIVE_STATUSES = new Set(["pending", "confirmed", "booked", "checked_in"]);
const CLASSROOM_COURSE_TYPES = new Set(["relaxation", "reformer_pilates"]);
const HALF_HOUR_MS = 30 * 60_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60_000;

export type BigeClassroomConflictBooking = {
  id: string;
  coach_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  course_type: string;
};

export type BigeClassroomConflict = {
  coach_id: string;
  starts_at: string;
  source_booking_ids: string[];
  booking_count: number;
  message: string;
};

function taipeiHourKey(epochMs: number) {
  return new Date(epochMs + TAIPEI_OFFSET_MS).toISOString().slice(0, 13);
}

/**
 * The historical classroom rule allows two overlapping relaxation/Pilates
 * bookings. A third booking is now surfaced as a non-blocking board warning.
 * Warnings are grouped by coach and local hour to match the schedule board.
 */
export function buildBigeClassroomConflicts(
  bookings: BigeClassroomConflictBooking[],
): BigeClassroomConflict[] {
  const active = bookings
    .filter(
      (booking) =>
        ACTIVE_STATUSES.has(String(booking.status || "").toLowerCase()) &&
        CLASSROOM_COURSE_TYPES.has(booking.course_type),
    )
    .map((booking) => ({
      ...booking,
      startsAtMs: new Date(booking.starts_at).getTime(),
      endsAtMs: new Date(booking.ends_at).getTime(),
    }))
    .filter(
      (booking) =>
        Number.isFinite(booking.startsAtMs) &&
        Number.isFinite(booking.endsAtMs) &&
        booking.endsAtMs > booking.startsAtMs,
    );

  if (active.length <= 2) return [];

  const firstSlot = Math.min(...active.map((booking) => booking.startsAtMs));
  const lastSlot = Math.max(...active.map((booking) => booking.endsAtMs));
  const conflicts = new Map<
    string,
    {
      coachId: string;
      startsAtMs: number;
      bookingIds: Set<string>;
      bookingCount: number;
    }
  >();

  for (let slotStart = firstSlot; slotStart < lastSlot; slotStart += HALF_HOUR_MS) {
    const slotEnd = slotStart + HALF_HOUR_MS;
    const overlapping = active.filter(
      (booking) => booking.startsAtMs < slotEnd && booking.endsAtMs > slotStart,
    );
    if (overlapping.length <= 2) continue;

    for (const coachId of new Set(overlapping.map((booking) => booking.coach_id))) {
      const key = `${coachId}:${taipeiHourKey(slotStart)}`;
      const existing = conflicts.get(key);
      if (existing) {
        existing.bookingCount = Math.max(existing.bookingCount, overlapping.length);
        for (const booking of overlapping) existing.bookingIds.add(booking.id);
      } else {
        conflicts.set(key, {
          coachId,
          startsAtMs: slotStart,
          bookingIds: new Set(overlapping.map((booking) => booking.id)),
          bookingCount: overlapping.length,
        });
      }
    }
  }

  return [...conflicts.values()]
    .map((conflict) => ({
      coach_id: conflict.coachId,
      starts_at: new Date(conflict.startsAtMs).toISOString(),
      source_booking_ids: [...conflict.bookingIds],
      booking_count: conflict.bookingCount,
      message: `放鬆／器械皮拉提斯同時段共有 ${conflict.bookingCount} 筆安排，請確認教室調度`,
    }))
    .sort(
      (left, right) =>
        left.starts_at.localeCompare(right.starts_at) ||
        left.coach_id.localeCompare(right.coach_id),
    );
}
