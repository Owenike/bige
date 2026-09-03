"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "../app/staff/performance/page.module.css";
import {
  normalizeStaffPosition,
  positionLabel,
  staffPositionForDisplay,
} from "../lib/staff-organization";

type CoachSummary = {
  id: string;
  display_name: string | null;
  english_name: string | null;
  employee_number: string | null;
  position: string | null;
  employment_type: "full_time" | "part_time" | null;
  employment_configured: boolean;
  confirmedSales: number;
  projectedSales: number;
  completedSessions: number;
  confirmedEpo: number;
  projectedEpo: number;
  sessionRate: number;
  courseFeeAmount: number;
  salesRemaining: number;
  sessionsRemaining: number;
  nextTier: null | { salesThreshold: number; sessionThreshold: number | null; sessionRate: number };
  formalCourseCounts: MetricCount[];
  faExecutionCounts: MetricCount[];
  faConverted: number;
  faNotConverted: number;
  faPending: number;
  faConversionRate: number | null;
  successfulFaAppointments: number;
  bbVisits: number;
  bbConversions: number;
};

type MetricCount = { label: string; count: number };

type SalesEvent = {
  id: string;
  business_date: string;
  source_type: string;
  label: string;
  amount: number;
  status: string;
  assigned_employee_id: string | null;
  review_note: string | null;
  allocation_note: string | null;
  origin_employee_id: string | null;
  contract_sessions: number | null;
  allocations: SalesAllocation[];
};

type SalesAllocation = {
  id: string;
  employee_id: string;
  amount: number;
  allocation_kind: string;
  status: string;
  source_allocation_id: string | null;
};

type EpoAward = {
  id: string;
  business_date: string;
  employee_id: string;
  quantity: number;
  reason: string;
  status: string;
  review_note: string | null;
  award_type: string;
  calculation: Record<string, unknown>;
};

type DailyTopState = {
  id: string;
  business_date: string;
  adjustment_business_date: string;
  top_amount: number;
  candidate_employee_ids: string[];
  selected_employee_id: string | null;
  status: string;
};

type ManagerModal = "coaches" | "dates" | "epo" | "sales";
type SalesListMode = "pending" | "completed";

type DailyCoachSummary = {
  employeeId: string;
  shiftLabel: string | null;
  shiftStartsAt: string | null;
  shiftEndsAt: string | null;
  completedSessions: number;
  scheduledSessions: number;
  pendingSessions: number;
  ptCompletedSessions: number;
  trialCompletedSessions: number;
  cancelledSessions: number;
  noShowSessions: number;
  salesAmount: number;
  confirmedSalesAmount: number;
  salesAllocationCount: number;
  salesNeedsConfirmation: boolean;
  formalCourseCounts: MetricCount[];
  faExecutionCounts: MetricCount[];
  successfulFaAppointments: number;
  bbVisits: number;
  bbConversions: number;
};

type PerformanceState = {
  actor: {
    id: string;
    canManage: boolean;
    canAllocate: boolean;
    canApprove: boolean;
    canManageEpo: boolean;
    canConfirm: boolean;
  };
  month: string;
  selectedDate: string;
  scope?: "daily" | "month";
  coaches: CoachSummary[];
  events: SalesEvent[];
  epoAwards: EpoAward[];
  dailyReports: Array<{ id: string; business_date: string; status: string; confirmed_at: string | null; prepared_at: string | null; prepared_by: string | null; reopen_reason: string | null }>;
  dailyTopStates: DailyTopState[];
  sessionEpoEvidence: Array<{ employeeId: string; employmentType: "full_time" | "part_time"; scheduleReady: boolean; inside: number; outside: number; boundary: number; eligible: boolean; requiredInside: number; requiredOutside: number }>;
  dailyCoachSummaries: DailyCoachSummary[];
  successfulFaAppointments: null | {
    total: number;
    otherBookers: MetricCount[];
  };
  courseSettlement: null | {
    summary: { total: number; completed: number; cancelled: number; noShow: number; pending: number; ptCompleted: number; trialCompleted: number };
    closure: null | { status: string; confirmed_at: string | null; reopened_at: string | null };
  };
};

const SOURCE_LABELS: Record<string, string> = {
  fa: "FA 成交",
  bb: "BB 成交",
  renewal: "續約",
  final_payment: "繳交尾款",
  refund: "退款扣回",
  manual_adjustment: "人工調整",
};

const STATUS_LABELS: Record<string, string> = {
  unassigned: "尚未分配",
  pending_manager: "等待經理覆核",
  approved: "已覆核，待日報確認",
  daily_confirmed: "每日報表已確認",
  rejected: "不列入業績",
  ignored: "已作廢",
  assistant_proposed: "等待經理覆核",
  manager_approved: "已覆核，待日報確認",
  cancelled: "已取消",
};

const EPO_TYPE_LABELS: Record<string, string> = {
  manual: "人工 EPO",
  contract_threshold: "成交堂數達標",
  daily_top: "每日數字最高",
  session_load: "班內外堂數達標",
  reversal: "追回",
  reassignment: "退單重算補發",
};

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function MetricBreakdown({ items, empty = "0" }: { items: MetricCount[]; empty?: string }) {
  if (!items.length) return <span className={styles.metricEmpty}>{empty}</span>;
  return <div className={styles.metricBreakdown}>{items.map((item) => (
    <span key={item.label}><b>{item.label}</b><strong>{item.count}</strong></span>
  ))}</div>;
}

function coachIdentityParts(coach: CoachSummary | null | undefined) {
  if (!coach) return { names: ["尚未分配"], position: null };
  const names: string[] = [];
  for (const value of [coach.display_name, coach.english_name]) {
    const label = value?.trim();
    if (label && !names.some((part) => part.toLocaleLowerCase("zh-TW") === label.toLocaleLowerCase("zh-TW"))) {
      names.push(label);
    }
  }
  if (!names.length && coach.employee_number?.trim()) names.push(coach.employee_number.trim());
  return {
    names: names.length ? names : ["尚未分配"],
    position: staffPositionForDisplay(coach.position, coach.employee_number),
  };
}

function coachIdentityLabel(coach: CoachSummary | null | undefined) {
  const { names, position } = coachIdentityParts(coach);
  return [...names, ...(position ? [positionLabel(position)] : [])].join("｜");
}

function coachPositionBadgeTone(position: ReturnType<typeof normalizeStaffPosition>) {
  if (position === "coach_city_manager" || position === "coach_manager") return styles.positionBadgeExecutive;
  if (position === "coach_assistant_manager" || position === "coach_director") return styles.positionBadgeSupervisor;
  if (position === "coach_team_lead") return styles.positionBadgeLead;
  return styles.positionBadgeCoach;
}

function CoachIdentityPresentation({ coach, compact = false }: { coach: CoachSummary | null | undefined; compact?: boolean }) {
  const { names, position } = coachIdentityParts(coach);
  return <span className={`${styles.coachIdentityPresentation} ${compact ? styles.coachIdentityCompact : ""}`} aria-label={coachIdentityLabel(coach)}>
    <span className={styles.coachIdentityNames}>
      <strong>{names[0]}</strong>
      {names[1] ? <span className={styles.coachEnglishName}>{names[1]}</span> : null}
    </span>
    {position ? <span className={`${styles.positionBadge} ${coachPositionBadgeTone(position)}`}>{positionLabel(position)}</span> : null}
  </span>;
}

function monthLabel(value: string) {
  const [year, monthNumber] = value.split("-");
  return `${year} 年 ${Number(monthNumber)} 月`;
}

function todayTaiwan() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function shiftDate(value: string, offset: number) {
  const next = new Date(`${value}T12:00:00+08:00`);
  next.setUTCDate(next.getUTCDate() + offset);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(next);
}

function eventNeedsAllocation(event: SalesEvent) {
  const allocated = event.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0);
  const hasGap = event.source_type !== "refund" && Math.abs(Number(event.amount) - allocated) > 0.001;
  return hasGap || event.status === "unassigned";
}

function eventNeedsAttention(event: SalesEvent) {
  return eventNeedsAllocation(event) || event.status === "pending_manager";
}

async function parse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as PerformanceState;
}

