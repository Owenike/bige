import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StorefrontBrandAsset,
  StoreBookingSettings,
  StorefrontBrandContent,
  StorefrontBranchSummary,
  StorefrontNavItem,
  StorefrontPayload,
  StorefrontServiceSummary,
  StorefrontTheme,
} from "../types/storefront";
import {
  applyPlatformCapabilitiesToSettings,
  createCapabilityFlagMap,
  listTenantBookingCapabilityFlags,
} from "./platform-booking-capabilities";

function isMissingSchemaObject(message: string | undefined, objectName: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = objectName.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target)) ||
    (lower.includes("column") && lower.includes(target))
  );
}

type BranchRow = {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
};

type BrandRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  brand_name: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  hero_image_url: string | null;
  mobile_feature_image_url: string | null;
  intro_title: string | null;
  intro_body: string | null;
  services_section_title: string | null;
  services_section_subtitle: string | null;
  booking_notice_title: string | null;
  booking_notice_body: string | null;
  contact_title: string | null;
  contact_body: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_address: string | null;
  contact_line: string | null;
  cta_primary_label: string | null;
  cta_secondary_label: string | null;
  about_section_enabled: boolean | null;
  team_section_enabled: boolean | null;
  portfolio_section_enabled: boolean | null;
  contact_section_enabled: boolean | null;
  custom_nav_items: StorefrontNavItem[] | null;
  business_hours: Array<{ label: string; value: string }> | null;
  theme: Partial<StorefrontTheme> | null;
  visual_preferences: Record<string, string | number | boolean | null> | null;
  updated_at: string | null;
};

type BookingSettingsRow = {
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
  latest_cancel_hours: number | null;
  latest_reschedule_hours: number | null;
  notifications_enabled: boolean | null;
  reminder_day_before_enabled: boolean | null;
  reminder_hour_before_enabled: boolean | null;
  deposit_reminder_enabled: boolean | null;
  cross_store_therapist_enabled: boolean | null;
  booking_window_days: number | null;
  min_advance_minutes: number | null;
  slot_interval_minutes: number | null;
  timezone: string | null;
  notes: string | null;
  updated_at: string | null;
};

type ServiceRow = {
  id: string;
  branch_id: string | null;
  code: string;
  name: string;
  description: string | null;
  duration_minutes: number | null;
  pre_buffer_minutes: number | null;
  post_buffer_minutes: number | null;
  price_amount: number | string | null;
  requires_deposit: boolean | null;
  deposit_calculation_type: "fixed" | "percent" | null;
  deposit_value: number | string | null;
};

type AssetRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  kind: "hero" | "mobile_feature" | "gallery" | "logo" | "other";
  bucket_name: string;
  storage_path: string;
  public_url: string;
  alt_text: string | null;
  metadata: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

const DEFAULT_THEME: StorefrontTheme = {
  accent: "#d8d3ff",
  tone: "obsidian",
  radius: "rounded",
};

export function createDefaultBrandContent(params: {
  tenantId: string;
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
}): StorefrontBrandContent {
  const branchName = params.branchName || "Flagship";
  return {
    id: null,
    tenantId: params.tenantId,
    branchId: params.branchId ?? null,
    branchCode: params.branchCode ?? null,
    branchName: params.branchName ?? null,
    resolvedFromScope: params.branchId ? "branch_override" : "tenant_default",
    brandName: branchName,
    heroTitle: `${branchName} Sports Massage`,
    heroSubtitle: "Precision recovery sessions designed for performance, mobility, and deep reset.",
    heroImageUrl: "",
    mobileFeatureImageUrl: "",
    introTitle: "Tailored recovery, quietly delivered.",
    introBody:
      "Build a storefront that feels like a premium studio rather than a generic booking form. Each store can control tone, hero copy, service framing, and contact information independently.",
    servicesSectionTitle: "Signature Sessions",
    servicesSectionSubtitle: "Service cards, pricing, buffers, and therapist matching will connect here in Phase 2.",
    bookingNoticeTitle: "Booking Notice",
    bookingNoticeBody:
      "Reschedule, cancellation, deposit, and arrival rules are controlled by each store. This text is editable per branch.",
    contactTitle: "Visit",
    contactBody: "Add address, transit guidance, parking hints, and contact details for each store.",
    contactPhone: "",
    contactEmail: "",
    contactAddress: "",
    contactLine: "",
    ctaPrimaryLabel: "Book Now",
    ctaSecondaryLabel: "View Services",
    aboutSectionEnabled: true,
    teamSectionEnabled: true,
    portfolioSectionEnabled: false,
    contactSectionEnabled: true,
    customNavItems: [
      { label: "Services", href: "#services" },
      { label: "About", href: "#about" },
      { label: "Booking", href: "#booking" },
      { label: "Contact", href: "#contact" },
    ],
    businessHours: [
      { label: "Mon - Fri", value: "11:00 - 21:00" },
      { label: "Sat - Sun", value: "10:00 - 20:00" },
    ],
    theme: DEFAULT_THEME,
    visualPreferences: {
      surface: "paper",
      heroLayout: "split",
      density: "airy",
    },
    updatedAt: null,
  };
}

