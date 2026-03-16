import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoreBookingSettings } from "../types/storefront";

export type BookingCapabilityKey =
  | "deposits"
  | "packages"
  | "customer_reschedule"
  | "customer_cancel"
  | "reminders"
  | "cross_store_therapists";

export type BookingCapabilityState = {
  key: BookingCapabilityKey;
  flagKey: string;
  label: string;
  description: string;
  platformAllowed: boolean;
  storeEnabled: boolean;
  effectiveEnabled: boolean;
};

export const BOOKING_CAPABILITY_DEFS: Array<{
  key: BookingCapabilityKey;
  flagKey: string;
  label: string;
  description: string;
}> = [
  {
    key: "deposits",
    flagKey: "capability.booking.deposits",
    label: "Deposits",
    description: "Controls whether stores can require or expose deposit collection.",
  },
  {
    key: "packages",
    flagKey: "capability.booking.packages",
    label: "Packages",
    description: "Controls package redemption and package-based booking checkout.",
  },
  {
    key: "customer_reschedule",
    flagKey: "capability.booking.customer_reschedule",
    label: "Customer Reschedule",
    description: "Controls customer-side reschedule permissions.",
  },
  {
    key: "customer_cancel",
    flagKey: "capability.booking.customer_cancel",
    label: "Customer Cancel",
    description: "Controls customer-side cancellation permissions.",
  },
  {
    key: "reminders",
    flagKey: "capability.booking.reminders",
    label: "Booking Reminders",
    description: "Controls booking reminder and deposit reminder scheduling.",
  },
  {
    key: "cross_store_therapists",
    flagKey: "capability.booking.cross_store_therapists",
    label: "Cross-store Scheduling",
    description: "Controls cross-branch therapist scheduling and conflict enforcement.",
  },
];

export const BOOKING_CAPABILITY_STORE_FIELD_MAP: Record<
  Exclude<BookingCapabilityKey, "reminders">,
  keyof Pick<
    StoreBookingSettings,
    | "depositsEnabled"
    | "packagesEnabled"
    | "allowCustomerReschedule"
    | "allowCustomerCancel"
    | "crossStoreTherapistEnabled"
  >
> = {
  deposits: "depositsEnabled",
  packages: "packagesEnabled",
  customer_reschedule: "allowCustomerReschedule",
  customer_cancel: "allowCustomerCancel",
  cross_store_therapists: "crossStoreTherapistEnabled",
};

export function createDefaultStoreBookingSettings(params: {
  tenantId: string;
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
}): StoreBookingSettings {
  return {
    id: null,
    tenantId: params.tenantId,
    branchId: params.branchId ?? null,
    branchCode: params.branchCode ?? null,
    branchName: params.branchName ?? null,
    resolvedFromScope: params.branchId ? "branch_override" : "tenant_default",
    depositsEnabled: false,
    packagesEnabled: true,
    depositRequiredMode: "optional",
    depositCalculationType: "fixed",
    depositValue: 0,
    allowCustomerReschedule: true,
    allowCustomerCancel: true,
    latestCancelHours: 24,
    latestRescheduleHours: 24,
    notificationsEnabled: true,
    reminderDayBeforeEnabled: true,
    reminderHourBeforeEnabled: true,
    depositReminderEnabled: true,
    crossStoreTherapistEnabled: false,
    bookingWindowDays: 30,
    minAdvanceMinutes: 120,
    slotIntervalMinutes: 30,
    timezone: "Asia/Taipei",
    notes: "",
    updatedAt: null,
  };
}

function capabilityStoreEnabled(key: BookingCapabilityKey, settings: Pick<
  StoreBookingSettings,
  | "depositsEnabled"
  | "packagesEnabled"
  | "allowCustomerReschedule"
  | "allowCustomerCancel"
  | "notificationsEnabled"
  | "reminderDayBeforeEnabled"
  | "reminderHourBeforeEnabled"
  | "depositReminderEnabled"
  | "crossStoreTherapistEnabled"
>) {
  if (key === "deposits") return settings.depositsEnabled;
  if (key === "packages") return settings.packagesEnabled;
  if (key === "customer_reschedule") return settings.allowCustomerReschedule;
  if (key === "customer_cancel") return settings.allowCustomerCancel;
  if (key === "reminders") {
    return (
      settings.notificationsEnabled &&
      (settings.reminderDayBeforeEnabled || settings.reminderHourBeforeEnabled || settings.depositReminderEnabled)
    );
  }
  return settings.crossStoreTherapistEnabled;
}

