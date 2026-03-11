import type { NotificationConfigIntegrityApiPayload, NotificationPreflightApiPayload } from "./notification-governance-read-ui";
import type { NotificationRuntimeReadinessApiPayload } from "./notification-governance-read-ui";

export type NotificationGovernanceTone = "healthy" | "warning" | "danger" | "neutral";

export type NotificationGovernanceToneStyle = {
  border: string;
  background: string;
  color: string;
};

const TONE_STYLES: Record<NotificationGovernanceTone, NotificationGovernanceToneStyle> = {
  healthy: { border: "1px solid #7bd6b0", background: "#eafbf3", color: "#125843" },
  warning: { border: "1px solid #f0cf85", background: "#fff8e7", color: "#7b5600" },
  danger: { border: "1px solid #efb0b0", background: "#fff1f1", color: "#8b2020" },
  neutral: { border: "1px solid #d7dbe6", background: "#f7f8fc", color: "#4f5d7b" },
};

const BAD_STATUS_KEYS = new Set(["stale", "failed", "error", "critical", "missing", "unhealthy"]);
const WARNING_STATUS_KEYS = new Set(["degraded", "warning", "warn", "partial"]);
const HEALTHY_STATUS_KEYS = new Set(["healthy", "success", "ready", "ok"]);

export function resolveNotificationGovernanceTone(value: string | null | undefined): NotificationGovernanceTone {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "no_runs") return "neutral";
  if (BAD_STATUS_KEYS.has(normalized)) return "danger";
  if (WARNING_STATUS_KEYS.has(normalized)) return "warning";
  if (HEALTHY_STATUS_KEYS.has(normalized)) return "healthy";
  return "neutral";
}

export function getNotificationGovernanceToneStyle(tone: NotificationGovernanceTone) {
  return TONE_STYLES[tone];
}

export function formatStatusLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "unknown";
  return normalized.replace(/_/g, " ");
}

export function truncateDisplayValue(value: string | null | undefined, maxLength = 44) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  if (maxLength <= 7) return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export function toPercent(covered: number, expected: number) {
  if (!expected || expected <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((covered / expected) * 100)));
}

export function buildConfigIntegrityViewModel(payload: NotificationConfigIntegrityApiPayload) {
  const templateCompleteness = toPercent(
    payload.integrity.summary.coveredTemplatePairs,
    payload.integrity.summary.expectedTemplatePairs,
  );
  const preferenceCompleteness = toPercent(
    payload.integrity.summary.configuredRoleEventPairs,
    payload.integrity.summary.expectedRoleEventPairs,
  );
  const tone = resolveNotificationGovernanceTone(payload.integrity.healthStatus);
  const totalMissing =
    payload.integrity.missingItems.missingRoleEventPairs.length +
    payload.integrity.missingItems.missingTemplatePairs.length +
    payload.integrity.missingItems.enabledChannelsWithoutTemplate.length;

  return {
    score: payload.integrity.score,
    healthStatus: payload.integrity.healthStatus,
    tone,
    templateCompleteness,
    preferenceCompleteness,
    totalMissing,
  };
}

export function formatPreflightSkippedReason(input: { code: string; message: string }) {
  return `${formatStatusLabel(input.code)}: ${input.message}`;
}

export function formatPreflightTemplateResolution(input: {
  channel: string;
  found: boolean;
  source: string;
  strategy: string;
  missingReason: string | null;
}) {
  if (!input.found) return `${input.channel} missing (${input.missingReason || "no template"})`;
  return `${input.channel} ${input.source} (${formatStatusLabel(input.strategy)})`;
}

export function buildPreflightViewModel(payload: NotificationPreflightApiPayload) {
  const skippedCount = payload.preflight.deliveryPlanning.skippedReasons.length;
  const warningCount = payload.preflight.warnings.length;
  const coverageTone = resolveNotificationGovernanceTone(payload.preflight.coverage.integrityHealthStatus);
  return {
    skippedCount,
    warningCount,
    coverageTone,
    selectedChannels: Object.entries(payload.preflight.preference.channels)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([channel]) => channel),
  };
}

export function summarizeMetadataObject(input: unknown, maxLength = 160) {
  if (input === null || input === undefined) return "-";
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  if (!raw) return "-";
  return truncateDisplayValue(raw, maxLength);
}

export function formatPreferenceTraceLine(input: {
  source: string;
  enabled: boolean;
  applied: boolean;
  reason: string;
}) {
  return `${input.source} | enabled:${String(input.enabled)} | applied:${String(input.applied)} | ${input.reason}`;
}

export function formatRuntimeTemplateFallbackLine(input: {
  channel: string;
  strategy: string;
  fallbackReason: string | null;
  missingReason: string | null;
}) {
  if (input.fallbackReason) return `${input.channel} -> ${formatStatusLabel(input.strategy)} (${input.fallbackReason})`;
  if (input.missingReason) return `${input.channel} missing (${input.missingReason})`;
  return `${input.channel} tenant locale`;
}

export function formatDeliveryPlanningSkeletonPreview(input: Record<string, unknown>) {
  if (!input || typeof input !== "object") return "-";
  const keys = Object.keys(input);
  if (keys.length === 0) return "-";
  return truncateDisplayValue(keys.join(", "), 120);
}

export function buildRuntimeReadinessViewModel(payload: NotificationRuntimeReadinessApiPayload) {
  const missingCount =
    payload.report.readiness.missingPreferences.length +
    payload.report.readiness.missingTemplates.length +
    payload.report.readiness.unavailableChannels.length;
  const fallbackCount = payload.report.readiness.fallbacks.length;
  const warningCount = payload.report.warnings.length;
  const skippedCount = payload.report.deliveryPlanning.skippedReasons.length;
  const tone: NotificationGovernanceTone = payload.report.readiness.ready
    ? warningCount > 0 || fallbackCount > 0
      ? "warning"
      : "healthy"
    : "danger";

  return {
    tone,
    ready: payload.report.readiness.ready,
    source: payload.source,
    scenarioId: payload.scenarioId,
    missingCount,
    fallbackCount,
    warningCount,
    skippedCount,
    plannedRecipientCount: payload.report.deliveryPlanning.plannedRecipients.length,
    plannedChannelCount: payload.report.deliveryPlanning.plannedChannels.length,
  };
}
