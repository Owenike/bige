import type { ProfileContext } from "./auth-context";
import { isManagerTenantScopeAllowed, uuidLikeSchema } from "./notification-productization";

export type NotificationOpsApiQuery = {
  tenantId: string | null;
  limit: number;
  staleAfterMinutes: number;
  defaultLocale: string;
};

export type NotificationOpsApiScope = {
  scope: "platform" | "tenant";
  tenantId: string | null;
};

export function parseNotificationOpsApiQuery(params: URLSearchParams) {
  const tenantIdRaw = params.get("tenantId");
  const tenantIdParsed = tenantIdRaw ? uuidLikeSchema.safeParse(tenantIdRaw) : null;
  if (tenantIdRaw && (!tenantIdParsed || !tenantIdParsed.success)) {
    return { ok: false as const, error: "tenantId must be a valid uuid" };
  }

  const limitRaw = Number(params.get("limit") || 500);
  const limit = Number.isFinite(limitRaw) ? Math.min(3000, Math.max(1, Math.floor(limitRaw))) : 500;

  const staleRaw = Number(params.get("staleAfterMinutes") || 1440);
  const staleAfterMinutes = Number.isFinite(staleRaw) ? Math.min(10080, Math.max(1, Math.floor(staleRaw))) : 1440;

  const defaultLocaleRaw = String(params.get("defaultLocale") || "zh-TW").trim();
  const defaultLocale = defaultLocaleRaw || "zh-TW";

  return {
    ok: true as const,
    query: {
      tenantId: tenantIdParsed?.success ? tenantIdParsed.data : null,
      limit,
      staleAfterMinutes,
      defaultLocale,
    } as NotificationOpsApiQuery,
  };
}

export function resolvePlatformOpsScope(query: NotificationOpsApiQuery): NotificationOpsApiScope {
  if (query.tenantId) {
    return {
      scope: "tenant",
      tenantId: query.tenantId,
    };
  }
  return {
    scope: "platform",
    tenantId: null,
  };
}

export function resolveManagerOpsScope(params: {
  context: ProfileContext;
  query: NotificationOpsApiQuery;
}) {
  if (!params.context.tenantId) {
    return { ok: false as const, code: "FORBIDDEN" as const, message: "Missing tenant scope" };
  }
  if (!isManagerTenantScopeAllowed(params.context.tenantId, params.query.tenantId)) {
    return { ok: false as const, code: "BRANCH_SCOPE_DENIED" as const, message: "tenantId mismatch" };
  }
  return {
    ok: true as const,
    scope: {
      scope: "tenant" as const,
      tenantId: params.context.tenantId,
    },
  };
}
