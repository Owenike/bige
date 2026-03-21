"use client";

import Link from "next/link";
import ManagerDomainNav from "../../../components/manager-domain-nav";
import styles from "./settings.module.css";

export default function ManagerSettingsHomePage() {
  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className={styles.page}>
          <article className={`fdGlassPanel ${styles.heroCard}`} data-manager-settings-page>
            <div className={styles.heroEyebrow}>System policy and cross-page governance</div>
            <h1 className={styles.heroTitle}>Manager Settings</h1>
            <p className={styles.heroBody} data-manager-settings-boundary>
              This is the formal settings landing page for manager-facing global policy and system entry points. Operations
              owns cross-page operating defaults, integrations owns external boundary visibility, and notifications remains a
              dedicated manager subdomain. Business master-data pages stay under the main manager domain instead of being mixed
              into settings.
            </p>
            <div className={styles.actionRow}>
              <Link className="fdPillBtn fdPillBtnPrimary" href="/manager/settings/operations">
                Operations & Permissions
              </Link>
              <Link className="fdPillBtn" href="/manager/integrations">
                Integrations
              </Link>
              <Link className="fdPillBtn" href="/manager/notifications">
                Notifications domain
              </Link>
              <Link className="fdPillBtn" href="/manager">
                Back to manager
              </Link>
            </div>
          </article>

          <ManagerDomainNav section="system" showIndex />

          <section className={styles.linkCardGrid}>
            <article className={`fdGlassSubPanel ${styles.linkCard}`}>
              <h2 className={styles.panelTitle}>What settings owns</h2>
              <p className={styles.panelText}>
                Cross-page policy, operations defaults, integrations entry points, and notifications system routing belong
                here. These are system-level decisions, not day-to-day frontdesk actions.
              </p>
            </article>
            <article className={`fdGlassSubPanel ${styles.linkCard}`}>
              <h2 className={styles.panelTitle}>What stays in business pages</h2>
              <p className={styles.panelText}>
                Therapists, coach slots, services, plans, packages, and booking waitlist keep their own dedicated manager
                pages. Settings should not absorb those business CRUD responsibilities.
              </p>
            </article>
            <article className={`fdGlassSubPanel ${styles.linkCard}`}>
              <h2 className={styles.panelTitle}>Notifications as a system subdomain</h2>
              <p className={styles.panelText}>
                Notifications now has its own manager-facing domain. Use settings as the system landing to reach it, then use
                the notifications landing page to choose retry, audit, readiness, templates, preferences, preflight,
                runtime-readiness, or ops.
              </p>
            </article>
            <article className={`fdGlassSubPanel ${styles.linkCard}`}>
              <h2 className={styles.panelTitle}>Why not frontdesk</h2>
              <p className={styles.panelText}>
                Setup-type responsibility has been moved out of frontdesk. Frontdesk stays focused on booking execution and
                day-of-operation flow, not long-lived system policy.
              </p>
            </article>
          </section>
        </section>
      </section>
    </main>
  );
}
