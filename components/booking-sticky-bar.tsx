import styles from "./booking-ui.module.css";

type BookingStickyBarProps = {
  totalLabel: string;
  depositLabel: string | null;
  buttonLabel: string;
  disabled?: boolean;
  onAction?: () => void;
};

export function BookingStickyBar(props: BookingStickyBarProps) {
  return (
    <div className={styles.stickyBar}>
      <div className={styles.stickyMeta}>
        <span className={styles.stickyTitle}>Booking summary</span>
        <strong className={styles.stickyAmount}>{props.totalLabel}</strong>
        {props.depositLabel ? <span className={styles.helperText}>{props.depositLabel}</span> : null}
      </div>
      <button type="button" className={styles.stickyButton} disabled={props.disabled} onClick={props.onAction}>
        {props.buttonLabel}
      </button>
    </div>
  );
}
