import { z } from "zod";
import type { AppRole } from "./auth-context";

export const NOTIFICATION_EVENT_KEYS = [
  "booking_created",
  "booking_rescheduled",
  "booking_cancelled",
  "booking_reminder_day_before",
  "booking_reminder_1h",
  "booking_deposit_pending",
  "tenant_subscription_expiring",
  "tenant_subscription_grace",
  "tenant_subscription_blocked",
  "member_contract_expiring",
  "member_contract_low_balance",
  "high_risk_approval_pending",
  "high_risk_approval_decision",
  "shift_open_overdue",
  "shift_difference_detected",
  "unreconciled_events_detected",
  "booking_upcoming",
  "crm_trial_upcoming",
  "crm_followup_overdue",
  "crm_trial_followup_needed",
  "crm_trial_scheduled",
  "crm_lead_won",
  "crm_lead_lost",
  "opportunity_due",
  "opportunity_stale",
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

export const NOTIFICATION_EVENT_KEY_SET = new Set<string>(NOTIFICATION_EVENT_KEYS);

export const notificationEventKeySchema = z.enum(NOTIFICATION_EVENT_KEYS);

export const NOTIFICATION_ROLE_KEYS = [
  "platform_admin",
  "manager",
  "supervisor",
  "branch_manager",
  "frontdesk",
  "coach",
  "sales",
  "member",
  ] as const;

export type NotificationRoleKey = (typeof NOTIFICATION_ROLE_KEYS)[number];

export const appRoleSchema = z.enum(NOTIFICATION_ROLE_KEYS);

export const MANAGER_EDITABLE_ROLE_KEYS = [
  "manager",
  "supervisor",
  "branch_manager",
  "frontdesk",
  "coach",
  "sales",
  "member",
  ] as const;

export type ManagerEditableRoleKey = (typeof MANAGER_EDITABLE_ROLE_KEYS)[number];

export const managerEditableRoleSchema = z.enum(MANAGER_EDITABLE_ROLE_KEYS);

export const NOTIFICATION_CHANNEL_KEYS = ["in_app", "email", "line", "sms", "webhook"] as const;
export type NotificationChannelKey = (typeof NOTIFICATION_CHANNEL_KEYS)[number];

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNEL_KEYS);

export const NOTIFICATION_PRIORITY_KEYS = ["info", "warning", "critical"] as const;
export type NotificationPriorityKey = (typeof NOTIFICATION_PRIORITY_KEYS)[number];

export const notificationPrioritySchema = z.enum(NOTIFICATION_PRIORITY_KEYS);

export const channelPreferencesSchema = z
  .object({
    in_app: z.boolean().optional(),
    email: z.boolean().optional(),
    line: z.boolean().optional(),
    sms: z.boolean().optional(),
    webhook: z.boolean().optional(),
  })
  .strict()
  .default({});

export const notificationPreferenceModeSchema = z.enum(["role", "user"]);
export const notificationPreferenceScopeSchema = z.enum(["platform_default", "tenant_default", "custom"]);

export const templateChannelPolicySchema = z
  .object({
    allowExternal: z.boolean().optional(),
    suppressInApp: z.boolean().optional(),
    throttleMinutes: z.number().int().min(0).max(10080).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    managerOnly: z.boolean().optional(),
  })
  .strict()
  .default({});

export const uuidLikeSchema = z.string().trim().uuid();

export function normalizeChannels(raw: z.infer<typeof channelPreferencesSchema>): Record<NotificationChannelKey, boolean> {
  return {
    in_app: raw.in_app ?? true,
    email: raw.email ?? false,
    line: raw.line ?? false,
    sms: raw.sms ?? false,
    webhook: raw.webhook ?? false,
  };
}

export function normalizeRoleForManager(role: AppRole) {
  if (role === "platform_admin") return null;
  return role;
}

export function buildTemplateKey(params: {
  tenantId?: string | null;
  eventType: string;
  channel: NotificationChannelKey;
  locale: string;
}) {
  const scope = params.tenantId ? `tenant:${params.tenantId}` : "global";
  return `${scope}:${params.eventType}:${params.channel}:${params.locale}`;
}

export function parseBooleanQuery(input: string | null, fallback: boolean) {
  if (input === null) return fallback;
  const value = input.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  return fallback;
}

export const retryStatusesSchema = z
  .array(z.enum(["failed", "retrying", "pending", "sent", "skipped", "dead_letter", "cancelled"]))
  .max(7)
  .optional();

export const retryRequestSchema = z
  .object({
    action: z.enum(["dry_run", "execute"]).default("dry_run"),
    tenantId: z.string().trim().uuid().nullable().optional(),
    deliveryIds: z.array(uuidLikeSchema).max(500).optional().default([]),
    channels: z.array(notificationChannelSchema).max(5).optional(),
    eventType: notificationEventKeySchema.optional(),
    statuses: retryStatusesSchema,
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export type RetryRequest = z.infer<typeof retryRequestSchema>;

export type NotificationPreferenceMode = z.infer<typeof notificationPreferenceModeSchema>;

export type NotificationPreferenceFormPayload = {
  tenantId?: string;
  mode: NotificationPreferenceMode;
  eventType: NotificationEventKey;
  role?: NotificationRoleKey;
  userId?: string;
  channels: z.infer<typeof channelPreferencesSchema>;
  isEnabled?: boolean;
  source?: z.infer<typeof notificationPreferenceScopeSchema>;
  note?: string | null;
};

export type NotificationTemplateFormPayload = {
  id?: string;
  tenantId?: string | null;
  eventType: NotificationEventKey;
  channel: NotificationChannelKey;
  locale?: string;
  titleTemplate: string;
  messageTemplate: string;
  emailSubject?: string | null;
  actionUrl?: string | null;
  priority?: NotificationPriorityKey;
  channelPolicy?: z.infer<typeof templateChannelPolicySchema>;
  isActive?: boolean;
  version?: number;
  templateKey?: string;
};

export type NotificationRetryActionPayload = RetryRequest;

export function isManagerTenantScopeAllowed(contextTenantId: string | null | undefined, requestedTenantId: string | null | undefined) {
  if (!requestedTenantId) return true;
  if (!contextTenantId) return false;
  return requestedTenantId === contextTenantId;
}

export function normalizeTemplatePolicy(input: unknown) {
  return templateChannelPolicySchema.parse(input || {});
}
