import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import {
  clampStoreBookingSettingsForPlatform,
  createCapabilityFlagMap,
  createDefaultStoreBookingSettings,
  listTenantBookingCapabilityFlags,
} from "../../../../lib/platform-booking-capabilities";
import { requirePermission } from "../../../../lib/permissions";
import { resolveScopedBranchId } from "../../../../lib/storefront-scope";
import { resolveStorefrontBrandAssets, resolveStorefrontPayload } from "../../../../lib/storefront";
import type { ManagerStorefrontPayload } from "../../../../types/storefront";

const brandContentSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  heroTitle: z.string().trim().min(1).max(220),
  heroSubtitle: z.string().trim().min(1).max(1200),
  heroImageUrl: z.string().trim().max(2000),
  mobileFeatureImageUrl: z.string().trim().max(2000),
  introTitle: z.string().trim().min(1).max(220),
  introBody: z.string().trim().min(1).max(4000),
  servicesSectionTitle: z.string().trim().min(1).max(220),
  servicesSectionSubtitle: z.string().trim().min(1).max(4000),
  bookingNoticeTitle: z.string().trim().min(1).max(220),
  bookingNoticeBody: z.string().trim().min(1).max(4000),
  contactTitle: z.string().trim().min(1).max(220),
  contactBody: z.string().trim().min(1).max(4000),
  contactPhone: z.string().trim().max(120),
  contactEmail: z.string().trim().max(160),
  contactAddress: z.string().trim().max(1000),
  contactLine: z.string().trim().max(120),
  ctaPrimaryLabel: z.string().trim().min(1).max(80),
  ctaSecondaryLabel: z.string().trim().min(1).max(80),
  aboutSectionEnabled: z.boolean(),
  teamSectionEnabled: z.boolean(),
  portfolioSectionEnabled: z.boolean(),
  contactSectionEnabled: z.boolean(),
  customNavItems: z.array(z.object({ label: z.string().trim().min(1).max(80), href: z.string().trim().min(1).max(160) })).max(12),
  businessHours: z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(120) })).max(14),
  theme: z.object({
    accent: z.string().trim().max(40),
    tone: z.enum(["obsidian", "stone", "linen"]),
    radius: z.enum(["soft", "rounded", "pill"]),
  }),
  visualPreferences: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

const bookingSettingsSchema = z.object({
  depositsEnabled: z.boolean(),
  packagesEnabled: z.boolean(),
  depositRequiredMode: z.enum(["optional", "required"]),
  depositCalculationType: z.enum(["fixed", "percent"]),
  depositValue: z.number().min(0).max(999999),
  allowCustomerReschedule: z.boolean(),
  allowCustomerCancel: z.boolean(),
  latestCancelHours: z.number().int().min(0).max(720),
  latestRescheduleHours: z.number().int().min(0).max(720),
  notificationsEnabled: z.boolean(),
  reminderDayBeforeEnabled: z.boolean(),
  reminderHourBeforeEnabled: z.boolean(),
  depositReminderEnabled: z.boolean(),
  crossStoreTherapistEnabled: z.boolean(),
  bookingWindowDays: z.number().int().min(1).max(365),
  minAdvanceMinutes: z.number().int().min(0).max(10080),
  slotIntervalMinutes: z.number().int().min(5).max(60),
  timezone: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(4000),
});

const putBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("upsert_brand"),
    branchId: z.string().uuid().nullable().optional(),
    brandContent: brandContentSchema,
  }),
  z.object({
    action: z.literal("upsert_booking_settings"),
    branchId: z.string().uuid().nullable().optional(),
    bookingSettings: bookingSettingsSchema,
  }),
]);

