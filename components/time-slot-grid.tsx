import styles from "./booking-ui.module.css";
import type { PublicBookingTimeSlot } from "../types/storefront";

type TimeSlotGridProps = {
  slots: PublicBookingTimeSlot[];
  selectedSlotStart: string | null;
  onSelectSlot?: (slot: PublicBookingTimeSlot) => void;
};

export function TimeSlotGrid(props: TimeSlotGridProps) {
  if (props.slots.length === 0) {
    return (
      <div className={styles.emptyCard}>
        <p className={styles.emptyText}>No available time remains for this date. Try another day or therapist.</p>
      </div>
    );
  }

  return (
    <div className={styles.slotGrid}>
      {props.slots.map((slot) => {
        const selected = slot.startsAt === props.selectedSlotStart;
        const className = [styles.slotButton, selected ? styles.isSelected : ""].filter(Boolean).join(" ");
        return (
          <button key={slot.startsAt} type="button" className={className} onClick={() => props.onSelectSlot?.(slot)}>
            {slot.label}
          </button>
        );
      })}
    </div>
  );
}
