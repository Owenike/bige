"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { StorefrontBrandAsset } from "../types/storefront";
import styles from "../app/manager/settings/settings.module.css";

type BrandImageUploaderProps = {
  label: string;
  description: string;
  fieldName: "heroImageUrl" | "mobileFeatureImageUrl";
  branchId: string | null;
  currentUrl: string;
  currentAsset?: StorefrontBrandAsset | null;
  onUploaded?: (payload: {
    fieldName: "heroImageUrl" | "mobileFeatureImageUrl";
    assetUrl: string;
    asset: StorefrontBrandAsset | null;
  }) => void;
  onError?: (message: string) => void;
};

export function BrandImageUploader(props: BrandImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(props.currentUrl);

  useEffect(() => {
    setPreviewUrl(props.currentUrl);
  }, [props.currentUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setUploading(true);
    props.onError?.("");

    try {
      const formData = new FormData();
      formData.set("fieldName", props.fieldName);
      if (props.branchId) formData.set("branchId", props.branchId);
      formData.set("file", file);
      formData.set("altText", props.label);

      const response = await fetch("/api/manager/storefront/upload", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | { assetUrl?: string; fieldName?: "heroImageUrl" | "mobileFeatureImageUrl"; asset?: StorefrontBrandAsset | null; error?: { message?: string } }
        | null;

      if (!response.ok || !payload?.assetUrl || !payload.fieldName) {
        throw new Error(payload?.error?.message || "Upload failed");
      }

      setPreviewUrl(payload.assetUrl);
      props.onUploaded?.({
        fieldName: payload.fieldName,
        assetUrl: payload.assetUrl,
        asset: payload.asset || null,
      });
    } catch (error) {
      setPreviewUrl(props.currentUrl);
      props.onError?.(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section>
      <div
        style={previewUrl ? { backgroundImage: `linear-gradient(180deg, rgba(17, 17, 17, 0.06), rgba(17, 17, 17, 0.2)), url(${previewUrl})` } : undefined}
        className={styles.uploaderPreview}
      />
      <div className={styles.uploaderMeta}>
        <strong>{props.label}</strong>
        <p className={styles.panelText}>{props.description}</p>
        {props.currentAsset?.fileName ? <span className={styles.statusBadge}>{props.currentAsset.fileName}</span> : null}
        <div className={styles.actionRow}>
          <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading..." : "Upload image"}
          </button>
          <span className={styles.statusBadge}>{previewUrl ? "Configured" : "Empty"}</span>
        </div>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={handleFileChange} />
      </div>
    </section>
  );
}
