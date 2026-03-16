import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import { resolveScopedBranchId } from "../../../../../lib/storefront-scope";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { replaceStorefrontAsset } from "../../../../../lib/storage/storefront-assets";
import { resolveStorefrontBrandAssets, resolveStorefrontPayload } from "../../../../../lib/storefront";
import type { ManagerStorefrontPayload, StorefrontBrandAssetKind } from "../../../../../types/storefront";

const FIELD_KIND_MAP: Record<string, Extract<StorefrontBrandAssetKind, "hero" | "mobile_feature">> = {
  heroImageUrl: "hero",
  mobileFeatureImageUrl: "mobile_feature",
};

async function buildManagerPayload(params: {
  tenantId: string;
  branchId: string | null;
  supabase: SupabaseClient;
}) {
  const storefront = await resolveStorefrontPayload({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
  });
  if (!storefront.ok) return storefront;

  const assets = await resolveStorefrontBrandAssets({
    supabase: params.supabase,
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

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const permission = requirePermission(auth.context, "storefront.write");
  if (!permission.ok) return permission.response;

  const formData = await request.formData().catch(() => null);
  if (!formData) return apiError(400, "FORBIDDEN", "Invalid upload payload");

  const fieldName = String(formData.get("fieldName") || "");
  const branchIdValue = formData.get("branchId");
  const requestedBranchId = typeof branchIdValue === "string" && branchIdValue ? branchIdValue : null;
  const altText = String(formData.get("altText") || "");
  const file = formData.get("file");

  const kind = FIELD_KIND_MAP[fieldName];
  if (!kind) return apiError(400, "FORBIDDEN", "Unsupported storefront asset field");
  if (!(file instanceof File)) return apiError(400, "FORBIDDEN", "Missing upload file");

  const branchScope = await resolveScopedBranchId({
    requestedBranchId,
    tenantId: auth.context.tenantId,
    auth,
  });
  if (!branchScope.ok) return branchScope.response;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Admin client initialization failed");
  }

  const upload = await replaceStorefrontAsset({
    supabase: admin,
    tenantId: auth.context.tenantId,
    branchId: branchScope.branchId,
    kind,
    file,
    uploadedBy: auth.context.userId,
    altText,
  });
  if (!upload.ok) return apiError(400, "FORBIDDEN", upload.error);

  const currentStorefront = await resolveStorefrontPayload({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    branchId: branchScope.branchId,
  });
  if (!currentStorefront.ok) return apiError(500, "INTERNAL_ERROR", currentStorefront.error);

  const nextBrand = { ...currentStorefront.data.brandContent };
  if (fieldName === "heroImageUrl") nextBrand.heroImageUrl = upload.publicUrl;
  if (fieldName === "mobileFeatureImageUrl") nextBrand.mobileFeatureImageUrl = upload.publicUrl;

  const upsertResult = await auth.supabase
    .from("storefront_brand_contents")
    .upsert(
      {
        tenant_id: auth.context.tenantId,
        branch_id: branchScope.branchId,
        brand_name: nextBrand.brandName,
        hero_title: nextBrand.heroTitle,
        hero_subtitle: nextBrand.heroSubtitle,
        hero_image_url: nextBrand.heroImageUrl,
        mobile_feature_image_url: nextBrand.mobileFeatureImageUrl,
        intro_title: nextBrand.introTitle,
        intro_body: nextBrand.introBody,
        services_section_title: nextBrand.servicesSectionTitle,
        services_section_subtitle: nextBrand.servicesSectionSubtitle,
        booking_notice_title: nextBrand.bookingNoticeTitle,
        booking_notice_body: nextBrand.bookingNoticeBody,
        contact_title: nextBrand.contactTitle,
        contact_body: nextBrand.contactBody,
        contact_phone: nextBrand.contactPhone,
        contact_email: nextBrand.contactEmail,
        contact_address: nextBrand.contactAddress,
        contact_line: nextBrand.contactLine,
        cta_primary_label: nextBrand.ctaPrimaryLabel,
        cta_secondary_label: nextBrand.ctaSecondaryLabel,
        about_section_enabled: nextBrand.aboutSectionEnabled,
        team_section_enabled: nextBrand.teamSectionEnabled,
        portfolio_section_enabled: nextBrand.portfolioSectionEnabled,
        contact_section_enabled: nextBrand.contactSectionEnabled,
        custom_nav_items: nextBrand.customNavItems,
        business_hours: nextBrand.businessHours,
        theme: nextBrand.theme,
        visual_preferences: nextBrand.visualPreferences,
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
    action: "storefront_brand_asset_upload",
    target_type: "storefront_brand_asset",
    target_id: upsertResult.data?.id || null,
    reason: kind,
    payload: {
      branchId: branchScope.branchId,
      fieldName,
      storagePath: upload.storagePath,
      publicUrl: upload.publicUrl,
      fileName: file.name,
      contentType: file.type,
      fileSizeBytes: file.size,
    },
  });

  const payload = await buildManagerPayload({
    tenantId: auth.context.tenantId,
    branchId: branchScope.branchId,
    supabase: auth.supabase,
  });
  if (!payload.ok) return apiError(500, "INTERNAL_ERROR", payload.error);

  return apiSuccess({
    fieldName,
    assetUrl: upload.publicUrl,
    asset: payload.data.brandAssets.find((item) => item.publicUrl === upload.publicUrl) || null,
    storefront: payload.data,
  });
}