async function fetchPerformanceState(url: string, timeoutMs: number, timeoutMessage: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await parse(await fetch(url, { ...init, cache: "no-store", signal: controller.signal }));
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw new Error(timeoutMessage);
    throw caught;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function StaffPerformanceDashboard({
  managerMode = false,
  initialData = null,
  initialMonth,
  initialDate,
}: {
  managerMode?: boolean;
  initialData?: PerformanceState | null;
  initialMonth?: string;
  initialDate?: string;
}) {
  const initialToday = todayTaiwan();
  const requestedDate = initialDate || initialToday;
  const requestedMonth = initialMonth || requestedDate.slice(0, 7);
  const [month, setMonth] = useState(requestedMonth);
  const [date, setDate] = useState(requestedDate);
  const [data, setData] = useState<PerformanceState | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [epoEmployeeId, setEpoEmployeeId] = useState("");
  const [epoQuantity, setEpoQuantity] = useState(1);
  const [epoReason, setEpoReason] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [allocationDraft, setAllocationDraft] = useState<Record<string, string>>({});
  const [activeModal, setActiveModal] = useState<ManagerModal | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [salesListMode, setSalesListMode] = useState<SalesListMode>("pending");
  const [showSalesRules, setShowSalesRules] = useState(false);
  const [showEpoRules, setShowEpoRules] = useState(false);
  const [showEpoForm, setShowEpoForm] = useState(false);
  const [historyDate, setHistoryDate] = useState(requestedDate);
  const [historyData, setHistoryData] = useState<PerformanceState | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [overviewMonth, setOverviewMonth] = useState(initialToday.slice(0, 7));
  const [overviewData, setOverviewData] = useState<PerformanceState | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [refreshing, setRefreshing] = useState(Boolean(initialData?.actor.canManage));
  const [refreshError, setRefreshError] = useState("");
  const activeViewKeyRef = useRef(`${month}:${date}`);
  const refreshedViewKeyRef = useRef("");
  const initialSnapshotHandledRef = useRef(false);

  const closeModal = useCallback((force = false) => {
    if (!force && activeModal === "sales" && editingEventId && !window.confirm("尚未儲存分配內容，確定關閉？")) return;
    setActiveModal(null);
    setSelectedEventId(null);
    setEditingEventId(null);
    setAllocationDraft({});
    setShowSalesRules(false);
    setShowEpoRules(false);
    setShowEpoForm(false);
  }, [activeModal, editingEventId]);

  useEffect(() => {
    if (!activeModal) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeModal, closeModal]);

  const refreshSources = useCallback(async (snapshot: PerformanceState, viewKey: string, force = false) => {
    if (!snapshot.actor.canManage || (!force && refreshedViewKeyRef.current === viewKey)) return;
    refreshedViewKeyRef.current = viewKey;
    setRefreshing(true);
    setRefreshError("");
    try {
      const refreshed = await fetchPerformanceState(
        "/api/staff-performance",
        30_000,
        "最新收款與 EPO 核對逾時，請重試後再處理業績或結算。",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "refresh_sources", month: snapshot.month, date: snapshot.selectedDate, scope: managerMode ? "daily" : "month" }),
        },
      );
      if (activeViewKeyRef.current === viewKey) setData(refreshed);
    } catch (caught) {
      if (activeViewKeyRef.current === viewKey) {
        setRefreshError(caught instanceof Error ? caught.message : "最新資料同步失敗");
      }
    } finally {
      if (activeViewKeyRef.current === viewKey) setRefreshing(false);
    }
  }, [managerMode]);

  const load = useCallback(async () => {
    const viewKey = `${month}:${date}`;
    activeViewKeyRef.current = viewKey;
    setLoading(true);
    setError("");
    setRefreshError("");
    try {
      const snapshot = await fetchPerformanceState(
        `/api/staff-performance?month=${month}&date=${date}&scope=${managerMode ? "daily" : "month"}`,
        8_000,
        "今日工作台讀取超過 8 秒，請重試。",
      );
      if (activeViewKeyRef.current !== viewKey) return;
      setData(snapshot);
      setLoading(false);
      void refreshSources(snapshot, viewKey);
    } catch (caught) {
      if (activeViewKeyRef.current === viewKey) setError(caught instanceof Error ? caught.message : "讀取失敗");
    } finally {
      if (activeViewKeyRef.current === viewKey) setLoading(false);
    }
  }, [date, managerMode, month, refreshSources]);

  useEffect(() => {
    const viewKey = `${month}:${date}`;
    if (!initialSnapshotHandledRef.current) {
      initialSnapshotHandledRef.current = true;
      if (initialData?.month === month && initialData.selectedDate === date) {
        activeViewKeyRef.current = viewKey;
        setLoading(false);
        void refreshSources(initialData, viewKey);
        return;
      }
    }
    void load();
  }, [date, initialData, load, month, refreshSources]);

  useEffect(() => {
    if (activeModal !== "dates" || !historyDate) return;
    if (historyData?.selectedDate === historyDate) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    void fetch(`/api/staff-performance?month=${historyDate.slice(0, 7)}&date=${historyDate}&scope=daily`, { cache: "no-store", signal: controller.signal })
      .then(parse)
      .then(setHistoryData)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setHistoryError(caught instanceof Error ? caught.message : "讀取日期資料失敗");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [activeModal, historyData?.selectedDate, historyDate]);

  useEffect(() => {
    if (activeModal !== "coaches" || !overviewMonth) return;
    if (overviewData?.month === overviewMonth) return;
    const controller = new AbortController();
    const overviewDate = date.startsWith(`${overviewMonth}-`) ? date : `${overviewMonth}-01`;
    setOverviewLoading(true);
    setOverviewError("");
    void fetch(`/api/staff-performance?month=${overviewMonth}&date=${overviewDate}&scope=month`, { cache: "no-store", signal: controller.signal })
      .then(parse)
      .then(setOverviewData)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setOverviewError(caught instanceof Error ? caught.message : "讀取月份資料失敗");
      })
      .finally(() => {
        if (!controller.signal.aborted) setOverviewLoading(false);
      });
    return () => controller.abort();
  }, [activeModal, date, overviewData?.month, overviewMonth]);

  async function act(action: string, values: Record<string, unknown> = {}, success = "已完成") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const nextData = await parse(await fetch("/api/staff-performance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, month, date, scope: managerMode ? "daily" : "month", ...values }),
      }));
      setData((current) => current && current.selectedDate === nextData.selectedDate && !nextData.sessionEpoEvidence.length
        ? { ...nextData, sessionEpoEvidence: current.sessionEpoEvidence }
        : nextData);
      setNotice(success);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失敗");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const coachMap = useMemo(() => new Map((data?.coaches || []).map((coach) => [coach.id, coach])), [data?.coaches]);
  const coachName = (id: string | null) => {
    const coach = id ? coachMap.get(id) : null;
    return coachIdentityParts(coach).names.join("｜");
  };
  const dayEvents = (data?.events || []).filter((item) => item.business_date === date);
  const dayEpo = (data?.epoAwards || []).filter((item) => item.business_date === date);
  const dayReport = (data?.dailyReports || []).find((item) => item.business_date === date) || null;
  const reportConfirmed = dayReport?.status === "confirmed";
  const topStates = (data?.dailyTopStates || []).filter((item) => item.business_date === date || item.adjustment_business_date === date);
  const courseSummary = data?.courseSettlement?.summary || null;
  const selectedEvent = dayEvents.find((item) => item.id === selectedEventId) || null;
  const isToday = date === initialToday;
  const daySalesTotal = dayEvents.reduce((sum, event) => sum + Number(event.amount), 0);
  const allocatedSalesTotal = dayEvents.reduce((sum, event) => sum + event.allocations.reduce((allocationSum, allocation) => allocationSum + Number(allocation.amount), 0), 0);
  const allocationBase = dayEvents.reduce((sum, event) => sum + Math.abs(Number(event.amount)), 0);
  const unallocatedSalesTotal = dayEvents.reduce((sum, event) => {
    const allocated = event.allocations.reduce((allocationSum, allocation) => allocationSum + Number(allocation.amount), 0);
    return sum + Math.abs(Number(event.amount) - allocated);
  }, 0);
  const allocationProgress = allocationBase > 0 ? Math.max(0, Math.min(100, Math.round(((allocationBase - unallocatedSalesTotal) / allocationBase) * 100))) : 0;
  const pendingDayEvents = dayEvents.filter(eventNeedsAttention);
  const pendingSalesCount = pendingDayEvents.length;
  const pendingEpoCount = dayEpo.filter((item) => item.status === "assistant_proposed").length
    + topStates.filter((item) => item.status === "tie_pending" || item.status === "assistant_selected").length;
  const pendingCourseCount = courseSummary?.pending || 0;
  const attentionCount = pendingSalesCount + pendingEpoCount + pendingCourseCount;
  const assistantSalesBlockingCount = dayEvents.filter(eventNeedsAllocation).length;
  const assistantEpoBlockingCount = topStates.filter((item) => item.status === "tie_pending").length;
  const settlementAttentionCount = data?.actor.canConfirm
    ? attentionCount
    : assistantSalesBlockingCount + assistantEpoBlockingCount + pendingCourseCount;
  const salesTaskCount = data?.actor.canConfirm ? pendingSalesCount : assistantSalesBlockingCount;
  const epoTaskCount = data?.actor.canConfirm ? pendingEpoCount : assistantEpoBlockingCount;
  const salesTaskStatus = salesTaskCount ? `${salesTaskCount} 筆需要處理` : pendingSalesCount ? "已送經理覆核" : "已完成";
  const epoTaskStatus = epoTaskCount ? `${epoTaskCount} 項需要確認` : pendingEpoCount ? "已送經理覆核" : "已完成";
  const viewDataReady = data?.selectedDate === date && !loading;
  const sourceDataReady = viewDataReady && !refreshing && !refreshError;
  const activeTaskStep = reportConfirmed
    ? null
    : !viewDataReady || pendingCourseCount
      ? 1
      : !sourceDataReady || salesTaskCount
        ? 2
        : epoTaskCount
          ? 3
          : 4;
  const unavailableSourceLabel = refreshError ? "待重試" : refreshing ? "核對中…" : "讀取中…";
  const dayEpoTotal = dayEpo.reduce((sum, row) => sum + Number(row.quantity), 0);
  const actionableSalesEvents = dayEvents.filter((event) => data?.actor.canConfirm ? eventNeedsAttention(event) : eventNeedsAllocation(event));
  const completedSalesEvents = dayEvents.filter((event) => !actionableSalesEvents.some((pendingEvent) => pendingEvent.id === event.id));
  const visibleSalesEvents = salesListMode === "pending" ? actionableSalesEvents : completedSalesEvents;
  const selectedAllocatedTotal = selectedEvent?.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0) || 0;
  const draftAllocatedTotal = Object.values(allocationDraft).reduce((sum, value) => sum + Number(value || 0), 0);
  const selectedDisplayedAllocated = editingEventId === selectedEvent?.id ? draftAllocatedTotal : selectedAllocatedTotal;
  const selectedRemaining = selectedEvent ? Number(selectedEvent.amount) - selectedDisplayedAllocated : 0;
  const salesActionLabel = salesTaskCount
    ? data?.actor.canConfirm && !dayEvents.some(eventNeedsAllocation) && dayEvents.some((event) => event.status === "pending_manager")
      ? "覆核業績"
      : "處理業績"
    : "查看業績紀錄";

  const historyEvents = (historyData?.events || []).filter((item) => item.business_date === historyDate);
  const historyEpo = (historyData?.epoAwards || []).filter((item) => item.business_date === historyDate);
  const historyReport = (historyData?.dailyReports || []).find((item) => item.business_date === historyDate) || null;
  const historyCourseSummary = historyData?.courseSettlement?.summary || null;
  const historySalesTotal = historyEvents.reduce((sum, event) => sum + Number(event.amount), 0);
  const historyPendingSales = historyEvents.filter(eventNeedsAttention).length;
  const historyPendingEpo = historyEpo.filter((item) => item.status === "assistant_proposed").length
    + (historyData?.dailyTopStates || []).filter((item) => item.status === "tie_pending" || item.status === "assistant_selected").length;
  const monthOverview = overviewData?.month === overviewMonth ? overviewData : null;

  function changeStaffMonth(nextMonth: string) {
    setMonth(nextMonth);
    setDate(`${nextMonth}-01`);
  }

  function updateWorkbenchQuery(nextDate: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("month", nextDate.slice(0, 7));
    url.searchParams.set("date", nextDate);
    window.history.replaceState({}, "", url);
  }

  function selectWorkbenchDate(nextDate: string) {
    setMonth(nextDate.slice(0, 7));
    setDate(nextDate);
    updateWorkbenchQuery(nextDate);
    closeModal(true);
  }

  function openDateBrowser() {
    setHistoryDate(date);
    setHistoryData(data);
    setHistoryError("");
    setActiveModal("dates");
  }

  function openMonthOverview() {
    setOverviewMonth(month);
    setOverviewData(data?.scope === "month" ? data : null);
    setOverviewError("");
    setActiveModal("coaches");
  }

  async function reviewEvent(eventId: string, decision: "approve" | "reject") {
    let note = "";
    if (decision === "reject") {
      note = window.prompt("請填寫不列入業績／退回重分配的原因") || "";
      if (!note) return;
    }
    if (!window.confirm(decision === "approve" ? "確認此筆業績分配正確？" : "確認此筆不列入業績？")) return;
    const ok = await act("review_event", { eventId, decision, note }, decision === "approve" ? "業績已覆核" : "業績已標記不列入");
    if (ok && activeModal === "sales") advanceSalesWorkspace(eventId);
  }

  async function reviewEpo(epoId: string, decision: "approve" | "reject") {
    let note = "";
    if (decision === "reject") {
      note = window.prompt("請填寫駁回 EPO 的原因") || "";
      if (!note) return;
    }
    if (!window.confirm(decision === "approve" ? "確認給出這筆 EPO？" : "確認駁回這筆 EPO？")) return;
    await act("review_epo", { epoId, decision, note }, decision === "approve" ? "EPO 已覆核" : "EPO 已駁回");
  }

  async function addEpo() {
    if (!epoEmployeeId || !epoReason.trim()) return;
    const coach = coachMap.get(epoEmployeeId);
    if (!window.confirm(`確認給 ${coachName(epoEmployeeId)} ${epoQuantity} 個 EPO？\n原因：${epoReason}`)) return;
    const ok = await act("propose_epo", { employeeId: epoEmployeeId, quantity: epoQuantity, reason: epoReason }, data?.actor.canApprove ? "EPO 已加入，待今日報表再次確認" : "EPO 已送經理覆核");
    if (ok) {
      setEpoReason("");
      setEpoQuantity(1);
      if (coach) setEpoEmployeeId(coach.id);
    }
  }

  function beginAllocation(event: SalesEvent) {
    setEditingEventId(event.id);
    setAllocationDraft(Object.fromEntries(event.allocations.map((allocation) => [allocation.employee_id, String(allocation.amount)])));
  }

  function salesEventEditable(event: SalesEvent) {
    return Boolean(data?.actor.canAllocate) && !reportConfirmed && !["daily_confirmed", "ignored"].includes(event.status) && event.source_type !== "refund";
  }

  function selectSalesEvent(event: SalesEvent, startEditing = false, force = false) {
    if (!force && editingEventId && editingEventId !== event.id && !window.confirm("目前分配內容尚未儲存，確定切換到其他業績？")) return;
    setSelectedEventId(event.id);
    setEditingEventId(null);
    setAllocationDraft({});
    if (startEditing && eventNeedsAllocation(event) && salesEventEditable(event)) beginAllocation(event);
  }

  function switchSalesListMode(nextMode: SalesListMode) {
    const targetEvents = nextMode === "pending" ? actionableSalesEvents : completedSalesEvents;
    if (selectedEventId && targetEvents.some((event) => event.id === selectedEventId)) {
      setSalesListMode(nextMode);
      return;
    }
    if (editingEventId && !window.confirm("目前分配內容尚未儲存，確定切換到其他業績？")) return;
    setSalesListMode(nextMode);
    const firstEvent = targetEvents[0] || null;
    if (firstEvent) selectSalesEvent(firstEvent, nextMode === "pending", true);
    else {
      setSelectedEventId(null);
      setEditingEventId(null);
      setAllocationDraft({});
    }
  }

  function openSalesWorkspace() {
    const hasPending = actionableSalesEvents.length > 0;
    const firstEvent = (hasPending ? actionableSalesEvents : completedSalesEvents)[0] || null;
    setSalesListMode(hasPending ? "pending" : "completed");
    setShowSalesRules(false);
    setError("");
    setNotice("");
    setActiveModal("sales");
    if (firstEvent) selectSalesEvent(firstEvent, hasPending);
    else setSelectedEventId(null);
  }

  function advanceSalesWorkspace(currentEventId: string) {
    const nextEvent = actionableSalesEvents.find((event) => event.id !== currentEventId) || null;
    if (nextEvent) {
      setSalesListMode("pending");
      selectSalesEvent(nextEvent, true, true);
      return;
    }
    setSalesListMode("completed");
    setSelectedEventId(currentEventId);
    setEditingEventId(null);
    setAllocationDraft({});
  }

  function renderSalesQueueItem(event: SalesEvent) {
    const allocated = event.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0);
    const remaining = Number(event.amount) - allocated;
    const needsAttention = eventNeedsAttention(event);
    const actionStatus = eventNeedsAllocation(event) ? "待分配" : event.status === "pending_manager" && data?.actor.canConfirm ? "待覆核" : STATUS_LABELS[event.status] || event.status;
    return <button key={event.id} className={`${styles.salesQueueItem} ${selectedEventId === event.id ? styles.salesQueueItemSelected : ""} ${needsAttention ? styles.salesQueueItemPending : ""}`} type="button" aria-pressed={selectedEventId === event.id} onClick={() => selectSalesEvent(event, eventNeedsAllocation(event))}>
      <div className={styles.eventIdentity}>
        <div><span className={styles.sourceTag}>{SOURCE_LABELS[event.source_type] || event.source_type}</span><span className={needsAttention ? styles.attentionTag : styles.queueStatus}>{actionStatus}</span></div>
        <strong>{event.label}</strong>
        <small>原成交教練：<b className={styles.coachBilingualName}>{coachName(event.origin_employee_id)}</b></small>
        <small>{event.contract_sessions ? `${event.contract_sessions} 堂｜` : ""}{event.allocations.length ? `已分配 ${money(allocated)}` : "尚無分配"}</small>
      </div>
      <div className={styles.eventAllocation}>
        <strong className={event.amount < 0 ? styles.negative : ""}>{money(event.amount)}</strong>
        {event.source_type !== "refund" && Math.abs(remaining) > 0.001 ? <small className={styles.pending}>待分配 {money(remaining)}</small> : <small>{event.allocations.length ? `${event.allocations.length} 位教練` : "查看明細"}</small>}
      </div>
    </button>;
  }

  function settlementAction(compact = false) {
    if (!data) return null;
    const actionVerb = data.actor.canConfirm ? "結算" : "送經理";
    const blockReason = !viewDataReady
      ? `資料讀取完成後可${actionVerb}`
      : refreshing
        ? `核對最新資料後可${actionVerb}`
        : refreshError
          ? `重新核對資料後可${actionVerb}`
          : settlementAttentionCount
            ? `完成剩餘 ${settlementAttentionCount} 項後可${actionVerb}`
            : "";
    if (!data.actor.canConfirm && data.actor.canAllocate && !reportConfirmed) {
      return <button className={`${styles.primary} ${blockReason ? styles.settlementBlocked : ""} ${compact ? styles.compactAction : ""}`} type="button" disabled={busy || Boolean(blockReason)} title={blockReason || undefined} onClick={() => { if (window.confirm(`確認已整理 ${date} 的課程狀態、業績分配與 EPO，並送經理覆核？`)) void act("prepare_day", {}, "今日課程與業績已送經理覆核"); }}>{blockReason || "完成初審並送經理"}</button>;
    }
    if (data.actor.canConfirm && !reportConfirmed) {
      return <button className={`${styles.primary} ${blockReason ? styles.settlementBlocked : ""} ${compact ? styles.compactAction : ""}`} type="button" disabled={busy || Boolean(blockReason)} title={blockReason || undefined} onClick={() => { if (window.confirm(`正式結算 ${date} 的課程、業績與 EPO？完成後會計入教練面板與薪資。`)) void act("confirm_day", {}, "本日課程、業績與 EPO 已正式結算"); }}>{blockReason || (isToday ? "正式結算今日課程與業績" : "正式結算此日課程與業績")}</button>;
    }
    if (data.actor.canConfirm && reportConfirmed) {
      return <button className={compact ? styles.compactAction : ""} type="button" disabled={busy} onClick={() => { const reason = window.prompt("重新開啟原因（必填）"); if (reason && window.confirm("重新開啟後，本日課程、業績與 EPO 會暫時退出正式結算，確定繼續？")) void act("reopen_day", { reason }, "今日結算已重新開啟，可進行更正"); }}>重新開啟更正</button>;
    }
    return null;
  }

  async function saveAllocations(event: SalesEvent, advance = false) {
    const allocations = Object.entries(allocationDraft)
      .map(([employeeId, rawAmount]) => ({ employeeId, amount: Number(rawAmount) }))
      .filter((item) => Number.isFinite(item.amount) && item.amount > 0);
    const allocated = Math.round(allocations.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    const total = Math.round(Number(event.amount) * 100) / 100;
    if (allocated !== total) {
      setError(`分配總額必須等於 ${money(total)}，目前為 ${money(allocated)}，還差 ${money(total - allocated)}。`);
      return;
    }
    if (!window.confirm(`確認「${event.label}」分配如下？\n${allocations.map((item) => `${coachName(item.employeeId)}：${money(item.amount)}`).join("\n")}`)) return;
    const ok = await act("save_allocations", { eventId: event.id, allocations }, data?.actor.canApprove ? "分配已由經理直接核准" : "分配已送經理覆核");
    if (ok) {
      setEditingEventId(null);
      setAllocationDraft({});
      if (advance) advanceSalesWorkspace(event.id);
    }
  }

  const pageClassName = `${styles.page} ${managerMode ? styles.managerPage : ""}`.trim();
  if (loading && !data) return <main className={pageClassName}><div className={styles.empty}>正在開啟今日工作台…</div></main>;
  if (!data) return <main className={pageClassName}><div className={styles.loadFailure}><strong>{error || "今日工作台暫時無法開啟"}</strong><button type="button" onClick={() => void load()}>重新讀取</button></div></main>;
  const self = data?.coaches[0] || null;

  return (
    <main className={pageClassName}>
      {data?.actor.canManage ? <header className={styles.managerToolbar}>
        <Link className={styles.backLink} href="/manager/fitness">← 返回營運</Link>
        <details className={styles.moreMenu}>
          <summary>其他功能</summary>
          <nav>
            <Link href="/manager/staff-payroll">薪資試算</Link>
            <Link href="/manager/staff-scheduling">正／兼職設定</Link>
            <Link href="/manager/fitness">營運班表</Link>
          </nav>
        </details>
      </header> : <header className={styles.header}>
        <div>
          <p>巨挺健身館 · 教練個人專區</p>
          <h1>我的業績與課費</h1>
          <span>此頁只顯示您本人且已由經理正式結算的資料。</span>
        </div>
        <nav>
          <input type="month" value={month} onChange={(event) => changeStaffMonth(event.target.value)} />
          <Link href="/staff/payroll">我的薪資單</Link>
          <Link href="/staff/schedule">我的班表</Link>
        </nav>
      </header>}
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      {data?.actor.canManage ? (
        <>
          <section className={styles.workbenchHeader}>
            <div className={styles.workbenchTopline}>
              <div className={styles.dayHero}>
                <p>{isToday ? "今日工作台" : "歷史日結"}</p>
                <div className={styles.dayTitleLine}>
                  <h1>{dayLabel(date)}</h1>
                  <strong className={reportConfirmed ? styles.confirmed : styles.draft}>{reportConfirmed ? "已正式結算" : dayReport?.status === "reopened" ? "已重新開啟" : dayReport?.prepared_at ? "等待經理覆核" : "尚未結算"}</strong>
                </div>
                {refreshing ? <div className={`${styles.syncStatus} ${styles.syncChecking}`} role="status" aria-live="polite"><i aria-hidden="true" /><span><strong>正在核對最新收款與 EPO</strong><small>完成前不顯示業績與 EPO 數字</small></span></div> : refreshError ? <button className={styles.syncRetry} type="button" onClick={() => void refreshSources(data, `${month}:${date}`, true)}><strong>最新資料核對失敗</strong><small>{refreshError}｜點此重試</small></button> : <div className={`${styles.syncStatus} ${styles.syncComplete}`} role="status"><i aria-hidden="true">✓</i><span><strong>最新收款與 EPO 已核對</strong></span></div>}
                {!isToday ? <button className={styles.historyReturn} type="button" onClick={() => selectWorkbenchDate(initialToday)}>回到今天</button> : null}
              </div>
              <div className={styles.workbenchActions}>
                <button type="button" onClick={openDateBrowser}>查看其他日期</button>
                <button type="button" onClick={openMonthOverview}>本月總覽</button>
              </div>
            </div>
            <div className={styles.summaryGrid}>
              <article className={!sourceDataReady ? styles.summaryChecking : settlementAttentionCount ? styles.summaryPending : styles.summaryReady}><span>待處理</span><strong>{sourceDataReady ? `${settlementAttentionCount} 項` : unavailableSourceLabel}</strong><small>{sourceDataReady ? `課程 ${pendingCourseCount} · 業績 ${salesTaskCount} · EPO ${epoTaskCount}` : viewDataReady ? `課程 ${pendingCourseCount} · 業績與 EPO 尚未顯示` : "正在讀取本日資料"}</small></article>
              <article className={`${styles.summaryCourse} ${!viewDataReady ? styles.summaryChecking : pendingCourseCount ? styles.summaryPending : styles.summaryReady}`}><span>課程</span><strong>{viewDataReady ? `${courseSummary?.completed || 0}／${courseSummary?.total || 0} 堂` : "讀取中…"}</strong><small>{viewDataReady ? pendingCourseCount ? `${pendingCourseCount} 堂待處理` : "課程狀態已完成" : "正在讀取課程資料"}</small></article>
              <article className={`${styles.summaryRevenue} ${!sourceDataReady ? styles.summaryChecking : ""}`}><span>實收</span><strong className={sourceDataReady && daySalesTotal < 0 ? styles.negative : ""}>{sourceDataReady ? money(daySalesTotal) : unavailableSourceLabel}</strong><small>{sourceDataReady ? "最新核對結果" : "暫不顯示舊數字"}</small></article>
              <article className={`${styles.summaryEpo} ${!sourceDataReady ? styles.summaryChecking : ""}`}><span>EPO</span><strong>{sourceDataReady ? dayEpoTotal : unavailableSourceLabel}</strong><small>{sourceDataReady ? "最新核對結果" : "暫不顯示舊數字"}</small></article>
            </div>
          </section>

          <section className={styles.workbenchGrid}>
            <div className={styles.mainColumn}>
              <section className={`${styles.panel} ${styles.taskPanel}`}>
                <div className={styles.panelHeading}>
                  <div><p className={styles.eyebrow}>本日流程</p><h2>{reportConfirmed ? "本日已完成" : !sourceDataReady ? "正在整理本日待辦" : settlementAttentionCount ? `還有 ${settlementAttentionCount} 項待處理` : data.actor.canConfirm ? "可以進行正式結算" : "可以送交經理覆核"}</h2></div>
                </div>
                <div className={styles.taskList}>
                  <article className={`${!viewDataReady ? styles.taskChecking : pendingCourseCount ? styles.taskPending : styles.taskReady} ${activeTaskStep === 1 ? styles.taskCurrent : ""}`} aria-current={activeTaskStep === 1 ? "step" : undefined}>
                    <b className={styles.taskStepNumber}>{viewDataReady && !pendingCourseCount ? "✓" : "1"}</b>
                    <div><strong>課程狀態</strong><span>{viewDataReady ? pendingCourseCount ? `${pendingCourseCount} 堂尚未完成` : "已完成" : "正在讀取課程資料"}</span></div>
                    {!viewDataReady ? <span className={styles.taskWaiting}>讀取中</span> : pendingCourseCount ? <Link className={styles.taskPrimaryAction} href="/manager/fitness">前往班表</Link> : <span className={styles.taskDone}>完成</span>}
                  </article>
                  <article className={`${!sourceDataReady ? styles.taskChecking : salesTaskCount ? styles.taskPending : styles.taskReady} ${activeTaskStep === 2 ? styles.taskCurrent : ""}`} aria-current={activeTaskStep === 2 ? "step" : undefined}>
                    <b className={styles.taskStepNumber}>{sourceDataReady && !salesTaskCount ? "✓" : "2"}</b>
                    <div><strong>業績分配</strong><span>{sourceDataReady ? salesTaskStatus : refreshError ? "最新資料核對失敗" : "正在核對最新收款"}</span></div>
                    <button className={sourceDataReady && salesTaskCount ? styles.taskPrimaryAction : styles.taskSecondaryAction} type="button" disabled={!sourceDataReady} onClick={openSalesWorkspace}>{!sourceDataReady ? refreshError ? "請先重試" : "核對中" : salesActionLabel}</button>
                  </article>
                  <article className={`${!sourceDataReady ? styles.taskChecking : epoTaskCount ? styles.taskPending : styles.taskReady} ${activeTaskStep === 3 ? styles.taskCurrent : ""}`} aria-current={activeTaskStep === 3 ? "step" : undefined}>
                    <b className={styles.taskStepNumber}>{sourceDataReady && !epoTaskCount ? "✓" : "3"}</b>
                    <div><strong>EPO 判定</strong><span>{sourceDataReady ? epoTaskStatus : refreshError ? "最新資料核對失敗" : "正在核對最新 EPO"}</span></div>
                    <button className={sourceDataReady && epoTaskCount ? styles.taskPrimaryAction : styles.taskSecondaryAction} type="button" disabled={!sourceDataReady} onClick={() => setActiveModal("epo")}>{!sourceDataReady ? refreshError ? "請先重試" : "核對中" : epoTaskCount ? "處理 EPO" : "查看紀錄"}</button>
                  </article>
                  <article className={`${reportConfirmed ? styles.taskReady : !sourceDataReady ? styles.taskChecking : settlementAttentionCount ? styles.taskPending : styles.taskReady} ${activeTaskStep === 4 ? styles.taskCurrent : ""}`} aria-current={activeTaskStep === 4 ? "step" : undefined}>
                    <b className={styles.taskStepNumber}>{reportConfirmed ? "✓" : "4"}</b>
                    <div><strong>{data.actor.canConfirm ? "正式結算" : "送交覆核"}</strong><span>{reportConfirmed ? "已正式結算" : !sourceDataReady ? refreshError ? "重新核對資料後才能繼續" : "等待最新資料核對完成" : settlementAttentionCount ? `完成剩餘 ${settlementAttentionCount} 項後才能繼續` : "所有前置項目已完成"}</span></div>
                    {settlementAction()}
                  </article>
                </div>
              </section>

              <section className={`${styles.panel} ${styles.dailyCoachPanel}`}>
                <div className={`${styles.panelHeading} ${styles.dailyCoachHeading}`}>
                  <div><h2>{isToday ? "今日上班教練" : `${date} 上班教練`}</h2></div>
                  <div className={styles.headingActions}><span>{data.dailyCoachSummaries.length} 人</span></div>
                </div>
                {!viewDataReady ? <div className={styles.empty}>正在讀取當日教練資料…</div> : data.dailyCoachSummaries.length ? <>
                  <div className={styles.dailyCoachTableHeader} aria-hidden="true">
                    <span>教練</span><span>完成／排課（堂）</span><span>正式課完成</span><span>FA 完成</span><span>FA 預約成功</span><span>BB</span><span>當日業績</span>
                  </div>
                  <div className={styles.dailyCoachList}>{data.dailyCoachSummaries.map((coach) => <article key={coach.employeeId}>
                    <div className={styles.dailyCoachIdentity}><CoachIdentityPresentation coach={coachMap.get(coach.employeeId)} />{coach.shiftLabel ? <span className={styles.shiftBadge}>{coach.shiftLabel}</span> : null}</div>
                    <div className={`${styles.dailyCoachCourse} ${coach.completedSessions === 0 ? styles.zeroMetric : ""}`}><strong>{coach.completedSessions}<span>／{coach.scheduledSessions}</span></strong>{coach.pendingSessions ? <small>{coach.pendingSessions} 堂待處理</small> : null}</div>
                    <div className={styles.dailyCoachMetric}><label>正式課完成</label><MetricBreakdown items={coach.formalCourseCounts || []} /></div>
                    <div className={styles.dailyCoachMetric}><label>FA 完成</label><MetricBreakdown items={coach.faExecutionCounts || []} /></div>
                    <div className={`${styles.dailyCoachSingleMetric} ${coach.successfulFaAppointments === 0 ? styles.zeroMetric : ""}`}><label>FA 預約成功</label><strong>{coach.successfulFaAppointments}</strong></div>
                    <div className={`${styles.dailyCoachSingleMetric} ${coach.bbConversions === 0 && coach.bbVisits === 0 ? styles.zeroMetric : ""}`}><label>BB</label><strong>{coach.bbConversions}<span>／{coach.bbVisits}</span></strong><small>成交／回訪</small></div>
                    <div className={`${styles.dailyCoachSales} ${coach.salesAmount > 0 ? styles.salesPositive : coach.salesAmount === 0 ? styles.zeroMetric : ""}`}><label>當日業績</label>{sourceDataReady ? <><strong className={coach.salesAmount < 0 ? styles.negative : ""}>{money(coach.salesAmount)}</strong>{coach.salesNeedsConfirmation ? <small>待確認</small> : null}</> : <strong className={styles.inlineChecking}>{unavailableSourceLabel}</strong>}</div>
                  </article>)}</div>
                  {data.successfulFaAppointments?.otherBookers.length ? <div className={styles.otherAppointmentBookers}><strong>其他預約人員</strong><MetricBreakdown items={data.successfulFaAppointments.otherBookers} /></div> : null}
                </> : <div className={styles.empty}>這一天沒有教練上班，請確認日排課表。</div>}
              </section>

            </div>
          </section>

          <div className={styles.mobileSettlementBar}>{settlementAction(true)}</div>

          {activeModal ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) closeModal(); }}>
            <section className={`${styles.modal} ${activeModal === "sales" ? styles.salesModal : ""}`} role="dialog" aria-modal="true" aria-labelledby="performance-modal-title">
              <header className={`${styles.modalHeader} ${activeModal === "sales" ? styles.salesModalHeader : ""}`}>
                <div><p>{activeModal === "coaches" ? monthLabel(overviewMonth) : activeModal === "dates" ? historyDate : activeModal === "sales" ? `${date}｜待處理 ${actionableSalesEvents.length} 筆` : date}</p><h2 id="performance-modal-title">{activeModal === "coaches" ? "本月總覽" : activeModal === "dates" ? "查看其他日期" : activeModal === "epo" ? "EPO 判定與紀錄" : "業績分配"}</h2></div>
                {activeModal === "sales" ? <div className={styles.salesModalHeaderActions}><button type="button" aria-expanded={showSalesRules} onClick={() => setShowSalesRules((current) => !current)}>{showSalesRules ? "收起規則" : "分配規則"}</button><button type="button" aria-label="關閉視窗" onClick={() => closeModal()}>×</button></div> : activeModal === "epo" ? <div className={styles.epoModalHeaderActions}><button type="button" aria-expanded={showEpoRules} aria-controls="epo-rules-panel" onClick={() => setShowEpoRules((current) => !current)}>{showEpoRules ? "收起規則" : "EPO 規則"}</button><button type="button" aria-label="關閉視窗" onClick={() => closeModal()}>×</button></div> : <button type="button" aria-label="關閉視窗" onClick={() => closeModal()}>×</button>}
              </header>
              <div className={`${styles.modalBody} ${activeModal === "sales" ? styles.salesModalBody : ""}`}>
                {activeModal === "coaches" ? <div className={styles.monthOverview}>
                  <div className={styles.monthOverviewToolbar}>
                    <label htmlFor="overview-month">月份</label>
                    <input id="overview-month" type="month" value={overviewMonth} onChange={(event) => { setOverviewMonth(event.target.value); setOverviewData(null); }} />
                    {overviewLoading ? <span>讀取中…</span> : monthOverview ? <strong>{monthOverview.coaches.length} 位教練</strong> : null}
                  </div>
                  {overviewError ? <div className={styles.error}>{overviewError}</div> : null}
                  {!monthOverview && overviewLoading ? <div className={styles.empty}>正在整理本月績效…</div> : null}
                  {monthOverview ? <>
                    <div className={styles.coachOverviewList}>{monthOverview.coaches.map((coach) => <article key={coach.id}>
                      <div className={styles.coachOverviewTopline}>
                        <div className={styles.coachIdentity}><CoachIdentityPresentation coach={coach} /><small>{!coach.employment_configured ? "正／兼職待設定" : coach.employment_type === "part_time" ? "兼職" : "正職"}</small></div>
                        {coach.projectedSales !== coach.confirmedSales || coach.projectedEpo !== coach.confirmedEpo ? <small className={styles.pending}>含未結算業績／EPO</small> : <small className={styles.confirmedText}>已正式結算</small>}
                      </div>
                      <dl className={styles.coachOverviewPrimary}><div><dt>本月業績</dt><dd>{money(coach.projectedSales)}</dd></div><div><dt>本月 EPO</dt><dd>{coach.projectedEpo}</dd></div><div><dt>本月已完正式課</dt><dd>{coach.completedSessions} 堂</dd></div><div><dt>本月堂費級距</dt><dd>{coach.employment_configured ? `${money(coach.sessionRate)}／堂` : "待設定"}</dd></div></dl>
                      <div className={styles.coachOverviewDetails}>
                        <section><label>正式課完成</label><MetricBreakdown items={coach.formalCourseCounts || []} /></section>
                        <section><label>FA 完成</label><MetricBreakdown items={coach.faExecutionCounts || []} /></section>
                        <section className={styles.faConversionMetric}><label>FA1／FA2 成交率</label><strong>{coach.faConversionRate == null ? "—" : `${coach.faConversionRate}%`}</strong><small>成交 {coach.faConverted}・未成交 {coach.faNotConverted}・待判定 {coach.faPending}</small></section>
                        <section className={styles.singleOverviewMetric}><label>FA 預約成功</label><strong>{coach.successfulFaAppointments}</strong></section>
                        <section className={styles.singleOverviewMetric}><label>BB 回訪／成交</label><strong>{coach.bbVisits}<span>／{coach.bbConversions}</span></strong><small>回訪／成交；不計 FA 率與 EPO</small></section>
                      </div>
                    </article>)}</div>
                    {monthOverview.successfulFaAppointments?.otherBookers.length ? <section className={styles.monthOtherBookers}><div><strong>其他預約人員</strong><small>櫃台或非上班教練建立的成功 FA 預約</small></div><MetricBreakdown items={monthOverview.successfulFaAppointments.otherBookers} /></section> : null}
                  </> : null}
                </div> : null}

                {activeModal === "dates" ? <div className={styles.dateBrowser}>
                  <div className={styles.dateNavigator}>
                    <button type="button" aria-label="前一天" onClick={() => { setHistoryData(null); setHistoryDate((current) => shiftDate(current, -1)); }}>‹</button>
                    <input aria-label="查看日期" type="date" value={historyDate} onChange={(event) => { setHistoryData(null); setHistoryDate(event.target.value); }} />
                    <button type="button" aria-label="後一天" onClick={() => { setHistoryData(null); setHistoryDate((current) => shiftDate(current, 1)); }}>›</button>
                  </div>
                  {historyError ? <div className={styles.error}>{historyError}</div> : null}
                  {historyLoading && historyData?.selectedDate !== historyDate ? <div className={styles.empty}>正在整理 {historyDate}…</div> : null}
                  {historyData?.selectedDate === historyDate ? <>
                    <div className={styles.historyStatusLine}>
                      <div><strong>{dayLabel(historyDate)}</strong><span>{historyReport?.status === "confirmed" ? "已正式結算" : historyReport?.status === "reopened" ? "已重新開啟" : historyReport?.prepared_at ? "等待經理覆核" : "尚未結算"}</span></div>
                      {historyDate === initialToday ? <b>今天</b> : null}
                    </div>
                    <div className={styles.historyPreviewGrid}>
                      <article><span>待處理</span><strong>{(historyCourseSummary?.pending || 0) + historyPendingSales + historyPendingEpo} 項</strong></article>
                      <article><span>課程</span><strong>{historyCourseSummary?.completed || 0}／{historyCourseSummary?.total || 0} 堂</strong></article>
                      <article><span>實收</span><strong className={historySalesTotal < 0 ? styles.negative : ""}>{money(historySalesTotal)}</strong></article>
                      <article><span>EPO</span><strong>{historyEpo.reduce((sum, row) => sum + Number(row.quantity), 0)}</strong></article>
                    </div>
                    <section className={styles.historySection}>
                      <div><h3>上班教練</h3><span>{historyData.dailyCoachSummaries.length} 人</span></div>
                      {historyData.dailyCoachSummaries.length ? <div className={styles.historyCoachList}>{historyData.dailyCoachSummaries.map((coach) => <article key={coach.employeeId}><span className={styles.historyCoachIdentity}><CoachIdentityPresentation compact coach={historyData.coaches.find((item) => item.id === coach.employeeId)} /></span><span>{coach.completedSessions}／{coach.scheduledSessions} 堂</span><b>{money(coach.salesAmount)}</b></article>)}</div> : <p>沒有上班教練</p>}
                    </section>
                    <section className={styles.historySection}>
                      <div><h3>實收紀錄</h3><span>{historyEvents.length} 筆</span></div>
                      {historyEvents.length ? <div className={styles.historyRecordList}>{historyEvents.map((event) => <article key={event.id}><div><strong>{event.label}</strong><span>{STATUS_LABELS[event.status] || event.status}</span></div><b className={event.amount < 0 ? styles.negative : ""}>{money(event.amount)}</b></article>)}</div> : <p>沒有收款或退款紀錄</p>}
                    </section>
                    <div className={styles.dateBrowserActions}><button className={styles.primary} type="button" onClick={() => selectWorkbenchDate(historyDate)}>{historyDate === initialToday ? "回到今日工作台" : "進入該日日結"}</button></div>
                  </> : null}
                </div> : null}

                {activeModal === "sales" ? <div className={styles.salesWorkspace}>
                  <div className={styles.salesProgressSummary}>
                    <div><span>實收淨額</span><strong className={daySalesTotal < 0 ? styles.negative : ""}>{money(daySalesTotal)}</strong></div>
                    <div><span>已分配</span><strong className={allocatedSalesTotal < 0 ? styles.negative : ""}>{money(allocatedSalesTotal)}</strong></div>
                    <div><span>尚未分配</span><strong className={unallocatedSalesTotal > 0 ? styles.pendingAmount : ""}>{money(unallocatedSalesTotal)}</strong></div>
                    <div className={styles.allocationProgress}><span><b>分配進度</b><strong>{allocationProgress}%</strong></span><progress max="100" value={allocationProgress} aria-label={`業績分配進度 ${allocationProgress}%`} /></div>
                  </div>
                  {error ? <div className={styles.salesWorkspaceMessage}><span className={styles.error}>{error}</span></div> : notice ? <div className={styles.salesWorkspaceMessage}><span className={styles.notice}>{notice}</span></div> : null}
                  {showSalesRules ? <div className={styles.salesRulesPanel}><article><strong>FA／續約</strong><span>原成交教練預設取得 50%，完成分配後由副理送經理覆核，經理可直接核准。</span></article><article><strong>退款扣回</strong><span>退款只能依原正式分配扣回，不可改配給其他教練。</span></article></div> : null}
                  <div className={styles.salesWorkspaceGrid}>
                    <aside className={styles.salesQueue} aria-label="業績收款清單">
                      <div className={styles.salesQueueTabs} role="tablist" aria-label="業績狀態">
                        <button className={salesListMode === "pending" ? styles.salesQueueTabActive : ""} type="button" role="tab" aria-selected={salesListMode === "pending"} onClick={() => switchSalesListMode("pending")}>待處理 <b>{actionableSalesEvents.length}</b></button>
                        <button className={salesListMode === "completed" ? styles.salesQueueTabActive : ""} type="button" role="tab" aria-selected={salesListMode === "completed"} onClick={() => switchSalesListMode("completed")}>已完成／待覆核 <b>{completedSalesEvents.length}</b></button>
                      </div>
                      <div className={styles.salesQueueList}>{visibleSalesEvents.length ? visibleSalesEvents.map(renderSalesQueueItem) : <div className={styles.salesQueueEmpty}>{salesListMode === "pending" ? "目前沒有待處理業績" : "目前沒有其他業績紀錄"}</div>}</div>
                    </aside>
                    <section className={styles.salesDetail} aria-label="業績分配內容">
                      {selectedEvent ? <>
                        <header className={styles.selectedEventHeader}>
                          <div><div><span className={styles.sourceTag}>{SOURCE_LABELS[selectedEvent.source_type] || selectedEvent.source_type}</span><span className={eventNeedsAttention(selectedEvent) ? styles.attentionTag : styles.queueStatus}>{STATUS_LABELS[selectedEvent.status] || selectedEvent.status}</span></div><h3>{selectedEvent.label}</h3><small>{selectedEvent.contract_sessions ? `${selectedEvent.contract_sessions} 堂課程` : "收款紀錄"}</small></div>
                          <div><span>實收金額</span><strong className={selectedEvent.amount < 0 ? styles.negative : ""}>{money(selectedEvent.amount)}</strong></div>
                        </header>
                        <div className={styles.selectedAllocationSummary}>
                          <article><span>已分配</span><strong>{money(selectedDisplayedAllocated)}</strong></article>
                          <article className={Math.abs(selectedRemaining) > 0.001 ? styles.selectedAllocationPending : ""}><span>尚未分配</span><strong>{money(selectedRemaining)}</strong></article>
                        </div>
                        <div className={styles.salesEditorHeading}><strong>{editingEventId === selectedEvent.id ? "分配給教練" : "分配明細"}</strong><span>{editingEventId === selectedEvent.id ? "輸入各教練分配金額，合計必須等於實收金額。" : selectedEvent.allocations.length ? `${selectedEvent.allocations.length} 位教練` : "尚未建立分配"}</span></div>
                        {editingEventId === selectedEvent.id ? <div className={styles.allocationEditor}>
                          {data.coaches.map((coach) => <label key={coach.id}><span><span className={styles.coachBilingualName}>{coachName(coach.id)}</span>{selectedEvent.origin_employee_id === coach.id ? <b>原成交</b> : null}</span><div><span>NT$</span><input type="number" min="0" step="1" value={allocationDraft[coach.id] || ""} onChange={(change) => setAllocationDraft((current) => ({ ...current, [coach.id]: change.target.value }))} placeholder="0" /></div></label>)}
                        </div> : selectedEvent.allocations.length ? <div className={styles.allocationList}>{selectedEvent.allocations.map((allocation) => <span key={allocation.id}><b className={styles.coachBilingualName}>{coachName(allocation.employee_id)}</b><span>{money(allocation.amount)}{allocation.allocation_kind === "origin_default" ? "（預設 50%）" : allocation.allocation_kind === "refund_reversal" ? "（原分配扣回）" : ""}</span></span>)}</div> : <div className={styles.empty}>這筆業績尚未分配。</div>}
                        {selectedEvent.source_type === "refund" ? <div className={styles.infoBox}>退款分配已鎖定，只能按原正式分配扣回，不可改給其他人。</div> : selectedEvent.allocation_note ? <div className={styles.infoBox}>{selectedEvent.allocation_note}</div> : null}
                        {selectedEvent.review_note ? <div className={styles.infoBox}>覆核備註：{selectedEvent.review_note}</div> : null}
                      </> : <div className={styles.salesDetailEmpty}><strong>這一天沒有業績紀錄</strong><span>有新收款或退款後會出現在這裡。</span></div>}
                    </section>
                  </div>
                </div> : null}

                {activeModal === "epo" ? <div className={styles.epoWorkspace}>
                  {showEpoRules ? <div id="epo-rules-panel" className={styles.epoRules}>
                    <p className={styles.epoRulesLead}>符合下列任一條件，即可依該項規則獲得 EPO。</p>
                    <div className={styles.epoRuleGrid}>
                      <article>
                        <div className={styles.epoRuleHeading}><span>01</span><h3>每日數字最高</h3><b>＋1 EPO</b></div>
                        <p>當日數字排名第一，且當日開單合計達 <b>24 堂以上</b>、成交金額合計達 <b>NT$38,112 以上</b>，方可獲得；多張開單可合併計算。</p>
                      </article>
                      <article>
                        <div className={styles.epoRuleHeading}><span>02</span><h3>額外上課達標</h3><b>＋1 EPO</b></div>
                        <div className={styles.epoRuleRows}>
                          <div><strong>正職</strong><p>上班時間內滿 <b>6 堂</b>，且上班時間外再滿 <b>2 堂</b></p></div>
                          <div><strong>兼職</strong><p>上班時間內滿 <b>3 堂</b>，且上班時間外再滿 <b>1 堂</b></p></div>
                        </div>
                      </article>
                      <article>
                        <div className={styles.epoRuleHeading}><span>03</span><h3>證照獎勵</h3><b>＋2 EPO</b></div>
                        <p>自第 <b>6 張證照</b>起，每新增取得 1 張證照即可獲得。</p>
                      </article>
                      <article>
                        <div className={styles.epoRuleHeading}><span>04</span><h3>主動學習</h3><b>＋1 EPO</b></div>
                        <p>下班後主動找主管進行學習／訓練。</p>
                      </article>
                      <article>
                        <div className={styles.epoRuleHeading}><span>05</span><h3>高堂數成交</h3><b>各＋1 EPO</b></div>
                        <div className={styles.epoRuleRows}>
                          <div><strong>新單</strong><p>成交 <b>72 堂以上</b></p></div>
                          <div><strong>續約</strong><p>成交 <b>48 堂以上</b></p></div>
                        </div>
                      </article>
                      <article>
                        <div className={styles.epoRuleHeading}><span>06</span><h3>FA2 成交獎勵</h3><b>＋1 EPO</b></div>
                        <p>FA1 階段有經過主管級 To，並於 FA2 成交。</p>
                        <small>須有明確的主管級 To 紀錄才列入計算。</small>
                      </article>
                    </div>
                  </div> : null}
                  <div className={styles.modalIntro}><div><strong>本日共 {dayEpo.reduce((sum, row) => sum + Number(row.quantity), 0)} EPO</strong><small>{pendingEpoCount ? `尚有 ${pendingEpoCount} 項需要確認` : "目前沒有待確認項目"}</small></div>{data.actor.canManageEpo && !reportConfirmed ? <button type="button" onClick={() => setShowEpoForm((current) => !current)}>{showEpoForm ? "收起新增表單" : "＋新增人工 EPO"}</button> : null}</div>
                  {showEpoForm && data.actor.canManageEpo && !reportConfirmed ? <div className={styles.epoForm}>
                    <select value={epoEmployeeId} onChange={(event) => setEpoEmployeeId(event.target.value)}><option value="">選擇教練</option>{data.coaches.map((coach) => <option key={coach.id} value={coach.id}>{coachName(coach.id)}</option>)}</select>
                    <input type="number" min="1" max="100" value={epoQuantity} onChange={(event) => setEpoQuantity(Number(event.target.value))} aria-label="EPO 數量" />
                    <input value={epoReason} onChange={(event) => setEpoReason(event.target.value)} placeholder="符合 EPO 的原因（必填）" />
                    <button className={styles.primary} disabled={busy || !epoEmployeeId || !epoReason.trim()} onClick={() => void addEpo()}>加入 EPO</button>
                  </div> : null}

                  {topStates.length ? <details className={styles.detailGroup} open={topStates.some((top) => top.status === "tie_pending" || top.status === "assistant_selected")}><summary><span><b>每日數字最高</b><small>依分配前當日實收排名，並須達 24 堂／NT$38,112</small></span><strong>{topStates.length} 筆</strong></summary><div className={styles.decisionList}>{topStates.map((top) => <article key={top.id}>
                    <div><strong>{top.business_date}｜最高實收 {money(top.top_amount)}</strong><small>{top.adjustment_business_date !== top.business_date ? `本次因 ${top.adjustment_business_date} 退款重算` : "依原始成交數字計算"}</small></div>
                    <div className={styles.candidates}>{top.candidate_employee_ids.length ? top.candidate_employee_ids.map((employeeId) => {
                      const selected = top.selected_employee_id === employeeId;
                      const canChoose = data.actor.canManageEpo && !reportConfirmed && (top.status === "tie_pending" || data.actor.canApprove);
                      return <button key={employeeId} className={selected ? styles.primary : ""} disabled={busy || !canChoose} onClick={() => { if (window.confirm(`確認選擇 ${coachName(employeeId)} 取得 ${top.business_date} 每日最高 1 EPO？`)) void act("select_daily_top", { originalBusinessDate: top.business_date, employeeId }, data.actor.canApprove ? "每日最高 EPO 已由經理決定" : "每日最高 EPO 已送經理覆核"); }}>{coachName(employeeId)}{selected ? " ✓" : ""}</button>;
                    }) : <span>{top.top_amount > 0 ? "當日最高者未達 24 堂／NT$38,112 雙門檻" : "當日沒有符合的實收資料"}</span>}</div>
                    <span className={styles.status}>{top.status === "tie_pending" ? "同額待決定" : top.status === "assistant_selected" ? "副理已選，待經理" : top.status === "manager_selected" ? "經理已決定" : top.status === "auto_selected" ? "單獨第一，自動取得" : "無得主"}</span>
                  </article>)}</div></details> : null}

                  {(data.sessionEpoEvidence || []).length ? <details className={styles.detailGroup} open={data.sessionEpoEvidence.some((item) => item.eligible)}><summary><span><b>班內／班外堂數</b><small>只計完成的正式 PT</small></span><strong>{data.sessionEpoEvidence.filter((item) => item.eligible).length} 人達標</strong></summary><div className={styles.evidenceGrid}>{data.sessionEpoEvidence.map((item) => <article key={item.employeeId} className={item.eligible ? styles.eligible : ""}>
                    <strong>{coachName(item.employeeId)}</strong><span>{item.employmentType === "part_time" ? "兼職" : "正職"}｜班內 {item.inside}/{item.requiredInside}｜班外 {item.outside}/{item.requiredOutside}</span><small>{!item.scheduleReady ? "尚無已發布班表，暫不判定" : item.boundary ? `另有 ${item.boundary} 堂跨越班界，不計入班內外` : item.eligible ? "已符合 1 EPO" : "尚未達標"}</small>
                  </article>)}</div></details> : null}

                  <details className={styles.detailGroup} open><summary><span><b>本日 EPO 紀錄</b><small>包含自動、人工、追回與重算</small></span><strong>{dayEpo.length} 筆</strong></summary>{dayEpo.length ? <div className={styles.epoList}>{dayEpo.map((epo) => <article key={epo.id}>
                    <div><strong className={epo.quantity < 0 ? styles.negative : ""}>{coachName(epo.employee_id)} {epo.quantity > 0 ? "+" : ""}{epo.quantity} EPO</strong><p>{epo.reason}</p><small>{EPO_TYPE_LABELS[epo.award_type] || epo.award_type}</small>{epo.review_note ? <small>{epo.review_note}</small> : null}</div>
                    <span>{STATUS_LABELS[epo.status] || epo.status}</span>
                    {data.actor.canApprove && epo.status === "assistant_proposed" && !reportConfirmed ? <div className={styles.rowActions}><button className={styles.primary} disabled={busy} onClick={() => void reviewEpo(epo.id, "approve")}>同意</button><button disabled={busy} onClick={() => void reviewEpo(epo.id, "reject")}>駁回</button></div> : null}
                  </article>)}</div> : <div className={styles.empty}>本日尚未登記 EPO。</div>}</details>
                </div> : null}
              </div>

              {activeModal === "sales" ? <footer className={`${styles.modalFooter} ${styles.salesModalFooter}`}>
                <div className={styles.salesFooterStatus}>{selectedEvent ? <><span>{editingEventId === selectedEvent.id ? "目前這筆" : STATUS_LABELS[selectedEvent.status] || selectedEvent.status}</span><strong className={Math.abs(selectedRemaining) > 0.001 ? styles.pending : ""}>{Math.abs(selectedRemaining) > 0.001 ? `尚有 ${money(selectedRemaining)} 待分配` : "分配金額已完整"}</strong></> : <strong>這一天沒有業績紀錄</strong>}</div>
                <div className={styles.salesFooterActions}>
                  <button type="button" onClick={() => closeModal()}>關閉</button>
                  {selectedEvent && editingEventId === selectedEvent.id ? <><button type="button" disabled={busy} onClick={() => { setEditingEventId(null); setAllocationDraft({}); }}>取消調整</button><button className={styles.primary} type="button" disabled={busy || Math.abs(selectedRemaining) > 0.001} onClick={() => void saveAllocations(selectedEvent, true)}>{actionableSalesEvents.some((event) => event.id !== selectedEvent.id) ? "儲存並處理下一筆" : "儲存並完成"}</button></> : selectedEvent ? <>
                    {salesEventEditable(selectedEvent) ? <button type="button" disabled={busy} onClick={() => beginAllocation(selectedEvent)}>{selectedEvent.allocations.length ? "調整分配" : "開始分配"}</button> : null}
                    {data.actor.canApprove && selectedEvent.status === "pending_manager" && !reportConfirmed ? <><button type="button" disabled={busy} onClick={() => void reviewEvent(selectedEvent.id, "reject")}>駁回</button><button className={styles.primary} type="button" disabled={busy} onClick={() => void reviewEvent(selectedEvent.id, "approve")}>同意分配</button></> : null}
                  </> : null}
                </div>
              </footer> : null}
            </section>
          </div> : null}
        </>
      ) : self ? (
        <>
          <section className={styles.selfHero}>
            <div><span>{month} 已確認業績</span><strong>{money(self.confirmedSales)}</strong><small>退款已按退款日期扣在本月</small></div>
            <div><span>本月已確認 EPO</span><strong>{self.confirmedEpo}</strong><small>只顯示經理已確認的 EPO</small></div>
            <div><span>本月已完課</span><strong>{self.completedSessions} 堂</strong><small>完成狀態的 PT 課程</small></div>
            <div><span>本月堂費級距</span><strong>{self.employment_configured ? money(self.sessionRate) : "待主管設定"}</strong><small>{self.employment_configured ? `本月預估課費 ${money(self.courseFeeAmount)}` : "尚未設定正職或兼職，不會猜測堂費"}</small></div>
          </section>
          <section className={styles.target}>
            <h2>{!self.employment_configured ? "請主管先設定正職／兼職" : self.nextTier ? `下一級：每堂 ${money(self.nextTier.sessionRate)}` : "已達最高課費級距"}</h2>
            {!self.employment_configured ? <p>設定完成後，系統才會顯示正確級距並自動計入薪資。</p> : self.nextTier ? <p>還需要業績 {money(self.salesRemaining)}{self.employment_type === "full_time" ? `，且還需要 ${self.sessionsRemaining} 堂完課` : "；兼職不綁最低堂數"}。需同時達標後，當月所有完課堂數會套用新單價。</p> : <p>本月所有完課堂數皆以最高單價計算。</p>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>本月已確認明細</h2><p>一般分配與 EPO 都在經理確認每日報表後才顯示。</p></div></div>
            <div className={styles.selfHistory}>
              {(data?.events || []).map((event) => <article key={event.id}><time>{event.business_date}</time><div><strong>{event.label}</strong><small>{SOURCE_LABELS[event.source_type] || event.source_type}</small></div><b className={event.amount < 0 ? styles.negative : ""}>{money(event.amount)}</b></article>)}
              {(data?.epoAwards || []).map((epo) => <article key={epo.id}><time>{epo.business_date}</time><div><strong>＋{epo.quantity} EPO</strong><small>{epo.reason}</small></div><b>EPO</b></article>)}
              {!data?.events.length && !data?.epoAwards.length ? <div className={styles.empty}>本月尚無已確認的業績或 EPO。</div> : null}
            </div>
          </section>
        </>
      ) : <div className={styles.empty}>您的帳號尚未設定為教練，請聯絡副理。</div>}
    </main>
  );
}
