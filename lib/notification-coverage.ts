import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileContext } from "./auth-context";
import { getExternalProviderConfig, type ExternalProviderConfigSnapshot } from "./notification-delivery-adapter";
import { resolveJobSettings } from "./job-settings-resolver";
import type {
  MemberRecipientCoverageItem,
  NotificationCoverageBucket,
  NotificationCoverageChannelState,
  NotificationRemediationHistoryDetail,
  NotificationRemediationHistoryListItem,
  NotificationRemediationHistoryListMeta,
  NotificationRemediationHistoryOutcomeFilter,
  NotificationRemediationHistorySort,
  NotificationRemediationItem,
  NotificationRemediationActionSummary,
  NotificationRemediationSummary,
  NotificationCoverageSummary,
} from "../types/notification-coverage";

type SupportedCoverageChannel = "email" | "line";

type CoverageIssueRow = {
  id?: string;
  member_id: string | null;
  channel: string | null;
  status: string | null;
  skipped_reason: string | null;
  failure_reason: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string | null;
};

type RemediationDeliveryRow = {
  id: string;
  member_id: string | null;
  branch_id: string | null;
  channel: "email" | "line" | "sms" | "webhook" | "in_app" | "other";
  status: string | null;
  skipped_reason: string | null;
  failure_reason: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  payload: Record<string, unknown> | null;
  bookings:
    | {
        id: string | null;
        public_reference: string | null;
        starts_at: string | null;
        status: string | null;
      }
    | Array<{
        id: string | null;
        public_reference: string | null;
        starts_at: string | null;
        status: string | null;
      }>
    | null;
  branches:
    | {
        name: string | null;
      }
    | Array<{
        name: string | null;
      }>
    | null;
};

type CoverageMemberRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  store_id: string | null;
};

type CoverageBranchRow = {
  id: string;
  name: string;
};

type RemediationAuditLogRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | null;
};

type ProfileNameRow = {
  id: string;
  full_name: string | null;
};

type BranchRuntime = {
  email: ExternalProviderConfigSnapshot & { enabled: boolean };
  line: ExternalProviderConfigSnapshot & { enabled: boolean };
};

const REMEDIATION_HISTORY_DEFAULT_WINDOW_DAYS = 31;
const REMEDIATION_HISTORY_MAX_WINDOW_DAYS = 93;
const REMEDIATION_HISTORY_DEFAULT_PAGE_SIZE = 20;
const REMEDIATION_HISTORY_MAX_PAGE_SIZE = 50;

function normalizeBranchId(context: ProfileContext, requestedBranchId: string | null | undefined) {
  if (context.branchId) return context.branchId;
  return requestedBranchId || null;
}

