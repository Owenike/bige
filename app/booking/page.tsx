"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookingHeader } from "../../components/booking-header";
import { BookingHero } from "../../components/booking-hero";
import { BookingNoticeCard } from "../../components/booking-notice-card";
import { BookingServiceCard } from "../../components/booking-service-card";
import { BookingStepCard } from "../../components/booking-step-card";
import { BookingStickyBar } from "../../components/booking-sticky-bar";
import { BookingSummaryCard } from "../../components/booking-summary-card";
import { ContactInfoCard } from "../../components/contact-info-card";
import { PremiumCalendar } from "../../components/premium-calendar";
import { TimeSlotGrid } from "../../components/time-slot-grid";
import styles from "../../components/booking-ui.module.css";
import type {
  PublicBookingCoach,
  PublicBookingPayload,
  PublicBookingTimeSlot,
  StoreBookingSettings,
  StorefrontPayload,
  StorefrontServiceSummary,
} from "../../types/storefront";

type ApiEnvelope<T> = { ok?: boolean; data?: T; error?: { message?: string }; message?: string };
type MemberMePayload = { member: { id: string; store_id: string | null; full_name: string | null; phone: string | null } };
type MemberState = { id: string; storeId: string | null; fullName: string; phone: string };
type EntitlementContract = {
  id: string;
  planName: string | null;
  planCode: string | null;
  planType: string | null;
  status: string;
  endsAt: string | null;
  pass: {
    id: string;
    branch_id?: string | null;
    remaining?: number | string | null;
    reserved_sessions?: number | string | null;
    total_sessions?: number | string | null;
    expires_at?: string | null;
    status?: string | null;
  } | null;
  packageMeta?: {
    branchId: string | null;
    serviceScope: string[];
    priceAmount: number;
  } | null;
};
type MemberEntitlementsPayload = { contracts: EntitlementContract[] };
type BookingPackageOption = {
  entryPassId: string;
  contractId: string;
  name: string;
  remaining: number;
  reserved: number;
  available: number;
  expiresAt: string | null;
};
type DepositPaymentSummary = {
  provider: string;
  paymentStatus: string;
  providerStatus: string;
  checkoutUrl: string | null;
  orderId: string;
  paymentId: string | null;
  providerReference: string | null;
};

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1600&q=80";

function unwrap<T>(payload: ApiEnvelope<T> | null) {
  return (payload && typeof payload === "object" && "data" in payload && payload.data ? payload.data : payload) as T;
}

async function requestJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || "Request failed");
  return unwrap<T>(payload);
}

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value || 0);
}

