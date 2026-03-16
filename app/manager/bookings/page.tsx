"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookingDetailDrawer } from "../../../components/booking-detail-drawer";
import { BookingListTable } from "../../../components/booking-list-table";
import styles from "../../../components/booking-management.module.css";
import { DashboardFilterBar, type BookingFilterState } from "../../../components/dashboard-filter-bar";
import type {
  BookingDepositLiveSmokeEvidenceInput,
  BookingDetailResponse,
  BookingOverviewResponse,
} from "../../../types/booking-management";

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string } | string;
  message?: string;
};

type DepositActionFeedback = {
  title: string;
  detail: string;
  at: string;
  checkoutUrl: string | null;
};

type BookingDetailFocus = "default" | "evidence";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as ApiEnvelope<unknown>;
  if (typeof body.error === "string" && body.error) return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") return body.error.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

async function requestJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | T | null;
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, "Request failed"));
  }
  if (payload && typeof payload === "object" && "data" in payload && payload.data) {
    return payload.data as T;
  }
  return payload as T;
}

function filterFromParams(searchParams: URLSearchParams): BookingFilterState {
  return {
    date: searchParams.get("date") || todayDate(),
    branchId: searchParams.get("branchId") || "",
    therapistId: searchParams.get("coachId") || "",
    status: searchParams.get("status") || "",
    q: searchParams.get("q") || "",
    deposit: searchParams.get("deposit") || "",
    liveSmoke: searchParams.get("liveSmoke") || "",
    noShow: searchParams.get("noShow") === "1",
  };
}

function buildQueryString(value: BookingFilterState) {
  const params = new URLSearchParams();
  if (value.date) params.set("date", value.date);
  if (value.branchId) params.set("branchId", value.branchId);
  if (value.therapistId) params.set("coachId", value.therapistId);
  if (value.status) params.set("status", value.status);
  if (value.q.trim()) params.set("q", value.q.trim());
  if (value.deposit) params.set("deposit", value.deposit);
  if (value.liveSmoke) params.set("liveSmoke", value.liveSmoke);
  if (value.noShow) params.set("noShow", "1");
  return params.toString();
}

