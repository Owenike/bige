"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Dumbbell,
  FileSignature,
  GripVertical,
  KeyRound,
  Lock,
  LockOpen,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  TriangleAlert,
  UserRoundCheck,
  X,
} from "lucide-react";
import {
  AnimationEvent as ReactAnimationEvent,
  FormEvent,
  Fragment,
  type InputHTMLAttributes,
  PointerEvent as ReactPointerEvent,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BIGE_COURSE_LABELS,
  BIGE_COURSE_TYPES,
  BIGE_CONTRACT_COURSE_TYPES,
  BIGE_TRIAL_COURSE_TYPES,
  BIGE_FA_DURATION_MINUTES,
  BIGE_SCHEDULE_MOVE_UNDO_WINDOW_MS,
  canReviseBigeTrialOutcome,
  canEditBigeScheduleBooking,
  calculateBigeContractOutstandingBalance,
  calculateContractTerms,
  calculateLegacyContractExpiryDate,
  calculateMinimumDeposit,
  getBigeFaFeeAmount,
  getBigeStudentPaymentBalanceState,
  getBigeTrialContractMissingProfileFields,
  getBigeTrialBookingActionVisibility,
  getBigeTrialOutcomeVisualState,
  isBigeContractPaymentAmountAllowed,
  isBigeTrialReminderConfirmed,
  nextBigeTrialReminderStatus,
  resolveBigeTrialContractIdentity,
  summarizeBigeMemberCourseSessions,
  validateCourseAllocationTotal,
  type BigeCourseType,
  type BigeContractCourseType,
} from "../lib/bige-fitness";
import {
  canCancelBigeCourseAnytime,
  getBigeCourseStatusWindow,
  isBigeCourseStatusWindowExempt,
} from "../lib/bige-course-status-window";
import {
  applyScheduleMoveResult,
  analyzeScheduleDrop,
  buildOptimisticFaAssistantToState,
  buildOptimisticScheduleMoveResult,
  findScheduleEditConflict,
  isScheduleBookingDraggable,
  runOptimisticScheduleMutation,
  type ScheduleDropPlan,
  type ScheduleMoveResultItem,
} from "../lib/bige-schedule-drag";
import {
  buildBigeClassroomConflicts,
  type BigeClassroomConflict,
} from "../lib/bige-classroom-conflicts";
import {
  applyCoachIdOrder,
  reorderCoachList,
  synchronizeCoachOrderAcrossBoards,
} from "../lib/bige-coach-order";
import {
  normalizeStaffPosition,
  positionLabel,
} from "../lib/staff-organization";
import {
  CUSTOM_EMPLOYEE_NUMBER_MANAGER,
  canUseStaffAccountSettings,
  normalizeEmployeeNumber,
} from "../lib/staff-credentials";
import { getBigeMemberDisplayNumber } from "../lib/bige-member-search";
import {
  BIGE_BOARD_PREFETCH_RADIUS,
  BigeBoardPrefetchQueue,
  buildBigeBoardPrefetchDates,
} from "../lib/bige-board-prefetch";
import {
  bumpBigeBoardRevision,
  isBigeBoardRevisionCurrent,
  readBigeBoardRevision,
} from "../lib/bige-board-freshness";
import AdministrativeAssistanceBoard from "./administrative-assistance-board";
import styles from "./bige-fitness-operations.module.css";

type RoleView = "manager" | "frontdesk" | "coach";
type Tab = "schedule" | "contracts" | "plans" | "reminders" | "report" | "assistance";
type DialogName =
  | "member"
  | "slot-time"
  | "schedule"
  | "booking"
  | "contract"
  | "plan"
  | "payment"
  | "edit-payment"
  | "course-allocations"
  | "extension"
  | "monthly-schedule"
  | "monthly-schedule-confirm"
  | "monthly-schedule-result"
  | "activity"
  | null;
type SessionIdentity = {
  displayName: string | null;
  employeeNumber: string | null;
  role: string;
  position: string | null;
};

type Coach = {
  id: string;
  branch_id?: string | null;
  display_name: string | null;
  english_name: string | null;
  employee_number?: string | null;
  department?: string | null;
  position?: string | null;
};
type Member = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  email_unavailable: boolean;
  birth_date: string | null;
  member_code: string | null;
  is_prospect: boolean;
  legacy_numbers?: string[];
  legacy_shared?: boolean;
};
type Booking = {
  id: string;
  optimistic?: boolean;
  branch_id?: string | null;
  member_id: string;
  coach_id: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string | null;
  operation_kind: "pt" | "trial";
  course_type: BigeCourseType;
  trial_stage: string | null;
  operation_result: string | null;
  trial_conversion_outcome?: "pending_conversion" | "converted" | "not_converted" | null;
  reminder_status: string;
  converted_at: string | null;
  converted_payment_amount?: number | null;
  booking_payment_amount?: number | null;
  future_trial_booking_count?: number;
  trial_booking_id?: string | null;
  requires_contract_followup?: boolean;
  import_batch_id?: string | null;
  import_row_key?: string | null;
  fa_fee_amount?: number | null;
  fa_fee_recipient_profile_id?: string | null;
  fa_fee_recipient_name?: string | null;
  fa_fee_recorded_at?: string | null;
};
type FaFeeRecipientOption = {
  id: string;
  label: string;
  employeeNumber: string | null;
  branchId: string | null;
};
type FaFeeRecipientPrompt = {
  action: "confirm_payment" | "not_converted";
  bookingId: string;
  amount: 880 | 1500;
};
type TrialBookingSummary = {
  id: string;
  name: string;
  phone: string;
  birthday: string | null;
  service: string;
};
type ScheduleNote = {
  id: string;
  coach_id: string;
  starts_at: string;
  ends_at: string;
  content: string;
  system_kind?: string | null;
  source_booking_ids?: string[] | null;
  metadata?: Record<string, unknown> | null;
};
type ScheduleNoteUndo = {
  noteId: string;
  coachId: string;
  startsAt: string;
  endsAt: string;
  content: string;
  expiresAt: string;
};
type ScheduleMoveUndo = {
  operationId: string;
  businessDate: string;
};
type ScheduleDeleteUndo = {
  bookingId: string;
  businessDate: string;
  ready: boolean;
};
type ScheduleEditUndo =
  | {
      kind: "booking";
      item: Booking;
      businessDate: string;
      ready: boolean;
    }
  | {
      kind: "note";
      item: ScheduleNote;
      businessDate: string;
      ready: boolean;
    };
type ScheduleEditTarget =
  | { kind: "booking"; item: Booking }
  | { kind: "note"; item: ScheduleNote }
  | null;
type ScheduleDragPayload =
  | { kind: "booking"; item: Booking; movable: boolean }
  | { kind: "note"; item: ScheduleNote; movable: false };
type CoachDragPayload = { kind: "coach"; item: Coach; movable: true };
type BigeDragPayload = ScheduleDragPayload | CoachDragPayload;
type ScheduleDropPayload = {
  kind: "slot";
  coachId: string;
  startsAt: string;
  minute: 0 | 30;
};
type ScheduleDeleteDropPayload = {
  kind: "schedule-delete";
};
type CoachDropPayload = {
  kind: "coach-target";
  coachId: string;
};

const bigeScheduleCollisionDetection: CollisionDetection = (args) => {
  const activeKind = (args.active.data.current as BigeDragPayload | undefined)?.kind;
  return pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) =>
        activeKind === "coach"
          ? container.data.current?.kind === "coach-target"
          : container.data.current?.kind === "slot" ||
            container.data.current?.kind === "schedule-delete",
    ),
  });
};
type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  total_sessions: number;
  price_amount: number;
  course_allocations: Record<BigeContractCourseType, number>;
  fitness_plan_kind: string;
};
type CustomContractPlanDraft = {
  name: string;
  description: string;
  totalSessions: number;
  totalAmount: number;
  validityDays: number;
  extensionLimitDays: number;
  allocations: Record<BigeContractCourseType, number>;
};
type Contract = {
  id: string;
  contract_number: string;
  status: string;
  payment_status: string;
  signed_on: string | null;
  ends_at: string | null;
  is_legacy_import?: boolean;
  purchase_date_recorded_at?: string | null;
  total_sessions: number;
  total_amount: number;
  unlocked_sessions: number;
  used_sessions: number;
  remaining_sessions: number;
  course_allocations: Record<BigeContractCourseType, number>;
  course_used: Record<BigeContractCourseType, number>;
  course_allocations_configured_at?: string | null;
  extension_limit_days: number;
  extension_used_days: number;
};
type PaymentRecord = {
  id: string;
  contract_id: string;
  schedule_item_id?: string | null;
  payment_kind: string;
  amount: number;
  method: string;
  installment_count?: number | null;
  status: string;
  paid_at: string;
  note?: string | null;
};
type LegacyPurchaseDateReminder = {
  id: string;
  member_id: string;
  member_name: string;
  member_code: string | null;
  legacy_numbers: string[];
  contract_number: string;
  total_sessions: number;
  remaining_sessions: number;
  first_class_at: string | null;
};
type MemberDetail = {
  member: Member;
  contracts: Contract[];
  paymentSchedule: any[];
  payments: PaymentRecord[];
  extensions: any[];
  canViewDetailedPaymentDates?: boolean;
  canRecordContractPayment?: boolean;
  canEditContractPayment?: boolean;
  canManageCourseAllocations?: boolean;
};
type StudentPaymentContext = {
  bookingId: string;
  memberId: string;
  paymentType: "new" | "renewal" | "balance";
  amount: string;
  contractId: string;
};
type PaymentEntryDraft = {
  id: string;
  amount: string;
  method: string;
  installmentCount: number | null;
};
type CoachDayStatus = {
  coach_id: string;
  status: "early" | "late" | "off";
  label: "早班" | "晚班" | "休假";
};
type FaAssistantToConflict = {
  coach_id: string;
  starts_at: string;
  source_booking_ids: string[];
  message: string;
};
export type BoardData = {
  businessDate: string;
  role: string;
  coachScheduleScope?: "all" | "assigned";
  canManageBusinessClosure?: boolean;
  canManageFrontdesk?: boolean;
  canManageSchedule?: boolean;
  canReorderCoaches?: boolean;
  canViewScheduleActivity?: boolean;
  canSeeTrialRevenue?: boolean;
  canViewDetailedPaymentDates?: boolean;
  canRecordContractPayment?: boolean;
  canEditContractPayment?: boolean;
  canManageCourseAllocations?: boolean;
  canCreateContract?: boolean;
  canChangeTrialConversion?: boolean;
  canRestoreTrialConversion?: boolean;
  canManageDailyReports?: boolean;
  canConfirmDailyReports?: boolean;
  businessDay?: null | {
    id: string;
    branch_id: string | null;
    business_date: string;
    is_closed: boolean;
    closure_label: string | null;
    frontdesk_name: string | null;
    source: string;
    updated_at: string;
  };
  bookings: Booking[];
  notes: ScheduleNote[];
  coachDayStatuses?: CoachDayStatus[];
  faAssistantToConflicts?: FaAssistantToConflict[];
  classroomConflicts?: BigeClassroomConflict[];
  coaches: Coach[];
  members: Member[];
  paymentDetailsByMemberId?: Record<string, MemberDetail>;
  previewMemberDetails?: Record<string, MemberDetail>;
  trialBookings?: TrialBookingSummary[];
  plans: Plan[];
  closure: null | {
    id: string;
    status: string;
    revision: number;
    confirmed_at: string | null;
    snapshot: Record<string, number>;
  };
  expiringContracts: Contract[];
  legacyPurchaseDateReminders?: LegacyPurchaseDateReminder[];
};

function createPaymentEntryDraft(amount = ""): PaymentEntryDraft {
  return {
    id: globalThis.crypto?.randomUUID?.() || `payment-entry-${Date.now()}-${Math.random()}`,
    amount,
    method: "cash",
    installmentCount: null,
  };
}

