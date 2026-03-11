import { z } from "zod";
import {
  appRoleSchema,
  notificationChannelSchema,
  notificationEventKeySchema,
  uuidLikeSchema,
} from "./notification-productization";

export type NotificationPreflightQuery = {
  tenantId: string | null;
  eventKey: z.infer<typeof notificationEventKeySchema>;
  roleKey: z.infer<typeof appRoleSchema> | null;
  userId: string | null;
  channelHint: z.infer<typeof notificationChannelSchema> | null;
  locale: string;
  defaultLocale: string;
  recipientLimit: number;
};

export function parseNotificationPreflightQuery(params: URLSearchParams):
  | { ok: true; query: NotificationPreflightQuery }
  | { ok: false; error: string } {
  const tenantRaw = (params.get("tenantId") || "").trim();
  const tenantParsed = tenantRaw ? uuidLikeSchema.safeParse(tenantRaw) : null;
  if (tenantRaw && (!tenantParsed || !tenantParsed.success)) return { ok: false, error: "Invalid tenantId" };

  const eventRaw = (params.get("eventKey") || "opportunity_due").trim();
  const eventParsed = notificationEventKeySchema.safeParse(eventRaw);
  if (!eventParsed.success) return { ok: false, error: "Invalid eventKey" };

  const roleRaw = (params.get("roleKey") || "").trim();
  const roleParsed = roleRaw ? appRoleSchema.safeParse(roleRaw) : ({ success: true, data: null } as const);
  if (!roleParsed.success) return { ok: false, error: "Invalid roleKey" };

  const userRaw = (params.get("userId") || "").trim();
  const userParsed = userRaw ? uuidLikeSchema.safeParse(userRaw) : ({ success: true, data: null } as const);
  if (!userParsed.success) return { ok: false, error: "Invalid userId" };

  const channelRaw = (params.get("channelHint") || "").trim();
  const channelParsed = channelRaw
    ? notificationChannelSchema.safeParse(channelRaw)
    : ({ success: true, data: null } as const);
  if (!channelParsed.success) return { ok: false, error: "Invalid channelHint" };

  const locale = (params.get("locale") || "zh-TW").trim() || "zh-TW";
  const defaultLocale = (params.get("defaultLocale") || "zh-TW").trim() || "zh-TW";
  const recipientLimitRaw = Number(params.get("recipientLimit") || 20);
  const recipientLimit = Number.isFinite(recipientLimitRaw)
    ? Math.min(100, Math.max(1, Math.floor(recipientLimitRaw)))
    : 20;

  return {
    ok: true,
    query: {
      tenantId: tenantParsed?.success ? tenantParsed.data : null,
      eventKey: eventParsed.data,
      roleKey: roleParsed.data || null,
      userId: userParsed.data || null,
      channelHint: channelParsed.data || null,
      locale,
      defaultLocale,
      recipientLimit,
    },
  };
}
