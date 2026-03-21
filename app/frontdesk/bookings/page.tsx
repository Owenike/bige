"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "../../i18n-provider";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

interface BookingItem {
  id: string;
  member_id: string;
  coach_id: string | null;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string | null;
}

interface BookingApiItem {
  id: string;
  customerName?: string | null;
  customerPhone?: string | null;
  branchId?: string | null;
  therapistId?: string | null;
  serviceName?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  status?: string | null;
  noteExcerpt?: string | null;
}

interface ServiceItem {
  code: string;
  name: string;
  durationMinutes: number;
  capacity: number;
}

interface CoachItem {
  id: string;
  displayName: string | null;
  branchId: string | null;
}

interface MemberItem {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: string | null;
  custom_fields?: Record<string, string>;
}

interface PassItem {
  id: string;
  pass_type: string;
  remaining: number;
  expires_at: string | null;
  status: string;
}

interface AuditItem {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  actor_id: string;
}

interface SessionRedemptionItem {
  id: string;
  booking_id: string | null;
  member_id: string;
  pass_id: string | null;
  session_no: number | null;
  redeemed_kind: string;
  quantity: number;
  note: string | null;
  created_at: string;
}

interface CoachBlockItem {
  id: string;
  coach_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  note: string | null;
  status: string;
}

interface MemberSessionPreview {
  passId: string;
  passType: string;
  passTotal: number | null;
  passRemaining: number;
  sessionNumber: number;
  serviceName: string;
}

interface MemberResultSummary {
  loading: boolean;
  remainingSessions: number;
  activeContractCount: number;
  previewSessions: MemberSessionPreview[];
}

interface DraftConflictPreview {
  blocking: boolean;
  messages: string[];
}

type DraftMode = "sessionDrop" | "quickCreate" | "reschedule";

interface BookingDraft {
  mode: DraftMode;
  sourceBookingId: string | null;
  memberId: string;
  memberName: string;
  memberPhone: string;
  passId: string | null;
  passType: string;
  passTotal: number | null;
  passRemaining: number;
  sessionNumber: number | null;
  serviceName: string;
  coachId: string;
  startsLocal: string;
  durationMinutes: number;
  note: string;
  room: string;
  reason: string;
  notifyMember: boolean;
}

type DragPayload =
  | {
      kind: "pass_session";
      memberId: string;
      memberName: string;
      memberPhone: string;
      passId: string;
      passType: string;
      passTotal: number | null;
      passRemaining: number;
      sessionNumber: number;
      serviceName: string;
    }
  | {
      kind: "booking_event";
      bookingId: string;
      memberId: string;
      serviceName: string;
      coachId: string | null;
      durationMinutes: number;
      note: string;
    };
type SlotDropData = { coachId: string; timeLabel: string };

const DAY_START_MINUTE = 6 * 60;
const DAY_END_MINUTE = 23 * 60;
const SLOT_MINUTE = 30;
const SLOT_HEIGHT = 34;
const ACTIVE_BOOKING_STATUSES = ["booked", "checked_in"] as const;

function fmtDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function normalizeBookingApiItem(item: BookingApiItem | BookingItem): BookingItem {
  if ("member_id" in item && "coach_id" in item && "service_name" in item && "starts_at" in item && "ends_at" in item) {
    return item;
  }
  return {
    id: item.id,
    member_id: "",
    coach_id: item.therapistId || null,
    service_name: item.serviceName || "",
    starts_at: item.startsAt || "",
    ends_at: item.endsAt || "",
    status: item.status || "booked",
    note: item.noteExcerpt || null,
  };
}

