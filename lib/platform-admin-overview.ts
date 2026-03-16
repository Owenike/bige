import { createSupabaseAdminClient } from "./supabase/admin";
import {
  createCapabilityFlagMap,
  createDefaultStoreBookingSettings,
  resolveBookingCapabilityStates,
} from "./platform-booking-capabilities";
import { getPlatformTenantOpsDetail, getPlatformTenantOpsOverview } from "./platform-tenant-ops";
import type {
  PlatformOverviewResponse,
  PlatformOverviewTenantItem,
  PlatformStorefrontSummary,
  PlatformTenantBranchItem,
  PlatformTenantDetailResponse,
  PlatformTenantNotificationSummary,
  PlatformTenantPackageSummary,
  PlatformTenantPaymentSummary,
  PlatformTenantServiceItem,
  PlatformTenantTherapistItem,
  PlatformOverviewRange,
  PlatformOverviewPreset,
} from "../types/platform-admin-overview";
import type { StoreBookingSettings } from "../types/storefront";

type TenantRow = { id: string; name: string; status: string | null; updated_at: string | null };
type BranchRow = { id: string; tenant_id: string; name: string; code: string | null; is_active: boolean | null };
type ProfileRow = { id: string; tenant_id: string | null; branch_id: string | null; display_name: string | null; role: string; is_active: boolean | null };
type CoachBranchLinkRow = { tenant_id: string; branch_id: string; coach_id: string; is_active: boolean | null };
type ServiceRow = { id: string; tenant_id: string; branch_id: string | null; name: string; code: string | null; price_amount: number | string | null; is_active: boolean | null };
type BookingRow = { id: string; tenant_id: string; branch_id: string | null; coach_id: string | null; service_name: string; starts_at: string; status: string; payment_status: string | null; booking_payment_mode: string | null; final_amount: number | string | null; outstanding_amount: number | string | null; deposit_paid_amount: number | string | null; package_sessions_reserved: number | string | null; package_sessions_consumed: number | string | null; updated_at: string | null };
type NotificationRow = { tenant_id: string | null; status: string | null; source_ref_type: string | null; created_at: string; scheduled_for: string | null; sent_at: string | null };
type SettingsRow = { id: string; tenant_id: string; branch_id: string | null; deposits_enabled: boolean | null; packages_enabled: boolean | null; deposit_required_mode: "optional" | "required" | null; deposit_calculation_type: "fixed" | "percent" | null; deposit_value: number | string | null; allow_customer_reschedule: boolean | null; allow_customer_cancel: boolean | null; latest_cancel_hours: number | string | null; latest_reschedule_hours: number | string | null; notifications_enabled: boolean | null; reminder_day_before_enabled: boolean | null; reminder_hour_before_enabled: boolean | null; deposit_reminder_enabled: boolean | null; cross_store_therapist_enabled: boolean | null; booking_window_days: number | string | null; min_advance_minutes: number | string | null; slot_interval_minutes: number | string | null; timezone: string | null; notes: string | null; updated_at: string | null };
type FeatureFlagRow = { tenant_id: string; key: string; enabled: boolean };
type BrandRow = { tenant_id: string; branch_id: string | null; brand_name: string | null; hero_title: string | null; hero_image_url: string | null; mobile_feature_image_url: string | null; updated_at: string | null };
type BrandAssetRow = { tenant_id: string; is_active: boolean | null; updated_at: string | null };
type EntryPassRow = { tenant_id: string; status: string | null };
type PlanCatalogRow = { tenant_id: string; is_active: boolean | null; plan_type: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxIso(values: Array<string | null | undefined>) {
  let next: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!next || new Date(value).getTime() > new Date(next).getTime()) next = value;
  }
  return next;
}

