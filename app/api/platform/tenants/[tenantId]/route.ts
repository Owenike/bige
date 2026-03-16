import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import {
  BOOKING_CAPABILITY_DEFS,
  createDefaultStoreBookingSettings,
  setCapabilityStoreEnabled,
} from "../../../../../lib/platform-booking-capabilities";
import { getPlatformTenantDetail } from "../../../../../lib/platform-admin-overview";
import type { StoreBookingSettings } from "../../../../../types/storefront";

type RouteContext = { params: Promise<{ tenantId: string }> };

type SettingsRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  deposits_enabled: boolean | null;
  packages_enabled: boolean | null;
  deposit_required_mode: "optional" | "required" | null;
  deposit_calculation_type: "fixed" | "percent" | null;
  deposit_value: number | string | null;
  allow_customer_reschedule: boolean | null;
  allow_customer_cancel: boolean | null;
  latest_cancel_hours: number | string | null;
  latest_reschedule_hours: number | string | null;
  notifications_enabled: boolean | null;
  reminder_day_before_enabled: boolean | null;
  reminder_hour_before_enabled: boolean | null;
  deposit_reminder_enabled: boolean | null;
  cross_store_therapist_enabled: boolean | null;
  booking_window_days: number | string | null;
  min_advance_minutes: number | string | null;
  slot_interval_minutes: number | string | null;
  timezone: string | null;
  notes: string | null;
  updated_at: string | null;
};

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapSettings(row: SettingsRow | null, tenantId: string): StoreBookingSettings {
  const base = createDefaultStoreBookingSettings({ tenantId });
  if (!row) return base;
  return {
    ...base,
    id: row.id,
    branchId: row.branch_id,
    resolvedFromScope: row.branch_id ? "branch_override" : "tenant_default",
    depositsEnabled: row.deposits_enabled ?? base.depositsEnabled,
    packagesEnabled: row.packages_enabled ?? base.packagesEnabled,
    depositRequiredMode: row.deposit_required_mode ?? base.depositRequiredMode,
    depositCalculationType: row.deposit_calculation_type ?? base.depositCalculationType,
    depositValue: toNumber(row.deposit_value),
    allowCustomerReschedule: row.allow_customer_reschedule ?? base.allowCustomerReschedule,
    allowCustomerCancel: row.allow_customer_cancel ?? base.allowCustomerCancel,
    latestCancelHours: toNumber(row.latest_cancel_hours || base.latestCancelHours),
    latestRescheduleHours: toNumber(row.latest_reschedule_hours || base.latestRescheduleHours),
    notificationsEnabled: row.notifications_enabled ?? base.notificationsEnabled,
    reminderDayBeforeEnabled: row.reminder_day_before_enabled ?? base.reminderDayBeforeEnabled,
    reminderHourBeforeEnabled: row.reminder_hour_before_enabled ?? base.reminderHourBeforeEnabled,
    depositReminderEnabled: row.deposit_reminder_enabled ?? base.depositReminderEnabled,
    crossStoreTherapistEnabled: row.cross_store_therapist_enabled ?? base.crossStoreTherapistEnabled,
    bookingWindowDays: toNumber(row.booking_window_days || base.bookingWindowDays),
    minAdvanceMinutes: toNumber(row.min_advance_minutes || base.minAdvanceMinutes),
    slotIntervalMinutes: toNumber(row.slot_interval_minutes || base.slotIntervalMinutes),
    timezone: row.timezone || base.timezone,
    notes: row.notes || base.notes,
    updatedAt: row.updated_at,
  };
}

