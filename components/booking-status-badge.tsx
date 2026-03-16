import styles from "./booking-management.module.css";

type BookingStatusBadgeProps = {
  status: string;
};

function normalizeStatus(status: string) {
  if (status === "booked") return "confirmed";
  if (status === "checked_in") return "confirmed";
  return status;
}

function labelForStatus(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "pending") return "Pending";
  if (normalized === "confirmed") return status === "checked_in" ? "Checked In" : "Confirmed";
  if (normalized === "completed") return "Completed";
  if (normalized === "cancelled") return "Cancelled";
  if (normalized === "no_show") return "No Show";
  return status;
}

function classForStatus(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "pending") return styles.badgePending;
  if (normalized === "confirmed") return styles.badgeConfirmed;
  if (normalized === "completed") return styles.badgeCompleted;
  if (normalized === "cancelled") return styles.badgeCancelled;
  if (normalized === "no_show") return styles.badgeNoShow;
  return "";
}

export function BookingStatusBadge(props: BookingStatusBadgeProps) {
  return (
    <span className={[styles.badge, classForStatus(props.status)].filter(Boolean).join(" ")}>
      {labelForStatus(props.status)}
    </span>
  );
}