async function buildManagerPayload(params: {
  auth: {
    supabase: SupabaseClient;
  };
  tenantId: string;
  branchId: string | null;
}) {
  const storefront = await resolveStorefrontPayload({
    supabase: params.auth.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
  });
  if (!storefront.ok) return storefront;

  const assets = await resolveStorefrontBrandAssets({
    supabase: params.auth.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
  });
  if (!assets.ok) return assets;

  return {
    ok: true as const,
    data: {
      ...storefront.data,
      brandAssets: assets.data,
    } satisfies ManagerStorefrontPayload,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const permission = requirePermission(auth.context, "storefront.read");
  if (!permission.ok) return permission.response;

  const requestedBranchId = new URL(request.url).searchParams.get("branchId");
  const branchScope = await resolveScopedBranchId({
    requestedBranchId,
    tenantId: auth.context.tenantId,
    auth,
  });
  if (!branchScope.ok) return branchScope.response;

  const payload = await buildManagerPayload({
    auth,
    tenantId: auth.context.tenantId,
    branchId: branchScope.branchId,
  });
  if (!payload.ok) return apiError(500, "INTERNAL_ERROR", payload.error);

  return apiSuccess(payload.data);
}

export async function PUT(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const body = await request.json().catch(() => null);
  const parsed = putBodySchema.safeParse(body || {});
  if (!parsed.success) return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid payload");

  const permission = requirePermission(
    auth.context,
    parsed.data.action === "upsert_brand" ? "storefront.write" : "booking_settings.write",
  );
  if (!permission.ok) return permission.response;

  const branchScope = await resolveScopedBranchId({
    requestedBranchId: parsed.data.branchId || null,
    tenantId: auth.context.tenantId,
    auth,
  });
  if (!branchScope.ok) return branchScope.response;

  if (parsed.data.action === "upsert_brand") {
    const row = parsed.data.brandContent;
    const upsertResult = await auth.supabase
      .from("storefront_brand_contents")
      .upsert(
        {
          tenant_id: auth.context.tenantId,
          branch_id: branchScope.branchId,
          brand_name: row.brandName,
          hero_title: row.heroTitle,
          hero_subtitle: row.heroSubtitle,
          hero_image_url: row.heroImageUrl,
          mobile_feature_image_url: row.mobileFeatureImageUrl,
          intro_title: row.introTitle,
          intro_body: row.introBody,
          services_section_title: row.servicesSectionTitle,
          services_section_subtitle: row.servicesSectionSubtitle,
          booking_notice_title: row.bookingNoticeTitle,
          booking_notice_body: row.bookingNoticeBody,
          contact_title: row.contactTitle,
          contact_body: row.contactBody,
          contact_phone: row.contactPhone,
          contact_email: row.contactEmail,
          contact_address: row.contactAddress,
          contact_line: row.contactLine,
          cta_primary_label: row.ctaPrimaryLabel,
          cta_secondary_label: row.ctaSecondaryLabel,
          about_section_enabled: row.aboutSectionEnabled,
          team_section_enabled: row.teamSectionEnabled,
          portfolio_section_enabled: row.portfolioSectionEnabled,
          contact_section_enabled: row.contactSectionEnabled,
          custom_nav_items: row.customNavItems,
          business_hours: row.businessHours,
          theme: row.theme,
          visual_preferences: row.visualPreferences,
          updated_by: auth.context.userId,
          created_by: auth.context.userId,
        },
        { onConflict: "tenant_id,scope_key" },
      )
      .select("id")
      .maybeSingle();

    if (upsertResult.error) return apiError(500, "INTERNAL_ERROR", upsertResult.error.message);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "storefront_brand_upsert",
      target_type: "storefront_brand_content",
      target_id: upsertResult.data?.id || null,
      reason: branchScope.branchId ? "branch_storefront_brand_upsert" : "tenant_storefront_brand_upsert",
      payload: {
        branchId: branchScope.branchId,
        heroTitle: row.heroTitle,
        brandName: row.brandName,
      },
    });
  } else {
    const flagsResult = await listTenantBookingCapabilityFlags({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
    });
    if (!flagsResult.ok) return apiError(500, "INTERNAL_ERROR", flagsResult.error);

    const row = clampStoreBookingSettingsForPlatform({
      settings: {
        ...createDefaultStoreBookingSettings({
          tenantId: auth.context.tenantId,
          branchId: branchScope.branchId,
        }),
        ...parsed.data.bookingSettings,
      },
      flagMap: createCapabilityFlagMap(flagsResult.items),
    });
    const upsertResult = await auth.supabase
      .from("store_booking_settings")
      .upsert(
        {
          tenant_id: auth.context.tenantId,
          branch_id: branchScope.branchId,
          deposits_enabled: row.depositsEnabled,
          packages_enabled: row.packagesEnabled,
          deposit_required_mode: row.depositRequiredMode,
          deposit_calculation_type: row.depositCalculationType,
          deposit_value: row.depositValue,
          allow_customer_reschedule: row.allowCustomerReschedule,
          allow_customer_cancel: row.allowCustomerCancel,
          latest_cancel_hours: row.latestCancelHours,
          latest_reschedule_hours: row.latestRescheduleHours,
          notifications_enabled: row.notificationsEnabled,
          reminder_day_before_enabled: row.reminderDayBeforeEnabled,
          reminder_hour_before_enabled: row.reminderHourBeforeEnabled,
          deposit_reminder_enabled: row.depositReminderEnabled,
          cross_store_therapist_enabled: row.crossStoreTherapistEnabled,
          booking_window_days: row.bookingWindowDays,
          min_advance_minutes: row.minAdvanceMinutes,
          slot_interval_minutes: row.slotIntervalMinutes,
          timezone: row.timezone,
          notes: row.notes,
          updated_by: auth.context.userId,
          created_by: auth.context.userId,
        },
        { onConflict: "tenant_id,scope_key" },
      )
      .select("id")
      .maybeSingle();

    if (upsertResult.error) return apiError(500, "INTERNAL_ERROR", upsertResult.error.message);

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "store_booking_settings_upsert",
      target_type: "store_booking_setting",
      target_id: upsertResult.data?.id || null,
      reason: branchScope.branchId ? "branch_booking_rules_upsert" : "tenant_booking_rules_upsert",
      payload: {
        branchId: branchScope.branchId,
        depositsEnabled: row.depositsEnabled,
        packagesEnabled: row.packagesEnabled,
        notificationsEnabled: row.notificationsEnabled,
        crossStoreTherapistEnabled: row.crossStoreTherapistEnabled,
      },
    });
  }

  const payload = await buildManagerPayload({
    auth,
    tenantId: auth.context.tenantId,
    branchId: branchScope.branchId,
  });
  if (!payload.ok) return apiError(500, "INTERNAL_ERROR", payload.error);

  return apiSuccess(payload.data);
}
