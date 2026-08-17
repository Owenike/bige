export const TRIAL_BOOKING_STATUSES = [
  "new",
  "contacted",
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
] as const;

export const TRIAL_PAYMENT_STATUSES = [
  "pending_cash",
  "pending_payment",
  "paid",
  "failed",
  "cancelled",
] as const;

export type TrialBookingStatus = (typeof TRIAL_BOOKING_STATUSES)[number];
export type TrialPaymentStatus = (typeof TRIAL_PAYMENT_STATUSES)[number];
export type TrialBookingStatusFilter = "" | "pending" | TrialBookingStatus;
export type TrialPaymentStatusFilter = "" | TrialPaymentStatus;
export type TrialBookingWorkflowGroup = "" | "follow_up" | "processed" | "marketing_report";

const bookingStatusSet = new Set<string>(TRIAL_BOOKING_STATUSES);
const paymentStatusSet = new Set<string>(TRIAL_PAYMENT_STATUSES);

export function parseTrialBookingStatusFilter(value: string | null | undefined): TrialBookingStatusFilter {
  const normalized = value?.trim() || "";
  if (normalized === "pending") return "pending";
  return bookingStatusSet.has(normalized) ? (normalized as TrialBookingStatus) : "";
}

export function parseTrialPaymentStatusFilter(value: string | null | undefined): TrialPaymentStatusFilter {
  const normalized = value?.trim() || "";
  return paymentStatusSet.has(normalized) ? (normalized as TrialPaymentStatus) : "";
}

export function parseTrialBookingWorkflowGroup(
  value: string | null | undefined,
): TrialBookingWorkflowGroup {
  const normalized = value?.trim() || "";
  return normalized === "follow_up" || normalized === "processed" || normalized === "marketing_report"
    ? normalized
    : "";
}

export function bookingMatchesWorkflowGroup(
  booking: {
    bookingStatus: TrialBookingStatus;
    appointmentDate?: string | null;
    contactHistoryCount?: number;
    staffNote?: string | null;
  },
  group: string,
) {
  const normalizedGroup = parseTrialBookingWorkflowGroup(group);
  if (booking.bookingStatus === "cancelled") return false;
  if (!normalizedGroup) return true;

  const hasArrangement = Boolean(booking.appointmentDate)
    || booking.bookingStatus === "scheduled"
    || booking.bookingStatus === "completed"
    || booking.bookingStatus === "no_show";
  const hasContactNote = (booking.contactHistoryCount || 0) > 0;
  const isProcessed = hasArrangement || hasContactNote;

  if (normalizedGroup === "marketing_report") return hasArrangement;
  return normalizedGroup === "processed" ? isProcessed : !isProcessed;
}

export function bookingMatchesStatusFilter(status: TrialBookingStatus, filter: string) {
  const normalizedFilter = parseTrialBookingStatusFilter(filter);
  if (!normalizedFilter) return status !== "cancelled";
  if (normalizedFilter === "pending") return status === "new" || status === "contacted";
  return status === normalizedFilter;
}

export function paymentMatchesStatusFilter(status: TrialPaymentStatus, filter: string) {
  const normalizedFilter = parseTrialPaymentStatusFilter(filter);
  return !normalizedFilter || status === normalizedFilter;
}
