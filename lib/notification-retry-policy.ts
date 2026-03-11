import type { DeliveryStatus } from "./notification-ops";

export const RETRY_DECISION_CODES = [
  "RETRYABLE",
  "IN_APP_NOT_RETRYABLE",
  "STATUS_NOT_RETRYABLE",
  "MAX_ATTEMPTS_REACHED",
  "RETRY_NOT_DUE_YET",
  "NON_RETRYABLE_ERROR",
] as const;

export type RetryDecisionCode = (typeof RETRY_DECISION_CODES)[number];

export const RETRY_BLOCKED_REASON_CODES = RETRY_DECISION_CODES.filter((code) => code !== "RETRYABLE");

export type RetryDecision = {
  eligible: boolean;
  code: RetryDecisionCode;
  reason: string;
};

export type RetryCandidateInput = {
  id: string;
  tenant_id: string | null;
  channel: string;
  status: DeliveryStatus;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  next_retry_at: string | null;
  created_at: string;
};

const NON_RETRYABLE_ERROR_CODES = new Set([
  "CHANNEL_NOT_CONFIGURED",
  "RECIPIENT_CONTACT_MISSING",
  "CHANNEL_POLICY_SKIPPED",
  "CHANNEL_NOT_IMPLEMENTED",
]);

function shouldRetryableStatus(status: DeliveryStatus) {
  return status === "failed" || status === "retrying";
}

export function evaluateRetryDecision(row: RetryCandidateInput, now = Date.now()): RetryDecision {
  if (row.channel === "in_app") {
    return {
      eligible: false,
      code: "IN_APP_NOT_RETRYABLE",
      reason: "in_app deliveries are already sent and not retryable",
    };
  }
  if (!shouldRetryableStatus(row.status)) {
    return {
      eligible: false,
      code: "STATUS_NOT_RETRYABLE",
      reason: `status ${row.status} is not retryable`,
    };
  }
  if ((row.attempts || 0) >= (row.max_attempts || 0)) {
    return {
      eligible: false,
      code: "MAX_ATTEMPTS_REACHED",
      reason: `attempts ${row.attempts} reached max_attempts ${row.max_attempts}`,
    };
  }
  if (row.status === "retrying" && row.next_retry_at) {
    const retryAt = new Date(row.next_retry_at).getTime();
    if (Number.isFinite(retryAt) && retryAt > now) {
      return {
        eligible: false,
        code: "RETRY_NOT_DUE_YET",
        reason: `next_retry_at ${row.next_retry_at} is still in the future`,
      };
    }
  }
  if (row.error_code && NON_RETRYABLE_ERROR_CODES.has(row.error_code)) {
    return {
      eligible: false,
      code: "NON_RETRYABLE_ERROR",
      reason: `error_code ${row.error_code} is marked non-retryable`,
    };
  }
  return {
    eligible: true,
    code: "RETRYABLE",
    reason: "eligible for retry",
  };
}