export function createCapabilityFlagMap(rows: Array<{ key: string; enabled: boolean }>) {
  const map = new Map<string, boolean>();
  for (const row of rows) {
    map.set(String(row.key), Boolean(row.enabled));
  }
  return map;
}

export async function listTenantBookingCapabilityFlags(params: {
  supabase: SupabaseClient;
  tenantId: string;
}) {
  const result = await params.supabase
    .from("feature_flags")
    .select("id, tenant_id, key, enabled, updated_at")
    .eq("tenant_id", params.tenantId)
    .in("key", BOOKING_CAPABILITY_DEFS.map((item) => item.flagKey))
    .order("key", { ascending: true });

  if (result.error) {
    const lower = String(result.error.message || "").toLowerCase();
    if (lower.includes("feature_flags") && lower.includes("does not exist")) {
      return { ok: true as const, items: [] as Array<{ id: string; tenant_id: string; key: string; enabled: boolean; updated_at: string }>, warning: "feature_flags table not found" };
    }
    return { ok: false as const, error: result.error.message };
  }

  return {
    ok: true as const,
    items: (result.data || []) as Array<{ id: string; tenant_id: string; key: string; enabled: boolean; updated_at: string }>,
    warning: null,
  };
}

export function applyPlatformCapabilitiesToSettings(params: {
  settings: StoreBookingSettings;
  flagMap: Map<string, boolean>;
}): StoreBookingSettings {
  const allows = (flagKey: string) => params.flagMap.get(flagKey) ?? true;
  const notificationsEnabled = allows("capability.booking.reminders") ? params.settings.notificationsEnabled : false;

  return {
    ...params.settings,
    depositsEnabled: allows("capability.booking.deposits") ? params.settings.depositsEnabled : false,
    packagesEnabled: allows("capability.booking.packages") ? params.settings.packagesEnabled : false,
    allowCustomerReschedule: allows("capability.booking.customer_reschedule")
      ? params.settings.allowCustomerReschedule
      : false,
    allowCustomerCancel: allows("capability.booking.customer_cancel") ? params.settings.allowCustomerCancel : false,
    notificationsEnabled,
    reminderDayBeforeEnabled: notificationsEnabled ? params.settings.reminderDayBeforeEnabled : false,
    reminderHourBeforeEnabled: notificationsEnabled ? params.settings.reminderHourBeforeEnabled : false,
    depositReminderEnabled: notificationsEnabled ? params.settings.depositReminderEnabled : false,
    crossStoreTherapistEnabled: allows("capability.booking.cross_store_therapists")
      ? params.settings.crossStoreTherapistEnabled
      : false,
  };
}

export function clampStoreBookingSettingsForPlatform(params: {
  settings: StoreBookingSettings;
  flagMap: Map<string, boolean>;
}): StoreBookingSettings {
  return applyPlatformCapabilitiesToSettings(params);
}

export function setCapabilityStoreEnabled(params: {
  settings: StoreBookingSettings;
  key: BookingCapabilityKey;
  enabled: boolean;
}): StoreBookingSettings {
  if (params.key === "reminders") {
    if (!params.enabled) {
      return {
        ...params.settings,
        notificationsEnabled: false,
        reminderDayBeforeEnabled: false,
        reminderHourBeforeEnabled: false,
        depositReminderEnabled: false,
      };
    }
    return {
      ...params.settings,
      notificationsEnabled: true,
      reminderDayBeforeEnabled:
        params.settings.reminderDayBeforeEnabled ||
        (!params.settings.reminderDayBeforeEnabled &&
          !params.settings.reminderHourBeforeEnabled &&
          !params.settings.depositReminderEnabled),
      reminderHourBeforeEnabled: params.settings.reminderHourBeforeEnabled,
      depositReminderEnabled: params.settings.depositReminderEnabled,
    };
  }

  const field = BOOKING_CAPABILITY_STORE_FIELD_MAP[params.key];
  return {
    ...params.settings,
    [field]: params.enabled,
  };
}

export function resolveBookingCapabilityStates(params: {
  settings: StoreBookingSettings;
  flagMap: Map<string, boolean>;
}): BookingCapabilityState[] {
  const effective = applyPlatformCapabilitiesToSettings(params);
  return BOOKING_CAPABILITY_DEFS.map((item) => {
    const platformAllowed = params.flagMap.get(item.flagKey) ?? true;
    const storeEnabled = capabilityStoreEnabled(item.key, params.settings);
    const effectiveEnabled = capabilityStoreEnabled(item.key, effective);
    return {
      key: item.key,
      flagKey: item.flagKey,
      label: item.label,
      description: item.description,
      platformAllowed,
      storeEnabled,
      effectiveEnabled,
    };
  });
}
