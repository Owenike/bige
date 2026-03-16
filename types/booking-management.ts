import type { BookingPackageLogItem, BookingPaymentMode } from "./booking-commerce";

export type BookingOverviewStatus =
  | "pending"
  | "confirmed"
  | "booked"
  | "checked_in"
  | "completed"
  | "cancelled"
  | "no_show";

export type BookingPaymentStatus =
  | "unpaid"
  | "deposit_pending"
  | "deposit_paid"
  | "fully_paid"
  | "refunded"
  | "partially_refunded";

export type BookingLiveSmokeStatus = BookingDepositLiveSmokeResult | "not_recorded";

export type BookingFilterOption = {
  id: string;
  label: string;
  secondaryLabel?: string | null;
};

export type BookingOverviewItem = {
  id: string;
  publicReference: string | null;
  customerName: string;
  customerPhone: string | null;
  branchId: string | null;
  branchName: string | null;
  therapistId: string | null;
  therapistName: string | null;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: BookingOverviewStatus | string;
  paymentStatus: BookingPaymentStatus | string;
  paymentMode: BookingPaymentMode;
  source: string | null;
  noteExcerpt: string | null;
  depositRequiredAmount: number;
  depositPaidAmount: number;
  finalAmount: number;
  outstandingAmount: number;
  paymentMethod: string | null;
  paymentReference: string | null;
  paymentUpdatedAt: string | null;
  liveSmokeStatus: BookingLiveSmokeStatus;
  liveSmokePerformedAt: string | null;
  liveSmokeProvider: string | null;
  liveSmokeReference: string | null;
  packageName: string | null;
  entryPassId: string | null;
  contractId: string | null;
  packageSessionsReserved: number;
  packageSessionsConsumed: number;
  notificationQueuedCount?: number;
  notificationFailedCount?: number;
  hasDepositReminderPending?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BookingOverviewFilters = {
  branches: BookingFilterOption[];
  therapists: BookingFilterOption[];
  statuses: Array<{ value: string; label: string }>;
  liveSmokeStatuses: Array<{ value: string; label: string }>;
  branchLocked: boolean;
  currentBranchId: string | null;
};

export type BookingOverviewSummary = {
  total: number;
  pending: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
  depositOutstanding: number;
  packageReserved: number;
};

export type BookingOverviewResponse = {
  items: BookingOverviewItem[];
  filters: BookingOverviewFilters;
  summary: BookingOverviewSummary;
};

export type BookingStatusLogItem = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  note: string | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
};

export type BookingDetailItem = BookingOverviewItem & {
  customerNote: string | null;
  internalNote: string | null;
  branchAddress: string | null;
  priceAmount: number | null;
  durationMinutes: number | null;
  depositPaidAt: string | null;
  statusReason: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  rescheduledFromBookingId: string | null;
  rescheduledFromReference: string | null;
  rescheduledToBookingId: string | null;
  rescheduledToReference: string | null;
  createdBy: string | null;
};

export type BookingNotificationItem = {
  id: string;
  eventType: string;
  channel: string;
  status: string;
  templateKey: string | null;
  deliveryMode: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  skippedReason: string | null;
  failureReason: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientEmail: string | null;
  createdAt: string;
};

export type BookingDepositPaymentItem = {
  provider: string;
  orderId: string;
  orderStatus: string;
  paymentId: string | null;
  paymentStatus: string;
  providerStatus: string;
  amount: number;
  checkoutUrl: string | null;
  paymentReference: string | null;
  providerReference: string | null;
  paymentMethod: string | null;
  paymentUpdatedAt: string | null;
  paidAt: string | null;
  lastWebhookEvent: string | null;
  lastWebhookStatus: string | null;
  lastWebhookAt: string | null;
};

export type BookingDepositPaymentAttemptItem = {
  id: string;
  orderId: string;
  amount: number;
  status: string;
  method: string | null;
  providerReference: string | null;
  paidAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isCurrentPending: boolean;
  isStalePending: boolean;
  isPaid: boolean;
};

