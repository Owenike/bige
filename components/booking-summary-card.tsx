import styles from "./booking-ui.module.css";

type BookingSummaryCardProps = {
  totalLabel: string;
  depositLabel: string | null;
  items: Array<{ label: string; value: string }>;
  ctaLabel: string;
  disabled?: boolean;
  helperText?: string;
  onSubmit?: () => void;
};

export function BookingSummaryCard(props: BookingSummaryCardProps) {
  return (
    <section className={styles.summaryCard}>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryRow}>
          <div>
            <div className={styles.summaryLabel}>Session total</div>
            <div className={styles.summaryPrice}>{props.totalLabel}</div>
          </div>
          {props.depositLabel ? <span className={styles.summaryPill}>{props.depositLabel}</span> : null}
        </div>

        {props.items.map((item) => (
          <div key={item.label} className={styles.summaryRow}>
            <div className={styles.summaryLabel}>{item.label}</div>
            <div className={styles.summaryValue}>{item.value}</div>
          </div>
        ))}
      </div>

      {props.helperText ? <p className={styles.summaryMuted}>{props.helperText}</p> : null}

      <div className={styles.summaryActions}>
        <button type="button" className={styles.summaryButton} disabled={props.disabled} onClick={props.onSubmit}>
          {props.ctaLabel}
        </button>
      </div>
    </section>
  );
}
