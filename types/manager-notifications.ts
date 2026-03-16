export type ManagerNotificationStatus =
  | "pending"
  | "retrying"
  | "sent"
  | "failed"
  | "skipped"
  | "dead_letter"
  | "cancelled";

export type ManagerNotificationChannel = "in_app" | "email" | "line" | "sms" | "webhook" | "other";

export type ManagerNotificationListItem = {
  id: string;
  tenantId: string | null;
  branchId: string | null;
  branchName: string | null;
  bookingId: string | null;
  bookingReference: string | null;
  bookingStartsAt: string | null;
  eventType: string | null;
  templateKey: string | null;
  channel: ManagerNotificationChannel;
  status: ManagerNotificationStatus;
  deliveryMode: "simulated" | "provider";
  provider: string | null;
  providerMessageId: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientEmail: string | null;
  recipientLineUserId: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  failureReason: string | null;
  skippedReason: string | null;
  resendOfDeliveryId: string | null;
  resendCount: number;
  createdAt: string;
};

export type ManagerNotificationSummary = {
  total: number;
  queued: number;
  sent: number;
  failed: number;
  cancelled: number;
  skipped: number;
  retrying: number;
};

export type ManagerNotificationRunItem = {
  id: string;
  jobType: string;
  triggerMode: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  affectedCount: number;
  errorCount: number;
  errorSummary: string | null;
};

export type ManagerNotificationDeliveryEvent = {
  id: string;
  eventType: string;
  eventAt: string;
  provider: string | null;
  providerEventId: string | null;
  providerMessageId: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type ManagerNotificationDetail = {
  delivery: ManagerNotificationListItem;
  payload: Record<string, unknown> | null;
  providerResponse: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  recipientUserId: string | null;
  bookingServiceName: string | null;
  bookingStatus: string | null;
  events: ManagerNotificationDeliveryEvent[];
  resendHistory: ManagerNotificationListItem[];
  parentDelivery: ManagerNotificationListItem | null;
};

export type ManagerNotificationBatchActionResult = {
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  blocked: number;
  blockedItems: Array<{
    id: string;
    reason: string;
  }>;
};

export type ManagerNotificationReadinessCheck = {
  channel: "email" | "line" | "sms" | "webhook";
  eventType: string;
  templateCoverage: Array<{
    eventType: string;
    channel: string;
    found: boolean;
    source: "tenant" | "global" | "none";
  }>;
  sampleRecipient: {
    memberId: string | null;
    bookingId: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    lineUserId: string | null;
  } | null;
  runtime: {
    provider: string | null;
    requestedMode: "simulated" | "provider";
    effectiveMode: "simulated" | "provider";
    channelEnabled: boolean;
    configured: boolean;
    reason: string | null;
    endpointConfigured: boolean;
    tokenConfigured: boolean;
  };
  ready: boolean;
  issues: string[];
};