function validEmail(value: string | null | undefined) {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validPhone(value: string | null | undefined) {
  if (!value) return false;
  return value.replace(/\D/g, "").length >= 8;
}

function lowerText(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function startOfDayIso(value: string | null | undefined) {
  if (!value) return null;
  return `${value}T00:00:00.000Z`;
}

function endOfDayIso(value: string | null | undefined) {
  if (!value) return null;
  return `${value}T23:59:59.999Z`;
}

function formatDateOnly(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clampPositiveInteger(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.floor(value);
}

function diffDaysInclusive(dateFrom: string, dateTo: string) {
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function resolveRemediationHistoryDateWindow(params: {
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  const today = new Date();
  const fallbackTo = formatDateOnly(today);
  const fallbackFrom = formatDateOnly(addUtcDays(today, -(REMEDIATION_HISTORY_DEFAULT_WINDOW_DAYS - 1)));
  const effectiveDateFrom = params.dateFrom || fallbackFrom;
  const effectiveDateTo = params.dateTo || fallbackTo;
  const defaultedDateWindow = !params.dateFrom || !params.dateTo;
  const diffDays = diffDaysInclusive(effectiveDateFrom, effectiveDateTo);
  if (diffDays < 1) {
    return {
      ok: false as const,
      error: "History date range is invalid.",
    };
  }
  if (diffDays > REMEDIATION_HISTORY_MAX_WINDOW_DAYS) {
    return {
      ok: false as const,
      error: `History date range cannot exceed ${REMEDIATION_HISTORY_MAX_WINDOW_DAYS} days while remediation history runs on audit logs.`,
    };
  }
  return {
    ok: true as const,
    effectiveDateFrom,
    effectiveDateTo,
    defaultedDateWindow,
  };
}

function isCoverageBucket(value: unknown): value is NotificationCoverageBucket {
  return value === "recipient_missing:email" ||
    value === "recipient_missing:line_user_id" ||
    value === "channel_disabled" ||
    value === "provider_unconfigured" ||
    value === "preference_opt_out" ||
    value === "invalid_recipient" ||
    value === "template_missing" ||
    value === "other";
}

function coerceRemediationResultItem(value: unknown): NotificationRemediationActionSummary["results"][number] | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const outcome = row.outcome;
  if (outcome !== "succeeded" && outcome !== "failed" && outcome !== "skipped" && outcome !== "blocked") {
    return null;
  }
  const bucket = isCoverageBucket(row.bucket) ? row.bucket : "other";
  const channel =
    row.channel === "email" ||
    row.channel === "line" ||
    row.channel === "sms" ||
    row.channel === "webhook" ||
    row.channel === "in_app" ||
    row.channel === "other"
      ? row.channel
      : "other";
  return {
    sourceDeliveryId: typeof row.sourceDeliveryId === "string" ? row.sourceDeliveryId : "",
    childDeliveryId: typeof row.childDeliveryId === "string" ? row.childDeliveryId : null,
    memberId: typeof row.memberId === "string" ? row.memberId : null,
    memberName: typeof row.memberName === "string" ? row.memberName : null,
    bookingReference: typeof row.bookingReference === "string" ? row.bookingReference : null,
    channel,
    bucket,
    outcome,
    reason: typeof row.reason === "string" ? row.reason : null,
  };
}

function coerceBlockedItems(value: unknown): NotificationRemediationActionSummary["blockedItems"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.reason !== "string") return null;
      return { id: row.id, reason: row.reason };
    })
    .filter((item): item is { id: string; reason: string } => Boolean(item));
}

function parsePersistedRemediationSummary(params: {
  row: RemediationAuditLogRow;
  actorNameById?: Map<string, string | null>;
}): NotificationRemediationActionSummary | null {
  const payload = params.row.payload || null;
  if (!payload || typeof payload !== "object") return null;
  const scope = typeof payload.scope === "object" && payload.scope ? (payload.scope as Record<string, unknown>) : {};
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const results = rawResults
    .map((item) => coerceRemediationResultItem(item))
    .filter((item): item is NotificationRemediationActionSummary["results"][number] => Boolean(item));
  const runId =
    typeof payload.runId === "string"
      ? payload.runId
      : typeof params.row.target_id === "string" && params.row.target_id.length > 0
        ? params.row.target_id
        : params.row.id;
  return {
    runId,
    actionType: "bulk_resend",
    performedAt:
      typeof payload.performedAt === "string"
        ? payload.performedAt
        : params.row.created_at || new Date().toISOString(),
    performedByUserId:
      typeof payload.performedByUserId === "string"
        ? payload.performedByUserId
        : params.row.actor_id,
    performedByName:
      typeof payload.performedByName === "string"
        ? payload.performedByName
        : (params.row.actor_id ? params.actorNameById?.get(params.row.actor_id) || null : null),
    scope: {
      branchId: typeof scope.branchId === "string" ? scope.branchId : null,
      dateFrom: typeof scope.dateFrom === "string" ? scope.dateFrom : null,
      dateTo: typeof scope.dateTo === "string" ? scope.dateTo : null,
      bucket: isCoverageBucket(scope.bucket) ? scope.bucket : null,
      search: typeof scope.search === "string" ? scope.search : null,
    },
    requested: Number(payload.requested || 0),
    succeeded: Number(payload.succeeded || 0),
    failed: Number(payload.failed || 0),
    skipped: Number(payload.skipped || 0),
    blocked: Number(payload.blocked || 0),
    blockedItems: coerceBlockedItems(payload.blockedItems),
    results,
  };
}

function toHistoryListItem(row: NotificationRemediationActionSummary): NotificationRemediationHistoryListItem {
  const channels = Array.from(new Set(row.results.map((item) => item.channel)));
  const buckets = Array.from(new Set(row.results.map((item) => item.bucket)));
  const problemCount = row.failed + row.blocked;
  const successRate = row.requested > 0 ? row.succeeded / row.requested : 0;
  return {
    runId: row.runId,
    actionType: row.actionType,
    performedAt: row.performedAt,
    performedByUserId: row.performedByUserId,
    performedByName: row.performedByName,
    scope: row.scope,
    requested: row.requested,
    succeeded: row.succeeded,
    failed: row.failed,
    skipped: row.skipped,
    blocked: row.blocked,
    resultsCount: row.results.length,
    channels,
    buckets,
    problemCount,
    successRate,
  };
}

function sortHistoryItems(items: NotificationRemediationHistoryListItem[], sort: NotificationRemediationHistorySort) {
  return [...items].sort((a, b) => {
    if (sort === "issues_desc") {
      const problemDelta = b.problemCount - a.problemCount;
      if (problemDelta !== 0) return problemDelta;
    }
    if (sort === "requested_desc") {
      const requestedDelta = b.requested - a.requested;
      if (requestedDelta !== 0) return requestedDelta;
    }
    if (sort === "success_rate_asc") {
      const successDelta = a.successRate - b.successRate;
      if (successDelta !== 0) return successDelta;
    }
    const latestDelta = b.performedAt.localeCompare(a.performedAt);
    if (latestDelta !== 0) return latestDelta;
    const problemDelta = b.problemCount - a.problemCount;
    if (problemDelta !== 0) return problemDelta;
    const requestedDelta = b.requested - a.requested;
    if (requestedDelta !== 0) return requestedDelta;
    return a.runId.localeCompare(b.runId, "en");
  });
}

function paginateHistoryItems(params: {
  items: NotificationRemediationHistoryListItem[];
  page?: number | null;
  pageSize?: number | null;
  effectiveDateFrom: string | null;
  effectiveDateTo: string | null;
  defaultedDateWindow: boolean;
}): {
  items: NotificationRemediationHistoryListItem[];
  meta: NotificationRemediationHistoryListMeta;
} {
  const requestedPage = clampPositiveInteger(params.page, 1);
  const requestedPageSize = clampPositiveInteger(params.pageSize, REMEDIATION_HISTORY_DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(requestedPageSize, REMEDIATION_HISTORY_MAX_PAGE_SIZE);
  const totalCount = params.items.length;
  const totalPages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
  const pageOverflowed = requestedPage > totalPages;
  const page = totalCount > 0 ? Math.min(requestedPage, totalPages) : 1;
  const startIndex = totalCount > 0 ? (page - 1) * pageSize : 0;
  const items = params.items.slice(startIndex, startIndex + pageSize);

  return {
    items,
    meta: {
      page,
      pageSize,
      requestedPage,
      requestedPageSize,
      totalCount,
      totalPages,
      currentCount: items.length,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      pageOverflowed,
      maxPageSize: REMEDIATION_HISTORY_MAX_PAGE_SIZE,
      defaultedDateWindow: params.defaultedDateWindow,
      effectiveDateFrom: params.effectiveDateFrom,
      effectiveDateTo: params.effectiveDateTo,
    },
  };
}

async function loadActorNames(params: {
  supabase: SupabaseClient;
  actorIds: string[];
}) {
  const map = new Map<string, string | null>();
  if (params.actorIds.length === 0) return map;
  const result = await params.supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", params.actorIds);
  if (result.error) throw new Error(result.error.message);
  for (const row of (result.data || []) as ProfileNameRow[]) {
    map.set(row.id, row.full_name || null);
  }
  return map;
}

export function normalizeNotificationCoverageBucket(params: {
  skippedReason?: string | null;
  failureReason?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): NotificationCoverageBucket {
  const skippedReason = params.skippedReason?.trim().toLowerCase() || "";
  const combined = lowerText([params.skippedReason, params.failureReason, params.errorCode, params.errorMessage]);

  if (skippedReason === "recipient_missing:email" || combined.includes("recipient_missing:email")) {
    return "recipient_missing:email";
  }
  if (skippedReason === "recipient_missing:line_user_id" || combined.includes("recipient_missing:line_user_id")) {
    return "recipient_missing:line_user_id";
  }
  if (combined.includes("channel_disabled")) {
    return "channel_disabled";
  }
  if (combined.includes("provider_not_configured") || combined.includes("channel_not_configured")) {
    return "provider_unconfigured";
  }
  if (combined.includes("preference_opt_out") || combined.includes("opt_out") || combined.includes("explicitly_disabled")) {
    return "preference_opt_out";
  }
  if (
    combined.includes("invalid_recipient") ||
    combined.includes("recipient_invalid") ||
    combined.includes("line_recipient_invalid") ||
    combined.includes("not a friend") ||
    combined.includes("invalid user") ||
    combined.includes("user id")
  ) {
    return "invalid_recipient";
  }
  if (combined.includes("template_missing")) {
    return "template_missing";
  }
  return "other";
}

async function loadBranchRuntime(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
}) {
  const resolved = await resolveJobSettings({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
  });
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const channelMap = new Map(resolved.data.deliveryChannels.map((item) => [item.channel, item]));
  return {
    email: {
      ...getExternalProviderConfig("email"),
      enabled: channelMap.get("email")?.isEnabled ?? false,
    },
    line: {
      ...getExternalProviderConfig("line"),
      enabled: channelMap.get("line")?.isEnabled ?? false,
    },
  } satisfies BranchRuntime;
}

function buildChannelState(params: {
  channel: SupportedCoverageChannel;
  runtime: BranchRuntime[SupportedCoverageChannel];
  recipientAvailable: boolean;
}): NotificationCoverageChannelState {
  if (!params.runtime.enabled) {
    return {
      channel: params.channel,
      enabled: false,
      configured: params.runtime.endpointConfigured && params.runtime.tokenConfigured,
      recipientAvailable: params.recipientAvailable,
      effectiveMode: "disabled",
    };
  }

  if (!params.recipientAvailable) {
    return {
      channel: params.channel,
      enabled: true,
      configured: params.runtime.endpointConfigured && params.runtime.tokenConfigured,
      recipientAvailable: false,
      effectiveMode: "missing_recipient",
    };
  }

  return {
    channel: params.channel,
    enabled: true,
    configured: params.runtime.endpointConfigured && params.runtime.tokenConfigured,
    recipientAvailable: true,
    effectiveMode: params.runtime.endpointConfigured && params.runtime.tokenConfigured ? "provider" : "simulated",
  };
}

async function loadScopedBranches(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
}) {
  let query = params.supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", params.tenantId)
    .order("name", { ascending: true });
  if (params.branchId) query = query.eq("id", params.branchId);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return (result.data || []) as CoverageBranchRow[];
}

async function loadScopedMembers(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  search?: string | null;
  limit?: number | null;
  memberIds?: string[] | null;
}) {
  if (params.memberIds && params.memberIds.length === 0) {
    return [] as CoverageMemberRow[];
  }
  let query = params.supabase
    .from("members")
    .select("id, full_name, email, phone, store_id")
    .eq("tenant_id", params.tenantId)
    .order("updated_at", { ascending: false });
  if (params.branchId) query = query.eq("store_id", params.branchId);
  if (params.memberIds && params.memberIds.length > 0) query = query.in("id", params.memberIds);
  if (params.search?.trim()) {
    const q = params.search.trim();
    query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  }
  if (typeof params.limit === "number" && params.limit > 0) query = query.limit(params.limit);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return (result.data || []) as CoverageMemberRow[];
}

