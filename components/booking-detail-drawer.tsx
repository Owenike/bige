import { useEffect, useRef, useState } from "react";
import type {
  BookingDepositLiveSmokeEvidenceInput,
  BookingDepositLiveSmokeStepResults,
  BookingDetailResponse,
} from "../types/booking-management";
import { BookingStatusBadge } from "./booking-status-badge";
import styles from "./booking-management.module.css";
import { PaymentStatusBadge } from "./payment-status-badge";

type BookingDetailDrawerProps = {
  open: boolean;
  detail: BookingDetailResponse | null;
  loading: boolean;
  error: string | null;
  actionReason: string;
  actionLoading: boolean;
  actionMessage: string | null;
  depositActionLoading: boolean;
  depositActionMessage: string | null;
  depositActionTone: "success" | "error" | null;
  depositActionSummary: {
    title: string;
    detail: string;
    at: string;
    checkoutUrl: string | null;
  } | null;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onAction: (status: "booked" | "completed" | "cancelled" | "no_show") => void;
  onRegenerateDepositLink: () => void;
  liveSmokeSaveLoading: boolean;
  liveSmokeSaveMessage: string | null;
  liveSmokeSaveTone: "success" | "error" | null;
  onSaveLiveSmokeEvidence: (input: BookingDepositLiveSmokeEvidenceInput) => void;
  initialFocusSection: "default" | "evidence";
};

function defaultSmokeSteps(): BookingDepositLiveSmokeStepResults {
  return {
    paymentLinkObtained: false,
    callbackReceived: false,
    managerDetailVerified: false,
    bookingStateVerified: false,
    notificationsVerified: false,
    reportsVerified: false,
  };
}