function shortDate(value: string | null) {
  if (!value) return "Not selected";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function longDateTime(value: string | null) {
  if (!value) return "Not selected";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function depositLabel(service: StorefrontServiceSummary | null, settings: StoreBookingSettings | null) {
  if (!settings?.depositsEnabled) return null;
  const useServiceRule = Boolean(service?.requiresDeposit && service.depositValue > 0);
  const mode = useServiceRule ? service?.depositCalculationType : settings.depositCalculationType;
  const value = useServiceRule ? service?.depositValue ?? 0 : settings.depositValue;
  if (!value || value <= 0) return settings.depositRequiredMode === "required" ? "Deposit required at confirmation" : "Deposit available";
  return mode === "percent" ? `Deposit ${value}%` : `Deposit ${money(value)}`;
}

function depositHelper(service: StorefrontServiceSummary | null, settings: StoreBookingSettings | null) {
  const label = depositLabel(service, settings);
  if (!label || !settings?.depositsEnabled) return null;
  return settings.depositRequiredMode === "required"
    ? `${label}. Booking confirmation will require a deposit.`
    : `${label}. Final payment can be completed at the studio if applicable.`;
}

export default function BookingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryBranchId = searchParams.get("branchId");
  const queryBranchCode = searchParams.get("branchCode");
  const queryServiceCode = searchParams.get("serviceCode");
  const queryDate = searchParams.get("date");
  const queryString = searchParams.toString();
  const hasExplicitBranch = Boolean(queryBranchId || queryBranchCode);

  const [storefront, setStorefront] = useState<StorefrontPayload | null>(null);
  const [availability, setAvailability] = useState<PublicBookingPayload | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(queryBranchId);
  const [selectedCoachId, setSelectedCoachId] = useState<string>("any");
  const [selectedServiceCode, setSelectedServiceCode] = useState<string | null>(queryServiceCode);
  const [selectedDate, setSelectedDate] = useState<string | null>(queryDate);
  const [selectedSlotStart, setSelectedSlotStart] = useState<string | null>(null);
  const [member, setMember] = useState<MemberState | null>(null);
  const [memberLoaded, setMemberLoaded] = useState(false);
  const [entitlements, setEntitlements] = useState<MemberEntitlementsPayload | null>(null);
  const [loadingEntitlements, setLoadingEntitlements] = useState(false);
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<"single" | "package">("single");
  const [selectedPackageId, setSelectedPackageId] = useState<string>("");
  const [form, setForm] = useState({ name: "", phone: "", note: "" });
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);
  const [depositPayment, setDepositPayment] = useState<DepositPaymentSummary | null>(null);
  const [loadingStorefront, setLoadingStorefront] = useState(true);
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const deferredBranchId = useDeferredValue(selectedBranchId);
  const deferredCoachId = useDeferredValue(selectedCoachId);
  const deferredServiceCode = useDeferredValue(selectedServiceCode);
  const deferredDate = useDeferredValue(selectedDate);

  useEffect(() => {
    let active = true;
    requestJson<MemberMePayload>("/api/member/me")
      .then((payload) => {
        if (!active) return;
        const next = {
          id: payload.member.id,
          storeId: payload.member.store_id,
          fullName: payload.member.full_name || "",
          phone: payload.member.phone || "",
        };
        setMember(next);
        setForm((current) => ({ name: current.name || next.fullName, phone: current.phone || next.phone, note: current.note }));
      })
      .catch(() => null)
      .finally(() => {
        if (active) setMemberLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!member?.id) {
      setEntitlements(null);
      return;
    }
    let active = true;
    setLoadingEntitlements(true);
    requestJson<MemberEntitlementsPayload>("/api/member/entitlements")
      .then((payload) => {
        if (active) setEntitlements(payload);
      })
      .catch(() => {
        if (active) setEntitlements(null);
      })
      .finally(() => {
        if (active) setLoadingEntitlements(false);
      });
    return () => {
      active = false;
    };
  }, [member?.id]);

  useEffect(() => {
    if (!member?.storeId || hasExplicitBranch) return;
    if (!storefront?.branches.some((item) => item.id === member.storeId)) return;
    if (selectedBranchId === member.storeId) return;
    setSelectedBranchId(member.storeId);
  }, [hasExplicitBranch, member?.storeId, selectedBranchId, storefront?.branches]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (selectedBranchId) params.set("branchId", selectedBranchId);
    else if (queryBranchCode) params.set("branchCode", queryBranchCode);
    setLoadingStorefront(true);
    requestJson<StorefrontPayload>(`/api/public/storefront${params.size ? `?${params.toString()}` : ""}`)
      .then((payload) => {
        if (!active) return;
        setStorefront(payload);
        if (!selectedBranchId && payload.branch?.id) setSelectedBranchId(payload.branch.id);
      })
      .catch((error) => {
        if (active) setPageError(error instanceof Error ? error.message : "Failed to load storefront");
      })
      .finally(() => {
        if (active) setLoadingStorefront(false);
      });
    return () => {
      active = false;
    };
  }, [queryBranchCode, selectedBranchId]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (deferredBranchId) params.set("branchId", deferredBranchId);
    else if (queryBranchCode) params.set("branchCode", queryBranchCode);
    if (deferredCoachId !== "any") params.set("coachId", deferredCoachId);
    if (deferredServiceCode) params.set("serviceCode", deferredServiceCode);
    if (deferredDate) params.set("date", deferredDate);
    setLoadingAvailability(true);
    requestJson<PublicBookingPayload>(`/api/public/booking${params.size ? `?${params.toString()}` : ""}`)
      .then((payload) => {
        if (!active) return;
        setAvailability(payload);
        if (!selectedServiceCode && payload.services[0]) setSelectedServiceCode(payload.services[0].code);
        if (selectedServiceCode && !payload.services.some((item) => item.code === selectedServiceCode)) setSelectedServiceCode(payload.services[0]?.code ?? null);
        if (selectedCoachId !== "any" && !payload.coaches.some((item) => item.id === selectedCoachId)) setSelectedCoachId("any");
        const nextDate = selectedDate && payload.availableDates.includes(selectedDate) ? selectedDate : payload.availableDates[0] || null;
        if (nextDate !== selectedDate) setSelectedDate(nextDate);
        if (selectedSlotStart && !payload.slots.some((item) => item.startsAt === selectedSlotStart)) setSelectedSlotStart(null);
      })
      .catch((error) => {
        if (active) setPageError(error instanceof Error ? error.message : "Failed to load booking availability");
      })
      .finally(() => {
        if (active) setLoadingAvailability(false);
      });
    return () => {
      active = false;
    };
  }, [deferredBranchId, deferredCoachId, deferredServiceCode, deferredDate, queryBranchCode, refreshKey, selectedCoachId, selectedDate, selectedServiceCode, selectedSlotStart]);

  useEffect(() => {
    const branch = storefront?.branches.find((item) => item.id === selectedBranchId) || storefront?.branch;
    const next = new URLSearchParams(queryString);
    let changed = false;

    if (branch?.id && next.get("branchId") !== branch.id) {
      next.set("branchId", branch.id);
      changed = true;
    }
    if (branch?.code && next.get("branchCode") !== branch.code) {
      next.set("branchCode", branch.code);
      changed = true;
    }
    if (selectedServiceCode) {
      if (next.get("serviceCode") !== selectedServiceCode) {
        next.set("serviceCode", selectedServiceCode);
        changed = true;
      }
    } else if (next.has("serviceCode")) {
      next.delete("serviceCode");
      changed = true;
    }
    if (selectedDate) {
      if (next.get("date") !== selectedDate) {
        next.set("date", selectedDate);
        changed = true;
      }
    } else if (next.has("date")) {
      next.delete("date");
      changed = true;
    }

    if (!changed) return;

    startTransition(() => {
      const href = next.toString() ? `/booking?${next.toString()}` : "/booking";
      router.replace(href, { scroll: false });
    });
  }, [queryString, router, selectedBranchId, selectedDate, selectedServiceCode, storefront?.branch, storefront?.branches]);

  const brand = storefront?.brandContent || null;
  const settings = availability?.bookingSettings || storefront?.bookingSettings || null;
  const packagesEnabled = settings?.packagesEnabled ?? true;
  const branches = availability?.branches || storefront?.branches || [];
  const selectedBranch = branches.find((item) => item.id === selectedBranchId) || availability?.branch || storefront?.branch || null;
  const services = availability?.services || storefront?.services || [];
  const coaches = availability?.coaches || [];
  const selectedService = services.find((item) => item.code === selectedServiceCode) || services[0] || null;
  const selectedCoach = selectedCoachId === "any" ? null : coaches.find((item) => item.id === selectedCoachId) || null;
  const selectedSlot = availability?.slots.find((item) => item.startsAt === selectedSlotStart) || null;
  const availablePackages: BookingPackageOption[] = (packagesEnabled ? entitlements?.contracts || [] : [])
    .map((contract) => {
      if (!contract.pass || !contract.id) return null;
      if (!["active", "pending"].includes(contract.status)) return null;
      const remaining = Number(contract.pass.remaining ?? 0);
      const reserved = Number(contract.pass.reserved_sessions ?? 0);
      const available = Math.max(0, remaining - reserved);
      const expiresAt = contract.pass.expires_at || contract.endsAt || null;
      const scopedBranchId = contract.packageMeta?.branchId || contract.pass.branch_id || null;
      const serviceScope = Array.isArray(contract.packageMeta?.serviceScope)
        ? contract.packageMeta?.serviceScope.map((item) => String(item).toLowerCase())
        : [];
      const serviceMatches =
        !selectedService ||
        serviceScope.length === 0 ||
        serviceScope.includes(selectedService.id.toLowerCase()) ||
        serviceScope.includes(selectedService.code.toLowerCase()) ||
        serviceScope.includes(selectedService.name.toLowerCase());
      const notExpired = !expiresAt || new Date(expiresAt).getTime() >= Date.now();
      if (!serviceMatches || !notExpired || available <= 0) return null;
      if (scopedBranchId && selectedBranchId && scopedBranchId !== selectedBranchId) return null;
      return {
        entryPassId: contract.pass.id,
        contractId: contract.id,
        name: contract.planName || "Package",
        remaining,
        reserved,
        available,
        expiresAt,
      } satisfies BookingPackageOption;
    })
    .filter((item): item is BookingPackageOption => Boolean(item));
  const selectedPackage = availablePackages.find((item) => item.entryPassId === selectedPackageId) || availablePackages[0] || null;
  const deposit = selectedPaymentMode === "package" ? "Covered by package" : depositLabel(selectedService, settings);
  const depositNote =
    selectedPaymentMode === "package"
      ? selectedPackage
        ? `${selectedPackage.name} will reserve 1 session now and consume it only after the booking is completed.`
        : "Choose an active package to reserve a session for this booking."
      : depositHelper(selectedService, settings);
  const authScopeMismatch = Boolean(member?.storeId && selectedBranchId && member.storeId !== selectedBranchId);

  const summaryItems = [
    { label: "Branch", value: selectedBranch?.name || "Not selected" },
    { label: "Therapist", value: selectedCoach?.displayName || "Any available therapist" },
    { label: "Service", value: selectedService?.name || "Not selected" },
    { label: "Payment", value: selectedPaymentMode === "package" ? selectedPackage?.name || "Choose package" : "Single booking" },
    { label: "Date", value: shortDate(selectedDate) },
    { label: "Time", value: selectedSlot ? longDateTime(selectedSlot.startsAt) : "Not selected" },
  ];

  useEffect(() => {
    if (!packagesEnabled && selectedPaymentMode === "package") {
      setSelectedPaymentMode("single");
      setSelectedPackageId("");
      return;
    }
    if (selectedPaymentMode === "package" && !selectedPackage && availablePackages.length === 0) {
      setSelectedPaymentMode("single");
      setSelectedPackageId("");
      return;
    }
    if (selectedPaymentMode === "package" && availablePackages[0] && !availablePackages.some((item) => item.entryPassId === selectedPackageId)) {
      setSelectedPackageId(availablePackages[0].entryPassId);
    }
    if (selectedPaymentMode === "single" && selectedPackageId) {
      setSelectedPackageId("");
    }
  }, [availablePackages, packagesEnabled, selectedPackage, selectedPackageId, selectedPaymentMode]);

  const navItems = brand?.customNavItems?.length
    ? brand.customNavItems
    : [
        { label: "Services", href: "#services" },
        { label: "About", href: "#about" },
        { label: "Booking", href: "#booking" },
        { label: "Contact", href: "#contact" },
      ];

  const buttonLabel = !memberLoaded
    ? "Checking account"
    : !member
      ? "Sign in to book"
      : authScopeMismatch
        ? "Selected branch is locked"
        : submitting
          ? "Submitting"
          : brand?.ctaPrimaryLabel || "Book now";

  function scrollTo(id: string) {
    const target =
      Array.from(document.querySelectorAll<HTMLElement>(`[id="${id}"]`)).find((node) => node.offsetParent !== null) ||
      document.getElementById(id);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function continueBookingFlow() {
    setPageError(null);
    if (!selectedService) {
      setPageError("Please choose a service before continuing to date and time.");
      scrollTo("services");
      return;
    }
    if (!selectedDate) {
      scrollTo("date-step");
      return;
    }
    if (!selectedSlot) {
      scrollTo("time-step");
      return;
    }
    scrollTo("booking");
  }

  async function submitBooking() {
    setPageError(null);
    setPageSuccess(null);
    setDepositPayment(null);
    if (!memberLoaded) return;
    if (!member) {
      router.push(`/login?next=${encodeURIComponent(`/booking${queryString ? `?${queryString}` : ""}`)}`);
      return;
    }
    if (authScopeMismatch) {
      setPageError("Your member account is scoped to another branch. Switch back to your assigned branch to keep the existing booking logic intact.");
      return;
    }
    if (!selectedService || !selectedSlot || !form.name.trim() || !form.phone.trim()) {
      setPageError("Please complete service, date, time, name, and phone before confirming.");
      return;
    }
    if (selectedPaymentMode === "package" && !selectedPackage) {
      setPageError("Please choose an active package before confirming this booking.");
      return;
    }
    if (selectedPaymentMode === "package" && !packagesEnabled) {
      setPageError("Package booking is disabled for this branch right now.");
      return;
    }
    setSubmitting(true);
    try {
      if (form.name.trim() !== member.fullName || form.phone.trim() !== member.phone) {
        await requestJson("/api/member/profile", {
          method: "PATCH",
          body: JSON.stringify({ full_name: form.name.trim(), phone: form.phone.trim() }),
        });
      }
      const bookingResult = await requestJson<{ depositPayment?: DepositPaymentSummary | null }>("/api/member/bookings", {
        method: "POST",
        body: JSON.stringify({
          coachId: selectedCoach?.id ?? null,
          serviceName: selectedService.name,
          startsAt: selectedSlot.startsAt,
          endsAt: selectedSlot.endsAt,
          note: form.note.trim() || null,
          paymentMode: selectedPaymentMode,
          entryPassId: selectedPaymentMode === "package" ? selectedPackage?.entryPassId ?? null : null,
        }),
      });
      setDepositPayment(bookingResult?.depositPayment || null);
      setPageSuccess(
        bookingResult?.depositPayment?.checkoutUrl
          ? "Booking submitted successfully. Continue to the provider to pay the required deposit."
          : "Booking submitted successfully. The original member booking workflow is still used underneath.",
      );
      setSelectedSlotStart(null);
      setForm((current) => ({ ...current, note: "" }));
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  function paymentCards() {
    return (
      <div className={styles.choiceGrid}>
        <button
          type="button"
          className={[styles.choiceCard, selectedPaymentMode === "single" ? styles.isSelected : ""].filter(Boolean).join(" ")}
          onClick={() => setSelectedPaymentMode("single")}
        >
          <div className={styles.choiceTopLine}>
            <div>
              <h4 className={styles.choiceTitle}>Single booking</h4>
              <p className={styles.choiceDescription}>Use the branch deposit rule and settle the rest through the existing payment flow.</p>
            </div>
            {selectedPaymentMode === "single" ? <span className={styles.miniBadge}>Selected</span> : null}
          </div>
        </button>
        <button
          type="button"
          className={[styles.choiceCard, selectedPaymentMode === "package" ? styles.isSelected : ""].filter(Boolean).join(" ")}
          onClick={() => {
            if (!packagesEnabled) return;
            setSelectedPaymentMode("package");
            if (availablePackages[0]) setSelectedPackageId(availablePackages[0].entryPassId);
          }}
          disabled={!packagesEnabled || !availablePackages.length}
        >
          <div className={styles.choiceTopLine}>
            <div>
              <h4 className={styles.choiceTitle}>Use package</h4>
              <p className={styles.choiceDescription}>
                {loadingEntitlements
                  ? "Checking active packages..."
                  : !packagesEnabled
                    ? "Package booking is currently disabled by the platform or branch booking capability."
                  : availablePackages.length
                    ? `${availablePackages.length} eligible package${availablePackages.length > 1 ? "s" : ""} found for this service.`
                    : "No eligible package is available for this service and branch."}
              </p>
            </div>
            {selectedPaymentMode === "package" ? <span className={styles.miniBadge}>Selected</span> : null}
          </div>
        </button>
        {packagesEnabled && selectedPaymentMode === "package" && availablePackages.map((item) => (
          <button
            key={item.entryPassId}
            type="button"
            className={[styles.choiceCard, item.entryPassId === selectedPackage?.entryPassId ? styles.isSelected : ""].filter(Boolean).join(" ")}
            onClick={() => setSelectedPackageId(item.entryPassId)}
          >
            <div className={styles.choiceTopLine}>
              <div>
                <h4 className={styles.choiceTitle}>{item.name}</h4>
                <p className={styles.choiceDescription}>
                  {item.available} available / {item.remaining} remaining {item.expiresAt ? `• expires ${shortDate(item.expiresAt.slice(0, 10))}` : ""}
                </p>
              </div>
              {item.entryPassId === selectedPackage?.entryPassId ? <span className={styles.miniBadge}>Selected</span> : null}
            </div>
          </button>
        ))}
      </div>
    );
  }

  function serviceCards() {
    return (
      <div className={styles.serviceGrid}>
        {services.map((service) => (
          <BookingServiceCard
            key={service.id}
            service={service}
            selected={service.code === selectedService?.code}
            priceLabel={money(service.priceAmount)}
            depositLabel={depositLabel(service, settings)}
            onSelect={() => {
              setSelectedServiceCode(service.code);
              setSelectedSlotStart(null);
              setPageError(null);
            }}
          />
        ))}
      </div>
    );
  }

  function branchCards() {
    return (
      <div className={styles.choiceGrid}>
        {branches.map((branch) => {
          const selected = branch.id === selectedBranchId;
          return (
            <button
              key={branch.id}
              type="button"
              className={[styles.choiceCard, selected ? styles.isSelected : ""].filter(Boolean).join(" ")}
              onClick={() => {
                setSelectedBranchId(branch.id);
                setSelectedCoachId("any");
                setSelectedDate(null);
                setSelectedSlotStart(null);
                setPageError(null);
                setPageSuccess(null);
              }}
            >
              <div className={styles.choiceTopLine}>
                <div>
                  <h4 className={styles.choiceTitle}>{branch.name}</h4>
                  <p className={styles.choiceDescription}>{branch.address || "Private studio location"}</p>
                </div>
                {selected ? <span className={styles.miniBadge}>Selected</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  function coachCards() {
    return (
      <div className={styles.choiceGrid}>
        <button type="button" className={[styles.choiceCard, selectedCoachId === "any" ? styles.isSelected : ""].filter(Boolean).join(" ")} onClick={() => setSelectedCoachId("any")}>
          <div className={styles.choiceTopLine}>
            <div>
              <h4 className={styles.choiceTitle}>Any available therapist</h4>
              <p className={styles.choiceDescription}>Show every valid slot first, then let the system pair the best match.</p>
            </div>
            {selectedCoachId === "any" ? <span className={styles.miniBadge}>Selected</span> : null}
          </div>
        </button>
        {coaches.map((coach: PublicBookingCoach) => (
          <button
            key={coach.id}
            type="button"
            className={[styles.choiceCard, coach.id === selectedCoachId ? styles.isSelected : ""].filter(Boolean).join(" ")}
            onClick={() => {
              setSelectedCoachId(coach.id);
              setSelectedSlotStart(null);
            }}
          >
            <div className={styles.choiceTopLine}>
              <div>
                <h4 className={styles.choiceTitle}>{coach.displayName || "Therapist"}</h4>
                <p className={styles.choiceDescription}>Preferred hands-on therapist selection.</p>
              </div>
              {coach.id === selectedCoachId ? <span className={styles.miniBadge}>Selected</span> : null}
            </div>
          </button>
        ))}
      </div>
    );
  }

  function detailFields() {
    return (
      <div className={styles.fieldGrid}>
        <label className={styles.fieldBlock}>
          <span className={styles.fieldLabel}>Name</span>
          <input className={styles.input} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Your full name" />
        </label>
        <label className={styles.fieldBlock}>
          <span className={styles.fieldLabel}>Phone</span>
          <input className={styles.input} value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Mobile number" />
        </label>
        <label className={`${styles.fieldBlock} ${styles.isFull}`}>
          <span className={styles.fieldLabel}>Note</span>
          <textarea className={styles.textarea} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Optional note for recovery focus, pressure preference, or arrival timing." />
        </label>
      </div>
    );
  }

  function bookingSteps(withSummary: boolean) {
    return (
      <div className={styles.stepList}>
        <BookingStepCard title="Step 1. Choose branch" description="Select the studio location you want the storefront and booking availability to load from." status={selectedBranch ? "Complete" : "Required"}>{branchCards()}</BookingStepCard>
        <BookingStepCard title="Step 2. Choose therapist" description="Pick a preferred therapist or stay flexible and browse all valid times." status={selectedCoachId ? "Complete" : "Required"}>{coachCards()}</BookingStepCard>
        <BookingStepCard id="services" title="Step 3. Choose service" description="Session pricing, duration, and deposit indicators come directly from the live storefront payload." status={selectedService ? "Complete" : "Required"}>{serviceCards()}</BookingStepCard>
        <BookingStepCard id="date-step" title="Step 4. Choose date" description="The premium calendar uses the real booking window, min advance time, and disabled dates from the availability endpoint." status={selectedDate ? "Complete" : "Required"}>
          <div className={styles.calendarWrap}>
            <PremiumCalendar
              selectedDate={selectedDate}
              onSelectDate={(value) => {
                setSelectedDate(value);
                setSelectedSlotStart(null);
              }}
              disabledDates={availability?.disabledDates || []}
              availableDates={availability?.availableDates || []}
              minDate={availability?.availableDates[0] || null}
              maxDate={availability?.availableDates[availability.availableDates.length - 1] || null}
              helperText="Selected dates appear as a solid black circle. Unavailable days stay muted."
            />
          </div>
        </BookingStepCard>
        <BookingStepCard id="time-step" title="Step 5. Choose time" description="Only valid time slots from the existing scheduling engine are shown here." status={selectedSlot ? "Complete" : "Required"}>
          <TimeSlotGrid slots={availability?.slots || []} selectedSlotStart={selectedSlotStart} onSelectSlot={(slot: PublicBookingTimeSlot) => setSelectedSlotStart(slot.startsAt)} />
        </BookingStepCard>
        <BookingStepCard title="Step 6. Choose payment" description="Book as a single paid session or, when the branch capability allows it, reserve 1 session from an active package without changing the scheduling flow." status={selectedPaymentMode === "package" ? (selectedPackage ? "Complete" : "Required") : "Complete"}>{paymentCards()}</BookingStepCard>
        <BookingStepCard title="Step 7. Contact details" description="We keep the original member booking flow, so these fields also sync back to the existing member profile." status={form.name.trim() && form.phone.trim() ? "Complete" : "Required"}>{detailFields()}</BookingStepCard>
        <BookingStepCard id="booking" title="Step 8. Confirm booking" description="Review the booking summary, package reserve note, and deposit notice before sending the original booking request." status={selectedSlot && form.name.trim() && form.phone.trim() ? "Ready" : "Review"}>
          {withSummary ? (
            <BookingSummaryCard
              totalLabel={money(selectedService?.priceAmount || 0)}
              depositLabel={deposit}
              items={summaryItems}
              helperText={authScopeMismatch ? "Your current member account is scoped to another branch, so the existing booking API would reject this selection." : depositNote || "Payment collection still follows the existing backend flow."}
              ctaLabel={buttonLabel}
              disabled={!memberLoaded || submitting || (selectedPaymentMode === "package" && !selectedPackage)}
              onSubmit={submitBooking}
            />
          ) : null}
        </BookingStepCard>
      </div>
    );
  }

  if (loadingStorefront && !storefront) return <main className={styles.page}><div className={styles.loadingState}>Loading booking storefront...</div></main>;
  if (!brand || !settings) return <main className={styles.page}><div className={styles.loadingState}>Storefront configuration is not available yet.</div></main>;

  const heroMeta = [selectedBranch?.name || "Premium studio", deposit || "Deposit optional", `${settings.bookingWindowDays} day booking window`];
  const desktopImage = brand.heroImageUrl || brand.mobileFeatureImageUrl || FALLBACK_IMAGE;
  const mobileImage = brand.mobileFeatureImageUrl || brand.heroImageUrl || FALLBACK_IMAGE;
  const noticeItems = [
    settings.allowCustomerReschedule ? `Reschedule allowed up to ${settings.latestRescheduleHours} hours before start.` : "Customer reschedule is currently disabled.",
    settings.allowCustomerCancel ? `Cancellation allowed up to ${settings.latestCancelHours} hours before start.` : "Customer cancellation is currently disabled.",
    depositNote || "No mandatory deposit is currently shown for this branch.",
  ];

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.desktopOnly}>
          <BookingHeader brandName={brand.brandName} branchName={selectedBranch?.name || null} navItems={navItems} ctaLabel={brand.ctaPrimaryLabel} onPrimaryClick={continueBookingFlow} />
          <BookingHero brandName={brand.brandName} title={brand.heroTitle} subtitle={brand.heroSubtitle} heroImageUrl={desktopImage} primaryLabel={brand.ctaPrimaryLabel} secondaryLabel={brand.ctaSecondaryLabel} onPrimaryClick={continueBookingFlow} onSecondaryClick={() => scrollTo("services")} meta={heroMeta} />
          <section className={styles.sectionGrid}>
            <div className={styles.contentColumn}>
              {pageError ? <div className={`${styles.message} ${styles.isError}`}>{pageError}</div> : null}
              {pageSuccess ? <div className={`${styles.message} ${styles.isSuccess}`}>{pageSuccess}</div> : null}
              {depositPayment ? (
                <div className={styles.inlineNotice}>
                  <p className={styles.emptyText}>
                    Deposit provider: {depositPayment.provider} | status: {depositPayment.providerStatus}
                  </p>
                  <p className={styles.emptyText}>
                    Order {depositPayment.orderId}
                    {depositPayment.paymentId ? ` / Payment ${depositPayment.paymentId}` : ""}
                    {depositPayment.providerReference ? ` / Ref ${depositPayment.providerReference}` : ""}
                  </p>
                  {depositPayment.checkoutUrl ? (
                    <a className="fdPillBtn fdPillBtnPrimary" href={depositPayment.checkoutUrl} target="_blank" rel="noreferrer">
                      Continue deposit payment
                    </a>
                  ) : null}
                </div>
              ) : null}
              {!member && memberLoaded ? <div className={styles.inlineNotice}><p className={styles.emptyText}>Browse the brand page freely. Final booking submission still uses the existing member booking API, so sign in is required before confirmation.</p></div> : null}
              {authScopeMismatch ? <div className={styles.inlineNotice}><p className={styles.emptyText}>Your member account belongs to another branch. This UI keeps the original branch-scoped booking logic unchanged, so please switch back before submitting.</p></div> : null}
              {brand.aboutSectionEnabled ? <section className={styles.contentCard} id="about"><p className={styles.sectionEyebrow}>About</p><h2 className={styles.sectionTitle}>{brand.introTitle}</h2><p className={styles.sectionCopy}>{brand.introBody}</p></section> : null}
              <section className={styles.contentCard}><p className={styles.sectionEyebrow}>Services</p><h2 className={styles.stepTitle}>{brand.servicesSectionTitle}</h2><p className={styles.sectionCopy}>{brand.servicesSectionSubtitle}</p>{serviceCards()}</section>
              {brand.teamSectionEnabled ? <section className={styles.contentCard}><p className={styles.sectionEyebrow}>Team</p><h2 className={styles.stepTitle}>Recommended therapists</h2><div className={styles.choiceGrid}>{coaches.slice(0, 4).map((coach) => <button key={coach.id} type="button" className={styles.choiceCard} onClick={() => { setSelectedCoachId(coach.id); scrollTo("booking"); }}><div className={styles.choiceTopLine}><div><h4 className={styles.choiceTitle}>{coach.displayName || "Therapist"}</h4><p className={styles.choiceDescription}>Available through the live booking rail.</p></div></div></button>)}</div></section> : null}
              <BookingNoticeCard title={brand.bookingNoticeTitle} body={brand.bookingNoticeBody} reminders={noticeItems} />
              {brand.contactSectionEnabled ? <ContactInfoCard title={brand.contactTitle} body={brand.contactBody} address={brand.contactAddress || selectedBranch?.address || ""} phone={brand.contactPhone} email={brand.contactEmail} line={brand.contactLine} hours={brand.businessHours} /> : null}
            </div>
            <aside className={styles.bookingColumn}>
              {loadingAvailability ? <div className={styles.inlineNotice}>Refreshing availability...</div> : null}
              {bookingSteps(true)}
            </aside>
          </section>
        </div>

        <div className={styles.mobileOnly}>
          <section className={styles.mobileShell}>
            <BookingHeader brandName={brand.brandName} branchName={selectedBranch?.name || null} navItems={navItems.slice(0, 3)} ctaLabel={brand.ctaPrimaryLabel} onPrimaryClick={continueBookingFlow} />
            <BookingHero brandName={brand.brandName} title={brand.heroTitle} subtitle={brand.heroSubtitle} heroImageUrl={mobileImage} primaryLabel={brand.ctaPrimaryLabel} secondaryLabel={brand.ctaSecondaryLabel} onPrimaryClick={continueBookingFlow} onSecondaryClick={() => scrollTo("services")} meta={heroMeta} mobile />
            <div className={styles.mobileStack}>
              {pageError ? <div className={`${styles.message} ${styles.isError}`}>{pageError}</div> : null}
              {pageSuccess ? <div className={`${styles.message} ${styles.isSuccess}`}>{pageSuccess}</div> : null}
              {depositPayment ? (
                <div className={styles.inlineNotice}>
                  <p className={styles.emptyText}>
                    Deposit provider: {depositPayment.provider} | status: {depositPayment.providerStatus}
                  </p>
                  {depositPayment.checkoutUrl ? (
                    <a className="fdPillBtn fdPillBtnPrimary" href={depositPayment.checkoutUrl} target="_blank" rel="noreferrer">
                      Continue deposit payment
                    </a>
                  ) : null}
                </div>
              ) : null}
              {brand.aboutSectionEnabled ? <section className={styles.contentCard}><p className={styles.sectionEyebrow}>About</p><h2 className={styles.stepTitle}>{brand.introTitle}</h2><p className={styles.sectionCopy}>{brand.introBody}</p></section> : null}
              <section className={styles.contentCard}><p className={styles.sectionEyebrow}>Services</p><h2 className={styles.stepTitle}>{brand.servicesSectionTitle}</h2><p className={styles.sectionCopy}>{brand.servicesSectionSubtitle}</p><div className={styles.mobileServiceStrip}>{serviceCards()}</div></section>
              <div className={styles.mobileStepGroup}>{bookingSteps(false)}</div>
              <BookingNoticeCard title={brand.bookingNoticeTitle} body={brand.bookingNoticeBody} reminders={noticeItems} />
              {brand.contactSectionEnabled ? <ContactInfoCard title={brand.contactTitle} body={brand.contactBody} address={brand.contactAddress || selectedBranch?.address || ""} phone={brand.contactPhone} email={brand.contactEmail} line={brand.contactLine} hours={brand.businessHours} /> : null}
              {!member && memberLoaded ? <div className={styles.inlineNotice}><p className={styles.emptyText}>Sign in as a member to send the existing booking request.</p></div> : null}
              {authScopeMismatch ? <div className={styles.inlineNotice}><p className={styles.emptyText}>Your account is scoped to another branch, so booking confirmation is disabled here.</p></div> : null}
            </div>
            <BookingStickyBar totalLabel={money(selectedService?.priceAmount || 0)} depositLabel={deposit} buttonLabel={buttonLabel} disabled={!memberLoaded || submitting || (selectedPaymentMode === "package" && !selectedPackage)} onAction={submitBooking} />
          </section>
        </div>
      </div>
    </main>
  );
}