function serializeSettings(settings: StoreBookingSettings, tenantId: string) {
  return {
    tenant_id: tenantId,
    branch_id: null,
    deposits_enabled: settings.depositsEnabled,
    packages_enabled: settings.packagesEnabled,
    deposit_required_mode: settings.depositRequiredMode,
    deposit_calculation_type: settings.depositCalculationType,
    deposit_value: settings.depositValue,
    allow_customer_reschedule: settings.allowCustomerReschedule,
    allow_customer_cancel: settings.allowCustomerCancel,
    latest_cancel_hours: settings.latestCancelHours,
    latest_reschedule_hours: settings.latestRescheduleHours,
    notifications_enabled: settings.notificationsEnabled,
    reminder_day_before_enabled: settings.reminderDayBeforeEnabled,
    reminder_hour_before_enabled: settings.reminderHourBeforeEnabled,
    deposit_reminder_enabled: settings.depositReminderEnabled,
    cross_store_therapist_enabled: settings.crossStoreTherapistEnabled,
    booking_window_days: settings.bookingWindowDays,
    min_advance_minutes: settings.minAdvanceMinutes,
    slot_interval_minutes: settings.slotIntervalMinutes,
    timezone: settings.timezone,
    notes: settings.notes,
    updated_at: new Date().toISOString(),
  };
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const { tenantId } = await context.params;
  const params = new URL(request.url).searchParams;

  try {
    const data = await getPlatformTenantDetail({
      tenantId,
      preset: params.get("preset"),
      dateFrom: params.get("date_from") || params.get("dateFrom"),
      dateTo: params.get("date_to") || params.get("dateTo"),
    });
    return apiSuccess(data);
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to load tenant detail");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const { tenantId } = await context.params;
  const body = await request.json().catch(() => null);
  const mode = typeof body?.mode === "string" ? body.mode : "";
  const capabilityKey = typeof body?.capabilityKey === "string" ? body.capabilityKey : "";
  const enabled = Boolean(body?.enabled);
  const capability = BOOKING_CAPABILITY_DEFS.find((item) => item.key === capabilityKey);

  if (!capability) {
    return apiError(400, "FORBIDDEN", "Invalid capability key");
  }

  if (mode === "platform_capability") {
    const { error } = await auth.supabase
      .from("feature_flags")
      .upsert(
        {
          tenant_id: tenantId,
          key: capability.flagKey,
          enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,key" },
      );
    if (error) return apiError(500, "INTERNAL_ERROR", error.message);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: auth.context.userId,
      action: enabled ? "platform_capability_enabled" : "platform_capability_disabled",
      target_type: "feature_flag",
      target_id: capability.flagKey,
      reason: null,
      payload: { capabilityKey, enabled, layer: "platform" },
    });
  } else if (mode === "store_setting") {
    const currentResult = await auth.supabase
      .from("store_booking_settings")
      .select("id, tenant_id, branch_id, deposits_enabled, packages_enabled, deposit_required_mode, deposit_calculation_type, deposit_value, allow_customer_reschedule, allow_customer_cancel, latest_cancel_hours, latest_reschedule_hours, notifications_enabled, reminder_day_before_enabled, reminder_hour_before_enabled, deposit_reminder_enabled, cross_store_therapist_enabled, booking_window_days, min_advance_minutes, slot_interval_minutes, timezone, notes, updated_at")
      .eq("tenant_id", tenantId)
      .is("branch_id", null)
      .maybeSingle();
    if (currentResult.error) return apiError(500, "INTERNAL_ERROR", currentResult.error.message);

    const nextSettings = setCapabilityStoreEnabled({
      settings: mapSettings((currentResult.data || null) as SettingsRow | null, tenantId),
      key: capability.key,
      enabled,
    });

    const { error } = await auth.supabase
      .from("store_booking_settings")
      .upsert(serializeSettings(nextSettings, tenantId), { onConflict: "tenant_id,branch_id" });
    if (error) return apiError(500, "INTERNAL_ERROR", error.message);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: auth.context.userId,
      action: "platform_store_booking_setting_updated",
      target_type: "store_booking_settings",
      target_id: tenantId,
      reason: null,
      payload: { capabilityKey, enabled, layer: "store_default" },
    });
  } else {
    return apiError(400, "FORBIDDEN", "Invalid update mode");
  }

  try {
    const data = await getPlatformTenantDetail({ tenantId });
    return apiSuccess(data);
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to refresh tenant detail");
  }
}
