import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StorefrontBrandAssetKind } from "../../types/storefront";

const STOREFRONT_ASSET_BUCKET = "storefront-assets";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type ReplaceStorefrontAssetParams = {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  kind: Extract<StorefrontBrandAssetKind, "hero" | "mobile_feature">;
  file: File;
  uploadedBy: string;
  altText?: string | null;
};

function sanitizeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getFileExtension(file: File) {
  const extFromType = MIME_EXTENSION_MAP[file.type];
  if (extFromType) return extFromType;
  const fromName = file.name.split(".").pop()?.toLowerCase();
  return fromName || "bin";
}

function buildStoragePath(params: {
  tenantId: string;
  branchId: string | null;
  kind: ReplaceStorefrontAssetParams["kind"];
  file: File;
}) {
  const scopeSegment = params.branchId ? `branch-${params.branchId}` : "tenant-default";
  const extension = getFileExtension(params.file);
  const safeName = sanitizeFileName(params.file.name.replace(/\.[^.]+$/, "")) || params.kind;
  return `storefront/${params.tenantId}/${scopeSegment}/${params.kind}/${Date.now()}-${safeName}-${crypto.randomUUID()}.${extension}`;
}

function parseStorageNotFound(message: string | undefined) {
  const lower = (message || "").toLowerCase();
  return lower.includes("not found") || lower.includes("does not exist");
}

export function validateStorefrontAssetFile(file: File) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { ok: false as const, error: "Please upload JPG, PNG, or WEBP images only." };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false as const, error: "Image is too large. Please upload a file up to 5MB." };
  }
  return { ok: true as const };
}

async function ensureBucket(supabase: SupabaseClient) {
  const bucketResult = await supabase.storage.getBucket(STOREFRONT_ASSET_BUCKET);
  if (!bucketResult.error || !parseStorageNotFound(bucketResult.error?.message)) return;

  await supabase.storage.createBucket(STOREFRONT_ASSET_BUCKET, {
    public: true,
    fileSizeLimit: MAX_FILE_SIZE_BYTES,
    allowedMimeTypes: Array.from(ALLOWED_MIME_TYPES),
  });
}

export async function replaceStorefrontAsset(params: ReplaceStorefrontAssetParams) {
  const validation = validateStorefrontAssetFile(params.file);
  if (!validation.ok) return validation;

  await ensureBucket(params.supabase);

  const existingAssetQuery = params.supabase
    .from("storefront_brand_assets")
    .select("id, storage_path, metadata")
    .eq("tenant_id", params.tenantId)
    .eq("kind", params.kind)
    .eq("is_active", true)
    .limit(1);

  const existingAssetResult = params.branchId
    ? await existingAssetQuery.eq("branch_id", params.branchId).maybeSingle()
    : await existingAssetQuery.is("branch_id", null).maybeSingle();

  if (existingAssetResult.error) {
    return { ok: false as const, error: existingAssetResult.error.message };
  }

  const storagePath = buildStoragePath({
    tenantId: params.tenantId,
    branchId: params.branchId,
    kind: params.kind,
    file: params.file,
  });

  const uploadResult = await params.supabase.storage
    .from(STOREFRONT_ASSET_BUCKET)
    .upload(storagePath, Buffer.from(await params.file.arrayBuffer()), {
      contentType: params.file.type,
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadResult.error) {
    return { ok: false as const, error: uploadResult.error.message };
  }

  const publicUrl = params.supabase.storage.from(STOREFRONT_ASSET_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  const previousAsset = existingAssetResult.data;

  if (previousAsset?.storage_path) {
    await params.supabase.storage.from(STOREFRONT_ASSET_BUCKET).remove([previousAsset.storage_path]).catch(() => null);
    await params.supabase
      .from("storefront_brand_assets")
      .update({
        is_active: false,
        metadata: {
          ...(previousAsset.metadata || {}),
          replacedAt: new Date().toISOString(),
        },
      })
      .eq("id", previousAsset.id);
  }

  const insertResult = await params.supabase
    .from("storefront_brand_assets")
    .insert({
      tenant_id: params.tenantId,
      branch_id: params.branchId,
      kind: params.kind,
      bucket_name: STOREFRONT_ASSET_BUCKET,
      storage_path: storagePath,
      public_url: publicUrl,
      alt_text: params.altText || "",
      is_active: true,
      uploaded_by: params.uploadedBy,
      metadata: {
        fileName: params.file.name,
        contentType: params.file.type,
        fileSizeBytes: params.file.size,
        replacedAssetId: previousAsset?.id || null,
      },
    })
    .select("id, tenant_id, branch_id, kind, bucket_name, storage_path, public_url, alt_text, metadata, is_active, created_at, updated_at")
    .maybeSingle();

  if (insertResult.error || !insertResult.data) {
    return { ok: false as const, error: insertResult.error?.message || "Failed to record storefront asset" };
  }

  return {
    ok: true as const,
    asset: insertResult.data,
    publicUrl,
    bucketName: STOREFRONT_ASSET_BUCKET,
    storagePath,
  };
}

export { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, STOREFRONT_ASSET_BUCKET };