export function createDefaultBookingSettings(params: {
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
    latestRescheduleHours: 12,
    notificationsEnabled: true,
    reminderDayBeforeEnabled: true,
    reminderHourBeforeEnabled: true,
    depositReminderEnabled: false,
    crossStoreTherapistEnabled: false,
    bookingWindowDays: 30,
    minAdvanceMinutes: 90,
    slotIntervalMinutes: 30,
    timezone: "Asia/Taipei",
    notes: "",
    updatedAt: null,
  };
}

export function mapBranchSummary(row: BranchRow): StorefrontBranchSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    code: row.code,
    address: row.address,
    isActive: row.is_active,
  };
}

function mergeTheme(value: Partial<StorefrontTheme> | null | undefined): StorefrontTheme {
  return {
    accent: value?.accent || DEFAULT_THEME.accent,
    tone: value?.tone || DEFAULT_THEME.tone,
    radius: value?.radius || DEFAULT_THEME.radius,
  };
}

export function mapBrandContentRow(params: {
  row: BrandRow | null;
  tenantId: string;
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  resolvedFromScope?: "tenant_default" | "branch_override";
}): StorefrontBrandContent {
  const fallback = createDefaultBrandContent(params);
  if (!params.row) {
    return {
      ...fallback,
      resolvedFromScope: params.resolvedFromScope || fallback.resolvedFromScope,
    };
  }
  return {
    ...fallback,
    id: params.row.id,
    resolvedFromScope: params.resolvedFromScope || fallback.resolvedFromScope,
    brandName: params.row.brand_name || fallback.brandName,
    heroTitle: params.row.hero_title || fallback.heroTitle,
    heroSubtitle: params.row.hero_subtitle || fallback.heroSubtitle,
    heroImageUrl: params.row.hero_image_url || "",
    mobileFeatureImageUrl: params.row.mobile_feature_image_url || "",
    introTitle: params.row.intro_title || fallback.introTitle,
    introBody: params.row.intro_body || fallback.introBody,
    servicesSectionTitle: params.row.services_section_title || fallback.servicesSectionTitle,
    servicesSectionSubtitle: params.row.services_section_subtitle || fallback.servicesSectionSubtitle,
    bookingNoticeTitle: params.row.booking_notice_title || fallback.bookingNoticeTitle,
    bookingNoticeBody: params.row.booking_notice_body || fallback.bookingNoticeBody,
    contactTitle: params.row.contact_title || fallback.contactTitle,
    contactBody: params.row.contact_body || fallback.contactBody,
    contactPhone: params.row.contact_phone || "",
    contactEmail: params.row.contact_email || "",
    contactAddress: params.row.contact_address || "",
    contactLine: params.row.contact_line || "",
    ctaPrimaryLabel: params.row.cta_primary_label || fallback.ctaPrimaryLabel,
    ctaSecondaryLabel: params.row.cta_secondary_label || fallback.ctaSecondaryLabel,
    aboutSectionEnabled: params.row.about_section_enabled ?? fallback.aboutSectionEnabled,
    teamSectionEnabled: params.row.team_section_enabled ?? fallback.teamSectionEnabled,
    portfolioSectionEnabled: params.row.portfolio_section_enabled ?? fallback.portfolioSectionEnabled,
    contactSectionEnabled: params.row.contact_section_enabled ?? fallback.contactSectionEnabled,
    customNavItems: Array.isArray(params.row.custom_nav_items) ? params.row.custom_nav_items : fallback.customNavItems,
    businessHours: Array.isArray(params.row.business_hours) ? params.row.business_hours : fallback.businessHours,
    theme: mergeTheme(params.row.theme),
    visualPreferences: params.row.visual_preferences || fallback.visualPreferences,
    updatedAt: params.row.updated_at,
  };
}