export default function ManagerBookingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlState = useMemo(() => filterFromParams(searchParams), [searchParams]);

  const [draft, setDraft] = useState<BookingFilterState>(urlState);
  const [overview, setOverview] = useState<BookingOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BookingDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [depositActionLoading, setDepositActionLoading] = useState(false);
  const [depositActionMessage, setDepositActionMessage] = useState<string | null>(null);
  const [depositActionTone, setDepositActionTone] = useState<"success" | "error" | null>(null);
  const [depositActionSummary, setDepositActionSummary] = useState<DepositActionFeedback | null>(null);
  const [liveSmokeSaveLoading, setLiveSmokeSaveLoading] = useState(false);
  const [liveSmokeSaveMessage, setLiveSmokeSaveMessage] = useState<string | null>(null);
  const [liveSmokeSaveTone, setLiveSmokeSaveTone] = useState<"success" | "error" | null>(null);
  const [detailFocus, setDetailFocus] = useState<BookingDetailFocus>("default");

  useEffect(() => {
    setDraft(urlState);
  }, [urlState]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    requestJson<BookingOverviewResponse>(`/api/bookings?${buildQueryString(urlState)}`)
      .then((payload) => {
        if (!active) return;
        setOverview(payload);
        if (selectedId && !payload.items.some((item) => item.id === selectedId)) {
          setSelectedId(null);
          setDetail(null);
        }
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : "Failed to load bookings");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId, urlState]);

  async function loadDetail(id: string, focus: BookingDetailFocus = "default") {
    setSelectedId(id);
    setDetailFocus(focus);
    setDetailLoading(true);
    setDetailError(null);
    setActionMessage(null);
    setDepositActionMessage(null);
    setDepositActionTone(null);
    setDepositActionSummary(null);
    setLiveSmokeSaveMessage(null);
    setLiveSmokeSaveTone(null);
    try {
      const payload = await requestJson<BookingDetailResponse>(`/api/bookings/${id}`);
      setDetail(payload);
      setActionReason(payload.booking.statusReason || "");
    } catch (nextError) {
      setDetailError(nextError instanceof Error ? nextError.message : "Failed to load booking detail");
    } finally {
      setDetailLoading(false);
    }
  }

  function applyFilters() {
    const query = buildQueryString(draft);
    router.replace(query ? `/manager/bookings?${query}` : "/manager/bookings");
  }

  function resetFilters() {
    const next = {
      date: todayDate(),
      branchId: "",
      therapistId: "",
      status: "",
      q: "",
      deposit: "",
      liveSmoke: "",
      noShow: false,
    } satisfies BookingFilterState;
    setDraft(next);
    const query = buildQueryString(next);
    router.replace(`/manager/bookings?${query}`);
  }

  async function handleAction(status: "booked" | "completed" | "cancelled" | "no_show") {
    if (!selectedId || !detail?.booking) return;
    if (!actionReason.trim()) {
      setActionMessage(null);
      setDetailError("A reason is required before changing booking status.");
      return;
    }

    const labels: Record<typeof status, string> = {
      booked: "confirm this booking",
      completed: "mark this booking as completed",
      cancelled: "cancel this booking",
      no_show: "mark this booking as no show",
    };
    if (!window.confirm(`Confirm ${labels[status]}?`)) return;

    setActionLoading(true);
    setDetailError(null);
    setActionMessage(null);
    try {
      await requestJson(`/api/bookings/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          reason: actionReason.trim(),
        }),
      });
      setActionMessage("Booking status updated.");
      const query = buildQueryString(urlState);
      const [nextOverview, nextDetail] = await Promise.all([
        requestJson<BookingOverviewResponse>(`/api/bookings?${query}`),
        requestJson<BookingDetailResponse>(`/api/bookings/${selectedId}`),
      ]);
      setOverview(nextOverview);
      setDetail(nextDetail);
    } catch (nextError) {
      setDetailError(nextError instanceof Error ? nextError.message : "Booking update failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRegenerateDepositLink() {
    if (!selectedId || !detail?.booking) return;
    setDepositActionLoading(true);
    setDepositActionMessage(null);
    setDepositActionTone(null);
    setDetailError(null);
    try {
      const result = await requestJson<{
        depositPayment: { checkoutUrl: string | null };
        paymentCreated: boolean;
        reusedPendingPayment: boolean;
        voidedStalePendingPayment?: boolean;
        alreadyPaid: boolean;
      }>("/api/payments/newebpay/initiate", {
        method: "POST",
        body: JSON.stringify({ bookingId: selectedId }),
      });
      const nextDetail = await requestJson<BookingDetailResponse>(`/api/bookings/${selectedId}`);
      setDetail(nextDetail);
      const summary = result.alreadyPaid
        ? {
            title: "blocked: already paid",
            detail: "Deposit already paid. Existing payment reference was kept.",
          }
        : result.reusedPendingPayment
          ? {
              title: "reused existing pending payment",
              detail: "A still-valid pending payment was reused; the checkout link stayed active.",
            }
          : result.voidedStalePendingPayment
            ? {
                title: "regenerated new pending payment",
                detail: "The stale pending payment was voided and a fresh checkout link was created.",
              }
            : result.paymentCreated
              ? {
                  title: "generated fresh pending payment",
                  detail: "A new pending payment and checkout link were created for this booking.",
                }
              : {
                  title: "payment link refreshed",
                  detail: "The booking deposit link was refreshed.",
                };
      setDepositActionTone("success");
      setDepositActionMessage(summary.detail);
      setDepositActionSummary({
        ...summary,
        at: new Date().toISOString(),
        checkoutUrl: result.depositPayment.checkoutUrl,
      });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Failed to regenerate payment link";
      setDepositActionTone("error");
      setDepositActionMessage(message);
      setDepositActionSummary({
        title:
          message.includes("already paid")
            ? "blocked: already paid"
            : message.includes("not eligible")
              ? "blocked: booking not eligible"
              : "regenerate failed",
        detail: message,
        at: new Date().toISOString(),
        checkoutUrl: detail?.depositPayment?.checkoutUrl || null,
      });
      setDetailError(message);
    } finally {
      setDepositActionLoading(false);
    }
  }

  async function handleSaveLiveSmokeEvidence(input: BookingDepositLiveSmokeEvidenceInput) {
    if (!selectedId) return;
    setLiveSmokeSaveLoading(true);
    setLiveSmokeSaveMessage(null);
    setLiveSmokeSaveTone(null);
    setDetailError(null);
    try {
      await requestJson(`/api/bookings/${selectedId}/deposit-live-smoke`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      const nextDetail = await requestJson<BookingDetailResponse>(`/api/bookings/${selectedId}`);
      setDetail(nextDetail);
      setLiveSmokeSaveTone("success");
      setLiveSmokeSaveMessage("Live smoke evidence saved.");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Failed to save live smoke evidence";
      setLiveSmokeSaveTone("error");
      setLiveSmokeSaveMessage(message);
      setDetailError(message);
    } finally {
      setLiveSmokeSaveLoading(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className={styles.page}>
          <article className={`fdGlassPanel ${styles.heroCard}`}>
            <div className={styles.heroEyebrow}>Booking operations</div>
            <h1 className={styles.heroTitle}>Manager Booking Overview</h1>
            <p className={styles.heroBody}>
              A premium booking management surface for store teams: scan the day quickly, inspect deposit and payment state, and update appointment status without touching the public booking flow or scheduling engine.
            </p>
            <div className="actions" style={{ marginTop: 14 }}>
              <a className="fdPillBtn fdPillBtnPrimary" href="/manager">
                Back to manager hub
              </a>
              <a className="fdPillBtn" href="/frontdesk/bookings">
                Open scheduler workspace
              </a>
            </div>
          </article>

          <section className={styles.summaryGrid}>
            <article className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Visible bookings</div>
              <div className={styles.summaryValue}>{overview?.summary.total ?? 0}</div>
              <div className={styles.summaryHint}>Current filter and scope</div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Pending / Confirmed</div>
              <div className={styles.summaryValue}>{(overview?.summary.pending ?? 0) + (overview?.summary.confirmed ?? 0)}</div>
              <div className={styles.summaryHint}>
                {overview?.summary.pending ?? 0} pending, {overview?.summary.confirmed ?? 0} confirmed
              </div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Completed / Cancelled</div>
              <div className={styles.summaryValue}>{(overview?.summary.completed ?? 0) + (overview?.summary.cancelled ?? 0)}</div>
              <div className={styles.summaryHint}>
                {overview?.summary.completed ?? 0} completed, {overview?.summary.cancelled ?? 0} cancelled
              </div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryLabel}>No Show</div>
              <div className={styles.summaryValue}>{overview?.summary.noShow ?? 0}</div>
              <div className={styles.summaryHint}>Follow-up sensitive bookings</div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Deposit Outstanding</div>
              <div className={styles.summaryValue}>
                {new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(overview?.summary.depositOutstanding ?? 0)}
              </div>
              <div className={styles.summaryHint}>Visible bookings only</div>
            </article>
            <article className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Package Reserved</div>
              <div className={styles.summaryValue}>{overview?.summary.packageReserved ?? 0}</div>
              <div className={styles.summaryHint}>Reserved sessions in current scope</div>
            </article>
          </section>

          <DashboardFilterBar
            value={draft}
            filters={overview?.filters || null}
            loading={loading}
            onChange={setDraft}
            onApply={applyFilters}
            onReset={resetFilters}
          />

          {error ? <div className={`${styles.message} ${styles.messageError}`}>{error}</div> : null}

          <div className={styles.layout}>
            <BookingListTable
              items={overview?.items || []}
              selectedId={selectedId}
              onSelect={(id, focus) => void loadDetail(id, focus || "default")}
            />
          </div>
        </section>
      </section>

      <BookingDetailDrawer
        open={Boolean(selectedId)}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        actionReason={actionReason}
        actionLoading={actionLoading}
        actionMessage={actionMessage}
        depositActionLoading={depositActionLoading}
        depositActionMessage={depositActionMessage}
        onReasonChange={setActionReason}
        onClose={() => {
          setSelectedId(null);
          setDetail(null);
          setDetailError(null);
          setActionMessage(null);
          setDepositActionMessage(null);
          setDepositActionTone(null);
          setDepositActionSummary(null);
          setLiveSmokeSaveMessage(null);
          setLiveSmokeSaveTone(null);
          setDetailFocus("default");
        }}
        onAction={(status) => void handleAction(status)}
        depositActionTone={depositActionTone}
        depositActionSummary={depositActionSummary}
        onRegenerateDepositLink={() => void handleRegenerateDepositLink()}
        liveSmokeSaveLoading={liveSmokeSaveLoading}
        liveSmokeSaveMessage={liveSmokeSaveMessage}
        liveSmokeSaveTone={liveSmokeSaveTone}
        onSaveLiveSmokeEvidence={(input) => void handleSaveLiveSmokeEvidence(input)}
        initialFocusSection={detailFocus}
      />
    </main>
  );
}
