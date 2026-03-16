import styles from "./booking-ui.module.css";
import type { StorefrontNavItem } from "../types/storefront";

type BookingHeaderProps = {
  brandName: string;
  branchName: string | null;
  navItems: StorefrontNavItem[];
  ctaLabel: string;
  onPrimaryClick?: () => void;
};

export function BookingHeader(props: BookingHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brandLockup}>
        <span className={styles.brandEyebrow}>Sports Massage</span>
        <strong className={styles.brandTitle}>{props.brandName}</strong>
        {props.branchName ? <span className={styles.brandBranch}>{props.branchName}</span> : null}
      </div>

      <nav className={styles.nav} aria-label="Booking sections">
        {props.navItems.map((item) => (
          <a key={`${item.label}-${item.href}`} href={item.href} className={styles.navLink}>
            {item.label}
          </a>
        ))}
        <button type="button" className={styles.ctaButton} onClick={props.onPrimaryClick}>
          {props.ctaLabel}
        </button>
      </nav>
    </header>
  );
}
