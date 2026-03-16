import type { StoreBookingSettings, StorefrontBrandContent } from "../types/storefront";
import styles from "./storefront-preview.module.css";

type BrandPreviewDesktopProps = {
  brand: StorefrontBrandContent;
  bookingSettings: StoreBookingSettings;
};

export function BrandPreviewDesktop(props: BrandPreviewDesktopProps) {
  const depositLabel = props.bookingSettings.depositsEnabled
    ? props.bookingSettings.depositCalculationType === "percent"
      ? `Deposit ${props.bookingSettings.depositValue}%`
      : `Deposit ${props.bookingSettings.depositValue}`
    : "Deposit disabled";

  return (
    <section className={[styles.frame, styles.desktop].join(" ")}>
      <header className={styles.nav}>
        <div className={styles.brand}>
          <div className={styles.brandName}>{props.brand.brandName}</div>
          <div className={styles.brandMeta}>{props.brand.branchName || "Tenant Default"} preview</div>
        </div>
        <nav className={styles.navItems}>
          {props.brand.customNavItems.map((item) => (
            <span key={`${item.label}-${item.href}`}>{item.label}</span>
          ))}
        </nav>
      </header>

      <div className={styles.heroSplit}>
        <div className={styles.copy}>
          <div className={styles.eyebrow}>Storefront desktop</div>
          <h2 className={styles.title}>{props.brand.heroTitle}</h2>
          <p className={styles.subtitle}>{props.brand.heroSubtitle}</p>
          <div className={styles.actions}>
            <span className={styles.primaryCta}>{props.brand.ctaPrimaryLabel}</span>
            <span className={styles.secondaryCta}>{props.brand.ctaSecondaryLabel}</span>
          </div>
          <div className={[styles.cardGrid, styles.desktopCards].join(" ")}>
            <article className={styles.card}>
              <div className={styles.cardTitle}>{props.brand.servicesSectionTitle}</div>
              <div className={styles.cardBody}>{props.brand.servicesSectionSubtitle}</div>
            </article>
            <article className={styles.card}>
              <div className={styles.cardTitle}>{props.brand.bookingNoticeTitle}</div>
              <div className={styles.cardBody}>{props.brand.bookingNoticeBody}</div>
            </article>
            <article className={styles.card}>
              <div className={styles.cardTitle}>Deposit rules</div>
              <div className={styles.cardBody}>
                {props.bookingSettings.depositsEnabled
                  ? `${props.bookingSettings.depositCalculationType} / ${props.bookingSettings.depositValue}`
                  : "Deposit disabled"}
              </div>
            </article>
          </div>
        </div>

        <aside className={styles.bookingCard}>
          <div
            className={styles.heroImage}
            style={props.brand.heroImageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(20, 20, 20, 0.08), rgba(20, 20, 20, 0.3)), url(${props.brand.heroImageUrl})` } : undefined}
          >
            <span className={styles.heroImageLabel}>{props.brand.heroImageUrl ? "Live hero image" : "Hero image placeholder"}</span>
          </div>
          <div className={styles.bookingStatRow}>
            <span>Booking window</span>
            <strong>{props.bookingSettings.bookingWindowDays} days</strong>
          </div>
          <div className={styles.bookingStatRow}>
            <span>Advance rule</span>
            <strong>{props.bookingSettings.minAdvanceMinutes} min</strong>
          </div>
          <div className={styles.bookingStatRow}>
            <span>Deposit</span>
            <strong>{depositLabel}</strong>
          </div>
        </aside>
      </div>
    </section>
  );
}
