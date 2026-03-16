"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./reports.module.css";
import type { ManagerReportsResponse } from "../../../types/manager-reports";

type ApiEnvelope<T> = { data?: T; error?: { message?: string } | string; message?: string };

type FilterState = {
  preset: "today" | "this_week" | "this_month" | "custom";
  dateFrom: string;
  dateTo: string;
  branchId: string;
  therapistId: string;
  serviceId: string;
  bookingStatus: string;
  paymentMode: string;
  paymentStatus: string;
  notificationStatus: string;
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function weekStartDate() {
  const today = new Date(`${todayDate()}T00:00:00.000Z`);
  const day = today.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  today.setUTCDate(today.getUTCDate() + delta);
  return today.toISOString().slice(0, 10);
}

function monthStartDate() {
  const today = todayDate();
  return `${today.slice(0, 8)}01`;
}

function defaultFilters(): FilterState {
  return {
    preset: "this_month",
    dateFrom: monthStartDate(),
    dateTo: todayDate(),
    branchId: "",
    therapistId: "",
    serviceId: "",
    bookingStatus: "",
    paymentMode: "",
    paymentStatus: "",
    notificationStatus: "",
  };
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as ApiEnvelope<unknown>;
  if (typeof body.error === "string" && body.error) return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") return body.error.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

async function requestJson<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | T | null;
  if (!response.ok) throw new Error(getErrorMessage(payload, "Request failed"));
  if (payload && typeof payload === "object" && "data" in payload && payload.data) return payload.data as T;
  return payload as T;
}

function buildQuery(filters: FilterState) {
  const params = new URLSearchParams();
  params.set("preset", filters.preset);
  params.set("date_from", filters.dateFrom);
  params.set("date_to", filters.dateTo);
  if (filters.branchId) params.set("branch_id", filters.branchId);
  if (filters.therapistId) params.set("therapist_id", filters.therapistId);
  if (filters.serviceId) params.set("service_id", filters.serviceId);
  if (filters.bookingStatus) params.set("booking_status", filters.bookingStatus);
  if (filters.paymentMode) params.set("payment_mode", filters.paymentMode);
  if (filters.paymentStatus) params.set("payment_status", filters.paymentStatus);
  if (filters.notificationStatus) params.set("notification_status", filters.notificationStatus);
  return params.toString();
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value || 0);
}

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function ManagerReportsPage() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters());
  const [reports, setReports] = useState<ManagerReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => buildQuery(filters), [filters]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    requestJson<ManagerReportsResponse>(`/api/manager/reports/summary?${query}`)
      .then((payload) => {
        if (active) setReports(payload);
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : "Failed to load reports");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  function setPreset(preset: FilterState["preset"]) {
    if (preset === "today") {
      setFilters((prev) => ({ ...prev, preset, dateFrom: todayDate(), dateTo: todayDate() }));
      return;
    }
    if (preset === "this_week") {
      setFilters((prev) => ({ ...prev, preset, dateFrom: weekStartDate(), dateTo: todayDate() }));
      return;
    }
    if (preset === "this_month") {
      setFilters((prev) => ({ ...prev, preset, dateFrom: monthStartDate(), dateTo: todayDate() }));
      return;
    }
    setFilters((prev) => ({ ...prev, preset }));
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className={styles.page}>
          <article className={`fdGlassPanel ${styles.heroCard}`}>
            <div className={styles.eyebrow}>Manager Reports</div>
            <h1 className={styles.title}>營運報表與門市表現</h1>
            <p className={styles.subtitle}>
              以服務發生時間作為主口徑，集中查看預約、付款、套票、通知與門市執行狀況。
              這一版先聚焦 manager 真正會用來判斷營運健康度的核心數字。
            </p>
            <div className={styles.toolbarActions} style={{ marginTop: 14 }}>
              <a className="fdPillBtn fdPillBtnPrimary" href="/manager">Back to manager hub</a>
              <a className="fdPillBtn" href="/manager/bookings">Open booking overview</a>
            </div>
          </article>

          <section className={`fdGlassSubPanel ${styles.toolbar}`}>
            <div className={styles.presetRow}>
              {(["today", "this_week", "this_month", "custom"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={filters.preset === preset ? "fdPillBtn fdPillBtnPrimary" : "fdPillBtn"}
                  onClick={() => setPreset(preset)}
                >
                  {preset === "today" ? "Today" : preset === "this_week" ? "This Week" : preset === "this_month" ? "This Month" : "Custom"}
                </button>
              ))}
            </div>

            <div className={styles.filterGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Date From</span>
                <input className={styles.control} type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, preset: "custom", dateFrom: event.target.value }))} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Date To</span>
                <input className={styles.control} type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, preset: "custom", dateTo: event.target.value }))} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Branch</span>
                <select className={styles.control} value={filters.branchId} onChange={(event) => setFilters((prev) => ({ ...prev, branchId: event.target.value }))} disabled={reports?.filters.branchLocked}>
                  <option value="">All Branches</option>
                  {(reports?.filters.branches || []).map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Therapist</span>
                <select className={styles.control} value={filters.therapistId} onChange={(event) => setFilters((prev) => ({ ...prev, therapistId: event.target.value }))}>
                  <option value="">All Therapists</option>
                  {(reports?.filters.therapists || []).map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Service</span>
                <select className={styles.control} value={filters.serviceId} onChange={(event) => setFilters((prev) => ({ ...prev, serviceId: event.target.value }))}>
                  <option value="">All Services</option>
                  {(reports?.filters.services || []).map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Booking Status</span>
                <select className={styles.control} value={filters.bookingStatus} onChange={(event) => setFilters((prev) => ({ ...prev, bookingStatus: event.target.value }))}>
                  {(reports?.filters.statuses || []).map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Payment Mode</span>
                <select className={styles.control} value={filters.paymentMode} onChange={(event) => setFilters((prev) => ({ ...prev, paymentMode: event.target.value }))}>
                  {(reports?.filters.paymentModes || []).map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Payment Status</span>
                <select className={styles.control} value={filters.paymentStatus} onChange={(event) => setFilters((prev) => ({ ...prev, paymentStatus: event.target.value }))}>
                  {(reports?.filters.paymentStatuses || []).map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Notification</span>
                <select className={styles.control} value={filters.notificationStatus} onChange={(event) => setFilters((prev) => ({ ...prev, notificationStatus: event.target.value }))}>
                  {(reports?.filters.notificationStatuses || []).map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.toolbarActions}>
              <button type="button" className="fdPillBtn" onClick={() => setFilters(defaultFilters())}>Reset Filters</button>
            </div>
          </section>

          {error ? <div className={`${styles.message} ${styles.messageError}`}>{error}</div> : null}
          {loading ? <div className={styles.loading}>Loading reports...</div> : null}

          {reports ? (
            <>
              <section className={styles.cardGrid}>
                <article className={styles.metricCard}><div className={styles.metricLabel}>Bookings</div><div className={styles.metricValue}>{reports.summary.bookingTotal}</div><div className={styles.metricSub}>starts_at within selected range</div></article>
                <article className={styles.metricCard}><div className={styles.metricLabel}>Completed</div><div className={styles.metricValue}>{reports.summary.completedCount}</div><div className={styles.metricSub}>{formatRate(reports.summary.completionRate)} completion rate</div></article>
                <article className={styles.metricCard}><div className={styles.metricLabel}>Cancelled</div><div className={styles.metricValue}>{reports.summary.cancelledCount}</div><div className={styles.metricSub}>{formatRate(reports.summary.cancellationRate)} cancellation rate</div></article>
                <article className={styles.metricCard}><div className={styles.metricLabel}>No Show</div><div className={styles.metricValue}>{reports.summary.noShowCount}</div><div className={styles.metricSub}>{formatRate(reports.summary.noShowRate)} no-show rate</div></article>
                <article className={styles.metricCard}><div className={styles.metricLabel}>Deposit Paid</div><div className={styles.metricValue}>{formatMoney(reports.summary.depositPaidTotal)}</div><div className={styles.metricSub}>cash already collected</div></article>
                <article className={styles.metricCard}><div className={styles.metricLabel}>Outstanding</div><div className={styles.metricValue}>{formatMoney(reports.summary.outstandingTotal)}</div><div className={styles.metricSub}>non-cancelled booking balance</div></article>
                <article className={styles.metricCard}><div className={styles.metricLabel}>Package Consumed</div><div className={styles.metricValue}>{reports.summary.packageConsumedSessionsCount}</div><div className={styles.metricSub}>completed package sessions</div></article>
                <article className={styles.metricCard}><div className={styles.metricLabel}>Member Mix</div><div className={styles.metricValue}>{reports.summary.newCustomerCount} / {reports.summary.returningCustomerCount}</div><div className={styles.metricSub}>new vs returning completed members</div></article>
              </section>

              <section className={styles.splitGrid}>
                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Therapist Ranking</h2>
                  <div className={styles.list}>
                    {reports.therapistRanking.map((item) => (
                      <div key={item.therapistId || item.therapistName} className={styles.listItem}>
                        <div className={styles.primary}>{item.therapistName}</div>
                        <div className={styles.secondary}>{item.bookingCount} bookings, {item.completedCount} completed, {formatRate(item.completionRate)}</div>
                        <div className={styles.secondary}>{formatMoney(item.singleBookingRevenueTotal)} single-booking face value, {item.packageConsumedSessionsCount} package sessions</div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Service Ranking</h2>
                  <div className={styles.list}>
                    {reports.serviceRanking.map((item) => (
                      <div key={item.serviceId || item.serviceName} className={styles.listItem}>
                        <div className={styles.primary}>{item.serviceName}</div>
                        <div className={styles.secondary}>{item.bookingCount} bookings, {item.completedCount} completed, {item.cancelledCount} cancelled</div>
                        <div className={styles.secondary}>avg {formatMoney(item.averagePrice)}, range {formatMoney(item.minPrice)} - {formatMoney(item.maxPrice)}</div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Hot Time Slots</h2>
                  <div className={styles.list}>
                    {reports.hotTimeSlots.map((item) => (
                      <div key={item.label} className={styles.listItem}>
                        <div className={styles.primary}>{item.label}</div>
                        <div className={styles.secondary}>{item.bookingCount} bookings, {item.completedCount} completed</div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Notification Summary</h2>
                  <div className={styles.chips}>
                    <span className={styles.chip}>Queued {reports.notificationSummary.queuedCount}</span>
                    <span className={styles.chip}>Sent {reports.notificationSummary.sentCount}</span>
                    <span className={styles.chip}>Failed {reports.notificationSummary.failedCount}</span>
                    <span className={styles.chip}>Cancelled {reports.notificationSummary.cancelledCount}</span>
                    <span className={styles.chip}>Reminder Sent {reports.notificationSummary.reminderSentCount}</span>
                    <span className={styles.chip}>Deposit Pending {reports.notificationSummary.depositPendingQueuedCount}</span>
                  </div>
                  <div className={styles.list} style={{ marginTop: 12 }}>
                    {Object.entries(reports.notificationSummary.byEventType).map(([key, value]) => (
                      <div key={key} className={styles.listItem}>
                        <div className={styles.primary}>{key}</div>
                        <div className={styles.secondary}>{value} deliveries</div>
                      </div>
                    ))}
                  </div>
                </article>
              </section>

              <section className={styles.splitGrid}>
                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Payment Summary</h2>
                  <div className={styles.list}>
                    <div className={styles.listItem}><div className={styles.primary}>Single Booking Face Value</div><div className={styles.secondary}>{formatMoney(reports.paymentSummary.singleBookingRevenueTotal)} and {reports.paymentSummary.singleBookingCount} bookings</div></div>
                    <div className={styles.listItem}><div className={styles.primary}>Deposit Paid Total</div><div className={styles.secondary}>{formatMoney(reports.paymentSummary.depositPaidTotal)}</div></div>
                    <div className={styles.listItem}><div className={styles.primary}>Outstanding Total</div><div className={styles.secondary}>{formatMoney(reports.paymentSummary.outstandingTotal)}</div></div>
                    {Object.entries(reports.paymentSummary.byStatus).map(([key, value]) => (
                      <div key={key} className={styles.listItem}><div className={styles.primary}>{key}</div><div className={styles.secondary}>{value} bookings</div></div>
                    ))}
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Package Summary</h2>
                  <div className={styles.list}>
                    <div className={styles.listItem}><div className={styles.primary}>Active Package Bookings</div><div className={styles.secondary}>{reports.packageSummary.activePackageBookingCount}</div></div>
                    <div className={styles.listItem}><div className={styles.primary}>Current Reserved / Consumed</div><div className={styles.secondary}>{reports.packageSummary.currentReservedSessionsCount} / {reports.packageSummary.currentConsumedSessionsCount}</div></div>
                    <div className={styles.listItem}><div className={styles.primary}>Reserve / Consume / Release Actions</div><div className={styles.secondary}>{reports.packageSummary.reserveActionCount} / {reports.packageSummary.consumeActionCount} / {reports.packageSummary.releaseActionCount}</div></div>
                  </div>
                </article>
              </section>

              <section className={styles.tableCard}>
                <h2 className={styles.panelTitle}>Booking Detail Rows</h2>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Customer</th>
                        <th>Therapist</th>
                        <th>Service</th>
                        <th>Status</th>
                        <th>Payment</th>
                        <th>Amounts</th>
                        <th>Package</th>
                        <th>Notifications</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.detailRows.map((item) => (
                        <tr key={item.bookingId}>
                          <td>{formatDateTime(item.startsAt)}</td>
                          <td><div className={styles.primary}>{item.customerName}</div><div className={styles.secondary}>{item.customerPhone || item.publicReference || "-"}</div></td>
                          <td>{item.therapistName || "Unassigned"}</td>
                          <td><div className={styles.primary}>{item.serviceName}</div><div className={styles.secondary}>{item.branchName || "-"}</div></td>
                          <td>{item.status}</td>
                          <td><div className={styles.primary}>{item.paymentMode}</div><div className={styles.secondary}>{item.paymentStatus}</div></td>
                          <td><div className={styles.primary}>{formatMoney(item.finalAmount)}</div><div className={styles.secondary}>outstanding {formatMoney(item.outstandingAmount)}</div></td>
                          <td><div className={styles.primary}>reserved {item.packageReservedSessions}</div><div className={styles.secondary}>consumed {item.packageConsumedSessions}</div></td>
                          <td><div className={styles.primary}>queued {item.notificationQueuedCount}</div><div className={styles.secondary}>failed {item.notificationFailedCount}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </section>
      </section>
    </main>
  );
}
