import styles from "./booking-management.module.css";

type PaymentStatusBadgeProps = {
  paymentStatus: string;
  depositRequiredAmount: number;
  depositPaidAmount: number;
  paymentMode?: string;
  packageSessionsReserved?: number;
  packageSessionsConsumed?: number;
};

function labelForStatus(paymentStatus: string) {
  if (paymentStatus === "deposit_pending") return "Deposit Pending";
  if (paymentStatus === "deposit_paid") return "Deposit Paid";
  if (paymentStatus === "fully_paid") return "Fully Paid";
  if (paymentStatus === "partially_refunded") return "Partially Refunded";
  if (paymentStatus === "refunded") return "Refunded";
  return "Unpaid";
}

function classForStatus(paymentStatus: string, depositRequiredAmount: number, depositPaidAmount: number) {
  if (paymentStatus === "deposit_paid" || paymentStatus === "fully_paid") return styles.badgePaid;
  if (paymentStatus === "partially_refunded" || paymentStatus === "refunded") return styles.badgeRefunded;
  if (depositRequiredAmount > 0 && depositPaidAmount <= 0) return styles.badgeDepositDue;
  return "";
}

export function PaymentStatusBadge(props: PaymentStatusBadgeProps) {
  const packageLabel =
    props.packageSessionsConsumed && props.packageSessionsConsumed > 0
      ? "Package Consumed"
      : props.packageSessionsReserved && props.packageSessionsReserved > 0
        ? "Package Reserved"
        : "Covered by Package";
  return (
    <span className={[styles.badge, classForStatus(props.paymentStatus, props.depositRequiredAmount, props.depositPaidAmount)].filter(Boolean).join(" ")}>
      {props.paymentMode === "package" && props.paymentStatus === "fully_paid" ? packageLabel : labelForStatus(props.paymentStatus)}
    </span>
  );
}
