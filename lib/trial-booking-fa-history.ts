import type { TrialBookingSource } from "./trial-booking-sources";

export type TrialFaHistoryItem = {
  id: string;
  trialBookingId: string | null;
  name: string;
  phone: string | null;
  birthday: string | null;
  memberCode: string | null;
  service: string;
  trialStage: string | null;
  startsAt: string;
  endsAt: string;
  recordedAt: string | null;
  bookingCoach: string | null;
  executingCoach: string | null;
  source: TrialBookingSource | string | null;
  originalAppointmentDate: string | null;
  originalAppointmentTime: string | null;
  originalNote: string | null;
  scheduleNote: string | null;
  operationNote: string | null;
};

export function resolveTrialFaHistoryCustomer(input: {
  trialBooking?: {
    name?: string | null;
    phone?: string | null;
    birthday?: string | null;
  } | null;
  member?: {
    full_name?: string | null;
    phone?: string | null;
    birth_date?: string | null;
    member_code?: string | null;
  } | null;
}) {
  const trialName = input.trialBooking?.name?.trim();
  const memberName = input.member?.full_name?.trim();
  const trialPhone = input.trialBooking?.phone?.trim();
  const memberPhone = input.member?.phone?.trim();

  return {
    name: trialName || memberName || "體驗學員",
    phone: trialPhone || memberPhone || null,
    birthday: input.trialBooking?.birthday || input.member?.birth_date || null,
    memberCode: input.member?.member_code || null,
  };
}

export function matchesTrialFaHistorySearch(item: TrialFaHistoryItem, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  if (!normalizedQuery) return true;

  return [
    item.name,
    item.phone,
    item.memberCode,
    item.service,
    item.trialStage,
    item.bookingCoach,
    item.executingCoach,
    item.originalAppointmentDate,
  ].some((value) => value?.toLocaleLowerCase("zh-TW").includes(normalizedQuery));
}
