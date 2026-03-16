"use client";

import { useEffect, useMemo, useState } from "react";
import { BrandImageUploader } from "../../../../components/brand-image-uploader";
import { BrandPreviewDesktop } from "../../../../components/brand-preview-desktop";
import { BrandPreviewMobile } from "../../../../components/brand-preview-mobile";
import { PremiumToggleSwitch } from "../../../../components/premium-toggle-switch";
import type { ManagerStorefrontPayload, StorefrontBrandAsset, StorefrontBrandContent } from "../../../../types/storefront";
import styles from "../settings.module.css";

function parseJsonSafe<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringifyValue(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function ManagerBrandSettingsPage() {
  const [payload, setPayload] = useState<ManagerStorefrontPayload | null>(null);
  const [form, setForm] = useState<StorefrontBrandContent | null>(null);
  const [brandAssets, setBrandAssets] = useState<StorefrontBrandAsset[]>([]);
  const [branchId, setBranchId] = useState("");
  const [navItemsRaw, setNavItemsRaw] = useState("[]");
  const [businessHoursRaw, setBusinessHoursRaw] = useState("[]");
  const [visualRaw, setVisualRaw] = useState("{}");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load(nextBranchId?: string) {
    const targetBranchId = typeof nextBranchId === "string" ? nextBranchId : branchId;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const query = targetBranchId ? `?branchId=${encodeURIComponent(targetBranchId)}` : "";
      const res = await fetch(`/api/manager/storefront${query}`);
      const data = (await res.json().catch(() => null)) as ManagerStorefrontPayload | null;
      if (!res.ok || !data) {
        setError("Failed to load storefront settings.");
        return;
      }
      setPayload(data);
      setForm(data.brandContent);
      setBrandAssets(data.brandAssets || []);
      setBranchId(data.branch?.id || targetBranchId || "");
      setNavItemsRaw(stringifyValue(data.brandContent.customNavItems));
      setBusinessHoursRaw(stringifyValue(data.brandContent.businessHours));
      setVisualRaw(stringifyValue(data.brandContent.visualPreferences));
    } catch {
      setError("Failed to load storefront settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewBrand = useMemo(() => {
    if (!form) return null;
    return {
      ...form,
      customNavItems: parseJsonSafe(navItemsRaw, form.customNavItems),
      businessHours: parseJsonSafe(businessHoursRaw, form.businessHours),
      visualPreferences: parseJsonSafe(visualRaw, form.visualPreferences),
    };
  }, [businessHoursRaw, form, navItemsRaw, visualRaw]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/storefront", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_brand",
          branchId: branchId || null,
          brandContent: {
            ...form,
            customNavItems: parseJsonSafe(navItemsRaw, form.customNavItems),
            businessHours: parseJsonSafe(businessHoursRaw, form.businessHours),
            visualPreferences: parseJsonSafe(visualRaw, form.visualPreferences),
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as ManagerStorefrontPayload | null;
      if (!res.ok || !data) {
        setError("Failed to save brand content.");
        return;
      }
      setPayload(data);
      setForm(data.brandContent);
      setBrandAssets(data.brandAssets || []);
      setMessage("Brand content saved successfully.");
    } catch {
      setError("Failed to save brand content.");
    } finally {
      setSaving(false);
    }
  }

  function findAsset(kind: "hero" | "mobile_feature") {
    return brandAssets.find((item) => item.kind === kind) || null;
  }

  function updateField<K extends keyof StorefrontBrandContent>(key: K, value: StorefrontBrandContent[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function handleUploadSuccess(params: {
    fieldName: "heroImageUrl" | "mobileFeatureImageUrl";
    assetUrl: string;
    asset: StorefrontBrandAsset | null;
  }) {
    updateField(params.fieldName, params.assetUrl as StorefrontBrandContent[typeof params.fieldName]);
    if (params.asset) {
      setBrandAssets((current) => [params.asset!, ...current.filter((item) => item.kind !== params.asset?.kind)]);
    }
    setMessage(`${params.fieldName === "heroImageUrl" ? "Hero image" : "Mobile feature image"} uploaded successfully.`);
    setError(null);
  }

  const scopeCopy = form
    ? form.resolvedFromScope === "branch_override"
      ? "This branch currently has its own override. Saving here updates only this branch and /booking will read it when branchId or branchCode matches."
      : "This view is currently inheriting tenant default brand content. Saving while a branch is selected will create a branch-specific override from the inherited content."
    : "";

  if (!form || !previewBrand || !payload?.bookingSettings) {
    return (
      <main className="fdGlassScene">
        <section className="fdGlassBackdrop">
          <section className={styles.page}>
            <article className={`fdGlassPanel ${styles.heroCard}`}>
              <div className={styles.heroEyebrow}>Brand content</div>
              <h1 className={styles.heroTitle}>Storefront Brand Settings</h1>
              <p className={styles.heroBody}>{loading ? "Loading storefront configuration..." : error || "No storefront data loaded yet."}</p>
            </article>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className={styles.page}>
          <article className={`fdGlassPanel ${styles.heroCard}`}>
            <div className={styles.heroEyebrow}>Storefront brand</div>
            <h1 className={styles.heroTitle}>Brand Content Settings</h1>
            <p className={styles.heroBody}>
              Manage tenant default brand content and branch-specific overrides. Text changes, image uploads, and preview updates all stay aligned with the live `/booking` storefront.
            </p>
            <div className={styles.actionRow}>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving..." : "Save brand content"}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load(branchId)} disabled={loading}>
                {loading ? "Refreshing..." : "Reload"}
              </button>
              <a className="fdPillBtn" href="/booking" target="_blank" rel="noreferrer">
                Open live /booking
              </a>
            </div>
            {error ? <div className="error">{error}</div> : null}
            {message ? <div className="ok">{message}</div> : null}
          </article>

          <section className={styles.twoCol}>
            <article className={`fdGlassSubPanel ${styles.card}`}>
              <div className={styles.branchRow}>
                <label className={styles.field} style={{ minWidth: 260 }}>
                  <span className={styles.label}>Store scope</span>
                  <select
                    className={styles.select}
                    value={branchId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setBranchId(value);
                      void load(value);
                    }}
                  >
                    <option value="">Tenant default storefront</option>
                    {payload.branches.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.code ? ` (${item.code})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.note}>Tenant default acts as the store-level base. Branch selection creates or updates branch-specific overrides.</p>
              </div>

              <div className={styles.scopeBanner}>
                <div>
                  <div className={styles.label}>Effective source</div>
                  <div className={styles.scopeText}>{scopeCopy}</div>
                </div>
                <span className={styles.statusBadge}>
                  {form.resolvedFromScope === "branch_override" ? "Branch override" : "Tenant default"}
                </span>
              </div>

              <div className={styles.uploaderGrid}>
                <div className={styles.uploaderCard}>
                  <BrandImageUploader
                    label="Hero image"
                    description="Used by desktop hero and storefront brand previews. JPG / PNG / WEBP up to 5MB."
                    fieldName="heroImageUrl"
                    branchId={branchId || null}
                    currentUrl={form.heroImageUrl}
                    currentAsset={findAsset("hero")}
                    onUploaded={handleUploadSuccess}
                    onError={(nextError) => setError(nextError || null)}
                  />
                </div>
                <div className={styles.uploaderCard}>
                  <BrandImageUploader
                    label="Mobile feature image"
                    description="Used by the mobile booking hero card. Branch uploads override tenant default media."
                    fieldName="mobileFeatureImageUrl"
                    branchId={branchId || null}
                    currentUrl={form.mobileFeatureImageUrl}
                    currentAsset={findAsset("mobile_feature")}
                    onUploaded={handleUploadSuccess}
                    onError={(nextError) => setError(nextError || null)}
                  />
                </div>
              </div>

              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span className={styles.label}>Brand name</span>
                  <input className={styles.input} value={form.brandName} onChange={(event) => updateField("brandName", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Primary CTA</span>
                  <input className={styles.input} value={form.ctaPrimaryLabel} onChange={(event) => updateField("ctaPrimaryLabel", event.target.value)} />
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.label}>Hero title</span>
                  <input className={styles.input} value={form.heroTitle} onChange={(event) => updateField("heroTitle", event.target.value)} />
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.label}>Hero subtitle</span>
                  <textarea className={styles.textarea} value={form.heroSubtitle} onChange={(event) => updateField("heroSubtitle", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Intro title</span>
                  <input className={styles.input} value={form.introTitle} onChange={(event) => updateField("introTitle", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Secondary CTA</span>
                  <input className={styles.input} value={form.ctaSecondaryLabel} onChange={(event) => updateField("ctaSecondaryLabel", event.target.value)} />
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.label}>Intro body</span>
                  <textarea className={styles.textarea} value={form.introBody} onChange={(event) => updateField("introBody", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Services section title</span>
                  <input className={styles.input} value={form.servicesSectionTitle} onChange={(event) => updateField("servicesSectionTitle", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Booking notice title</span>
                  <input className={styles.input} value={form.bookingNoticeTitle} onChange={(event) => updateField("bookingNoticeTitle", event.target.value)} />
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.label}>Services section subtitle</span>
                  <textarea className={styles.textarea} value={form.servicesSectionSubtitle} onChange={(event) => updateField("servicesSectionSubtitle", event.target.value)} />
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.label}>Booking notice body</span>
                  <textarea className={styles.textarea} value={form.bookingNoticeBody} onChange={(event) => updateField("bookingNoticeBody", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Contact title</span>
                  <input className={styles.input} value={form.contactTitle} onChange={(event) => updateField("contactTitle", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Contact phone</span>
                  <input className={styles.input} value={form.contactPhone} onChange={(event) => updateField("contactPhone", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Contact email</span>
                  <input className={styles.input} value={form.contactEmail} onChange={(event) => updateField("contactEmail", event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Contact line</span>
                  <input className={styles.input} value={form.contactLine} onChange={(event) => updateField("contactLine", event.target.value)} />
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.label}>Contact body</span>
                  <textarea className={styles.textarea} value={form.contactBody} onChange={(event) => updateField("contactBody", event.target.value)} />
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.label}>Contact address</span>
                  <textarea className={styles.textarea} value={form.contactAddress} onChange={(event) => updateField("contactAddress", event.target.value)} />
                </label>
              </div>

              <div className={styles.toggleStack}>
                <PremiumToggleSwitch checked={form.aboutSectionEnabled} onCheckedChange={(checked) => updateField("aboutSectionEnabled", checked)} label="Show About section" description="Controls long-form brand storytelling on the storefront." />
                <PremiumToggleSwitch checked={form.teamSectionEnabled} onCheckedChange={(checked) => updateField("teamSectionEnabled", checked)} label="Show Team section" description="Used for therapist highlights and staff positioning." />
                <PremiumToggleSwitch checked={form.portfolioSectionEnabled} onCheckedChange={(checked) => updateField("portfolioSectionEnabled", checked)} label="Show Portfolio section" description="Reserved for later visual storytelling extensions." />
                <PremiumToggleSwitch checked={form.contactSectionEnabled} onCheckedChange={(checked) => updateField("contactSectionEnabled", checked)} label="Show Contact section" description="Keeps address, phone, and contact cards visible on the storefront." />
              </div>

              <div className={styles.fieldGridWide}>
                <label className={styles.field}>
                  <span className={styles.label}>Custom nav items JSON</span>
                  <textarea className={styles.textarea} value={navItemsRaw} onChange={(event) => setNavItemsRaw(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Business hours JSON</span>
                  <textarea className={styles.textarea} value={businessHoursRaw} onChange={(event) => setBusinessHoursRaw(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Visual preferences JSON</span>
                  <textarea className={styles.textarea} value={visualRaw} onChange={(event) => setVisualRaw(event.target.value)} />
                </label>
              </div>
            </article>

            <aside className={styles.previewStack}>
              <BrandPreviewDesktop brand={previewBrand} bookingSettings={payload.bookingSettings} />
              <BrandPreviewMobile brand={previewBrand} bookingSettings={payload.bookingSettings} />
            </aside>
          </section>
        </section>
      </section>
    </main>
  );
}
