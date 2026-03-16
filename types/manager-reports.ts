export type ManagerReportFilterOption = {
  id: string;
  label: string;
  secondaryLabel?: string | null;
};

export type ManagerReportRange = {
  preset: "today" | "this_week" | "this_month" | "custom";
  dateFrom: string;
  dateTo: string;
};

export type ManagerReportKpiSummary = {
  bookingTotal: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  completionRate: number;
  cancellationRate: number;
  noShowRate: number;
  depositPaidTotal: number;
  outstandingTotal: number;
  singleBookingRevenueTotal: number;
  packageConsumedSessionsCount: number;
  packageReservedSessionsCount: number;
  newCustomerCount: number;
  returningCustomerCount: number;
};

export type ManagerReportTherapistItem = {
  therapistId: string | null;
  therapistName: string;
  bookingCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  completionRate: number;
  singleBookingRevenueTotal: number;
  packageConsumedSessionsCount: number;
};

export type ManagerReportServiceItem = {
  serviceId: string | null;
  serviceName: string;
  bookingCount: number;
  completedCount: number;
  cancelledCount: number;
  averagePrice: number;
  minPrice: number;
  maxPrice: number;
};

export type ManagerReportHotTimeSlotItem = {
  hour: number;
  label: string;
  bookingCount: number;
  completedCount: number;
};

export type ManagerReportPaymentSummary = {
  byStatus: Record<string, number>;
  depositPaidTotal: number;
  outstandingTotal: number;
  singleBookingRevenueTotal: number;
  singleBookingCount: number;
  packageBookingCount: number;
};

export type ManagerReportPackageSummary = {
  activePackageBookingCount: number;
  currentReservedSessionsCount: number;
  currentConsumedSessionsCount: number;
  reserveActionCount: number;
  consumeActionCount: number;
  releaseActionCount: number;
};

export type ManagerReportNotificationSummary = {
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  cancelledCount: number;
  reminderSentCount: number;
  depositPendingQueuedCount: number;
  byEventType: Record<string, number>;
  byStatus: Record<string, number>;
};

export type ManagerReportDetailRow = {
  bookingId: string;
  publicReference: string | null;
  startsAt: string;
  customerName: string;
  customerPhone: string | null;
  branchName: string | null;
  therapistName: string | null;
  serviceName: string;
  status: string;
  paymentMode: string;
  paymentStatus: string;
  finalAmount: number;
  outstandingAmount: number;
  depositPaidAmount: number;
  packageReservedSessions: number;
  packageConsumedSessions: number;
  notificationQueuedCount: number;
  notificationFailedCount: number;
};

export type ManagerReportsResponse = {
  range: ManagerReportRange & { from?: string; to?: string };
  filters: {
    presets: Array<{ value: ManagerReportRange["preset"]; label: string }>;
    branches: ManagerReportFilterOption[];
    therapists: ManagerReportFilterOption[];
    services: ManagerReportFilterOption[];
    statuses: Array<{ value: string; label: string }>;
    paymentModes: Array<{ value: string; label: string }>;
    paymentStatuses: Array<{ value: string; label: string }>;
    notificationStatuses: Array<{ value: string; label: string }>;
    branchLocked: boolean;
    currentBranchId: string | null;
  };
  summary: ManagerReportKpiSummary;
  therapistRanking: ManagerReportTherapistItem[];
  serviceRanking: ManagerReportServiceItem[];
  hotTimeSlots: ManagerReportHotTimeSlotItem[];
  paymentSummary: ManagerReportPaymentSummary;
  packageSummary: ManagerReportPackageSummary;
  notificationSummary: ManagerReportNotificationSummary;
  detailRows: ManagerReportDetailRow[];
  payments: {
    totalPaid: number;
    totalRefunded: number;
    paidCount: number;
    refundedCount: number;
    byMethod: { cash: number; card: number; transfer: number; newebpay: number; manual: number };
  };
  checkins: { allow: number; deny: number };
  bookings: { total: number; byStatus: Record<string, number> };
  handover: {
    openShiftCount: number;
    closedShiftCount: number;
    differenceShiftCount: number;
    unconfirmedCloseCount: number;
    closedTotals: {
      cash: number;
      card: number;
      transfer: number;
      expectedCash: number;
      countedCash: number;
      difference: number;
      cashAdjustmentNet?: number;
    };
  };
  operations: {
    invoiceCount: number;
    redemptionCount: number;
    voidCount: number;
    refundCount: number;
    entryCount: number;
    unreconciledCount?: number;
    unreconciledByEventType?: Record<string, number>;
  };
  opportunities: {
    total: number;
    actionable: number;
    open: number;
    inProgress: number;
    highPriority: number;
    dueSoon: number;
    overdue: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
  };
};