export type BookingDepositPaymentWebhookItem = {
  paymentId: string | null;
  eventType: string;
  status: string;
  errorMessage: string | null;
  receivedAt: string | null;
  processedAt: string | null;
  signaturePresent: boolean;
};

export type BookingDepositPaymentOrderItem = {
  id: string;
  status: string;
  channel: string | null;
  amount: number;
  createdAt: string | null;
  updatedAt: string | null;
  note: string | null;
  isCurrent: boolean;
};

export type BookingDepositPaymentReadiness = {
  ready: boolean;
  mode: "reuse_pending" | "generate_new" | "blocked";
  canGenerateLink: boolean;
  blockers: string[];
  warnings: string[];
  config: {
    checkoutUrlConfigured: boolean;
    webhookUrlConfigured: boolean;
    webhookSecretConfigured: boolean;
    callbackVerificationEnabled: boolean;
    providerRoute: string;
    providerRouteExists: boolean;
  };
  booking: {
    bookingId: string;
    status: string;
    paymentStatus: string;
    depositRequiredAmount: number;
    depositPaidAmount: number;
    outstandingAmount: number;
    branchId: string | null;
    memberId: string | null;
  };
  runtime: {
    depositsEnabled: boolean;
    serviceRequiresDeposit: boolean;
    bookingEligible: boolean;
    reusablePendingPaymentId: string | null;
    stalePendingPaymentId: string | null;
    paidPaymentId: string | null;
    providerConfigured: boolean;
    lastWebhookStatus: string | null;
    lastWebhookAt: string | null;
    managerCanAccessPaymentEntry: boolean;
  };
};

export type BookingDepositLiveSmokeResult = "pass" | "fail" | "partial";

export type BookingDepositLiveSmokeSource = "manual" | "replay" | "live";

export type BookingDepositLiveSmokeStepResults = {
  paymentLinkObtained: boolean;
  callbackReceived: boolean;
  managerDetailVerified: boolean;
  bookingStateVerified: boolean;
  notificationsVerified: boolean;
  reportsVerified: boolean;
};

export type BookingDepositLiveSmokeEvidenceItem = {
  id: string;
  bookingId: string;
  performedAt: string;
  performedByUserId: string | null;
  performedByName: string | null;
  provider: string;
  source: BookingDepositLiveSmokeSource;
  smokeResult: BookingDepositLiveSmokeResult;
  orderId: string | null;
  paymentId: string | null;
  paymentReference: string | null;
  providerReference: string | null;
  callbackStatus: string | null;
  callbackVerificationResult: string | null;
  webhookReceivedAt: string | null;
  bookingPaymentStatusSnapshot: string | null;
  depositRequiredAmount: number;
  depositPaidAmount: number;
  checklistSummary: string;
  smokeSteps: BookingDepositLiveSmokeStepResults;
  notes: string | null;
  compareResultSummary: string | null;
  rawEvidencePayload: unknown;
};

export type BookingDepositLiveSmokeEvidenceInput = {
  source: BookingDepositLiveSmokeSource;
  smokeResult: BookingDepositLiveSmokeResult;
  notes: string;
  compareResultSummary: string;
  rawEvidencePayload: string;
  smokeSteps: BookingDepositLiveSmokeStepResults;
};

export type BookingDetailResponse = {
  booking: BookingDetailItem;
  depositPayment: BookingDepositPaymentItem | null;
  depositOrders: BookingDepositPaymentOrderItem[];
  depositPaymentAttempts: BookingDepositPaymentAttemptItem[];
  depositPaymentWebhooks: BookingDepositPaymentWebhookItem[];
  depositPaymentReadiness: BookingDepositPaymentReadiness | null;
  depositLiveSmokeLatest: BookingDepositLiveSmokeEvidenceItem | null;
  depositLiveSmokeHistory: BookingDepositLiveSmokeEvidenceItem[];
  logs: BookingStatusLogItem[];
  packageLogs: BookingPackageLogItem[];
  notifications: BookingNotificationItem[];
};