function toDateKey(date: Date) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function localDatetimeToIso(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function isoToLocalInputValue(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function minuteFromIso(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getHours() * 60 + d.getMinutes();
}

function toTimeLabel(minute: number) {
  const hh = Math.floor(minute / 60);
  const mm = minute % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function overlap(startA: string, endA: string, startB: string, endB: string) {
  const a1 = new Date(startA).getTime();
  const a2 = new Date(endA).getTime();
  const b1 = new Date(startB).getTime();
  const b2 = new Date(endB).getTime();
  if ([a1, a2, b1, b2].some((value) => Number.isNaN(value))) return false;
  return a1 < b2 && a2 > b1;
}

function parsePassTotal(passType: string) {
  const found = passType.match(/(\d+)/);
  if (!found) return null;
  const value = Number(found[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseRoomFromNote(note: string | null) {
  if (!note) return "";
  const match = note.match(/\[room:([^\]]+)\]/i);
  return match?.[1]?.trim() || "";
}

function stripRoomFromNote(note: string | null) {
  if (!note) return "";
  return note.replace(/\[room:[^\]]+\]/ig, "").trim();
}

function composeNote(note: string, room: string) {
  const base = note.trim();
  const roomText = room.trim();
  if (!roomText) return base || null;
  return `${`[room:${roomText}]`}${base ? ` ${base}` : ""}`;
}

function isActiveForConflict(status: string) {
  return status === "booked" || status === "checked_in";
}

function isBlockedBooking(item: BookingItem) {
  return item.status === "blocked" || item.service_name.toLowerCase().includes("block");
}

function derivedStatus(item: BookingItem) {
  if (item.status === "cancelled" && (item.note || "").includes("[rescheduled]")) return "rescheduled";
  return item.status;
}

function statusLabel(status: string, zh: boolean) {
  if (status === "booked") return zh ? "已排" : "Booked";
  if (status === "checked_in") return zh ? "已報到" : "Checked In";
  if (status === "completed") return zh ? "已完成" : "Completed";
  if (status === "cancelled") return zh ? "已取消" : "Cancelled";
  if (status === "no_show") return zh ? "未到" : "No Show";
  if (status === "rescheduled") return zh ? "改期" : "Rescheduled";
  if (status === "blocked") return zh ? "封鎖" : "Blocked";
  return status;
}

function statusClassName(status: string) {
  if (status === "booked") return "is-booked";
  if (status === "checked_in") return "is-checkin";
  if (status === "completed") return "is-completed";
  if (status === "no_show") return "is-noshow";
  if (status === "cancelled") return "is-cancelled";
  if (status === "rescheduled") return "is-rescheduled";
  if (status === "blocked") return "is-blocked";
  return "is-default";
}

function startOfDayIso(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).toISOString();
}

function endOfDayIso(dateKey: string) {
  return new Date(`${dateKey}T23:59:59`).toISOString();
}

function shiftDate(dateKey: string, deltaDay: number) {
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return toDateKey(new Date());
  d.setDate(d.getDate() + deltaDay);
  return toDateKey(d);
}

function localDateTimeFrom(dateKey: string, timeLabel: string) {
  return `${dateKey}T${timeLabel}`;
}

function addMinutesToLocalDate(localValue: string, plusMinute: number) {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() + plusMinute);
  return isoToLocalInputValue(d.toISOString());
}

function sanitizePhoneQuery(input: string) {
  return input.replace(/\D/g, "");
}

function parseSessionNoFromNote(note: string | null) {
  if (!note) return null;
  const match = note.match(/session_no:(\d+)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function buildMemberResultSummary(
  passes: PassItem[],
  redemptions: SessionRedemptionItem[],
  fallbackServiceName: string,
): MemberResultSummary {
  const previewSessions: MemberSessionPreview[] = [];
  let remainingSessions = 0;

  for (const pass of passes) {
    const remaining = Math.max(0, Number(pass.remaining || 0));
    remainingSessions += remaining;
    if (remaining <= 0) continue;

    const total = parsePassTotal(pass.pass_type);
    const usedRows = redemptions
      .filter((item) => item.pass_id === pass.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const usedSessionNumbers = new Set<number>();
    usedRows.forEach((item, index) => {
      const no = item.session_no || parseSessionNoFromNote(item.note) || index + 1;
      if (no > 0) usedSessionNumbers.add(no);
    });

    const fallbackTotal = total ?? Math.max(remaining + usedSessionNumbers.size, remaining);
    for (let no = 1; no <= fallbackTotal; no += 1) {
      if (usedSessionNumbers.has(no)) continue;
      previewSessions.push({
        passId: pass.id,
        passType: pass.pass_type,
        passTotal: total,
        passRemaining: remaining,
        sessionNumber: no,
        serviceName: fallbackServiceName,
      });
      if (previewSessions.length >= 3) break;
    }
    if (previewSessions.length >= 3) break;
  }

  return {
    loading: false,
    remainingSessions,
    activeContractCount: passes.filter((pass) => Math.max(0, Number(pass.remaining || 0)) > 0).length,
    previewSessions,
  };
}

function buildDraftConflictPreview(params: {
  zh: boolean;
  coachConflict: BookingItem | undefined;
  memberConflict: BookingItem | undefined;
  roomConflict: BookingItem | null | undefined;
  coachBlocked: CoachBlockItem | undefined;
}): DraftConflictPreview {
  const messages: string[] = [];
  if (params.coachConflict) messages.push(params.zh ? "提示：同教練同時段已有既有預約。" : "Heads-up: this coach already has an overlapping booking.");
  if (params.coachBlocked) messages.push(params.zh ? "提示：該教練時段目前已封鎖。" : "Heads-up: this coach is blocked for the selected slot.");
  if (params.memberConflict) messages.push(params.zh ? "提示：這位會員在相近時段已有預約。" : "Heads-up: this member already has an overlapping booking.");
  if (params.roomConflict) messages.push(params.zh ? "提示：目前輸入的場地已被使用。" : "Heads-up: the selected room is already occupied.");

  return {
    blocking: messages.length > 0,
    messages,
  };
}

function DraggableSessionPill(props: {
  id: string;
  payload: DragPayload;
  disabled: boolean;
  used: boolean;
  label: string;
  helper: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.id,
    data: { payload: props.payload },
    disabled: props.disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`fdBkSessionPill ${props.used ? "is-used" : ""} ${isDragging ? "is-dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.55 : 1 }}
      {...attributes}
      {...listeners}
    >
      <span>{props.label}</span>
      <small>{props.helper}</small>
    </div>
  );
}

function DraggableBookingEvent(props: {
  id: string;
  payload: DragPayload;
  disabled: boolean;
  className: string;
  highlighted?: boolean;
  bookingId?: string;
  style: Record<string, string>;
  onClick: () => void;
  title: string;
  subtitle: string;
  statusText: string;
  tooltip: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.id,
    data: { payload: props.payload },
    disabled: props.disabled,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`${props.className} has-tooltip ${props.highlighted ? "is-recent-created" : ""} ${isDragging ? "is-dragging" : ""}`}
      data-booking-id={props.bookingId || ""}
      data-tooltip={props.tooltip}
      style={{
        ...props.style,
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.55 : 1,
      }}
      onClick={props.onClick}
      {...attributes}
      {...listeners}
    >
      <strong>{props.title}</strong>
      <span>{props.subtitle}</span>
      <span>{props.statusText}</span>
    </button>
  );
}

function DroppableSlotCell(props: {
  id: string;
  coachId: string;
  timeLabel: string;
  onClick: () => void;
  title: string;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: props.id,
    data: { coachId: props.coachId, timeLabel: props.timeLabel },
  });
  return (
    <div
      ref={setNodeRef}
      className={`fdBkSlotCell ${isOver ? "is-active-drop" : ""}`}
      data-coach-id={props.coachId}
      data-time-label={props.timeLabel}
      onClick={props.onClick}
      title={props.title}
    />
  );
}

function SidebarAccordion(props: {
  title: string;
  defaultOpen?: boolean;
  children: import("react").ReactNode;
  badge?: string;
  id?: string;
}) {
  return (
    <details className="fdBkAccordion" open={props.defaultOpen ?? true} id={props.id}>
      <summary className="fdBkAccordionSummary">
        <span>{props.title}</span>
        {props.badge ? <span className="fdBkAccordionBadge">{props.badge}</span> : null}
      </summary>
      <div className="fdBkAccordionBody">{props.children}</div>
    </details>
  );
}

export default function FrontdeskBookingsPage() {
  const searchParams = useSearchParams();
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [items, setItems] = useState<BookingItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [coaches, setCoaches] = useState<CoachItem[]>([]);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [coachBlocks, setCoachBlocks] = useState<CoachBlockItem[]>([]);
  const [memberRedemptions, setMemberRedemptions] = useState<SessionRedemptionItem[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchingMember, setSearchingMember] = useState(false);
  const [loadingPasses, setLoadingPasses] = useState(false);

  const [dateKey, setDateKey] = useState(toDateKey(new Date()));
  const [coachKeyword, setCoachKeyword] = useState("");
  const [coachVisible, setCoachVisible] = useState<Record<string, boolean>>({});

  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<MemberItem[]>([]);
  const [memberResultSummaries, setMemberResultSummaries] = useState<Record<string, MemberResultSummary>>({});
  const [memberMap, setMemberMap] = useState<Record<string, MemberItem>>({});
  const [selectedMember, setSelectedMember] = useState<MemberItem | null>(null);
  const [memberPasses, setMemberPasses] = useState<PassItem[]>([]);
  const [expandedPasses, setExpandedPasses] = useState<Record<string, boolean>>({});
  const [pendingPassDeduct, setPendingPassDeduct] = useState<Record<string, number>>({});
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  const [activeDragPayload, setActiveDragPayload] = useState<DragPayload | null>(null);
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [highlightedBookingId, setHighlightedBookingId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const calendarHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const calendarGridScrollRef = useRef<HTMLDivElement | null>(null);
  const calendarTimeScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollSyncLockRef = useRef(false);
  const highlightTimeoutRef = useRef<number | null>(null);
  const focusedBookingIdRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const prefillMemberId = (searchParams.get("memberId") || "").trim();

  const timeSlots = useMemo(() => {
    const values: string[] = [];
    for (let minute = DAY_START_MINUTE; minute < DAY_END_MINUTE; minute += SLOT_MINUTE) {
      values.push(toTimeLabel(minute));
    }
    return values;
  }, []);

  const serviceOptions = useMemo(
    () =>
      services.map((service) => ({
        value: service.name,
        label: zh ? `${service.name}（${service.durationMinutes} 分鐘）` : `${service.name} (${service.durationMinutes}m)`,
        durationMinutes: service.durationMinutes,
      })),
    [services, zh],
  );

  const coachOptions = useMemo(
    () =>
      coaches
        .filter(
          (coach) =>
            coach.displayName?.toLowerCase().includes(coachKeyword.toLowerCase()) || coach.id.toLowerCase().includes(coachKeyword.toLowerCase()),
        )
        .filter((coach) => coachVisible[coach.id] ?? true),
    [coachKeyword, coachVisible, coaches],
  );

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
    [items],
  );

  const dayBookings = useMemo(() => {
    return sortedItems.filter((item) => {
      const starts = new Date(item.starts_at).getTime();
      const ends = new Date(item.ends_at).getTime();
      if (Number.isNaN(starts) || Number.isNaN(ends)) return false;
      const dayStart = new Date(`${dateKey}T00:00:00`).getTime();
      const dayEnd = new Date(`${dateKey}T23:59:59`).getTime();
      return starts < dayEnd && ends > dayStart;
    });
  }, [dateKey, sortedItems]);

  const bookingsByCoach = useMemo(() => {
    const map: Record<string, BookingItem[]> = {};
    for (const booking of dayBookings) {
      const key = booking.coach_id || "__unassigned__";
      if (!map[key]) map[key] = [];
      map[key].push(booking);
    }
    for (const key of Object.keys(map)) {
      map[key] = map[key].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    }
    return map;
  }, [dayBookings]);

  const blocksByCoach = useMemo(() => {
    const map: Record<string, CoachBlockItem[]> = {};
    for (const block of coachBlocks) {
      if (block.status !== "active") continue;
      if (!map[block.coach_id]) map[block.coach_id] = [];
      map[block.coach_id].push(block);
    }
    for (const key of Object.keys(map)) {
      map[key] = map[key].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    }
    return map;
  }, [coachBlocks]);

  const unassignedBookings = bookingsByCoach.__unassigned__ || [];

  const coachSummary = useMemo(() => {
    return coachOptions.map((coach) => {
      const list = bookingsByCoach[coach.id] || [];
      const blockList = blocksByCoach[coach.id] || [];
      const bookedCount = list.filter((item) => isActiveForConflict(item.status)).length;
      let nextFree = "--";
      for (const slot of timeSlots) {
        const slotStart = localDatetimeToIso(localDateTimeFrom(dateKey, slot));
        const slotEnd = localDatetimeToIso(addMinutesToLocalDate(localDateTimeFrom(dateKey, slot), 60));
        const hasBookingConflict = list.some((item) => isActiveForConflict(item.status) && overlap(item.starts_at, item.ends_at, slotStart, slotEnd));
        const hasBlockConflict = blockList.some((item) => overlap(item.starts_at, item.ends_at, slotStart, slotEnd));
        const hasConflict = hasBookingConflict || hasBlockConflict;
        if (!hasConflict) {
          nextFree = slot;
          break;
        }
      }
      return { coach, bookedCount, nextFree };
    });
  }, [blocksByCoach, bookingsByCoach, coachOptions, dateKey, timeSlots]);

  const isTodayView = useMemo(() => dateKey === toDateKey(new Date()), [dateKey]);
  const nowMinute = useMemo(() => {
    const d = new Date(nowTick);
    if (Number.isNaN(d.getTime())) return DAY_START_MINUTE;
    return d.getHours() * 60 + d.getMinutes();
  }, [nowTick]);
  const showNowLine = isTodayView && nowMinute >= DAY_START_MINUTE && nowMinute <= DAY_END_MINUTE;
  const nowLineTop = ((nowMinute - DAY_START_MINUTE) / SLOT_MINUTE) * SLOT_HEIGHT;

  const allDayByCoach = useMemo(() => {
    const dayStart = new Date(`${dateKey}T00:00:00`).getTime();
    const dayEnd = new Date(`${dateKey}T23:59:59`).getTime();
    const result: Record<string, Array<{ id: string; label: string; type: "booking" | "block" }>> = {};
    for (const coach of coachOptions) {
      const rows: Array<{ id: string; label: string; type: "booking" | "block" }> = [];
      const bookingRows = bookingsByCoach[coach.id] || [];
      const blockRows = blocksByCoach[coach.id] || [];
      for (const booking of bookingRows) {
        const starts = new Date(booking.starts_at).getTime();
        const ends = new Date(booking.ends_at).getTime();
        if (Number.isNaN(starts) || Number.isNaN(ends)) continue;
        const isAllDayLike = starts < dayStart || ends > dayEnd || ends - starts >= 8 * 60 * 60 * 1000;
        if (!isAllDayLike) continue;
        rows.push({
          id: booking.id,
          label: `${booking.service_name} · ${statusLabel(derivedStatus(booking), zh)}`,
          type: "booking",
        });
      }
      for (const block of blockRows) {
        const starts = new Date(block.starts_at).getTime();
        const ends = new Date(block.ends_at).getTime();
        if (Number.isNaN(starts) || Number.isNaN(ends)) continue;
        const isAllDayLike = starts < dayStart || ends > dayEnd || ends - starts >= 8 * 60 * 60 * 1000;
        if (!isAllDayLike) continue;
        rows.push({
          id: block.id,
          label: `${zh ? "封鎖" : "Blocked"} · ${block.reason}`,
          type: "block",
        });
      }
      result[coach.id] = rows.slice(0, 2);
    }
    return result;
  }, [blocksByCoach, bookingsByCoach, coachOptions, dateKey, zh]);

  const hasAllDayEvents = useMemo(
    () => coachOptions.some((coach) => (allDayByCoach[coach.id] || []).length > 0),
    [allDayByCoach, coachOptions],
  );

  const selectedMemberContracts = useMemo(() => {
    return memberPasses.map((pass) => {
      const total = parsePassTotal(pass.pass_type);
      const usedRows = memberRedemptions
        .filter((item) => item.pass_id === pass.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const usedSessionNumbers = new Set<number>();
      usedRows.forEach((item, index) => {
        const no = item.session_no || parseSessionNoFromNote(item.note) || index + 1;
        if (no > 0) usedSessionNumbers.add(no);
      });
      const pending = pendingPassDeduct[pass.id] || 0;
      const remaining = Math.max(0, Number(pass.remaining || 0) - pending);
      const fallbackTotal = total ?? Math.max(remaining + usedSessionNumbers.size, remaining);
      return { pass, total, fallbackTotal, remaining, usedSessionNumbers };
    });
  }, [memberPasses, memberRedemptions, pendingPassDeduct]);

  const loadRecentQueries = useCallback(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("frontdesk_booking_recent_member_query");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) setRecentQueries(parsed.filter((item) => typeof item === "string").slice(0, 8));
    } catch {
      // ignore malformed cache
    }
  }, []);

  const saveRecentQuery = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized || typeof window === "undefined") return;
    setRecentQueries((prev) => {
      const next = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, 8);
      window.localStorage.setItem("frontdesk_booking_recent_member_query", JSON.stringify(next));
      return next;
    });
  }, []);

  const loadAudit = useCallback(async () => {
    const res = await fetch("/api/frontdesk/audit?action=booking_update&targetType=booking&limit=50", { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) setAuditItems((payload.items || []) as AuditItem[]);
  }, []);

  const loadMasterData = useCallback(async () => {
    const [servicesRes, coachesRes] = await Promise.all([fetch("/api/services", { cache: "no-store" }), fetch("/api/coaches", { cache: "no-store" })]);
    const servicesPayload = await servicesRes.json().catch(() => ({}));
    const coachesPayload = await coachesRes.json().catch(() => ({}));

    if (!servicesRes.ok) {
      throw new Error(servicesPayload?.error || (zh ? "載入服務失敗" : "Load services failed"));
    }
    if (!coachesRes.ok) {
      throw new Error(coachesPayload?.error || (zh ? "載入教練失敗" : "Load coaches failed"));
    }
    const nextServices = (servicesPayload.items || []) as ServiceItem[];
    const nextCoaches = ((coachesPayload.items || []) as CoachItem[]).sort((a, b) =>
      String(a.displayName || a.id).localeCompare(String(b.displayName || b.id), zh ? "zh-Hant" : "en"),
    );
    setServices(nextServices);
    setCoaches(nextCoaches);
    setCoachVisible((prev) => {
      const merged = { ...prev };
      for (const coach of nextCoaches) {
        if (typeof merged[coach.id] !== "boolean") merged[coach.id] = true;
      }
      return merged;
    });
  }, [zh]);

  const loadBookingsByDate = useCallback(
    async (targetDate: string) => {
      const from = encodeURIComponent(startOfDayIso(targetDate));
      const to = encodeURIComponent(endOfDayIso(targetDate));
      const res = await fetch(`/api/bookings?from=${from}&to=${to}`, { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || (zh ? "載入預約失敗" : "Load bookings failed"));
      }
      setItems(((payload.items || []) as Array<BookingApiItem | BookingItem>).map(normalizeBookingApiItem));
    },
    [zh],
  );

  const loadCoachBlocksByDate = useCallback(
    async (targetDate: string) => {
      const from = encodeURIComponent(startOfDayIso(targetDate));
      const to = encodeURIComponent(endOfDayIso(targetDate));
      const res = await fetch(`/api/frontdesk/coach-blocks?from=${from}&to=${to}`, { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setCoachBlocks((payload.items || []) as CoachBlockItem[]);
    },
    [],
  );

  const loadMemberContracts = useCallback(
    async (memberId: string) => {
      if (!memberId) return;
      setLoadingPasses(true);
      try {
        const [passesRes, redemptionsRes] = await Promise.all([
          fetch(`/api/members/${encodeURIComponent(memberId)}/passes`, { cache: "no-store" }),
          fetch(`/api/session-redemptions?memberId=${encodeURIComponent(memberId)}`, { cache: "no-store" }),
        ]);
        const passesPayload = await passesRes.json().catch(() => ({}));
        const redemptionsPayload = await redemptionsRes.json().catch(() => ({}));
        if (!passesRes.ok) {
          throw new Error(passesPayload?.error || (zh ? "載入合約失敗" : "Load member contracts failed"));
        }
        setMemberPasses((passesPayload.items || []) as PassItem[]);
        if (redemptionsRes.ok) setMemberRedemptions((redemptionsPayload.items || []) as SessionRedemptionItem[]);
        else setMessage(redemptionsPayload?.error || null);
      } finally {
        setLoadingPasses(false);
      }
    },
    [zh],
  );

  const loadSingleMemberResultSummary = useCallback(
    async (memberId: string) => {
      if (!memberId) return;
      setMemberResultSummaries((prev) => ({
        ...prev,
        [memberId]: prev[memberId] ?? { loading: true, remainingSessions: 0, activeContractCount: 0, previewSessions: [] },
      }));

      try {
        const [passesRes, redemptionsRes] = await Promise.all([
          fetch(`/api/members/${encodeURIComponent(memberId)}/passes`, { cache: "no-store" }),
          fetch(`/api/session-redemptions?memberId=${encodeURIComponent(memberId)}`, { cache: "no-store" }),
        ]);
        const passesPayload = await passesRes.json().catch(() => ({}));
        const redemptionsPayload = await redemptionsRes.json().catch(() => ({}));
        if (!passesRes.ok) throw new Error(passesPayload?.error || "load member passes failed");
        const summary = buildMemberResultSummary(
          (passesPayload.items || []) as PassItem[],
          redemptionsRes.ok ? ((redemptionsPayload.items || []) as SessionRedemptionItem[]) : [],
          serviceOptions[0]?.value || "",
        );
        setMemberResultSummaries((prev) => ({ ...prev, [memberId]: summary }));
      } catch {
        setMemberResultSummaries((prev) => ({
          ...prev,
          [memberId]: { loading: false, remainingSessions: 0, activeContractCount: 0, previewSessions: [] },
        }));
      }
    },
    [serviceOptions],
  );

  const loadMemberResultSummaries = useCallback(
    async (members: MemberItem[]) => {
      const targets = members.slice(0, 8);
      if (targets.length === 0) return;

      setMemberResultSummaries((prev) => {
        const next = { ...prev };
        for (const member of targets) {
          if (!next[member.id]) {
            next[member.id] = { loading: true, remainingSessions: 0, activeContractCount: 0, previewSessions: [] };
          }
        }
        return next;
      });

      await Promise.all(
        targets.map(async (member) => {
          await loadSingleMemberResultSummary(member.id);
        }),
      );
    },
    [loadSingleMemberResultSummary],
  );

  const loadAll = useCallback(
    async (targetDate: string) => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadMasterData(), loadBookingsByDate(targetDate), loadCoachBlocksByDate(targetDate), loadAudit()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : zh ? "載入失敗" : "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [loadAudit, loadBookingsByDate, loadCoachBlocksByDate, loadMasterData, zh],
  );

  useEffect(() => {
    loadRecentQueries();
    void loadAll(dateKey);
  }, [dateKey, loadAll, loadRecentQueries]);

  useEffect(() => {
    if (!prefillMemberId) return;
    const ghostMember: MemberItem = {
      id: prefillMemberId,
      full_name: zh ? "指定會員" : "Selected Member",
      phone: null,
      email: null,
      status: null,
    };
    setSelectedMember(ghostMember);
    void loadMemberContracts(prefillMemberId);
  }, [loadMemberContracts, prefillMemberId, zh]);

  useEffect(() => {
    if (!isTodayView) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isTodayView]);

  useEffect(() => {
    if (!highlightedBookingId) return;
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedBookingId(null);
      highlightTimeoutRef.current = null;
    }, 3200);
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
    };
  }, [highlightedBookingId]);

  useEffect(() => {
    if (!highlightedBookingId) {
      focusedBookingIdRef.current = null;
      return;
    }
    if (focusedBookingIdRef.current === highlightedBookingId) return;
    const grid = calendarGridScrollRef.current;
    if (!grid) return;
    const target = grid.querySelector<HTMLElement>(`[data-booking-id="${highlightedBookingId}"]`);
    if (!target) return;
    focusedBookingIdRef.current = highlightedBookingId;
    const gridRect = grid.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const outsideVertical = targetRect.top < gridRect.top + 56 || targetRect.bottom > gridRect.bottom - 24;
    const outsideHorizontal = targetRect.left < gridRect.left + 112 || targetRect.right > gridRect.right - 24;
    if (outsideVertical || outsideHorizontal) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [highlightedBookingId]);

  const memberSearch = useCallback(
    async (queryInput: string) => {
      const query = queryInput.trim();
      if (!query) {
        setMemberResults([]);
        return;
      }
      setSearchingMember(true);
      setError(null);
      try {
        const digitOnly = sanitizePhoneQuery(query);
        const candidate = digitOnly.length >= 6 ? digitOnly : query;
        let res = await fetch(`/api/members?q=${encodeURIComponent(candidate)}&limit=40`, { cache: "no-store" });
        let payload = await res.json().catch(() => ({}));
        if ((!res.ok || !(payload.items || []).length) && digitOnly && candidate !== query) {
          res = await fetch(`/api/members?q=${encodeURIComponent(query)}&limit=40`, { cache: "no-store" });
          payload = await res.json().catch(() => ({}));
        }
        if (!res.ok) {
          throw new Error(payload?.error || (zh ? "會員搜尋失敗" : "Member search failed"));
        }
        const next = (payload.items || []) as MemberItem[];
        setMemberResults(next);
        setMemberMap((prev) => {
          const map = { ...prev };
          for (const member of next) map[member.id] = member;
          return map;
        });
        void loadMemberResultSummaries(next);
        saveRecentQuery(query);
      } catch (err) {
        setError(err instanceof Error ? err.message : zh ? "會員搜尋失敗" : "Member search failed");
      } finally {
        setSearchingMember(false);
      }
    },
    [loadMemberResultSummaries, saveRecentQuery, zh],
  );

  async function handleMemberSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await memberSearch(memberQuery);
  }

  function openSessionDropDraft(payload: Extract<DragPayload, { kind: "pass_session" }>, coachId: string, timeLabel: string) {
    const serviceFallback = payload.serviceName || serviceOptions[0]?.value || "";
    const firstDuration = serviceOptions.find((service) => service.value === serviceFallback)?.durationMinutes || 60;
    setDraft({
      mode: "sessionDrop",
      sourceBookingId: null,
      memberId: payload.memberId,
      memberName: payload.memberName,
      memberPhone: payload.memberPhone,
      passId: payload.passId,
      passType: payload.passType,
      passTotal: payload.passTotal,
      passRemaining: payload.passRemaining,
      sessionNumber: payload.sessionNumber,
      serviceName: serviceFallback,
      coachId,
      startsLocal: localDateTimeFrom(dateKey, timeLabel),
      durationMinutes: firstDuration,
      note: "",
      room: "",
      reason: zh ? "櫃檯拖拉排課建立" : "Created by drag-and-drop",
      notifyMember: false,
    });
    setDraftError(null);
  }

  function openQuickCreateDraft(coachId: string, timeLabel: string) {
    if (!selectedMember) {
      setError(zh ? "請先搜尋並選擇會員，再使用快速建立。" : "Select a member before using quick create.");
      return;
    }
    const serviceFallback = serviceOptions[0]?.value || "";
    const firstDuration = serviceOptions.find((service) => service.value === serviceFallback)?.durationMinutes || 60;
    setDraft({
      mode: "quickCreate",
      sourceBookingId: null,
      memberId: selectedMember.id,
      memberName: selectedMember.full_name || selectedMember.id,
      memberPhone: selectedMember.phone || "",
      passId: null,
      passType: "",
      passTotal: null,
      passRemaining: 0,
      sessionNumber: null,
      serviceName: serviceFallback,
      coachId,
      startsLocal: localDateTimeFrom(dateKey, timeLabel),
      durationMinutes: firstDuration,
      note: "",
      room: "",
      reason: zh ? "櫃檯快速建立" : "Quick create from calendar cell",
      notifyMember: false,
    });
    setDraftError(null);
  }

  function openRescheduleDraft(payload: Extract<DragPayload, { kind: "booking_event" }>, coachId: string, timeLabel: string) {
    const member = memberMap[payload.memberId];
    setDraft({
      mode: "reschedule",
      sourceBookingId: payload.bookingId,
      memberId: payload.memberId,
      memberName: member?.full_name || payload.memberId,
      memberPhone: member?.phone || "",
      passId: null,
      passType: "",
      passTotal: null,
      passRemaining: 0,
      sessionNumber: null,
      serviceName: payload.serviceName,
      coachId,
      startsLocal: localDateTimeFrom(dateKey, timeLabel),
      durationMinutes: Math.max(30, payload.durationMinutes || 60),
      note: stripRoomFromNote(payload.note),
      room: parseRoomFromNote(payload.note),
      reason: zh ? "拖拉改期" : "Rescheduled by drag-and-drop",
      notifyMember: false,
    });
    setDraftError(null);
  }

  function handleDragStart(event: DragStartEvent) {
    const payload = (event.active.data.current?.payload || null) as DragPayload | null;
    setActiveDragPayload(payload);
  }

  function handleDragCancel() {
    setActiveDragPayload(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const payload = (event.active.data.current?.payload || null) as DragPayload | null;
    const overData = (event.over?.data.current || null) as SlotDropData | null;
    setActiveDragPayload(null);
    if (!payload || !overData?.coachId || !overData?.timeLabel) return;
    if (payload.kind === "pass_session") {
      openSessionDropDraft(payload, overData.coachId, overData.timeLabel);
      return;
    }
    openRescheduleDraft(payload, overData.coachId, overData.timeLabel);
  }

  function handleCalendarCellClick(coachId: string, timeLabel: string) {
    openQuickCreateDraft(coachId, timeLabel);
  }

  const detectConflicts = useCallback((params: {
    memberId: string;
    coachId: string;
    startsAt: string;
    endsAt: string;
    room: string;
    ignoreBookingId?: string | null;
  }) => {
    const coachBlocked = coachBlocks.find((item) => {
      if (item.status !== "active") return false;
      if (item.coach_id !== params.coachId) return false;
      return overlap(item.starts_at, item.ends_at, params.startsAt, params.endsAt);
    });
    const coachConflict = dayBookings.find((item) => {
      if (params.ignoreBookingId && item.id === params.ignoreBookingId) return false;
      if (!isActiveForConflict(item.status) && !isBlockedBooking(item)) return false;
      if (!item.coach_id || item.coach_id !== params.coachId) return false;
      return overlap(item.starts_at, item.ends_at, params.startsAt, params.endsAt);
    });
    const memberConflict = dayBookings.find((item) => {
      if (params.ignoreBookingId && item.id === params.ignoreBookingId) return false;
      if (!isActiveForConflict(item.status)) return false;
      if (item.member_id !== params.memberId) return false;
      return overlap(item.starts_at, item.ends_at, params.startsAt, params.endsAt);
    });
    const roomConflict = params.room
      ? dayBookings.find((item) => {
          if (params.ignoreBookingId && item.id === params.ignoreBookingId) return false;
          if (!isActiveForConflict(item.status)) return false;
          return parseRoomFromNote(item.note) === params.room && overlap(item.starts_at, item.ends_at, params.startsAt, params.endsAt);
        })
      : null;
    return { coachConflict, memberConflict, roomConflict, coachBlocked };
  }, [coachBlocks, dayBookings]);

  const draftConflictPreview = useMemo(() => {
    if (!draft) return null;
    const startsAt = localDatetimeToIso(draft.startsLocal);
    const endsAt = localDatetimeToIso(addMinutesToLocalDate(draft.startsLocal, draft.durationMinutes));
    if (!startsAt || !endsAt || !draft.memberId || !draft.coachId) return null;

    return buildDraftConflictPreview({
      zh,
      ...detectConflicts({
        memberId: draft.memberId,
        coachId: draft.coachId,
        startsAt,
        endsAt,
        room: draft.room.trim(),
        ignoreBookingId: draft.mode === "reschedule" ? draft.sourceBookingId : null,
      }),
    });
  }, [detectConflicts, draft, zh]);

  async function createBookingApi(input: {
    memberId: string;
    coachId: string;
    serviceName: string;
    startsAt: string;
    endsAt: string;
    note: string | null;
  }) {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: input.memberId,
        coachId: input.coachId || null,
        serviceName: input.serviceName,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || (zh ? "建立預約失敗" : "Create booking failed"));
    return payload?.booking as { id: string } | undefined;
  }

  async function patchBookingApi(input: {
    bookingId: string;
    status?: string;
    coachId?: string | null;
    startsAt?: string;
    endsAt?: string;
    note?: string | null;
    reason: string;
  }) {
    const res = await fetch(`/api/bookings/${encodeURIComponent(input.bookingId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: input.status,
        coachId: input.coachId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note,
        reason: input.reason,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || (zh ? "更新預約失敗" : "Update booking failed"));
    return payload?.booking as BookingItem | undefined;
  }

  async function redeemPass(input: { bookingId: string; memberId: string; passId: string; sessionNo: number | null }) {
    const res = await fetch("/api/session-redemptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: input.bookingId,
        memberId: input.memberId,
        redeemedKind: "pass",
        passId: input.passId,
        sessionNo: input.sessionNo,
        quantity: 1,
        note: `${zh ? "前台排課扣堂" : "Frontdesk booking redemption"}${input.sessionNo ? ` session_no:${input.sessionNo}` : ""}`,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || (zh ? "扣堂失敗" : "Session redemption failed"));
  }

  async function sendBookingNotification(input: {
    memberId: string;
    memberPhone: string;
    memberEmail: string | null;
    messageText: string;
  }) {
    const phoneDigits = sanitizePhoneQuery(input.memberPhone);
    const target = phoneDigits || (input.memberEmail || "");
    if (!target) return;
    const channel = phoneDigits ? "sms" : "email";
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        target,
        message: input.messageText,
        memberId: input.memberId,
        templateKey: "frontdesk_booking_schedule",
      }),
    });
  }

  async function queueBookingSync(input: { bookingId: string; eventType: string; payload?: Record<string, unknown> }) {
    await fetch("/api/frontdesk/booking-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: input.bookingId,
        provider: "google_calendar",
        eventType: input.eventType,
        payload: input.payload || {},
      }),
    }).catch(() => null);
  }

  async function confirmDraft() {
    if (!draft) return;
    const draftSnapshot = draft;
    setSaving(true);
    setDraftError(null);
    setMessage(null);
    setError(null);

    const startsAt = localDatetimeToIso(draft.startsLocal);
    const endsLocal = addMinutesToLocalDate(draft.startsLocal, draft.durationMinutes);
    const endsAt = localDatetimeToIso(endsLocal);
    const reason = draft.reason.trim();
    const room = draft.room.trim();
    const noteText = composeNote(draft.note, room);

    if (!startsAt || !endsAt) {
      setDraftError(zh ? "請提供有效的時間。" : "Please provide valid start/end time.");
      setSaving(false);
      return;
    }
    if (!draft.memberId || !draft.serviceName || !draft.coachId) {
      setDraftError(zh ? "會員、服務、教練為必填。" : "Member, service and coach are required.");
      setSaving(false);
      return;
    }
    if (!reason) {
      setDraftError(zh ? "請填寫操作原因（稽核）。" : "Reason is required for audit.");
      setSaving(false);
      return;
    }

    const { coachConflict, memberConflict, roomConflict, coachBlocked } = detectConflicts({
      memberId: draft.memberId,
      coachId: draft.coachId,
      startsAt,
      endsAt,
      room,
      ignoreBookingId: draft.mode === "reschedule" ? draft.sourceBookingId : null,
    });

    if (coachConflict || memberConflict || roomConflict || coachBlocked) {
      const messages: string[] = [];
      if (coachConflict) messages.push(zh ? "教練同時段已有課程或封鎖時段。" : "Coach has overlap / blocked slot.");
      if (coachBlocked) messages.push(zh ? "教練該時段已封鎖。" : "Coach is blocked for this slot.");
      if (memberConflict) messages.push(zh ? "會員同時段已有預約。" : "Member already has overlapping booking.");
      if (roomConflict) messages.push(zh ? "場地同時段已被使用。" : "Room is occupied for this slot.");
      setDraftError(messages.join(" "));
      setSaving(false);
      return;
    }

    try {
      if (draft.mode === "reschedule" && draft.sourceBookingId) {
        const original = items.find((item) => item.id === draft.sourceBookingId);
        if (!original) throw new Error(zh ? "原始預約不存在，請重新整理。" : "Source booking not found.");

        const coachChanged = String(original.coach_id || "") !== draft.coachId;
        if (!coachChanged) {
          const updated = await patchBookingApi({ bookingId: draft.sourceBookingId, startsAt, endsAt, note: noteText, reason, coachId: draft.coachId });
          if (updated?.id) {
            await queueBookingSync({
              bookingId: updated.id,
              eventType: "upsert",
              payload: { source: "frontdesk_reschedule", startsAt, endsAt, coachId: draft.coachId },
            });
          }
          if (draft.notifyMember) {
            await sendBookingNotification({
              memberId: draft.memberId,
              memberPhone: draft.memberPhone,
              memberEmail: memberMap[draft.memberId]?.email || null,
              messageText: zh
                ? `您的課程已改期：${fmtDate(startsAt)}，教練 ${draft.coachId}`
                : `Your class has been rescheduled to ${fmtDate(startsAt)} with coach ${draft.coachId}.`,
            });
          }
          setMessage(
            zh
              ? `已為 ${draftSnapshot.memberName} 更新預約：${fmtDate(startsAt)} / ${coaches.find((coach) => coach.id === draftSnapshot.coachId)?.displayName || draftSnapshot.coachId}`
              : `Rescheduled ${draftSnapshot.memberName} to ${fmtDate(startsAt)} with ${coaches.find((coach) => coach.id === draftSnapshot.coachId)?.displayName || draftSnapshot.coachId}.`,
          );
        } else {
          const created = await createBookingApi({
            memberId: draft.memberId,
            coachId: draft.coachId,
            serviceName: draft.serviceName,
            startsAt,
            endsAt,
            note: noteText,
          });
          if (!created?.id) throw new Error(zh ? "改期建立新預約失敗。" : "Failed to create replacement booking.");
          try {
            await patchBookingApi({
              bookingId: draft.sourceBookingId,
              status: "cancelled",
              note: `${stripRoomFromNote(original.note)} [rescheduled]`.trim(),
              reason: `${reason} | rescheduled_to:${created.id}`,
            });
            await queueBookingSync({
              bookingId: draft.sourceBookingId,
              eventType: "cancel",
              payload: { source: "frontdesk_reschedule", movedTo: created.id },
            });
          } catch (rollbackErr) {
            await patchBookingApi({ bookingId: created.id, status: "cancelled", reason: "rollback_reschedule_failed" }).catch(() => null);
            throw rollbackErr;
          }
          await queueBookingSync({
            bookingId: created.id,
            eventType: "upsert",
            payload: { source: "frontdesk_reschedule", startsAt, endsAt, coachId: draft.coachId },
          });
          setMessage(
            zh
              ? `已為 ${draftSnapshot.memberName} 改期到 ${fmtDate(startsAt)} / ${coaches.find((coach) => coach.id === draftSnapshot.coachId)?.displayName || draftSnapshot.coachId}`
              : `Moved ${draftSnapshot.memberName} to ${fmtDate(startsAt)} with ${coaches.find((coach) => coach.id === draftSnapshot.coachId)?.displayName || draftSnapshot.coachId}.`,
          );
        }
      } else {
        const created = await createBookingApi({
          memberId: draft.memberId,
          coachId: draft.coachId,
          serviceName: draft.serviceName,
          startsAt,
          endsAt,
          note: noteText,
        });
        if (!created?.id) throw new Error(zh ? "建立預約失敗。" : "Failed to create booking.");
        await queueBookingSync({
          bookingId: created.id,
          eventType: "upsert",
          payload: { source: "frontdesk_create", startsAt, endsAt, coachId: draft.coachId },
        });

        if (draft.mode === "sessionDrop" && draft.passId) {
          try {
            await redeemPass({
              bookingId: created.id,
              memberId: draft.memberId,
              passId: draft.passId,
              sessionNo: draft.sessionNumber || null,
            });
            setPendingPassDeduct((prev) => ({ ...prev, [draft.passId as string]: (prev[draft.passId as string] || 0) + 1 }));
          } catch (redeemErr) {
            await patchBookingApi({
              bookingId: created.id,
              status: "cancelled",
              reason: "rollback_session_redeem_failed",
              note: `${noteText || ""} [rollback]`.trim() || null,
            }).catch(() => null);
            throw redeemErr;
          }
        }
        if (draft.notifyMember) {
          await sendBookingNotification({
            memberId: draft.memberId,
            memberPhone: draft.memberPhone,
            memberEmail: memberMap[draft.memberId]?.email || null,
            messageText: zh
              ? `您的課程已建立：${fmtDate(startsAt)}，教練 ${draft.coachId}`
              : `Your booking is confirmed at ${fmtDate(startsAt)} with coach ${draft.coachId}.`,
          });
        }
        setMessage(
          zh
            ? `已建立預約：${draftSnapshot.memberName} / ${fmtDate(startsAt)} / ${coaches.find((coach) => coach.id === draftSnapshot.coachId)?.displayName || draftSnapshot.coachId}`
            : `Created booking for ${draftSnapshot.memberName} at ${fmtDate(startsAt)} with ${coaches.find((coach) => coach.id === draftSnapshot.coachId)?.displayName || draftSnapshot.coachId}.`,
        );
        setHighlightedBookingId(created.id);
      }

      await loadBookingsByDate(dateKey);
      await loadAudit();
      if (selectedMember) await loadMemberContracts(selectedMember.id);
      await loadSingleMemberResultSummary(draft.memberId);
      setDraft(null);
      setDraftError(null);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : zh ? "預約處理失敗。" : "Booking action failed.";
      setDraftError(messageText);
      setError(messageText);
    } finally {
      setSaving(false);
    }
  }

  function toggleCoachVisible(coachId: string) {
    setCoachVisible((prev) => ({ ...prev, [coachId]: !(prev[coachId] ?? true) }));
  }

  function syncScrollTargets(params: { left?: number; top?: number }) {
    if (scrollSyncLockRef.current) return;
    scrollSyncLockRef.current = true;
    if (typeof params.left === "number") {
      if (calendarHeaderScrollRef.current) calendarHeaderScrollRef.current.scrollLeft = params.left;
      if (calendarGridScrollRef.current) calendarGridScrollRef.current.scrollLeft = params.left;
    }
    if (typeof params.top === "number") {
      if (calendarTimeScrollRef.current) calendarTimeScrollRef.current.scrollTop = params.top;
      if (calendarGridScrollRef.current) calendarGridScrollRef.current.scrollTop = params.top;
    }
    window.requestAnimationFrame(() => {
      scrollSyncLockRef.current = false;
    });
  }

  function handleCalendarHeadScroll() {
    const head = calendarHeaderScrollRef.current;
    if (!head) return;
    syncScrollTargets({ left: head.scrollLeft });
  }

  function handleCalendarGridScroll() {
    const grid = calendarGridScrollRef.current;
    if (!grid) return;
    syncScrollTargets({ left: grid.scrollLeft, top: grid.scrollTop });
  }

  function handleCalendarTimeScroll() {
    const time = calendarTimeScrollRef.current;
    if (!time) return;
    syncScrollTargets({ top: time.scrollTop });
  }

  return (
    <main className="fdBkPage" data-frontdesk-bookings-page>
      <section className={`fdBkWorkspace ${sidebarCollapsed ? "is-sidebar-collapsed" : ""} ${mobileSidebarOpen ? "is-mobile-sidebar-open" : ""}`}>
        <header className="fdBkTopBar">
          <div className="fdBkTopLeft">
            <button
              type="button"
              className="fdBkIconBtn"
              onClick={() => {
                setSidebarCollapsed((prev) => !prev);
                setMobileSidebarOpen((prev) => !prev);
              }}
              aria-label={zh ? "切換側欄" : "Toggle sidebar"}
            >
              ☰
            </button>
            <strong>{zh ? "櫃檯排課工作台" : "Frontdesk Scheduler"}</strong>
          </div>
          <div className="fdBkTopCenter">
            <button type="button" className="fdBkGhostBtn" onClick={() => setDateKey(toDateKey(new Date()))}>{zh ? "今天" : "Today"}</button>
            <button type="button" className="fdBkGhostIconBtn" onClick={() => setDateKey(shiftDate(dateKey, -1))}>{"<"}</button>
            <button type="button" className="fdBkGhostIconBtn" onClick={() => setDateKey(shiftDate(dateKey, 1))}>{">"}</button>
            <span className={`fdBkDateTitle ${isTodayView ? "is-today" : ""}`}>
              {new Date(`${dateKey}T00:00:00`).toLocaleDateString(zh ? "zh-TW" : "en-US", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
            </span>
          </div>
          <div className="fdBkTopRight">
            <div className="fdBkViewSwitch" role="tablist" aria-label={zh ? "視圖切換" : "View switch"}>
              <button type="button" className="is-active" role="tab" aria-selected>{zh ? "日" : "Day"}</button>
              <button type="button" role="tab" aria-selected={false} disabled>{zh ? "週" : "Week"}</button>
              <button type="button" role="tab" aria-selected={false} disabled>{zh ? "月" : "Month"}</button>
            </div>
            <form
              className="fdBkTopSearch"
              onSubmit={(event) => {
                event.preventDefault();
                void memberSearch(memberQuery);
              }}
            >
              <input className="input" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder={zh ? "搜尋會員" : "Search member"} />
            </form>
            <input className="input fdBkCoachSearchInput" value={coachKeyword} onChange={(event) => setCoachKeyword(event.target.value)} placeholder={zh ? "搜尋教練" : "Search coach"} />
            <button type="button" className="fdBkGhostBtn" onClick={() => void loadAll(dateKey)}>{zh ? "重新整理" : "Reload"}</button>
          </div>
        </header>

        {error ? <div className="error fdBkMessageLine">{error}</div> : null}
        {message ? <p className="sub fdBkMessageLine fdBkMessageLineInfo">{message}</p> : null}

        <DndContext autoScroll sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          <section className="fdBkLayout">
            <aside className="fdBkSidebar">
            <SidebarAccordion title={zh ? "建立入口" : "Quick Actions"} defaultOpen>
              <div className="fdBkQuickActionGrid">
                <button type="button" className="fdBkGhostBtn" onClick={() => setSidebarCollapsed(false)}>{zh ? "新增預約" : "New booking"}</button>
                <button type="button" className="fdBkGhostBtn" onClick={() => document.getElementById("booking-audit-trail")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{zh ? "查看稽核" : "View audit"}</button>
              </div>
            </SidebarAccordion>

            <SidebarAccordion title={zh ? "作業台定位" : "Workspace Scope"} defaultOpen={false}>
              <div data-frontdesk-bookings-scope>
                <p className="fdGlassText">
                  {zh
                    ? "這是 frontdesk domain 的正式 booking workbench。它聚焦櫃檯排課：搜尋會員、查看剩餘課程、拖拉到教練時段、確認建立預約，以及建立後的即時接手。"
                    : "This is the formal booking workbench for the frontdesk domain. It stays focused on desk scheduling: search members, review remaining sessions, drag onto coach timeslots, confirm bookings, and perform immediate handoff after save."}
                </p>
                <p className="fdGlassText" style={{ marginTop: 8 }}>
                  {zh
                    ? "若你要改的是教練主資料、排班/block 規則、服務/方案/套票規則、integrations、operations 或 notifications，請離開 frontdesk 改走 manager domain。"
                    : "If the task is coach master data, scheduling/block rules, service/plan/package rules, integrations, operations, or notifications, leave frontdesk and use the manager domain instead."}
                </p>
              </div>
            </SidebarAccordion>

            <section className="fdGlassSubPanel" style={{ padding: 12 }} data-frontdesk-boundary>
              <div className="kvLabel">{zh ? "櫃檯與後台邊界" : "Frontdesk vs Manager Boundary"}</div>
              <div className="fdDataGrid" style={{ marginTop: 8 }} data-frontdesk-responsibility-index>
                <p className="sub" style={{ marginTop: 0 }}>
                  <strong>{zh ? "這頁負責" : "Owns"}:</strong>{" "}
                  {zh
                    ? "排課查看、會員搜尋、剩餘課程確認、drag / drop 建立預約、draft / confirm、建立後接手。"
                    : "Schedule view, member search, remaining-session checks, drag / drop booking creation, draft / confirm, and post-save handoff."}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  <strong>{zh ? "改去哪裡" : "Go to manager for"}:</strong>{" "}
                  {zh
                    ? "教練主資料、排班 / block 規則、服務 / plans / packages、候補流程、operations、integrations、notifications。"
                    : "Coach master data, scheduling / blocks, services / plans / packages, waitlist, operations, integrations, and notifications."}
                </p>
              </div>
              <div className="fdBkQuickActionGrid" style={{ marginTop: 10 }} data-frontdesk-manager-links>
                <Link className="fdBkGhostBtn" href="/manager">{zh ? "Manager Hub" : "Manager Hub"}</Link>
                <Link className="fdBkGhostBtn" href="/manager/settings/operations">{zh ? "Operations / 政策" : "Operations / policy"}</Link>
                <Link className="fdBkGhostBtn" href="/manager/notifications">{zh ? "Notifications" : "Notifications"}</Link>
              </div>
            </section>

            <SidebarAccordion title={zh ? "角色分工" : "Role Matrix"} defaultOpen={false}>
              <ul className="fdBkDraftAlertList">
                <li>
                  {zh
                    ? "教練｜可看：全部排程、自己的接手資訊。可建立：不作為主要建立角色。可修改：優先只調整自己的預約。不能碰：服務、規則、帳號與權限設定。"
                    : "Coach | View: full schedule and personal handoff context. Create: not the primary create role. Edit: primarily their own bookings. Not allowed: services, rules, account settings, or permissions."}
                </li>
                <li>
                  {zh
                    ? "櫃檯｜可看：全部教練排程、會員資料、剩餘課程。可建立：為全部教練建立預約。可修改：調整與接手前台預約。不能碰：任何設定型責任；那些已搬到 manager。"
                    : "Frontdesk | View: all coach schedules, member data, and remaining sessions. Create: bookings across all coaches. Edit: frontdesk booking adjustments and handoff tasks. Not allowed: configuration responsibilities; those have moved to manager."}
                </li>
                <li>
                  {zh
                    ? "經理｜可看：全部排程、前台作業結果、稽核紀錄。可建立：必要時可代建預約。可修改：跨教練/跨館調度與例外處理。設定型任務仍應切到 manager 子頁，不在這裡做。"
                    : "Manager | View: full schedule, frontdesk outcomes, and audit logs. Create: can create bookings when needed. Edit: cross-coach / cross-branch coordination and exception handling. Configuration work still belongs on manager pages, not here."}
                </li>
              </ul>
            </SidebarAccordion>

            <SidebarAccordion title={zh ? "迷你月曆" : "Mini Calendar"} defaultOpen>
              <input type="date" className="input" value={dateKey} onChange={(event) => setDateKey(event.target.value || toDateKey(new Date()))} />
            </SidebarAccordion>

            <SidebarAccordion title={zh ? "會員搜尋" : "Member Search"} defaultOpen id="booking-member-search">
              <form onSubmit={handleMemberSearchSubmit} className="fdBkMemberSearchForm">
                <input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} className="input" placeholder={zh ? "姓名 / 電話（Enter 搜尋）" : "Name / phone (Enter)"} />
                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={searchingMember}>
                  {searchingMember ? (zh ? "搜尋中..." : "Searching...") : zh ? "搜尋" : "Search"}
                </button>
              </form>
              {recentQueries.length > 0 ? (
                <div className="fdBkRecentRow">
                  {recentQueries.map((query) => (
                    <button key={query} type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => { setMemberQuery(query); void memberSearch(query); }}>
                      {query}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="fdBkSearchResult">
                {!searchingMember && memberQuery.trim() && memberResults.length === 0 ? <p className="fdGlassText">{zh ? "查無會員。" : "No member found."}</p> : null}
                {memberResults.map((member) => {
                  const summary = memberResultSummaries[member.id];
                  return (
                    <article key={member.id} className={`fdBkMemberResultCard ${selectedMember?.id === member.id ? "is-active" : ""}`}>
                      <button
                        type="button"
                        className={`fdBkMemberRow ${selectedMember?.id === member.id ? "is-active" : ""}`}
                        onClick={() => {
                          setSelectedMember(member);
                          setMemberMap((prev) => ({ ...prev, [member.id]: member }));
                          void loadMemberContracts(member.id);
                        }}
                      >
                        <strong>{member.full_name || member.id}</strong>
                        <span>{member.phone || member.email || "-"}</span>
                        <span>
                          {summary?.loading
                            ? (zh ? "剩餘課程載入中..." : "Loading sessions...")
                            : `${zh ? "剩餘課程" : "Remaining"}: ${summary?.remainingSessions ?? 0}`}
                        </span>
                      </button>
                      {summary?.previewSessions?.length ? (
                        <div className="fdBkMemberDragGrid">
                          {summary.previewSessions.map((session) => (
                            <DraggableSessionPill
                              key={`${member.id}-${session.passId}-${session.sessionNumber}`}
                              id={`search-session-${member.id}-${session.passId}-${session.sessionNumber}`}
                              disabled={false}
                              used={false}
                              label={`${member.full_name || member.id} · #${session.sessionNumber}`}
                              helper={zh ? "拖到右側時段" : "Drag to a timeslot"}
                              payload={{
                                kind: "pass_session",
                                memberId: member.id,
                                memberName: member.full_name || member.id,
                                memberPhone: member.phone || "",
                                passId: session.passId,
                                passType: session.passType,
                                passTotal: session.passTotal,
                                passRemaining: session.passRemaining,
                                sessionNumber: session.sessionNumber,
                                serviceName: session.serviceName,
                              }}
                            />
                          ))}
                        </div>
                      ) : summary && !summary.loading ? (
                        <p className="fdGlassText fdBkMemberResultHint">
                          {summary.activeContractCount > 0
                            ? (zh ? "此會員目前沒有可拖拉的剩餘堂次。" : "No draggable sessions remain for this member.")
                            : (zh ? "尚未找到可用課程合約。" : "No active contract found yet.")}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </SidebarAccordion>

            <SidebarAccordion title={zh ? "會員資訊" : "Member Profile"} defaultOpen>
              {selectedMember ? (
                <div className="fdBkMemberInfo">
                  <p className="sub">{zh ? "姓名" : "Name"}: {selectedMember.full_name || "-"}</p>
                  <p className="sub">{zh ? "電話" : "Phone"}: {selectedMember.phone || "-"}</p>
                  <p className="sub">{zh ? "會員ID" : "Member ID"}: {selectedMember.id}</p>
                  {selectedMember.custom_fields && Object.keys(selectedMember.custom_fields).length > 0 ? (
                    <p className="sub">{zh ? "標籤" : "Tags"}: {Object.entries(selectedMember.custom_fields).map(([key, value]) => `${key}:${value}`).join(" / ")}</p>
                  ) : null}
                </div>
              ) : (
                <p className="fdGlassText">{zh ? "尚未選擇會員。" : "No member selected."}</p>
              )}
            </SidebarAccordion>

            <SidebarAccordion title={zh ? "教練課程 / 合約" : "Contracts / Sessions"} defaultOpen>
              {loadingPasses ? <p className="fdGlassText">{zh ? "載入合約..." : "Loading contracts..."}</p> : null}
              {!loadingPasses && selectedMember && selectedMemberContracts.length === 0 ? <p className="fdGlassText">{zh ? "無教練課程合約。" : "No active contract."}</p> : null}
              {!selectedMember ? <p className="fdGlassText">{zh ? "請先選擇會員。" : "Please select member first."}</p> : null}
              {selectedMemberContracts.map(({ pass, total, remaining, fallbackTotal, usedSessionNumbers }) => {
                const expanded = expandedPasses[pass.id] ?? false;
                return (
                  <article key={pass.id} className="fdBkPassCard">
                    <button type="button" className="fdBkPassHead" onClick={() => setExpandedPasses((prev) => ({ ...prev, [pass.id]: !expanded }))}>
                      <div>
                        <strong>{pass.pass_type || (zh ? "合約" : "Contract")}</strong>
                        <p className="sub" style={{ marginTop: 2 }}>{zh ? "總堂數" : "Total"}: {total ?? "--"} / {zh ? "剩餘" : "Remaining"}: {remaining}</p>
                      </div>
                      <span className="fdChip">{expanded ? (zh ? "收合" : "Collapse") : (zh ? "展開" : "Expand")}</span>
                    </button>
                    {expanded ? (
                      <div className="fdBkPassSessions">
                        {Array.from({ length: fallbackTotal }, (_, index) => {
                          const no = index + 1;
                          const used = usedSessionNumbers.has(no);
                          const dragDisabled = used || !selectedMember;
                          return (
                            <DraggableSessionPill
                              key={`${pass.id}-${no}`}
                              id={`session-${pass.id}-${no}`}
                              disabled={dragDisabled}
                              used={used}
                              label={`#${no}`}
                              helper={used ? (zh ? "已排" : "Used") : (zh ? "可拖拉" : "Drag")}
                              payload={{
                                kind: "pass_session",
                                memberId: selectedMember?.id || "",
                                memberName: selectedMember?.full_name || selectedMember?.id || "",
                                memberPhone: selectedMember?.phone || "",
                                passId: pass.id,
                                passType: pass.pass_type,
                                passTotal: total,
                                passRemaining: remaining,
                                sessionNumber: no,
                                serviceName: serviceOptions[0]?.value || "",
                              }}
                            />
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </SidebarAccordion>

            <SidebarAccordion title={zh ? "離開 frontdesk 的情境" : "When to leave frontdesk"} defaultOpen={false}>
              <p className="fdGlassText">
                {zh
                  ? "如果需求不是立即排課，而是改規則、改主資料、改整合、改通知治理，就應離開這頁去 manager。"
                  : "If the task is not immediate booking work but rule changes, master-data changes, integrations, or notification governance, leave this page and use manager instead."}
              </p>
              <ul className="fdBkDraftAlertList">
                <li>{zh ? "教練管理頁｜責任：教練主資料、帳號管理、啟用 / 停用。原因：這些會影響身份與人員生命週期，不應混在前台排課作業。"
                  : "Coach admin page | Responsibilities: coach master data, account management, activation / deactivation. Why: identity and staff lifecycle management should not live inside frontdesk scheduling."}</li>
                <li>{zh ? "排班 / block 設定頁｜責任：教練可排班規則、休假、封鎖時段。原因：這些是供給側規則來源，應先於前台排課被設定。"
                  : "Scheduling / block settings page | Responsibilities: coach availability rules, leave, and blocked slots. Why: these are supply-side rules that should be configured before frontdesk scheduling."}</li>
                <li>{zh ? "服務與課程規則頁｜責任：服務項目、堂次 / 扣課規則。原因：這些會影響付款、扣堂與建立預約的共用邏輯。"
                  : "Service and entitlement rules page | Responsibilities: service catalog and session / deduction rules. Why: these drive shared payment, redemption, and booking logic."}</li>
                <li>{zh ? "營運與權限頁｜責任：權限規則、跨教練 / 跨館規則、預設預約時間與營運規則。原因：這些屬於全域政策，不應由單一排課頁承擔。"
                  : "Operations and permissions page | Responsibilities: permission rules, cross-coach / cross-branch rules, and default booking / operating rules. Why: these are global policies, not single-page frontdesk tasks."}</li>
                <li>{zh ? "候補與整合頁｜責任：候補名單流程、Google Sync / 外部整合。原因：這些屬於延伸流程與外部系統，不應污染核心排課作業。"
                  : "Waitlist and integrations page | Responsibilities: waitlist workflows and Google Sync / external integrations. Why: these are extended workflows and external-system concerns, not core scheduling operations."}</li>
              </ul>
            </SidebarAccordion>

            <SidebarAccordion title={zh ? "前往 manager 的正式入口" : "Manager destinations"} defaultOpen={false}>
              <p className="fdGlassText">
                {zh
                  ? "frontdesk 只做 booking operations。遇到設定型或管理型問題，直接從這裡離開。"
                  : "Frontdesk only owns booking operations. Use these routes when the task turns into configuration or management work."}
              </p>
              <div className="fdBkQuickActionGrid" style={{ marginTop: 10 }}>
                <Link className="fdBkGhostBtn" href="/manager">{zh ? "Manager Hub" : "Manager Hub"}</Link>
                <Link className="fdBkGhostBtn" href="/manager/settings">{zh ? "Settings Hub" : "Settings Hub"}</Link>
                <Link className="fdBkGhostBtn" href="/manager/integrations">{zh ? "Integrations" : "Integrations"}</Link>
                <Link className="fdBkGhostBtn" href="/manager/notifications">{zh ? "Notifications" : "Notifications"}</Link>
              </div>
            </SidebarAccordion>
          </aside>

          <section className="fdBkMain">
            <div className="fdBkMainSticky">
              <div>
                <h2 className="sectionTitle" style={{ margin: 0 }}>{zh ? "日排程（06:00 - 23:00）" : "Daily Schedule (06:00 - 23:00)"}</h2>
                <p className="fdGlassText" style={{ marginTop: 4 }}>{isTodayView ? (zh ? "今天 · 資源日視圖" : "Today · Resource Day View") : dateKey}</p>
              </div>
              <div className="fdBkInline">
                <input type="date" className="input" value={dateKey} onChange={(event) => setDateKey(event.target.value || toDateKey(new Date()))} />
              </div>
            </div>

            <div className="fdBkCoachFilterRow">
              {coaches.map((coach) => {
                const checked = coachVisible[coach.id] ?? true;
                return (
                  <label key={coach.id} className="fdBkCoachFilterTag">
                    <input type="checkbox" checked={checked} onChange={() => toggleCoachVisible(coach.id)} />
                    <span>{coach.displayName || coach.id.slice(0, 8)}</span>
                  </label>
                );
              })}
            </div>

            <div className="fdBkSummaryRow">
              {coachSummary.map((summary) => (
                <div key={summary.coach.id} className="fdBkSummaryCard">
                  <strong>{summary.coach.displayName || summary.coach.id.slice(0, 8)}</strong>
                  <span>{zh ? "今日堂數" : "Today"}: {summary.bookedCount}</span>
                  <span>{zh ? "下一空檔" : "Next free"}: {summary.nextFree}</span>
                </div>
              ))}
            </div>

            <div className="fdBkCalendarViewport" ref={calendarGridScrollRef} onScroll={handleCalendarGridScroll}>
              <div className="fdBkCalendarBoard" style={{ minWidth: `${88 + Math.max(1, coachOptions.length) * 220}px` }}>
                <div className="fdBkCoachHeaderRow" ref={calendarHeaderScrollRef} onScroll={handleCalendarHeadScroll} style={{ gridTemplateColumns: `88px repeat(${Math.max(1, coachOptions.length)}, minmax(220px, 1fr))` }}>
                  <div className="fdBkTimeHeader">{zh ? "時間" : "Time"}</div>
                  {coachOptions.map((coach) => (
                    <div key={coach.id} className="fdBkCoachHeaderCell">
                      <strong>{coach.displayName || coach.id.slice(0, 8)}</strong>
                      <span>{coach.id.slice(0, 6)}</span>
                    </div>
                  ))}
                </div>

                {hasAllDayEvents ? (
                  <div className="fdBkAllDayRow" style={{ gridTemplateColumns: `88px repeat(${Math.max(1, coachOptions.length)}, minmax(220px, 1fr))` }}>
                    <div className="fdBkAllDayTimeLabel">{zh ? "全天" : "All-day"}</div>
                    {coachOptions.map((coach) => (
                      <div key={`allday-${coach.id}`} className="fdBkAllDayCell">
                        {(allDayByCoach[coach.id] || []).map((item) => (
                          <span key={item.id} className={`fdBkAllDayChip ${item.type === "block" ? "is-block" : ""}`}>{item.label}</span>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="fdBkCalendarBody" style={{ gridTemplateColumns: `88px repeat(${Math.max(1, coachOptions.length)}, minmax(220px, 1fr))` }}>
                  <div className="fdBkTimeColumn" ref={calendarTimeScrollRef} onScroll={handleCalendarTimeScroll}>
                    {timeSlots.map((slot) => (<div key={slot} className="fdBkTimeSlotLabel" data-time-label={slot}>{slot}</div>))}
                  </div>

                  {coachOptions.map((coach) => {
                    const coachBookings = bookingsByCoach[coach.id] || [];
                    const coachBlockItems = blocksByCoach[coach.id] || [];
                    return (
                      <div key={coach.id} className={`fdBkCoachColumn ${isTodayView ? "is-today" : ""}`} data-coach-id={coach.id}>
                        {timeSlots.map((slot) => {
                          return (
                            <DroppableSlotCell
                              key={`${coach.id}-${slot}`}
                              id={`slot-${coach.id}-${slot}`}
                              coachId={coach.id}
                              timeLabel={slot}
                              onClick={() => handleCalendarCellClick(coach.id, slot)}
                              title={zh ? "點擊快速建立 / 拖放堂次到此格" : "Click quick-create or drop session here"}
                            />
                          );
                        })}
                        {showNowLine ? <div className="fdBkNowLine" style={{ top: `${nowLineTop}px` }} /> : null}
                        {coachBlockItems.map((block) => {
                          const startsMinute = minuteFromIso(block.starts_at);
                          const endsMinute = minuteFromIso(block.ends_at);
                          const top = ((startsMinute - DAY_START_MINUTE) / SLOT_MINUTE) * SLOT_HEIGHT;
                          const height = Math.max(((endsMinute - startsMinute) / SLOT_MINUTE) * SLOT_HEIGHT - 2, 24);
                          if (startsMinute < DAY_START_MINUTE || startsMinute >= DAY_END_MINUTE) return null;
                          return (
                            <div
                              key={block.id}
                              className="fdBkEvent is-blocked"
                              style={{ top: `${top}px`, height: `${height}px` }}
                            >
                              <strong>{zh ? "封鎖時段" : "Blocked"}</strong>
                              <span>{toTimeLabel(startsMinute)}-{toTimeLabel(endsMinute)}</span>
                              <span>{block.reason}</span>
                            </div>
                          );
                        })}
                        {coachBookings.map((item) => {
                          const startsMinute = minuteFromIso(item.starts_at);
                          const endsMinute = minuteFromIso(item.ends_at);
                          const top = ((startsMinute - DAY_START_MINUTE) / SLOT_MINUTE) * SLOT_HEIGHT;
                          const height = Math.max(((endsMinute - startsMinute) / SLOT_MINUTE) * SLOT_HEIGHT - 2, 24);
                          if (startsMinute < DAY_START_MINUTE || startsMinute >= DAY_END_MINUTE) return null;
                          const status = derivedStatus(item);
                          const member = memberMap[item.member_id];
                          const isDraggable = status === "booked" || status === "checked_in";
                          return (
                            <DraggableBookingEvent
                              key={item.id}
                              id={`booking-${item.id}`}
                              bookingId={item.id}
                              className={`fdBkEvent ${statusClassName(status)}`}
                              disabled={!isDraggable}
                              highlighted={item.id === highlightedBookingId}
                              style={{ top: `${top}px`, height: `${height}px` }}
                              onClick={() => {}}
                              title={member?.full_name || item.member_id.slice(0, 6)}
                              subtitle={`${toTimeLabel(startsMinute)}-${toTimeLabel(endsMinute)}`}
                              statusText={statusLabel(status, zh)}
                              tooltip={`${member?.full_name || item.member_id.slice(0, 8)} · ${member?.phone || "-"} · ${statusLabel(status, zh)}${item.note ? ` · ${stripRoomFromNote(item.note) || item.note}` : ""}`}
                              payload={{
                                kind: "booking_event",
                                bookingId: item.id,
                                memberId: item.member_id,
                                serviceName: item.service_name,
                                coachId: item.coach_id,
                                durationMinutes: Math.max(30, endsMinute - startsMinute),
                                note: item.note || "",
                              }}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {unassignedBookings.length > 0 ? (
              <div className="fdBkCard" style={{ marginTop: 12 }}>
                <h3 className="sectionTitle" style={{ margin: 0 }}>{zh ? "未指派教練預約" : "Unassigned Coach Bookings"}</h3>
                <div className="fdBkUnassignedList">
                  {unassignedBookings.map((item) => (
                    <article key={item.id} className="fdBkUnassignedItem">
                      <strong>{item.service_name}</strong>
                      <span>{item.member_id}</span>
                      <span>{fmtDate(item.starts_at)}</span>
                      <span className={`fdChip ${statusClassName(derivedStatus(item))}`}>{statusLabel(derivedStatus(item), zh)}</span>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="fdBkCard" style={{ marginTop: 12 }} id="booking-audit-trail">
              <h3 className="sectionTitle" style={{ margin: 0 }}>{zh ? "稽核紀錄（booking_update）" : "Audit Trail (booking_update)"}</h3>
              <div className="fdBkAuditList">
                {auditItems.map((item) => (
                  <article key={item.id} className="fdBkAuditItem">
                    <strong>{item.action}</strong>
                    <span>{item.target_id}</span>
                    <span>{item.reason || "-"}</span>
                    <span>{fmtDate(item.created_at)}</span>
                    <span>{item.actor_id}</span>
                  </article>
                ))}
                {auditItems.length === 0 ? <p className="fdGlassText">{zh ? "目前沒有稽核紀錄。" : "No audit logs."}</p> : null}
              </div>
            </div>
            </section>
          </section>
          <button
            type="button"
            className="fdBkMobileScrim"
            aria-hidden={!mobileSidebarOpen}
            onClick={() => setMobileSidebarOpen(false)}
            tabIndex={mobileSidebarOpen ? 0 : -1}
          />
          <DragOverlay dropAnimation={null}>
            {activeDragPayload ? (
              <div className="fdBkDragOverlay">
                {activeDragPayload.kind === "pass_session"
                  ? `${activeDragPayload.memberName} / #${activeDragPayload.sessionNumber}`
                  : `${activeDragPayload.serviceName} / ${activeDragPayload.bookingId.slice(0, 8)}`}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </section>

      {draft ? (
        <div className="fdBkModalBackdrop" role="dialog" aria-modal="true">
          <div className="fdGlassSubPanel fdBkModal">
            <div className="fdBkModalHead">
              <h3 className="sectionTitle" style={{ margin: 0 }}>
                {draft.mode === "reschedule" ? (zh ? "確認改期" : "Confirm Reschedule") : (zh ? "確認建立預約" : "Confirm Booking")}
              </h3>
              <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => { setDraft(null); setDraftError(null); }}>
                {zh ? "取消" : "Cancel"}
              </button>
            </div>

            <div className="fdBkModalGrid">
              <div className="fdBkDraftSummary">
                <span>{zh ? "會員" : "Member"}: {draft.memberName}</span>
                <span>{zh ? "教練" : "Coach"}: {coaches.find((coach) => coach.id === draft.coachId)?.displayName || draft.coachId || "-"}</span>
                <span>{zh ? "日期時間" : "Date & Time"}: {draft.startsLocal ? fmtDate(localDatetimeToIso(draft.startsLocal)) : "-"}</span>
                <span>{zh ? "堂次 / 合約" : "Session / Contract"}: {draft.passId ? `#${draft.sessionNumber || "-"} / ${draft.passType || draft.passId}` : (zh ? "手動建立" : "Manual create")}</span>
              </div>
              <div className={`fdBkDraftAlert ${draftConflictPreview?.blocking ? "is-warning" : "is-ok"}`}>
                <strong>{draftConflictPreview?.blocking ? (zh ? "建立前快速提示" : "Quick pre-check") : (zh ? "建立前檢查" : "Pre-check")}</strong>
                {draftConflictPreview?.blocking ? (
                  <ul className="fdBkDraftAlertList">
                    {draftConflictPreview.messages.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{zh ? "目前未發現同教練、同會員或同場地的明顯衝突。這是最小快速提示，不是完整規則引擎。" : "No obvious coach, member, or room overlap is currently detected. This is a lightweight pre-check, not a full rules engine."}</p>
                )}
              </div>
              <label className="fdInventoryField"><span className="kvLabel">{zh ? "會員" : "Member"}</span><div className="input">{draft.memberName}</div></label>
              <label className="fdInventoryField"><span className="kvLabel">{zh ? "電話" : "Phone"}</span><div className="input">{draft.memberPhone || "-"}</div></label>
              <label className="fdInventoryField">
                <span className="kvLabel">{zh ? "教練" : "Coach"}</span>
                <select className="input" value={draft.coachId} onChange={(event) => setDraft((prev) => (prev ? { ...prev, coachId: event.target.value } : prev))}>
                  <option value="">{zh ? "請選擇教練" : "Select coach"}</option>
                  {coaches.map((coach) => (<option key={coach.id} value={coach.id}>{coach.displayName || coach.id}</option>))}
                </select>
              </label>
              <label className="fdInventoryField"><span className="kvLabel">{zh ? "日期時間" : "Date & Time"}</span><input type="datetime-local" className="input" value={draft.startsLocal} onChange={(event) => setDraft((prev) => (prev ? { ...prev, startsLocal: event.target.value } : prev))} /></label>
              <label className="fdInventoryField">
                <span className="kvLabel">{zh ? "時長（分鐘）" : "Duration (min)"}</span>
                <select className="input" value={String(draft.durationMinutes)} onChange={(event) => setDraft((prev) => (prev ? { ...prev, durationMinutes: Number(event.target.value) } : prev))}>
                  <option value="30">30</option><option value="60">60</option><option value="90">90</option><option value="120">120</option>
                </select>
              </label>
              <label className="fdInventoryField">
                <span className="kvLabel">{zh ? "服務" : "Service"}</span>
                <select className="input" value={draft.serviceName} onChange={(event) => {
                  const nextService = event.target.value;
                  const defaultDuration = serviceOptions.find((service) => service.value === nextService)?.durationMinutes || draft.durationMinutes;
                  setDraft((prev) => (prev ? { ...prev, serviceName: nextService, durationMinutes: defaultDuration } : prev));
                }}>
                  <option value="">{zh ? "請選擇服務" : "Select service"}</option>
                  {serviceOptions.map((service) => (<option key={service.value} value={service.value}>{service.label}</option>))}
                </select>
              </label>
              <label className="fdInventoryField"><span className="kvLabel">{zh ? "場地 / 房間（P2）" : "Room (P2)"}</span><input className="input" value={draft.room} onChange={(event) => setDraft((prev) => (prev ? { ...prev, room: event.target.value } : prev))} placeholder={zh ? "例如 Studio-A" : "e.g. Studio-A"} /></label>
              <label className="fdInventoryField"><span className="kvLabel">{zh ? "備註" : "Note"}</span><input className="input" value={draft.note} onChange={(event) => setDraft((prev) => (prev ? { ...prev, note: event.target.value } : prev))} placeholder={zh ? "備註（選填）" : "Optional note"} /></label>
              <label className="fdInventoryField"><span className="kvLabel">{zh ? "操作原因（稽核）" : "Reason (Audit)"}</span><input className="input" value={draft.reason} onChange={(event) => setDraft((prev) => (prev ? { ...prev, reason: event.target.value } : prev))} placeholder={zh ? "必填：例如會員改期" : "Required"} /></label>
              <label className="fdInventoryField fdBkCheckboxLine"><input type="checkbox" checked={draft.notifyMember} onChange={(event) => setDraft((prev) => (prev ? { ...prev, notifyMember: event.target.checked } : prev))} /><span>{zh ? "建立/改期後通知會員（SMS/Email）" : "Notify member after save (SMS/Email)"}</span></label>
            </div>

            {draft.passId ? (
              <div className="fdBkContractMeta">
                <span>{zh ? "合約" : "Contract"}: {draft.passType || draft.passId}</span>
                <span>{zh ? "總堂數" : "Total"}: {draft.passTotal ?? "--"}</span>
                <span>{zh ? "剩餘堂數" : "Remaining"}: {draft.passRemaining}</span>
                <span>{zh ? "堂次" : "Session"}: #{draft.sessionNumber || "-"}</span>
              </div>
            ) : null}

            {draftError ? <div className="error" style={{ marginTop: 10 }}>{draftError}</div> : null}

            <div className="fdBkModalActions">
              <button type="button" className="fdPillBtn" onClick={() => { setDraft(null); setDraftError(null); }} disabled={saving}>{zh ? "取消（不建立、不扣堂）" : "Cancel (no save / no deduction)"}</button>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void confirmDraft()} disabled={saving}>{saving ? (zh ? "處理中..." : "Saving...") : zh ? "確認建立" : "Confirm"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="fdBkLoadingMask">
          <div className="fdGlassSubPanel">{zh ? "載入中..." : "Loading..."}</div>
        </div>
      ) : null}
    </main>
  );
}