async function loadLineIdentityMap(params: {
  supabase: SupabaseClient;
  tenantId: string;
  memberIds: string[];
}) {
  const map = new Map<string, string | null>();
  if (params.memberIds.length === 0) return map;
  const result = await params.supabase
    .from("member_identities")
    .select("member_id, value")
    .eq("tenant_id", params.tenantId)
    .eq("type", "line_user_id")
    .in("member_id", params.memberIds);
  if (result.error) throw new Error(result.error.message);
  for (const row of (result.data || []) as Array<{ member_id: string | null; value: string | null }>) {
    if (!row.member_id || map.has(row.member_id)) continue;
    map.set(row.member_id, row.value || null);
  }
  return map;
}

async function loadRecentIssueRows(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  memberIds?: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  if (params.memberIds && params.memberIds.length === 0) {
    return [] as CoverageIssueRow[];
  }
  let query = params.supabase
    .from("notification_deliveries")
    .select("member_id, channel, status, skipped_reason, failure_reason, error_code, error_message, created_at")
    .eq("tenant_id", params.tenantId)
    .in("status", ["skipped", "failed", "dead_letter"]);
  if (params.branchId) query = query.eq("branch_id", params.branchId);
  if (params.memberIds && params.memberIds.length > 0) query = query.in("member_id", params.memberIds);
  if (params.dateFrom) query = query.gte("created_at", startOfDayIso(params.dateFrom));
  if (params.dateTo) query = query.lte("created_at", endOfDayIso(params.dateTo));
  query = query.order("created_at", { ascending: false }).limit(params.memberIds ? 5000 : 2000);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return (result.data || []) as CoverageIssueRow[];
}