function defaultLiveSmokeDraft(): BookingDepositLiveSmokeEvidenceInput {
  return {
    source: "manual",
    smokeResult: "partial",
    notes: "",
    compareResultSummary: "",
    rawEvidencePayload: "",
    smokeSteps: defaultSmokeSteps(),
  };
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function BookingDetailDrawer(props: BookingDetailDrawerProps) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [liveSmokeDraft, setLiveSmokeDraft] = useState<BookingDepositLiveSmokeEvidenceInput>(defaultLiveSmokeDraft());
  const liveSmokeSectionRef = useRef<HTMLElement | null>(null);
  const booking = props.detail?.booking || null;
  const depositPayment = props.detail?.depositPayment || null;
  const readiness = props.detail?.depositPaymentReadiness || null;
  const latestAttempt = props.detail?.depositPaymentAttempts?.[0] || null;
  const latestWebhook = props.detail?.depositPaymentWebhooks?.[0] || null;
  const latestLiveSmoke = props.detail?.depositLiveSmokeLatest || null;

  useEffect(() => {
    if (!props.open) return;
    setLiveSmokeDraft({
      source: latestLiveSmoke?.source || "manual",
      smokeResult: latestLiveSmoke?.smokeResult || "partial",
      notes: "",
      compareResultSummary: latestLiveSmoke?.compareResultSummary || "",
      rawEvidencePayload: "",
      smokeSteps: latestLiveSmoke?.smokeSteps || defaultSmokeSteps(),
    });
  }, [latestLiveSmoke, props.open]);

  useEffect(() => {
    if (!props.open || props.initialFocusSection !== "evidence") return;
    window.setTimeout(() => {
      liveSmokeSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
  }, [props.initialFocusSection, props.open, latestLiveSmoke?.id, booking?.id]);

  async function handleCopyLink() {
    if (!depositPayment?.checkoutUrl) return;
    try {
      await navigator.clipboard.writeText(depositPayment.checkoutUrl);
      setCopyMessage("Payment link copied.");
      window.setTimeout(() => setCopyMessage(null), 2200);
    } catch {
      setCopyMessage("Copy failed on this device.");
      window.setTimeout(() => setCopyMessage(null), 2200);
    }
  }

  function handleToggleSmokeStep(key: keyof BookingDepositLiveSmokeStepResults) {
    setLiveSmokeDraft((current) => ({
      ...current,
      smokeSteps: {
        ...current.smokeSteps,
        [key]: !current.smokeSteps[key],
      },
    }));
  }

  if (!props.open) return null;

  return (
    <>
      <button type="button" className={styles.drawerBackdrop} onClick={props.onClose} aria-label="Close booking detail" />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <div>
            <h2 className={styles.drawerTitle}>{booking?.customerName || "Booking detail"}</h2>
            <p className={styles.drawerSub}>{booking?.publicReference || booking?.serviceName || "Select a booking to inspect details."}</p>
          </div>
          <button type="button" className="fdPillBtn" onClick={props.onClose}>
            Close
          </button>
        </header>

        <div className={styles.drawerBody}>
          {props.loading ? <div className={styles.emptyState}>Loading booking detail...</div> : null}
          {props.error ? <div className={`${styles.message} ${styles.messageError}`}>{props.error}</div> : null}

          {booking ? (
            <>
              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Status & payment</h3>
                <div className={styles.badgeRow}>
                  <BookingStatusBadge status={booking.status} />
                  <PaymentStatusBadge
                    paymentStatus={booking.paymentStatus}
                    depositRequiredAmount={booking.depositRequiredAmount}
                    depositPaidAmount={booking.depositPaidAmount}
                    paymentMode={booking.paymentMode}
                    packageSessionsReserved={booking.packageSessionsReserved}
                    packageSessionsConsumed={booking.packageSessionsConsumed}
                  />
                </div>
                <div className={styles.detailGrid} style={{ marginTop: 14 }}>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Payment Mode</span>
                    <span className={styles.detailValue}>{booking.paymentMode === "package" ? "Package" : "Single"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Deposit Required</span>
                    <span className={styles.detailValue}>{formatMoney(booking.depositRequiredAmount)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Deposit Paid</span>
                    <span className={styles.detailValue}>{formatMoney(booking.depositPaidAmount)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Payment Method</span>
                    <span className={styles.detailValue}>{booking.paymentMethod || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Paid At</span>
                    <span className={styles.detailValue}>{formatDateTime(booking.depositPaidAt)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Final Amount</span>
                    <span className={styles.detailValue}>{formatMoney(booking.finalAmount)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Outstanding</span>
                    <span className={styles.detailValue}>{formatMoney(booking.outstandingAmount)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Payment Reference</span>
                    <span className={styles.detailValue}>{booking.paymentReference || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Payment Updated</span>
                    <span className={styles.detailValue}>{formatDateTime(booking.paymentUpdatedAt)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Provider</span>
                    <span className={styles.detailValue}>{depositPayment?.provider || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Provider Status</span>
                    <span className={styles.detailValue}>{depositPayment?.providerStatus || depositPayment?.paymentStatus || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Order ID</span>
                    <span className={styles.detailValue}>{depositPayment?.orderId || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Payment ID</span>
                    <span className={styles.detailValue}>{depositPayment?.paymentId || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Provider Reference</span>
                    <span className={styles.detailValue}>{depositPayment?.providerReference || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Webhook</span>
                    <span className={styles.detailValue}>{depositPayment?.lastWebhookEvent ? `${depositPayment.lastWebhookEvent} / ${depositPayment.lastWebhookStatus || "-"}` : "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Webhook Updated</span>
                    <span className={styles.detailValue}>{formatDateTime(depositPayment?.lastWebhookAt || null)}</span>
                  </div>
                  <div className={`${styles.detailField} ${styles.detailFieldWide}`}>
                    <span className={styles.detailLabel}>Checkout Link</span>
                    <span className={styles.detailValue}>
                      {depositPayment?.checkoutUrl ? (
                        <a href={depositPayment.checkoutUrl} target="_blank" rel="noreferrer">
                          Open payment link
                        </a>
                      ) : (
                        "-"
                      )}
                    </span>
                  </div>
                </div>
                <div className={styles.actionRow} style={{ marginTop: 14 }}>
                  <button type="button" className="fdPillBtn" disabled={!depositPayment?.checkoutUrl} onClick={() => void handleCopyLink()}>
                    Copy payment link
                  </button>
                  <button
                    type="button"
                    className="fdPillBtn fdPillBtnPrimary"
                    disabled={props.depositActionLoading || !readiness?.canGenerateLink}
                    onClick={props.onRegenerateDepositLink}
                  >
                    {props.depositActionLoading ? "Working..." : "Regenerate payment link"}
                  </button>
                </div>
                {copyMessage ? <div className={`${styles.message} ${styles.messageSuccess}`} style={{ marginTop: 12 }}>{copyMessage}</div> : null}
                {props.depositActionMessage ? (
                  <div
                    className={`${styles.message} ${
                      props.depositActionTone === "error" ? styles.messageError : styles.messageSuccess
                    }`}
                    style={{ marginTop: 12 }}
                  >
                    {props.depositActionMessage}
                  </div>
                ) : null}
                {props.depositActionSummary ? (
                  <article className={styles.logItem} style={{ marginTop: 12 }}>
                    <div className={styles.badgeRow}>
                      <span className={styles.badge}>latest action</span>
                      <span className={styles.depositText}>{props.depositActionSummary.title}</span>
                    </div>
                    <div className={styles.secondaryText}>{props.depositActionSummary.detail}</div>
                    {props.depositActionSummary.checkoutUrl ? (
                      <div className={styles.secondaryText}>
                        <a href={props.depositActionSummary.checkoutUrl} target="_blank" rel="noreferrer">
                          Open latest payment link
                        </a>
                      </div>
                    ) : null}
                    <div className={styles.logMeta}>
                      <span>manager action</span>
                      <span>{formatDateTime(props.depositActionSummary.at)}</span>
                    </div>
                  </article>
                ) : null}
              </section>

              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Operation evidence</h3>
                <div className={styles.logList}>
                  {props.depositActionSummary ? (
                    <article className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>manager op</span>
                        <span className={styles.depositText}>{props.depositActionSummary.title}</span>
                      </div>
                      <div className={styles.secondaryText}>{props.depositActionSummary.detail}</div>
                      <div className={styles.logMeta}>
                        <span>{props.depositActionTone || "success"}</span>
                        <span>{formatDateTime(props.depositActionSummary.at)}</span>
                      </div>
                    </article>
                  ) : null}
                  {latestWebhook ? (
                    <article className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>callback</span>
                        <span className={styles.depositText}>
                          {latestWebhook.eventType} / {latestWebhook.status}
                        </span>
                      </div>
                      <div className={styles.secondaryText}>Payment {latestWebhook.paymentId || "-"}</div>
                      <div className={styles.logMeta}>
                        <span>{latestWebhook.signaturePresent ? "signature verified path" : "signature missing"}</span>
                        <span>{formatDateTime(latestWebhook.processedAt || latestWebhook.receivedAt)}</span>
                      </div>
                    </article>
                  ) : null}
                  {latestAttempt ? (
                    <article className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>active payment</span>
                        <span className={styles.depositText}>{latestAttempt.status}</span>
                      </div>
                      <div className={styles.secondaryText}>Payment {latestAttempt.id}</div>
                      <div className={styles.secondaryText}>
                        {latestAttempt.isCurrentPending
                          ? "Current reusable pending payment"
                          : latestAttempt.isStalePending
                            ? "Stale pending payment"
                            : latestAttempt.isPaid
                              ? "Paid payment evidence"
                              : "Historical closed payment"}
                      </div>
                      <div className={styles.logMeta}>
                        <span>{latestAttempt.providerReference || latestAttempt.orderId}</span>
                        <span>{formatDateTime(latestAttempt.updatedAt || latestAttempt.createdAt)}</span>
                      </div>
                    </article>
                  ) : null}
                  {!props.depositActionSummary && !latestWebhook && !latestAttempt ? (
                    <div className={styles.emptyState}>No payment operation evidence recorded for this booking yet.</div>
                  ) : null}
                </div>
                <div className={styles.logList} style={{ marginTop: 14 }}>
                  <article className={styles.logItem}>
                    <div className={styles.badgeRow}>
                      <span className={styles.badge}>live smoke checkpoints</span>
                    </div>
                    <div className={styles.secondaryText}>
                      Verify payment reference, deposit paid amount, latest webhook status/time, latest evidence summary, and the latest regenerate summary after one real callback.
                    </div>
                    <div className={styles.secondaryText}>
                      Then confirm deposit reminder is no longer pending and reports read the updated booking payment mirror.
                    </div>
                  </article>
                </div>
              </section>

              <section ref={liveSmokeSectionRef} className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Live smoke evidence</h3>
                <div className={styles.logList}>
                  {latestLiveSmoke ? (
                    <article className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>latest evidence</span>
                        <span className={styles.depositText}>
                          {latestLiveSmoke.smokeResult} / {latestLiveSmoke.source}
                        </span>
                      </div>
                      <div className={styles.secondaryText}>
                        {latestLiveSmoke.performedByName || latestLiveSmoke.performedByUserId || "manager"} at{" "}
                        {formatDateTime(latestLiveSmoke.performedAt)}
                      </div>
                      <div className={styles.secondaryText}>
                        Provider {latestLiveSmoke.provider} / Order {latestLiveSmoke.orderId || "-"} / Payment {latestLiveSmoke.paymentId || "-"}
                      </div>
                      <div className={styles.secondaryText}>
                        Reference {latestLiveSmoke.paymentReference || "-"} / Provider ref {latestLiveSmoke.providerReference || "-"}
                      </div>
                      <div className={styles.secondaryText}>
                        Callback {latestLiveSmoke.callbackStatus || "-"} / Verification {latestLiveSmoke.callbackVerificationResult || "-"}
                      </div>
                      <div className={styles.secondaryText}>
                        Deposit snapshot {formatMoney(latestLiveSmoke.depositPaidAmount)} / {formatMoney(latestLiveSmoke.depositRequiredAmount)}
                      </div>
                      <div className={styles.secondaryText}>{latestLiveSmoke.checklistSummary}</div>
                      {latestLiveSmoke.compareResultSummary ? (
                        <div className={styles.secondaryText}>Compare: {latestLiveSmoke.compareResultSummary}</div>
                      ) : null}
                      {latestLiveSmoke.notes ? <div className={styles.secondaryText}>Notes: {latestLiveSmoke.notes}</div> : null}
                      <div className={styles.logMeta}>
                        <span>{latestLiveSmoke.bookingPaymentStatusSnapshot || "-"}</span>
                        <span>{formatDateTime(latestLiveSmoke.webhookReceivedAt)}</span>
                      </div>
                    </article>
                  ) : (
                    <div className={styles.emptyState}>No live smoke evidence has been persisted for this booking yet.</div>
                  )}
                </div>
                {props.liveSmokeSaveMessage ? (
                  <div
                    className={`${styles.message} ${
                      props.liveSmokeSaveTone === "error" ? styles.messageError : styles.messageSuccess
                    }`}
                    style={{ marginTop: 12 }}
                  >
                    {props.liveSmokeSaveMessage}
                  </div>
                ) : null}
                <div className={styles.detailGrid} style={{ marginTop: 14 }}>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Evidence Source</span>
                    <select
                      value={liveSmokeDraft.source}
                      onChange={(event) =>
                        setLiveSmokeDraft((current) => ({
                          ...current,
                          source: event.target.value as BookingDepositLiveSmokeEvidenceInput["source"],
                        }))
                      }
                      style={{ borderRadius: 14, border: "1px solid rgba(17,17,17,0.1)", padding: "10px 12px", background: "rgba(255,255,255,0.92)" }}
                    >
                      <option value="manual">manual</option>
                      <option value="replay">replay</option>
                      <option value="live">live</option>
                    </select>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Smoke Result</span>
                    <select
                      value={liveSmokeDraft.smokeResult}
                      onChange={(event) =>
                        setLiveSmokeDraft((current) => ({
                          ...current,
                          smokeResult: event.target.value as BookingDepositLiveSmokeEvidenceInput["smokeResult"],
                        }))
                      }
                      style={{ borderRadius: 14, border: "1px solid rgba(17,17,17,0.1)", padding: "10px 12px", background: "rgba(255,255,255,0.92)" }}
                    >
                      <option value="pass">pass</option>
                      <option value="partial">partial</option>
                      <option value="fail">fail</option>
                    </select>
                  </div>
                </div>
                <div className={styles.actionRow} style={{ marginTop: 12 }}>
                  {(
                    [
                      ["paymentLinkObtained", "payment link"],
                      ["callbackReceived", "callback"],
                      ["managerDetailVerified", "manager detail"],
                      ["bookingStateVerified", "booking mirror"],
                      ["notificationsVerified", "notifications"],
                      ["reportsVerified", "reports"],
                    ] as Array<[keyof BookingDepositLiveSmokeStepResults, string]>
                  ).map(([key, label]) => (
                    <label key={key} className="fdPillBtn" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={liveSmokeDraft.smokeSteps[key]}
                        onChange={() => handleToggleSmokeStep(key)}
                        style={{ marginRight: 8 }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <textarea
                  className={styles.actionTextarea}
                  value={liveSmokeDraft.compareResultSummary}
                  onChange={(event) =>
                    setLiveSmokeDraft((current) => ({
                      ...current,
                      compareResultSummary: event.target.value,
                    }))
                  }
                  placeholder="Compare result summary, for example: live-success maps to paid / paid / deposit_paid."
                  style={{ marginTop: 12, minHeight: 72 }}
                />
                <textarea
                  className={styles.actionTextarea}
                  value={liveSmokeDraft.notes}
                  onChange={(event) =>
                    setLiveSmokeDraft((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Notes, operator observations, or retry guidance."
                  style={{ marginTop: 12, minHeight: 72 }}
                />
                <textarea
                  className={styles.actionTextarea}
                  value={liveSmokeDraft.rawEvidencePayload}
                  onChange={(event) =>
                    setLiveSmokeDraft((current) => ({
                      ...current,
                      rawEvidencePayload: event.target.value,
                    }))
                  }
                  placeholder="Optional raw callback payload or redacted evidence snapshot."
                  style={{ marginTop: 12, minHeight: 96 }}
                />
                <div className={styles.actionRow} style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="fdPillBtn fdPillBtnPrimary"
                    disabled={props.liveSmokeSaveLoading}
                    onClick={() => props.onSaveLiveSmokeEvidence(liveSmokeDraft)}
                  >
                    {props.liveSmokeSaveLoading ? "Saving..." : "Save live smoke evidence"}
                  </button>
                </div>
                <div className={styles.logList} style={{ marginTop: 14 }}>
                  {props.detail?.depositLiveSmokeHistory.map((item) => (
                    <article key={item.id} className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>{item.smokeResult}</span>
                        <span className={styles.depositText}>{item.source}</span>
                      </div>
                      <div className={styles.secondaryText}>
                        {item.performedByName || item.performedByUserId || "manager"} at {formatDateTime(item.performedAt)}
                      </div>
                      <div className={styles.secondaryText}>{item.checklistSummary}</div>
                      <div className={styles.secondaryText}>
                        Order {item.orderId || "-"} / Payment {item.paymentId || "-"} / Callback {item.callbackStatus || "-"}
                      </div>
                      <div className={styles.logMeta}>
                        <span>{item.providerReference || item.paymentReference || "-"}</span>
                        <span>{formatDateTime(item.webhookReceivedAt || item.performedAt)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Deposit readiness</h3>
                <div className={styles.detailGrid}>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Ready</span>
                    <span className={styles.detailValue}>{readiness?.ready ? "Ready" : "Blocked"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Link Strategy</span>
                    <span className={styles.detailValue}>{readiness?.mode || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Checkout URL</span>
                    <span className={styles.detailValue}>{readiness?.config.checkoutUrlConfigured ? "Configured" : "Missing"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Webhook URL</span>
                    <span className={styles.detailValue}>{readiness?.config.webhookUrlConfigured ? "Configured" : "Missing"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Webhook Secret</span>
                    <span className={styles.detailValue}>{readiness?.config.webhookSecretConfigured ? "Configured" : "Missing"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Provider Route</span>
                    <span className={styles.detailValue}>{readiness?.config.providerRouteExists ? "Available" : "Missing"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Deposit Capability</span>
                    <span className={styles.detailValue}>{readiness?.runtime.depositsEnabled ? "Enabled" : "Disabled"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Service Requires Deposit</span>
                    <span className={styles.detailValue}>{readiness?.runtime.serviceRequiresDeposit ? "Yes" : "No"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Booking Eligible</span>
                    <span className={styles.detailValue}>{readiness?.runtime.bookingEligible ? "Yes" : "No"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Manager Link Access</span>
                    <span className={styles.detailValue}>{readiness?.runtime.managerCanAccessPaymentEntry ? "Allowed" : "Blocked"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Reusable Pending</span>
                    <span className={styles.detailValue}>{readiness?.runtime.reusablePendingPaymentId || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Stale Pending</span>
                    <span className={styles.detailValue}>{readiness?.runtime.stalePendingPaymentId || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Paid Payment</span>
                    <span className={styles.detailValue}>{readiness?.runtime.paidPaymentId || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Last Webhook</span>
                    <span className={styles.detailValue}>{readiness?.runtime.lastWebhookStatus || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Last Webhook At</span>
                    <span className={styles.detailValue}>{formatDateTime(readiness?.runtime.lastWebhookAt || null)}</span>
                  </div>
                </div>
                <div className={styles.logList} style={{ marginTop: 14 }}>
                  {readiness?.blockers?.length ? readiness.blockers.map((item) => (
                    <article key={item} className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>blocker</span>
                      </div>
                      <div className={styles.secondaryText}>{item}</div>
                    </article>
                  )) : null}
                  {readiness?.warnings?.length ? readiness.warnings.map((item) => (
                    <article key={item} className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>warning</span>
                      </div>
                      <div className={styles.secondaryText}>{item}</div>
                    </article>
                  )) : null}
                  {!readiness?.blockers?.length && !readiness?.warnings?.length ? <div className={styles.emptyState}>Deposit payment looks ready for this booking.</div> : null}
                </div>
              </section>

              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Deposit order & attempts</h3>
                <div className={styles.logList}>
                  {props.detail?.depositOrders.map((item) => (
                    <article key={item.id} className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>order</span>
                        <span className={styles.depositText}>{item.status}</span>
                      </div>
                      <div className={styles.secondaryText}>#{item.id}</div>
                      <div className={styles.secondaryText}>Channel {item.channel || "-"}</div>
                      <div className={styles.secondaryText}>Amount {formatMoney(item.amount)}</div>
                      <div className={styles.logMeta}>
                        <span>{item.isCurrent ? "current" : "historical"}</span>
                        <span>{formatDateTime(item.updatedAt || item.createdAt)}</span>
                      </div>
                    </article>
                  ))}
                  {props.detail?.depositPaymentAttempts.map((item) => (
                    <article key={item.id} className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>payment</span>
                        <span className={styles.depositText}>{item.status}</span>
                      </div>
                      <div className={styles.secondaryText}>Payment {item.id}</div>
                      <div className={styles.secondaryText}>Order {item.orderId}</div>
                      <div className={styles.secondaryText}>Provider Ref {item.providerReference || "-"}</div>
                      <div className={styles.secondaryText}>
                        {item.isCurrentPending ? "Current pending link" : item.isStalePending ? "Stale pending link" : item.isPaid ? "Paid attempt" : "Closed attempt"}
                      </div>
                      <div className={styles.logMeta}>
                        <span>{item.method || "newebpay"}</span>
                        <span>{formatDateTime(item.paidAt || item.updatedAt || item.createdAt)}</span>
                      </div>
                    </article>
                  ))}
                  {!props.detail?.depositOrders.length && !props.detail?.depositPaymentAttempts.length ? <div className={styles.emptyState}>No deposit payment order or attempt exists yet.</div> : null}
                </div>
              </section>

              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Webhook audit</h3>
                <div className={styles.logList}>
                  {props.detail?.depositPaymentWebhooks.map((item, index) => (
                    <article key={`${item.paymentId || "na"}-${item.eventType}-${index}`} className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>{item.eventType}</span>
                        <span className={styles.depositText}>{item.status}</span>
                      </div>
                      <div className={styles.secondaryText}>Payment {item.paymentId || "-"}</div>
                      {item.errorMessage ? <div className={styles.secondaryText}>{item.errorMessage}</div> : null}
                      <div className={styles.logMeta}>
                        <span>{item.signaturePresent ? "signature" : "no signature"}</span>
                        <span>{formatDateTime(item.processedAt || item.receivedAt)}</span>
                      </div>
                    </article>
                  ))}
                  {!props.detail?.depositPaymentWebhooks.length ? <div className={styles.emptyState}>No webhook events recorded for this booking deposit yet.</div> : null}
                </div>
              </section>

              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Package coverage</h3>
                <div className={styles.detailGrid}>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Package</span>
                    <span className={styles.detailValue}>{booking.packageName || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Entry Pass</span>
                    <span className={styles.detailValue}>{booking.entryPassId || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Reserved Sessions</span>
                    <span className={styles.detailValue}>{booking.packageSessionsReserved || 0}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Consumed Sessions</span>
                    <span className={styles.detailValue}>{booking.packageSessionsConsumed || 0}</span>
                  </div>
                </div>
                <div className={styles.logList} style={{ marginTop: 14 }}>
                  {props.detail?.packageLogs.map((item) => (
                    <article key={item.id} className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>{item.action}</span>
                        {item.packageName ? <span className={styles.depositText}>{item.packageName}</span> : null}
                      </div>
                      <div className={styles.secondaryText}>
                        {item.sessionsDelta > 0 ? `+${item.sessionsDelta}` : item.sessionsDelta} session{Math.abs(item.sessionsDelta) === 1 ? "" : "s"}
                      </div>
                      <div className={styles.secondaryText}>{item.reason || "package_transition"}</div>
                      <div className={styles.logMeta}>
                        <span>{item.createdBy || "system"}</span>
                        <span>{formatDateTime(item.createdAt)}</span>
                      </div>
                    </article>
                  ))}
                  {!props.detail?.packageLogs.length ? <div className={styles.emptyState}>No package activity on this booking yet.</div> : null}
                </div>
              </section>

              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Booking profile</h3>
                <div className={styles.detailGrid}>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Customer</span>
                    <span className={styles.detailValue}>{booking.customerName}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Phone</span>
                    <span className={styles.detailValue}>{booking.customerPhone || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Branch</span>
                    <span className={styles.detailValue}>{booking.branchName || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Therapist</span>
                    <span className={styles.detailValue}>{booking.therapistName || "Unassigned"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Service</span>
                    <span className={styles.detailValue}>{booking.serviceName}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Price</span>
                    <span className={styles.detailValue}>{formatMoney(booking.priceAmount)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Starts</span>
                    <span className={styles.detailValue}>{formatDateTime(booking.startsAt)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Ends</span>
                    <span className={styles.detailValue}>{formatDateTime(booking.endsAt)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Duration</span>
                    <span className={styles.detailValue}>{booking.durationMinutes ? `${booking.durationMinutes} min` : "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Source</span>
                    <span className={styles.detailValue}>{booking.source || "staff"}</span>
                  </div>
                  <div className={`${styles.detailField} ${styles.detailFieldWide}`}>
                    <span className={styles.detailLabel}>Customer Note</span>
                    <span className={styles.detailValue}>{booking.customerNote || "-"}</span>
                  </div>
                  <div className={`${styles.detailField} ${styles.detailFieldWide}`}>
                    <span className={styles.detailLabel}>Internal Note</span>
                    <span className={styles.detailValue}>{booking.internalNote || "-"}</span>
                  </div>
                </div>
              </section>

              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Audit timeline</h3>
                <div className={styles.detailGrid}>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Created</span>
                    <span className={styles.detailValue}>{formatDateTime(booking.createdAt)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Updated</span>
                    <span className={styles.detailValue}>{formatDateTime(booking.updatedAt)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Confirmed</span>
                    <span className={styles.detailValue}>{formatDateTime(booking.confirmedAt)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Completed</span>
                    <span className={styles.detailValue}>{formatDateTime(booking.completedAt)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Cancelled</span>
                    <span className={styles.detailValue}>{formatDateTime(booking.cancelledAt)}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Status Reason</span>
                    <span className={styles.detailValue}>{booking.statusReason || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Rescheduled From</span>
                    <span className={styles.detailValue}>{booking.rescheduledFromReference || booking.rescheduledFromBookingId || "-"}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Rescheduled To</span>
                    <span className={styles.detailValue}>{booking.rescheduledToReference || booking.rescheduledToBookingId || "-"}</span>
                  </div>
                </div>
              </section>

              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Notification summary</h3>
                <div className={styles.detailGrid}>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Queued</span>
                    <span className={styles.detailValue}>{booking.notificationQueuedCount || 0}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Failed</span>
                    <span className={styles.detailValue}>{booking.notificationFailedCount || 0}</span>
                  </div>
                  <div className={styles.detailField}>
                    <span className={styles.detailLabel}>Deposit Reminder</span>
                    <span className={styles.detailValue}>{booking.hasDepositReminderPending ? "Queued" : "Not pending"}</span>
                  </div>
                </div>
                <div className={styles.logList} style={{ marginTop: 14 }}>
                  {props.detail?.notifications.map((item) => (
                    <article key={item.id} className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>{item.eventType}</span>
                        <span className={styles.badge}>{item.channel}</span>
                        <span className={styles.depositText}>{item.status}</span>
                      </div>
                      <div className={styles.secondaryText}>
                        {item.scheduledFor ? `Scheduled ${formatDateTime(item.scheduledFor)}` : "Immediate delivery"}
                      </div>
                      {item.sentAt ? <div className={styles.secondaryText}>Sent {formatDateTime(item.sentAt)}</div> : null}
                      {item.cancelledAt ? <div className={styles.secondaryText}>Cancelled {formatDateTime(item.cancelledAt)}</div> : null}
                      {item.skippedReason ? <div className={styles.secondaryText}>{item.skippedReason}</div> : null}
                      {item.failureReason ? <div className={styles.secondaryText}>{item.failureReason}</div> : null}
                      <div className={styles.logMeta}>
                        <span>{item.recipientName || item.recipientEmail || item.recipientPhone || "member"}</span>
                        <span>{item.deliveryMode || "simulated"}</span>
                      </div>
                    </article>
                  ))}
                  {!props.detail?.notifications.length ? <div className={styles.emptyState}>No booking notifications queued yet.</div> : null}
                </div>
              </section>

              <section className={styles.detailCard}>
                <h3 className={styles.detailTitle}>Status log</h3>
                <div className={styles.logList}>
                  {props.detail?.logs.map((item) => (
                    <article key={item.id} className={styles.logItem}>
                      <div className={styles.badgeRow}>
                        <BookingStatusBadge status={item.toStatus} />
                        {item.fromStatus ? <span className={styles.depositText}>from {item.fromStatus}</span> : null}
                      </div>
                      <div className={styles.secondaryText}>{item.reason || "status_changed"}</div>
                      {item.note ? <div className={styles.secondaryText}>{item.note}</div> : null}
                      <div className={styles.logMeta}>
                        <span>{item.actorName || item.actorId || "system"}</span>
                        <span>{formatDateTime(item.createdAt)}</span>
                      </div>
                    </article>
                  ))}
                  {!props.detail?.logs.length ? <div className={styles.emptyState}>No status log entries available yet.</div> : null}
                </div>
              </section>
            </>
          ) : null}
        </div>

        <footer className={styles.drawerFooter}>
          {props.actionMessage ? <div className={`${styles.message} ${styles.messageSuccess}`}>{props.actionMessage}</div> : null}
          <textarea
            className={styles.actionTextarea}
            value={props.actionReason}
            onChange={(event) => props.onReasonChange(event.target.value)}
            placeholder="Reason for status change is required for audit trail."
          />
          <div className={styles.actionRow}>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={props.actionLoading || !booking} onClick={() => props.onAction("booked")}>
              {props.actionLoading ? "Working..." : "Confirm booking"}
            </button>
            <button type="button" className="fdPillBtn" disabled={props.actionLoading || !booking} onClick={() => props.onAction("completed")}>
              Complete
            </button>
            <button type="button" className="fdPillBtn" disabled={props.actionLoading || !booking} onClick={() => props.onAction("cancelled")}>
              Cancel
            </button>
            <button type="button" className="fdPillBtn" disabled={props.actionLoading || !booking} onClick={() => props.onAction("no_show")}>
              Mark no show
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
