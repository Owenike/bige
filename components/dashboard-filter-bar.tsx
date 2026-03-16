import type { BookingOverviewFilters } from "../types/booking-management";
import styles from "./booking-management.module.css";

export type BookingFilterState = {
  date: string;
  branchId: string;
  therapistId: string;
  status: string;
  q: string;
  deposit: string;
  liveSmoke: string;
  noShow: boolean;
};

type DashboardFilterBarProps = {
  value: BookingFilterState;
  filters: BookingOverviewFilters | null;
  loading: boolean;
  onChange: (next: BookingFilterState) => void;
  onApply: () => void;
  onReset: () => void;
};

export function DashboardFilterBar(props: DashboardFilterBarProps) {
  const filters = props.filters;

  return (
    <section className={`fdGlassSubPanel ${styles.toolbarCard}`}>
      <div className={styles.toolbarHeader}>
        <div>
          <h2 className={styles.toolbarTitle}>Booking Filters</h2>
          <p className={styles.toolbarHint}>Date, branch, therapist, status, deposit, live smoke rollout state, and customer search stay in one clean control rail.</p>
        </div>
      </div>

      <div className={styles.filterGrid}>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Date</span>
          <input
            className={styles.control}
            type="date"
            value={props.value.date}
            onChange={(event) => props.onChange({ ...props.value, date: event.target.value })}
          />
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Branch</span>
          <select
            className={styles.control}
            value={props.value.branchId}
            onChange={(event) => props.onChange({ ...props.value, branchId: event.target.value })}
            disabled={filters?.branchLocked}
          >
            <option value="">All branches</option>
            {(filters?.branches || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Therapist</span>
          <select
            className={styles.control}
            value={props.value.therapistId}
            onChange={(event) => props.onChange({ ...props.value, therapistId: event.target.value })}
          >
            <option value="">All therapists</option>
            {(filters?.therapists || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Status</span>
          <select
            className={styles.control}
            value={props.value.status}
            onChange={(event) => props.onChange({ ...props.value, status: event.target.value })}
          >
            <option value="">All statuses</option>
            {(filters?.statuses || []).map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Deposit</span>
          <select
            className={styles.control}
            value={props.value.deposit}
            onChange={(event) => props.onChange({ ...props.value, deposit: event.target.value })}
          >
            <option value="">All deposit states</option>
            <option value="paid">Deposit paid</option>
            <option value="unpaid">Deposit unpaid</option>
          </select>
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>No Show</span>
          <select
            className={styles.control}
            value={props.value.noShow ? "1" : "0"}
            onChange={(event) => props.onChange({ ...props.value, noShow: event.target.value === "1" })}
          >
            <option value="0">Include all</option>
            <option value="1">Only no show</option>
          </select>
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Live Smoke</span>
          <select
            className={styles.control}
            value={props.value.liveSmoke}
            onChange={(event) => props.onChange({ ...props.value, liveSmoke: event.target.value })}
          >
            {(filters?.liveSmokeStatuses || [{ value: "", label: "All evidence states" }]).map((item) => (
              <option key={item.value || "all"} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className={`${styles.filterField} ${styles.filterWide}`}>
          <span className={styles.filterLabel}>Customer</span>
          <input
            className={styles.control}
            value={props.value.q}
            onChange={(event) => props.onChange({ ...props.value, q: event.target.value })}
            placeholder="Search customer, phone, service, or booking ref"
          />
        </label>
      </div>

      <div className={styles.toolbarActions}>
        <div className={styles.toolbarChips}>
          <span className="fdPillBtn">{filters?.branchLocked ? "Branch scope locked" : "Tenant-wide scope"}</span>
          <span className="fdPillBtn">{props.value.date || "No date selected"}</span>
        </div>
        <div className={styles.toolbarChips}>
          <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={props.onApply} disabled={props.loading}>
            {props.loading ? "Refreshing..." : "Apply filters"}
          </button>
          <button type="button" className="fdPillBtn" onClick={props.onReset}>
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}
