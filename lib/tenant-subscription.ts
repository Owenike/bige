export type TenantStatus = "active" | "suspended" | "disabled" | null;
export type TenantSubscriptionStatus = "trial" | "active" | "grace" | "suspended" | "expired" | "canceled" | null;

export type TenantAccessErrorCode =
  | "TENANT_DISABLED"
  | "TENANT_SUSPENDED"
  | "SUBSCRIPTION_NOT_FOUND"
  | "SUBSCRIPTION_EXPIRED"
  | "SUBSCRIPTION_CANCELED"
  | "INVALID_SUBSCRIPTION_STATE";

export type TenantAccessState = {
  allowed: boolean;
  blockedCode: TenantAccessErrorCode | null;
  warningCode: "SUBSCRIPTION_GRACE" | "SUBSCRIPTION_EXPIRING_SOON" | null;
  effectiveStatus: TenantSubscriptionStatus | "none";
  remainingDays: number | null;
  message: string;
};

export type TenantSubscriptionSnapshot = {
  status: TenantSubscriptionStatus;
  startsAt: string | null;
  endsAt: string | null;
  graceEndsAt: string | null;
  planCode: string | null;
  planName: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function calcRemainingDays(targetMs: number | null, nowMs: number) {
  if (targetMs === null) return null;
  const diff = targetMs - nowMs;
  if (diff <= 0) return 0;
  return Math.ceil(diff / DAY_MS);
}

export function evaluateTenantAccess(input: {
  tenantStatus: TenantStatus;
  subscription: TenantSubscriptionSnapshot | null;
  now?: Date;
}): TenantAccessState {
  const nowMs = (input.now ?? new Date()).getTime();

  if (input.tenantStatus === "disabled") {
    return {
      allowed: false,
      blockedCode: "TENANT_DISABLED",
      warningCode: null,
      effectiveStatus: input.subscription?.status ?? "none",
      remainingDays: null,
      message: "Tenant is disabled",
    };
  }

  if (input.tenantStatus === "suspended") {
    return {
      allowed: false,
      blockedCode: "TENANT_SUSPENDED",
      warningCode: null,
      effectiveStatus: input.subscription?.status ?? "none",
      remainingDays: null,
      message: "Tenant is suspended",
    };
  }

  const subscription = input.subscription;
  if (!subscription || !subscription.status) {
    return {
      allowed: false,
      blockedCode: "SUBSCRIPTION_NOT_FOUND",
      warningCode: null,
      effectiveStatus: "none",
      remainingDays: null,
      message: "Tenant subscription not found",
    };
  }

  const endsAtMs = toDateMs(subscription.endsAt);
  const graceEndsAtMs = toDateMs(subscription.graceEndsAt);
  let effectiveStatus: TenantSubscriptionStatus = subscription.status;

  if ((effectiveStatus === "trial" || effectiveStatus === "active") && endsAtMs !== null && endsAtMs < nowMs) {
    if (graceEndsAtMs !== null && graceEndsAtMs >= nowMs) {
      effectiveStatus = "grace";
    } else {
      effectiveStatus = "expired";
    }
  }

  if (effectiveStatus === "grace") {
    if (graceEndsAtMs !== null && graceEndsAtMs < nowMs) {
      return {
        allowed: false,
        blockedCode: "SUBSCRIPTION_EXPIRED",
        warningCode: null,
        effectiveStatus: "expired",
        remainingDays: 0,
        message: "Subscription grace period has ended",
      };
    }
    return {
      allowed: true,
      blockedCode: null,
      warningCode: "SUBSCRIPTION_GRACE",
      effectiveStatus: "grace",
      remainingDays: calcRemainingDays(graceEndsAtMs, nowMs),
      message: "Subscription is in grace period",
    };
  }

  if (effectiveStatus === "trial" || effectiveStatus === "active") {
    const remainingDays = calcRemainingDays(endsAtMs, nowMs);
    return {
      allowed: true,
      blockedCode: null,
      warningCode: remainingDays !== null && remainingDays <= 14 ? "SUBSCRIPTION_EXPIRING_SOON" : null,
      effectiveStatus,
      remainingDays,
      message: "Subscription is active",
    };
  }

  if (effectiveStatus === "expired") {
    return {
      allowed: false,
      blockedCode: "SUBSCRIPTION_EXPIRED",
      warningCode: null,
      effectiveStatus: "expired",
      remainingDays: 0,
      message: "Subscription has expired",
    };
  }

  if (effectiveStatus === "canceled") {
    return {
      allowed: false,
      blockedCode: "SUBSCRIPTION_CANCELED",
      warningCode: null,
      effectiveStatus: "canceled",
      remainingDays: 0,
      message: "Subscription has been canceled",
    };
  }

  if (effectiveStatus === "suspended") {
    return {
      allowed: false,
      blockedCode: "TENANT_SUSPENDED",
      warningCode: null,
      effectiveStatus: "suspended",
      remainingDays: null,
      message: "Subscription is suspended",
    };
  }

  return {
    allowed: false,
    blockedCode: "INVALID_SUBSCRIPTION_STATE",
    warningCode: null,
    effectiveStatus,
    remainingDays: null,
    message: "Invalid subscription state",
  };
}