function summarizeMembers(params: {
  members: CoverageMemberRow[];
  branches: CoverageBranchRow[];
  lineIdentityByMemberId: Map<string, string | null>;
  runtimeByBranchId: Map<string | null, BranchRuntime>;
  issueRows: CoverageIssueRow[];
  remediableMemberIds?: Set<string>;
}) {
  const branchNameById = new Map(params.branches.map((branch) => [branch.id, branch.name]));
  const lastIssueByMemberId = new Map<string, CoverageIssueRow>();
  for (const row of params.issueRows) {
    if (!row.member_id || lastIssueByMemberId.has(row.member_id)) continue;
    lastIssueByMemberId.set(row.member_id, row);
  }

  const items: MemberRecipientCoverageItem[] = params.members.map((member) => {
    const branchId = member.store_id || null;
    const runtime = params.runtimeByBranchId.get(branchId) || params.runtimeByBranchId.get(null);
    if (!runtime) throw new Error("Missing runtime snapshot for branch coverage");

    const emailAvailable = validEmail(member.email);
    const phoneAvailable = validPhone(member.phone);
    const lineUserId = params.lineIdentityByMemberId.get(member.id) || null;
    const lineUserIdAvailable = typeof lineUserId === "string" && lineUserId.trim().length > 0;

    const emailState = buildChannelState({
      channel: "email",
      runtime: runtime.email,
      recipientAvailable: emailAvailable,
    });
    const lineState = buildChannelState({
      channel: "line",
      runtime: runtime.line,
      recipientAvailable: lineUserIdAvailable,
    });

    const lastIssue = lastIssueByMemberId.get(member.id) || null;
    return {
      memberId: member.id,
      fullName: member.full_name,
      branchId,
      branchName: branchId ? branchNameById.get(branchId) || null : null,
      email: member.email,
      phone: member.phone,
      lineUserId,
      emailAvailable,
      phoneAvailable,
      lineUserIdAvailable,
      reachableChannels: [emailState, lineState]
        .filter((state) => state.effectiveMode === "provider")
        .map((state) => state.channel),
      simulatedChannels: [emailState, lineState]
        .filter((state) => state.effectiveMode === "simulated")
        .map((state) => state.channel),
      channelStates: [emailState, lineState],
      lastIssueBucket: lastIssue
        ? normalizeNotificationCoverageBucket({
            skippedReason: lastIssue.skipped_reason,
            failureReason: lastIssue.failure_reason,
            errorCode: lastIssue.error_code,
            errorMessage: lastIssue.error_message,
          })
        : null,
      lastIssueChannel:
        lastIssue?.channel === "email" ||
        lastIssue?.channel === "line" ||
        lastIssue?.channel === "sms" ||
        lastIssue?.channel === "webhook" ||
        lastIssue?.channel === "in_app" ||
        lastIssue?.channel === "other"
          ? lastIssue.channel
          : null,
      lastIssueReason: lastIssue?.skipped_reason || lastIssue?.failure_reason || lastIssue?.error_message || null,
      lastIssueStatus: lastIssue?.status || null,
      lastIssueAt: lastIssue?.created_at || null,
    };
  });

  return items.sort((a, b) => {
    const actionableDelta =
      Number(params.remediableMemberIds?.has(b.memberId) || false) - Number(params.remediableMemberIds?.has(a.memberId) || false);
    if (actionableDelta !== 0) return actionableDelta;
    const timeDelta = (b.lastIssueAt || "").localeCompare(a.lastIssueAt || "");
    if (timeDelta !== 0) return timeDelta;
    const nameDelta = a.fullName.localeCompare(b.fullName, "en");
    if (nameDelta !== 0) return nameDelta;
    return a.memberId.localeCompare(b.memberId, "en");
  });
}

function pickBookingRow(bookings: RemediationDeliveryRow["bookings"]) {
  if (!bookings) return null;
  return Array.isArray(bookings) ? bookings[0] || null : bookings;
}

function pickBranchRow(branches: RemediationDeliveryRow["branches"]) {
  if (!branches) return null;
  return Array.isArray(branches) ? branches[0] || null : branches;
}

function buildBucketMetrics(items: NotificationRemediationItem[]) {
  const order: NotificationCoverageBucket[] = [
    "recipient_missing:email",
    "recipient_missing:line_user_id",
    "channel_disabled",
    "provider_unconfigured",
    "preference_opt_out",
    "invalid_recipient",
    "template_missing",
    "other",
  ];
  const metrics = new Map<
    NotificationCoverageBucket,
    {
      bucket: NotificationCoverageBucket;
      members: Set<string>;
      affectedDeliveriesCount: number;
      latestOccurrence: string | null;
      remediableNowCount: number;
      blockedNowCount: number;
    }
  >();

  for (const bucket of order) {
    metrics.set(bucket, {
      bucket,
      members: new Set<string>(),
      affectedDeliveriesCount: 0,
      latestOccurrence: null,
      remediableNowCount: 0,
      blockedNowCount: 0,
    });
  }

  for (const item of items) {
    const entry = metrics.get(item.bucket);
    if (!entry) continue;
    if (item.memberId) entry.members.add(item.memberId);
    entry.affectedDeliveriesCount += 1;
    if (!entry.latestOccurrence || (item.createdAt && item.createdAt > entry.latestOccurrence)) {
      entry.latestOccurrence = item.createdAt;
    }
    if (item.canResendNow) entry.remediableNowCount += 1;
    else entry.blockedNowCount += 1;
  }

  return order
    .map((bucket) => {
    const entry = metrics.get(bucket)!;
    return {
      bucket,
      affectedMembersCount: entry.members.size,
      affectedDeliveriesCount: entry.affectedDeliveriesCount,
      latestOccurrence: entry.latestOccurrence,
      remediableNowCount: entry.remediableNowCount,
      blockedNowCount: entry.blockedNowCount,
    };
    })
    .sort((a, b) => {
      const remediableDelta = b.remediableNowCount - a.remediableNowCount;
      if (remediableDelta !== 0) return remediableDelta;
      const affectedDelta = b.affectedDeliveriesCount - a.affectedDeliveriesCount;
      if (affectedDelta !== 0) return affectedDelta;
      const latestDelta = (b.latestOccurrence || "").localeCompare(a.latestOccurrence || "");
      if (latestDelta !== 0) return latestDelta;
      return a.bucket.localeCompare(b.bucket, "en");
    });
}

