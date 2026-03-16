import { BookingOverviewItem } from "../types/booking-management";
import { BookingStatusBadge } from "./booking-status-badge";
import styles from "./booking-management.module.css";
import { PaymentStatusBadge } from "./payment-status-badge";

type BookingListTableProps = {
  items: BookingOverviewItem[];
  selectedId: string | null;
  onSelect: (id: string, focusSection?: "default" | "evidence") => void;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function notificationSummary(item: BookingOverviewItem) {
  const parts: string[] = [];
  if ((item.notificationQueuedCount || 0) > 0) parts.push(`${item.notificationQueuedCount} queued`);
  if ((item.notificationFailedCount || 0) > 0) parts.push(`${item.notificationFailedCount} failed`);
  if (item.hasDepositReminderPending) parts.push("deposit reminder");
  return parts.length > 0 ? parts.join(" 繚 ") : null;
}

function liveSmokeLabel(item: BookingOverviewItem) {
  switch (item.liveSmokeStatus) {
    case "pass":
      return "live smoke pass";
    case "partial":
      return "live smoke partial";
    case "fail":
      return "live smoke fail";
    default:
      return "not recorded";
  }
}

function liveSmokeBadgeClass(item: BookingOverviewItem) {
  switch (item.liveSmokeStatus) {
    case "pass":
      return styles.badgeSmokePass;
    case "partial":
      return styles.badgeSmokePartial;
    case "fail":
      return styles.badgeSmokeFail;
    default:
      return styles.badgeSmokeNone;
  }
}

export function BookingListTable(props: BookingListTableProps) {
  return (
    <section className={`fdGlassSubPanel ${styles.tableCard}`}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Service</th>
              <th>Therapist</th>
              <th>Time</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Rollout</th>
              <th>Branch</th>
              <th>Source</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {props.items.map((item) => (
              <tr
                key={item.id}
                className={item.id === props.selectedId ? styles.selectedRow : ""}
                onClick={() => props.onSelect(item.id)}
              >
                <td>
                  <div className={styles.primaryText}>{item.customerName}</div>
                  <div className={styles.secondaryText}>{item.customerPhone || item.publicReference || "-"}</div>
                </td>
                <td>
                  <div className={styles.primaryText}>{item.serviceName}</div>
                  <div className={styles.secondaryText}>
                    {item.packageName ? `${item.packageName} ??${item.publicReference || "No reference yet"}` : item.publicReference || "No reference yet"}
                  </div>
                </td>
                <td>
                  <div className={styles.primaryText}>{item.therapistName || "Unassigned"}</div>
                </td>
                <td className={styles.timeText}>
                  <div className={styles.primaryText}>{formatDateTime(item.startsAt)}</div>
                  <div className={styles.secondaryText}>{formatDateTime(item.endsAt)}</div>
                </td>
                <td>
                  <div className={styles.badgeRow}>
                    <BookingStatusBadge status={item.status} />
                  </div>
                </td>
                <td>
                  <div className={styles.badgeRow}>
                    <PaymentStatusBadge
                      paymentStatus={item.paymentStatus}
                      depositRequiredAmount={item.depositRequiredAmount}
                      depositPaidAmount={item.depositPaidAmount}
                      paymentMode={item.paymentMode}
                      packageSessionsReserved={item.packageSessionsReserved}
                      packageSessionsConsumed={item.packageSessionsConsumed}
                    />
                  </div>
                  {item.paymentMode === "package" ? (
                    <div className={styles.depositText}>
                      {item.packageSessionsConsumed > 0 ? `Consumed ${item.packageSessionsConsumed}` : `Reserved ${item.packageSessionsReserved}`}
                    </div>
                  ) : item.depositRequiredAmount > 0 ? (
                    <div className={styles.depositText}>
                      {formatMoney(item.depositPaidAmount)} / {formatMoney(item.depositRequiredAmount)}
                    </div>
                  ) : null}
                </td>
                <td>
                  <div className={styles.badgeRow}>
                    <span className={`${styles.badge} ${liveSmokeBadgeClass(item)}`}>{liveSmokeLabel(item)}</span>
                  </div>
                  <div className={styles.secondaryText}>{item.liveSmokePerformedAt ? formatDateTime(item.liveSmokePerformedAt) : "No evidence yet"}</div>
                  {item.liveSmokeProvider || item.liveSmokeReference ? (
                    <div className={styles.secondaryText}>{[item.liveSmokeProvider, item.liveSmokeReference].filter(Boolean).join(" / ")}</div>
                  ) : null}
                  <button
                    type="button"
                    className={styles.inlineLinkButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onSelect(item.id, "evidence");
                    }}
                  >
                    View evidence
                  </button>
                </td>
                <td>
                  <div className={styles.primaryText}>{item.branchName || "Not assigned"}</div>
                </td>
                <td>
                  <div className={styles.primaryText}>{item.source || "staff"}</div>
                  {notificationSummary(item) ? <div className={styles.secondaryText}>{notificationSummary(item)}</div> : null}
                </td>
                <td>
                  <div className={styles.secondaryText}>{item.noteExcerpt || "-"}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.mobileCards}>
        {props.items.map((item) => (
          <article
            key={`${item.id}-mobile`}
            className={styles.mobileCard}
            onClick={() => props.onSelect(item.id)}
          >
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.primaryText}>{item.customerName}</div>
                <div className={styles.secondaryText}>{item.serviceName}</div>
              </div>
              <BookingStatusBadge status={item.status} />
            </div>
            <div className={styles.cardMeta}>
              <div className={styles.secondaryText}>{formatDateTime(item.startsAt)}</div>
              <div className={styles.badgeRow}>
                <PaymentStatusBadge
                  paymentStatus={item.paymentStatus}
                  depositRequiredAmount={item.depositRequiredAmount}
                  depositPaidAmount={item.depositPaidAmount}
                  paymentMode={item.paymentMode}
                  packageSessionsReserved={item.packageSessionsReserved}
                  packageSessionsConsumed={item.packageSessionsConsumed}
                />
                {item.paymentMode === "package" ? (
                  <span className={styles.depositText}>
                    {item.packageSessionsConsumed > 0 ? `Consumed ${item.packageSessionsConsumed}` : `Reserved ${item.packageSessionsReserved}`}
                  </span>
                ) : item.depositRequiredAmount > 0 ? (
                  <span className={styles.depositText}>{formatMoney(item.depositPaidAmount)} / {formatMoney(item.depositRequiredAmount)}</span>
                ) : null}
                <span className={`${styles.badge} ${liveSmokeBadgeClass(item)}`}>{liveSmokeLabel(item)}</span>
              </div>
              <div className={styles.secondaryText}>
                {item.branchName || "No branch"} 繚 {item.therapistName || "Unassigned"}
              </div>
              <div className={styles.secondaryText}>
                {item.liveSmokePerformedAt ? `Evidence ${formatDateTime(item.liveSmokePerformedAt)}` : "No live smoke evidence yet"}
              </div>
              {notificationSummary(item) ? <div className={styles.secondaryText}>{notificationSummary(item)}</div> : null}
              <div className={styles.secondaryText}>{item.noteExcerpt || item.publicReference || "Open for details"}</div>
              <button
                type="button"
                className={styles.inlineLinkButton}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onSelect(item.id, "evidence");
                }}
              >
                View evidence
              </button>
            </div>
          </article>
        ))}
      </div>

      {props.items.length === 0 ? <div className={styles.emptyState}>No bookings found in the current scope and filters.</div> : null}
    </section>
  );
}
