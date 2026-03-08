import type { AppRole } from "./auth-context";
import type { DeliveryChannel, DeliveryRow } from "./notification-ops";

type ExternalChannel = Exclude<DeliveryChannel, "in_app" | "other">;

const MANAGER_ROLES: AppRole[] = ["platform_admin", "manager", "supervisor", "branch_manager"];

function hasManagerScope(role: AppRole | null) {
  return Boolean(role && MANAGER_ROLES.includes(role));
}

export function resolveExternalChannels(params: {
  eventType: string;
  severity: string | null;
  recipientRole: AppRole | null;
}): ExternalChannel[] {
  const role = params.recipientRole;
  if (!role) return [];

  if (role === "frontdesk" || role === "coach" || role === "member") {
    return [];
  }

  if (params.eventType.startsWith("tenant_subscription_")) {
    return hasManagerScope(role) ? ["email", "webhook"] : [];
  }

  if (params.eventType.startsWith("member_contract_")) {
    return hasManagerScope(role) || role === "sales" ? ["email"] : [];
  }

  if (params.eventType.startsWith("opportunity_") || params.eventType.startsWith("crm_")) {
    return role === "sales" || hasManagerScope(role) ? ["email"] : [];
  }

  if (params.eventType.includes("approval")) {
    return hasManagerScope(role) ? ["email", "webhook"] : [];
  }

  if (params.eventType.includes("unreconciled") || params.eventType.includes("shift_")) {
    return hasManagerScope(role) ? ["email"] : [];
  }

  if (params.severity === "critical" && hasManagerScope(role)) {
    return ["email", "webhook"];
  }

  return [];
}

export function buildExternalContent(row: DeliveryRow) {
  const payload = row.payload || {};
  const title = typeof payload.title === "string" ? payload.title : "Notification";
  const message = typeof payload.message === "string" ? payload.message : title;
  const actionUrl = typeof payload.actionUrl === "string" ? payload.actionUrl : null;
  const eventType = typeof payload.eventType === "string" ? payload.eventType : row.source_ref_type || "notification";

  const subject = `[BIGE] ${title}`;
  const lines = [message];
  if (eventType) lines.push(`Event: ${eventType}`);
  if (row.tenant_id) lines.push(`Tenant: ${row.tenant_id}`);
  if (actionUrl) lines.push(`Action: ${actionUrl}`);

  return {
    templateKey: `phase12.${eventType}`,
    subject,
    text: lines.join("\n"),
    eventType,
    actionUrl,
  };
}

export function shouldRetryExternalFailure(params: {
  channel: DeliveryChannel;
  errorCode: string | null;
  errorMessage: string | null;
}) {
  if (params.channel === "in_app") return false;
  if (params.errorCode === "CHANNEL_NOT_CONFIGURED") return false;
  if (params.errorCode === "CHANNEL_POLICY_SKIPPED") return false;
  if (params.errorCode === "CHANNEL_NOT_IMPLEMENTED") return false;
  if (params.errorCode === "RECIPIENT_CONTACT_MISSING") return false;
  if (params.errorCode === "RECIPIENT_LOOKUP_FAILED") return false;
  const code = (params.errorCode || "").toUpperCase();
  const message = (params.errorMessage || "").toLowerCase();
  if (code.includes("HTTP_401") || code.includes("HTTP_403") || code.includes("HTTP_404")) return false;
  if (message.includes("unauthorized") || message.includes("forbidden")) return false;
  if (message.includes("invalid token") || message.includes("invalid api key")) return false;
  if (code === "NETWORK_ERROR") return true;
  if (code === "TIMEOUT") return true;
  if (code.includes("HTTP_5")) return true;
  if (code.includes("HTTP_429")) return true;
  if (message.includes("timeout") || message.includes("timed out")) return true;
  if (message.includes("network")) return true;
  return false;
}
