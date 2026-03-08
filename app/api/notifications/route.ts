import { apiError, apiSuccess, requireProfile } from "../../../lib/auth-context";
import {
  listMyInAppNotifications,
  updateMyInAppNotifications,
  type NotificationStatus,
} from "../../../lib/in-app-notifications";

function parseStatus(input: string | null): "all" | NotificationStatus {
  if (input === "unread" || input === "read" || input === "archived") return input;
  return "all";
}

function parseAction(input: unknown): "read" | "unread" | "archive" {
  if (input === "unread") return "unread";
  if (input === "archive") return "archive";
  return "read";
}

function parseIds(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 200);
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const status = parseStatus(params.get("status"));
  const limit = Math.min(200, Math.max(1, Number(params.get("limit") || 40)));

  const notifications = await listMyInAppNotifications({
    context: auth.context,
    status,
    limit,
  });
  if (!notifications.ok) return apiError(500, "INTERNAL_ERROR", notifications.error);

  return apiSuccess({
    items: notifications.items.map((item) => ({
      id: item.id,
      tenantId: item.tenant_id,
      branchId: item.branch_id,
      recipientUserId: item.recipient_user_id,
      recipientRole: item.recipient_role,
      status: item.status,
      severity: item.severity,
      eventType: item.event_type,
      title: item.title,
      message: item.message,
      targetType: item.target_type,
      targetId: item.target_id,
      actionUrl: item.action_url,
      payload: item.payload || {},
      readAt: item.read_at,
      archivedAt: item.archived_at,
      createdAt: item.created_at,
    })),
    unreadCount: notifications.unreadCount,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const action = parseAction(body?.action);
  const notificationIds = parseIds(body?.notificationIds);
  if (notificationIds.length === 0) {
    return apiError(400, "FORBIDDEN", "notificationIds are required");
  }

  const updated = await updateMyInAppNotifications({
    context: auth.context,
    notificationIds,
    action,
  });
  if (!updated.ok) return apiError(500, "INTERNAL_ERROR", updated.error);

  return apiSuccess({
    updated: updated.updated,
    action,
  });
}

