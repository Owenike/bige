import styles from "./booking-ui.module.css";
import type { StorefrontServiceSummary } from "../types/storefront";

type BookingServiceCardProps = {
  service: StorefrontServiceSummary;
  selected?: boolean;
  priceLabel: string;
  depositLabel: string | null;
  onSelect?: () => void;
};

export function BookingServiceCard(props: BookingServiceCardProps) {
  const className = [styles.serviceCard, props.selected ? styles.isSelected : ""].filter(Boolean).join(" ");

  return (
    <button type="button" className={className} onClick={props.onSelect}>
      <div className={styles.serviceTopLine}>
        <div>
          <h3 className={styles.serviceName}>{props.service.name}</h3>
          <p className={styles.serviceDescription}>{props.service.description || "Targeted recovery session."}</p>
        </div>
        {props.selected ? <span className={styles.miniBadge}>Selected</span> : null}
      </div>

      <div className={styles.serviceMeta}>
        <span className={styles.summaryPill}>{props.priceLabel}</span>
        <span className={styles.summaryPill}>{props.service.durationMinutes} min</span>
        {(props.service.preBufferMinutes || props.service.postBufferMinutes) > 0 ? (
          <span className={styles.summaryPill}>
            Buffer {props.service.preBufferMinutes + props.service.postBufferMinutes} min
          </span>
        ) : null}
        {props.depositLabel ? <span className={styles.summaryPill}>{props.depositLabel}</span> : null}
      </div>
    </button>
  );
}