function safeRatio(a: number, b: number) {
  return b > 0 ? a / b : 0;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonth(date: string) {
  return `${date.slice(0, 8)}01`;
}

function startOfWeek(date: string) {
  const target = new Date(`${date}T00:00:00.000Z`);
  const day = target.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  target.setUTCDate(target.getUTCDate() + delta);
  return target.toISOString().slice(0, 10);
}

export function resolvePlatformOverviewRange(params: {
  preset?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): PlatformOverviewRange & { fromIso: string; toIso: string } {
  const preset = (params.preset || "this_month") as PlatformOverviewPreset;
  const today = getTodayDateString();
  if (preset === "today") return { preset, dateFrom: today, dateTo: today, fromIso: `${today}T00:00:00.000Z`, toIso: `${today}T23:59:59.999Z` };
  if (preset === "this_week") {
    const dateFrom = startOfWeek(today);
    return { preset, dateFrom, dateTo: today, fromIso: `${dateFrom}T00:00:00.000Z`, toIso: `${today}T23:59:59.999Z` };
  }
  if (preset === "this_month") {
    const dateFrom = startOfMonth(today);
    return { preset, dateFrom, dateTo: today, fromIso: `${dateFrom}T00:00:00.000Z`, toIso: `${today}T23:59:59.999Z` };
  }
  const dateFrom = params.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(params.dateFrom) ? params.dateFrom : today;
  const dateTo = params.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(params.dateTo) ? params.dateTo : dateFrom;
  return { preset: "custom", dateFrom, dateTo, fromIso: `${dateFrom}T00:00:00.000Z`, toIso: `${dateTo}T23:59:59.999Z` };
}

function isMissingTableError(message: string | undefined, table: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (lower.includes("does not exist") || lower.includes("could not find the table")) && lower.includes(table.toLowerCase());
}

async function safeSelect<T>(promise: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>, table: string) {
  const result = await promise;
  if (result.error) {
    if (isMissingTableError(result.error.message, table)) return { rows: [] as T[], warning: `${table} table missing` };
    throw new Error(result.error.message || `Failed to load ${table}`);
  }
  return { rows: (result.data || []) as T[], warning: null as string | null };
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

function mapStorefront(brand: BrandRow | null, activeAssetCount: number): PlatformStorefrontSummary {
  return {
    brandName: brand?.brand_name || null,
    configured: Boolean((brand?.brand_name && brand.brand_name.trim()) || brand?.hero_title || brand?.hero_image_url || brand?.mobile_feature_image_url || activeAssetCount > 0),
    hasHeroImage: Boolean(brand?.hero_image_url),
    hasMobileImage: Boolean(brand?.mobile_feature_image_url),
    activeAssetCount,
    updatedAt: brand?.updated_at || null,
  };
}

async function loadDataset(input: { tenantId?: string | null; range: ReturnType<typeof resolvePlatformOverviewRange> }) {
  const admin = createSupabaseAdminClient();
  const warnings: string[] = [];
  let tenantsQuery = admin.from("tenants").select("id, name, status, updated_at").order("created_at", { ascending: false });
  if (input.tenantId) tenantsQuery = tenantsQuery.eq("id", input.tenantId);
  const tenantsResult = await tenantsQuery;
  if (tenantsResult.error) throw new Error(tenantsResult.error.message);
  const tenants = (tenantsResult.data || []) as TenantRow[];
  const tenantIds = tenants.map((item) => item.id);
  if (tenantIds.length === 0) {
    return {
      warnings,
      tenants,
      branches: [] as BranchRow[],
      therapists: [] as ProfileRow[],
      coachBranchLinks: [] as CoachBranchLinkRow[],
      services: [] as ServiceRow[],
      bookings: [] as BookingRow[],
      notifications: [] as NotificationRow[],
      settingsRows: [] as SettingsRow[],
      featureFlags: [] as FeatureFlagRow[],
      brandRows: [] as BrandRow[],
      brandAssets: [] as BrandAssetRow[],
      entryPasses: [] as EntryPassRow[],
      packageCatalog: [] as PlanCatalogRow[],
      supportOverview: null as Awaited<ReturnType<typeof getPlatformTenantOpsOverview>> | null,
      supportDetail: null as Awaited<ReturnType<typeof getPlatformTenantOpsDetail>> | null,
    };
  }

  const rangeDays = Math.max(1, Math.ceil((new Date(input.range.toIso).getTime() - new Date(input.range.fromIso).getTime()) / DAY_MS) + 1);
  const [
    branches,
    therapists,
    coachBranchLinks,
    services,
    bookings,
    notifications,
    settingsRows,
    featureFlags,
    brandRows,
    brandAssets,
    entryPasses,
    packageCatalog,
    supportOverview,
    supportDetail,
  ] = await Promise.all([
    safeSelect<BranchRow>(admin.from("branches").select("id, tenant_id, name, code, is_active").in("tenant_id", tenantIds), "branches"),
    safeSelect<ProfileRow>(admin.from("profiles").select("id, tenant_id, branch_id, display_name, role, is_active").in("tenant_id", tenantIds).in("role", ["coach", "therapist"]).eq("is_active", true), "profiles"),
    safeSelect<CoachBranchLinkRow>(admin.from("coach_branch_links").select("tenant_id, branch_id, coach_id, is_active").in("tenant_id", tenantIds).eq("is_active", true), "coach_branch_links"),
    safeSelect<ServiceRow>(admin.from("services").select("id, tenant_id, branch_id, name, code, price_amount, is_active").in("tenant_id", tenantIds).eq("is_active", true), "services"),
    safeSelect<BookingRow>(admin.from("bookings").select("id, tenant_id, branch_id, coach_id, service_name, starts_at, status, payment_status, booking_payment_mode, final_amount, outstanding_amount, deposit_paid_amount, package_sessions_reserved, package_sessions_consumed, updated_at").in("tenant_id", tenantIds).gte("starts_at", input.range.fromIso).lte("starts_at", input.range.toIso).order("starts_at", { ascending: false }).limit(20000), "bookings"),
    safeSelect<NotificationRow>(admin.from("notification_deliveries").select("tenant_id, status, source_ref_type, created_at, scheduled_for, sent_at").in("tenant_id", tenantIds).gte("created_at", input.range.fromIso).lte("created_at", input.range.toIso).limit(20000), "notification_deliveries"),
    safeSelect<SettingsRow>(admin.from("store_booking_settings").select("id, tenant_id, branch_id, deposits_enabled, packages_enabled, deposit_required_mode, deposit_calculation_type, deposit_value, allow_customer_reschedule, allow_customer_cancel, latest_cancel_hours, latest_reschedule_hours, notifications_enabled, reminder_day_before_enabled, reminder_hour_before_enabled, deposit_reminder_enabled, cross_store_therapist_enabled, booking_window_days, min_advance_minutes, slot_interval_minutes, timezone, notes, updated_at").in("tenant_id", tenantIds), "store_booking_settings"),
    safeSelect<FeatureFlagRow>(admin.from("feature_flags").select("tenant_id, key, enabled").in("tenant_id", tenantIds), "feature_flags"),
    safeSelect<BrandRow>(admin.from("storefront_brand_contents").select("tenant_id, branch_id, brand_name, hero_title, hero_image_url, mobile_feature_image_url, updated_at").in("tenant_id", tenantIds), "storefront_brand_contents"),
    safeSelect<BrandAssetRow>(admin.from("storefront_brand_assets").select("tenant_id, is_active, updated_at").in("tenant_id", tenantIds).eq("is_active", true), "storefront_brand_assets"),
    safeSelect<EntryPassRow>(admin.from("entry_passes").select("tenant_id, status").in("tenant_id", tenantIds), "entry_passes"),
    safeSelect<PlanCatalogRow>(admin.from("member_plan_catalog").select("tenant_id, is_active, plan_type").in("tenant_id", tenantIds).in("plan_type", ["entry_pass", "coach_pack"]), "member_plan_catalog"),
    input.tenantId ? Promise.resolve(null) : getPlatformTenantOpsOverview({ rangeDays }),
    input.tenantId ? getPlatformTenantOpsDetail({ tenantId: input.tenantId, rangeDays }) : Promise.resolve(null),
  ]);

  for (const result of [branches, therapists, coachBranchLinks, services, bookings, notifications, settingsRows, featureFlags, brandRows, brandAssets, entryPasses, packageCatalog]) {
    if (result.warning) warnings.push(result.warning);
  }
  if (supportOverview?.ok) warnings.push(...supportOverview.data.warnings);
  if (supportDetail?.ok) warnings.push(...supportDetail.data.warnings);

  return {
    warnings: Array.from(new Set(warnings)),
    tenants,
    branches: branches.rows,
    therapists: therapists.rows,
    coachBranchLinks: coachBranchLinks.rows,
    services: services.rows,
    bookings: bookings.rows,
    notifications: notifications.rows,
    settingsRows: settingsRows.rows,
    featureFlags: featureFlags.rows,
    brandRows: brandRows.rows,
    brandAssets: brandAssets.rows,
    entryPasses: entryPasses.rows,
    packageCatalog: packageCatalog.rows,
    supportOverview,
    supportDetail,
  };
}

function buildSupportMap(overview: Awaited<ReturnType<typeof getPlatformTenantOpsOverview>> | null) {
  const map = new Map<string, { supportScore: number; supportFlags: string[] }>();
  if (!overview?.ok) return map;
  for (const item of overview.data.items) {
    map.set(item.tenantId, { supportScore: item.supportScore, supportFlags: item.supportFlags });
  }
  return map;
}

function buildOverviewItems(data: Awaited<ReturnType<typeof loadDataset>>) {
  const supportMap = buildSupportMap(data.supportOverview);
  return data.tenants.map((tenant) => {
    const tenantBranches = data.branches.filter((item) => item.tenant_id === tenant.id);
    const tenantTherapists = data.therapists.filter((item) => item.tenant_id === tenant.id);
    const tenantCoachLinks = data.coachBranchLinks.filter((item) => item.tenant_id === tenant.id && item.is_active !== false);
    const tenantServices = data.services.filter((item) => item.tenant_id === tenant.id);
    const tenantBookings = data.bookings.filter((item) => item.tenant_id === tenant.id);
    const tenantNotifications = data.notifications.filter((item) => item.tenant_id === tenant.id);
    const tenantSettings = mapSettings(data.settingsRows.find((item) => item.tenant_id === tenant.id && item.branch_id === null) || data.settingsRows.find((item) => item.tenant_id === tenant.id) || null, tenant.id);
    const capabilities = resolveBookingCapabilityStates({ settings: tenantSettings, flagMap: createCapabilityFlagMap(data.featureFlags.filter((item) => item.tenant_id === tenant.id)) });
    const storefront = mapStorefront(data.brandRows.find((item) => item.tenant_id === tenant.id && item.branch_id === null) || data.brandRows.find((item) => item.tenant_id === tenant.id) || null, data.brandAssets.filter((item) => item.tenant_id === tenant.id && item.is_active !== false).length);
    const completedCount = tenantBookings.filter((item) => item.status === "completed").length;
    const cancelledCount = tenantBookings.filter((item) => item.status === "cancelled").length;
    const noShowCount = tenantBookings.filter((item) => item.status === "no_show").length;
    const support = supportMap.get(tenant.id) || { supportScore: 0, supportFlags: [] };

    return {
      tenantId: tenant.id,
      tenantName: tenant.name || tenant.id,
      tenantStatus: tenant.status,
      branchCount: tenantBranches.length || new Set(tenantCoachLinks.map((item) => item.branch_id)).size,
      therapistCount: tenantTherapists.length,
      serviceCount: tenantServices.length,
      bookingTotal: tenantBookings.length,
      completedCount,
      cancelledCount,
      noShowCount,
      completionRate: safeRatio(completedCount, tenantBookings.length),
      depositPendingCount: tenantBookings.filter((item) => item.payment_status === "deposit_pending" && !["cancelled", "completed", "no_show"].includes(item.status)).length,
      packageReservedSessionsCount: tenantBookings.reduce((sum, item) => sum + toNumber(item.package_sessions_reserved), 0),
      packageConsumedSessionsCount: tenantBookings.reduce((sum, item) => sum + toNumber(item.package_sessions_consumed), 0),
      notificationQueuedCount: tenantNotifications.filter((item) => item.status === "pending" || item.status === "retrying").length,
      notificationFailedCount: tenantNotifications.filter((item) => item.status === "failed" || item.status === "dead_letter").length,
      recentActivityAt: maxIso([
        tenant.updated_at,
        tenantSettings.updatedAt,
        storefront.updatedAt,
        ...tenantBookings.map((item) => item.updated_at || item.starts_at),
        ...tenantNotifications.map((item) => item.sent_at || item.scheduled_for || item.created_at),
      ]),
      supportScore: support.supportScore,
      supportFlags: support.supportFlags,
      capabilities,
      storefront,
    } satisfies PlatformOverviewTenantItem;
  });
}

export async function getPlatformOverview(input: {
  preset?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  search?: string | null;
  tenantStatus?: string | null;
  page?: number | null;
  pageSize?: number | null;
}): Promise<PlatformOverviewResponse> {
  const range = resolvePlatformOverviewRange(input);
  const data = await loadDataset({ range });
  const search = (input.search || "").trim().toLowerCase();
  const tenantStatus = (input.tenantStatus || "all").toLowerCase();
  const page = Math.max(1, input.page || 1);
  const pageSize = Math.min(50, Math.max(6, input.pageSize || 20));

  let items = buildOverviewItems(data);
  if (tenantStatus !== "all") {
    items = items.filter((item) => (item.tenantStatus || "").toLowerCase() === tenantStatus);
  }
  if (search) {
    items = items.filter((item) => {
      const capabilityText = item.capabilities.map((capability) => `${capability.label} ${capability.flagKey}`).join(" ").toLowerCase();
      return (
        item.tenantName.toLowerCase().includes(search) ||
        item.tenantId.toLowerCase().includes(search) ||
        (item.storefront.brandName || "").toLowerCase().includes(search) ||
        capabilityText.includes(search)
      );
    });
  }
  items.sort((left, right) => {
    const activityDelta = new Date(right.recentActivityAt || 0).getTime() - new Date(left.recentActivityAt || 0).getTime();
    if (activityDelta !== 0) return activityDelta;
    return left.tenantName.localeCompare(right.tenantName);
  });

  const summary = items.reduce(
    (acc, item) => {
      acc.tenantTotal += 1;
      if (item.tenantStatus === "active") acc.activeTenantCount += 1;
      acc.bookingTotal += item.bookingTotal;
      acc.completedCount += item.completedCount;
      acc.cancelledCount += item.cancelledCount;
      acc.noShowCount += item.noShowCount;
      acc.depositPendingCount += item.depositPendingCount;
      acc.notificationsFailedCount += item.notificationFailedCount;
      acc.packageConsumedSessionsCount += item.packageConsumedSessionsCount;
      return acc;
    },
    {
      tenantTotal: 0,
      activeTenantCount: 0,
      bookingTotal: 0,
      completedCount: 0,
      cancelledCount: 0,
      noShowCount: 0,
      depositPendingCount: 0,
      notificationsFailedCount: 0,
      packageConsumedSessionsCount: 0,
    },
  );

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const paginatedItems = items.slice((page - 1) * pageSize, page * pageSize);

  return {
    generatedAt: new Date().toISOString(),
    range: { preset: range.preset, dateFrom: range.dateFrom, dateTo: range.dateTo },
    filters: {
      statuses: [
        { value: "all", label: "All tenants" },
        { value: "active", label: "Active" },
        { value: "suspended", label: "Suspended" },
        { value: "disabled", label: "Disabled" },
      ],
      presets: [
        { value: "today", label: "Today" },
        { value: "this_week", label: "This Week" },
        { value: "this_month", label: "This Month" },
        { value: "custom", label: "Custom" },
      ],
    },
    summary,
    items: paginatedItems,
    pagination: { page, pageSize, totalItems, totalPages },
    warnings: data.warnings,
  };
}

export async function getPlatformTenantDetail(input: {
  tenantId: string;
  preset?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<PlatformTenantDetailResponse> {
  const range = resolvePlatformOverviewRange(input);
  const data = await loadDataset({ tenantId: input.tenantId, range });
  const overviewItem = buildOverviewItems(data)[0];
  if (!overviewItem) throw new Error("Tenant not found");

  const tenant = data.tenants[0];
  const tenantBranches = data.branches.filter((item) => item.tenant_id === input.tenantId);
  const tenantTherapists = data.therapists.filter((item) => item.tenant_id === input.tenantId);
  const tenantServices = data.services.filter((item) => item.tenant_id === input.tenantId);
  const tenantBookings = data.bookings.filter((item) => item.tenant_id === input.tenantId);
  const tenantNotifications = data.notifications.filter((item) => item.tenant_id === input.tenantId);
  const tenantFlags = data.featureFlags.filter((item) => item.tenant_id === input.tenantId);
  const tenantSettings = mapSettings(data.settingsRows.find((item) => item.tenant_id === input.tenantId && item.branch_id === null) || data.settingsRows.find((item) => item.tenant_id === input.tenantId) || null, input.tenantId);
  const capabilities = resolveBookingCapabilityStates({ settings: tenantSettings, flagMap: createCapabilityFlagMap(tenantFlags) });
  const storefront = overviewItem.storefront;
  const branchMap = new Map(tenantBranches.map((item) => [item.id, item.name]));

  const paymentSummary: PlatformTenantPaymentSummary = {
    depositPendingCount: overviewItem.depositPendingCount,
    depositPaidTotal: tenantBookings.reduce((sum, item) => sum + toNumber(item.deposit_paid_amount), 0),
    outstandingTotal: tenantBookings.filter((item) => item.status !== "cancelled").reduce((sum, item) => sum + toNumber(item.outstanding_amount), 0),
    singleBookingRevenueTotal: tenantBookings.filter((item) => (item.booking_payment_mode || "single") === "single").reduce((sum, item) => sum + toNumber(item.final_amount), 0),
    fullyPaidCount: tenantBookings.filter((item) => item.payment_status === "fully_paid").length,
  };

  const packageSummary: PlatformTenantPackageSummary = {
    activeEntryPassCount: data.entryPasses.filter((item) => item.tenant_id === input.tenantId && ["active", "pending"].includes(item.status || "")).length,
    activeTemplateCount: data.packageCatalog.filter((item) => item.tenant_id === input.tenantId && item.is_active !== false).length,
    reservedSessionsCount: overviewItem.packageReservedSessionsCount,
    consumedSessionsCount: overviewItem.packageConsumedSessionsCount,
    activePackageBookingCount: tenantBookings.filter((item) => item.booking_payment_mode === "package").length,
  };

  const notificationSummary = tenantNotifications.reduce<PlatformTenantNotificationSummary>(
    (acc, item) => {
      if (item.status === "pending" || item.status === "retrying") acc.queuedCount += 1;
      if (item.status === "sent") acc.sentCount += 1;
      if (item.status === "failed" || item.status === "dead_letter") acc.failedCount += 1;
      if (item.status === "cancelled") acc.cancelledCount += 1;
      if ((item.source_ref_type === "booking_reminder_day_before" || item.source_ref_type === "booking_reminder_1h") && (item.status === "pending" || item.status === "retrying")) acc.reminderQueuedCount += 1;
      if ((item.source_ref_type === "booking_reminder_day_before" || item.source_ref_type === "booking_reminder_1h") && item.status === "sent") acc.reminderSentCount += 1;
      if (item.source_ref_type === "booking_deposit_pending" && (item.status === "pending" || item.status === "retrying")) acc.depositPendingQueuedCount += 1;
      acc.latestNotificationAt = maxIso([acc.latestNotificationAt, item.sent_at, item.scheduled_for, item.created_at]);
      return acc;
    },
    { queuedCount: 0, sentCount: 0, failedCount: 0, cancelledCount: 0, reminderQueuedCount: 0, reminderSentCount: 0, depositPendingQueuedCount: 0, latestNotificationAt: null },
  );

  const branches: PlatformTenantBranchItem[] = tenantBranches.map((branch) => ({
    branchId: branch.id,
    name: branch.name,
    code: branch.code,
    therapistCount: data.coachBranchLinks.filter((item) => item.tenant_id === input.tenantId && item.branch_id === branch.id && item.is_active !== false).length || tenantTherapists.filter((item) => item.branch_id === branch.id).length,
    serviceCount: tenantServices.filter((item) => !item.branch_id || item.branch_id === branch.id).length,
    bookingCount: tenantBookings.filter((item) => item.branch_id === branch.id).length,
    completedCount: tenantBookings.filter((item) => item.branch_id === branch.id && item.status === "completed").length,
    isActive: branch.is_active !== false,
  })).sort((left, right) => right.bookingCount - left.bookingCount || left.name.localeCompare(right.name));

  const therapists: PlatformTenantTherapistItem[] = tenantTherapists.map((therapist) => {
    const bookings = tenantBookings.filter((item) => item.coach_id === therapist.id);
    return {
      therapistId: therapist.id,
      displayName: therapist.display_name || therapist.id,
      branchName: therapist.branch_id ? branchMap.get(therapist.branch_id) || null : null,
      bookingCount: bookings.length,
      completedCount: bookings.filter((item) => item.status === "completed").length,
      packageConsumedSessionsCount: bookings.reduce((sum, item) => sum + toNumber(item.package_sessions_consumed), 0),
    };
  }).sort((left, right) => right.completedCount - left.completedCount || right.bookingCount - left.bookingCount).slice(0, 12);

  const services: PlatformTenantServiceItem[] = tenantServices.map((service) => {
    const bookings = tenantBookings.filter((item) => item.service_name === service.name);
    return {
      serviceId: service.id,
      name: service.name,
      code: service.code,
      bookingCount: bookings.length,
      completedCount: bookings.filter((item) => item.status === "completed").length,
      averagePrice: bookings.length ? bookings.reduce((sum, item) => sum + toNumber(item.final_amount), 0) / bookings.length : toNumber(service.price_amount),
    };
  }).sort((left, right) => right.bookingCount - left.bookingCount || right.completedCount - left.completedCount).slice(0, 12);

  return {
    generatedAt: new Date().toISOString(),
    range: { preset: range.preset, dateFrom: range.dateFrom, dateTo: range.dateTo },
    tenant: { tenantId: tenant.id, tenantName: tenant.name || tenant.id, tenantStatus: tenant.status },
    bookingSummary: {
      branchCount: overviewItem.branchCount,
      therapistCount: overviewItem.therapistCount,
      serviceCount: overviewItem.serviceCount,
      bookingTotal: overviewItem.bookingTotal,
      completedCount: overviewItem.completedCount,
      cancelledCount: overviewItem.cancelledCount,
      noShowCount: overviewItem.noShowCount,
      completionRate: overviewItem.completionRate,
      depositPendingCount: overviewItem.depositPendingCount,
      packageReservedSessionsCount: overviewItem.packageReservedSessionsCount,
      packageConsumedSessionsCount: overviewItem.packageConsumedSessionsCount,
      notificationQueuedCount: overviewItem.notificationQueuedCount,
      notificationFailedCount: overviewItem.notificationFailedCount,
      recentActivityAt: overviewItem.recentActivityAt,
    },
    paymentSummary,
    packageSummary,
    notificationSummary,
    bookingSettings: tenantSettings,
    capabilities,
    storefront,
    branches,
    therapists,
    services,
    risk: {
      supportScore: overviewItem.supportScore,
      supportFlags: overviewItem.supportFlags,
      warnings: data.supportDetail?.ok ? Array.from(new Set([...data.warnings, ...data.supportDetail.data.warnings])) : data.warnings,
    },
  };
}