function deriveRemediation(params: {
  bucket: NotificationCoverageBucket;
  channel: RemediationDeliveryRow["channel"];
  deliveryStatus: string | null;
  email: string | null;
  phone: string | null;
  lineUserId: string | null;
  runtime: BranchRuntime[SupportedCoverageChannel] | null;
}): Pick<NotificationRemediationItem, "currentRuntime" | "currentRecipientState" | "canResendNow" | "hintCode" | "hintLabel"> {
  const emailAvailable = validEmail(params.email);
  const lineAvailable = typeof params.lineUserId === "string" && params.lineUserId.trim().length > 0;
  const configured = params.runtime ? params.runtime.endpointConfigured && params.runtime.tokenConfigured : false;
  const enabled = params.runtime ? params.runtime.enabled : false;
  const resendableStatus =
    params.deliveryStatus === "failed" ||
    params.deliveryStatus === "dead_letter" ||
    params.deliveryStatus === "skipped" ||
    params.deliveryStatus === "cancelled";

  if (params.bucket === "provider_unconfigured") {
    return {
      currentRuntime: "simulated",
      currentRecipientState: "unknown",
      canResendNow: false,
      hintCode: "review_channel_config",
      hintLabel: "Provider is not configured. Review channel settings before retrying.",
    };
  }

  if (params.bucket === "channel_disabled") {
    return {
      currentRuntime: "skipped",
      currentRecipientState: "unknown",
      canResendNow: false,
      hintCode: "review_channel_config",
      hintLabel: "This channel is disabled for the current tenant or branch scope.",
    };
  }

  if (params.bucket === "preference_opt_out") {
    return {
      currentRuntime: "skipped",
      currentRecipientState: "ok",
      canResendNow: false,
      hintCode: "review_preferences",
      hintLabel: "Recipient preferences currently block this notification.",
    };
  }

  if (params.bucket === "recipient_missing:email") {
    return {
      currentRuntime: emailAvailable ? (configured && enabled ? "provider" : "simulated") : "skipped",
      currentRecipientState: emailAvailable ? "ok" : "missing",
      canResendNow: emailAvailable && configured && enabled && resendableStatus,
      hintCode: emailAvailable ? "resend_now" : "update_email_then_resend",
      hintLabel: emailAvailable
        ? "Email is available now. A resend can create a new child delivery."
        : "Add a valid email first, then resend the delivery.",
    };
  }

  if (params.bucket === "recipient_missing:line_user_id") {
    return {
      currentRuntime: lineAvailable ? (configured && enabled ? "provider" : "simulated") : "skipped",
      currentRecipientState: lineAvailable ? "ok" : "missing",
      canResendNow: false,
      hintCode: "identity_required",
      hintLabel: "A LINE identity is required. This queue does not support manual line_user_id entry.",
    };
  }

  if (params.bucket === "invalid_recipient") {
    if (params.channel === "email") {
      return {
        currentRuntime: emailAvailable ? (configured && enabled ? "provider" : "simulated") : "skipped",
        currentRecipientState: emailAvailable ? "ok" : "invalid",
        canResendNow: emailAvailable && configured && enabled && resendableStatus,
        hintCode: emailAvailable ? "resend_now" : "update_email_then_resend",
        hintLabel: emailAvailable
          ? "The email now passes validation. You can resend this delivery."
          : "Fix the invalid email on the member profile before resending.",
      };
    }

    if (params.channel === "line") {
      return {
        currentRuntime: lineAvailable ? (configured && enabled ? "provider" : "simulated") : "skipped",
        currentRecipientState: lineAvailable ? "invalid" : "missing",
        canResendNow: false,
        hintCode: "identity_required",
        hintLabel: "The LINE recipient is invalid. Review identity coverage before retrying.",
      };
    }
  }

  if (params.deliveryStatus === "retrying") {
    return {
      currentRuntime: configured && enabled ? "provider" : "simulated",
      currentRecipientState: "ok",
      canResendNow: false,
      hintCode: "wait_retry",
      hintLabel: "This delivery is already retrying. Wait for the existing retry policy to finish.",
    };
  }

  return {
    currentRuntime: configured && enabled ? "provider" : "simulated",
    currentRecipientState:
      params.channel === "email"
        ? emailAvailable
          ? "ok"
          : "unknown"
        : params.channel === "line"
          ? lineAvailable
            ? "ok"
            : "unknown"
          : validPhone(params.phone)
            ? "ok"
            : "unknown",
    canResendNow: configured && enabled && resendableStatus,
    hintCode: configured && enabled ? "resend_now" : "review_channel_config",
    hintLabel: configured && enabled ? "Conditions look healthy enough to resend now." : "Review runtime configuration before retrying.",
  };
}