export function mapBookingSettingsRow(params: {
  row: BookingSettingsRow | null;
  tenantId: string;
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  resolvedFromScope?: "tenant_default" | "branch_override";
}): StoreBookingSettings {
  const fallback = createDefaultBookingSettings(params);
  if (!params.row) {
    return {
      ...fallback,
      resolvedFromScope: params.resolvedFromScope || fallback.resolvedFromScope,
    };
  }
  return {
    ...fallback,
    id: params.row.id,
    resolvedFromScope: params.resolvedFromScope || fallback.resolvedFromScope,
    depositsEnabled: params.row.deposits_enabled ?? fallback.depositsEnabled,
    packagesEnabled: params.row.packages_enabled ?? fallback.packagesEnabled,
    depositRequiredMode: params.row.deposit_required_mode || fallback.depositRequiredMode,
    depositCalculationType: params.row.deposit_calculation_type || fallback.depositCalculationType,
    depositValue: Number(params.row.deposit_value ?? fallback.depositValue),
    allowCustomerReschedule: params.row.allow_customer_reschedule ?? fallback.allowCustomerReschedule,
    allowCustomerCancel: params.row.allow_customer_cancel ?? fallback.allowCustomerCancel,
    latestCancelHours: params.row.latest_cancel_hours ?? fallback.latestCancelHours,
    latestRescheduleHours: params.row.latest_reschedule_hours ?? fallback.latestRescheduleHours,
    notificationsEnabled: params.row.notifications_enabled ?? fallback.notificationsEnabled,
    reminderDayBeforeEnabled: params.row.reminder_day_before_enabled ?? fallback.reminderDayBeforeEnabled,
    reminderHourBeforeEnabled: params.row.reminder_hour_before_enabled ?? fallback.reminderHourBeforeEnabled,
    depositReminderEnabled: params.row.deposit_reminder_enabled ?? fallback.depositReminderEnabled,
    crossStoreTherapistEnabled: params.row.cross_store_therapist_enabled ?? fallback.crossStoreTherapistEnabled,
    bookingWindowDays: params.row.booking_window_days ?? fallback.bookingWindowDays,
    minAdvanceMinutes: params.row.min_advance_minutes ?? fallback.minAdvanceMinutes,
    slotIntervalMinutes: params.row.slot_interval_minutes ?? fallback.slotIntervalMinutes,
    timezone: params.row.timezone || fallback.timezone,
    notes: params.row.notes || "",
    updatedAt: params.row.updated_at,
  };
}

export function mapStorefrontServiceRow(row: ServiceRow): StorefrontServiceSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description || "",
    durationMinutes: Number(row.duration_minutes ?? 60),
    preBufferMinutes: Number(row.pre_buffer_minutes ?? 0),
    postBufferMinutes: Number(row.post_buffer_minutes ?? 0),
    priceAmount: Number(row.price_amount ?? 0),
    requiresDeposit: row.requires_deposit ?? false,
    depositCalculationType: row.deposit_calculation_type || "fixed",
    depositValue: Number(row.deposit_value ?? 0),
  };
}

export function mapStorefrontBrandAssetRow(params: {
  row: AssetRow;
  inherited: boolean;
}): StorefrontBrandAsset {
  const metadata = params.row.metadata || {};
  return {
    id: params.row.id,
    tenantId: params.row.tenant_id,
    branchId: params.row.branch_id,
    kind: params.row.kind,
    bucketName: params.row.bucket_name,
    storagePath: params.row.storage_path,
    publicUrl: params.row.public_url,
    altText: params.row.alt_text || "",
    contentType: typeof metadata.contentType === "string" ? metadata.contentType : "",
    fileName: typeof metadata.fileName === "string" ? metadata.fileName : "",
    fileSizeBytes: typeof metadata.fileSizeBytes === "number" ? metadata.fileSizeBytes : 0,
    isActive: params.row.is_active,
    isInherited: params.inherited,
    createdAt: params.row.created_at,
    updatedAt: params.row.updated_at,
  };
}