function paymentEntryTotal(entries: PaymentEntryDraft[]) {
  return entries.reduce((sum, entry) => {
    const amount = Number(entry.amount);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
}

function normalizedPaymentEntries(entries: PaymentEntryDraft[]) {
  return entries
    .filter((entry) => Number(entry.amount) > 0)
    .map((entry) => ({
      amount: Number(entry.amount),
      method: entry.method,
      installmentCount:
        entry.method === "ecpay_installment" ? entry.installmentCount : null,
    }));
}

function paymentEntryError(entries: PaymentEntryDraft[], required: boolean) {
  const nonEmpty = entries.filter((entry) => entry.amount.trim() !== "");
  if (required && nonEmpty.length === 0) return "請輸入付款金額";
  if (nonEmpty.some((entry) => !Number.isInteger(Number(entry.amount)) || Number(entry.amount) <= 0)) {
    return "每一筆付款金額都必須是大於 0 的整數";
  }
  if (
    nonEmpty.some(
      (entry) => entry.method === "ecpay_installment" && !entry.installmentCount,
    )
  ) {
    return "請先輸入每筆綠界分期的期數";
  }
  return "";
}

function customContractPlanFrom(plan?: Plan): CustomContractPlanDraft {
  const totalSessions = plan?.total_sessions || 12;
  const terms = calculateContractTerms(totalSessions);
  return {
    name: plan ? `${plan.name}（自訂）` : "自訂方案",
    description: plan?.description || "",
    totalSessions,
    totalAmount: plan?.price_amount || 0,
    validityDays: terms.validityDays,
    extensionLimitDays: terms.extensionLimitDays,
    allocations: {
      weight_training: plan?.course_allocations.weight_training || totalSessions,
      relaxation: plan?.course_allocations.relaxation || 0,
      reformer_pilates: plan?.course_allocations.reformer_pilates || 0,
      sports_cupping: plan?.course_allocations.sports_cupping || 0,
      fascia_knife: plan?.course_allocations.fascia_knife || 0,
    },
  };
}

function emptyCourseAllocationDraft(): Record<BigeContractCourseType, number> {
  return {
    weight_training: 0,
    relaxation: 0,
    reformer_pilates: 0,
    sports_cupping: 0,
    fascia_knife: 0,
  };
}

function courseAllocationDraftFrom(contract?: Contract | null) {
  if (!contract?.course_allocations_configured_at) return emptyCourseAllocationDraft();
  return Object.fromEntries(
    BIGE_CONTRACT_COURSE_TYPES.map((course) => [
      course,
      Math.max(0, Number(contract.course_allocations?.[course] || 0)),
    ]),
  ) as Record<BigeContractCourseType, number>;
}

function configuredCourseUsed(
  contract: Contract | null | undefined,
  course: BigeContractCourseType,
) {
  if (!contract?.course_allocations_configured_at) return 0;
  return Math.max(0, Number(contract.course_used?.[course] || 0));
}

type MonthlyScheduleData = {
  month: string;
  member: Member;
  bookings: Booking[];
  coaches: Coach[];
};

type MonthlyScheduleSlot = {
  startsAt: string;
  endsAt: string;
};

type MonthlyScheduleConflict = MonthlyScheduleSlot & {
  kind:
    | "coach_booking"
    | "coach_note"
    | "member_booking"
    | "closed_day"
    | "outside_hours";
  message: string;
  conflictStartsAt?: string;
  conflictEndsAt?: string;
  conflictMemberId?: string | null;
  conflictMemberName?: string | null;
  conflictCoachId?: string | null;
  conflictCoachName?: string | null;
  conflictCourseType?: string | null;
  conflictServiceName?: string | null;
  conflictNote?: string | null;
};

type MonthlySchedulePreflight = {
  requestedCount: number;
  available: MonthlyScheduleSlot[];
  conflicts: MonthlyScheduleConflict[];
};

type MonthlyScheduleBatchResult = {
  created: Array<{ startsAt: string; item: unknown }>;
  skipped: MonthlyScheduleConflict[];
  failures: Array<{ startsAt: string; message: string }>;
};

type ScheduleActivityData = {
  businessDate: string;
  logs: Array<Record<string, any>>;
  loginEvents: Array<Record<string, any>>;
  pageSessions: Array<Record<string, any>>;
  actors: Array<Record<string, any>>;
};

// Product performance baseline: keep ten dates in each direction warm. The
// larger LRU headroom is intentional: rapid navigation recenters overlapping
// windows while older in-flight requests may finish out of order. A cache that
// only fits one window lets those late responses evict dates beside the user's
// current selection and makes the board feel slow again.
const BOARD_CACHE_LIMIT = BIGE_BOARD_PREFETCH_RADIUS * 6 + 1;

function readBoardCache(cache: Map<string, BoardData>, date: string) {
  const value = cache.get(date);
  if (!value) return undefined;
  cache.delete(date);
  cache.set(date, value);
  return value;
}

function storeBoardCache(cache: Map<string, BoardData>, date: string, value: BoardData) {
  cache.delete(date);
  cache.set(date, value);
  while (cache.size > BOARD_CACHE_LIMIT) {
    const oldestDate = cache.keys().next().value;
    if (!oldestDate) break;
    cache.delete(oldestDate);
  }
}

function applyScheduleEditUndo(data: BoardData, undo: ScheduleEditUndo) {
  const bookings =
    undo.kind === "booking"
      ? data.bookings.map((booking) =>
          booking.id === undo.item.id
            ? {
                ...booking,
                coach_id: undo.item.coach_id,
                course_type: undo.item.course_type,
                service_name: undo.item.service_name,
                starts_at: undo.item.starts_at,
                ends_at: undo.item.ends_at,
                note: undo.item.note,
              }
            : booking,
        )
      : data.bookings;
  const notes =
    undo.kind === "note"
      ? data.notes.map((note) =>
          note.id === undo.item.id
            ? {
                ...note,
                coach_id: undo.item.coach_id,
                starts_at: undo.item.starts_at,
                ends_at: undo.item.ends_at,
                content: undo.item.content,
              }
            : note,
        )
      : data.notes;
  const assistantToState = buildOptimisticFaAssistantToState({
    bookings,
    notes,
    coaches: data.coaches,
    offCoachIds: (data.coachDayStatuses || [])
      .filter((status) => status.status === "off")
      .map((status) => status.coach_id),
  });

  return {
    ...data,
    bookings,
    notes: assistantToState.notes,
    faAssistantToConflicts: assistantToState.conflicts,
    classroomConflicts: buildBigeClassroomConflicts(bookings),
  };
}

function applyOptimisticBookingUpdate(
  data: BoardData,
  bookingId: string,
  updates: Partial<Booking>,
) {
  const bookings = data.bookings.map((booking) =>
    booking.id === bookingId ? { ...booking, ...updates } : booking,
  );
  const assistantToState = buildOptimisticFaAssistantToState({
    bookings,
    notes: data.notes,
    coaches: data.coaches,
    offCoachIds: (data.coachDayStatuses || [])
      .filter((status) => status.status === "off")
      .map((status) => status.coach_id),
  });

  return {
    ...data,
    bookings,
    notes: assistantToState.notes,
    faAssistantToConflicts: assistantToState.conflicts,
    classroomConflicts: buildBigeClassroomConflicts(bookings),
  };
}

function applyOptimisticBookingCreate(
  data: BoardData,
  booking: Booking,
  selectedTarget?: {
    member?: Member | null;
    trialBooking?: TrialBookingSummary | null;
  },
) {
  const bookings = [...data.bookings, booking];
  const members =
    selectedTarget?.member && !data.members.some((member) => member.id === selectedTarget.member?.id)
      ? [...data.members, selectedTarget.member]
      : data.members;
  const trialBookings =
    selectedTarget?.trialBooking &&
    !(data.trialBookings || []).some((trial) => trial.id === selectedTarget.trialBooking?.id)
      ? [...(data.trialBookings || []), selectedTarget.trialBooking]
      : data.trialBookings;
  const assistantToState = buildOptimisticFaAssistantToState({
    bookings,
    notes: data.notes,
    coaches: data.coaches,
    offCoachIds: (data.coachDayStatuses || [])
      .filter((status) => status.status === "off")
      .map((status) => status.coach_id),
  });

  return {
    ...data,
    bookings,
    members,
    trialBookings,
    notes: assistantToState.notes,
    faAssistantToConflicts: assistantToState.conflicts,
    classroomConflicts: buildBigeClassroomConflicts(bookings),
  };
}

function applyOptimisticScheduleBookingDelete(data: BoardData, bookingId: string) {
  const bookings = data.bookings.filter((booking) => booking.id !== bookingId);
  const assistantToState = buildOptimisticFaAssistantToState({
    bookings,
    notes: data.notes,
    coaches: data.coaches,
    offCoachIds: (data.coachDayStatuses || [])
      .filter((status) => status.status === "off")
      .map((status) => status.coach_id),
  });

  return {
    ...data,
    bookings,
    notes: assistantToState.notes,
    faAssistantToConflicts: assistantToState.conflicts,
    classroomConflicts: buildBigeClassroomConflicts(bookings),
  };
}

function apiMessage(payload: any, fallback: string) {
  return payload?.error?.message || payload?.message || payload?.error || fallback;
}

function coachLabel(coach: Coach) {
  return coach.english_name?.trim() || "Coach";
}

function coachPositionShortLabel(coach: Coach) {
  const position = normalizeStaffPosition(coach.position);
  if (position === "coach_team_lead") return "組長";
  if (position === "coach_director") return "主任";
  if (position === "coach_assistant_manager") return "副理";
  if (position === "coach_manager") return "經理";
  if (position === "coach_city_manager") return "城市經理";
  return null;
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(value: string, days: number) {
  const [year, month, date] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function weekdayLabel(value: string) {
  const [year, month, date] = value.split("-").map(Number);
  if (!year || !month || !date) return "";
  return ["週日", "週一", "週二", "週三", "週四", "週五", "週六"][
    new Date(Date.UTC(year, month - 1, date)).getUTCDay()
  ];
}

function monthDateValues(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return [];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) =>
    `${year}-${String(monthNumber).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
  );
}

function formatActivityTime(value: unknown) {
  if (typeof value !== "string" || !value) return "--:--";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function slotKey(value: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date(value));
}

const TRIAL_SERVICE_LABELS: Record<string, string> = {
  weight_training: "重訓",
  boxing_fitness: "拳擊體適能",
  pilates: "器械皮拉提斯",
  sports_massage: "運動按摩",
  onsite_assessment: "現場評估",
};

function localMinutes(value: string) {
  const [hour, minute] = slotKey(value).split(":").map(Number);
  return hour * 60 + minute;
}

function taipeiDateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function scheduleHourCellKey(coachId: string, value: string) {
  return `${coachId}:${taipeiDateKey(value)}:${Math.floor(localMinutes(value) / 60)}`;
}

function minuteOfDayLabel(value: number) {
  const normalized = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function scheduleSlotIso(date: string, hour: number, minute: 0 | 30) {
  return new Date(
    `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`,
  ).toISOString();
}

function durationMinutes(startsAt: string, endsAt: string) {
  const duration = Math.round(
    (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000,
  );
  return Number.isFinite(duration) && duration > 0 ? duration : 30;
}

function monthlyScheduleTimeOptions(operationKind: "pt" | "trial") {
  const duration = operationKind === "trial" ? 120 : 60;
  const firstStartMinute = 9 * 60;
  const lastStartMinute = 24 * 60 - duration;
  return Array.from(
    { length: (lastStartMinute - firstStartMinute) / 30 + 1 },
    (_, index) => minuteOfDayLabel(firstStartMinute + index * 30),
  );
}

function bookingDurationMinutes(booking: Booking) {
  return booking.operation_kind === "trial"
    ? BIGE_FA_DURATION_MINUTES
    : durationMinutes(booking.starts_at, booking.ends_at);
}

function overlapsHour(startsAt: string, duration: number, hour: number) {
  const startsAtMinute = localMinutes(startsAt);
  const endsAtMinute = startsAtMinute + duration;
  return startsAtMinute < (hour + 1) * 60 && endsAtMinute > hour * 60;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "尚未輸入";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatFaRevenueAmount(value: number) {
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value || 0)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "尚未輸入";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatBirthDate(value?: string | null) {
  const normalized = String(value || "").trim();
  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return `${dateOnly[1]}/${dateOnly[2]}/${dateOnly[3]}`;
  const parsed = new Date(normalized);
  if (!normalized || Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(parsed)
    .replaceAll("-", "/");
}

const CONTRACT_PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "尚未付款",
  deposit_paid: "已付訂金",
  partially_paid: "部分付款",
  settled: "已結清",
  overdue: "逾期未付",
  refunded: "已退款",
};

const PAYMENT_KIND_LABELS: Record<string, string> = {
  deposit: "訂金",
  balance: "尾款",
  installment: "分期付款",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "現金",
  bank_transfer: "轉帳",
  card_terminal: "刷卡機",
  ecpay: "綠界",
  ecpay_installment: "綠界分期",
  acpay: "ACPay",
  other: "其他",
};

const PAYMENT_RECORD_STATUS_LABELS: Record<string, string> = {
  recorded: "已登記",
  voided: "已作廢",
  refunded: "已退款",
};

function promptEcpayInstallmentCount(current?: number | null) {
  const raw = window.prompt(
    "請輸入綠界分期期數（2 至 60 期）",
    current ? String(current) : "",
  );
  if (raw === null) return null;
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    window.alert("分期期數請輸入 2 至 60 的整數");
    return null;
  }
  const installmentCount = Number(normalized);
  if (installmentCount < 2 || installmentCount > 60) {
    window.alert("分期期數請輸入 2 至 60 的整數");
    return null;
  }
  return installmentCount;
}

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "待確認",
  confirmed: "已確認",
  booked: "已預約",
  checked_in: "已報到",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "未到場",
  rescheduled: "已改期",
};

function labelOrValue(labels: Record<string, string>, value: string) {
  return labels[value] || value;
}

function scheduleCourseLabel(courseType: BigeCourseType) {
  return courseType === "reformer_pilates"
    ? "皮拉提斯"
    : BIGE_COURSE_LABELS[courseType];
}

const DIALOG_CLOSE_ANIMATION_MS = 360;
const DIALOG_CLOSE_FALLBACK_MS = DIALOG_CLOSE_ANIMATION_MS + 120;
const DIALOG_GENIE_SLICE_COUNT = 30;
const DIALOG_GENIE_KEYFRAME_TIMES = [0, 0.18, 0.38, 0.58, 0.78, 0.9, 1] as const;

function StableNumberInput({
  value,
  onValueChange,
  fallbackValue = 0,
  onFocus,
  onBlur,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number;
  onValueChange: (value: number) => void;
  fallbackValue?: number;
}) {
  const [draft, setDraft] = useState(() => String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value));
  }, [value]);

  return (
    <input
      {...props}
      type="number"
      value={draft}
      onFocus={(event) => {
        focusedRef.current = true;
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        if (nextDraft === "") return;
        const nextValue = Number(nextDraft);
        if (Number.isFinite(nextValue)) onValueChange(nextValue);
      }}
      onBlur={(event) => {
        focusedRef.current = false;
        const nextValue = draft === "" || !Number.isFinite(Number(draft))
          ? fallbackValue
          : Number(draft);
        setDraft(String(nextValue));
        onValueChange(nextValue);
        onBlur?.(event);
      }}
    />
  );
}

function Dialog(props: {
  title: string;
  onClose: () => void;
  onCloseStart?: () => void;
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
  compact?: boolean;
  background?: boolean;
  revealBackgroundOnClose?: boolean;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const genieLayerRef = useRef<HTMLDivElement | null>(null);
  const closeCompletedRef = useRef(false);
  const onCloseRef = useRef(props.onClose);
  const onCloseStartRef = useRef(props.onCloseStart);

  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);

  useEffect(() => {
    onCloseStartRef.current = props.onCloseStart;
  }, [props.onCloseStart]);

  const completeAnimatedClose = useCallback(
    (event?: ReactAnimationEvent<HTMLElement>) => {
      if (event && event.currentTarget !== event.target) return;
      if (closeCompletedRef.current) return;
      closeCompletedRef.current = true;
      genieLayerRef.current?.remove();
      genieLayerRef.current = null;
      onCloseRef.current();
    },
    [],
  );

  const requestAnimatedClose = useCallback(() => {
    if (isClosing || closeCompletedRef.current) return;

    const element = dialogRef.current;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (element && !prefersReducedMotion) {
      const bounds = element.getBoundingClientRect();
      const dockInset = 16;
      const targetX = dockInset;
      const targetY = window.innerHeight - dockInset;
      const layer = document.createElement("div");
      layer.className = styles.dialogGenieLayer;
      layer.setAttribute("aria-hidden", "true");
      layer.inert = true;
      element.parentElement?.appendChild(layer);
      genieLayerRef.current?.remove();
      genieLayerRef.current = layer;

      const progressAt = (time: number, verticalProgress: number) => {
        const delayedUpperEdge = Math.pow(time, 3.2);
        const lowerEdgeLead =
          0.75 * Math.sin(Math.PI * time) * Math.pow(verticalProgress, 1.55);
        return Math.min(1, delayedUpperEdge + lowerEdgeLead);
      };
      const mappedY = (originalY: number, time: number) => {
        const verticalProgress = Math.max(
          0,
          Math.min(1, (originalY - bounds.top) / bounds.height),
        );
        const progress = progressAt(time, verticalProgress);
        return originalY + (targetY - originalY) * progress;
      };

      for (let index = 0; index < DIALOG_GENIE_SLICE_COUNT; index += 1) {
        const sliceStart = (bounds.height * index) / DIALOG_GENIE_SLICE_COUNT;
        const sliceEnd = (bounds.height * (index + 1)) / DIALOG_GENIE_SLICE_COUNT;
        const overlap = 0.75;
        const visibleStart = Math.max(0, sliceStart - overlap);
        const visibleEnd = Math.min(bounds.height, sliceEnd + overlap);
        const sliceHeight = visibleEnd - visibleStart;
        const originalCenterY = bounds.top + visibleStart + sliceHeight / 2;
        const verticalProgress = (sliceStart + sliceEnd) / 2 / bounds.height;
        const slice = document.createElement("div");
        slice.className = styles.dialogGenieSlice;
        slice.dataset.genieSlice = String(index);
        slice.style.left = `${bounds.left}px`;
        slice.style.top = `${bounds.top + visibleStart}px`;
        slice.style.width = `${bounds.width}px`;
        slice.style.height = `${sliceHeight}px`;

        const clone = element.cloneNode(true) as HTMLElement;
        clone.classList.remove(styles.dialogClosing);
        clone.removeAttribute("role");
        clone.removeAttribute("aria-modal");
        clone.setAttribute("aria-hidden", "true");
        clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
        clone.querySelectorAll("iframe").forEach((frame) => frame.removeAttribute("src"));
        clone.style.position = "absolute";
        clone.style.left = "0";
        clone.style.top = `${-visibleStart}px`;
        clone.style.width = `${bounds.width}px`;
        clone.style.height = `${bounds.height}px`;
        clone.style.maxHeight = "none";
        clone.style.margin = "0";
        clone.style.overflow = "hidden";
        clone.style.animation = "none";
        clone.style.setProperty("backdrop-filter", "none");
        clone.style.setProperty("-webkit-backdrop-filter", "none");
        slice.appendChild(clone);
        layer.appendChild(slice);
        clone.scrollTop = element.scrollTop;
        clone.scrollLeft = element.scrollLeft;

        const keyframes = DIALOG_GENIE_KEYFRAME_TIMES.map((time) => {
          const progress = progressAt(time, verticalProgress);
          const mappedTop = mappedY(bounds.top + visibleStart, time);
          const mappedBottom = mappedY(bounds.top + visibleEnd, time);
          const mappedCenter = (mappedTop + mappedBottom) / 2;
          const translatedX = (targetX - bounds.left) * progress;
          const translatedY = mappedCenter - originalCenterY;
          const scaleX = Math.max(0.022, 1 - 0.978 * Math.pow(progress, 1.5));
          const scaleY = Math.max(0.018, (mappedBottom - mappedTop) / sliceHeight);
          const fadeProgress = Math.max(0, (time - 0.84) / 0.16);

          return {
            offset: time,
            opacity: String(1 - fadeProgress),
            filter: `blur(${fadeProgress * 1.8}px)`,
            transform: `translate3d(${translatedX}px, ${translatedY}px, 0) scaleX(${scaleX}) scaleY(${scaleY})`,
          };
        });

        slice.animate(keyframes, {
          duration: DIALOG_CLOSE_ANIMATION_MS,
          easing: "linear",
          fill: "forwards",
        });
      }
    }

    onCloseStartRef.current?.();
    setIsClosing(true);
  }, [isClosing]);

  useEffect(() => {
    if (!isClosing) return;
    const fallback = window.setTimeout(completeAnimatedClose, DIALOG_CLOSE_FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, [completeAnimatedClose, isClosing]);

  useEffect(
    () => () => {
      genieLayerRef.current?.remove();
      genieLayerRef.current = null;
    },
    [],
  );

  return (
    <div
      className={`${styles.overlay} ${props.background ? styles.overlayBackground : ""} ${isClosing ? styles.overlayClosing : ""} ${isClosing && props.revealBackgroundOnClose ? styles.overlayRevealBehind : ""}`}
      role="presentation"
      aria-hidden={props.background ? true : undefined}
      inert={props.background ? true : undefined}
      onMouseDown={requestAnimatedClose}
      onAnimationEnd={completeAnimatedClose}
    >
      <section
        ref={dialogRef}
        className={`${styles.dialog} ${props.className || ""} ${props.wide ? styles.wideDialog : ""} ${props.compact ? styles.compactDialog : ""} ${isClosing ? styles.dialogClosing : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>{props.title}</h2>
          <button
            className={styles.iconButton}
            type="button"
            onClick={requestAnimatedClose}
            title="關閉"
            aria-label="關閉視窗"
            disabled={isClosing}
          >
            <X size={19} />
          </button>
        </div>
        {props.children}
      </section>
    </div>
  );
}

function SignaturePad(props: { onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const position = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current!;
    canvas.setPointerCapture(event.pointerId);
    const context = canvas.getContext("2d")!;
    const point = position(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    drawing.current = true;
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = ref.current!;
    const context = canvas.getContext("2d")!;
    const point = position(event);
    context.lineWidth = 4;
    context.lineCap = "round";
    context.strokeStyle = "#172236";
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const end = () => {
    if (!drawing.current || !ref.current) return;
    drawing.current = false;
    props.onChange(ref.current.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    props.onChange("");
  };

  return (
    <>
      <canvas
        ref={ref}
        className={styles.signature}
        width={1200}
        height={380}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button className={styles.button} type="button" onClick={clear}>
        清除重簽
      </button>
    </>
  );
}

const DAILY_SCHEDULE_LOADING_COACH_COUNT = 7;
const DAILY_SCHEDULE_LOADING_ROW_STEP_MS = 65;
const DAILY_SCHEDULE_LOADING_SECOND_TURN_MS = 1900;
const DAILY_SCHEDULE_LOADING_HOURS = Array.from(
  { length: 15 },
  (_, index) => index + 9,
);

function dailyScheduleLoadingRowStyle(rowIndex: number) {
  return {
    "--loading-row-delay": `${rowIndex * DAILY_SCHEDULE_LOADING_ROW_STEP_MS}ms`,
  } as React.CSSProperties;
}

function dailyScheduleLoadingHourLabel(hour: number) {
  const wrappedHour = ((hour % 24) + 24) % 24;
  return `${String(wrappedHour).padStart(2, "0")}:00`;
}

function LoadingTimeFace({
  value,
  half,
}: {
  value: string;
  half: "upper" | "lower";
}) {
  return (
    <span
      className={styles.loadingTimeFace}
      data-loading-half={half}
      aria-hidden="true"
    >
      <span>{value}</span>
    </span>
  );
}

function LoadingFlipMechanism({
  oldValue,
  newValue,
}: {
  oldValue?: string;
  newValue?: string;
}) {
  return (
    <>
      {oldValue && newValue ? (
        <>
          <LoadingTimeFace value={newValue} half="upper" />
          <LoadingTimeFace value={oldValue} half="lower" />
        </>
      ) : null}
      <span className={styles.loadingFlipUpperFlap} aria-hidden="true">
        {oldValue ? (
          <LoadingTimeFace value={oldValue} half="upper" />
        ) : null}
      </span>
      <span className={styles.loadingFlipLowerFlap} aria-hidden="true">
        {newValue ? (
          <LoadingTimeFace value={newValue} half="lower" />
        ) : null}
      </span>
      <span className={styles.loadingFlipHinge} aria-hidden="true" />
    </>
  );
}

function DailyScheduleLoadingBoard() {
  const [loadingPage, setLoadingPage] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoadingPage(1);
    }, DAILY_SCHEDULE_LOADING_SECOND_TURN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section
      className={`${styles.glass} ${styles.boardWrap} ${styles.loadingBoardWrap}`}
      aria-busy="true"
      aria-label="正在讀取營運資料與日排課表"
    >
      <div className={styles.loadingBoardStatus} role="status" aria-live="polite">
        <span className={styles.loadingBoardStatusLabel}>正在讀取營運資料</span>
        <span className={styles.loadingBoardDots} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
      <div
        className={`${styles.board} ${styles.loadingBoard}`}
        data-mobile-show-all="false"
        aria-hidden="true"
        style={
          {
            "--coach-count": DAILY_SCHEDULE_LOADING_COACH_COUNT,
            "--all-board-width": `${DAILY_SCHEDULE_LOADING_COACH_COUNT * (62 + 190)}px`,
          } as React.CSSProperties
        }
      >
        {Array.from({ length: DAILY_SCHEDULE_LOADING_COACH_COUNT }, (_, coachIndex) => (
          <Fragment key={`loading-head:${coachIndex}`}>
            <div
              className={styles.timeHead}
              data-mobile-active={String(coachIndex === 0)}
            >
              <span className={styles.loadingTimeLabel}>時間</span>
            </div>
            <div
              className={styles.coachHead}
              data-mobile-active={String(coachIndex === 0)}
            >
              <span className={styles.loadingCoachMark} />
            </div>
          </Fragment>
        ))}
        {DAILY_SCHEDULE_LOADING_HOURS.map((hour, rowIndex) =>
          Array.from({ length: DAILY_SCHEDULE_LOADING_COACH_COUNT }, (_, coachIndex) => (
            <Fragment key={`loading:${hour}:${coachIndex}`}>
              <div
                className={`${styles.timeCell} ${styles.loadingFlipCell}`}
                data-mobile-active={String(coachIndex === 0)}
                data-loading-row={rowIndex + 1}
                style={dailyScheduleLoadingRowStyle(rowIndex + 1)}
              >
                <LoadingFlipMechanism
                  key={`time:${loadingPage}`}
                  oldValue={dailyScheduleLoadingHourLabel(hour + loadingPage - 1)}
                  newValue={dailyScheduleLoadingHourLabel(hour + loadingPage)}
                />
              </div>
              <div
                className={styles.slotCell}
                data-mobile-active={String(coachIndex === 0)}
              >
                {(rowIndex * 3 + coachIndex * 2) % 7 === 0 ? (
                  <span className={styles.loadingBookingMark} />
                ) : null}
              </div>
            </Fragment>
          )),
        )}
      </div>
    </section>
  );
}

export default function BigeFitnessOperations({
  view,
  previewData,
}: {
  view: RoleView;
  previewData?: BoardData;
}) {
  const managerView = view === "manager";
  const coachView = view === "coach";
  const viewCopy: Record<RoleView, { title: string; subtitle: string }> = {
    manager: {
      title: "主管營運後台",
      subtitle: "排課、FA 成交、方案、付款解鎖、合約期限與營運報表",
    },
    frontdesk: {
      title: "櫃台營運後台",
      subtitle: "排課、FA 成交、會員合約與明日聯絡工作",
    },
    coach: {
      title: "教練營運後台",
      subtitle: "查看課表、確認到店結果與學員密碼扣堂",
    },
  };
  const [tab, setTab] = useState<Tab>("schedule");
  const [date, setDate] = useState(localDate);
  const [data, setData] = useState<BoardData | null>(previewData || null);
  const [boardDateDirection, setBoardDateDirection] = useState<"previous" | "next" | null>(null);
  const [reminderData, setReminderData] = useState<BoardData | null>(null);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [loading, setLoading] = useState(!previewData);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [businessDaySubmitting, setBusinessDaySubmitting] = useState(false);
  const [legacyPurchaseDates, setLegacyPurchaseDates] = useState<Record<string, string>>({});
  const [legacyPurchaseDateSubmitting, setLegacyPurchaseDateSubmitting] = useState<string | null>(null);
  const [sessionIdentity, setSessionIdentity] = useState<SessionIdentity | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [slotChoice, setSlotChoice] = useState<{ coachId: string; hour: number } | null>(null);
  const [staffManagerOpen, setStaffManagerOpen] = useState(false);
  const [selectedCoach, setSelectedCoach] = useState(
    () =>
      previewData?.coachScheduleScope === "all"
        ? "all"
        : previewData?.coaches[0]?.id || "",
  );
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [operationAlert, setOperationAlert] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [bookingActionSubmitting, setBookingActionSubmitting] = useState(false);
  const showOperationAlert = useCallback(
    (message: string, title = "操作無法完成") => {
      setError("");
      setOperationAlert({ title, message });
    },
    [],
  );
  const [trialOutcomePrompt, setTrialOutcomePrompt] = useState(false);
  const [trialOutcomeSubmitting, setTrialOutcomeSubmitting] = useState<
    "pending_conversion" | "not_converted" | null
  >(null);
  const [faFeeRecipientPrompt, setFaFeeRecipientPrompt] =
    useState<FaFeeRecipientPrompt | null>(null);
  const [faFeeRecipientName, setFaFeeRecipientName] = useState("");
  const [faFeeRecipientOptions, setFaFeeRecipientOptions] = useState<
    FaFeeRecipientOption[]
  >([]);
  const [faFeeRecipientOptionsLoaded, setFaFeeRecipientOptionsLoaded] = useState(false);
  const [faFeeRecipientOptionsLoading, setFaFeeRecipientOptionsLoading] = useState(false);
  const [faFeeRecipientOptionsError, setFaFeeRecipientOptionsError] = useState("");
  const [trialConversionEditing, setTrialConversionEditing] = useState(false);
  const [trialConversionAmount, setTrialConversionAmount] = useState(0);
  const [trialConversionOutcomeDraft, setTrialConversionOutcomeDraft] = useState<
    "converted" | "not_converted"
  >("converted");
  const [trialConversionSubmitting, setTrialConversionSubmitting] = useState<
    "change" | "outcome" | "restore" | null
  >(null);
  const [statusClock, setStatusClock] = useState(() => Date.now());
  const [editingSchedule, setEditingSchedule] = useState<ScheduleEditTarget>(null);
  const [activeScheduleDrag, setActiveScheduleDrag] = useState<ScheduleDragPayload | null>(null);
  const [useIpadScheduleOverview, setUseIpadScheduleOverview] = useState(false);
  const [useIpadProDesktopLayout, setUseIpadProDesktopLayout] = useState(false);
  const [scheduleDragNotice, setScheduleDragNotice] = useState("");
  const [scheduleDragUnlocked, setScheduleDragUnlocked] = useState(
    Boolean(previewData?.canManageSchedule),
  );
  const [hideOffCoaches, setHideOffCoaches] = useState(false);
  const [activeCoachDrag, setActiveCoachDrag] = useState<Coach | null>(null);
  const [coachOrderSubmitting, setCoachOrderSubmitting] = useState(false);
  const [pendingScheduleMove, setPendingScheduleMove] = useState<ScheduleDropPlan<Booking> | null>(null);
  const [overwriteConfirmation, setOverwriteConfirmation] = useState(false);
  const [scheduleMoveSubmitting, setScheduleMoveSubmitting] = useState(false);
  const [scheduleMoveUndo, setScheduleMoveUndo] = useState<ScheduleMoveUndo | null>(null);
  const [scheduleMoveUndoSubmitting, setScheduleMoveUndoSubmitting] = useState(false);
  const [scheduleDeleteSubmitting, setScheduleDeleteSubmitting] = useState(false);
  const [scheduleDeleteUndo, setScheduleDeleteUndo] = useState<ScheduleDeleteUndo | null>(null);
  const [scheduleDeleteUndoSubmitting, setScheduleDeleteUndoSubmitting] = useState(false);
  const [scheduleEditUndo, setScheduleEditUndo] = useState<ScheduleEditUndo | null>(null);
  const [scheduleEditUndoSubmitting, setScheduleEditUndoSubmitting] = useState(false);
  const [reminderSubmittingId, setReminderSubmittingId] = useState<string | null>(null);
  const [restoringCancelledBooking, setRestoringCancelledBooking] = useState(false);
  const [restoringNoShowBooking, setRestoringNoShowBooking] = useState(false);
  const [deletingScheduleNote, setDeletingScheduleNote] = useState(false);
  const [scheduleNoteUndo, setScheduleNoteUndo] = useState<ScheduleNoteUndo | null>(null);
  const [restoringScheduleNote, setRestoringScheduleNote] = useState(false);
  const [monthlySearch, setMonthlySearch] = useState("");
  const [monthlySearchResults, setMonthlySearchResults] = useState<Member[]>([]);
  const [monthlyMember, setMonthlyMember] = useState<Member | null>(null);
  const [monthlyMonth, setMonthlyMonth] = useState(() => localDate().slice(0, 7));
  const [monthlyData, setMonthlyData] = useState<MonthlyScheduleData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyCoachId, setMonthlyCoachId] = useState("");
  const [monthlyOperationKind, setMonthlyOperationKind] = useState<"pt" | "trial">("pt");
  const [monthlyCourseType, setMonthlyCourseType] = useState<BigeCourseType>("weight_training");
  const [monthlyTime, setMonthlyTime] = useState("09:00");
  const [monthlyDates, setMonthlyDates] = useState<string[]>([]);
  const [monthlyNote, setMonthlyNote] = useState("");
  const [monthlyPreflight, setMonthlyPreflight] = useState<MonthlySchedulePreflight | null>(null);
  const [monthlyPreflightLoading, setMonthlyPreflightLoading] = useState(false);
  const [monthlyPreflightError, setMonthlyPreflightError] = useState("");
  const [monthlyBatchResult, setMonthlyBatchResult] = useState<MonthlyScheduleBatchResult | null>(null);
  const [monthlySubmitting, setMonthlySubmitting] = useState(false);
  const [activityData, setActivityData] = useState<ScheduleActivityData | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const boardDateRef = useRef(date);
  const hasBoardRef = useRef(Boolean(previewData));
  const boardCacheRef = useRef<Map<string, BoardData>>(new Map());
  const boardRequestsRef = useRef<Map<string, Promise<BoardData>>>(new Map());
  const boardRevisionRef = useRef(new Map<string, number>());
  const boardPrefetchQueueRef = useRef<BigeBoardPrefetchQueue | null>(null);
  if (!boardPrefetchQueueRef.current) {
    boardPrefetchQueueRef.current = new BigeBoardPrefetchQueue();
  }
  const coachOrderIdsRef = useRef<string[] | null>(null);
  const coachOrderRevisionRef = useRef(0);
  const coachOrderPendingRef = useRef(false);
  const dateToolbarRef = useRef<HTMLDivElement | null>(null);
  const boardWrapRef = useRef<HTMLElement | null>(null);
  const boardDateAnimationTimerRef = useRef<number | null>(null);
  const scheduleNoteUndoTimerRef = useRef<number | null>(null);
  const boardWheelRef = useRef({
    delta: 0,
    lastEventAt: 0,
    lastSwitchAt: 0,
  });
  const lastScheduleDragAtRef = useRef(0);
  const scheduleDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 320, tolerance: 8 },
    }),
  );
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [courseAllocationContractId, setCourseAllocationContractId] = useState("");
  const [courseAllocationDraft, setCourseAllocationDraft] = useState<
    Record<BigeContractCourseType, number>
  >(emptyCourseAllocationDraft);
  const [courseAllocationSubmitting, setCourseAllocationSubmitting] = useState(false);
  const [courseAllocationError, setCourseAllocationError] = useState("");
  const [courseAllocationReturnDialog, setCourseAllocationReturnDialog] =
    useState<DialogName>(null);
  const [courseAllocationReturnVisible, setCourseAllocationReturnVisible] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ members: Member[]; trials: any[] }>({
    members: [],
    trials: [],
  });
  const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);
  const [memberDetailError, setMemberDetailError] = useState("");
  const [scheduleMemberDetail, setScheduleMemberDetail] = useState<MemberDetail | null>(null);
  const [scheduleMemberDetailLoading, setScheduleMemberDetailLoading] = useState(false);
  const [scheduleMemberDetailError, setScheduleMemberDetailError] = useState("");
  const memberDetailCacheRef = useRef(new Map<string, MemberDetail>());
  const memberDetailRequestRef = useRef(new Map<string, Promise<MemberDetail>>());
  const scheduleMemberDetailCacheRef = useRef(new Map<string, MemberDetail>());
  const scheduleMemberDetailRequestRef = useRef(new Map<string, Promise<MemberDetail>>());
  const memberLoadRequestIdRef = useRef(0);
  const scheduleMemberLoadRequestIdRef = useRef(0);
  const fetchMemberDetail = useCallback(
    (memberId: string, options: { force?: boolean } = {}) => {
      const previewDetail = previewData?.previewMemberDetails?.[memberId];
      if (previewDetail) return Promise.resolve(previewDetail);
      if (!options.force) {
        const cached = memberDetailCacheRef.current.get(memberId);
        if (cached) return Promise.resolve(cached);

        const pending = memberDetailRequestRef.current.get(memberId);
        if (pending) return pending;
      } else {
        memberDetailCacheRef.current.delete(memberId);
      }

      let request: Promise<MemberDetail>;
      request = fetch(`/api/bige-fitness?memberId=${memberId}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(apiMessage(payload, "讀取合約失敗"));
          const detail = (payload.data || payload) as MemberDetail;
          memberDetailCacheRef.current.set(memberId, detail);
          return detail;
        })
        .finally(() => {
          if (memberDetailRequestRef.current.get(memberId) === request) {
            memberDetailRequestRef.current.delete(memberId);
          }
        });
      memberDetailRequestRef.current.set(memberId, request);
      return request;
    },
    [previewData],
  );

  const fetchScheduleMemberDetail = useCallback(
    (memberId: string, options: { force?: boolean } = {}) => {
      const previewDetail = previewData?.previewMemberDetails?.[memberId];
      if (previewDetail) return Promise.resolve(previewDetail);
      if (!options.force) {
        const cached =
          scheduleMemberDetailCacheRef.current.get(memberId) ||
          memberDetailCacheRef.current.get(memberId);
        if (cached) return Promise.resolve(cached);

        const pending = scheduleMemberDetailRequestRef.current.get(memberId);
        if (pending) return pending;
      } else {
        scheduleMemberDetailCacheRef.current.delete(memberId);
      }

      let request: Promise<MemberDetail>;
      request = fetch(
        `/api/bige-fitness?paymentMemberId=${encodeURIComponent(memberId)}`,
        { cache: "no-store" },
      )
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(apiMessage(payload, "讀取學員款項資料失敗"));
          const detail = (payload.data || payload) as MemberDetail;
          scheduleMemberDetailCacheRef.current.set(memberId, detail);
          return detail;
        })
        .finally(() => {
          if (scheduleMemberDetailRequestRef.current.get(memberId) === request) {
            scheduleMemberDetailRequestRef.current.delete(memberId);
          }
        });
      scheduleMemberDetailRequestRef.current.set(memberId, request);
      return request;
    },
    [previewData],
  );

  const prefetchScheduleMemberDetail = useCallback(
    (memberId: string) => {
      void fetchScheduleMemberDetail(memberId).catch(() => undefined);
    },
    [fetchScheduleMemberDetail],
  );

  const applyBoardData = useCallback((next: BoardData) => {
    hasBoardRef.current = true;
    for (const [memberId, detail] of Object.entries(
      next.paymentDetailsByMemberId || {},
    )) {
      scheduleMemberDetailCacheRef.current.set(memberId, detail);
    }
    startTransition(() => {
      setData(next);
      setSelectedCoach((current) => {
        if (next.coachScheduleScope === "all") {
          return current === "all" || next.coaches.some((coach) => coach.id === current)
            ? current
            : "all";
        }
        return next.coaches.some((coach) => coach.id === current)
          ? current
          : next.coaches[0]?.id || "";
      });
    });
  }, []);

  const requestBoard = useCallback(async (targetDate: string, preferCache = false) => {
    if (previewData) return previewData;

    const requestedRevision = readBigeBoardRevision(boardRevisionRef.current, targetDate);

    if (preferCache) {
      const cached = readBoardCache(boardCacheRef.current, targetDate);
      if (cached) return cached;
    }

    const activeRequest = boardRequestsRef.current.get(targetDate);
    if (activeRequest) return activeRequest;

    const requestedCoachOrderRevision = coachOrderRevisionRef.current;
    const requestedWhileCoachOrderPending = coachOrderPendingRef.current;
    const request = (async () => {
      const response = await fetch(`/api/bige-fitness?date=${targetDate}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(apiMessage(payload, "讀取營運日表失敗"));
      }
      const fetched = (payload.data || payload) as BoardData;
      const orderedCoachIds =
        requestedWhileCoachOrderPending ||
        requestedCoachOrderRevision !== coachOrderRevisionRef.current
          ? coachOrderIdsRef.current
          : null;
      const next = orderedCoachIds
        ? { ...fetched, coaches: applyCoachIdOrder(fetched.coaches, orderedCoachIds) }
        : fetched;
      if (isBigeBoardRevisionCurrent(boardRevisionRef.current, targetDate, requestedRevision)) {
        storeBoardCache(boardCacheRef.current, targetDate, next);
      }
      return next;
    })();

    boardRequestsRef.current.set(targetDate, request);
    try {
      return await request;
    } finally {
      if (boardRequestsRef.current.get(targetDate) === request) {
        boardRequestsRef.current.delete(targetDate);
      }
    }
  }, [previewData]);

  const prefetchBoardWindow = useCallback((centerDate: string) => {
    if (previewData) {
      boardPrefetchQueueRef.current?.clear();
      return;
    }
    boardPrefetchQueueRef.current?.replace(
      buildBigeBoardPrefetchDates(centerDate),
      {
        shouldSkip: (targetDate) =>
          boardCacheRef.current.has(targetDate) ||
          boardRequestsRef.current.has(targetDate),
        run: (targetDate) => requestBoard(targetDate, true),
      },
    );
  }, [previewData, requestBoard]);

  const loadBoard = useCallback(async (options: {
    silent?: boolean;
    targetDate?: string;
    preferCache?: boolean;
  } = {}) => {
    const targetDate = options.targetDate || boardDateRef.current;
    const requestedRevision = readBigeBoardRevision(boardRevisionRef.current, targetDate);
    boardPrefetchQueueRef.current?.prioritize(targetDate);
    if (!options.silent) setError("");
    if (!hasBoardRef.current) setLoading(true);

    try {
      const next = await requestBoard(targetDate, options.preferCache);
      if (boardDateRef.current !== targetDate) return;
      if (!isBigeBoardRevisionCurrent(boardRevisionRef.current, targetDate, requestedRevision)) {
        return;
      }
      applyBoardData(next);
      prefetchBoardWindow(targetDate);
    } catch (caught) {
      if (boardDateRef.current === targetDate) {
        setError(caught instanceof Error ? caught.message : "讀取營運日表失敗");
      }
    } finally {
      if (boardDateRef.current === targetDate) setLoading(false);
    }
  }, [applyBoardData, prefetchBoardWindow, requestBoard]);

  const animateBoardDate = useCallback((direction: "previous" | "next") => {
    if (boardDateAnimationTimerRef.current !== null) {
      window.clearTimeout(boardDateAnimationTimerRef.current);
    }
    setBoardDateDirection(direction);
    boardDateAnimationTimerRef.current = window.setTimeout(() => {
      setBoardDateDirection(null);
      boardDateAnimationTimerRef.current = null;
    }, 210);
  }, []);

  const selectBoardDate = useCallback((nextDate: string, direction?: "previous" | "next") => {
    if (!nextDate || nextDate === boardDateRef.current) return;
    const resolvedDirection = direction || (nextDate < boardDateRef.current ? "previous" : "next");
    boardPrefetchQueueRef.current?.prioritize(nextDate);
    const cached = readBoardCache(boardCacheRef.current, nextDate);
    boardDateRef.current = nextDate;
    setError("");
    animateBoardDate(resolvedDirection);
    if (cached) applyBoardData(cached);
    setDate(nextDate);
  }, [animateBoardDate, applyBoardData]);

  const shiftBoardDate = useCallback((days: -1 | 1) => {
    selectBoardDate(
      shiftDate(boardDateRef.current, days),
      days < 0 ? "previous" : "next",
    );
  }, [selectBoardDate]);

  const handleBoardWheel = useCallback((event: WheelEvent) => {
    if (tab !== "schedule") return;
    if (event.ctrlKey || event.metaKey || activeScheduleDrag || activeCoachDrag) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) return;

    event.preventDefault();
    const now = performance.now();
    const wheel = boardWheelRef.current;
    if (now - wheel.lastEventAt > 180) wheel.delta = 0;
    wheel.lastEventAt = now;
    wheel.delta += event.deltaY;

    if (Math.abs(wheel.delta) < 28 || now - wheel.lastSwitchAt < 360) return;
    wheel.lastSwitchAt = now;
    const direction = wheel.delta < 0 ? -1 : 1;
    wheel.delta = 0;
    shiftBoardDate(direction);
  }, [activeCoachDrag, activeScheduleDrag, shiftBoardDate, tab]);

  const clearScheduleNoteUndo = useCallback(() => {
    if (scheduleNoteUndoTimerRef.current !== null) {
      window.clearTimeout(scheduleNoteUndoTimerRef.current);
      scheduleNoteUndoTimerRef.current = null;
    }
    setScheduleNoteUndo(null);
  }, []);

  const armScheduleNoteUndo = useCallback((undo: ScheduleNoteUndo) => {
    if (scheduleNoteUndoTimerRef.current !== null) {
      window.clearTimeout(scheduleNoteUndoTimerRef.current);
    }
    const remaining = Date.parse(undo.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      scheduleNoteUndoTimerRef.current = null;
      setScheduleNoteUndo(null);
      return;
    }
    setScheduleNoteUndo(undo);
    scheduleNoteUndoTimerRef.current = window.setTimeout(() => {
      scheduleNoteUndoTimerRef.current = null;
      setScheduleNoteUndo((current) =>
        current?.noteId === undo.noteId ? null : current,
      );
    }, remaining);
  }, []);

  const reminderDate = shiftDate(date, 1);
  const loadReminders = useCallback(async () => {
    if (previewData) {
      setReminderData(previewData);
      return;
    }

    setRemindersLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/bige-fitness?date=${reminderDate}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(payload, "讀取明日 FA 聯絡清單失敗"));
      setReminderData((payload.data || payload) as BoardData);
    } catch (caught) {
      setReminderData(null);
      setError(caught instanceof Error ? caught.message : "讀取明日 FA 聯絡清單失敗");
    } finally {
      setRemindersLoading(false);
    }
  }, [previewData, reminderDate]);

  useLayoutEffect(() => {
    const isIpad =
      /iPad/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const devicePreview =
      process.env.NODE_ENV === "development"
        ? new URLSearchParams(window.location.search).get("device")
        : null;
    const forceIpadPreview = devicePreview === "ipad" || devicePreview === "ipad-pro";
    const ipadScreenLongEdge = Math.max(window.screen.width, window.screen.height);
    setUseIpadScheduleOverview(isIpad || forceIpadPreview);
    setUseIpadProDesktopLayout(
      devicePreview === "ipad-pro" || (isIpad && ipadScreenLongEdge >= 1190),
    );
  }, []);

  useEffect(() => {
    void loadBoard({
      silent: hasBoardRef.current,
      targetDate: date,
      preferCache: true,
    });
  }, [date, loadBoard]);

  useEffect(() => () => {
    boardPrefetchQueueRef.current?.clear();
    if (boardDateAnimationTimerRef.current !== null) {
      window.clearTimeout(boardDateAnimationTimerRef.current);
    }
  }, []);

  useEffect(() => () => {
    if (scheduleNoteUndoTimerRef.current !== null) {
      window.clearTimeout(scheduleNoteUndoTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!scheduleNoteUndo || !data) return;
    const undoStart = Date.parse(scheduleNoteUndo.startsAt);
    const undoEnd = Date.parse(scheduleNoteUndo.endsAt);
    const occupiesUndoCell = (item: {
      coach_id: string;
      starts_at: string;
      ends_at: string;
    }) =>
      item.coach_id === scheduleNoteUndo.coachId &&
      Date.parse(item.starts_at) < undoEnd &&
      Date.parse(item.ends_at) > undoStart;
    const occupied =
      data.bookings.some(occupiesUndoCell) || data.notes.some(occupiesUndoCell);
    if (occupied) clearScheduleNoteUndo();
  }, [clearScheduleNoteUndo, data, scheduleNoteUndo]);

  useEffect(() => {
    const toolbar = dateToolbarRef.current;
    const board = boardWrapRef.current;
    toolbar?.addEventListener("wheel", handleBoardWheel, { passive: false });
    board?.addEventListener("wheel", handleBoardWheel, { passive: false });
    return () => {
      toolbar?.removeEventListener("wheel", handleBoardWheel);
      board?.removeEventListener("wheel", handleBoardWheel);
    };
  }, [data?.businessDate, handleBoardWheel, loading, tab]);

  useEffect(() => {
    if (tab !== "reminders") return;
    void loadReminders();
  }, [loadReminders, tab]);

  useEffect(() => {
    if (previewData) return;
    let cancelled = false;

    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as SessionIdentity | null;
      })
      .then((identity) => {
        if (!cancelled && identity) setSessionIdentity(identity);
      });

    return () => {
      cancelled = true;
    };
  }, [previewData]);

  useEffect(() => {
    if (dialog !== "booking" || !selectedBooking) return;
    setStatusClock(Date.now());
    const timer = window.setInterval(() => setStatusClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [dialog, selectedBooking]);

  useEffect(() => {
    if (
      !success ||
      (scheduleEditUndo && !scheduleEditUndo.ready) ||
      (scheduleDeleteUndo && !scheduleDeleteUndo.ready) ||
      scheduleEditUndoSubmitting ||
      scheduleDeleteUndoSubmitting ||
      scheduleMoveUndoSubmitting
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSuccess("");
      setScheduleMoveUndo(null);
      setScheduleDeleteUndo(null);
      setScheduleEditUndo(null);
    }, BIGE_SCHEDULE_MOVE_UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [
    scheduleEditUndo,
    scheduleEditUndoSubmitting,
    scheduleDeleteUndo,
    scheduleDeleteUndoSubmitting,
    scheduleMoveUndo?.operationId,
    scheduleMoveUndoSubmitting,
    success,
  ]);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults({ members: [], trials: [] });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/bige-fitness?search=${encodeURIComponent(search.trim())}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || cancelled) return;

      const results = (payload.data || payload) as { members: Member[]; trials: any[] };
      setSearchResults(results);
      results.members.slice(0, 6).forEach((member) => {
        void fetchMemberDetail(member.id).catch(() => undefined);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fetchMemberDetail, previewData, search]);

  useEffect(() => {
    if (dialog !== "monthly-schedule" || monthlyMember || monthlySearch.trim().length < 1) {
      setMonthlySearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const response = await fetch(
        `/api/bige-fitness?search=${encodeURIComponent(monthlySearch.trim())}&memberScope=formal`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => null);
      if (!cancelled && response.ok) {
        setMonthlySearchResults(((payload.data || payload)?.members || []).slice(0, 12));
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dialog, monthlyMember, monthlySearch]);

  const post = async (
    body: Record<string, unknown>,
    options: {
      preserveFeedback?: boolean;
      errorPresentation?: "modal" | "inline";
    } = {},
  ) => {
    if (previewData) throw new Error("預覽模式不會寫入資料");
    setError("");
    if (!options.preserveFeedback) {
      setSuccess("");
      setScheduleMoveUndo(null);
      setScheduleDeleteUndo(null);
      setScheduleEditUndo(null);
    }
    let response: Response;
    try {
      response = await fetch("/api/bige-fitness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "網路連線失敗，請稍後再試";
      if (options.errorPresentation !== "inline") {
        showOperationAlert(message);
      }
      throw new Error(message);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = apiMessage(payload, "操作失敗");
      if (options.errorPresentation !== "inline") {
        showOperationAlert(message);
      }
      throw new Error(message);
    }
    return payload.data || payload;
  };

  const loadFaFeeRecipientOptions = useCallback(async () => {
    if (previewData || faFeeRecipientOptionsLoaded || faFeeRecipientOptionsLoading) return;
    setFaFeeRecipientOptionsLoading(true);
    setFaFeeRecipientOptionsError("");
    try {
      const response = await fetch("/api/bige-fitness?faFeeRecipients=1", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(apiMessage(payload, "讀取員工名單失敗"));
      }
      const result = (payload.data || payload) as { options?: FaFeeRecipientOption[] };
      setFaFeeRecipientOptions(result.options || []);
      setFaFeeRecipientOptionsLoaded(true);
    } catch (caught) {
      setFaFeeRecipientOptionsError(
        caught instanceof Error ? caught.message : "讀取員工名單失敗",
      );
    } finally {
      setFaFeeRecipientOptionsLoading(false);
    }
  }, [faFeeRecipientOptionsLoaded, faFeeRecipientOptionsLoading, previewData]);

  const loadMonthlyMemberSchedule = useCallback(async (member: Member, month: string) => {
    setMonthlyLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/bige-fitness?memberScheduleMemberId=${encodeURIComponent(member.id)}&month=${encodeURIComponent(month)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(payload, "讀取會員月排課失敗"));
      const next = (payload.data || payload) as MonthlyScheduleData;
      setMonthlyData(next);
      setMonthlyCoachId((current) => current || next.coaches[0]?.id || "");
    } catch (caught) {
      setMonthlyData(null);
      showOperationAlert(
        caught instanceof Error ? caught.message : "讀取會員月排課失敗",
        "無法讀取會員月排課",
      );
    } finally {
      setMonthlyLoading(false);
    }
  }, [showOperationAlert]);

  useEffect(() => {
    if (dialog === "monthly-schedule" && monthlyMember) {
      void loadMonthlyMemberSchedule(monthlyMember, monthlyMonth);
    }
  }, [dialog, loadMonthlyMemberSchedule, monthlyMember, monthlyMonth]);

  const requestMonthlySchedulePreflight = useCallback(async (signal?: AbortSignal) => {
    if (!monthlyMember || !monthlyCoachId || monthlyDates.length === 0) return null;
    const response = await fetch("/api/bige-fitness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "check_schedule_batch",
        memberId: monthlyMember.id,
        coachId: monthlyCoachId,
        operationKind: monthlyOperationKind,
        courseType: monthlyCourseType,
        startsAt: monthlyDates.map((day) =>
          new Date(`${day}T${monthlyTime}:00+08:00`).toISOString(),
        ),
      }),
      signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiMessage(payload, "檢查排課衝突失敗"));
    return (payload.data || payload) as MonthlySchedulePreflight;
  }, [
    monthlyCoachId,
    monthlyCourseType,
    monthlyDates,
    monthlyMember,
    monthlyOperationKind,
    monthlyTime,
  ]);

  useEffect(() => {
    if (dialog !== "monthly-schedule") return;
    if (!monthlyMember || !monthlyCoachId || monthlyDates.length === 0) {
      setMonthlyPreflight(null);
      setMonthlyPreflightError("");
      setMonthlyPreflightLoading(false);
      return;
    }

    const controller = new AbortController();
    setMonthlyPreflight(null);
    setMonthlyPreflightError("");
    setMonthlyPreflightLoading(true);
    const timer = window.setTimeout(() => {
      void requestMonthlySchedulePreflight(controller.signal)
        .then((preview) => setMonthlyPreflight(preview))
        .catch((caught) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setMonthlyPreflightError(
            caught instanceof Error ? caught.message : "檢查排課衝突失敗",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setMonthlyPreflightLoading(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    dialog,
    monthlyCoachId,
    monthlyDates.length,
    monthlyMember,
    requestMonthlySchedulePreflight,
  ]);

  const openMonthlySchedule = () => {
    setMonthlySearch("");
    setMonthlySearchResults([]);
    setMonthlyMember(null);
    setMonthlyData(null);
    setMonthlyCoachId("");
    setMonthlyMonth(date.slice(0, 7));
    setMonthlyDates([]);
    setMonthlyNote("");
    setMonthlyPreflight(null);
    setMonthlyPreflightError("");
    setMonthlyBatchResult(null);
    setDialog("monthly-schedule");
  };

  const submitMonthlySchedule = async (event: FormEvent) => {
    event.preventDefault();
    if (!monthlyMember || !monthlyCoachId || monthlyDates.length === 0) return;
    setMonthlySubmitting(true);
    setError("");
    try {
      const preview = await requestMonthlySchedulePreflight();
      if (!preview) return;
      setMonthlyPreflight(preview);
      setMonthlyPreflightError("");
      setDialog("monthly-schedule-confirm");
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "檢查排課衝突失敗",
        "無法檢查批次排課",
      );
    } finally {
      setMonthlySubmitting(false);
    }
  };

  const confirmMonthlySchedule = async () => {
    if (!monthlyMember || !monthlyCoachId || !monthlyPreflight?.available.length) return;
    setMonthlySubmitting(true);
    setError("");
    try {
      const preview = monthlyPreflight;
      const result = (await post({
        action: "create_schedule_batch",
        memberId: monthlyMember.id,
        coachId: monthlyCoachId,
        operationKind: monthlyOperationKind,
        courseType: monthlyCourseType,
        startsAt: preview.available.map((slot) => slot.startsAt),
        note: monthlyNote.trim() || null,
        idempotencyKey: `month-${monthlyMember.id}-${Date.now()}`,
      })) as {
        created?: Array<{ startsAt: string; item: unknown }>;
        failures?: Array<{ startsAt: string; message: string }>;
      };
      const batchResult: MonthlyScheduleBatchResult = {
        created: result.created || [],
        skipped: preview.conflicts,
        failures: result.failures || [],
      };
      setMonthlyBatchResult(batchResult);
      setMonthlyDates(
        Array.from(
          new Set([
            ...batchResult.skipped.map((conflict) => taipeiDateKey(conflict.startsAt)),
            ...batchResult.failures.map((failure) => taipeiDateKey(failure.startsAt)),
          ]),
        ).sort(),
      );
      boardCacheRef.current.clear();
      await loadMonthlyMemberSchedule(monthlyMember, monthlyMonth);
      if (date.startsWith(monthlyMonth)) void loadBoard({ silent: true });
      setDialog("monthly-schedule-result");
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "整月排課失敗",
        "無法完成整月排課",
      );
    } finally {
      setMonthlySubmitting(false);
    }
  };

  const openScheduleActivity = async () => {
    setDialog("activity");
    setActivityLoading(true);
    setActivityData(null);
    setError("");
    try {
      const response = await fetch(`/api/bige-fitness?activityDate=${date}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(payload, "讀取操作紀錄失敗"));
      setActivityData((payload.data || payload) as ScheduleActivityData);
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "讀取操作紀錄失敗",
        "無法讀取操作紀錄",
      );
    } finally {
      setActivityLoading(false);
    }
  };

  const isBusinessClosed = Boolean(data?.businessDay?.is_closed);
  const frontdeskName = data?.businessDay?.frontdesk_name?.trim() || "";

  useEffect(() => {
    setScheduleDragUnlocked(Boolean(previewData?.canManageSchedule));
    setActiveScheduleDrag(null);
  }, [date, isBusinessClosed, previewData?.canManageSchedule]);

  useEffect(() => {
    if (!scheduleDragUnlocked) return;
    if (previewData) return;

    let inactivityTimer = window.setTimeout(() => {
      setScheduleDragUnlocked(false);
      setActiveScheduleDrag(null);
    }, 30_000);

    const resetInactivityTimer = () => {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => {
        setScheduleDragUnlocked(false);
        setActiveScheduleDrag(null);
      }, 30_000);
    };

    window.addEventListener("pointerdown", resetInactivityTimer, { passive: true });
    window.addEventListener("touchstart", resetInactivityTimer, { passive: true });
    window.addEventListener("wheel", resetInactivityTimer, { passive: true });
    window.addEventListener("keydown", resetInactivityTimer);

    return () => {
      window.clearTimeout(inactivityTimer);
      window.removeEventListener("pointerdown", resetInactivityTimer);
      window.removeEventListener("touchstart", resetInactivityTimer);
      window.removeEventListener("wheel", resetInactivityTimer);
      window.removeEventListener("keydown", resetInactivityTimer);
    };
  }, [previewData, scheduleDragUnlocked]);

  const persistBusinessDay = async (changes: {
    isClosed?: boolean;
    closureLabel?: string | null;
    frontdeskName?: string | null;
  }) => {
    if (businessDaySubmitting) return;
    setBusinessDaySubmitting(true);
    setError("");
    try {
      const result = (await post({
        action: "update_business_day",
        businessDate: date,
        ...changes,
      })) as { businessDay?: BoardData["businessDay"] };
      const nextBusinessDay = result.businessDay || null;
      setData((current) =>
        current ? { ...current, businessDay: nextBusinessDay } : current,
      );
      boardCacheRef.current.delete(date);
      setSuccess(
        changes.isClosed === true
          ? "已設定為館休日。"
          : changes.isClosed === false
            ? "已取消館休日。"
            : "當日櫃台人員已更新。",
      );
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "更新營業日設定失敗",
        "無法更新營業日設定",
      );
    } finally {
      setBusinessDaySubmitting(false);
    }
  };

  const members = useMemo(
    () => new Map((data?.members || []).map((member) => [member.id, member])),
    [data?.members],
  );
  const reminderMembers = useMemo(
    () => new Map((reminderData?.members || []).map((member) => [member.id, member])),
    [reminderData?.members],
  );
  const trialBookings = useMemo(
    () => new Map((data?.trialBookings || []).map((booking) => [booking.id, booking])),
    [data?.trialBookings],
  );
  const visibleCoaches = useMemo(() => {
    const coaches = data?.coaches || [];
    if (!hideOffCoaches) return coaches;
    const offCoachIds = new Set(
      (data?.coachDayStatuses || [])
        .filter((status) => status.status === "off")
        .map((status) => status.coach_id),
    );
    return coaches.filter((coach) => !offCoachIds.has(coach.id));
  }, [data?.coachDayStatuses, data?.coaches, hideOffCoaches]);

  const monthlyCoachOptions = useMemo(() => {
    const coachesById = new Map<string, Coach>();
    for (const coach of data?.coaches || []) coachesById.set(coach.id, coach);
    for (const coach of monthlyData?.coaches || []) {
      if (!coachesById.has(coach.id)) coachesById.set(coach.id, coach);
    }
    return Array.from(coachesById.values());
  }, [data?.coaches, monthlyData?.coaches]);

  const monthlyTimeOptions = useMemo(
    () => monthlyScheduleTimeOptions(monthlyOperationKind),
    [monthlyOperationKind],
  );
  const monthlySelectedCoach = useMemo(
    () => monthlyCoachOptions.find((coach) => coach.id === monthlyCoachId) || null,
    [monthlyCoachId, monthlyCoachOptions],
  );
  const monthlyConflictByDate = useMemo(
    () =>
      new Map(
        (monthlyPreflight?.conflicts || []).map((conflict) => [
          taipeiDateKey(conflict.startsAt),
          conflict,
        ]),
      ),
    [monthlyPreflight],
  );

  useEffect(() => {
    if (monthlyTimeOptions.includes(monthlyTime)) return;
    setMonthlyTime(monthlyTimeOptions.at(-1) || "09:00");
  }, [monthlyTime, monthlyTimeOptions]);

  useEffect(() => {
    setMonthlyCoachId((current) => {
      if (current && monthlyCoachOptions.some((coach) => coach.id === current)) return current;
      return monthlyCoachOptions[0]?.id || "";
    });
  }, [monthlyCoachOptions]);

  useEffect(() => {
    if (selectedCoach === "all" || visibleCoaches.some((coach) => coach.id === selectedCoach)) return;
    setSelectedCoach(data?.coachScheduleScope === "all" ? "all" : visibleCoaches[0]?.id || "");
  }, [data?.coachScheduleScope, selectedCoach, visibleCoaches]);

  const scheduleBookingLabel = useCallback(
    (booking: Booking) => {
      if (booking.operation_kind === "trial") {
        const trial = booking.trial_booking_id
          ? trialBookings.get(booking.trial_booking_id)
          : null;
        return `FA · ${trial?.name || members.get(booking.member_id)?.full_name || "體驗學員"}`;
      }
      return `${members.get(booking.member_id)?.full_name || "學員"} · ${BIGE_COURSE_LABELS[booking.course_type]}`;
    },
    [members, trialBookings],
  );

  const deleteScheduleBooking = async (
    booking: Booking,
    options: { closeBookingDialog?: boolean } = {},
  ) => {
    if (!data || scheduleDeleteSubmitting) return;
    const label = scheduleBookingLabel(booking);
    const confirmed = window.confirm(
      `確定刪除「${label}」在 ${formatDateTime(booking.starts_at)} 的預約嗎？\n\n只會刪除這筆預約，不會刪除會員資料。`,
    );
    if (!confirmed) return;

    const operationDate = boardDateRef.current;
    const previousData = data;
    const previousCachedData = boardCacheRef.current.get(operationDate);
    const optimisticData = applyOptimisticScheduleBookingDelete(data, booking.id);

    setScheduleDeleteSubmitting(true);
    void runOptimisticScheduleMutation({
      apply: () => {
        if (options.closeBookingDialog) {
          setDialog(null);
          setSelectedBooking(null);
        }
        setError("");
        setSuccess("已刪除此預約；會員資料未變更");
        setScheduleMoveUndo(null);
        setScheduleEditUndo(null);
        setScheduleDeleteUndo({
          bookingId: booking.id,
          businessDate: operationDate,
          ready: false,
        });
        storeBoardCache(boardCacheRef.current, operationDate, optimisticData);
        if (boardDateRef.current === operationDate) setData(optimisticData);
      },
      request: () =>
        post(
          { action: "delete_schedule_booking", bookingId: booking.id },
          { preserveFeedback: true },
        ),
      commit: () => {
        setScheduleDeleteSubmitting(false);
        setScheduleDeleteUndo((current) =>
          current?.bookingId === booking.id ? { ...current, ready: true } : current,
        );
        void loadBoard({ silent: true, targetDate: operationDate });
      },
      rollback: (caught) => {
        if (previousCachedData) {
          storeBoardCache(boardCacheRef.current, operationDate, previousCachedData);
        } else {
          boardCacheRef.current.delete(operationDate);
        }
        if (boardDateRef.current === operationDate) setData(previousData);
        setSuccess("");
        setScheduleDeleteUndo(null);
        setScheduleDeleteSubmitting(false);
        showOperationAlert(
          caught instanceof Error ? caught.message : "刪除預約失敗",
          "無法刪除預約",
        );
      },
    }).catch(() => undefined);
  };

  const handleScheduleDragStart = useCallback((event: DragStartEvent) => {
    const payload = event.active.data.current as BigeDragPayload | undefined;
    if (!payload) return;
    setSuccess("");
    if (payload.kind === "coach") {
      setError("");
      setActiveScheduleDrag(null);
      setActiveCoachDrag(payload.item);
      return;
    }
    if (scheduleMoveSubmitting || scheduleDeleteSubmitting) {
      setActiveScheduleDrag(null);
      setError("");
      setScheduleDragNotice("上一筆課程異動仍在同步，請稍候。");
      return;
    }
    if (isBusinessClosed) {
      setActiveScheduleDrag(null);
      setError("");
      setScheduleDragNotice("館休日不可新增、移動或交換課程。");
      return;
    }
    if (!scheduleDragUnlocked) {
      setActiveScheduleDrag(null);
      setError("");
      setScheduleDragNotice("課表目前已鎖定，請先點選上方鎖定按鈕解鎖。");
      return;
    }
    setActiveCoachDrag(null);
    if (payload.kind === "note") {
      setActiveScheduleDrag(null);
      setError("");
      setScheduleDragNotice("自由文字不能拖拉、交換或覆蓋，請直接點擊原資料編輯。");
      return;
    }
    if (!payload.movable) {
      setActiveScheduleDrag(null);
      setError("");
      setScheduleDragNotice("已完成、已取消、已報到或已核銷的課程不能拖拉。");
      return;
    }
    setError("");
    setScheduleDragNotice("");
    setActiveScheduleDrag(payload);
  }, [isBusinessClosed, scheduleDeleteSubmitting, scheduleDragUnlocked, scheduleMoveSubmitting]);

  const persistCoachOrder = async (activeCoachId: string, targetCoachId: string) => {
    if (!data?.canReorderCoaches || coachOrderSubmitting) return;
    const previousCoaches = data.coaches;
    const nextCoaches = reorderCoachList(previousCoaches, activeCoachId, targetCoachId);
    if (nextCoaches.every((coach, index) => coach.id === previousCoaches[index]?.id)) return;
    const previousCoachIds = previousCoaches.map((coach) => coach.id);
    const nextCoachIds = nextCoaches.map((coach) => coach.id);

    setCoachOrderSubmitting(true);
    setError("");
    coachOrderRevisionRef.current += 1;
    coachOrderPendingRef.current = true;
    coachOrderIdsRef.current = nextCoachIds;
    synchronizeCoachOrderAcrossBoards(boardCacheRef.current, nextCoachIds);
    setData((current) => current ? { ...current, coaches: nextCoaches } : current);
    try {
      await post({
        action: "reorder_schedule_coaches",
        coachIds: nextCoachIds,
      });
      coachOrderPendingRef.current = false;
      setSuccess("教練順序已更新");
      void loadBoard({ silent: true });
    } catch (caught) {
      coachOrderPendingRef.current = false;
      coachOrderIdsRef.current = previousCoachIds;
      synchronizeCoachOrderAcrossBoards(boardCacheRef.current, previousCoachIds);
      setData((current) => current ? { ...current, coaches: previousCoaches } : current);
      showOperationAlert(
        caught instanceof Error ? caught.message : "儲存教練順序失敗",
        "無法儲存教練順序",
      );
    } finally {
      setCoachOrderSubmitting(false);
    }
  };

  const handleScheduleDragEnd = (event: DragEndEvent) => {
      setActiveScheduleDrag(null);
      setActiveCoachDrag(null);
      const source = event.active.data.current as BigeDragPayload | undefined;
      if (source?.kind === "coach") {
        const target = event.over?.data.current as CoachDropPayload | undefined;
        if (target?.kind === "coach-target") {
          void persistCoachOrder(source.item.id, target.coachId);
        }
        return;
      }

      if (scheduleMoveSubmitting || scheduleDeleteSubmitting) {
        setError("");
        setScheduleDragNotice("上一筆課程異動仍在同步，請稍候。");
        return;
      }

      lastScheduleDragAtRef.current = Date.now();
      const target = event.over?.data.current as
        | ScheduleDropPayload
        | ScheduleDeleteDropPayload
        | undefined;
      if (isBusinessClosed) {
        if (source?.kind === "booking") {
          setError("");
          setScheduleDragNotice("館休日不可新增、移動或交換課程。");
        }
        return;
      }
      if (!data || !source || source.kind !== "booking" || !source.movable || !target) return;

      if (target.kind === "schedule-delete") {
        const statusWindow = getBigeCourseStatusWindow({
          startsAt: source.item.starts_at,
          endsAt: source.item.ends_at,
          now: Date.now(),
        });
        const canDeleteNow =
          canCancelBigeCourseAnytime(sessionIdentity || {}) || statusWindow.allowed;
        if (!canDeleteNow) {
          setError("");
          setScheduleDragNotice("只能在預約前 30 分鐘至結束後 30 分鐘內刪除預約。");
          return;
        }
        void deleteScheduleBooking(source.item);
        return;
      }

      const analysis = analyzeScheduleDrop({
        bookings: data.bookings,
        notes: data.notes,
        sourceBookingId: source.item.id,
        targetCoachId: target.coachId,
        targetStartsAt: target.startsAt,
      });
      if (!analysis.ok) {
        setError("");
        setScheduleDragNotice(analysis.message);
        return;
      }
      setError("");
      setScheduleDragNotice("");
      setOverwriteConfirmation(false);
      setPendingScheduleMove(analysis.plan);
  };

  const closeScheduleMoveDialog = () => {
    if (scheduleMoveSubmitting) return;
    setPendingScheduleMove(null);
    setOverwriteConfirmation(false);
  };

  const executeScheduleMove = async (mode: "move" | "swap" | "overwrite") => {
    if (!pendingScheduleMove || scheduleMoveSubmitting) return;
    const plan = pendingScheduleMove;
    const operationDate = boardDateRef.current;
    const previousData = data;
    const previousCachedData = boardCacheRef.current.get(operationDate);
    const optimisticItems = buildOptimisticScheduleMoveResult(plan, mode);

    setScheduleMoveSubmitting(true);
    setPendingScheduleMove(null);
    setOverwriteConfirmation(false);
    setError("");
    setData((current) => {
      if (!current) return current;
      const bookings = applyScheduleMoveResult(current.bookings, optimisticItems);
      const assistantToState = buildOptimisticFaAssistantToState({
        bookings,
        notes: current.notes,
        coaches: current.coaches,
        offCoachIds: (current.coachDayStatuses || [])
          .filter((status) => status.status === "off")
          .map((status) => status.coach_id),
      });
      const next = {
        ...current,
        bookings,
        notes: assistantToState.notes,
        faAssistantToConflicts: assistantToState.conflicts,
        classroomConflicts: buildBigeClassroomConflicts(bookings),
      };
      storeBoardCache(boardCacheRef.current, operationDate, next);
      return next;
    });

    try {
      const result = (await post(
        {
          action: "move_schedule_booking",
          bookingId: plan.source.id,
          targetCoachId: plan.targetCoachId,
          targetStartsAt: plan.targetStartsAt,
          mode,
        },
        { errorPresentation: "inline" },
      )) as { item?: { operationId?: string; items?: ScheduleMoveResultItem[] } };
      const message =
        mode === "swap"
          ? "課程已交換，操作時間與變更內容已留存"
          : mode === "overwrite"
            ? "課程已覆蓋，被取代的課程已取消並保留操作紀錄"
            : "課程已移動，操作時間與變更內容已留存";
      setSuccess(message);
      setScheduleMoveUndo(
        result.item?.operationId
          ? { operationId: result.item.operationId, businessDate: operationDate }
          : null,
      );
      const changedItems = result.item?.items || [];
      if (changedItems.length > 0) {
        const cached = boardCacheRef.current.get(operationDate);
        if (cached) {
          const bookings = applyScheduleMoveResult(cached.bookings, changedItems);
          const assistantToState = buildOptimisticFaAssistantToState({
            bookings,
            notes: cached.notes,
            coaches: cached.coaches,
            offCoachIds: (cached.coachDayStatuses || [])
              .filter((status) => status.status === "off")
              .map((status) => status.coach_id),
          });
          storeBoardCache(boardCacheRef.current, operationDate, {
            ...cached,
            bookings,
            notes: assistantToState.notes,
            faAssistantToConflicts: assistantToState.conflicts,
            classroomConflicts: buildBigeClassroomConflicts(bookings),
          });
        }
        if (boardDateRef.current === operationDate) {
          setData((current) => {
            if (!current) return current;
            const bookings = applyScheduleMoveResult(current.bookings, changedItems);
            const assistantToState = buildOptimisticFaAssistantToState({
              bookings,
              notes: current.notes,
              coaches: current.coaches,
              offCoachIds: (current.coachDayStatuses || [])
                .filter((status) => status.status === "off")
                .map((status) => status.coach_id),
            });
            return {
              ...current,
              bookings,
              notes: assistantToState.notes,
              faAssistantToConflicts: assistantToState.conflicts,
              classroomConflicts: buildBigeClassroomConflicts(bookings),
            };
          });
        }
      }
      void loadBoard({ silent: true, targetDate: operationDate });
    } catch (caught) {
      if (previousCachedData) {
        storeBoardCache(boardCacheRef.current, operationDate, previousCachedData);
      } else {
        boardCacheRef.current.delete(operationDate);
      }
      if (boardDateRef.current === operationDate) {
        setData(previousData);
      }
      setError("");
      setScheduleDragNotice(caught instanceof Error ? caught.message : "調整課表失敗");
    } finally {
      setScheduleMoveSubmitting(false);
    }
  };

  const undoScheduleMove = async () => {
    const undo = scheduleMoveUndo;
    if (!undo || scheduleMoveUndoSubmitting) return;

    setScheduleMoveUndoSubmitting(true);
    try {
      await post({
        action: "undo_schedule_booking_move",
        operationId: undo.operationId,
      });
      boardCacheRef.current.delete(undo.businessDate);
      setSuccess("課程移動已復原");
      await loadBoard({ silent: true, targetDate: undo.businessDate });
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "復原課表移動失敗",
        "無法復原課表移動",
      );
    } finally {
      setScheduleMoveUndoSubmitting(false);
    }
  };

  const undoScheduleDelete = async () => {
    const undo = scheduleDeleteUndo;
    if (!undo?.ready || scheduleDeleteUndoSubmitting) return;

    setScheduleDeleteUndoSubmitting(true);
    try {
      await post(
        { action: "restore_cancelled_booking", bookingId: undo.bookingId },
        { preserveFeedback: true },
      );
      boardCacheRef.current.delete(undo.businessDate);
      setScheduleDeleteUndo(null);
      setSuccess("已復原剛才刪除的預約");
      await loadBoard({ silent: true, targetDate: undo.businessDate });
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "復原預約失敗",
        "無法復原預約",
      );
    } finally {
      setScheduleDeleteUndoSubmitting(false);
    }
  };

  const undoScheduleEdit = async () => {
    const undo = scheduleEditUndo;
    if (!undo || !undo.ready || scheduleEditUndoSubmitting) return;

    const previousData = data;
    const previousCachedData = boardCacheRef.current.get(undo.businessDate);
    const requestBody =
      undo.kind === "booking"
        ? {
            action: "edit_schedule_booking",
            bookingId: undo.item.id,
            coachId: undo.item.coach_id,
            courseType: undo.item.course_type,
            startsAt: undo.item.starts_at,
            endsAt: undo.item.ends_at,
            note: undo.item.note,
          }
        : {
            action: "edit_schedule_note",
            noteId: undo.item.id,
            coachId: undo.item.coach_id,
            startsAt: undo.item.starts_at,
            endsAt: undo.item.ends_at,
            content: undo.item.content,
          };

    setScheduleEditUndoSubmitting(true);
    setError("");
    if (previousCachedData) {
      storeBoardCache(
        boardCacheRef.current,
        undo.businessDate,
        applyScheduleEditUndo(previousCachedData, undo),
      );
    }
    if (boardDateRef.current === undo.businessDate) {
      setData((current) => (current ? applyScheduleEditUndo(current, undo) : current));
    }

    try {
      await post(requestBody, { preserveFeedback: true });
      setScheduleEditUndo(null);
      setSuccess("原排課資料已復原");
      void loadBoard({ silent: true, targetDate: undo.businessDate });
    } catch (caught) {
      if (previousCachedData) {
        storeBoardCache(boardCacheRef.current, undo.businessDate, previousCachedData);
      } else {
        boardCacheRef.current.delete(undo.businessDate);
      }
      if (boardDateRef.current === undo.businessDate) setData(previousData);
      showOperationAlert(
        caught instanceof Error ? caught.message : "復原排課資料失敗",
        "無法復原排課資料",
      );
    } finally {
      setScheduleEditUndoSubmitting(false);
    }
  };

  const loadMember = async (member: Member, options: { force?: boolean } = {}) => {
    const requestId = memberLoadRequestIdRef.current + 1;
    memberLoadRequestIdRef.current = requestId;
    setSelectedMember(member);
    setMemberDetailError("");
    setError("");
    if (options.force) scheduleMemberDetailCacheRef.current.delete(member.id);

    const cached = options.force ? null : memberDetailCacheRef.current.get(member.id);
    if (cached) {
      setMemberDetail(cached);
      setDialog("member");
      return;
    }

    try {
      const detail = await fetchMemberDetail(member.id, options);
      if (memberLoadRequestIdRef.current !== requestId) return;
      setMemberDetail(detail);
      setDialog("member");
    } catch (caught) {
      if (memberLoadRequestIdRef.current !== requestId) return;
      const message = caught instanceof Error ? caught.message : "讀取合約失敗";
      setMemberDetail(null);
      setMemberDetailError(message);
      setDialog("member");
    }
  };

  const loadScheduleMemberDetail = async (
    memberId: string,
    options: { force?: boolean } = {},
  ) => {
    const requestId = scheduleMemberLoadRequestIdRef.current + 1;
    scheduleMemberLoadRequestIdRef.current = requestId;
    setScheduleMemberDetailError("");
    if (options.force) memberDetailCacheRef.current.delete(memberId);

    const cached = options.force
      ? null
      : scheduleMemberDetailCacheRef.current.get(memberId) ||
        memberDetailCacheRef.current.get(memberId);
    if (cached) {
      setScheduleMemberDetail(cached);
      setScheduleMemberDetailLoading(false);
      return cached;
    }

    setScheduleMemberDetail(null);
    setScheduleMemberDetailLoading(true);
    try {
      const detail = await fetchScheduleMemberDetail(memberId, options);
      if (scheduleMemberLoadRequestIdRef.current !== requestId) return null;
      setScheduleMemberDetail(detail);
      return detail;
    } catch (caught) {
      if (scheduleMemberLoadRequestIdRef.current !== requestId) return null;
      setScheduleMemberDetailError(
        caught instanceof Error ? caught.message : "讀取學員付款資料失敗",
      );
      return null;
    } finally {
      if (scheduleMemberLoadRequestIdRef.current === requestId) {
        setScheduleMemberDetailLoading(false);
      }
    }
  };

  const openHourSlot = (coachId: string, hour: number) => {
    if (coachView || isBusinessClosed) return;
    setEditingSchedule(null);
    setSelectedCoach(coachId);
    setSlotChoice({ coachId, hour });
    setDialog("slot-time");
  };

  const openSlot = (coachId: string, time: string) => {
    if (coachView || isBusinessClosed) return;
    setSelectedCoach(coachId);
    setEditingSchedule(null);
    setScheduleDraft({
      time,
      memberId: "",
      trialBookingId: "",
      operationKind: "pt",
      courseType: "weight_training",
      duration: 60,
      note: "",
    });
    setScheduleSearch("");
    setScheduleResults({ members: [], trials: [] });
    setSelectedScheduleMemberResult(null);
    setSelectedScheduleTrialResult(null);
    setSlotChoice(null);
    setDialog("schedule");
  };

  const openScheduleCell = (
    coachId: string,
    hour: number,
    booking: Booking | null,
    note: ScheduleNote | null,
  ) => {
    if (Date.now() - lastScheduleDragAtRef.current < 350) return;
    if (booking && coachView) {
      void loadScheduleMemberDetail(booking.member_id);
      setSelectedBooking(booking);
      setTrialOutcomePrompt(false);
      setTrialConversionEditing(false);
      setDialog("booking");
      return;
    }
    if (coachView) return;
    if (isBusinessClosed) {
      if (booking || note) {
        showOperationAlert("館休日僅供查看既有衝突，不能編輯排課。", "無法編輯排課");
      }
      return;
    }
    if (booking && !canEditBigeScheduleBooking(booking.status)) {
      void loadScheduleMemberDetail(booking.member_id);
      setEditingSchedule(null);
      setSelectedBooking(booking);
      setTrialOutcomePrompt(false);
      setTrialConversionEditing(false);
      setDialog("booking");
      return;
    }
    if (!booking && !note) {
      openHourSlot(coachId, hour);
      return;
    }

    setSelectedCoach(coachId);
    setSlotChoice(null);
    setScheduleResults({ members: [], trials: [] });
    setSelectedScheduleMemberResult(null);
    setSelectedScheduleTrialResult(null);
    if (booking) {
      void loadScheduleMemberDetail(booking.member_id);
      setEditingSchedule({ kind: "booking", item: booking });
      setScheduleDraft({
        time: slotKey(booking.starts_at),
        memberId: booking.member_id,
        trialBookingId: "",
        operationKind: booking.operation_kind,
        courseType: booking.course_type,
        duration:
          booking.operation_kind === "trial"
            ? BIGE_FA_DURATION_MINUTES
            : Math.max(
                30,
                Math.round(
                  (new Date(booking.ends_at).getTime() -
                    new Date(booking.starts_at).getTime()) /
                    60_000,
                ),
              ),
        note: booking.note || "",
      });
      setScheduleSearch(members.get(booking.member_id)?.full_name || "");
    } else if (note) {
      setEditingSchedule({ kind: "note", item: note });
      setScheduleDraft({
        time: slotKey(note.starts_at),
        memberId: "",
        trialBookingId: "",
        operationKind: "pt",
        courseType: "weight_training",
        duration: Math.max(
          30,
          Math.round((new Date(note.ends_at).getTime() - new Date(note.starts_at).getTime()) / 60_000),
        ),
        note: note.content,
      });
      setScheduleSearch("");
    }
    setDialog("schedule");
  };

  const [scheduleDraft, setScheduleDraft] = useState({
    time: "09:00",
    memberId: "",
    trialBookingId: "",
    operationKind: "pt" as "pt" | "trial",
    courseType: "weight_training" as BigeCourseType,
    duration: 60,
    note: "",
  });
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [scheduleResults, setScheduleResults] = useState<{ members: Member[]; trials: any[] }>({
    members: [],
    trials: [],
  });
  const [selectedScheduleMemberResult, setSelectedScheduleMemberResult] = useState<Member | null>(null);
  const [selectedScheduleTrialResult, setSelectedScheduleTrialResult] = useState<TrialBookingSummary | null>(null);

  useEffect(() => {
    if (previewData) return;
    if (dialog !== "schedule" || editingSchedule) {
      setScheduleResults({ members: [], trials: [] });
      return;
    }
    if (!scheduleSearch.trim()) {
      setScheduleResults({ members: [], trials: [] });
      return;
    }
    const timer = window.setTimeout(async () => {
      const response = await fetch(
        `/api/bige-fitness?search=${encodeURIComponent(scheduleSearch.trim())}&memberScope=formal`,
      );
      const payload = await response.json().catch(() => null);
      if (response.ok) setScheduleResults(payload.data || payload);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [dialog, editingSchedule, previewData, scheduleSearch]);

  const submitSchedule = async (event: FormEvent) => {
    event.preventDefault();
    const startsAt = `${date}T${scheduleDraft.time}:00+08:00`;
    const scheduleDuration =
      scheduleDraft.operationKind === "trial"
        ? BIGE_FA_DURATION_MINUTES
        : scheduleDraft.duration;
    const endsAt = new Date(
      new Date(startsAt).getTime() + scheduleDuration * 60_000,
    ).toISOString();
    const selectedScheduleTarget =
      scheduleDraft.operationKind === "pt"
        ? scheduleDraft.memberId
        : scheduleDraft.trialBookingId;
    const freeText = scheduleDraft.note.trim();
    const isNewFreeText = !editingSchedule && !selectedScheduleTarget && Boolean(freeText);

    if (editingSchedule) {
      const editTarget = editingSchedule;
      if (editTarget.kind === "note" && !freeText) {
        showOperationAlert("請輸入自由文字", "排課內容尚未完成");
        return;
      }

      const conflict = data
        ? findScheduleEditConflict({
            bookings: data.bookings,
            notes: data.notes,
            coachId: selectedCoach,
            startsAt,
            endsAt,
            excludeBookingId: editTarget.kind === "booking" ? editTarget.item.id : undefined,
            excludeNoteId: editTarget.kind === "note" ? editTarget.item.id : undefined,
          })
        : null;
      if (conflict) {
        const conflictTime = slotKey(conflict.item.starts_at);
        const message =
          conflict.kind === "booking"
            ? (() => {
                const memberName = members.get(conflict.item.member_id)?.full_name || "該學員";
                return `調整後會與 ${conflictTime} ${memberName} 的課程重疊。請先取消 ${conflictTime} ${memberName} 的課程，再進行操作。`;
              })()
            : `調整後會與 ${conflictTime}「${conflict.item.content}」的排課資料重疊。請先刪除或調整該筆資料，再進行操作。`;
        showOperationAlert(message, "排課時段發生衝突");
        return;
      }

      const operationDate = boardDateRef.current;
      const previousData = data;
      const previousCachedData = boardCacheRef.current.get(operationDate);
      const optimisticData = data
        ? (() => {
            const normalizedStartsAt = new Date(startsAt).toISOString();
            const bookings =
              editTarget.kind === "booking"
                ? data.bookings.map((booking) =>
                    booking.id === editTarget.item.id
                      ? {
                          ...booking,
                          coach_id: selectedCoach,
                          course_type: scheduleDraft.courseType,
                          service_name: BIGE_COURSE_LABELS[scheduleDraft.courseType],
                          starts_at: normalizedStartsAt,
                          ends_at: endsAt,
                          note: scheduleDraft.note || null,
                        }
                      : booking,
                  )
                : data.bookings;
            const notes =
              editTarget.kind === "note"
                ? data.notes.map((note) =>
                    note.id === editTarget.item.id
                      ? {
                          ...note,
                          coach_id: selectedCoach,
                          starts_at: normalizedStartsAt,
                          ends_at: endsAt,
                          content: freeText,
                        }
                      : note,
                  )
                : data.notes;
            const assistantToState = buildOptimisticFaAssistantToState({
              bookings,
              notes,
              coaches: data.coaches,
              offCoachIds: (data.coachDayStatuses || [])
                .filter((status) => status.status === "off")
                .map((status) => status.coach_id),
            });
            return {
              ...data,
              bookings,
              notes: assistantToState.notes,
              faAssistantToConflicts: assistantToState.conflicts,
              classroomConflicts: buildBigeClassroomConflicts(bookings),
            };
          })()
        : null;
      const requestBody =
        editTarget.kind === "booking"
          ? {
              action: "edit_schedule_booking",
              bookingId: editTarget.item.id,
              coachId: selectedCoach,
              courseType: scheduleDraft.courseType,
              startsAt,
              endsAt,
              note: scheduleDraft.note || null,
            }
          : {
              action: "edit_schedule_note",
              noteId: editTarget.item.id,
              coachId: selectedCoach,
              startsAt,
              endsAt,
              content: freeText,
            };
      const editUndo: ScheduleEditUndo =
        editTarget.kind === "booking"
          ? {
              kind: "booking",
              item: editTarget.item,
              businessDate: operationDate,
              ready: false,
            }
          : {
              kind: "note",
              item: editTarget.item,
              businessDate: operationDate,
              ready: false,
            };

      void runOptimisticScheduleMutation({
        apply: () => {
          setDialog(null);
          setEditingSchedule(null);
          setError("");
          setSuccess("原排課資料已更新");
          setScheduleMoveUndo(null);
          setScheduleEditUndo(editUndo);
          if (optimisticData) {
            storeBoardCache(boardCacheRef.current, operationDate, optimisticData);
            setData(optimisticData);
          }
        },
        request: () => post(requestBody, { preserveFeedback: true }),
        commit: () => {
          if (
            scheduleNoteUndo &&
            scheduleHourCellKey(selectedCoach, startsAt) ===
              scheduleHourCellKey(scheduleNoteUndo.coachId, scheduleNoteUndo.startsAt)
          ) {
            clearScheduleNoteUndo();
          }
          setScheduleEditUndo((current) =>
            current?.kind === editUndo.kind && current.item.id === editUndo.item.id
              ? { ...current, ready: true }
              : current,
          );
          void loadBoard({ silent: true, targetDate: operationDate });
        },
        rollback: (caught) => {
          if (previousCachedData) {
            storeBoardCache(boardCacheRef.current, operationDate, previousCachedData);
          } else {
            boardCacheRef.current.delete(operationDate);
          }
          if (boardDateRef.current === operationDate) setData(previousData);
          setSuccess("");
          setScheduleEditUndo(null);
          const message = caught instanceof Error ? caught.message : "儲存排課失敗";
          showOperationAlert(message, "無法儲存排課");
        },
      }).catch(() => undefined);
      return;
    }

    if (!selectedScheduleTarget) {
      try {
        if (!freeText) throw new Error("請選擇學員或輸入自由文字");
        if (freeText.length > 300) throw new Error("自由文字最多 300 字");
        await post({
          action: "create_note",
          coachId: selectedCoach,
          startsAt,
          endsAt,
          content: freeText,
        });
        if (
          scheduleNoteUndo &&
          scheduleHourCellKey(selectedCoach, startsAt) ===
            scheduleHourCellKey(scheduleNoteUndo.coachId, scheduleNoteUndo.startsAt)
        ) {
          clearScheduleNoteUndo();
        }
        setDialog(null);
        setEditingSchedule(null);
        setSuccess(isNewFreeText ? "自由文字已建立" : "排課已建立");
        void loadBoard({ silent: true, targetDate: boardDateRef.current });
      } catch (caught) {
        showOperationAlert(
          caught instanceof Error ? caught.message : "儲存排課失敗",
          "無法儲存排課",
        );
      }
      return;
    }

    if (!data) {
      showOperationAlert("課表尚未載入完成，請稍後再試", "無法儲存排課");
      return;
    }

    const operationDate = boardDateRef.current;
    const optimisticBookingId = `optimistic:${crypto.randomUUID()}`;
    const optimisticBooking: Booking = {
      id: optimisticBookingId,
      optimistic: true,
      member_id: scheduleDraft.operationKind === "pt" ? scheduleDraft.memberId : "",
      coach_id: selectedCoach,
      service_name: BIGE_COURSE_LABELS[scheduleDraft.courseType],
      starts_at: new Date(startsAt).toISOString(),
      ends_at: endsAt,
      status: "booked",
      note: scheduleDraft.note || null,
      operation_kind: scheduleDraft.operationKind,
      course_type: scheduleDraft.courseType,
      trial_stage: null,
      operation_result: null,
      reminder_status: "pending",
      converted_at: null,
      trial_booking_id:
        scheduleDraft.operationKind === "trial" ? scheduleDraft.trialBookingId : null,
    };
    const optimisticData = applyOptimisticBookingCreate(data, optimisticBooking, {
      member:
        scheduleDraft.operationKind === "pt"
          ? selectedScheduleMemberResult ||
            data.members.find((member) => member.id === scheduleDraft.memberId) ||
            null
          : null,
      trialBooking:
        scheduleDraft.operationKind === "trial"
          ? selectedScheduleTrialResult ||
            (data.trialBookings || []).find(
              (trial) => trial.id === scheduleDraft.trialBookingId,
            ) ||
            null
          : null,
    });
    const requestBody = {
      action: "create_schedule",
      coachId: selectedCoach,
      memberId: scheduleDraft.operationKind === "pt" ? scheduleDraft.memberId || null : null,
      trialBookingId:
        scheduleDraft.operationKind === "trial" ? scheduleDraft.trialBookingId || null : null,
      operationKind: scheduleDraft.operationKind,
      courseType: scheduleDraft.courseType,
      startsAt,
      endsAt,
      note: scheduleDraft.note || null,
      idempotencyKey: `ui:${crypto.randomUUID()}`,
    };

    void runOptimisticScheduleMutation({
      apply: () => {
        setDialog(null);
        setEditingSchedule(null);
        setError("");
        setSuccess("已將學員加入課表");
        setScheduleMoveUndo(null);
        setScheduleDeleteUndo(null);
        setScheduleEditUndo(null);
        storeBoardCache(boardCacheRef.current, operationDate, optimisticData);
        if (boardDateRef.current === operationDate) setData(optimisticData);
      },
      request: () =>
        post(requestBody, {
          preserveFeedback: true,
          errorPresentation: "inline",
        }),
      commit: (result) => {
        const created = (result as {
          item?: { bookingId?: string; memberId?: string; trialStage?: string | null };
        }).item;
        const updates: Partial<Booking> = {
          id: created?.bookingId || optimisticBookingId,
          optimistic: !created?.bookingId,
          member_id: created?.memberId || optimisticBooking.member_id,
          trial_stage: created?.trialStage ?? optimisticBooking.trial_stage,
        };
        const cachedData = boardCacheRef.current.get(operationDate);
        if (cachedData?.bookings.some((booking) => booking.id === optimisticBookingId)) {
          storeBoardCache(
            boardCacheRef.current,
            operationDate,
            applyOptimisticBookingUpdate(cachedData, optimisticBookingId, updates),
          );
        }
        if (boardDateRef.current === operationDate) {
          setData((current) =>
            current?.bookings.some((booking) => booking.id === optimisticBookingId)
              ? applyOptimisticBookingUpdate(current, optimisticBookingId, updates)
              : current,
          );
        }
        if (
          scheduleNoteUndo &&
          scheduleHourCellKey(selectedCoach, startsAt) ===
            scheduleHourCellKey(scheduleNoteUndo.coachId, scheduleNoteUndo.startsAt)
        ) {
          clearScheduleNoteUndo();
        }
        setSuccess("排課已建立");
        void loadBoard({ silent: true, targetDate: operationDate });
      },
      rollback: (caught) => {
        const cachedData = boardCacheRef.current.get(operationDate);
        if (cachedData?.bookings.some((booking) => booking.id === optimisticBookingId)) {
          storeBoardCache(
            boardCacheRef.current,
            operationDate,
            applyOptimisticScheduleBookingDelete(cachedData, optimisticBookingId),
          );
        }
        if (boardDateRef.current === operationDate) {
          setData((current) =>
            current?.bookings.some((booking) => booking.id === optimisticBookingId)
              ? applyOptimisticScheduleBookingDelete(current, optimisticBookingId)
              : current,
          );
        }
        setSuccess("");
        const message = caught instanceof Error ? caught.message : "儲存排課失敗";
        showOperationAlert(message, "無法儲存排課");
      },
    }).catch(() => undefined);
  };

  const deleteScheduleNote = async () => {
    if (
      editingSchedule?.kind !== "note" ||
      editingSchedule.item.system_kind ||
      !data?.canManageSchedule ||
      deletingScheduleNote
    ) {
      return;
    }

    const note = editingSchedule.item;
    const confirmed = window.confirm(
      `確定要刪除 ${formatDateTime(note.starts_at)} 的自由文字「${note.content}」嗎？\n\n刪除後不會再顯示於課表，但操作紀錄仍會保留。`,
    );
    if (!confirmed) return;

    setDeletingScheduleNote(true);
    try {
      const response = (await post({
        action: "delete_schedule_note",
        noteId: note.id,
      })) as { undo?: ScheduleNoteUndo | null };
      setDialog(null);
      setEditingSchedule(null);
      setSuccess("自由文字已刪除");
      await loadBoard();
      if (response.undo) armScheduleNoteUndo(response.undo);
      else clearScheduleNoteUndo();
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "刪除自由文字失敗",
        "無法刪除自由文字",
      );
    } finally {
      setDeletingScheduleNote(false);
    }
  };

  const restoreScheduleNote = async () => {
    const undo = scheduleNoteUndo;
    if (!undo || restoringScheduleNote) return;
    if (Date.now() > Date.parse(undo.expiresAt)) {
      clearScheduleNoteUndo();
      return;
    }

    setRestoringScheduleNote(true);
    try {
      await post({
        action: "restore_schedule_note",
        noteId: undo.noteId,
      });
      clearScheduleNoteUndo();
      setSuccess("已復原自由文字");
      await loadBoard();
    } catch (caught) {
      clearScheduleNoteUndo();
      showOperationAlert(
        caught instanceof Error ? caught.message : "自由文字復原失敗",
        "無法復原自由文字",
      );
    } finally {
      setRestoringScheduleNote(false);
    }
  };

  const completePt = async (operationAllowed: boolean) => {
    if (!selectedBooking || bookingActionSubmitting) return;
    const booking = selectedBooking;
    const restoring = booking.status === "completed";
    if (!operationAllowed) {
      showOperationAlert(
        "只能在預約前 30 分鐘至結束後 30 分鐘內操作",
        restoring ? "無法復原扣堂" : "無法完成課程",
      );
      return;
    }

    const operationDate = boardDateRef.current;
    const previousData = data;
    const previousCachedData = boardCacheRef.current.get(operationDate);
    const optimisticStatus = restoring ? "booked" : "completed";
    const optimisticResult = restoring ? null : "completed";
    const optimisticData = data
      ? applyOptimisticBookingUpdate(data, booking.id, {
          status: optimisticStatus,
          operation_result: optimisticResult,
        })
      : null;

    setOperationAlert(null);
    setBookingActionSubmitting(true);
    void runOptimisticScheduleMutation({
      apply: () => {
        bumpBigeBoardRevision(boardRevisionRef.current, operationDate);
        boardRequestsRef.current.delete(operationDate);
        setDialog(null);
        setSelectedBooking({
          ...booking,
          status: optimisticStatus,
          operation_result: optimisticResult,
        });
        setError("");
        setSuccess(restoring ? "已復原為未扣課狀態" : "上課已完成並扣除一堂");
        if (optimisticData) {
          storeBoardCache(boardCacheRef.current, operationDate, optimisticData);
          if (boardDateRef.current === operationDate) setData(optimisticData);
        }
      },
      request: () =>
        post(
          {
            action: restoring ? "restore_booking_completion" : "complete_booking",
            bookingId: booking.id,
          },
          { preserveFeedback: true },
        ),
      commit: () => {
        setBookingActionSubmitting(false);
        void loadBoard({ silent: true, targetDate: operationDate });
      },
      rollback: (caught) => {
        if (previousCachedData) {
          storeBoardCache(boardCacheRef.current, operationDate, previousCachedData);
        } else {
          boardCacheRef.current.delete(operationDate);
        }
        if (boardDateRef.current === operationDate) setData(previousData);
        setSelectedBooking(booking);
        setSuccess("");
        setBookingActionSubmitting(false);
        showOperationAlert(
          caught instanceof Error
            ? caught.message
            : restoring
              ? "復原扣堂失敗"
              : "扣堂失敗",
          restoring ? "無法復原扣堂" : "無法完成課程",
        );
      },
    }).catch(() => undefined);
  };

  const updateBooking = async (result: string) => {
    if (!selectedBooking || bookingActionSubmitting) return;
    const booking = selectedBooking;
    const operationDate = boardDateRef.current;
    const previousData = data;
    const previousCachedData = boardCacheRef.current.get(operationDate);
    const status = result === "completed" ? "completed" : result === "no_show" ? "no_show" : "cancelled";
    const optimisticData = data
      ? applyOptimisticBookingUpdate(data, booking.id, {
          status,
          operation_result: result,
        })
      : null;

    setBookingActionSubmitting(true);
    void runOptimisticScheduleMutation({
      apply: () => {
        setDialog(null);
        setSelectedBooking({ ...booking, status, operation_result: result });
        setError("");
        setSuccess("課程狀態已更新");
        if (optimisticData) {
          storeBoardCache(boardCacheRef.current, operationDate, optimisticData);
          if (boardDateRef.current === operationDate) setData(optimisticData);
        }
      },
      request: () =>
        post(
          { action: "update_schedule", bookingId: booking.id, result },
          { preserveFeedback: true },
        ),
      commit: () => {
        setBookingActionSubmitting(false);
        void loadBoard({ silent: true, targetDate: operationDate });
      },
      rollback: (caught) => {
        if (previousCachedData) {
          storeBoardCache(boardCacheRef.current, operationDate, previousCachedData);
        } else {
          boardCacheRef.current.delete(operationDate);
        }
        if (boardDateRef.current === operationDate) setData(previousData);
        setSelectedBooking(booking);
        setSuccess("");
        setBookingActionSubmitting(false);
        showOperationAlert(
          caught instanceof Error ? caught.message : "更新失敗",
          "無法更新課程狀態",
        );
      },
    }).catch(() => undefined);
  };

  const openFaFeeRecipientPrompt = (
    action: FaFeeRecipientPrompt["action"],
    booking = selectedBooking,
  ) => {
    if (!booking || booking.operation_kind !== "trial") return;
    const trialService = booking.trial_booking_id
      ? trialBookings.get(booking.trial_booking_id)?.service
      : null;
    setFaFeeRecipientPrompt({
      action,
      bookingId: booking.id,
      amount: getBigeFaFeeAmount(trialService),
    });
    setFaFeeRecipientName(booking.fa_fee_recipient_name || "");
    setFaFeeRecipientOptionsError("");
    void loadFaFeeRecipientOptions();
  };

  const completeTrialOutcome = async (
    outcome: "pending_conversion" | "not_converted",
    faFeeRecipient?: { profileId: string | null; name: string },
  ) => {
    if (!selectedBooking || trialOutcomeSubmitting) return;
    const booking = selectedBooking;
    setTrialOutcomeSubmitting(outcome);
    try {
      await post({
        action: "complete_trial_outcome",
        bookingId: booking.id,
        outcome,
        faFeeRecipientProfileId: faFeeRecipient?.profileId || null,
        faFeeRecipientName: faFeeRecipient?.name || null,
      });
      const completedBooking: Booking = {
        ...booking,
        status: "completed",
        operation_result: "completed",
        trial_conversion_outcome: outcome,
      };
      setTrialOutcomePrompt(false);
      if (outcome === "pending_conversion") {
        openContract(completedBooking);
      } else {
        setDialog(null);
        setSelectedBooking(null);
        setSuccess("FA 已記錄為未成交");
      }
      await loadBoard();
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "更新 FA 成交結果失敗",
        "無法更新 FA 成交結果",
      );
    } finally {
      setTrialOutcomeSubmitting(null);
    }
  };

  const beginTrialConversionChange = () => {
    if (!selectedBooking?.converted_at || !data?.canChangeTrialConversion) return;
    setTrialConversionAmount(Number(selectedBooking.converted_payment_amount || 0));
    setTrialConversionOutcomeDraft("converted");
    setTrialConversionEditing(true);
  };

  const changeTrialConversion = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedBooking || trialConversionSubmitting) return;

    if (trialConversionOutcomeDraft === "not_converted") {
      if (!data?.canRestoreTrialConversion) {
        showOperationAlert("只有經理或系統管理員能將已成交 FA 改為未成交", "無法變更成交結果");
        return;
      }
      const memberName = members.get(selectedBooking.member_id)?.full_name || "此學員";
      const confirmed = window.confirm(
        `確定要將 ${memberName} 的 FA 改為「未成交」嗎？\n\n系統會作廢本次首次付款、取消本次建立的合約，並將 FA 記錄為未成交；若本次成交才升級為正式會員，也會移除正式會員編號。`,
      );
      if (!confirmed) return;

      setTrialConversionSubmitting("outcome");
      try {
        const changed = (await post({
          action: "change_trial_conversion_outcome",
          bookingId: selectedBooking.id,
          outcome: "not_converted",
        })) as {
          item?: { restoredConversion?: { memberRevertedToProspect?: boolean } };
        };
        setDialog(null);
        setSelectedBooking(null);
        setTrialConversionEditing(false);
        setSuccess(
          changed.item?.restoredConversion?.memberRevertedToProspect
            ? "FA 已改為未成交，付款與合約已撤銷，正式會員資料已移除"
            : "FA 已由成交變更為未成交，首次付款已作廢，合約已取消",
        );
        await loadBoard({ silent: true, targetDate: boardDateRef.current });
      } catch (caught) {
        showOperationAlert(
          caught instanceof Error ? caught.message : "變更 FA 成交結果失敗",
          "無法變更成交結果",
        );
      } finally {
        setTrialConversionSubmitting(null);
      }
      return;
    }

    const amount = Number(trialConversionAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      showOperationAlert("成交金額必須是大於 0 的整數", "無法變更成交金額");
      return;
    }

    setTrialConversionSubmitting("change");
    try {
      await post({
        action: "change_trial_conversion_payment",
        bookingId: selectedBooking.id,
        amount,
      });
      setSelectedBooking((current) =>
        current ? { ...current, converted_payment_amount: amount } : current,
      );
      setTrialConversionEditing(false);
      setSuccess(`FA 成交金額已變更為 ${formatMoney(amount)}`);
      await loadBoard({ silent: true, targetDate: boardDateRef.current });
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "變更 FA 成交金額失敗",
        "無法變更成交金額",
      );
    } finally {
      setTrialConversionSubmitting(null);
    }
  };

  const restoreTrialConversion = async () => {
    if (!selectedBooking || trialConversionSubmitting || !data?.canRestoreTrialConversion) return;
    const memberName = members.get(selectedBooking.member_id)?.full_name || "此學員";
    const confirmed = window.confirm(
      `確定要復原 ${memberName} 的 FA 成交嗎？\n\n系統會作廢首次付款、取消本次建立的合約，並把 FA 恢復為未完成；若本次成交才升級為正式會員，也會移除正式會員編號。`,
    );
    if (!confirmed) return;

    setTrialConversionSubmitting("restore");
    try {
      const restored = (await post({
        action: "restore_trial_conversion",
        bookingId: selectedBooking.id,
      })) as { item?: { memberRevertedToProspect?: boolean } };
      setDialog(null);
      setSelectedBooking(null);
      setTrialConversionEditing(false);
      setSuccess(
        restored.item?.memberRevertedToProspect
          ? "FA 成交已復原，付款與合約已撤銷，正式會員資料已移除"
          : "FA 成交已復原，首次付款已作廢，合約已取消",
      );
      await loadBoard({ silent: true, targetDate: boardDateRef.current });
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "復原 FA 成交失敗",
        "無法復原 FA 成交",
      );
    } finally {
      setTrialConversionSubmitting(null);
    }
  };

  const restoreCancelledSchedule = async () => {
    if (
      !selectedBooking ||
      selectedBooking.status !== "cancelled" ||
      !data?.canManageSchedule ||
      restoringCancelledBooking
    ) {
      return;
    }
    const booking = selectedBooking;
    const memberName = members.get(booking.member_id)?.full_name || "這位學員";
    if (!window.confirm(`確定要復原 ${memberName} 在 ${formatDateTime(booking.starts_at)} 的課程嗎？`)) {
      return;
    }
    const operationDate = boardDateRef.current;
    const previousData = data;
    const previousCachedData = boardCacheRef.current.get(operationDate);
    const optimisticData = applyOptimisticBookingUpdate(data, booking.id, {
      status: "booked",
      operation_result: null,
    });

    setRestoringCancelledBooking(true);
    void runOptimisticScheduleMutation({
      apply: () => {
        setDialog(null);
        setSelectedBooking({ ...booking, status: "booked", operation_result: null });
        setError("");
        setSuccess("已復原課程");
        storeBoardCache(boardCacheRef.current, operationDate, optimisticData);
        if (boardDateRef.current === operationDate) setData(optimisticData);
      },
      request: () =>
        post(
          { action: "restore_cancelled_booking", bookingId: booking.id },
          { preserveFeedback: true },
        ),
      commit: () => {
        setRestoringCancelledBooking(false);
        void loadBoard({ silent: true, targetDate: operationDate });
      },
      rollback: (caught) => {
        if (previousCachedData) {
          storeBoardCache(boardCacheRef.current, operationDate, previousCachedData);
        } else {
          boardCacheRef.current.delete(operationDate);
        }
        if (boardDateRef.current === operationDate) setData(previousData);
        setSelectedBooking(booking);
        setSuccess("");
        setRestoringCancelledBooking(false);
        showOperationAlert(
          caught instanceof Error ? caught.message : "復原課程失敗",
          "無法復原課程",
        );
      },
    }).catch(() => undefined);
  };

  const restoreNoShowSchedule = async () => {
    if (
      !selectedBooking ||
      selectedBooking.status !== "no_show" ||
      !data?.canManageSchedule ||
      restoringNoShowBooking
    ) {
      return;
    }
    const booking = selectedBooking;
    const memberName = members.get(booking.member_id)?.full_name || "這位學員";
    if (!window.confirm(`確定要將 ${memberName} 在 ${formatDateTime(booking.starts_at)} 的課程恢復為預約中嗎？`)) {
      return;
    }
    const operationDate = boardDateRef.current;
    const previousData = data;
    const previousCachedData = boardCacheRef.current.get(operationDate);
    const optimisticData = applyOptimisticBookingUpdate(data, booking.id, {
      status: "booked",
      operation_result: null,
    });

    setRestoringNoShowBooking(true);
    void runOptimisticScheduleMutation({
      apply: () => {
        setDialog(null);
        setSelectedBooking({ ...booking, status: "booked", operation_result: null });
        setError("");
        setSuccess("已復原未出席狀態");
        storeBoardCache(boardCacheRef.current, operationDate, optimisticData);
        if (boardDateRef.current === operationDate) setData(optimisticData);
      },
      request: () =>
        post(
          { action: "restore_no_show_booking", bookingId: booking.id },
          { preserveFeedback: true },
        ),
      commit: () => {
        setRestoringNoShowBooking(false);
        void loadBoard({ silent: true, targetDate: operationDate });
      },
      rollback: (caught) => {
        if (previousCachedData) {
          storeBoardCache(boardCacheRef.current, operationDate, previousCachedData);
        } else {
          boardCacheRef.current.delete(operationDate);
        }
        if (boardDateRef.current === operationDate) setData(previousData);
        setSelectedBooking(booking);
        setSuccess("");
        setRestoringNoShowBooking(false);
        showOperationAlert(
          caught instanceof Error ? caught.message : "復原未出席狀態失敗",
          "無法復原未出席狀態",
        );
      },
    }).catch(() => undefined);
  };

  const toggleTrialReminder = async (booking: Booking) => {
    if (booking.operation_kind !== "trial") return;
    const wasReminded = isBigeTrialReminderConfirmed(booking.reminder_status);
    const nextStatus = nextBigeTrialReminderStatus(booking.reminder_status);
    setReminderSubmittingId(booking.id);
    try {
      const response = (await post({
        action: "update_reminder",
        bookingId: booking.id,
        status: nextStatus,
        note: wasReminded ? "取消已提醒狀態，恢復待聯絡" : "已提醒",
      })) as { item?: { reminder_status?: string } };
      const reminderStatus = response.item?.reminder_status || nextStatus;
      const updateReminderStatus = (item: Booking) =>
        item.id === booking.id ? { ...item, reminder_status: reminderStatus } : item;

      setData((current) =>
        current
          ? { ...current, bookings: current.bookings.map(updateReminderStatus) }
          : current,
      );
      setEditingSchedule((current) =>
        current?.kind === "booking" && current.item.id === booking.id
          ? { ...current, item: updateReminderStatus(current.item) }
          : current,
      );
      setSelectedBooking((current) =>
        current?.id === booking.id ? updateReminderStatus(current) : current,
      );
      setSuccess(wasReminded ? "已恢復為待聯絡" : "已記錄：FA 已提醒");
      void loadBoard({ silent: true });
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "提醒狀態更新失敗",
        "無法更新提醒狀態",
      );
    } finally {
      setReminderSubmittingId(null);
    }
  };

  const [contractDraft, setContractDraft] = useState({
    fullName: "",
    phone: "",
    birthDate: "",
    email: "",
    emailUnavailable: false,
    notifyManagerProfileChange: false,
    planMode: "builtin" as "builtin" | "custom",
    planId: "",
    signedOn: localDate(),
    initialPayment: 0,
    paymentMethod: "cash",
    installmentCount: null as number | null,
    futureTrialAction: "convert_to_pt",
  });
  const [customContractPlan, setCustomContractPlan] = useState<CustomContractPlanDraft>(() =>
    customContractPlanFrom(),
  );
  const [contractPaymentEntries, setContractPaymentEntries] = useState<PaymentEntryDraft[]>(
    () => [createPaymentEntryDraft()],
  );
  const [contractSubmitting, setContractSubmitting] = useState(false);
  const [contractError, setContractError] = useState("");
  const [studentPaymentContext, setStudentPaymentContext] =
    useState<StudentPaymentContext | null>(null);
  const selectedPlan = data?.plans.find((plan) => plan.id === contractDraft.planId);
  const maximumInitialPayment =
    contractDraft.planMode === "custom"
      ? Number(customContractPlan.totalAmount || 0)
      : selectedPlan?.price_amount || 0;
  const contractPlanTotalSessions =
    contractDraft.planMode === "custom"
      ? Number(customContractPlan.totalSessions || 0)
      : selectedPlan?.total_sessions || 0;
  const minimumInitialPayment = calculateMinimumDeposit(
    maximumInitialPayment,
    contractPlanTotalSessions,
  );
  const contractPaymentTotal = paymentEntryTotal(contractPaymentEntries);
  const contractPaymentRequired = Boolean(
    studentPaymentContext || selectedBooking?.operation_kind === "trial",
  );

  const openContract = (booking?: Booking, member?: Member) => {
    const target = member || (booking ? members.get(booking.member_id) : undefined);
    const trialBooking = booking?.trial_booking_id
      ? trialBookings.get(booking.trial_booking_id)
      : null;
    const identity = resolveBigeTrialContractIdentity({
      trialBooking,
      member: target,
    });
    const missingProfileFields = getBigeTrialContractMissingProfileFields(identity);
    setStudentPaymentContext(null);
    setSelectedBooking(booking || null);
    setSelectedMember(target || null);
    setContractDraft((current) => ({
      ...current,
      fullName: identity.fullName,
      phone: identity.phone,
      birthDate: identity.birthDate,
      email: target?.email || "",
      emailUnavailable: target?.email_unavailable || false,
      notifyManagerProfileChange:
        booking?.operation_kind === "trial" && missingProfileFields.length > 0,
      planMode: "builtin",
      planId: data?.plans[0]?.id || "",
      signedOn: localDate(),
      initialPayment: 0,
      paymentMethod: "cash",
      installmentCount: null,
    }));
    setContractPaymentEntries([createPaymentEntryDraft()]);
    setCustomContractPlan(customContractPlanFrom(data?.plans[0]));
    setContractError("");
    setContractSubmitting(false);
    setDialog("contract");
  };

  const openStudentPayment = (booking: Booking) => {
    const member = members.get(booking.member_id);
    if (!member || !scheduleMemberDetail) return;
    const outstandingContracts = scheduleMemberDetail.contracts
      .map((contract) => ({
        contract,
        outstanding: calculateBigeContractOutstandingBalance(
          contract.total_amount,
          scheduleMemberDetail.payments.filter(
            (payment) => payment.contract_id === contract.id,
          ),
        ),
      }))
      .filter((item) => item.outstanding > 0 && item.contract.status !== "canceled");
    openContract(booking, member);
    setStudentPaymentContext({
      bookingId: booking.id,
      memberId: member.id,
      paymentType:
        booking.operation_kind === "trial"
          ? "new"
          : outstandingContracts.length
            ? "balance"
            : "renewal",
      amount: "",
      contractId: outstandingContracts[0]?.contract.id || "",
    });
  };

  const submitContract = async (
    event?: FormEvent<HTMLFormElement>,
    faFeeRecipient?: { profileId: string | null; name: string },
  ) => {
    event?.preventDefault();
    if (contractSubmitting) return;
    setContractError("");
    const requiresInitialPayment = Boolean(
      studentPaymentContext || selectedBooking?.operation_kind === "trial",
    );
    const entryError = paymentEntryError(contractPaymentEntries, requiresInitialPayment);
    if (entryError) {
      setContractError(entryError);
      return;
    }
    const payments = normalizedPaymentEntries(contractPaymentEntries);
    const initialPayment = paymentEntryTotal(contractPaymentEntries);
    if (studentPaymentContext?.paymentType === "balance") {
      const targetContract = scheduleMemberDetail?.contracts.find(
        (contract) => contract.id === studentPaymentContext.contractId,
      );
      const outstandingBalance = targetContract
        ? calculateBigeContractOutstandingBalance(
            targetContract.total_amount,
            (scheduleMemberDetail?.payments || []).filter(
              (payment) => payment.contract_id === targetContract.id,
            ),
          )
        : 0;
      if (
        !targetContract ||
        !isBigeContractPaymentAmountAllowed(
          initialPayment,
          outstandingBalance,
        )
      ) {
        setContractError(
          outstandingBalance > 0
            ? `付款金額不能超過尚有尾款 ${formatMoney(outstandingBalance)}`
            : "目前沒有可支付尾款的合約，請改選續約 Re",
        );
        return;
      }
      setContractSubmitting(true);
      try {
        await post(
          {
            action: "record_payments",
            contractId: targetContract.id,
            sourceBookingId: studentPaymentContext.bookingId,
            paymentKind: "balance",
            payments,
            idempotencyKey: `student-payment:${studentPaymentContext.bookingId}:${crypto.randomUUID()}`,
            note: "學員課程付款｜尾款 PTP",
          },
          { errorPresentation: "inline" },
        );
        setDialog(null);
        setStudentPaymentContext(null);
        setSuccess("尾款 PTP 已記錄，付款與可用堂數已更新");
        await loadBoard({ silent: true });
        await loadScheduleMemberDetail(studentPaymentContext.memberId);
      } catch (caught) {
        setContractError(caught instanceof Error ? caught.message : "尾款付款失敗");
      } finally {
        setContractSubmitting(false);
      }
      return;
    }
    if (
      (contractDraft.planMode === "builtin" && !selectedPlan) ||
      (contractDraft.planMode === "custom" &&
        (!customContractPlan.name.trim() ||
          customContractPlan.totalSessions <= 0 ||
          customContractPlan.totalAmount <= 0 ||
          customContractPlan.validityDays <= 0 ||
          customContractPlan.extensionLimitDays < 0 ||
          !validateCourseAllocationTotal(
            customContractPlan.allocations,
            customContractPlan.totalSessions,
          ))) ||
      !isBigeContractPaymentAmountAllowed(
        initialPayment,
        maximumInitialPayment,
        { minimumAmount: requiresInitialPayment ? minimumInitialPayment : 0 },
      )
    ) {
      const message =
        contractDraft.planMode === "custom" &&
        !validateCourseAllocationTotal(
          customContractPlan.allocations,
          customContractPlan.totalSessions,
        )
          ? "自訂方案的課別分配加總必須等於總堂數"
          : maximumInitialPayment > 0
            ? requiresInitialPayment
              ? `本次付款最低為 ${formatMoney(minimumInitialPayment)}，且不能超過合約總額 ${formatMoney(maximumInitialPayment)}`
              : `首次付款不能超過合約總額 ${formatMoney(maximumInitialPayment)}`
            : "請先完整填寫方案";
      setContractError(message);
      return;
    }
    if (selectedBooking?.operation_kind === "trial" && !faFeeRecipient) {
      openFaFeeRecipientPrompt("confirm_payment", selectedBooking);
      return;
    }
    setContractSubmitting(true);
    try {
      const created = (await post(
        {
          action: "create_contract",
          memberId: selectedMember?.id || null,
          sourceBookingId: selectedBooking?.operation_kind === "trial" ? selectedBooking.id : null,
          sourceMemberBookingId:
            studentPaymentContext?.paymentType === "renewal"
              ? studentPaymentContext.bookingId
              : null,
          ...contractDraft,
          signedOn:
            selectedBooking?.operation_kind === "trial"
              ? localDate()
              : contractDraft.signedOn,
          notifyManagerProfileChange:
            contractDraft.notifyManagerProfileChange ||
            (selectedBooking?.operation_kind === "trial" &&
              getBigeTrialContractMissingProfileFields({
                fullName: contractDraft.fullName,
                phone: contractDraft.phone,
                birthDate: contractDraft.birthDate,
              }).length > 0),
          planId: contractDraft.planMode === "builtin" ? contractDraft.planId : null,
          customPlan:
            contractDraft.planMode === "custom"
              ? {
                  ...customContractPlan,
                  description: customContractPlan.description || null,
                }
              : null,
          initialPayment,
          paymentMethod: payments[0]?.method || null,
          installmentCount: payments[0]?.installmentCount || null,
          payments,
          email: contractDraft.email || null,
          paymentSchedule: [],
          faFeeRecipientProfileId: faFeeRecipient?.profileId || null,
          faFeeRecipientName: faFeeRecipient?.name || null,
        },
        {
          errorPresentation: "inline",
        },
      )) as {
        profileChangeNotification?: { status?: "skipped" | "sent" | "failed"; error?: string };
      };
      setDialog(null);
      const wasStudentRenewal = studentPaymentContext?.paymentType === "renewal";
      const wasFaNewPayment = studentPaymentContext?.paymentType === "new";
      const paymentMemberId = studentPaymentContext?.memberId;
      setStudentPaymentContext(null);
      const notificationStatus = created.profileChangeNotification?.status;
      setSuccess(
        wasStudentRenewal
          ? "續約 Re 已建立，新合約與本次付款已記錄"
          : wasFaNewPayment
            ? notificationStatus === "failed"
              ? "新單 New 已建立，正式會員、合約與本次付款已記錄；主管個資通知送出失敗，請人工通知主管"
              : notificationStatus === "sent"
                ? "新單 New 已建立，正式會員、合約與本次付款已記錄，主管個資通知已送出"
                : "新單 New 已建立，正式會員、合約與本次付款已記錄"
          : notificationStatus === "sent"
          ? "正式會員、合約與堂數已建立，主管個資通知已送出"
          : notificationStatus === "failed"
            ? "正式會員、合約與堂數已建立；主管個資通知送出失敗，請人工通知主管"
            : "正式會員、合約與堂數已建立",
      );
      await loadBoard();
      if (paymentMemberId) {
        await loadScheduleMemberDetail(paymentMemberId);
      } else if (selectedMember) {
        await loadMember(selectedMember, { force: true });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "建立正式會員失敗";
      setContractError(message);
    } finally {
      setContractSubmitting(false);
    }
  };

  const submitFaFeeRecipient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!faFeeRecipientPrompt) return;
    const recipientName = faFeeRecipientName.trim();
    if (!recipientName) {
      setFaFeeRecipientOptionsError("請選擇員工或自行輸入收款人");
      return;
    }
    if (
      !selectedBooking ||
      selectedBooking.id !== faFeeRecipientPrompt.bookingId ||
      selectedBooking.operation_kind !== "trial"
    ) {
      setFaFeeRecipientPrompt(null);
      showOperationAlert("FA 資料已變更，請重新開啟後再操作", "無法確認收款人");
      return;
    }

    const normalizedName = recipientName.toLocaleLowerCase("zh-TW");
    const selectedEmployee = faFeeRecipientOptions.find(
      (option) => option.label.toLocaleLowerCase("zh-TW") === normalizedName,
    );
    const recipient = {
      profileId: selectedEmployee?.id || null,
      name: recipientName,
    };
    const action = faFeeRecipientPrompt.action;
    setFaFeeRecipientPrompt(null);
    setFaFeeRecipientOptionsError("");

    if (action === "not_converted") {
      await completeTrialOutcome("not_converted", recipient);
      return;
    }
    await submitContract(undefined, recipient);
  };

  const [planDraft, setPlanDraft] = useState({
    name: "",
    totalSessions: 36,
    totalAmount: 53568,
    weight_training: 36,
    relaxation: 0,
    reformer_pilates: 0,
    sports_cupping: 0,
    fascia_knife: 0,
    description: "",
  });
  const [planError, setPlanError] = useState("");
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const submitPlan = async (event: FormEvent) => {
    event.preventDefault();
    setPlanError("");
    setPlanSubmitting(true);
    try {
      await post(
        {
          action: "create_plan",
          name: planDraft.name,
          totalSessions: Number(planDraft.totalSessions),
          totalAmount: Number(planDraft.totalAmount),
          allocations: {
            weight_training: Number(planDraft.weight_training),
            relaxation: Number(planDraft.relaxation),
            reformer_pilates: Number(planDraft.reformer_pilates),
            sports_cupping: Number(planDraft.sports_cupping),
            fascia_knife: Number(planDraft.fascia_knife),
          },
          description: planDraft.description || null,
          isCustom: false,
        },
        {
          errorPresentation: "inline",
        },
      );
      setDialog(null);
      setSuccess("正式方案已建立");
      await loadBoard();
    } catch (caught) {
      setPlanError(caught instanceof Error ? caught.message : "方案建立失敗");
    } finally {
      setPlanSubmitting(false);
    }
  };

  const [paymentDraft, setPaymentDraft] = useState({
    paymentKind: "installment",
    entries: [createPaymentEntryDraft()] as PaymentEntryDraft[],
    note: "",
  });
  const [paymentError, setPaymentError] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);
  const [paymentEditDraft, setPaymentEditDraft] = useState({
    paymentKind: "installment",
    amount: 0,
    method: "cash",
    installmentCount: null as number | null,
    status: "recorded",
    note: "",
    reason: "",
  });
  const [paymentEditError, setPaymentEditError] = useState("");
  const [paymentEditSubmitting, setPaymentEditSubmitting] = useState(false);
  const selectedContractOutstandingBalance =
    selectedContract && memberDetail
      ? calculateBigeContractOutstandingBalance(
          selectedContract.total_amount,
          memberDetail.payments.filter(
            (payment) => payment.contract_id === selectedContract.id,
          ),
        )
      : 0;
  const submitPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedContract || !selectedMember) return;
    setPaymentError("");
    const entryError = paymentEntryError(paymentDraft.entries, true);
    if (entryError) {
      setPaymentError(entryError);
      return;
    }
    const payments = normalizedPaymentEntries(paymentDraft.entries);
    const paymentTotal = paymentEntryTotal(paymentDraft.entries);
    if (
      !isBigeContractPaymentAmountAllowed(
        paymentTotal,
        selectedContractOutstandingBalance,
      )
    ) {
      const message = selectedContractOutstandingBalance > 0
          ? `付款金額不能超過尚有尾款 ${formatMoney(selectedContractOutstandingBalance)}`
          : "此合約已無尾款，不能再登記付款";
      setPaymentError(message);
      return;
    }
    try {
      await post(
        {
          action: "record_payments",
          contractId: selectedContract.id,
          paymentKind: paymentDraft.paymentKind,
          payments,
          note: paymentDraft.note,
          idempotencyKey: `payment:${crypto.randomUUID()}`,
        },
        {
          errorPresentation: "inline",
        },
      );
      setDialog(null);
      setSuccess("付款已記錄，可用堂數已依累積付款比例更新");
      await loadMember(selectedMember, { force: true });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "付款失敗";
      setPaymentError(message);
    }
  };

  const paymentEditMaximumAmount =
    selectedPayment && selectedContract && memberDetail
      ? Math.max(
          0,
          selectedContract.total_amount -
            memberDetail.payments.reduce((sum, payment) => {
              if (
                payment.id === selectedPayment.id ||
                payment.contract_id !== selectedContract.id ||
                payment.status !== "recorded"
              ) {
                return sum;
              }
              return sum + Number(payment.amount || 0);
            }, 0),
        )
      : 0;

  const openPaymentEditor = (payment: PaymentRecord, contract: Contract) => {
    const paymentKind =
      payment.payment_kind === "full"
        ? "balance"
        : ["deposit", "installment", "balance"].includes(payment.payment_kind)
          ? payment.payment_kind
          : "installment";
    const method = [
      "cash",
      "bank_transfer",
      "card_terminal",
      "ecpay",
      "ecpay_installment",
      "acpay",
      "other",
    ].includes(payment.method)
      ? payment.method
      : "other";
    const status = ["recorded", "refunded", "voided"].includes(payment.status)
      ? payment.status
      : "recorded";
    setSelectedContract(contract);
    setSelectedPayment(payment);
    setPaymentEditDraft({
      paymentKind,
      amount: Number(payment.amount || 0),
      method,
      installmentCount: payment.installment_count || null,
      status,
      note: payment.note || "",
      reason: "",
    });
    setPaymentEditError("");
    setDialog("edit-payment");
  };

  const submitPaymentEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPayment || !selectedContract || !selectedMember || paymentEditSubmitting) return;
    setPaymentEditError("");
    if (paymentEditDraft.method === "ecpay_installment" && !paymentEditDraft.installmentCount) {
      setPaymentEditError("請先輸入綠界分期期數");
      return;
    }
    if (paymentEditDraft.reason.trim().length < 3) {
      setPaymentEditError("請填寫至少 3 個字的修改原因");
      return;
    }
    if (
      paymentEditDraft.status === "recorded" &&
      !isBigeContractPaymentAmountAllowed(
        Number(paymentEditDraft.amount),
        paymentEditMaximumAmount,
      )
    ) {
      setPaymentEditError(
        `修改後的累積已收金額不能超過合約總額；本筆最高可設 ${formatMoney(paymentEditMaximumAmount)}`,
      );
      return;
    }

    setPaymentEditSubmitting(true);
    try {
      await post(
        {
          action: "update_payment",
          paymentId: selectedPayment.id,
          ...paymentEditDraft,
          amount: Number(paymentEditDraft.amount),
          note: paymentEditDraft.note || null,
          reason: paymentEditDraft.reason.trim(),
        },
        { errorPresentation: "inline" },
      );
      setSelectedPayment(null);
      setDialog("member");
      setSuccess("付款資料已更新，尾款與可用堂數已重新計算");
      await loadMember(selectedMember, { force: true });
    } catch (caught) {
      setPaymentEditError(caught instanceof Error ? caught.message : "修改付款資料失敗");
    } finally {
      setPaymentEditSubmitting(false);
    }
  };

  const reversePayment = async (paymentId: string, reversal: "void" | "refund") => {
    if (!selectedMember) return;
    const reason = window.prompt(reversal === "refund" ? "請輸入退款原因" : "請輸入作廢原因");
    if (!reason?.trim()) return;
    try {
      const result = await post({ action: "reverse_payment", paymentId, reversal, reason: reason.trim() });
      if (result.pendingApproval) {
        setSuccess("已送交經理覆核，核准前不會變更付款或堂數");
      } else {
        setSuccess(reversal === "refund" ? "退款已完成並重新計算可用堂數" : "付款已作廢並重新計算可用堂數");
        await loadMember(selectedMember, { force: true });
      }
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "付款沖銷失敗",
        reversal === "refund" ? "無法完成退款" : "無法作廢付款",
      );
    }
  };

  const [extensionDraft, setExtensionDraft] = useState({
    days: 1,
    reason: "",
    signedName: "",
    signature: "",
  });
  const submitExtension = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedContract || !selectedMember) return;
    try {
      const result = await post({
        action: "extend_contract",
        contractId: selectedContract.id,
        extensionDays: Number(extensionDraft.days),
        reason: extensionDraft.reason,
        signatureDataUrl: extensionDraft.signature,
        signedMemberName: extensionDraft.signedName,
        signedAt: new Date().toISOString(),
      });
      setDialog(null);
      if (result.pendingApproval) {
        setSuccess("延期申請與學員簽名已送交經理覆核");
      } else {
        setSuccess("合約延期與學員簽名已保存");
        await loadMember(selectedMember, { force: true });
        await loadBoard();
      }
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "延期失敗",
        "無法辦理合約延期",
      );
    }
  };

  const submitLegacyPurchaseDate = async (reminder: LegacyPurchaseDateReminder) => {
    const purchaseDate = legacyPurchaseDates[reminder.id] || "";
    if (!purchaseDate) {
      showOperationAlert("請先輸入購買日", "尚未完成購買日補登");
      return;
    }
    setLegacyPurchaseDateSubmitting(reminder.id);
    try {
      const result = (await post({
        action: "update_legacy_contract_purchase_date",
        contractId: reminder.id,
        purchaseDate,
      })) as { expectedExpiryDate?: string };
      setSuccess(
        `${reminder.member_name} 的購買日已保存，到期日 ${result.expectedExpiryDate || "已自動計算"}`,
      );
      setLegacyPurchaseDates((current) => {
        const next = { ...current };
        delete next[reminder.id];
        return next;
      });
      await loadBoard();
    } catch (caught) {
      showOperationAlert(
        caught instanceof Error ? caught.message : "補登購買日失敗",
        "無法保存購買日",
      );
    } finally {
      setLegacyPurchaseDateSubmitting(null);
    }
  };

  const hours = useMemo(() => Array.from({ length: 15 }, (_, index) => index + 9), []);
  const scheduleOutstandingContracts = useMemo(
    () =>
      (scheduleMemberDetail?.contracts || [])
        .map((contract) => ({
          contract,
          outstanding: calculateBigeContractOutstandingBalance(
            contract.total_amount,
            (scheduleMemberDetail?.payments || []).filter(
              (payment) => payment.contract_id === contract.id,
            ),
          ),
        }))
        .filter((item) => item.outstanding > 0 && item.contract.status !== "canceled"),
    [scheduleMemberDetail],
  );
  const scheduleOutstandingBalance = scheduleOutstandingContracts.reduce(
    (total, item) => total + item.outstanding,
    0,
  );
  const scheduleActiveContractCount = (scheduleMemberDetail?.contracts || []).filter(
    (contract) => contract.status !== "canceled",
  ).length;
  const scheduleCourseAllocationContracts = (scheduleMemberDetail?.contracts || []).filter(
    (contract) =>
      contract.status !== "canceled" && Number(contract.total_sessions || 0) > 0,
  );
  const scheduleCourseSessionSummary = summarizeBigeMemberCourseSessions(
    scheduleCourseAllocationContracts,
  );
  const selectedCourseAllocationContract = scheduleCourseAllocationContracts.find(
    (contract) => contract.id === courseAllocationContractId,
  ) || null;
  const showCourseAllocationScheduleBehind =
    dialog === "course-allocations" &&
    courseAllocationReturnVisible &&
    courseAllocationReturnDialog === "schedule";
  const showCourseAllocationBookingBehind =
    dialog === "course-allocations" &&
    courseAllocationReturnVisible &&
    courseAllocationReturnDialog === "booking";
  const courseAllocationDraftTotal = BIGE_CONTRACT_COURSE_TYPES.reduce(
    (sum, course) => sum + Number(courseAllocationDraft[course] || 0),
    0,
  );
  const schedulePaymentBalanceState = getBigeStudentPaymentBalanceState({
    contractCount: scheduleActiveContractCount,
    outstandingBalance: scheduleOutstandingBalance,
  });
  const studentPaymentTarget = studentPaymentContext
    ? scheduleOutstandingContracts.find(
        (item) => item.contract.id === studentPaymentContext.contractId,
      ) || null
    : null;
  const sessionLabel = sessionIdentity
    ? [sessionIdentity.displayName, sessionIdentity.employeeNumber].filter(Boolean).join(" · ") ||
      "未知帳號"
    : "讀取中";
  const normalizedSessionPosition = normalizeStaffPosition(sessionIdentity?.position);
  const sessionPositionLabel = sessionIdentity
    ? normalizedSessionPosition
      ? positionLabel(normalizedSessionPosition)
      : ({
          platform_admin: "系統管理員",
          store_owner: "店主管理員",
          store_manager: "店經理",
          branch_manager: "分店經理",
          manager: "經理",
          supervisor: "組長",
          frontdesk: "櫃台",
          coach: "教練",
          therapist: "調理師",
          member: "會員",
        }[sessionIdentity.role] || "員工")
    : "";
  const canOpenTrialBookings =
    view === "frontdesk" ||
    normalizeEmployeeNumber(sessionIdentity?.employeeNumber) === CUSTOM_EMPLOYEE_NUMBER_MANAGER;
  const canOpenAccountSettings = canUseStaffAccountSettings(
    sessionIdentity?.employeeNumber,
  );
  const selectedBookingStatusWindow = selectedBooking
    ? getBigeCourseStatusWindow({
        startsAt: selectedBooking.starts_at,
        endsAt: selectedBooking.ends_at,
        now: statusClock,
      })
    : null;
  const canOperateSelectedBooking =
    isBigeCourseStatusWindowExempt(sessionIdentity || {}) ||
    !!selectedBookingStatusWindow?.allowed;
  const canCancelSelectedBooking =
    canCancelBigeCourseAnytime(sessionIdentity || {}) ||
    !!selectedBookingStatusWindow?.allowed;
  const contractIdentityLocked =
    selectedBooking?.operation_kind === "trial" || Boolean(studentPaymentContext);
  const missingContractProfileFields = selectedBooking?.operation_kind === "trial"
    ? getBigeTrialContractMissingProfileFields({
        fullName: contractDraft.fullName,
        phone: contractDraft.phone,
        birthDate: contractDraft.birthDate,
      })
    : [];
  const missingStudentPaymentFields = studentPaymentContext
    ? [
        !contractDraft.fullName ? "姓名" : "",
        !contractDraft.phone ? "手機" : "",
        !contractDraft.email && !contractDraft.emailUnavailable ? "Email" : "",
      ].filter(Boolean)
    : [];
  const missingContractIdentityFields = studentPaymentContext
    ? studentPaymentContext.paymentType === "balance"
      ? []
      : missingStudentPaymentFields
    : missingContractProfileFields.filter((field) => field !== "生日");
  const forceManagerProfileChangeNotification =
    selectedBooking?.operation_kind === "trial" && missingContractProfileFields.length > 0;
  const selectedTrialActionVisibility = getBigeTrialBookingActionVisibility({
    outcomePrompt: trialOutcomePrompt,
    status: selectedBooking?.status,
    convertedAt: selectedBooking?.converted_at,
  });

  const closeCourseAllocationDialog = () => {
    setDialog(
      courseAllocationReturnDialog === "schedule" ||
        courseAllocationReturnDialog === "booking"
        ? courseAllocationReturnDialog
        : null,
    );
    setCourseAllocationReturnVisible(false);
    setCourseAllocationError("");
  };

  const openCourseAllocationDialog = () => {
    const target =
      scheduleCourseAllocationContracts.find(
        (contract) => !contract.course_allocations_configured_at,
      ) || scheduleCourseAllocationContracts[0];
    if (!target) return;
    setCourseAllocationReturnDialog(dialog);
    setCourseAllocationReturnVisible(false);
    setCourseAllocationContractId(target.id);
    setCourseAllocationDraft(courseAllocationDraftFrom(target));
    setCourseAllocationError("");
    setDialog("course-allocations");
  };

  const submitCourseAllocations = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCourseAllocationContract || !scheduleMemberDetail) return;
    if (courseAllocationDraftTotal !== selectedCourseAllocationContract.total_sessions) {
      setCourseAllocationError("各專項分配加總必須等於合約總堂數");
      return;
    }
    const belowUsedCourse = BIGE_CONTRACT_COURSE_TYPES.find(
      (course) =>
        Number(courseAllocationDraft[course] || 0) <
        configuredCourseUsed(selectedCourseAllocationContract, course),
    );
    if (belowUsedCourse) {
      setCourseAllocationError(
        `${BIGE_COURSE_LABELS[belowUsedCourse]}分配堂數不能低於已使用堂數`,
      );
      return;
    }

    setCourseAllocationSubmitting(true);
    setCourseAllocationError("");
    try {
      await post({
        action: "update_course_allocations",
        contractId: selectedCourseAllocationContract.id,
        allocations: courseAllocationDraft,
      });
      const refreshed = await loadScheduleMemberDetail(
        scheduleMemberDetail.member.id,
        { force: true },
      );
      if (selectedMember?.id === scheduleMemberDetail.member.id && refreshed) {
        setMemberDetail(refreshed);
      }
      setSuccess("專項堂數已設定");
      closeCourseAllocationDialog();
    } catch (caught) {
      setCourseAllocationError(
        caught instanceof Error ? caught.message : "設定專項堂數失敗",
      );
    } finally {
      setCourseAllocationSubmitting(false);
    }
  };

  const renderStudentPaymentSummary = (booking: Booking) => {
    const bookingMember = members.get(booking.member_id);
    const detailMatchesBooking = scheduleMemberDetail?.member.id === booking.member_id;
    const canOpenPayment = Boolean(
      detailMatchesBooking &&
        (booking.operation_kind === "trial"
          ? data?.canCreateContract
          : scheduleMemberDetail?.canRecordContractPayment || data?.canCreateContract),
    );
    return (
      <section className={`${styles.studentPaymentSummary} ${styles.fieldFull}`}>
        <div className={styles.studentPaymentHeader}>
          <div>
            <span className={styles.label}>學員款項</span>
            <strong>尾款狀態</strong>
          </div>
          <div className={styles.bookingStatusActions}>
            {!coachView && bookingMember ? (
              <button
                className={styles.button}
                type="button"
                onClick={() => void loadMember(bookingMember)}
              >
                        <UserRoundCheck size={17} /> 付款紀錄
              </button>
            ) : null}
            {canOpenPayment ? (
              <button
                className={`${styles.button} ${styles.gold}`}
                type="button"
                onClick={() => openStudentPayment(booking)}
              >
                <CircleDollarSign size={17} /> 付款
              </button>
            ) : null}
          </div>
        </div>
        {scheduleMemberDetailLoading ? (
          <p className={styles.muted}>讀取學員合約與付款資料中…</p>
        ) : scheduleMemberDetailError ? (
          <p className={styles.error} role="alert">{scheduleMemberDetailError}</p>
        ) : detailMatchesBooking ? (
          <>
            <div className={styles.studentPaymentBalanceRow}>
              <span
                className={`${styles.studentPaymentBalance} ${
                  schedulePaymentBalanceState === "balance_due"
                    ? styles.studentPaymentBalanceDue
                    : ""
                }`}
              >
                <small>
                  {schedulePaymentBalanceState === "no_contract"
                    ? "合約狀態"
                    : schedulePaymentBalanceState === "balance_due"
                      ? "尚有尾款"
                      : "尾款狀態"}
                </small>
                <strong>
                  {schedulePaymentBalanceState === "no_contract"
                    ? "尚未建立正式合約"
                    : schedulePaymentBalanceState === "balance_due"
                      ? formatMoney(scheduleOutstandingBalance)
                      : "已結清"}
                </strong>
              </span>
              <span className={styles.studentPaymentMeta}>
                {schedulePaymentBalanceState === "no_contract"
                  ? "尾款尚無法判定"
                  : `${scheduleActiveContractCount} 份有效正式合約`}
              </span>
            </div>
            {scheduleCourseSessionSummary.contractCount > 0 ? (
              <section className={styles.studentCourseSessionSummary}>
                <div className={styles.studentCourseSessionHeader}>
                  <div>
                    <span className={styles.label}>課程堂數</span>
                    <strong>
                      總堂數 {scheduleCourseSessionSummary.usedSessions}／
                      {scheduleCourseSessionSummary.totalSessions}
                    </strong>
                  </div>
                  {scheduleMemberDetail.canManageCourseAllocations ? (
                    <button
                      className={styles.button}
                      type="button"
                      onClick={openCourseAllocationDialog}
                    >
                      <Settings2 size={16} />
                      {scheduleCourseSessionSummary.unconfiguredContracts > 0
                        ? "設定專項堂數"
                        : "調整專項堂數"}
                    </button>
                  ) : null}
                </div>
                {scheduleCourseSessionSummary.allocatedCourseTypes.length ? (
                  <div className={styles.studentCourseSessionGrid}>
                    {scheduleCourseSessionSummary.allocatedCourseTypes.map((course) => (
                      <div className={styles.studentCourseSessionItem} key={course}>
                        <span>{BIGE_COURSE_LABELS[course]}</span>
                        <strong>
                          {scheduleCourseSessionSummary.used[course]}／
                          {scheduleCourseSessionSummary.allocations[course]}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : null}
                {scheduleCourseSessionSummary.unconfiguredContracts > 0 ? (
                  <p className={styles.studentCourseSessionUnset}>
                    專項堂數尚未設定
                  </p>
                ) : null}
              </section>
            ) : null}
            {scheduleMemberDetail.canViewDetailedPaymentDates ? (
              <div className={styles.studentPaymentHistory}>
                <span className={styles.label}>主管可見｜每筆付款日期</span>
                {scheduleMemberDetail.payments.length ? (
                  scheduleMemberDetail.payments.map((payment) => (
                    <div className={styles.studentPaymentHistoryItem} key={payment.id}>
                      <span>
                        <strong>{formatMoney(payment.amount)}</strong>
                        {" · "}
                        {labelOrValue(PAYMENT_KIND_LABELS, payment.payment_kind)}
                        {" · "}
                        {labelOrValue(PAYMENT_METHOD_LABELS, payment.method)}
                        {payment.method === "ecpay_installment" && payment.installment_count
                          ? ` · ${payment.installment_count} 期`
                          : ""}
                      </span>
                      <span>
                        {payment.paid_at ? formatDateTime(payment.paid_at) : "未記錄日期"}
                        {" · "}
                        {labelOrValue(PAYMENT_RECORD_STATUS_LABELS, payment.status)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className={styles.muted}>目前沒有付款紀錄。</p>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <p className={styles.muted}>尚未取得學員付款資料。</p>
        )}
      </section>
    );
  };

  return (
    <main
      className={`${styles.page} ${styles.managerPage} ${styles.frontdeskM2A}`}
      data-ipad-schedule-overview={useIpadScheduleOverview ? "true" : undefined}
      data-ipad-pro-desktop-layout={useIpadProDesktopLayout ? "true" : undefined}
      data-daily-schedule-active={tab === "schedule" ? "true" : undefined}
    >
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>BIG E FITNESS OPERATIONS</p>
            <h1 className={styles.title}>{viewCopy[view].title}</h1>
            <p className={styles.subtitle}>{viewCopy[view].subtitle}</p>
          </div>
          <div className={styles.headerActions}>
            {!previewData ? (
              <div className={styles.sessionActions}>
                <span className={styles.sessionIdentity}>
                  <span>目前登入：{sessionLabel}</span>
                  {sessionPositionLabel ? (
                    <strong className={styles.positionBadge}>{sessionPositionLabel}</strong>
                  ) : null}
                </span>
                {canOpenAccountSettings ? (
                  <>
                    <a className={styles.button} href="/staff/account#email">
                      <Mail size={16} />
                      更改信箱
                    </a>
                    <a className={styles.button} href="/staff/account#password">
                      <KeyRound size={16} />
                      更改密碼
                    </a>
                  </>
                ) : null}
                <a className={`${styles.button} ${styles.logoutButton}`} href="/logout">
                  <LogOut size={17} />
                  登出
                </a>
              </div>
            ) : null}
          </div>
        </header>

        <div className={styles.navigationRow}>
          <nav className={styles.tabs} aria-label="營運功能">
            <button className={`${styles.tab} ${tab === "schedule" ? styles.activeTab : ""}`} onClick={() => setTab("schedule")}>
              日排課表
            </button>
            {canOpenTrialBookings ? (
              <a className={`${styles.tab} ${styles.gold}`} href="/admin/trial-bookings">
                首次體驗預約管理
              </a>
            ) : null}
            {!coachView ? (
              <button className={`${styles.tab} ${tab === "contracts" ? styles.activeTab : ""}`} onClick={() => setTab("contracts")}>
                會員與合約
              </button>
            ) : null}
            {managerView ? (
              <button className={`${styles.tab} ${tab === "plans" ? styles.activeTab : ""}`} onClick={() => setTab("plans")}>
                方案設定
              </button>
            ) : null}
            {managerView ? (
              <button className={`${styles.tab} ${tab === "report" ? styles.activeTab : ""}`} onClick={() => setTab("report")}>
                每日報表
              </button>
            ) : null}
            {managerView ? (
              <a className={`${styles.tab} ${styles.gold}`} href="/manager/approvals">
                <ClipboardCheck size={16} />
                待覆核事項
              </a>
            ) : null}
            {!coachView ? (
              <button
                className={`${styles.tab} ${tab === "assistance" ? styles.activeTab : ""}`}
                type="button"
                onClick={() => setTab("assistance")}
              >
                行政協助事項
              </button>
            ) : null}
            {!loading && data && tab === "schedule" && managerView ? (
              <button
                className={`${styles.tab} ${styles.primary}`}
                type="button"
                onClick={() => setStaffManagerOpen(true)}
              >
                新增教練
              </button>
            ) : null}
          </nav>
          <div className={styles.dateToolbarDock}>
            {success ? (
              <div className={styles.successToast} role="status" aria-live="polite">
                <span>{success}</span>
                {scheduleEditUndo ? (
                  <button
                    className={styles.successToastUndo}
                    type="button"
                    disabled={!scheduleEditUndo.ready || scheduleEditUndoSubmitting}
                    title={scheduleEditUndo.ready ? "復原這次排課編輯" : "排課儲存完成後即可復原"}
                    onClick={() => void undoScheduleEdit()}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    {scheduleEditUndoSubmitting ? "復原中…" : "復原"}
                  </button>
                ) : scheduleMoveUndo ? (
                  <button
                    className={styles.successToastUndo}
                    type="button"
                    disabled={scheduleMoveUndoSubmitting}
                    onClick={() => void undoScheduleMove()}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    {scheduleMoveUndoSubmitting ? "復原中…" : "復原"}
                  </button>
                ) : scheduleDeleteUndo ? (
                  <button
                    className={styles.successToastUndo}
                    type="button"
                    disabled={!scheduleDeleteUndo.ready || scheduleDeleteUndoSubmitting}
                    title={scheduleDeleteUndo.ready ? "復原剛才刪除的預約" : "預約刪除完成後即可復原"}
                    onClick={() => void undoScheduleDelete()}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    {scheduleDeleteUndoSubmitting ? "復原中…" : "復原"}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div
              ref={dateToolbarRef}
              className={`${styles.toolbar} ${styles.dateToolbar}`}
              role="group"
              aria-label="日期切換，可使用滑鼠滾輪切換前後日期"
              title="滑鼠滾輪：上滑前一天、下滑後一天"
            >
              <button className={styles.iconButton} onClick={() => shiftBoardDate(-1)} title="前一天">
                <ChevronLeft size={18} />
              </button>
              <input
                className={styles.input}
                type="date"
                value={date}
                aria-label={`排課日期，${weekdayLabel(date)}`}
                onChange={(event) => selectBoardDate(event.target.value)}
              />
              <span className={styles.weekdayBadge} aria-live="polite">
                {weekdayLabel(date)}
              </span>
              <button className={styles.iconButton} onClick={() => shiftBoardDate(1)} title="後一天">
                <ChevronRight size={18} />
              </button>
              <button className={styles.iconButton} onClick={() => void loadBoard({ silent: true })} title="重新整理">
                <RefreshCw size={18} />
              </button>
              {tab === "schedule" && data?.canManageDailyReports ? (
                <a
                  className={`${styles.button} ${styles.primary} ${styles.settlementButton}`}
                  href={`/manager/staff-performance?month=${date.slice(0, 7)}&date=${date}`}
                  title={
                    data.closure?.status === "confirmed"
                      ? "前往今日結算／重新開啟更正"
                      : data.canConfirmDailyReports
                        ? "前往正式結算今日課程與業績"
                        : "前往完成日結初審並送經理"
                  }
                >
                  <ClipboardCheck size={17} aria-hidden="true" />
                  日結
                </a>
              ) : null}
            </div>
          </div>
          {data ? (
            <div className={styles.businessDayControls}>
              <span
                className={styles.frontdeskStatus}
                title="櫃台人員將由班表自動帶入，此處不可修改"
              >
                櫃台：<strong>{frontdeskName || "未設定"}</strong>
              </span>
              {tab === "schedule" && data.canManageSchedule && !previewData ? (
                <button
                  className={styles.scheduleLockButton}
                  data-unlocked={String(scheduleDragUnlocked)}
                  type="button"
                  aria-pressed={scheduleDragUnlocked}
                  title={
                    scheduleDragUnlocked
                      ? "目前可拖移課程；30 秒沒有操作會自動鎖定"
                      : "點擊後開放拖移課程"
                  }
                  onClick={() => {
                    setError("");
                    setScheduleDragUnlocked((current) => {
                      if (current) setActiveScheduleDrag(null);
                      return !current;
                    });
                  }}
                >
                  {scheduleDragUnlocked ? (
                    <LockOpen size={15} aria-hidden="true" />
                  ) : (
                    <Lock size={15} aria-hidden="true" />
                  )}
                  {scheduleDragUnlocked ? "可拖移課程" : "課表已鎖定"}
                </button>
              ) : null}
              {tab === "schedule" && data.canManageSchedule && !previewData ? (
                <button className={styles.scheduleToolButton} type="button" onClick={openMonthlySchedule}>
                  <CalendarDays size={15} aria-hidden="true" />
                  月排課／查詢
                </button>
              ) : null}
              {tab === "schedule" ? (
                <button
                  className={styles.scheduleToolButton}
                  data-active={String(hideOffCoaches)}
                  type="button"
                  aria-pressed={hideOffCoaches}
                  onClick={() => setHideOffCoaches((current) => !current)}
                >
                  {hideOffCoaches ? "顯示休假" : "隱藏休假"}
                </button>
              ) : null}
              {tab === "schedule" && data.canViewScheduleActivity && !previewData ? (
                <button className={styles.scheduleToolButton} type="button" onClick={() => void openScheduleActivity()}>
                  <ClipboardCheck size={15} aria-hidden="true" />
                  操作紀錄
                </button>
              ) : null}
              {data.canManageBusinessClosure ? (
                <button
                  className={`${styles.closureToggle} ${isBusinessClosed ? styles.closureActive : ""}`}
                  type="button"
                  disabled={businessDaySubmitting}
                  onClick={() => {
                    const nextClosed = !isBusinessClosed;
                    const accepted = window.confirm(
                      nextClosed
                        ? `確定將 ${date} 設為館休日？當日將停止排課、預約與自主訓練報到放行。`
                        : `確定取消 ${date} 的館休設定？`,
                    );
                    if (accepted) {
                      void persistBusinessDay({
                        isClosed: nextClosed,
                        closureLabel: nextClosed ? "館休" : null,
                      });
                    }
                  }}
                >
                  {isBusinessClosed ? "取消館休" : "設為館休"}
                </button>
              ) : isBusinessClosed ? (
                <span className={styles.closureReadOnly}>館休</span>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}
        {loading ? <DailyScheduleLoadingBoard /> : null}

        {!loading && data && isBusinessClosed ? (
          <section className={styles.closureBanner} role="status">
            <span className={styles.closureKicker}>FACILITY CLOSED</span>
            <strong>{data.businessDay?.closure_label || "館休"}</strong>
            <p>本日不營業；排課、首次體驗與自主訓練報到／放行均已停止。既有行程僅供主管檢查衝突。</p>
          </section>
        ) : null}

        {!loading && data && tab === "schedule" ? (
          visibleCoaches.length ? (
            <>
              <div className={styles.mobileCoach}>
                <label className={styles.label}>手機顯示方式</label>
                <select className={styles.select} value={selectedCoach} onChange={(event) => setSelectedCoach(event.target.value)}>
                  {data.coachScheduleScope === "all" ? (
                    <option value="all">全部教練</option>
                  ) : null}
                  {visibleCoaches.map((coach) => (
                    <option value={coach.id} key={coach.id}>
                      {coachLabel(coach)}
                    </option>
                  ))}
                </select>
              </div>
              <DndContext
                id="bige-daily-schedule"
                sensors={scheduleDragSensors}
                collisionDetection={bigeScheduleCollisionDetection}
                onDragStart={handleScheduleDragStart}
                onDragEnd={handleScheduleDragEnd}
                onDragCancel={() => {
                  lastScheduleDragAtRef.current = Date.now();
                  setActiveScheduleDrag(null);
                  setActiveCoachDrag(null);
                }}
              >
                <ScheduleDeleteDropZone
                  active={activeScheduleDrag?.kind === "booking"}
                  submitting={scheduleDeleteSubmitting}
                />
                <section
                  ref={boardWrapRef}
                  className={`${styles.glass} ${styles.boardWrap}`}
                  aria-label="日排課表，可使用滑鼠滾輪切換前後日期"
                  data-date-direction={boardDateDirection || undefined}
                >
                  <div
                    className={styles.board}
                    data-mobile-show-all={String(selectedCoach === "all")}
                    data-dragging={String(Boolean(activeScheduleDrag))}
                    style={
                      {
                        "--coach-count": visibleCoaches.length,
                        "--all-board-width": `${visibleCoaches.length * (62 + 190)}px`,
                      } as React.CSSProperties
                    }
                  >
                    {visibleCoaches.map((coach) => (
                      <Fragment key={coach.id}>
                        <div
                          className={styles.timeHead}
                          data-mobile-active={String(
                            selectedCoach === "all" || coach.id === selectedCoach,
                          )}
                        >
                          時間
                        </div>
                        <DraggableCoachHeader
                          coach={coach}
                          label={coachLabel(coach)}
                          title={coachPositionShortLabel(coach)}
                          status={
                            data.coachDayStatuses?.find(
                              (status) => status.coach_id === coach.id,
                            ) || null
                          }
                          enabled={Boolean(data.canReorderCoaches) && !previewData && !coachOrderSubmitting}
                          mobileActive={selectedCoach === "all" || coach.id === selectedCoach}
                        />
                      </Fragment>
                    ))}
                    {hours.map((hour) => (
                      <HourRow
                        key={hour}
                        date={date}
                        hour={hour}
                        coaches={visibleCoaches}
                        selectedCoach={selectedCoach}
                        bookings={data.bookings}
                        notes={data.notes}
                        coachDayStatuses={data.coachDayStatuses || []}
                        faAssistantToConflicts={data.faAssistantToConflicts || []}
                        classroomConflicts={data.classroomConflicts || []}
                        members={members}
                        trialBookings={trialBookings}
                        showTrialRevenue={Boolean(data.canSeeTrialRevenue)}
                        canCreate={Boolean(data.canManageSchedule) && !isBusinessClosed}
                        canDrag={
                          Boolean(data.canManageSchedule) &&
                          !isBusinessClosed &&
                          scheduleDragUnlocked &&
                          !scheduleDeleteSubmitting
                        }
                        activeDragMinute={
                          activeScheduleDrag?.kind === "booking"
                            ? (localMinutes(activeScheduleDrag.item.starts_at) % 60 as 0 | 30)
                            : null
                        }
                        scheduleNoteUndo={scheduleNoteUndo}
                        restoringScheduleNote={restoringScheduleNote}
                        onRestoreScheduleNote={restoreScheduleNote}
                        onBookingPrefetch={prefetchScheduleMemberDetail}
                        onCell={openScheduleCell}
                      />
                    ))}
                  </div>
                </section>
                <DragOverlay dropAnimation={null}>
                  {activeScheduleDrag?.kind === "booking" ? (
                    <div className={styles.scheduleDragOverlay}>
                      <strong>{scheduleBookingLabel(activeScheduleDrag.item)}</strong>
                    </div>
                  ) : activeCoachDrag ? (
                    <div className={styles.coachDragOverlay}>
                      <GripVertical size={17} aria-hidden="true" />
                      <strong>
                        {coachLabel(activeCoachDrag)}
                        {coachPositionShortLabel(activeCoachDrag)
                          ? ` · ${coachPositionShortLabel(activeCoachDrag)}`
                          : ""}
                      </strong>
                      <span>移動整欄</span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </>
          ) : (
            <section className={`${styles.glass} ${styles.section} ${styles.emptyState}`}>
              <h2 className={styles.sectionTitle}>尚未建立教練帳號</h2>
              <p className={styles.muted}>
                請先由主管建立教練的後台帳號，日排課表才會顯示教練欄位。
              </p>
              {managerView ? (
                <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => setStaffManagerOpen(true)}>
                  新增教練
                </button>
              ) : null}
            </section>
          )
        ) : null}

        {!loading && data && tab === "contracts" ? (
          <section className={`${styles.glass} ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>會員與合約</h2>
                <span className={styles.muted}>搜尋既有會員，或直接建立正式會員</span>
              </div>
              <button className={`${styles.button} ${styles.primary}`} onClick={() => openContract()}>
                直接建立正式會員
              </button>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>姓名、電話或會員編號</label>
              <div className={styles.toolbar}>
                <Search size={18} />
                <input className={styles.input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="輸入關鍵字" />
              </div>
            </div>
            {searchResults.members.length ? (
              <div className={styles.list}>
                {searchResults.members.map((member) => (
                  <button
                    className={styles.listItem}
                    type="button"
                    key={member.id}
                    onPointerEnter={() => void fetchMemberDetail(member.id).catch(() => undefined)}
                    onFocus={() => void fetchMemberDetail(member.id).catch(() => undefined)}
                    onClick={() => void loadMember(member)}
                  >
                    <strong>{member.full_name}</strong>{" "}
                    <span className={styles.badge}>{getBigeMemberDisplayNumber(member) || "尚未成交"}</span>
                    {member.legacy_shared ? <span className={styles.badge}>共用合約</span> : null}
                    <div className={styles.muted}>{member.phone || "無電話"}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {!loading && data && tab === "plans" ? (
          <section className={`${styles.glass} ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>正式課程方案</h2>
                <span className={styles.muted}>舊方案已從新流程隱藏，現有訂單與 ACPay 不受影響</span>
              </div>
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={() => {
                  setPlanError("");
                  setDialog("plan");
                }}
              >
                新增方案
              </button>
            </div>
            <div className={styles.grid3}>
              {data.plans.map((plan) => {
                const terms = calculateContractTerms(plan.total_sessions);
                return (
                  <article className={styles.plan} key={plan.id}>
                    <h3>{plan.name}</h3>
                    <p className={styles.metric}>{formatMoney(plan.price_amount)}</p>
                    <p className={styles.muted}>
                      {plan.total_sessions} 堂 · 效期 {terms.validityDays} 天 · 最多延期 {terms.extensionLimitDays} 天
                    </p>
                    <p className={styles.muted}>
                      重訓 {plan.course_allocations.weight_training || 0} / 放鬆 {plan.course_allocations.relaxation || 0} / 皮拉提斯{" "}
                      {plan.course_allocations.reformer_pilates || 0}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {!loading && data && tab === "reminders" ? (
          <section className={`${styles.glass} ${styles.section}`}>
            <h2 className={styles.sectionTitle}>{reminderDate} 明日 FA 聯絡清單</h2>
            <p className={styles.muted}>顯示 {reminderDate} 的 FA，並可直接更新聯絡結果。</p>
            <div className={styles.list}>
              {remindersLoading ? <p className={styles.muted}>讀取明日 FA 中…</p> : null}
              {!remindersLoading && reminderData && reminderData.bookings.filter(
                (booking) => booking.operation_kind === "trial",
              ).length === 0 ? <p className={styles.muted}>明日目前沒有 FA。</p> : null}
              {!remindersLoading && reminderData ? reminderData.bookings
                .filter((booking) => booking.operation_kind === "trial")
                .map((booking) => {
                  const member = reminderMembers.get(booking.member_id);
                  return (
                    <article className={styles.listItem} key={booking.id}>
                      <div className={styles.sectionHeader}>
                        <div>
                          <strong>{member?.full_name || "體驗學員"}</strong> · {slotKey(booking.starts_at)} ·{" "}
                          {booking.trial_stage}
                          <div className={styles.muted}>{member?.phone}</div>
                        </div>
                        <select
                          className={styles.select}
                          value={booking.reminder_status}
                          onChange={async (event) => {
                            try {
                              await post({
                                action: "update_reminder",
                                bookingId: booking.id,
                                status: event.target.value,
                              });
                              await loadReminders();
                            } catch (caught) {
                              showOperationAlert(
                                caught instanceof Error ? caught.message : "更新失敗",
                                "無法更新提醒狀態",
                              );
                            }
                          }}
                        >
                          <option value="pending">待聯絡</option>
                          <option value="reached">已提醒</option>
                          <option value="no_answer">未接</option>
                          <option value="retry">稍後再聯絡</option>
                        </select>
                      </div>
                    </article>
                  );
                }) : null}
            </div>
          </section>
        ) : null}

        {!loading && data && tab === "report" ? (
          <section className={`${styles.glass} ${styles.section}`}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>{date} 每日報表</h2>
                <span className={styles.badge}>{data.closure?.status || "尚未產生"}</span>
              </div>
              <a className={`${styles.button} ${data.closure?.status === "confirmed" ? "" : styles.primary}`} href={`/manager/staff-performance?month=${date.slice(0, 7)}&date=${date}`}>
                {data.closure?.status === "confirmed" ? <RotateCcw size={17} /> : <ClipboardCheck size={17} />}
                {data.closure?.status === "confirmed" ? "前往今日結算／重開" : data.canConfirmDailyReports ? "前往正式結算課程與業績" : "完成初審並送經理"}
              </a>
            </div>
            {(data.legacyPurchaseDateReminders || []).length > 0 ? (
              <div className={styles.list} style={{ marginBottom: 20 }}>
                <article className={styles.warning} role="alert">
                  今日完成課程的會員仍有舊合約缺少購買日。請由副理補登後再確認日報；系統會以「購買日＋堂數×3.5天＋30天」自動計算到期日。
                </article>
                {(data.legacyPurchaseDateReminders || []).map((reminder) => {
                  const purchaseDate = legacyPurchaseDates[reminder.id] || "";
                  const expiryDate = purchaseDate
                    ? calculateLegacyContractExpiryDate(purchaseDate, reminder.total_sessions)
                    : null;
                  return (
                    <article className={styles.listItem} key={reminder.id}>
                      <div className={styles.sectionHeader}>
                        <div>
                          <strong>
                            {reminder.member_name}
                            {reminder.legacy_numbers.length
                              ? `｜會員編號 ${reminder.legacy_numbers.join("、")}`
                              : ""}
                          </strong>
                          <div className={styles.muted}>
                            {reminder.contract_number}｜{reminder.total_sessions}堂方案｜剩餘
                            {reminder.remaining_sessions}堂
                            {reminder.first_class_at
                              ? `｜今日上課 ${formatDateTime(reminder.first_class_at)}`
                              : ""}
                          </div>
                        </div>
                        <div className={styles.actions}>
                          <label className={styles.label}>
                            購買日
                            <input
                              className={styles.input}
                              type="date"
                              max={localDate()}
                              value={purchaseDate}
                              disabled={!data.canManageDailyReports || legacyPurchaseDateSubmitting === reminder.id}
                              onChange={(event) =>
                                setLegacyPurchaseDates((current) => ({
                                  ...current,
                                  [reminder.id]: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <span className={styles.muted}>
                            {expiryDate ? `到期日 ${expiryDate}` : "輸入後顯示到期日"}
                          </span>
                          <button
                            className={`${styles.button} ${styles.primary}`}
                            type="button"
                            disabled={
                              !data.canManageDailyReports ||
                              !purchaseDate ||
                              legacyPurchaseDateSubmitting === reminder.id
                            }
                            onClick={() => void submitLegacyPurchaseDate(reminder)}
                          >
                            {legacyPurchaseDateSubmitting === reminder.id ? "儲存中…" : "保存購買日"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
            <div className={styles.grid3}>
              <div className={styles.summary}>
                <span className={styles.label}>全部安排</span>
                <strong className={styles.metric}>{data.bookings.length}</strong>
              </div>
              <div className={styles.summary}>
                <span className={styles.label}>已完成</span>
                <strong className={styles.metric}>{data.bookings.filter((item) => item.status === "completed").length}</strong>
              </div>
              <div className={styles.summary}>
                <span className={styles.label}>待處理</span>
                <strong className={styles.metric}>
                  {data.bookings.filter((item) => ["pending", "confirmed", "booked", "checked_in"].includes(item.status)).length}
                </strong>
              </div>
            </div>
            {data.expiringContracts.length ? (
              <>
                <h3 className={styles.sectionTitle} style={{ marginTop: 22 }}>
                  期限提醒
                </h3>
                <div className={styles.list}>
                  {data.expiringContracts.map((contract) => (
                    <article className={styles.warning} key={contract.id}>
                      {contract.contract_number} · 到期 {formatDateTime(contract.ends_at)} · 可延期餘額{" "}
                      {contract.extension_limit_days - contract.extension_used_days} 天
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {!loading && data && tab === "assistance" ? (
          <AdministrativeAssistanceBoard
            embedded
            premium
            returnTo={managerView ? "/manager/fitness" : "/frontdesk/fitness"}
          />
        ) : null}
      </div>

      {dialog === "member" && selectedMember ? (
        <Dialog
          title={`會員資料｜${selectedMember.full_name}`}
          wide
          onClose={() => {
            setDialog(null);
            setSelectedMember(null);
            setSelectedContract(null);
            setMemberDetail(null);
            setMemberDetailError("");
          }}
        >
          {memberDetailError ? (
            <p className={styles.error} role="alert">
              {memberDetailError}
            </p>
          ) : memberDetail ? (
            <div className={styles.memberDetailDialog}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3 className={styles.sectionTitle}>{memberDetail.member.full_name}</h3>
                  <span className={styles.muted}>
                    {getBigeMemberDisplayNumber(memberDetail.member) || "尚未取得會員編號"} · {memberDetail.member.phone || "無電話"}
                    {memberDetail.member.legacy_shared ? " · 共用合約" : ""}
                  </span>
                </div>
                {!memberDetail.member.member_code ? (
                  <button
                    className={`${styles.button} ${styles.gold}`}
                    type="button"
                    onClick={() => openContract(undefined, memberDetail.member)}
                  >
                    建立正式會員
                  </button>
                ) : null}
              </div>
              <div className={styles.list}>
                {memberDetail.contracts.map((contract) => {
                  const contractPayments = memberDetail.payments.filter(
                    (payment) => payment.contract_id === contract.id,
                  );
                  const isVoidedContract = contract.status === "canceled";
                  const outstandingBalance = calculateBigeContractOutstandingBalance(
                    contract.total_amount,
                    contractPayments,
                  );
                  const includedCourses = BIGE_CONTRACT_COURSE_TYPES.filter(
                    (course) =>
                      Number(contract.course_allocations?.[course] || 0) > 0 ||
                      Number(contract.course_used?.[course] || 0) > 0,
                  );

                  return (
                  <details
                    className={`${styles.contract} ${styles.contractDisclosure} ${
                      isVoidedContract ? styles.contractVoided : ""
                    }`}
                    key={contract.id}
                  >
                    <summary className={styles.contractSummary}>
                      <span
                        className={`${styles.contractSummaryStat} ${styles.contractSummaryBalance}`}
                      >
                        <span>尚有尾款</span>
                        <strong>{formatMoney(outstandingBalance)}</strong>
                      </span>
                      <span className={styles.contractSummaryStat}>
                        <span>合約總額</span>
                        <strong>{formatMoney(contract.total_amount)}</strong>
                      </span>
                      <span className={styles.contractSummaryStat}>
                        <span>合約到期日</span>
                        <strong>{formatDate(contract.ends_at)}</strong>
                      </span>
                      <span className={styles.contractSummaryStat}>
                        <span>目前可使用</span>
                        <strong>{contract.unlocked_sessions} 堂</strong>
                      </span>
                      <span
                        className={styles.contractSummaryCourses}
                        aria-label={
                          includedCourses.length
                            ? `包含課程：${includedCourses
                                .map((course) => BIGE_COURSE_LABELS[course])
                                .join("、")}`
                            : "未設定課程類型"
                        }
                      >
                        {includedCourses.map((course) => (
                          <span className={styles.contractCourseChip} key={course}>
                            {BIGE_COURSE_LABELS[course]}
                          </span>
                        ))}
                      </span>
                      {isVoidedContract ? (
                        <span
                          className={styles.contractVoidedStamp}
                          aria-label="此合約已作廢"
                        >
                          已作廢
                        </span>
                      ) : null}
                      <span className={styles.contractSummaryChevron} aria-hidden="true">
                        <ChevronDown size={19} />
                      </span>
                    </summary>
                    <div className={styles.contractExpanded}>
                    <div className={`${styles.sectionHeader} ${styles.contractHeader}`}>
                      <div className={styles.contractHeading}>
                        <span className={styles.contractEyebrow}>正式課程合約</span>
                        <div className={styles.contractTitleRow}>
                          <strong className={styles.contractNumber}>{contract.contract_number}</strong>
                          <span className={styles.badge}>
                            {labelOrValue(CONTRACT_PAYMENT_STATUS_LABELS, contract.payment_status)}
                          </span>
                        </div>
                      </div>
                      <div className={styles.actions}>
                        <button
                          className={styles.button}
                          type="button"
                          disabled={outstandingBalance <= 0}
                          title={
                            outstandingBalance <= 0
                              ? "此合約已無尾款"
                              : "登記合約付款"
                          }
                          onClick={() => {
                            setSelectedContract(contract);
                            setPaymentDraft({
                              paymentKind: "installment",
                              entries: [createPaymentEntryDraft()],
                              note: "",
                            });
                            setPaymentError("");
                            setDialog("payment");
                          }}
                        >
                          <CircleDollarSign size={17} /> 登記付款
                        </button>
                        {managerView ? (
                          <button
                            className={styles.button}
                            type="button"
                            onClick={() => {
                              setSelectedContract(contract);
                              setExtensionDraft({
                                days: Math.max(1, contract.extension_limit_days - contract.extension_used_days),
                                reason: "",
                                signedName: memberDetail.member.full_name,
                                signature: "",
                              });
                              setDialog("extension");
                            }}
                          >
                            <FileSignature size={17} /> 延期
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className={styles.contractOverview}>
                      <div className={`${styles.contractStat} ${styles.contractBalanceStat}`}>
                        <span>尚有尾款</span>
                        <strong>{formatMoney(outstandingBalance)}</strong>
                      </div>
                      <div className={styles.contractStat}>
                        <span>合約總額</span>
                        <strong>{formatMoney(contract.total_amount)}</strong>
                      </div>
                      <div className={styles.contractStat}>
                        <span>合約到期日</span>
                        <strong>{formatDate(contract.ends_at)}</strong>
                      </div>
                      <div className={styles.contractStat}>
                        <span>目前可使用</span>
                        <strong>{contract.unlocked_sessions} 堂</strong>
                      </div>
                      <div className={styles.contractStat}>
                        <span>已使用／總堂數</span>
                        <strong>
                          {contract.used_sessions}／{contract.total_sessions} 堂
                        </strong>
                      </div>
                    </div>
                    {includedCourses.length ? (
                      <section className={styles.courseAllocationSection}>
                        <h4>課程堂數</h4>
                        <div className={styles.courseAllocationGrid}>
                          {includedCourses.map((course) => (
                            <div className={styles.courseAllocationCard} key={course}>
                              <span>{BIGE_COURSE_LABELS[course]}</span>
                              <strong>
                                {contract.course_used?.[course] || 0}／{contract.course_allocations?.[course] || 0} 堂
                              </strong>
                              <small>已使用／總堂數</small>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                    {contractPayments.length ? (
                      <section className={styles.paymentSection}>
                        <h4>付款紀錄</h4>
                        <div className={styles.paymentList}>
                        {contractPayments.map((payment) => (
                            <div className={styles.paymentItem} key={payment.id}>
                              <div className={styles.paymentMain}>
                                <strong>{formatMoney(payment.amount)}</strong>
                                <span>
                                  {labelOrValue(PAYMENT_KIND_LABELS, payment.payment_kind)} ·{" "}
                                  {labelOrValue(PAYMENT_METHOD_LABELS, payment.method)}
                                  {payment.method === "ecpay_installment" && payment.installment_count
                                    ? ` · ${payment.installment_count} 期`
                                    : ""}
                                </span>
                                {payment.paid_at ? <small>{formatDateTime(payment.paid_at)}</small> : null}
                              </div>
                              <div className={styles.paymentSide}>
                                <span className={styles.badge}>
                                  {labelOrValue(PAYMENT_RECORD_STATUS_LABELS, payment.status)}
                                </span>
                                {managerView && memberDetail.canEditContractPayment ? (
                                  <button
                                    className={styles.button}
                                    type="button"
                                    onClick={() => openPaymentEditor(payment, contract)}
                                  >
                                    <Settings2 size={16} /> 修改
                                  </button>
                                ) : null}
                                {managerView && payment.status === "recorded" ? (
                                  <div className={styles.actions}>
                                  <button className={styles.button} type="button" onClick={() => void reversePayment(payment.id, "void")}>
                                    作廢
                                  </button>
                                  <button className={`${styles.button} ${styles.danger}`} type="button" onClick={() => void reversePayment(payment.id, "refund")}>
                                    退款
                                  </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                    </div>
                  </details>
                  );
                })}
                {!memberDetail.contracts.length ? <p className={styles.muted}>目前沒有正式課程合約。</p> : null}
              </div>
            </div>
          ) : null}
        </Dialog>
      ) : null}

      {dialog === "course-allocations" && selectedCourseAllocationContract ? (
        <Dialog
          title={`設定專項堂數｜${scheduleMemberDetail?.member.full_name || "學員"}`}
          onClose={closeCourseAllocationDialog}
          onCloseStart={() => setCourseAllocationReturnVisible(true)}
          revealBackgroundOnClose
        >
          <form className={styles.formGrid} onSubmit={submitCourseAllocations}>
            {courseAllocationError ? (
              <p className={`${styles.error} ${styles.fieldFull}`} role="alert">
                {courseAllocationError}
              </p>
            ) : null}
            {scheduleCourseAllocationContracts.length > 1 ? (
              <label className={`${styles.field} ${styles.fieldFull}`}>
                <span className={styles.label}>選擇合約</span>
                <select
                  className={styles.select}
                  value={courseAllocationContractId}
                  onChange={(event) => {
                    const contract = scheduleCourseAllocationContracts.find(
                      (item) => item.id === event.target.value,
                    );
                    if (!contract) return;
                    setCourseAllocationContractId(contract.id);
                    setCourseAllocationDraft(courseAllocationDraftFrom(contract));
                    setCourseAllocationError("");
                  }}
                >
                  {scheduleCourseAllocationContracts.map((contract) => (
                    <option value={contract.id} key={contract.id}>
                      {contract.contract_number}｜{contract.total_sessions} 堂
                      {contract.course_allocations_configured_at ? "｜已設定" : "｜尚未設定"}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className={`${styles.courseAllocationDialogSummary} ${styles.fieldFull}`}>
              <span>
                合約總堂數
                <strong>{selectedCourseAllocationContract.total_sessions}</strong>
              </span>
              <span>
                已使用總堂數
                <strong>{selectedCourseAllocationContract.used_sessions}</strong>
              </span>
              <span>
                已分配
                <strong>
                  {courseAllocationDraftTotal}／{selectedCourseAllocationContract.total_sessions}
                </strong>
              </span>
            </div>
            <p className={`${styles.warning} ${styles.fieldFull}`}>
              {selectedCourseAllocationContract.course_allocations_configured_at
                ? "修改分配不會重置各專項已使用堂數。"
                : "第一次設定後，各專項已使用堂數將從 0 開始。"}
            </p>
            {BIGE_CONTRACT_COURSE_TYPES.map((course) => {
              const used = configuredCourseUsed(selectedCourseAllocationContract, course);
              return (
                <label className={styles.field} key={course}>
                  <span className={styles.label}>{BIGE_COURSE_LABELS[course]}</span>
                  <StableNumberInput
                    className={styles.input}
                    min={used}
                    max={selectedCourseAllocationContract.total_sessions}
                    required
                    value={courseAllocationDraft[course]}
                    fallbackValue={used}
                    onValueChange={(value) =>
                      setCourseAllocationDraft((current) => ({
                        ...current,
                        [course]: Math.max(used, value),
                      }))
                    }
                  />
                  <small className={styles.muted}>目前已使用 {used} 堂</small>
                </label>
              );
            })}
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button
                className={`${styles.button} ${styles.primary}`}
                type="submit"
                disabled={
                  courseAllocationSubmitting ||
                  courseAllocationDraftTotal !== selectedCourseAllocationContract.total_sessions
                }
              >
                {courseAllocationSubmitting ? "儲存中…" : "儲存專項堂數"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "monthly-schedule" ? (
        <Dialog title="月排課與會員行程查詢" onClose={() => setDialog(null)}>
          {!monthlyMember ? (
            <section className={styles.monthlyMemberSearch}>
              <p className={styles.muted}>輸入會員編號、姓名或手機，選取後即可一次安排整月課程並查看本月行程。</p>
              <label className={styles.field}>
                <span className={styles.label}>搜尋會員</span>
                <div className={styles.searchBox}>
                  <Search size={18} aria-hidden="true" />
                  <input
                    className={styles.input}
                    autoFocus
                    value={monthlySearch}
                    onChange={(event) => setMonthlySearch(event.target.value)}
                    placeholder="姓名／手機／會員編號"
                  />
                </div>
              </label>
              <div className={styles.monthlyMemberResults}>
                {monthlySearchResults.map((member) => (
                  <button
                    type="button"
                    className={styles.monthlyMemberResult}
                    key={member.id}
                    onClick={() => {
                      setMonthlyMember(member);
                      setMonthlyData(null);
                      setMonthlyCoachId("");
                      setMonthlySearch(member.full_name);
                    }}
                  >
                    <strong>{member.full_name}</strong>
                    <span>{getBigeMemberDisplayNumber(member) || "未編號"} · {member.phone || "未留手機"}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className={styles.monthlyWorkspace}>
              <header className={styles.monthlyMemberHeader}>
                <div>
                  <span className={styles.label}>目前會員</span>
                  <strong>{monthlyMember.full_name}</strong>
                  <small>{getBigeMemberDisplayNumber(monthlyMember) || "未編號"} · {monthlyMember.phone || "未留手機"}</small>
                </div>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    setMonthlyMember(null);
                    setMonthlyData(null);
                    setMonthlyCoachId("");
                    setMonthlyDates([]);
                    setMonthlySearch("");
                  }}
                >
                  更換會員
                </button>
              </header>
              <label className={styles.field}>
                <span className={styles.label}>查詢月份</span>
                <input className={styles.input} type="month" value={monthlyMonth} onChange={(event) => setMonthlyMonth(event.target.value)} />
              </label>
              <div className={styles.monthlyColumns}>
                <form className={styles.monthlyPlanner} onSubmit={submitMonthlySchedule}>
                  <h3>批次安排課程</h3>
                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span className={styles.label}>教練</span>
                      <select className={styles.select} value={monthlyCoachId} onChange={(event) => setMonthlyCoachId(event.target.value)} required>
                        {monthlyCoachOptions.map((coach) => <option key={coach.id} value={coach.id}>{coachLabel(coach)}</option>)}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>類型</span>
                      <select className={styles.select} value={monthlyOperationKind} onChange={(event) => setMonthlyOperationKind(event.target.value as "pt" | "trial")}>
                        <option value="pt">正式課程</option>
                        <option value="trial">FA 體驗</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>課程項目</span>
                      <select className={styles.select} value={monthlyCourseType} onChange={(event) => setMonthlyCourseType(event.target.value as BigeCourseType)}>
                        {BIGE_COURSE_TYPES.map((course) => <option key={course} value={course}>{BIGE_COURSE_LABELS[course]}</option>)}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>上課時間（24 小時制）</span>
                      <select
                        className={styles.select}
                        value={monthlyTime}
                        onChange={(event) => setMonthlyTime(event.target.value)}
                        aria-label="上課時間（24 小時制）"
                      >
                        {monthlyTimeOptions.map((time) => (
                          <option key={time} value={time}>{time}</option>
                        ))}
                      </select>
                    </label>
                    <label className={`${styles.field} ${styles.fieldFull}`}>
                      <span className={styles.label}>備註（選填）</span>
                      <input className={styles.input} value={monthlyNote} onChange={(event) => setMonthlyNote(event.target.value)} />
                    </label>
                  </div>
                  <div className={styles.monthlyWeekdayTools}>
                    <span>快速選擇：</span>
                    {["週日", "週一", "週二", "週三", "週四", "週五", "週六"].map((label, weekday) => (
                      <button
                        className={styles.miniButton}
                        type="button"
                        key={label}
                        onClick={() => {
                          const candidates = monthDateValues(monthlyMonth).filter((day) => {
                            const [year, month, dateNumber] = day.split("-").map(Number);
                            return new Date(Date.UTC(year, month - 1, dateNumber)).getUTCDay() === weekday;
                          });
                          setMonthlyDates((current) => Array.from(new Set([...current, ...candidates])).sort());
                        }}
                      >{label}</button>
                    ))}
                    <button className={styles.miniButton} type="button" onClick={() => setMonthlyDates([])}>清除</button>
                  </div>
                  <div className={styles.monthCalendar}>
                    {monthDateValues(monthlyMonth).map((day) => {
                      const selected = monthlyDates.includes(day);
                      const conflict = monthlyConflictByDate.get(day);
                      return (
                        <button
                          className={styles.monthDay}
                          data-selected={String(selected)}
                          data-conflict={String(Boolean(conflict))}
                          type="button"
                          key={day}
                          title={conflict?.message}
                          aria-label={`${day}${conflict ? `，衝突：${conflict.message}` : selected ? "，已選取" : ""}`}
                          onClick={() => setMonthlyDates((current) => selected ? current.filter((item) => item !== day) : [...current, day].sort())}
                        >
                          <strong>{Number(day.slice(-2))}</strong><span>{weekdayLabel(day).replace("週", "")}</span>
                        </button>
                      );
                    })}
                  </div>
                  {monthlyDates.length ? (
                    <div className={styles.monthlyPreflightStatus} aria-live="polite">
                      {monthlyPreflightLoading ? <span>正在檢查所選日期的時段衝突…</span> : null}
                      {!monthlyPreflightLoading && monthlyPreflight ? (
                        <>
                          <span data-tone="success">可建立 {monthlyPreflight.available.length} 筆</span>
                          <span data-tone={monthlyPreflight.conflicts.length ? "danger" : "neutral"}>
                            衝突 {monthlyPreflight.conflicts.length} 筆
                          </span>
                          {monthlyPreflight.conflicts.length ? <small>紅色日期不會被覆蓋。</small> : null}
                        </>
                      ) : null}
                      {monthlyPreflightError ? <span data-tone="danger">{monthlyPreflightError}</span> : null}
                    </div>
                  ) : null}
                  <button
                    className={`${styles.button} ${styles.primary}`}
                    type="submit"
                    disabled={monthlySubmitting || monthlyPreflightLoading || monthlyDates.length === 0}
                  >
                    {monthlySubmitting ? "檢查中…" : `檢查 ${monthlyDates.length} 筆排課`}
                  </button>
                </form>
                <section className={styles.monthlyBookingList}>
                  <h3>{monthlyMonth.replace("-", " 年 ")} 月已排行程</h3>
                  {monthlyLoading ? <p className={styles.muted}>讀取中…</p> : null}
                  {!monthlyLoading && !monthlyData?.bookings.length ? <p className={styles.muted}>本月尚無排課。</p> : null}
                  {(monthlyData?.bookings || []).map((booking) => (
                    <article className={styles.monthlyBookingItem} key={booking.id}>
                      <time>{new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(booking.starts_at))}</time>
                      <strong>{booking.operation_kind === "trial" ? "FA" : BIGE_COURSE_LABELS[booking.course_type]}</strong>
                      <span>{coachLabel(monthlyCoachOptions.find((coach) => coach.id === booking.coach_id) || { id: "", display_name: null, english_name: null })} · {booking.status}</span>
                    </article>
                  ))}
                </section>
              </div>
            </div>
          )}
        </Dialog>
      ) : null}

      {dialog === "monthly-schedule-confirm" && monthlyMember && monthlyPreflight ? (
        <Dialog
          title={monthlyPreflight.available.length ? "確認批次排課" : "無法建立批次排課"}
          onClose={() => setDialog("monthly-schedule")}
          wide
        >
          <div className={styles.monthlyReview}>
            <div
              className={styles.monthlyReviewNotice}
              data-tone={monthlyPreflight.available.length ? "warning" : "danger"}
              role={monthlyPreflight.available.length ? "status" : "alert"}
            >
              <strong>
                {monthlyPreflight.available.length
                  ? "系統不會覆蓋任何既有行程"
                  : "所選日期全部有衝突，無法建立排課"}
              </strong>
              <span>
                嚴格維持一位教練同時只能帶一位學員；建立當下仍會再由資料庫做最後檢查。
              </span>
            </div>

            <div className={styles.monthlyReviewSummary}>
              <div><span>會員</span><strong>{monthlyMember.full_name}</strong></div>
              <div><span>教練</span><strong>{monthlySelectedCoach ? coachLabel(monthlySelectedCoach) : "未選擇"}</strong></div>
              <div><span>課程</span><strong>{monthlyOperationKind === "trial" ? "FA 體驗" : BIGE_COURSE_LABELS[monthlyCourseType]}</strong></div>
              <div><span>時間</span><strong>{monthlyTime}（24 小時制）</strong></div>
              <div data-tone="success"><span>可建立</span><strong>{monthlyPreflight.available.length} 筆</strong></div>
              <div data-tone={monthlyPreflight.conflicts.length ? "danger" : "neutral"}><span>衝突</span><strong>{monthlyPreflight.conflicts.length} 筆</strong></div>
            </div>

            {monthlyPreflight.conflicts.length ? (
              <section className={styles.monthlyConflictSection}>
                <h3>未建立的衝突日期</h3>
                <div className={styles.monthlyConflictList}>
                  {monthlyPreflight.conflicts.map((conflict) => (
                    <article className={styles.monthlyConflictItem} key={conflict.startsAt}>
                      <div>
                        <time>{formatDateTime(conflict.startsAt)}</time>
                        <strong>{conflict.message}</strong>
                      </div>
                      {conflict.conflictStartsAt ? (
                        <small>
                          原行程：{formatDateTime(conflict.conflictStartsAt)}
                          {conflict.conflictEndsAt ? `–${slotKey(conflict.conflictEndsAt)}` : ""}
                          {conflict.conflictMemberName ? ` · ${conflict.conflictMemberName}` : ""}
                          {conflict.conflictCoachName ? ` · ${conflict.conflictCoachName}` : ""}
                          {conflict.conflictCourseType
                            ? ` · ${BIGE_COURSE_LABELS[conflict.conflictCourseType as BigeCourseType] || conflict.conflictCourseType}`
                            : conflict.conflictServiceName
                              ? ` · ${conflict.conflictServiceName}`
                              : ""}
                          {conflict.conflictNote ? ` · ${conflict.conflictNote}` : ""}
                        </small>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <p className={styles.monthlyAllClear}>所有選取日期都可以建立，未發現時段衝突。</p>
            )}

            <div className={styles.formActions}>
              <button className={styles.button} type="button" onClick={() => setDialog("monthly-schedule")} disabled={monthlySubmitting}>
                返回調整
              </button>
              {monthlyPreflight.available.length ? (
                <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => void confirmMonthlySchedule()} disabled={monthlySubmitting}>
                  {monthlySubmitting ? "建立中…" : `只建立沒有衝突的日期（${monthlyPreflight.available.length} 筆）`}
                </button>
              ) : null}
            </div>
          </div>
        </Dialog>
      ) : null}

      {dialog === "monthly-schedule-result" && monthlyBatchResult ? (
        <Dialog title="批次排課結果" onClose={() => setDialog("monthly-schedule")} wide>
          <div className={styles.monthlyReview}>
            <div className={styles.monthlyReviewSummary}>
              <div data-tone="success"><span>建立成功</span><strong>{monthlyBatchResult.created.length} 筆</strong></div>
              <div data-tone={monthlyBatchResult.skipped.length + monthlyBatchResult.failures.length ? "danger" : "neutral"}>
                <span>未建立</span>
                <strong>{monthlyBatchResult.skipped.length + monthlyBatchResult.failures.length} 筆</strong>
              </div>
            </div>

            {monthlyBatchResult.created.length ? (
              <section className={styles.monthlyResultSection}>
                <h3>已成功建立</h3>
                <div className={styles.monthlyResultList}>
                  {monthlyBatchResult.created.map((created) => (
                    <div data-tone="success" key={created.startsAt}>{formatDateTime(created.startsAt)}</div>
                  ))}
                </div>
              </section>
            ) : null}

            {monthlyBatchResult.skipped.length || monthlyBatchResult.failures.length ? (
              <section className={styles.monthlyResultSection}>
                <h3>未建立（日期已保留選取）</h3>
                <div className={styles.monthlyConflictList}>
                  {monthlyBatchResult.skipped.map((conflict) => (
                    <article className={styles.monthlyConflictItem} key={`skipped-${conflict.startsAt}`}>
                      <div><time>{formatDateTime(conflict.startsAt)}</time><strong>{conflict.message}</strong></div>
                    </article>
                  ))}
                  {monthlyBatchResult.failures.map((failure) => (
                    <article className={styles.monthlyConflictItem} key={`failed-${failure.startsAt}`}>
                      <div><time>{formatDateTime(failure.startsAt)}</time><strong>{failure.message}</strong></div>
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <p className={styles.monthlyAllClear}>全部日期都已建立完成。</p>
            )}

            <div className={styles.formActions}>
              {monthlyBatchResult.skipped.length || monthlyBatchResult.failures.length ? (
                <button className={styles.button} type="button" onClick={() => setDialog("monthly-schedule")}>
                  返回調整未建立日期
                </button>
              ) : null}
              <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => setDialog(null)}>
                完成
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {dialog === "activity" ? (
        <Dialog title={`${date} 操作與登入紀錄`} onClose={() => setDialog(null)}>
          {activityLoading ? <p className={styles.muted}>正在彙整當日紀錄…</p> : null}
          {!activityLoading && activityData ? (
            <div className={styles.activityWorkspace}>
              <section>
                <h3>營運操作</h3>
                {!activityData.logs.length ? <p className={styles.muted}>本日沒有操作紀錄。</p> : null}
                <div className={styles.activityTimeline}>
                  {activityData.logs.map((log) => {
                    const actor = activityData.actors.find((item) => item.id === log.actor_id);
                    return (
                      <article className={styles.activityItem} key={log.id}>
                        <time>{formatActivityTime(log.created_at)}</time>
                        <div><strong>{String(log.action || "資料異動")}</strong><span>{actor?.display_name || actor?.employee_number || "系統"}</span></div>
                        <pre>{JSON.stringify(log.payload || {}, null, 2)}</pre>
                      </article>
                    );
                  })}
                </div>
              </section>
              <section>
                <h3>登入與頁面停留</h3>
                <div className={styles.activityTimeline}>
                  {activityData.loginEvents.map((event) => {
                    const actor = activityData.actors.find((item) => item.id === event.profile_id);
                    return <article className={styles.activityItem} key={event.id}><time>{formatActivityTime(event.created_at)}</time><div><strong>登入</strong><span>{actor?.display_name || actor?.employee_number || "員工"}</span></div></article>;
                  })}
                  {activityData.pageSessions.map((session) => {
                    const actor = activityData.actors.find((item) => item.id === session.profile_id);
                    return <article className={styles.activityItem} key={session.id}><time>{formatActivityTime(session.started_at)}</time><div><strong>{session.path || "頁面停留"}</strong><span>{actor?.display_name || actor?.employee_number || "員工"} · {session.duration_seconds || 0} 秒</span></div></article>;
                  })}
                </div>
              </section>
            </div>
          ) : null}
        </Dialog>
      ) : null}

      {dialog === "slot-time" && slotChoice ? (
        <Dialog
          title="選擇排課開始時間"
          onClose={() => {
            setSlotChoice(null);
            setDialog(null);
          }}
        >
          <p className={styles.muted}>請先選整點或半點，下一步再填寫排課內容。</p>
          <div className={styles.timeChoiceGrid}>
            {[0, 30].map((minute) => {
              const time = `${String(slotChoice.hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
              return (
                <button
                  className={styles.timeChoiceButton}
                  type="button"
                  key={time}
                  onClick={() => openSlot(slotChoice.coachId, time)}
                >
                  <strong>{time}</strong>
                  <span>{minute === 0 ? "整點" : "半點"}</span>
                </button>
              );
            })}
          </div>
        </Dialog>
      ) : null}

      {(dialog === "schedule" || showCourseAllocationScheduleBehind) && data ? (
        <Dialog
          background={showCourseAllocationScheduleBehind}
          className={
            editingSchedule?.kind === "booking"
              ? styles.scheduleEditDialog
              : undefined
          }
          title={
            editingSchedule?.kind === "note"
              ? "編輯自由文字"
              : editingSchedule
                ? "編輯原排課"
                : "新增排課"
          }
          onClose={() => {
            setEditingSchedule(null);
            setDialog(null);
          }}
        >
          <form className={styles.formGrid} onSubmit={submitSchedule}>
            <label className={styles.field}>
              <span className={styles.label}>教練</span>
              <select className={styles.select} value={selectedCoach} onChange={(event) => setSelectedCoach(event.target.value)} required>
                {data.coaches.map((coach) => (
                  <option key={coach.id} value={coach.id}>
                    {coachLabel(coach)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>時間</span>
              <select
                className={styles.select}
                value={scheduleDraft.time}
                onChange={(event) => setScheduleDraft({ ...scheduleDraft, time: event.target.value })}
              >
                {[0, 30].map((minute) => {
                  const hour = scheduleDraft.time.slice(0, 2);
                  const time = `${hour}:${String(minute).padStart(2, "0")}`;
                  return (
                    <option key={time} value={time}>
                      {date} {time}（{minute === 0 ? "整點" : "半點"}）
                    </option>
                  );
                })}
              </select>
            </label>
            {editingSchedule?.kind !== "note" ? (
              <>
                <label className={styles.field}>
                  <span className={styles.label}>類型</span>
                  <select
                    className={styles.select}
                    value={scheduleDraft.operationKind}
                    disabled={Boolean(editingSchedule)}
                    onChange={(event) => {
                      const operationKind = event.target.value as "pt" | "trial";
                      setScheduleDraft({
                        ...scheduleDraft,
                        operationKind,
                        memberId: "",
                        trialBookingId: "",
                        duration:
                          operationKind === "trial"
                            ? BIGE_FA_DURATION_MINUTES
                            : scheduleDraft.duration,
                      });
                      setSelectedScheduleMemberResult(null);
                      setSelectedScheduleTrialResult(null);
                      setScheduleSearch("");
                      setScheduleResults({ members: [], trials: [] });
                    }}
                  >
                    <option value="pt">PT 正式課</option>
                    <option value="trial">FA 體驗</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>課別</span>
                  <select
                    className={styles.select}
                    value={scheduleDraft.courseType}
                    onChange={(event) => setScheduleDraft({ ...scheduleDraft, courseType: event.target.value as BigeCourseType })}
                  >
                    {(scheduleDraft.operationKind === "trial"
                      ? BIGE_TRIAL_COURSE_TYPES
                      : BIGE_CONTRACT_COURSE_TYPES
                    ).map((course) => (
                      <option key={course} value={course}>
                        {BIGE_COURSE_LABELS[course]}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className={styles.field}>
              <span className={styles.label}>時長</span>
              <select
                className={styles.select}
                value={scheduleDraft.duration}
                disabled={scheduleDraft.operationKind === "trial"}
                onChange={(event) => setScheduleDraft({ ...scheduleDraft, duration: Number(event.target.value) })}
              >
                <option value={30}>30 分鐘</option>
                <option value={60}>60 分鐘</option>
                <option value={90}>90 分鐘</option>
                <option value={120}>120 分鐘</option>
              </select>
            </label>
            {editingSchedule?.kind !== "note" ? (
              <>
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.label}>{editingSchedule ? "學員" : "搜尋學員"}</span>
                  <input
                    className={styles.input}
                    value={scheduleSearch}
                    readOnly={Boolean(editingSchedule)}
                    onChange={(event) => {
                      setScheduleSearch(event.target.value);
                      setSelectedScheduleMemberResult(null);
                      setSelectedScheduleTrialResult(null);
                      setScheduleDraft({
                        ...scheduleDraft,
                        memberId: "",
                        trialBookingId: "",
                      });
                    }}
                  />
                </label>
                {!editingSchedule ? (
                  <div className={`${styles.list} ${styles.fieldFull}`}>
                    {(scheduleDraft.operationKind === "pt" ? scheduleResults.members : scheduleResults.trials).map((item: any) => (
                      <button
                        type="button"
                        className={styles.listItem}
                        key={item.id}
                        onClick={() => {
                          if (scheduleDraft.operationKind === "pt") {
                            setScheduleDraft({ ...scheduleDraft, memberId: item.id });
                            setSelectedScheduleMemberResult(item as Member);
                            setSelectedScheduleTrialResult(null);
                          } else {
                            setScheduleDraft({ ...scheduleDraft, trialBookingId: item.id });
                            setSelectedScheduleMemberResult(null);
                            setSelectedScheduleTrialResult(item as TrialBookingSummary);
                          }
                          setScheduleSearch(item.full_name || item.name);
                          setScheduleResults({ members: [], trials: [] });
                        }}
                      >
                        <strong>{item.full_name || item.name}</strong> · {item.phone}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            {editingSchedule?.kind === "booking"
              ? renderStudentPaymentSummary(editingSchedule.item)
              : null}
            <label
              className={`${styles.field} ${styles.fieldFull} ${
                editingSchedule?.kind === "booking"
                  ? styles.scheduleEditNoteField
                  : ""
              }`}
            >
              <span className={styles.label}>自由文字</span>
              <textarea
                className={styles.textarea}
                placeholder="可輸入這筆排課的備註內容"
                required={editingSchedule?.kind === "note"}
                value={scheduleDraft.note}
                onChange={(event) => setScheduleDraft({ ...scheduleDraft, note: event.target.value })}
              />
            </label>
            <div
              className={`${styles.formActions} ${styles.fieldFull} ${
                editingSchedule?.kind === "booking"
                  ? styles.scheduleEditActions
                  : ""
              }`}
            >
              <button className={`${styles.button} ${styles.primary}`} type="submit">
                <Check size={17} /> {editingSchedule ? "儲存變更" : "建立排課"}
              </button>
              {editingSchedule?.kind === "booking" ? (
                <>
                  {editingSchedule.item.operation_kind === "trial" ? (
                    <button
                      className={`${styles.button} ${styles.reminderButton} ${
                        isBigeTrialReminderConfirmed(editingSchedule.item.reminder_status)
                          ? styles.reminderButtonDone
                          : ""
                      }`}
                      type="button"
                      disabled={
                        reminderSubmittingId === editingSchedule.item.id
                      }
                      onClick={() => void toggleTrialReminder(editingSchedule.item)}
                    >
                      <BellRing size={17} />
                      {reminderSubmittingId === editingSchedule.item.id
                        ? "記錄中…"
                        : isBigeTrialReminderConfirmed(editingSchedule.item.reminder_status)
                          ? "取消已提醒"
                          : "標記已提醒"}
                    </button>
                  ) : null}
                  <button
                    className={styles.button}
                    type="button"
                    onClick={() => {
                      setSelectedBooking(editingSchedule.item);
                      setTrialOutcomePrompt(false);
                      setTrialConversionEditing(false);
                      setDialog("booking");
                    }}
                  >
                    課程狀態操作
                  </button>
                </>
              ) : null}
              {editingSchedule?.kind === "note" && !editingSchedule.item.system_kind ? (
                <button
                  className={`${styles.button} ${styles.danger}`}
                  type="button"
                  disabled={!data.canManageSchedule || deletingScheduleNote}
                  onClick={() => void deleteScheduleNote()}
                >
                  <Trash2 size={17} />
                  {deletingScheduleNote ? "刪除中…" : "刪除自由文字"}
                </button>
              ) : null}
            </div>
          </form>
        </Dialog>
      ) : null}

      {(dialog === "booking" || showCourseAllocationBookingBehind) && selectedBooking ? (
        <Dialog
          background={
            showCourseAllocationBookingBehind ||
            faFeeRecipientPrompt?.bookingId === selectedBooking.id
          }
          title={`${selectedBooking.operation_kind === "trial" ? "FA 體驗" : "課程操作"}｜${members.get(selectedBooking.member_id)?.full_name || "學員"}`}
          onClose={() => {
            if (bookingActionSubmitting || trialConversionSubmitting) return;
            setOperationAlert(null);
            setTrialConversionEditing(false);
            setDialog(null);
          }}
        >
          <div className={styles.bookingStatusPanel}>
            <div className={styles.bookingStatusSummary}>
              <div className={styles.bookingStatusSummaryItem}>
                <span>預約時間</span>
                <strong>{formatDateTime(selectedBooking.starts_at)}</strong>
              </div>
              <div className={styles.bookingStatusSummaryItem}>
                <span>課程項目</span>
                <strong>{scheduleCourseLabel(selectedBooking.course_type)}</strong>
              </div>
              <div className={styles.bookingStatusSummaryItem}>
                <span>目前狀態</span>
                <strong>{labelOrValue(BOOKING_STATUS_LABELS, selectedBooking.status)}</strong>
              </div>
            </div>

            {renderStudentPaymentSummary(selectedBooking)}

            {selectedBooking.status !== "cancelled" &&
            selectedBooking.status !== "no_show" &&
            !canOperateSelectedBooking ? (
              <div className={styles.bookingStatusWindowNote}>
                <CalendarDays size={17} />
                <span>
                  完成、扣堂與其他狀態只能在預約前 30 分鐘至結束後 30 分鐘內操作。
                  {canCancelSelectedBooking
                    ? selectedBooking.operation_kind === "pt"
                      ? " 標記未出席仍可操作。"
                      : " 取消課程仍可操作。"
                    : ""}
                </span>
              </div>
            ) : null}

            {selectedBooking.status === "cancelled" ? (
              <>
                <div className={styles.bookingStatusGuidance}>
                  <RotateCcw size={20} />
                  <div>
                    <strong>此課程已取消</strong>
                    <span>排課資料仍保留在原時段；需要恢復時可按下復原課程。</span>
                  </div>
                </div>
                <div className={styles.bookingStatusActions}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={!data?.canManageSchedule || restoringCancelledBooking}
                    onClick={() => void restoreCancelledSchedule()}
                  >
                    <RotateCcw size={17} />
                    {restoringCancelledBooking ? "復原中…" : "復原課程"}
                  </button>
                </div>
              </>
            ) : selectedBooking.status === "no_show" ? (
              <>
                <div className={styles.bookingStatusGuidance}>
                  <RotateCcw size={20} />
                  <div>
                    <strong>此課程已標記未出席</strong>
                    <span>若剛才操作錯誤，可恢復為原預約狀態；此操作不會扣除堂數。</span>
                  </div>
                </div>
                <div className={styles.bookingStatusActions}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={!data?.canManageSchedule || restoringNoShowBooking}
                    onClick={() => void restoreNoShowSchedule()}
                  >
                    <RotateCcw size={17} />
                    {restoringNoShowBooking ? "復原中…" : "復原未出席"}
                  </button>
                </div>
              </>
            ) : selectedBooking.operation_kind === "pt" ? (
              <>
                <div className={styles.bookingStatusGuidance}>
                  {selectedBooking.status === "completed" ? (
                    <RotateCcw size={20} />
                  ) : (
                    <UserRoundCheck size={20} />
                  )}
                  <div>
                    <strong>{selectedBooking.status === "completed" ? "課程已完成" : "確認本堂結果"}</strong>
                    <span>
                      {selectedBooking.status === "completed"
                        ? "本堂已扣除；再次點擊可復原為未扣課狀態。"
                        : "學員到場完成課程後，按下完成上課即可扣除一堂。"}
                    </span>
                  </div>
                </div>
                <div className={styles.bookingStatusActions}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={bookingActionSubmitting}
                    onClick={() => void completePt(canOperateSelectedBooking)}
                  >
                    {bookingActionSubmitting ? (
                      <>處理中…</>
                    ) : selectedBooking.status === "completed" ? (
                      <><RotateCcw size={17} /> 復原為未扣課</>
                    ) : (
                      <><UserRoundCheck size={17} /> 完成上課並扣除一堂</>
                    )}
                  </button>
                  {selectedBooking.status !== "completed" ? (
                    <>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={!canCancelSelectedBooking || scheduleDeleteSubmitting}
                        onClick={() => void updateBooking("no_show")}
                      >
                        標記未出席
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.danger}`}
                        disabled={!canCancelSelectedBooking || scheduleDeleteSubmitting}
                        onClick={() =>
                          void deleteScheduleBooking(selectedBooking, {
                            closeBookingDialog: true,
                          })
                        }
                      >
                        <Trash2 size={17} /> 刪除此預約
                      </button>
                    </>
                  ) : null}
                </div>
              </>
            ) : (
              <div className={styles.trialOutcomePanel}>
                {selectedBooking.fa_fee_recipient_name ? (
                  <div className={styles.bookingStatusWindowNote}>
                    <CircleDollarSign size={17} />
                    <span>
                      FA 費用 {formatMoney(selectedBooking.fa_fee_amount || 880)}｜收款人：
                      {selectedBooking.fa_fee_recipient_name}
                    </span>
                  </div>
                ) : null}
                {selectedBooking.converted_at ? (
                  <>
                    <div className={styles.trialConvertedNotice}>
                      <CircleDollarSign size={18} />
                      <div>
                        <strong>此 FA 已成交並建立正式會員</strong>
                        {typeof selectedBooking.converted_payment_amount === "number" ? (
                          <span>本次實收 {formatMoney(selectedBooking.converted_payment_amount)}</span>
                        ) : null}
                      </div>
                    </div>
                    {trialConversionEditing ? (
                      <form
                        className={styles.trialConversionEditor}
                        onSubmit={(event) => void changeTrialConversion(event)}
                      >
                        <div className={styles.formGrid}>
                          <label className={styles.field}>
                            <span>成交結果</span>
                            <select
                              className={styles.select}
                              autoFocus
                              value={trialConversionOutcomeDraft}
                              onChange={(event) =>
                                setTrialConversionOutcomeDraft(
                                  event.target.value as "converted" | "not_converted",
                                )
                              }
                            >
                              <option value="converted">成交</option>
                              <option
                                value="not_converted"
                                disabled={!data?.canRestoreTrialConversion}
                              >
                                未成交{data?.canRestoreTrialConversion ? "" : "（需經理權限）"}
                              </option>
                            </select>
                          </label>
                          {trialConversionOutcomeDraft === "converted" ? (
                            <label className={styles.field}>
                              <span>變更成交金額</span>
                              <StableNumberInput
                                className={styles.input}
                                inputMode="numeric"
                                min="1"
                                required
                                value={trialConversionAmount}
                                fallbackValue={1}
                                onValueChange={setTrialConversionAmount}
                              />
                            </label>
                          ) : (
                            <div className={`${styles.warning} ${styles.fieldFull}`}>
                              改為未成交會作廢首次付款並取消本次建立的合約；會員基本資料會保留。
                            </div>
                          )}
                        </div>
                        <div className={styles.bookingStatusActions}>
                          <button
                            type="button"
                            className={styles.button}
                            disabled={trialConversionSubmitting !== null}
                            onClick={() => setTrialConversionEditing(false)}
                          >
                            取消
                          </button>
                          <button
                            type="submit"
                            className={`${styles.button} ${styles.primary}`}
                            disabled={trialConversionSubmitting !== null}
                          >
                            {trialConversionSubmitting === "change" ||
                            trialConversionSubmitting === "outcome"
                              ? "儲存中…"
                              : "儲存變更"}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className={styles.bookingStatusActions}>
                        {data?.canRestoreTrialConversion ? (
                          <button
                            type="button"
                            className={`${styles.button} ${styles.danger}`}
                            disabled={trialConversionSubmitting !== null}
                            onClick={() => void restoreTrialConversion()}
                          >
                            <RotateCcw size={17} />
                            {trialConversionSubmitting === "restore" ? "復原中…" : "復原"}
                          </button>
                        ) : null}
                        {data?.canChangeTrialConversion ? (
                          <button
                            type="button"
                            className={`${styles.button} ${styles.primary}`}
                            disabled={trialConversionSubmitting !== null}
                            onClick={beginTrialConversionChange}
                          >
                            <Settings2 size={17} />
                            變更
                          </button>
                        ) : null}
                      </div>
                    )}
                  </>
                ) : selectedTrialActionVisibility.showOutcomeChoices ? (
                  <div className={styles.trialOutcomeChoice}>
                    <strong>
                      {selectedBooking.status === "completed"
                        ? "修改本次 FA 結果"
                        : "請選擇本次 FA 結果"}
                    </strong>
                    <div className={styles.bookingStatusActions}>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.gold}`}
                        disabled={!canOperateSelectedBooking || trialOutcomeSubmitting !== null}
                        onClick={() => void completeTrialOutcome("pending_conversion")}
                      >
                        <CircleDollarSign size={17} />
                        {trialOutcomeSubmitting === "pending_conversion" ? "處理中…" : "成交"}
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={!canOperateSelectedBooking || trialOutcomeSubmitting !== null}
                        onClick={() => openFaFeeRecipientPrompt("not_converted")}
                      >
                        {trialOutcomeSubmitting === "not_converted" ? "處理中…" : "未成交"}
                      </button>
                    </div>
                  </div>
                ) : selectedBooking.trial_conversion_outcome === "pending_conversion" ? (
                  <div className={styles.trialPendingConversionNotice}>
                    <CircleDollarSign size={18} />
                    <div>
                      <strong>成交建檔尚未完成</strong>
                      <span>可繼續建立正式會員，或改記為未成交。</span>
                    </div>
                  </div>
                ) : selectedBooking.trial_conversion_outcome === "not_converted" ? (
                  <div className={styles.trialNotConvertedNotice}>
                    <RotateCcw size={18} />
                    <div>
                      <strong>此 FA 已記錄為未成交</strong>
                      <span>若剛才操作錯誤，可重新修改結果。</span>
                    </div>
                  </div>
                ) : null}
                <div className={styles.bookingStatusActions}>
                  {canReviseBigeTrialOutcome({ convertedAt: selectedBooking.converted_at }) &&
                  !trialOutcomePrompt ? (
                    selectedBooking.status !== "completed" ? (
                      <button
                        type="button"
                        disabled={!canOperateSelectedBooking || trialOutcomeSubmitting !== null}
                        className={styles.button}
                        onClick={() => openFaFeeRecipientPrompt("not_converted")}
                      >
                        {trialOutcomeSubmitting === "not_converted" ? "處理中…" : "未成交"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!canOperateSelectedBooking}
                        className={`${styles.button} ${styles.primary}`}
                        onClick={() => setTrialOutcomePrompt(true)}
                      >
                        {selectedBooking.trial_conversion_outcome === "pending_conversion"
                          ? "繼續成交／修改結果"
                          : "修改 FA 結果"}
                      </button>
                    )
                  ) : null}
                  {selectedTrialActionVisibility.showSecondaryStatusActions ? (
                    <>
                      <button disabled={!canOperateSelectedBooking} className={styles.button} onClick={() => void updateBooking("no_show")}>
                        未到場
                      </button>
                      <button disabled={!canOperateSelectedBooking} className={styles.button} onClick={() => void updateBooking("rescheduled")}>
                        改期
                      </button>
                      <button disabled={!canCancelSelectedBooking} className={`${styles.button} ${styles.danger}`} onClick={() => void updateBooking("cancelled")}>
                        取消
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </Dialog>
      ) : null}

      {dialog === "contract" && data ? (
        <Dialog
          background={faFeeRecipientPrompt?.action === "confirm_payment"}
          title={
            selectedBooking?.operation_kind === "trial" && !studentPaymentContext
              ? "FA 成交"
              : "直接建立正式會員"
          }
          onClose={() => {
            setStudentPaymentContext(null);
            setDialog(null);
          }}
        >
          <form className={styles.formGrid} onSubmit={submitContract}>
            {contractError ? (
              <p className={`${styles.error} ${styles.fieldFull}`} role="alert">
                {contractError}
              </p>
            ) : null}
            <label className={styles.field}>
              <span className={styles.label}>真實姓名</span>
              <input className={styles.input} disabled={contractIdentityLocked} required value={contractDraft.fullName} onChange={(event) => setContractDraft({ ...contractDraft, fullName: event.target.value })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>手機</span>
              <input className={styles.input} disabled={contractIdentityLocked} required inputMode="numeric" pattern="09[0-9]{8}" value={contractDraft.phone} onChange={(event) => setContractDraft({ ...contractDraft, phone: event.target.value.replace(/\D/g, "").slice(0, 10) })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>生日</span>
              <input className={styles.input} disabled={contractIdentityLocked} required={!contractIdentityLocked} type="date" value={contractDraft.birthDate} onChange={(event) => setContractDraft({ ...contractDraft, birthDate: event.target.value })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Email</span>
              <input className={styles.input} type="email" disabled={contractIdentityLocked || contractDraft.emailUnavailable} required={!contractDraft.emailUnavailable} value={contractDraft.email} onChange={(event) => setContractDraft({ ...contractDraft, email: event.target.value })} />
            </label>
            {contractIdentityLocked ? (
              <p className={`${styles.lockedIdentityNote} ${styles.fieldFull}`}>
                {studentPaymentContext
                  ? studentPaymentContext.paymentType === "new"
                    ? "姓名、手機、生日、Email、款項類型與簽約日已由本堂 FA 資料帶入，付款時不可更改。"
                    : "姓名、手機、生日與 Email 已由本堂學員資料帶入，付款時不可更改。"
                  : "姓名、手機、生日與簽約日已由 FA 資料帶入，成交時不可直接更改。"}
              </p>
            ) : null}
            {missingContractIdentityFields.length > 0 ? (
              <p className={`${styles.error} ${styles.fieldFull}`} role="alert">
                {studentPaymentContext ? "學員資料缺少" : "原始 FA 缺少"}
                {missingContractIdentityFields.join("、")}，請先由主管至會員個資補齊後再建立合約。
              </p>
            ) : null}
            {!studentPaymentContext ? (
            <div className={`${styles.contractCheckboxRow} ${styles.fieldFull}`}>
              <label className={styles.contractCheckbox}>
                <input type="checkbox" checked={contractDraft.emailUnavailable} onChange={(event) => setContractDraft({ ...contractDraft, emailUnavailable: event.target.checked, email: event.target.checked ? "" : contractDraft.email })} />
                學員明確表示沒有 Email
              </label>
              <label className={styles.contractCheckbox}>
                <input
                  type="checkbox"
                  checked={
                    forceManagerProfileChangeNotification ||
                    contractDraft.notifyManagerProfileChange
                  }
                  disabled={forceManagerProfileChangeNotification}
                  onChange={(event) =>
                    setContractDraft({
                      ...contractDraft,
                      notifyManagerProfileChange: event.target.checked,
                    })
                  }
                />
                通知主管更改個資
              </label>
            </div>
            ) : null}
            {studentPaymentContext ? (
              <>
                <label className={styles.field}>
                  <span className={styles.label}>款項類型</span>
                  <select
                    className={styles.select}
                    value={studentPaymentContext.paymentType}
                    disabled={studentPaymentContext.paymentType === "new"}
                    aria-readonly={studentPaymentContext.paymentType === "new"}
                    onChange={(event) => {
                      const paymentType = event.target.value as "new" | "renewal" | "balance";
                      setStudentPaymentContext({
                        ...studentPaymentContext,
                        paymentType,
                        amount: "",
                        contractId:
                          paymentType === "balance"
                            ? studentPaymentContext.contractId ||
                              scheduleOutstandingContracts[0]?.contract.id ||
                              ""
                            : studentPaymentContext.contractId,
                      });
                      setContractPaymentEntries([createPaymentEntryDraft()]);
                      setContractError("");
                    }}
                  >
                    {studentPaymentContext.paymentType === "new" ? (
                      <option value="new">新單 New</option>
                    ) : (
                      <>
                        <option value="renewal">續約 Re</option>
                        <option value="balance">尾款 PTP</option>
                      </>
                    )}
                  </select>
                </label>
                {studentPaymentContext.paymentType === "balance" ? (
                  <label className={`${styles.field} ${styles.fieldFull}`}>
                    <span className={styles.label}>尾款合約</span>
                    <select
                      className={styles.select}
                      value={studentPaymentContext.contractId}
                      onChange={(event) =>
                        {
                          setStudentPaymentContext({
                            ...studentPaymentContext,
                            contractId: event.target.value,
                            amount: "",
                          });
                          setContractPaymentEntries([createPaymentEntryDraft()]);
                        }
                      }
                    >
                      {scheduleOutstandingContracts.length ? (
                        scheduleOutstandingContracts.map((item) => (
                          <option key={item.contract.id} value={item.contract.id}>
                            {item.contract.contract_number} · 尾款 {formatMoney(item.outstanding)}
                          </option>
                        ))
                      ) : (
                        <option value="">目前沒有尾款合約</option>
                      )}
                    </select>
                    <small className={styles.fieldHelp}>
                      {studentPaymentTarget
                        ? `本次最多可收 ${formatMoney(studentPaymentTarget.outstanding)}`
                        : "仍可改選續約 Re；尾款 PTP 需有尚未結清的合約。"}
                    </small>
                  </label>
                ) : null}
              </>
            ) : null}
            {studentPaymentContext?.paymentType !== "balance" ? (
            <>
            <div className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>方案</span>
              <div className={styles.contractPlanMode} role="group" aria-label="方案類型">
                <button
                  type="button"
                  className={`${styles.button} ${contractDraft.planMode === "builtin" ? styles.primary : ""}`}
                  aria-pressed={contractDraft.planMode === "builtin"}
                  onClick={() => setContractDraft({ ...contractDraft, planMode: "builtin" })}
                >
                  內建方案
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${contractDraft.planMode === "custom" ? styles.primary : ""}`}
                  aria-pressed={contractDraft.planMode === "custom"}
                  onClick={() => setContractDraft({ ...contractDraft, planMode: "custom" })}
                >
                  自訂方案
                </button>
              </div>
            </div>
            {contractDraft.planMode === "builtin" ? (
              <label className={`${styles.field} ${styles.fieldFull}`}>
                <span className={styles.label}>內建方案</span>
                <select className={styles.select} required value={contractDraft.planId} onChange={(event) => setContractDraft({ ...contractDraft, planId: event.target.value })}>
                  <option value="">請選擇</option>
                  {data.plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} · {plan.total_sessions} 堂 · {formatMoney(plan.price_amount)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className={`${styles.customPlanFields} ${styles.fieldFull}`}>
                <label className={styles.field}>
                  <span className={styles.label}>自訂方案名稱</span>
                  <input className={styles.input} required value={customContractPlan.name} onChange={(event) => setCustomContractPlan({ ...customContractPlan, name: event.target.value })} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>總價</span>
                  <StableNumberInput className={styles.input} min="1" required value={customContractPlan.totalAmount} fallbackValue={1} onValueChange={(totalAmount) => setCustomContractPlan({ ...customContractPlan, totalAmount })} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>總堂數</span>
                  <StableNumberInput
                    className={styles.input}
                    min="1"
                    required
                    value={customContractPlan.totalSessions}
                    fallbackValue={1}
                    onValueChange={(totalSessions) => {
                      const normalizedSessions = Math.max(1, Math.trunc(totalSessions));
                      const terms = calculateContractTerms(normalizedSessions);
                      setCustomContractPlan({
                        ...customContractPlan,
                        totalSessions: normalizedSessions,
                        validityDays: terms.validityDays,
                        extensionLimitDays: terms.extensionLimitDays,
                      });
                    }}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>有效天數</span>
                  <StableNumberInput className={styles.input} min="1" required value={customContractPlan.validityDays} fallbackValue={1} onValueChange={(validityDays) => setCustomContractPlan({ ...customContractPlan, validityDays })} />
                  <small className={styles.fieldHelp}>
                    堂數 × 3.5 天向上取整，再加 30 天；變更堂數時自動更新。
                    預計到期日 {shiftDate(contractDraft.signedOn, customContractPlan.validityDays)}。
                  </small>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>最多延期天數</span>
                  <StableNumberInput className={styles.input} min="0" required value={customContractPlan.extensionLimitDays} onValueChange={(extensionLimitDays) => setCustomContractPlan({ ...customContractPlan, extensionLimitDays })} />
                </label>
                {BIGE_CONTRACT_COURSE_TYPES.map((course) => (
                  <label className={styles.field} key={course}>
                    <span className={styles.label}>{BIGE_COURSE_LABELS[course]}堂數</span>
                    <StableNumberInput
                      className={styles.input}
                      min="0"
                      required
                      value={customContractPlan.allocations[course]}
                      onValueChange={(value) =>
                        setCustomContractPlan({
                          ...customContractPlan,
                          allocations: {
                            ...customContractPlan.allocations,
                            [course]: value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.label}>方案說明</span>
                  <textarea className={styles.textarea} maxLength={500} value={customContractPlan.description} onChange={(event) => setCustomContractPlan({ ...customContractPlan, description: event.target.value })} />
                </label>
                {!validateCourseAllocationTotal(customContractPlan.allocations, customContractPlan.totalSessions) ? (
                  <p className={`${styles.error} ${styles.fieldFull}`}>各課別堂數加總必須等於總堂數。</p>
                ) : null}
              </div>
            )}
            </>
            ) : null}
            {studentPaymentContext?.paymentType !== "balance" ? (
            <label className={styles.field}>
              <span className={styles.label}>簽約日</span>
              <input
                className={styles.input}
                required
                type="date"
                value={
                  selectedBooking?.operation_kind === "trial"
                    ? localDate()
                    : contractDraft.signedOn
                }
                disabled={selectedBooking?.operation_kind === "trial"}
                aria-readonly={selectedBooking?.operation_kind === "trial"}
                onChange={(event) => setContractDraft({ ...contractDraft, signedOn: event.target.value })}
              />
            </label>
            ) : null}
            <section className={`${styles.paymentSplitSection} ${styles.fieldFull}`}>
              <div className={styles.paymentSplitHeader}>
                <div>
                  <span className={styles.label}>
                    {studentPaymentContext || selectedBooking?.operation_kind === "trial"
                      ? "本次付款"
                      : "首次付款"}
                  </span>
                  <small>同一天可用不同付款方式拆成多筆。</small>
                </div>
                <strong>合計 {formatMoney(contractPaymentTotal)}</strong>
              </div>
              <div className={styles.paymentSplitList}>
                {contractPaymentEntries.map((entry, index) => (
                  <div className={styles.paymentSplitRow} key={entry.id}>
                    <label className={styles.field}>
                      <span className={styles.label}>第 {index + 1} 筆金額</span>
                      <input
                        className={styles.input}
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={
                          studentPaymentContext?.paymentType === "balance"
                            ? studentPaymentTarget?.outstanding || undefined
                            : maximumInitialPayment || undefined
                        }
                        required={contractPaymentRequired || contractPaymentEntries.length > 1}
                        value={entry.amount}
                        onChange={(event) => {
                          const amount = event.target.value;
                          setContractPaymentEntries((current) =>
                            current.map((item) => item.id === entry.id ? { ...item, amount } : item),
                          );
                          if (studentPaymentContext) {
                            const nextEntries = contractPaymentEntries.map((item) =>
                              item.id === entry.id ? { ...item, amount } : item,
                            );
                            setStudentPaymentContext({
                              ...studentPaymentContext,
                              amount: String(paymentEntryTotal(nextEntries) || ""),
                            });
                          }
                        }}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>付款方式</span>
                      <select
                        className={styles.select}
                        value={entry.method}
                        onChange={(event) => {
                          const method = event.target.value;
                          let installmentCount: number | null = null;
                          if (method === "ecpay_installment") {
                            installmentCount = promptEcpayInstallmentCount(entry.installmentCount);
                            if (installmentCount === null) return;
                          }
                          setContractPaymentEntries((current) =>
                            current.map((item) =>
                              item.id === entry.id ? { ...item, method, installmentCount } : item,
                            ),
                          );
                        }}
                      >
                        <option value="cash">現金</option>
                        <option value="bank_transfer">轉帳</option>
                        <option value="card_terminal">刷卡機</option>
                        <option value="ecpay">綠界</option>
                        <option value="ecpay_installment">綠界分期</option>
                        <option value="acpay">ACPay</option>
                        <option value="other">其他</option>
                      </select>
                      {entry.method === "ecpay_installment" && entry.installmentCount ? (
                        <small className={styles.fieldHelp}>已設定 {entry.installmentCount} 期</small>
                      ) : null}
                    </label>
                    {contractPaymentEntries.length > 1 ? (
                      <button
                        className={`${styles.button} ${styles.danger} ${styles.paymentSplitRemove}`}
                        type="button"
                        onClick={() =>
                          setContractPaymentEntries((current) =>
                            current.filter((item) => item.id !== entry.id),
                          )
                        }
                        aria-label={`刪除第 ${index + 1} 筆付款`}
                      >
                        <Trash2 size={16} /> 刪除
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                className={styles.button}
                type="button"
                disabled={contractPaymentEntries.length >= 10}
                onClick={() =>
                  setContractPaymentEntries((current) => [...current, createPaymentEntryDraft()])
                }
              >
                ＋ 新增一筆付款方式
              </button>
            </section>
            {selectedBooking?.operation_kind === "trial" && Number(selectedBooking.future_trial_booking_count || 0) > 0 ? (
              <label className={styles.field}>
                <span className={styles.label}>
                  同一學員後續已排的其他 FA（{selectedBooking.future_trial_booking_count} 筆）
                </span>
                <select className={styles.select} value={contractDraft.futureTrialAction} onChange={(event) => setContractDraft({ ...contractDraft, futureTrialAction: event.target.value })}>
                  <option value="convert_to_pt">保留時段，全部改為正式 PT</option>
                  <option value="cancel">全部取消其他 FA</option>
                </select>
                <small className={styles.fieldHelp}>
                  只影響現在之後同一學員的其他 FA，不影響本次；若沒有其他預約則不會變更任何課程。
                </small>
              </label>
            ) : null}
            {studentPaymentContext?.paymentType !== "balance" && maximumInitialPayment > 0 && contractPlanTotalSessions > 0 ? (
              <p className={`${styles.warning} ${styles.fieldFull}`}>
                {studentPaymentContext || selectedBooking?.operation_kind === "trial"
                  ? "本次付款"
                  : "首次付款"}上限：{formatMoney(maximumInitialPayment)}（合約總額）；
                {studentPaymentContext || selectedBooking?.operation_kind === "trial"
                  ? "必須付款，最低為"
                  : "若有付款，最低為"}
                {formatMoney(
                  calculateMinimumDeposit(
                    maximumInitialPayment,
                    contractPlanTotalSessions,
                  ),
                )}；目前合計 {formatMoney(contractPaymentTotal)}
              </p>
            ) : null}
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button
                className={`${styles.button} ${styles.primary}`}
                type="submit"
                disabled={
                  contractSubmitting ||
                  missingContractIdentityFields.length > 0 ||
                  (studentPaymentContext?.paymentType === "balance" &&
                    (!scheduleMemberDetail?.canRecordContractPayment ||
                      !studentPaymentTarget ||
                      !isBigeContractPaymentAmountAllowed(
                        contractPaymentTotal,
                        studentPaymentTarget.outstanding,
                      ))) ||
                  (studentPaymentContext?.paymentType !== "balance" &&
                    !isBigeContractPaymentAmountAllowed(
                      contractPaymentTotal,
                      maximumInitialPayment,
                      {
                        minimumAmount:
                          studentPaymentContext || selectedBooking?.operation_kind === "trial"
                            ? minimumInitialPayment
                            : 0,
                      },
                    )) ||
                  Boolean(
                    studentPaymentContext &&
                      studentPaymentContext.paymentType !== "balance" &&
                      !data.canCreateContract,
                  )
                }
              >
                {contractSubmitting ? (
                  <>
                    <RefreshCw className={styles.processingIcon} size={17} />
                    {studentPaymentContext ? "付款中…" : "建立中…"}
                  </>
                ) : (
                  <>
                    <Check size={17} /> {studentPaymentContext ? "確認付款" : "確認建立"}
                  </>
                )}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "plan" ? (
        <Dialog title="新增正式課程方案" onClose={() => setDialog(null)}>
          <form className={styles.formGrid} onSubmit={submitPlan}>
            {planError ? <p className={`${styles.error} ${styles.fieldFull}`}>{planError}</p> : null}
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>方案名稱</span>
              <input className={styles.input} required value={planDraft.name} onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>總堂數</span>
              <StableNumberInput className={styles.input} min="1" required value={planDraft.totalSessions} fallbackValue={1} onValueChange={(totalSessions) => setPlanDraft({ ...planDraft, totalSessions })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>總價</span>
              <StableNumberInput className={styles.input} min="1" required value={planDraft.totalAmount} fallbackValue={1} onValueChange={(totalAmount) => setPlanDraft({ ...planDraft, totalAmount })} />
            </label>
            {BIGE_CONTRACT_COURSE_TYPES.map((course) => (
              <label className={styles.field} key={course}>
                <span className={styles.label}>{BIGE_COURSE_LABELS[course]}堂數</span>
                <StableNumberInput className={styles.input} min="0" required value={planDraft[course]} onValueChange={(value) => setPlanDraft({ ...planDraft, [course]: value })} />
              </label>
            ))}
            <p className={`${styles.warning} ${styles.fieldFull}`}>
              效期 {calculateContractTerms(Number(planDraft.totalSessions)).validityDays} 天，最多延期{" "}
              {calculateContractTerms(Number(planDraft.totalSessions)).extensionLimitDays} 天。
            </p>
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button className={`${styles.button} ${styles.primary}`} type="submit" disabled={planSubmitting}>
                {planSubmitting ? "建立中…" : "建立方案"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "payment" && selectedContract ? (
        <Dialog title="登記合約付款" onClose={() => setDialog(null)}>
          <form className={styles.formGrid} onSubmit={submitPayment}>
            {paymentError ? (
              <p className={`${styles.error} ${styles.fieldFull}`} role="alert">
                {paymentError}
              </p>
            ) : null}
            <p className={`${styles.warning} ${styles.fieldFull}`}>
              本次最多可登記 {formatMoney(selectedContractOutstandingBalance)}。累積付款將依比例無條件捨去計算解鎖堂數。
            </p>
            <label className={styles.field}>
              <span className={styles.label}>付款類型</span>
              <select className={styles.select} value={paymentDraft.paymentKind} onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentKind: event.target.value })}>
                <option value="deposit">訂金</option>
                <option value="installment">分期</option>
                <option value="balance">尾款</option>
              </select>
            </label>
            <section className={`${styles.paymentSplitSection} ${styles.fieldFull}`}>
              <div className={styles.paymentSplitHeader}>
                <div>
                  <span className={styles.label}>付款明細</span>
                  <small>同一天可新增多筆不同付款方式。</small>
                </div>
                <strong>合計 {formatMoney(paymentEntryTotal(paymentDraft.entries))}</strong>
              </div>
              <div className={styles.paymentSplitList}>
                {paymentDraft.entries.map((entry, index) => (
                  <div className={styles.paymentSplitRow} key={entry.id}>
                    <label className={styles.field}>
                      <span className={styles.label}>第 {index + 1} 筆金額</span>
                      <input
                        className={styles.input}
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={selectedContractOutstandingBalance || undefined}
                        required
                        disabled={selectedContractOutstandingBalance <= 0}
                        value={entry.amount}
                        onChange={(event) => {
                          const amount = event.target.value;
                          setPaymentDraft((current) => ({
                            ...current,
                            entries: current.entries.map((item) =>
                              item.id === entry.id ? { ...item, amount } : item,
                            ),
                          }));
                        }}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>方式</span>
                      <select
                        className={styles.select}
                        value={entry.method}
                        onChange={(event) => {
                          const method = event.target.value;
                          let installmentCount: number | null = null;
                          if (method === "ecpay_installment") {
                            installmentCount = promptEcpayInstallmentCount(entry.installmentCount);
                            if (installmentCount === null) return;
                          }
                          setPaymentDraft((current) => ({
                            ...current,
                            entries: current.entries.map((item) =>
                              item.id === entry.id ? { ...item, method, installmentCount } : item,
                            ),
                          }));
                        }}
                      >
                        <option value="cash">現金</option>
                        <option value="bank_transfer">轉帳</option>
                        <option value="card_terminal">刷卡機</option>
                        <option value="ecpay">綠界</option>
                        <option value="ecpay_installment">綠界分期</option>
                        <option value="acpay">ACPay</option>
                        <option value="other">其他</option>
                      </select>
                      {entry.method === "ecpay_installment" && entry.installmentCount ? (
                        <small className={styles.fieldHelp}>已設定 {entry.installmentCount} 期</small>
                      ) : null}
                    </label>
                    {paymentDraft.entries.length > 1 ? (
                      <button
                        className={`${styles.button} ${styles.danger} ${styles.paymentSplitRemove}`}
                        type="button"
                        onClick={() =>
                          setPaymentDraft((current) => ({
                            ...current,
                            entries: current.entries.filter((item) => item.id !== entry.id),
                          }))
                        }
                      >
                        <Trash2 size={16} /> 刪除
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                className={styles.button}
                type="button"
                disabled={paymentDraft.entries.length >= 10}
                onClick={() =>
                  setPaymentDraft((current) => ({
                    ...current,
                    entries: [...current.entries, createPaymentEntryDraft()],
                  }))
                }
              >
                ＋ 新增一筆付款方式
              </button>
            </section>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>備註</span>
              <textarea className={styles.textarea} value={paymentDraft.note} onChange={(event) => setPaymentDraft({ ...paymentDraft, note: event.target.value })} />
            </label>
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button
                className={`${styles.button} ${styles.primary}`}
                type="submit"
                disabled={
                  selectedContractOutstandingBalance <= 0 ||
                  !isBigeContractPaymentAmountAllowed(
                    paymentEntryTotal(paymentDraft.entries),
                    selectedContractOutstandingBalance,
                  )
                }
              >
                儲存付款
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "edit-payment" && selectedPayment && selectedContract ? (
        <Dialog title="修改付款資料" onClose={() => setDialog("member")}>
          <form className={styles.formGrid} onSubmit={submitPaymentEdit}>
            {paymentEditError ? (
              <p className={`${styles.error} ${styles.fieldFull}`} role="alert">
                {paymentEditError}
              </p>
            ) : null}
            <p className={`${styles.warning} ${styles.fieldFull}`}>
              修改後會立即重算合約尾款、付款狀態與可用堂數，並保留完整稽核紀錄。
              本筆在「已登記」狀態下最高可設 {formatMoney(paymentEditMaximumAmount)}。
            </p>
            <label className={styles.field}>
              <span className={styles.label}>付款狀態</span>
              <select
                className={styles.select}
                value={paymentEditDraft.status}
                onChange={(event) => setPaymentEditDraft({ ...paymentEditDraft, status: event.target.value })}
              >
                <option value="recorded">已登記</option>
                <option value="voided">已作廢</option>
                <option value="refunded">已退款</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>付款類型</span>
              <select
                className={styles.select}
                value={paymentEditDraft.paymentKind}
                onChange={(event) => setPaymentEditDraft({ ...paymentEditDraft, paymentKind: event.target.value })}
              >
                <option value="deposit">訂金</option>
                <option value="installment">分期</option>
                <option value="balance">尾款</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>金額</span>
              <StableNumberInput
                className={styles.input}
                min="1"
                max={selectedContract.total_amount}
                required
                value={paymentEditDraft.amount}
                fallbackValue={1}
                onValueChange={(amount) => setPaymentEditDraft({ ...paymentEditDraft, amount })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>付款方式</span>
              <select
                className={styles.select}
                value={paymentEditDraft.method}
                onChange={(event) => {
                  const method = event.target.value;
                  if (method === "ecpay_installment") {
                    const installmentCount = promptEcpayInstallmentCount(
                      paymentEditDraft.installmentCount,
                    );
                    if (installmentCount === null) return;
                    setPaymentEditDraft({ ...paymentEditDraft, method, installmentCount });
                    return;
                  }
                  setPaymentEditDraft({ ...paymentEditDraft, method, installmentCount: null });
                }}
              >
                <option value="cash">現金</option>
                <option value="bank_transfer">轉帳</option>
                <option value="card_terminal">刷卡機</option>
                <option value="ecpay">綠界</option>
                <option value="ecpay_installment">綠界分期</option>
                <option value="acpay">ACPay</option>
                <option value="other">其他</option>
              </select>
              {paymentEditDraft.method === "ecpay_installment" && paymentEditDraft.installmentCount ? (
                <small className={styles.fieldHelp}>已設定 {paymentEditDraft.installmentCount} 期</small>
              ) : null}
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>備註</span>
              <textarea
                className={styles.textarea}
                value={paymentEditDraft.note}
                onChange={(event) => setPaymentEditDraft({ ...paymentEditDraft, note: event.target.value })}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>修改原因</span>
              <textarea
                className={styles.textarea}
                minLength={3}
                required
                value={paymentEditDraft.reason}
                onChange={(event) => setPaymentEditDraft({ ...paymentEditDraft, reason: event.target.value })}
              />
            </label>
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button className={styles.button} type="button" onClick={() => setDialog("member")}>
                返回
              </button>
              <button className={`${styles.button} ${styles.primary}`} type="submit" disabled={paymentEditSubmitting}>
                {paymentEditSubmitting ? "更新中…" : "儲存修改"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {dialog === "extension" && selectedContract ? (
        <Dialog title="合約延期與學員簽名" onClose={() => setDialog(null)}>
          <form className={styles.formGrid} onSubmit={submitExtension}>
            <p className={`${styles.warning} ${styles.fieldFull}`}>
              累積最多可延期 {selectedContract.extension_limit_days} 天，已使用 {selectedContract.extension_used_days} 天。
            </p>
            <label className={styles.field}>
              <span className={styles.label}>本次延期天數</span>
              <StableNumberInput className={styles.input} min="1" max={selectedContract.extension_limit_days - selectedContract.extension_used_days} required value={extensionDraft.days} fallbackValue={1} onValueChange={(days) => setExtensionDraft({ ...extensionDraft, days })} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>學員姓名</span>
              <input className={styles.input} required value={extensionDraft.signedName} onChange={(event) => setExtensionDraft({ ...extensionDraft, signedName: event.target.value })} />
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>主管原因</span>
              <textarea className={styles.textarea} required value={extensionDraft.reason} onChange={(event) => setExtensionDraft({ ...extensionDraft, reason: event.target.value })} />
            </label>
            <div className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>學員手寫簽名</span>
              <SignaturePad onChange={(signature) => setExtensionDraft({ ...extensionDraft, signature })} />
            </div>
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              <button className={`${styles.button} ${styles.primary}`} disabled={!extensionDraft.signature} type="submit">
                保存簽名並完成延期
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {scheduleDragNotice ? (
        <Dialog title="操作無法完成" onClose={() => setScheduleDragNotice("")}>
          <div className={styles.scheduleMoveSummary}>
            <p className={styles.warning} role="alert">
              {scheduleDragNotice}
            </p>
            <div className={styles.formActions}>
              <button
                className={`${styles.button} ${styles.primary}`}
                type="button"
                onClick={() => setScheduleDragNotice("")}
              >
                我知道了
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {pendingScheduleMove && !overwriteConfirmation ? (
        <Dialog
          title={pendingScheduleMove.targetItems.length ? "確認交換或覆蓋課程" : "確認移動課程"}
          onClose={closeScheduleMoveDialog}
        >
          <div className={styles.scheduleMoveSummary}>
            <div className={styles.scheduleMoveRoute}>
              <span>
                原位置
                <strong>
                  {data?.coaches.find((coach) => coach.id === pendingScheduleMove.source.coach_id)
                    ? coachLabel(
                        data.coaches.find(
                          (coach) => coach.id === pendingScheduleMove.source.coach_id,
                        )!,
                      )
                    : "教練"} {slotKey(pendingScheduleMove.source.starts_at)}
                </strong>
              </span>
              <span className={styles.scheduleMoveArrow}>→</span>
              <span>
                目標位置
                <strong>
                  {data?.coaches.find((coach) => coach.id === pendingScheduleMove.targetCoachId)
                    ? coachLabel(
                        data.coaches.find(
                          (coach) => coach.id === pendingScheduleMove.targetCoachId,
                        )!,
                      )
                    : "教練"} {slotKey(pendingScheduleMove.targetStartsAt)}
                </strong>
              </span>
            </div>

            <div className={styles.scheduleMoveGroup}>
              <span className={styles.label}>將移動的課程</span>
              {pendingScheduleMove.sourceItems.map((booking) => (
                <div className={styles.scheduleMoveItem} key={booking.id}>
                  <strong>{slotKey(booking.starts_at)}</strong>
                  <span>{scheduleBookingLabel(booking)}</span>
                </div>
              ))}
            </div>

            {pendingScheduleMove.targetItems.length ? (
              <div className={styles.scheduleMoveGroup}>
                <span className={styles.label}>目標時段目前的課程</span>
                {pendingScheduleMove.targetItems.map((booking) => (
                  <div className={styles.scheduleMoveItem} key={booking.id}>
                    <strong>{slotKey(booking.starts_at)}</strong>
                    <span>{scheduleBookingLabel(booking)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.muted}>目標時段目前是空白。確認後只會移動課程，不會取消任何資料。</p>
            )}
          </div>
          <div className={styles.formActions} style={{ marginTop: 16 }}>
            <button className={styles.button} type="button" onClick={closeScheduleMoveDialog} disabled={scheduleMoveSubmitting}>
              取消
            </button>
            {pendingScheduleMove.targetItems.length ? (
              <>
                <button
                  className={`${styles.button} ${styles.primary}`}
                  type="button"
                  disabled={scheduleMoveSubmitting}
                  onClick={() => void executeScheduleMove("swap")}
                >
                  {scheduleMoveSubmitting ? "處理中…" : "確認交換"}
                </button>
                <button
                  className={`${styles.button} ${styles.danger}`}
                  type="button"
                  disabled={scheduleMoveSubmitting}
                  onClick={() => setOverwriteConfirmation(true)}
                >
                  覆蓋目標課程
                </button>
              </>
            ) : (
              <button
                className={`${styles.button} ${styles.primary}`}
                type="button"
                disabled={scheduleMoveSubmitting}
                onClick={() => void executeScheduleMove("move")}
              >
                {scheduleMoveSubmitting ? "移動中…" : "確認移動"}
              </button>
            )}
          </div>
        </Dialog>
      ) : null}

      {pendingScheduleMove && overwriteConfirmation ? (
        <Dialog title="再次確認覆蓋" onClose={closeScheduleMoveDialog}>
          <p className={styles.error}>
            覆蓋後，目標時段的 {pendingScheduleMove.targetItems.length} 筆課程會改為取消；原始資料、操作者與操作時間仍會保留。
          </p>
          <div className={styles.scheduleMoveGroup}>
            {pendingScheduleMove.targetItems.map((booking) => (
              <div className={styles.scheduleMoveItem} key={booking.id}>
                <strong>{slotKey(booking.starts_at)}</strong>
                <span>{scheduleBookingLabel(booking)}</span>
              </div>
            ))}
          </div>
          <div className={styles.formActions} style={{ marginTop: 16 }}>
            <button
              className={styles.button}
              type="button"
              disabled={scheduleMoveSubmitting}
              onClick={() => setOverwriteConfirmation(false)}
            >
              返回
            </button>
            <button
              className={`${styles.button} ${styles.danger}`}
              type="button"
              disabled={scheduleMoveSubmitting}
              onClick={() => void executeScheduleMove("overwrite")}
            >
              {scheduleMoveSubmitting ? "覆蓋中…" : "確認取消並覆蓋"}
            </button>
          </div>
        </Dialog>
      ) : null}

      {dialog === "contract" && contractSubmitting ? (
        <div className={styles.overlay} role="presentation">
          <section
            className={`${styles.dialog} ${styles.processingDialog}`}
            role="status"
            aria-live="polite"
          >
            <RefreshCw className={styles.processingIcon} size={30} />
            <h2 className={styles.dialogTitle}>正在驗證並建立會員</h2>
            <p className={styles.muted}>
              資料只會送出一次，完成後會自動關閉視窗並更新會員與合約資料。
            </p>
          </section>
        </div>
      ) : null}

      {dialog === "plan" && planSubmitting ? (
        <div className={styles.overlay} role="presentation">
          <section className={`${styles.dialog} ${styles.processingDialog}`} role="status" aria-live="polite">
            <RefreshCw className={styles.processingIcon} size={30} />
            <h2 className={styles.dialogTitle}>正在驗證並建立方案</h2>
            <p className={styles.muted}>請稍候，完成後會自動關閉視窗並更新方案清單。</p>
          </section>
        </div>
      ) : null}

      {staffManagerOpen ? (
        <Dialog title="員工帳號管理" onClose={() => setStaffManagerOpen(false)} wide>
          <iframe className={styles.staffManagerFrame} src="/manager/staff" title="員工帳號管理" />
        </Dialog>
      ) : null}

      {faFeeRecipientPrompt ? (
        <Dialog
          title={`$${faFeeRecipientPrompt.amount.toLocaleString("en-US")} 收款人`}
          compact
          onClose={() => {
            if (contractSubmitting || trialOutcomeSubmitting) return;
            setFaFeeRecipientPrompt(null);
            setFaFeeRecipientOptionsError("");
          }}
        >
          <form className={styles.formGrid} onSubmit={submitFaFeeRecipient}>
            <p className={`${styles.muted} ${styles.fieldFull}`}>
              請從下拉選單點選員工，或直接輸入其他收款人姓名。
            </p>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>收款人</span>
              <input
                className={styles.input}
                autoFocus
                required
                maxLength={80}
                list="fa-fee-recipient-options"
                placeholder="選擇員工或自行輸入"
                value={faFeeRecipientName}
                onChange={(event) => {
                  setFaFeeRecipientName(event.target.value);
                  setFaFeeRecipientOptionsError("");
                }}
              />
              <datalist id="fa-fee-recipient-options">
                {faFeeRecipientOptions.map((option) => (
                  <option key={option.id} value={option.label} />
                ))}
              </datalist>
              {faFeeRecipientOptionsLoading ? (
                <small className={styles.fieldHelp}>員工名單載入中…</small>
              ) : faFeeRecipientOptionsLoaded ? (
                <small className={styles.fieldHelp}>
                  已載入 {faFeeRecipientOptions.length} 位員工；仍可自行輸入文字。
                </small>
              ) : null}
            </label>
            {faFeeRecipientOptionsError ? (
              <p className={`${styles.error} ${styles.fieldFull}`} role="alert">
                {faFeeRecipientOptionsError}
              </p>
            ) : null}
            <div className={`${styles.formActions} ${styles.fieldFull}`}>
              {!faFeeRecipientOptionsLoaded && faFeeRecipientOptionsError ? (
                <button
                  className={styles.button}
                  type="button"
                  disabled={faFeeRecipientOptionsLoading}
                  onClick={() => void loadFaFeeRecipientOptions()}
                >
                  重新載入員工
                </button>
              ) : null}
              <button
                className={styles.button}
                type="button"
                disabled={contractSubmitting || trialOutcomeSubmitting !== null}
                onClick={() => {
                  setFaFeeRecipientPrompt(null);
                  setFaFeeRecipientOptionsError("");
                }}
              >
                取消
              </button>
              <button
                className={`${styles.button} ${styles.primary}`}
                type="submit"
                disabled={contractSubmitting || trialOutcomeSubmitting !== null}
              >
                <Check size={17} />
                {faFeeRecipientPrompt.action === "confirm_payment"
                  ? "確認並付款"
                  : "確認未成交"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {operationAlert ? (
        <Dialog
          title={operationAlert.title}
          compact
          onClose={() => {
            if (!bookingActionSubmitting) setOperationAlert(null);
          }}
        >
          <div className={styles.bookingStatusPanel}>
            <div
              className={`${styles.bookingStatusWindowNote} ${styles.operationAlert}`}
              role="alert"
              aria-live="assertive"
            >
              <TriangleAlert size={20} aria-hidden="true" />
              <span>{operationAlert.message}</span>
            </div>
            <div className={styles.bookingStatusActions}>
              <button
                type="button"
                className={`${styles.button} ${styles.primary}`}
                autoFocus
                onClick={() => setOperationAlert(null)}
              >
                確認
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}

function DraggableCoachHeader(props: {
  coach: Coach;
  label: string;
  title: string | null;
  status: CoachDayStatus | null;
  enabled: boolean;
  mobileActive: boolean;
}) {
  const {
    isOver: isCoachDropOver,
    setNodeRef: setCoachDropNodeRef,
  } = useDroppable({
    id: `coach-order-target:${props.coach.id}`,
    data: {
      kind: "coach-target",
      coachId: props.coach.id,
    } satisfies CoachDropPayload,
    disabled: !props.enabled,
  });
  const {
    attributes: coachDragAttributes,
    isDragging: isCoachDragging,
    listeners: coachDragListeners,
    setNodeRef: setCoachDragNodeRef,
  } = useDraggable({
    id: `coach-order:${props.coach.id}`,
    data: {
      kind: "coach",
      item: props.coach,
      movable: true,
    } satisfies CoachDragPayload,
    disabled: !props.enabled,
  });

  return (
    <div
      ref={setCoachDropNodeRef}
      className={styles.coachHead}
      data-mobile-active={String(props.mobileActive)}
      data-coach-status={props.status?.status}
      data-coach-drag-over={String(isCoachDropOver && !isCoachDragging)}
      data-coach-dragging={String(isCoachDragging)}
    >
      <div className={styles.coachHeadContent}>
        {props.enabled ? (
          <button
            ref={setCoachDragNodeRef}
            className={styles.coachDragHandle}
            type="button"
            aria-label={`拖曳調整 ${props.label} 的欄位順序`}
            {...coachDragListeners}
            {...coachDragAttributes}
          >
            <GripVertical size={16} aria-hidden="true" />
            <span className={styles.coachIdentityLabel}>
              <span className={styles.coachName}>{props.label}</span>
              {props.title ? (
                <span className={styles.coachTitleBadge}>{props.title}</span>
              ) : null}
            </span>
          </button>
        ) : (
          <span className={styles.coachStaticLabel}>
            <span className={styles.coachName}>{props.label}</span>
            {props.title ? (
              <span className={styles.coachTitleBadge}>{props.title}</span>
            ) : null}
          </span>
        )}
        {props.status ? (
          <span className={styles.coachStatusBadge} data-status={props.status.status}>
            {props.status.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ScheduleDropZone(props: {
  date: string;
  hour: number;
  minute: 0 | 30;
  coachId: string;
  activeDragMinute: 0 | 30 | null;
}) {
  const startsAt = scheduleSlotIso(props.date, props.hour, props.minute);
  const isValidAlignment = props.activeDragMinute === props.minute;
  const { isOver, setNodeRef } = useDroppable({
    id: `schedule-slot:${props.coachId}:${startsAt}`,
    data: {
      kind: "slot",
      coachId: props.coachId,
      startsAt,
      minute: props.minute,
    } satisfies ScheduleDropPayload,
    disabled: !isValidAlignment,
  });
  return (
    <span
      ref={setNodeRef}
      className={`${styles.scheduleDropZone} ${
        props.minute === 0 ? styles.scheduleDropZoneHour : styles.scheduleDropZoneHalf
      }`}
      data-drag-over={String(isOver)}
      data-valid-alignment={String(isValidAlignment)}
      aria-hidden="true"
    />
  );
}

function ScheduleDeleteDropZone(props: { active: boolean; submitting: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: "schedule-delete-target",
    data: { kind: "schedule-delete" } satisfies ScheduleDeleteDropPayload,
    disabled: !props.active || props.submitting,
  });

  return (
    <div
      ref={setNodeRef}
      className={styles.scheduleDeleteDropZone}
      data-active={String(props.active)}
      data-drag-over={String(isOver)}
      role="status"
      aria-live="polite"
      aria-hidden={!props.active}
      aria-label="拖到這裡刪除預約；會員資料會保留"
    >
      <span className={styles.scheduleDeleteDropIcon} aria-hidden="true">
        <Trash2 size={24} strokeWidth={2.2} />
      </span>
      <span className={styles.scheduleDeleteDropCopy}>
        <strong>{isOver ? "放開以刪除預約" : "拖到這裡刪除預約"}</strong>
        <small>只刪除此預約，會員資料會保留</small>
      </span>
    </div>
  );
}

function DraggableScheduleEntry(props: {
  id: string;
  data: ScheduleDragPayload;
  enabled: boolean;
  className: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: `schedule-entry:${props.data.kind}:${props.id}`,
    data: props.data,
    disabled: !props.enabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`${props.className} ${props.enabled ? styles.scheduleDraggable : ""} ${
        isDragging ? styles.scheduleDraggingSource : ""
      }`}
      style={props.style}
      {...listeners}
      {...attributes}
    >
      {props.children}
    </div>
  );
}

function HourRow(props: {
  date: string;
  hour: number;
  coaches: Coach[];
  selectedCoach: string;
  bookings: Booking[];
  notes: BoardData["notes"];
  coachDayStatuses: CoachDayStatus[];
  faAssistantToConflicts: FaAssistantToConflict[];
  classroomConflicts: BigeClassroomConflict[];
  members: Map<string, Member>;
  trialBookings: Map<string, TrialBookingSummary>;
  showTrialRevenue: boolean;
  canCreate: boolean;
  canDrag: boolean;
  activeDragMinute: 0 | 30 | null;
  scheduleNoteUndo: ScheduleNoteUndo | null;
  restoringScheduleNote: boolean;
  onRestoreScheduleNote: () => void;
  onBookingPrefetch: (memberId: string) => void;
  onCell: (
    coachId: string,
    hour: number,
    booking: Booking | null,
    note: ScheduleNote | null,
  ) => void;
}) {
  return (
    <>
      {props.coaches.map((coach) => {
        const coachDayStatus =
          props.coachDayStatuses.find((status) => status.coach_id === coach.id) || null;
        const assistantToConflict = props.faAssistantToConflicts.find(
          (conflict) =>
            conflict.coach_id === coach.id &&
            Math.floor(localMinutes(conflict.starts_at) / 60) === props.hour,
        );
        const classroomConflict = props.classroomConflicts.find(
          (conflict) =>
            conflict.coach_id === coach.id &&
            Math.floor(localMinutes(conflict.starts_at) / 60) === props.hour,
        );
        const booking =
          props.bookings.find(
            (item) =>
              item.coach_id === coach.id &&
              overlapsHour(item.starts_at, bookingDurationMinutes(item), props.hour),
          ) || null;
        const note =
          props.notes.find(
            (item) =>
              item.coach_id === coach.id &&
              overlapsHour(
                item.starts_at,
                durationMinutes(item.starts_at, item.ends_at),
                props.hour,
              ),
          ) || null;
        const entry = booking || note;
        const undoHere =
          !entry &&
          props.scheduleNoteUndo?.coachId === coach.id &&
          taipeiDateKey(props.scheduleNoteUndo.startsAt) === props.date &&
          Math.floor(localMinutes(props.scheduleNoteUndo.startsAt) / 60) === props.hour
            ? props.scheduleNoteUndo
            : null;
        const entryStartsAt = entry?.starts_at || "";
        const startsOnHour = entryStartsAt ? slotKey(entryStartsAt).endsWith(":00") : false;
        const entryStartsHere = entryStartsAt
          ? Math.floor(localMinutes(entryStartsAt) / 60) === props.hour
          : false;
        const entryDuration = booking
          ? bookingDurationMinutes(booking)
          : note
            ? durationMinutes(note.starts_at, note.ends_at)
            : 0;
        const entryHourLabels = entryStartsAt
          ? Array.from(
              { length: Math.max(1, Math.ceil(entryDuration / 60)) },
              (_, index) => minuteOfDayLabel(localMinutes(entryStartsAt) + index * 60),
            )
          : [];
        const entryHeight = `max(19px, calc(var(--schedule-row-height, 46px) * ${entryDuration / 60} - 6px))`;
        const member = booking ? props.members.get(booking.member_id) : null;
        const memberNumber = member ? getBigeMemberDisplayNumber(member) : null;
        const trialBooking =
          booking?.trial_booking_id ? props.trialBookings.get(booking.trial_booking_id) : null;
        const trialName = trialBooking?.name || member?.full_name || "體驗學員";
        const trialBirthday = formatBirthDate(trialBooking?.birthday || member?.birth_date);
        const trialPhone = trialBooking?.phone || member?.phone || "未提供電話";
        const trialService = booking
          ? trialBooking
            ? TRIAL_SERVICE_LABELS[trialBooking.service] || trialBooking.service
            : BIGE_COURSE_LABELS[booking.course_type]
          : "";
        const trialOutcomeVisualState = booking
          ? getBigeTrialOutcomeVisualState({
              convertedAt: booking.converted_at,
              outcome: booking.trial_conversion_outcome,
            })
          : null;
        const mobileActive = String(
          props.selectedCoach === "all" || coach.id === props.selectedCoach,
        );
        const isOptimisticBooking = Boolean(booking?.optimistic);
        const canInteract = booking ? !isOptimisticBooking : props.canCreate;
        const activate = () => {
          if (canInteract) props.onCell(coach.id, props.hour, booking, note);
        };

        return (
          <Fragment key={`${props.hour}:${coach.id}`}>
            <div
              className={styles.timeCell}
              data-mobile-active={mobileActive}
              data-coach-status={coachDayStatus?.status}
            >
              {String(props.hour).padStart(2, "0")}:00
            </div>
            <div
              className={styles.slotCell}
              data-mobile-active={mobileActive}
              data-coach-status={coachDayStatus?.status}
              data-interactive={String(canInteract)}
              data-has-entry={String(Boolean(entry))}
              data-entry-start={String(entryStartsHere)}
              role={canInteract ? "button" : undefined}
              tabIndex={canInteract ? 0 : undefined}
              aria-label={
                canInteract
                  ? entry
                    ? `編輯 ${String(props.hour).padStart(2, "0")} 點原排課資料`
                    : `新增 ${String(props.hour).padStart(2, "0")} 點排課`
                  : undefined
              }
              onClick={activate}
              onPointerEnter={
                booking && !isOptimisticBooking
                  ? () => props.onBookingPrefetch(booking.member_id)
                  : undefined
              }
              onFocus={
                booking && !isOptimisticBooking
                  ? () => props.onBookingPrefetch(booking.member_id)
                  : undefined
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate();
                }
              }}
            >
              <ScheduleDropZone
                date={props.date}
                hour={props.hour}
                minute={0}
                coachId={coach.id}
                activeDragMinute={props.activeDragMinute}
              />
              {undoHere ? (
                <button
                  type="button"
                  className={styles.scheduleNoteUndoButton}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onRestoreScheduleNote();
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  disabled={props.restoringScheduleNote}
                  aria-label={`復原自由文字 ${undoHere.content}`}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  {props.restoringScheduleNote ? "復原中…" : "復原"}
                </button>
              ) : null}
              {assistantToConflict || classroomConflict ? (
                <div className={styles.conflictBadgeStack}>
                  {assistantToConflict ? (
                    <span
                      className={styles.toConflictBadge}
                      title={`${assistantToConflict.message}（${assistantToConflict.source_booking_ids.length} 筆 FA）`}
                    >
                      TO 衝突
                    </span>
                  ) : null}
                  {classroomConflict ? (
                    <span
                      className={styles.classroomConflictBadge}
                      title={classroomConflict.message}
                    >
                      教室衝突
                    </span>
                  ) : null}
                </div>
              ) : null}
              <ScheduleDropZone
                date={props.date}
                hour={props.hour}
                minute={30}
                coachId={coach.id}
                activeDragMinute={props.activeDragMinute}
              />
              {booking && entryStartsHere ? (
                <DraggableScheduleEntry
                  id={booking.id}
                  enabled={props.canDrag && !isOptimisticBooking}
                  data={{
                    kind: "booking",
                    item: booking,
                    movable: !isOptimisticBooking && isScheduleBookingDraggable(booking),
                  }}
                  className={[
                    styles.booking,
                    startsOnHour ? styles.cellEntryFull : styles.cellEntryHalf,
                    booking.operation_kind === "trial" ? styles.bookingTrial : styles.bookingPt,
                    booking.operation_kind === "trial" &&
                    isBigeTrialReminderConfirmed(booking.reminder_status)
                      ? styles.bookingTrialReminded
                      : "",
                    booking.status === "completed" || booking.status === "cancelled" ? styles.bookingDone : "",
                    booking.status === "completed" ? styles.bookingCompleted : "",
                    booking.status === "no_show" ? styles.bookingNoShow : "",
                    booking.status === "cancelled" ? styles.bookingCancelled : "",
                    booking.operation_kind === "trial" && trialOutcomeVisualState === "converted"
                      ? styles.bookingTrialConverted
                      : "",
                    booking.operation_kind === "trial" && trialOutcomeVisualState === "not_converted"
                      ? styles.bookingTrialNotConverted
                      : "",
                    booking.operation_kind === "trial" && trialOutcomeVisualState === "pending_conversion"
                      ? styles.bookingTrialPendingConversion
                      : "",
                  ].join(" ")}
                  style={{ height: entryHeight }}
                >
                  <div className={styles.entryTimeSummary} aria-hidden="true">
                    {entryHourLabels.map((label) => (
                      <span className={styles.entryTimeTick} key={label}>
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className={styles.entryBody}>
                    {props.showTrialRevenue &&
                    typeof booking.booking_payment_amount === "number" ? (
                      <span className={styles.bookingRevenueBadge}>
                        {formatFaRevenueAmount(booking.booking_payment_amount)}
                      </span>
                    ) : null}
                    {booking.operation_kind === "trial" &&
                    trialOutcomeVisualState === "pending_conversion" ? (
                      <span className={styles.bookingPendingConversionBadge}>
                        成交建檔未完成
                      </span>
                    ) : null}
                    {booking.status === "cancelled" ? (
                      <span className={styles.bookingCancelledBadge}>已取消</span>
                    ) : null}
                    {booking.operation_kind === "trial" ? (
                      <>
                        {isBigeTrialReminderConfirmed(booking.reminder_status) ? (
                          <span className={styles.bookingReminderBadge}>
                            <BellRing size={11} /> 已提醒
                          </span>
                        ) : null}
                        {!isBigeTrialReminderConfirmed(booking.reminder_status) ? (
                          <span className={styles.bookingEyebrow}>FA · 2 小時</span>
                        ) : null}
                        <span className={styles.bookingTrialNameLine}>
                          <span className={styles.bookingName}>{trialName}</span>
                          {trialBirthday ? (
                            <span className={styles.bookingBirthday}>{trialBirthday}</span>
                          ) : null}
                        </span>
                        <span className={styles.bookingPhone}>{trialPhone}</span>
                        <span className={styles.bookingCourse}>體驗：{trialService}</span>
                        {memberNumber ? (
                          <span
                            className={styles.bookingStudentCode}
                            title={`會員編號：${memberNumber}`}
                          >
                            {memberNumber}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className={styles.bookingPrimaryLine}>
                          <span className={styles.bookingName}>{member?.full_name || "學員"}</span>
                          <span
                            className={styles.bookingCourseType}
                            title={scheduleCourseLabel(booking.course_type)}
                          >
                            {scheduleCourseLabel(booking.course_type)}
                          </span>
                          <span
                            className={styles.bookingStudentCode}
                            title={`會員編號：${memberNumber || "未編號"}`}
                          >
                            {memberNumber || "未編號"}
                          </span>
                        </span>
                        <span className={styles.bookingMeta}>
                          {slotKey(booking.starts_at)} · {scheduleCourseLabel(booking.course_type)}
                        </span>
                      </>
                    )}
                  </div>
                </DraggableScheduleEntry>
              ) : note && entryStartsHere ? (
                <DraggableScheduleEntry
                  id={note.id}
                  enabled={props.canDrag}
                  data={{ kind: "note", item: note, movable: false }}
                  className={[
                    styles.note,
                    startsOnHour ? styles.cellEntryFull : styles.cellEntryHalf,
                  ].join(" ")}
                  style={{ height: entryHeight }}
                >
                  <div className={styles.entryTimeSummary} aria-hidden="true">
                    {entryHourLabels.map((label) => (
                      <span className={styles.entryTimeTick} key={label}>
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className={styles.entryBody}>{note.content}</div>
                </DraggableScheduleEntry>
              ) : null}
            </div>
          </Fragment>
        );
      })}
    </>
  );
}