export async function getManagerNotificationCoverageSummary(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  branchId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  bucket?: NotificationCoverageBucket | null;
}) {
  if (!params.context.tenantId) {
    return { ok: false as const, error: "Missing tenant scope" };
  }

  try {
    const scopeBranchId = normalizeBranchId(params.context, params.branchId);
    const [branches, members, issueRows] = await Promise.all([
      loadScopedBranches({
        supabase: params.supabase,
        tenantId: params.context.tenantId,
        branchId: scopeBranchId,
      }),
      loadScopedMembers({
        supabase: params.supabase,
        tenantId: params.context.tenantId,
        branchId: scopeBranchId,
      }),
      loadRecentIssueRows({
        supabase: params.supabase,
        tenantId: params.context.tenantId,
        branchId: scopeBranchId,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
      }),
    ]);

    const filteredIssueRows = params.bucket
      ? issueRows.filter(
          (row) =>
            normalizeNotificationCoverageBucket({
              skippedReason: row.skipped_reason,
              failureReason: row.failure_reason,
              errorCode: row.error_code,
              errorMessage: row.error_message,
            }) === params.bucket,
        )
      : issueRows;
    const filteredMemberIds = Array.from(
      new Set(filteredIssueRows.map((row) => row.member_id).filter((value): value is string => Boolean(value))),
    );
    const scopedMembers = params.bucket || params.dateFrom || params.dateTo
      ? members.filter((member) => filteredMemberIds.includes(member.id))
      : members;

    const memberIds = scopedMembers.map((member) => member.id);
    const lineIdentityByMemberId = await loadLineIdentityMap({
      supabase: params.supabase,
      tenantId: params.context.tenantId,
      memberIds,
    });

    const runtimeByBranchId = new Map<string | null, BranchRuntime>();
    const branchIds = Array.from(new Set(scopedMembers.map((member) => member.store_id || null)));
    if (branchIds.length === 0) branchIds.push(scopeBranchId);
    for (const branchId of branchIds) {
      runtimeByBranchId.set(
        branchId,
        await loadBranchRuntime({
          supabase: params.supabase,
          tenantId: params.context.tenantId,
          branchId,
        }),
      );
    }

    const remediation = await listManagerNotificationRemediationQueue({
      supabase: params.supabase,
      context: params.context,
      branchId: scopeBranchId,
      bucket: params.bucket,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      limit: 1000,
    });
    if (!remediation.ok) {
      throw new Error(remediation.error);
    }
    const remediableMemberIds = new Set(
      remediation.items.filter((item) => item.canResendNow && item.memberId).map((item) => item.memberId as string),
    );
    const coverageItems = summarizeMembers({
      members: scopedMembers,
      branches,
      lineIdentityByMemberId,
      runtimeByBranchId,
      issueRows: filteredIssueRows,
      remediableMemberIds,
    });

    const skippedReasonCounts = new Map<NotificationCoverageBucket, number>();
    for (const row of filteredIssueRows.filter((item) => item.status === "skipped")) {
      const bucket = normalizeNotificationCoverageBucket({
        skippedReason: row.skipped_reason,
        failureReason: row.failure_reason,
        errorCode: row.error_code,
        errorMessage: row.error_message,
      });
      skippedReasonCounts.set(bucket, (skippedReasonCounts.get(bucket) || 0) + 1);
    }
    const bucketMetrics = buildBucketMetrics(remediation.items);
    const bucketOrder = new Map(bucketMetrics.map((item, index) => [item.bucket, index]));

    const summary: NotificationCoverageSummary = {
      scopeBranchId,
      memberCount: coverageItems.length,
      emailReachableCount: coverageItems.filter((item) => item.reachableChannels.includes("email")).length,
      lineReachableCount: coverageItems.filter((item) => item.reachableChannels.includes("line")).length,
      simulatedOnlyCount: coverageItems.filter(
        (item) => item.simulatedChannels.length > 0 && item.reachableChannels.length === 0,
      ).length,
      skippedCount: filteredIssueRows.filter((item) => item.status === "skipped").length,
      skippedReasonBreakdown: Array.from(skippedReasonCounts.entries())
        .map(([bucket, count]) => ({ bucket, count }))
        .sort((a, b) => (bucketOrder.get(a.bucket) ?? 999) - (bucketOrder.get(b.bucket) ?? 999)),
      bucketMetrics,
      branches: branches.map((branch) => ({
        id: branch.id,
        name: branch.name,
      })),
    };

    return {
      ok: true as const,
      summary,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Load notification coverage summary failed",
    };
  }
}

export async function listManagerMemberRecipientCoverage(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  branchId?: string | null;
  bucket?: NotificationCoverageBucket | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  search?: string | null;
  limit?: number | null;
}) {
  if (!params.context.tenantId) {
    return { ok: false as const, error: "Missing tenant scope" };
  }

  try {
    const scopeBranchId = normalizeBranchId(params.context, params.branchId);
    const remediationScope =
      params.bucket || params.dateFrom || params.dateTo
        ? await listManagerNotificationRemediationQueue({
            supabase: params.supabase,
            context: params.context,
            branchId: scopeBranchId,
            bucket: params.bucket,
            search: params.search,
            dateFrom: params.dateFrom,
            dateTo: params.dateTo,
            limit: 1000,
          })
        : null;
    if (remediationScope && !remediationScope.ok) {
      throw new Error(remediationScope.error);
    }

    const scopedMemberIds = remediationScope
      ? Array.from(new Set(remediationScope.items.map((item) => item.memberId).filter((value): value is string => Boolean(value))))
      : null;
    const [branches, members] = await Promise.all([
      loadScopedBranches({
        supabase: params.supabase,
        tenantId: params.context.tenantId,
        branchId: scopeBranchId,
      }),
      loadScopedMembers({
        supabase: params.supabase,
        tenantId: params.context.tenantId,
        branchId: scopeBranchId,
        search: params.search,
        memberIds: scopedMemberIds,
        limit: params.limit || 150,
      }),
    ]);

    const memberIds = members.map((member) => member.id);
    const [lineIdentityByMemberId, issueRows] = await Promise.all([
      loadLineIdentityMap({
        supabase: params.supabase,
        tenantId: params.context.tenantId,
        memberIds,
      }),
      loadRecentIssueRows({
        supabase: params.supabase,
        tenantId: params.context.tenantId,
        branchId: scopeBranchId,
        memberIds,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
      }),
    ]);

    const runtimeByBranchId = new Map<string | null, BranchRuntime>();
    const branchIds = Array.from(new Set(members.map((member) => member.store_id || null)));
    if (branchIds.length === 0) branchIds.push(scopeBranchId);
    for (const branchId of branchIds) {
      runtimeByBranchId.set(
        branchId,
        await loadBranchRuntime({
          supabase: params.supabase,
          tenantId: params.context.tenantId,
          branchId,
        }),
      );
    }

    const items = summarizeMembers({
      members,
      branches,
      lineIdentityByMemberId,
      runtimeByBranchId,
      issueRows,
      remediableMemberIds: new Set(
        (remediationScope?.ok ? remediationScope.items : [])
          .filter((item) => item.canResendNow && item.memberId)
          .map((item) => item.memberId as string),
      ),
    });

    return {
      ok: true as const,
      items,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Load member notification coverage failed",
    };
  }
}

