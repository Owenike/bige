export type NotificationCoverageBucket =
  | "recipient_missing:email"
  | "recipient_missing:line_user_id"
  | "channel_disabled"
  | "provider_unconfigured"
  | "preference_opt_out"
  | "invalid_recipient"
  | "template_missing"
  | "other";

export type NotificationCoverageChannelState = {
  channel: "email" | "line";
  enabled: boolean;
  configured: boolean;
  recipientAvailable: boolean;
  effectiveMode: "provider" | "simulated" | "disabled" | "missing_recipient";
};

export type NotificationCoverageSummary = {
  scopeBranchId: string | null;
  memberCount: number;
  emailReachableCount: number;
  lineReachableCount: number;
  simulatedOnlyCount: number;
  skippedCount: number;
  skippedReasonBreakdown: Array<{
    bucket: NotificationCoverageBucket;
    count: number;
  }>;
  bucketMetrics: Array<{
    bucket: NotificationCoverageBucket;
    affectedMembersCount: number;
    affectedDeliveriesCount: number;
    latestOccurrence: string | null;
    remediableNowCount: number;
    blockedNowCount: number;
  }>;
  branches: Array<{
    id: string;
    name: string;
  }>;
};

export type MemberRecipientCoverageItem = {
  memberId: string;
  fullName: string;
  branchId: string | null;
  branchName: string | null;
  email: string | null;
  phone: string | null;
  lineUserId: string | null;
  emailAvailable: boolean;
  phoneAvailable: boolean;
  lineUserIdAvailable: boolean;
  reachableChannels: Array<"email" | "line">;
  simulatedChannels: Array<"email" | "line">;
  channelStates: NotificationCoverageChannelState[];
  lastIssueBucket: NotificationCoverageBucket | null;
  lastIssueChannel: "email" | "line" | "sms" | "webhook" | "in_app" | "other" | null;
  lastIssueReason: string | null;
  lastIssueStatus: string | null;
  lastIssueAt: string | null;
};

export type NotificationRemediationHintCode =
  | "update_email_then_resend"
  | "resend_now"
  | "review_channel_config"
  | "review_preferences"
  | "identity_required"
  | "wait_retry"
  | "not_actionable";

export type NotificationRemediationItem = {
  deliveryId: string;
  memberId: string | null;
  memberName: string | null;
  branchId: string | null;
  branchName: string | null;
  bookingId: string | null;
  bookingReference: string | null;
  bookingStartsAt: string | null;
  bookingStatus: string | null;
  channel: "email" | "line" | "sms" | "webhook" | "in_app" | "other";
  deliveryStatus: string;
  bucket: NotificationCoverageBucket;
  rawReason: string | null;
  currentRuntime: "provider" | "simulated" | "skipped";
  currentRecipientState: "ok" | "missing" | "invalid" | "unknown";
  currentEmail: string | null;
  currentPhone: string | null;
  currentLineUserId: string | null;
  canResendNow: boolean;
  hintCode: NotificationRemediationHintCode;
  hintLabel: string;
  createdAt: string | null;
};

export type NotificationRemediationSummary = {
  total: number;
  remediableNow: number;
  blockedByConfig: number;
  blockedByPreference: number;
  blockedByIdentity: number;
  blockedOther: number;
};

export type NotificationRemediationActionResultItem = {
  sourceDeliveryId: string;
  childDeliveryId: string | null;
  memberId: string | null;
  memberName: string | null;
  bookingReference: string | null;
  channel: "email" | "line" | "sms" | "webhook" | "in_app" | "other";
  bucket: NotificationCoverageBucket;
  outcome: "succeeded" | "failed" | "skipped" | "blocked";
  reason: string | null;
};

export type NotificationRemediationActionSummary = {
  runId: string;
  actionType: "bulk_resend";
  performedAt: string;
  performedByUserId: string | null;
  performedByName: string | null;
  scope: {
    branchId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    bucket: NotificationCoverageBucket | null;
    search: string | null;
  };
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  blocked: number;
  blockedItems: Array<{
    id: string;
    reason: string;
  }>;
  results: NotificationRemediationActionResultItem[];
};

export type NotificationRemediationHistorySort =
  | "latest"
  | "issues_desc"
  | "requested_desc"
  | "success_rate_asc";

export type NotificationRemediationHistoryOutcomeFilter =
  | "all"
  | "has_failed"
  | "has_blocked"
  | "all_success";

export type NotificationRemediationHistoryListItem = {
  runId: string;
  actionType: "bulk_resend";
  performedAt: string;
  performedByUserId: string | null;
  performedByName: string | null;
  scope: NotificationRemediationActionSummary["scope"];
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  blocked: number;
  resultsCount: number;
  channels: Array<"email" | "line" | "sms" | "webhook" | "in_app" | "other">;
  buckets: NotificationCoverageBucket[];
  problemCount: number;
  successRate: number;
};

export type NotificationRemediationHistoryListMeta = {
  page: number;
  pageSize: number;
  requestedPage: number;
  requestedPageSize: number;
  totalCount: number;
  totalPages: number;
  currentCount: number;
  hasNext: boolean;
  hasPrev: boolean;
  pageOverflowed: boolean;
  maxPageSize: number;
  defaultedDateWindow: boolean;
  effectiveDateFrom: string | null;
  effectiveDateTo: string | null;
};

export type NotificationRemediationHistoryDetail = NotificationRemediationActionSummary;
