"use client";

import Link from "next/link";
import styles from "./settings.module.css";

export default function ManagerSettingsHomePage() {
  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className={styles.page}>
          <article className={`fdGlassPanel ${styles.heroCard}`}>
            <div className={styles.heroEyebrow}>Storefront foundations</div>
            <h1 className={styles.heroTitle}>Manager Settings</h1>
            <p className={styles.heroBody}>
              Phase 1 anchors the sports massage storefront on top of the existing tenant, branch, booking, audit, and notification
              architecture. Brand content and booking rules are editable per tenant or per branch without replacing existing manager,
              frontdesk, or booking flows.
            </p>
            <div className={styles.actionRow}>
              <Link className="fdPillBtn fdPillBtnPrimary" href="/manager/settings/brand">
                Brand content
              </Link>
              <Link className="fdPillBtn" href="/manager/settings/booking">
                Booking rules
              </Link>
              <Link className="fdPillBtn" href="/manager">
                Back to manager
              </Link>
            </div>
          </article>

          <section className={styles.linkCardGrid}>
            <article className={`fdGlassSubPanel ${styles.linkCard}`}>
              <h2 className={styles.panelTitle}>What Phase 1 adds</h2>
              <p className={styles.panelText}>
                `storefront_brand_contents`, `store_booking_settings`, brand asset metadata, booking status logs, and additive booking /
                service fields for deposit and storefront-ready content.
              </p>
            </article>
            <article className={`fdGlassSubPanel ${styles.linkCard}`}>
              <h2 className={styles.panelTitle}>What stays intact</h2>
              <p className={styles.panelText}>
                Existing `tenant_id`, `branch_id`, `members`, `bookings`, `coach_slots`, `coach_blocks`, feature flags, notifications,
                and manager pages are extended rather than replaced.
              </p>
            </article>
            <article className={`fdGlassSubPanel ${styles.linkCard}`}>
              <h2 className={styles.panelTitle}>How later phases connect</h2>
              <p className={styles.panelText}>
                Phase 2 can read the public storefront payload immediately. Phase 3 can reuse the same manager endpoints for richer text,
                upload, and preview workflows.
              </p>
            </article>
          </section>
        </section>
      </section>
    </main>
  );
}