export async function resolveStorefrontBrandAssets(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
}) {
  const [branchAssetsResult, defaultAssetsResult] = await Promise.all([
    params.branchId
      ? params.supabase
          .from("storefront_brand_assets")
          .select("id, tenant_id, branch_id, kind, bucket_name, storage_path, public_url, alt_text, metadata, is_active, created_at, updated_at")
          .eq("tenant_id", params.tenantId)
          .eq("branch_id", params.branchId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    params.supabase
      .from("storefront_brand_assets")
      .select("id, tenant_id, branch_id, kind, bucket_name, storage_path, public_url, alt_text, metadata, is_active, created_at, updated_at")
      .eq("tenant_id", params.tenantId)
      .is("branch_id", null)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
  ]);

  const errors = [branchAssetsResult.error, defaultAssetsResult.error].filter(
    (item) => item && !isMissingSchemaObject(item.message, "storefront_brand_assets"),
  );
  if (errors.length > 0) {
    return { ok: false as const, error: errors[0]?.message || "Failed to load storefront assets" };
  }

  const scopedRows = ((branchAssetsResult.data || []) as AssetRow[]).map((row) =>
    mapStorefrontBrandAssetRow({ row, inherited: false }),
  );
  const defaultRows = ((defaultAssetsResult.data || []) as AssetRow[])
    .filter((row) => !scopedRows.some((item) => item.kind === row.kind))
    .map((row) => mapStorefrontBrandAssetRow({ row, inherited: true }));

  return {
    ok: true as const,
    data: [...scopedRows, ...defaultRows].sort((a, b) => a.kind.localeCompare(b.kind)),
  };
}

export async function resolveStorefrontPayload(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
}): Promise<{ ok: true; data: StorefrontPayload } | { ok: false; error: string }> {
  const branchListResult = await params.supabase
    .from("branches")
    .select("id, tenant_id, name, code, address, is_active")
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (branchListResult.error) {
    return { ok: false, error: branchListResult.error.message };
  }

  const branches = ((branchListResult.data || []) as BranchRow[]).map(mapBranchSummary);
  const selectedBranch = params.branchId ? branches.find((item) => item.id === params.branchId) || null : null;
  const targetBranchId = selectedBranch?.id ?? null;

  const [brandScopedResult, brandDefaultResult, bookingScopedResult, bookingDefaultResult, servicesResult, capabilityFlagsResult] = await Promise.all([
    targetBranchId
      ? params.supabase
          .from("storefront_brand_contents")
          .select(
            "id, tenant_id, branch_id, brand_name, hero_title, hero_subtitle, hero_image_url, mobile_feature_image_url, intro_title, intro_body, services_section_title, services_section_subtitle, booking_notice_title, booking_notice_body, contact_title, contact_body, contact_phone, contact_email, contact_address, contact_line, cta_primary_label, cta_secondary_label, about_section_enabled, team_section_enabled, portfolio_section_enabled, contact_section_enabled, custom_nav_items, business_hours, theme, visual_preferences, updated_at",
          )
          .eq("tenant_id", params.tenantId)
          .eq("branch_id", targetBranchId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    params.supabase
      .from("storefront_brand_contents")
      .select(
        "id, tenant_id, branch_id, brand_name, hero_title, hero_subtitle, hero_image_url, mobile_feature_image_url, intro_title, intro_body, services_section_title, services_section_subtitle, booking_notice_title, booking_notice_body, contact_title, contact_body, contact_phone, contact_email, contact_address, contact_line, cta_primary_label, cta_secondary_label, about_section_enabled, team_section_enabled, portfolio_section_enabled, contact_section_enabled, custom_nav_items, business_hours, theme, visual_preferences, updated_at",
      )
      .eq("tenant_id", params.tenantId)
      .is("branch_id", null)
      .maybeSingle(),
    targetBranchId
      ? params.supabase
          .from("store_booking_settings")
          .select(
            "id, tenant_id, branch_id, deposits_enabled, packages_enabled, deposit_required_mode, deposit_calculation_type, deposit_value, allow_customer_reschedule, allow_customer_cancel, latest_cancel_hours, latest_reschedule_hours, notifications_enabled, reminder_day_before_enabled, reminder_hour_before_enabled, deposit_reminder_enabled, cross_store_therapist_enabled, booking_window_days, min_advance_minutes, slot_interval_minutes, timezone, notes, updated_at",
          )
          .eq("tenant_id", params.tenantId)
          .eq("branch_id", targetBranchId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    params.supabase
      .from("store_booking_settings")
      .select(
        "id, tenant_id, branch_id, deposits_enabled, packages_enabled, deposit_required_mode, deposit_calculation_type, deposit_value, allow_customer_reschedule, allow_customer_cancel, latest_cancel_hours, latest_reschedule_hours, notifications_enabled, reminder_day_before_enabled, reminder_hour_before_enabled, deposit_reminder_enabled, cross_store_therapist_enabled, booking_window_days, min_advance_minutes, slot_interval_minutes, timezone, notes, updated_at",
      )
      .eq("tenant_id", params.tenantId)
      .is("branch_id", null)
      .maybeSingle(),
    params.supabase
      .from("services")
      .select(
        "id, branch_id, code, name, description, duration_minutes, pre_buffer_minutes, post_buffer_minutes, price_amount, requires_deposit, deposit_calculation_type, deposit_value",
      )
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .or(targetBranchId ? `branch_id.is.null,branch_id.eq.${targetBranchId}` : "branch_id.is.null")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    listTenantBookingCapabilityFlags({
      supabase: params.supabase,
      tenantId: params.tenantId,
    }),
  ]);

  const resultErrors = [
    brandScopedResult.error && !isMissingSchemaObject(brandScopedResult.error.message, "storefront_brand_contents") ? brandScopedResult.error : null,
    brandDefaultResult.error && !isMissingSchemaObject(brandDefaultResult.error.message, "storefront_brand_contents") ? brandDefaultResult.error : null,
    bookingScopedResult.error && !isMissingSchemaObject(bookingScopedResult.error.message, "store_booking_settings") ? bookingScopedResult.error : null,
    bookingDefaultResult.error && !isMissingSchemaObject(bookingDefaultResult.error.message, "store_booking_settings") ? bookingDefaultResult.error : null,
  ].filter(Boolean);

  if (resultErrors.length > 0) {
    return { ok: false, error: resultErrors[0]?.message || "Failed to load storefront data" };
  }
  if (!capabilityFlagsResult.ok) {
    return { ok: false, error: capabilityFlagsResult.error };
  }

  let servicesRows = (servicesResult.data || []) as ServiceRow[];
  if (servicesResult.error) {
    const fallbackAllowed =
      isMissingSchemaObject(servicesResult.error.message, "description") ||
      isMissingSchemaObject(servicesResult.error.message, "pre_buffer_minutes") ||
      isMissingSchemaObject(servicesResult.error.message, "post_buffer_minutes") ||
      isMissingSchemaObject(servicesResult.error.message, "price_amount") ||
      isMissingSchemaObject(servicesResult.error.message, "requires_deposit") ||
      isMissingSchemaObject(servicesResult.error.message, "deposit_calculation_type") ||
      isMissingSchemaObject(servicesResult.error.message, "deposit_value") ||
      isMissingSchemaObject(servicesResult.error.message, "deleted_at") ||
      isMissingSchemaObject(servicesResult.error.message, "sort_order");

    if (!fallbackAllowed) {
      return { ok: false, error: servicesResult.error.message };
    }

    let fallbackQuery = params.supabase
      .from("services")
      .select("id, code, name, duration_minutes")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    const fallbackResult = await fallbackQuery;
    if (fallbackResult.error) return { ok: false, error: fallbackResult.error.message };

    servicesRows = ((fallbackResult.data || []) as Array<{ id: string; code: string; name: string; duration_minutes: number | null }>).map((item) => ({
      id: item.id,
      branch_id: null,
      code: item.code,
      name: item.name,
      description: "",
      duration_minutes: item.duration_minutes,
      pre_buffer_minutes: 0,
      post_buffer_minutes: 0,
      price_amount: 0,
      requires_deposit: false,
      deposit_calculation_type: "fixed",
      deposit_value: 0,
    }));
  }

  const branchMeta = selectedBranch
    ? { branchId: selectedBranch.id, branchCode: selectedBranch.code, branchName: selectedBranch.name }
    : { branchId: null, branchCode: null, branchName: null };

  return {
    ok: true,
    data: {
      branch: selectedBranch,
      branches,
      brandContent: mapBrandContentRow({
        row: ((brandScopedResult.data || brandDefaultResult.data) as BrandRow | null) ?? null,
        tenantId: params.tenantId,
        resolvedFromScope: brandScopedResult.data ? "branch_override" : "tenant_default",
        ...branchMeta,
      }),
      bookingSettings: applyPlatformCapabilitiesToSettings({
        settings: mapBookingSettingsRow({
          row: ((bookingScopedResult.data || bookingDefaultResult.data) as BookingSettingsRow | null) ?? null,
          tenantId: params.tenantId,
          resolvedFromScope: bookingScopedResult.data ? "branch_override" : "tenant_default",
          ...branchMeta,
        }),
        flagMap: createCapabilityFlagMap(capabilityFlagsResult.items),
      }),
      services: servicesRows.map(mapStorefrontServiceRow),
    },
  };
}