export async function listManagerNotificationRemediationQueue(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  branchId?: string | null;
  bucket?: NotificationCoverageBucket | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  search?: string | null;
  limit?: number | null;
}) {
  if (!params.context.tenantId) {
    return { ok: false as const, error: "Missing tenant scope" };
  }

  try {
    const scopeBranchId = normalizeBranchId(params.context, params.branchId);
    let query = params.supabase
      .from("notification_deliveries")
      .select(
        "id, member_id, branch_id, channel, status, skipped_reason, failure_reason, error_code, error_message, created_at, recipient_email, recipient_phone, payload, bookings(id, public_reference, starts_at, status), branches(name)",
      )
      .eq("tenant_id", params.context.tenantId)
      .in("status", ["skipped", "failed", "dead_letter", "retrying"])
      .order("created_at", { ascending: false });
    if (scopeBranchId) query = query.eq("branch_id", scopeBranchId);
    if (params.dateFrom) query = query.gte("created_at", startOfDayIso(params.dateFrom));
    if (params.dateTo) query = query.lte("created_at", endOfDayIso(params.dateTo));
    if (typeof params.limit === "number" && params.limit > 0) query = query.limit(params.limit);
    const result = await query;
    if (result.error) throw new Error(result.error.message);

    const rows = (result.data || []) as RemediationDeliveryRow[];
    const filteredRows = rows.filter((row) => {
      const bucket = normalizeNotificationCoverageBucket({
        skippedReason: row.skipped_reason,
        failureReason: row.failure_reason,
        errorCode: row.error_code,
        errorMessage: row.error_message,
      });
      if (params.bucket && bucket !== params.bucket) return false;
      if (!params.search?.trim()) return true;
      const booking = pickBookingRow(row.bookings);
      const branch = pickBranchRow(row.branches);
      const text = lowerText([
        row.recipient_email,
        row.recipient_phone,
        booking?.public_reference || null,
        branch?.name || null,
        typeof row.payload?.customerName === "string" ? row.payload.customerName : null,
      ]);
      return text.includes(params.search.trim().toLowerCase());
    });

    const memberIds = Array.from(new Set(filteredRows.map((row) => row.member_id).filter((value): value is string => Boolean(value))));
    const members = memberIds.length
      ? await loadScopedMembers({
          supabase: params.supabase,
          tenantId: params.context.tenantId,
          branchId: scopeBranchId,
          memberIds,
          limit: 1000,
        })
      : [];
    const membersById = new Map(members.map((member) => [member.id, member]));
    const lineIdentityByMemberId = await loadLineIdentityMap({
      supabase: params.supabase,
      tenantId: params.context.tenantId,
      memberIds,
    });

    const branchIds = Array.from(new Set(filteredRows.map((row) => row.branch_id || null)));
    const runtimeByBranchId = new Map<string | null, BranchRuntime>();
    for (const branchId of branchIds) {
      runtimeByBranchId.set(
        branchId,
        await loadBranchRuntime({
          supabase: params.supabase,
          tenantId: params.context.tenantId,
          branchId,
        }),
      );
    }

    const items: NotificationRemediationItem[] = filteredRows.map((row) => {
      const bucket = normalizeNotificationCoverageBucket({
        skippedReason: row.skipped_reason,
        failureReason: row.failure_reason,
        errorCode: row.error_code,
        errorMessage: row.error_message,
      });
      const member = row.member_id ? membersById.get(row.member_id) || null : null;
      const branch = pickBranchRow(row.branches);
      const booking = pickBookingRow(row.bookings);
      const lineUserId = row.member_id ? lineIdentityByMemberId.get(row.member_id) || null : null;
      const runtime = runtimeByBranchId.get(row.branch_id || null) || null;
      const remediation = deriveRemediation({
        bucket,
        channel: row.channel,
        deliveryStatus: row.status,
        email: member?.email || row.recipient_email,
        phone: member?.phone || row.recipient_phone,
        lineUserId,
        runtime: row.channel === "email" ? runtime?.email || null : row.channel === "line" ? runtime?.line || null : null,
      });
      return {
        deliveryId: row.id,
        memberId: row.member_id,
        memberName: member?.full_name || (typeof row.payload?.customerName === "string" ? row.payload.customerName : null),
        branchId: row.branch_id,
        branchName: branch?.name || null,
        bookingId: booking?.id || null,
        bookingReference: booking?.public_reference || null,
        bookingStartsAt: booking?.starts_at || null,
        bookingStatus: booking?.status || null,
        channel: row.channel,
        deliveryStatus: row.status || "failed",
        bucket,
        rawReason: row.skipped_reason || row.failure_reason || row.error_message || null,
        currentRuntime: remediation.currentRuntime,
        currentRecipientState: remediation.currentRecipientState,
        currentEmail: member?.email || row.recipient_email,
        currentPhone: member?.phone || row.recipient_phone,
        currentLineUserId: lineUserId,
        canResendNow: remediation.canResendNow,
        hintCode: remediation.hintCode,
        hintLabel: remediation.hintLabel,
        createdAt: row.created_at,
      };
    });

    items.sort((a, b) => {
      const actionableDelta = Number(b.canResendNow) - Number(a.canResendNow);
      if (actionableDelta !== 0) return actionableDelta;
      const timeDelta = (b.createdAt || "").localeCompare(a.createdAt || "");
      if (timeDelta !== 0) return timeDelta;
      const memberDelta = (a.memberName || "").localeCompare(b.memberName || "", "en");
      if (memberDelta !== 0) return memberDelta;
      return (a.bookingReference || a.deliveryId).localeCompare(b.bookingReference || b.deliveryId, "en");
    });

    const summary: NotificationRemediationSummary = {
      total: items.length,
      remediableNow: items.filter((item) => item.canResendNow).length,
      blockedByConfig: items.filter((item) => item.hintCode === "review_channel_config").length,
      blockedByPreference: items.filter((item) => item.hintCode === "review_preferences").length,
      blockedByIdentity: items.filter((item) => item.hintCode === "identity_required" || item.hintCode === "update_email_then_resend").length,
      blockedOther: items.filter(
        (item) =>
          !item.canResendNow &&
          item.hintCode !== "review_channel_config" &&
          item.hintCode !== "review_preferences" &&
          item.hintCode !== "identity_required" &&
          item.hintCode !== "update_email_then_resend",
      ).length,
    };

    return {
      ok: true as const,
      summary,
      items,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Load remediation queue failed",
    };
  }
}

