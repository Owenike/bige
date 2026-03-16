import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { listManagerNotificationRemediationHistory } from "../../../../../../lib/notification-coverage";
import { requirePermission } from "../../../../../../lib/permissions";
import type {
  NotificationCoverageBucket,
  NotificationRemediationHistoryOutcomeFilter,
  NotificationRemediationHistorySort,
} from "../../../../../../types/notification-coverage";

function normalizeBucket(input: string | null): NotificationCoverageBucket | null {
  return input === "recipient_missing:email" ||
    input === "recipient_missing:line_user_id" ||
    input === "channel_disabled" ||
    input === "provider_unconfigured" ||
    input === "preference_opt_out" ||
    input === "invalid_recipient" ||
    input === "template_missing" ||
    input === "other"
    ? input
    : null;
}

function normalizeOutcome(input: string | null): NotificationRemediationHistoryOutcomeFilter | null {
  return input === "all" || input === "has_failed" || input === "has_blocked" || input === "all_success" ? input : null;
}

function normalizeSort(input: string | null): NotificationRemediationHistorySort | null {
  return input === "latest" || input === "issues_desc" || input === "requested_desc" || input === "success_rate_asc" ? input : null;
}

function normalizeActionType(input: string | null): "bulk_resend" | null {
  return input === "bulk_resend" ? input : null;
}

function normalizeChannel(input: string | null): "email" | "line" | "sms" | "webhook" | "in_app" | "other" | null {
  return input === "email" ||
    input === "line" ||
    input === "sms" ||
    input === "webhook" ||
    input === "in_app" ||
    input === "other"
    ? input
    : null;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant scope");

  const permission = requirePermission(auth.context, "notifications.overview.read");
  if (!permission.ok) return permission.response;

  const url = new URL(request.url);
  const history = await listManagerNotificationRemediationHistory({
    supabase: auth.supabase,
    context: auth.context,
    branchId: url.searchParams.get("branch_id"),
    bucket: normalizeBucket(url.searchParams.get("bucket")),
    dateFrom: url.searchParams.get("date_from"),
    dateTo: url.searchParams.get("date_to"),
    search: url.searchParams.get("search"),
    actionType: normalizeActionType(url.searchParams.get("action_type")),
    outcome: normalizeOutcome(url.searchParams.get("outcome")),
    channel: normalizeChannel(url.searchParams.get("channel")),
    sort: normalizeSort(url.searchParams.get("sort")),
    page: Number(url.searchParams.get("page") || 1),
    pageSize: Number(url.searchParams.get("page_size") || 20),
  });
  if (!history.ok) {
    if (
      history.error.includes("cannot exceed") ||
      history.error.includes("invalid") ||
      history.error.includes("Missing tenant scope")
    ) {
      return apiError(400, "FORBIDDEN", history.error);
    }
    return apiError(500, "INTERNAL_ERROR", history.error);
  }

  return apiSuccess({
    items: history.items,
    meta: history.meta,
  });
}
