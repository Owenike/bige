import type { StoreBookingSettings, StorefrontBrandContent } from "../types/storefront";
import styles from "./storefront-preview.module.css";

type BrandPreviewMobileProps = {
  brand: StorefrontBrandContent;
  bookingSettings: StoreBookingSettings;
};

const MOBILE_STEPS = [
  "Select store",
  "Select therapist",
  "Select service",
  "Select date",
  "Select time",
  "Your details",
  "Confirm booking",
];

export function BrandPreviewMobile(props: BrandPreviewMobileProps) {
  const previewImage = props.brand.mobileFeatureImageUrl || props.brand.heroImageUrl || "";
  return (
    <section className={[styles.frame, styles.mobile].join(" ")}>
      <header className={styles.nav}>
        <div className={styles.brand}>
          <div className={styles.brandName}>{props.brand.brandName}</div>
          <div className={styles.brandMeta}>Mobile booking entry</div>
        </div>
        <span className={styles.secondaryCta}>Menu</span>
      </header>

      <div className={styles.mobileStack}>
        <div
          className={styles.heroImage}
          style={previewImage ? { backgroundImage: `linear-gradient(180deg, rgba(20, 20, 20, 0.08), rgba(20, 20, 20, 0.3)), url(${previewImage})` } : undefined}
        >
          <span className={styles.heroImageLabel}>
            {previewImage ? "Live mobile image" : "Mobile feature image placeholder"}
          </span>
        </div>

        <div className={styles.copy}>
          <div className={styles.eyebrow}>Step card flow</div>
          <h2 className={styles.title}>{props.brand.heroTitle}</h2>
          <p className={styles.subtitle}>{props.brand.introBody}</p>
        </div>

        <div className={styles.stepStack}>
          {MOBILE_STEPS.slice(0, 3).map((item, index) => (
            <article key={item} className={styles.stepCard}>
              <div className={styles.stepIndex}>Step {index + 1}</div>
              <strong>{item}</strong>
              <div className={styles.cardBody}>Independent card blocks keep the flow light, focused, and touch-friendly.</div>
            </article>
          ))}
        </div>

        <div className={styles.stickyBar}>
          <div>
            <div>Total</div>
            <strong>{props.bookingSettings.depositsEnabled ? "Deposit shown" : "Pay in store"}</strong>
          </div>
          <span className={styles.primaryCta}>{props.brand.ctaPrimaryLabel}</span>
        </div>
      </div>
    </section>
  );
}