export async function persistManagerNotificationRemediationRun(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  summary: NotificationRemediationActionSummary;
}) {
  if (!params.context.tenantId) {
    return { ok: false as const, error: "Missing tenant scope" };
  }

  const runId = params.summary.runId || randomUUID();
  const performedAt = params.summary.performedAt || new Date().toISOString();
  const payload = {
    runId,
    actionType: params.summary.actionType,
    performedAt,
    performedByUserId: params.context.userId,
    performedByName: params.summary.performedByName || null,
    scope: params.summary.scope,
    requested: params.summary.requested,
    succeeded: params.summary.succeeded,
    failed: params.summary.failed,
    skipped: params.summary.skipped,
    blocked: params.summary.blocked,
    blockedItems: params.summary.blockedItems,
    results: params.summary.results,
  };
  const insert = await params.supabase.from("audit_logs").insert({
    tenant_id: params.context.tenantId,
    actor_id: params.context.userId,
    action: "notification_bulk_resend",
    target_type: "notification_remediation_run",
    target_id: runId,
    reason: "Persisted bulk resend remediation result",
    payload,
  });
  if (insert.error) {
    return { ok: false as const, error: insert.error.message };
  }

  return {
    ok: true as const,
    summary: {
      ...params.summary,
      runId,
      performedAt,
      performedByUserId: params.context.userId,
    },
  };
}

export async function listManagerNotificationRemediationHistory(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  branchId?: string | null;
  bucket?: NotificationCoverageBucket | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  search?: string | null;
  actionType?: "bulk_resend" | null;
  outcome?: NotificationRemediationHistoryOutcomeFilter | null;
  channel?: "email" | "line" | "sms" | "webhook" | "in_app" | "other" | null;
  sort?: NotificationRemediationHistorySort | null;
  page?: number | null;
  pageSize?: number | null;
}) {
  if (!params.context.tenantId) {
    return { ok: false as const, error: "Missing tenant scope" };
  }

  try {
    const window = resolveRemediationHistoryDateWindow({
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    });
    if (!window.ok) {
      return { ok: false as const, error: window.error };
    }

    let query = params.supabase
      .from("audit_logs")
      .select("id, actor_id, action, target_type, target_id, payload, created_at")
      .eq("tenant_id", params.context.tenantId)
      .eq("action", "notification_bulk_resend")
      .eq("target_type", "notification_remediation_run")
      .gte("created_at", startOfDayIso(window.effectiveDateFrom))
      .lte("created_at", endOfDayIso(window.effectiveDateTo))
      .order("created_at", { ascending: false });

    const result = await query;
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data || []) as RemediationAuditLogRow[];
    const actorNameById = await loadActorNames({
      supabase: params.supabase,
      actorIds: Array.from(new Set(rows.map((row) => row.actor_id).filter((value): value is string => Boolean(value)))),
    });
    const scopeBranchId = normalizeBranchId(params.context, params.branchId);
    const searchLower = params.search?.trim().toLowerCase() || "";

    const items = rows
      .map((row) => parsePersistedRemediationSummary({ row, actorNameById }))
      .filter((row): row is NotificationRemediationActionSummary => Boolean(row))
      .filter((row) => {
        if (scopeBranchId && row.scope.branchId !== scopeBranchId) return false;
        if (params.bucket && row.scope.bucket !== params.bucket) return false;
        if (params.actionType && row.actionType !== params.actionType) return false;
        if (params.channel && !row.results.some((item) => item.channel === params.channel)) return false;
        if (params.outcome === "has_failed" && row.failed <= 0) return false;
        if (params.outcome === "has_blocked" && row.blocked <= 0) return false;
        if (params.outcome === "all_success" && (row.failed > 0 || row.blocked > 0 || row.skipped > 0)) return false;
        if (!searchLower) return true;
        const haystack = [
          row.runId,
          row.actionType,
          row.performedByName,
          row.performedByUserId,
          row.scope.search,
          ...row.results.flatMap((item) => [
            item.memberName,
            item.memberId,
            item.bookingReference,
            item.sourceDeliveryId,
            item.childDeliveryId,
            item.reason,
            item.bucket,
            item.channel,
          ]),
        ]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .join(" ")
          .toLowerCase();
        return haystack.includes(searchLower);
      })
      .map((row) => toHistoryListItem(row));

    const paginated = paginateHistoryItems({
      items: sortHistoryItems(items, params.sort || "latest"),
      page: params.page,
      pageSize: params.pageSize,
      effectiveDateFrom: window.effectiveDateFrom,
      effectiveDateTo: window.effectiveDateTo,
      defaultedDateWindow: window.defaultedDateWindow,
    });

    return {
      ok: true as const,
      items: paginated.items,
      meta: paginated.meta,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Load remediation history failed",
    };
  }
}

export async function getManagerNotificationRemediationHistoryDetail(params: {
  supabase: SupabaseClient;
  context: ProfileContext;
  runId: string;
}) {
  if (!params.context.tenantId) {
    return { ok: false as const, error: "Missing tenant scope" };
  }

  try {
    const result = await params.supabase
      .from("audit_logs")
      .select("id, actor_id, action, target_type, target_id, payload, created_at")
      .eq("tenant_id", params.context.tenantId)
      .eq("action", "notification_bulk_resend")
      .eq("target_type", "notification_remediation_run")
      .eq("target_id", params.runId)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) {
      return { ok: false as const, error: "Remediation history run not found" };
    }

    const row = result.data as RemediationAuditLogRow;
    const scopeBranchId = normalizeBranchId(params.context, null);
    const actorNameById = await loadActorNames({
      supabase: params.supabase,
      actorIds: row.actor_id ? [row.actor_id] : [],
    });
    const detail = parsePersistedRemediationSummary({ row, actorNameById });
    if (!detail) {
      return { ok: false as const, error: "Remediation history payload is invalid" };
    }
    if (scopeBranchId && detail.scope.branchId !== scopeBranchId) {
      return { ok: false as const, error: "Remediation history run is outside the current branch scope" };
    }

    return {
      ok: true as const,
      detail: detail as NotificationRemediationHistoryDetail,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Load remediation history detail failed",
    };
  }
}
