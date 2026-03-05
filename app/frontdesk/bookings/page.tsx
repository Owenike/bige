"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

interface WaitlistItem {
  id: string;
  member_id: string | null;
  contact_name: string;
  contact_phone: string | null;
  desired_date: string | null;
  desired_time: string | null;
  note: string | null;
  status: string;
  created_at: string;
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

function decodeWaitlistInput(input: string) {
  const raw = input.trim();
  if (!raw) return null;
  const chunks = raw.split(/[|,]/).map((value) => value.trim()).filter(Boolean);
  if (chunks.length === 0) return null;
  const [contactName, contactPhoneRaw, desiredTimeRaw, ...rest] = chunks;
  const contactPhoneDigits = sanitizePhoneQuery(contactPhoneRaw || "");
  const desiredTime = desiredTimeRaw && /^\d{2}:\d{2}$/.test(desiredTimeRaw) ? desiredTimeRaw : null;
  return {
    contactName: contactName || raw,
    contactPhone: contactPhoneDigits || null,
    desiredTime,
    note: rest.join(" ").trim() || raw,
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
  style: Record<string, string>;
  onClick: () => void;
  title: string;
  subtitle: string;
  statusText: string;
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
      className={`${props.className} ${isDragging ? "is-dragging" : ""}`}
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
      onClick={props.onClick}
      title={props.title}
    />
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
  const [memberMap, setMemberMap] = useState<Record<string, MemberItem>>({});
  const [selectedMember, setSelectedMember] = useState<MemberItem | null>(null);
  const [memberPasses, setMemberPasses] = useState<PassItem[]>([]);
  const [expandedPasses, setExpandedPasses] = useState<Record<string, boolean>>({});
  const [pendingPassDeduct, setPendingPassDeduct] = useState<Record<string, number>>({});
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  const [activeDragPayload, setActiveDragPayload] = useState<DragPayload | null>(null);
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [statusBookingId, setStatusBookingId] = useState("");
  const [statusValue, setStatusValue] = useState("cancelled");
  const [statusReason, setStatusReason] = useState("");

  const [waitlistInput, setWaitlistInput] = useState("");
  const [waitlist, setWaitlist] = useState<WaitlistItem[]>([]);

  const [blockCoachId, setBlockCoachId] = useState("");
  const [blockStartsLocal, setBlockStartsLocal] = useState("");
  const [blockEndsLocal, setBlockEndsLocal] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [blockNote, setBlockNote] = useState("");
  const [editingBlockId, setEditingBlockId] = useState("");

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
        value: service.code,
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

  const loadWaitlist = useCallback(async (targetDate: string) => {
    const res = await fetch(`/api/frontdesk/booking-waitlist?date=${encodeURIComponent(targetDate)}&limit=20`, { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setWaitlist((payload.items || []) as WaitlistItem[]);
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
      setItems((payload.items || []) as BookingItem[]);
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

  const loadAll = useCallback(
    async (targetDate: string) => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadMasterData(), loadBookingsByDate(targetDate), loadCoachBlocksByDate(targetDate), loadAudit(), loadWaitlist(targetDate)]);
      } catch (err) {
        setError(err instanceof Error ? err.message : zh ? "載入失敗" : "Load failed");
      } finally {
        setLoading(false);
      }
    },
    [loadAudit, loadBookingsByDate, loadCoachBlocksByDate, loadMasterData, loadWaitlist, zh],
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
        saveRecentQuery(query);
      } catch (err) {
        setError(err instanceof Error ? err.message : zh ? "會員搜尋失敗" : "Member search failed");
      } finally {
        setSearchingMember(false);
      }
    },
    [saveRecentQuery, zh],
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

  function detectConflicts(params: {
    memberId: string;
    coachId: string;
    startsAt: string;
    endsAt: string;
    room: string;
    ignoreBookingId?: string | null;
  }) {
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
  }

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
          setMessage(zh ? "預約已改期。" : "Booking rescheduled.");
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
          setMessage(zh ? "預約已改期（跨教練）。" : "Booking moved to another coach.");
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
        setMessage(zh ? "預約建立成功。" : "Booking created.");
      }

      await loadBookingsByDate(dateKey);
      await loadAudit();
      if (selectedMember) await loadMemberContracts(selectedMember.id);
      setDraft(null);
      setDraftError(null);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : zh ? "預約處理失敗。" : "Booking action failed.");
    } finally {
      setSaving(false);
    }
  }

  async function submitStatusUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusBookingId || !statusReason.trim()) {
      setError(zh ? "請選擇預約並填寫原因。" : "Select booking and provide reason.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const booking = items.find((item) => item.id === statusBookingId);
      await patchBookingApi({
        bookingId: statusBookingId,
        status: statusValue,
        note: statusValue === "cancelled" && booking ? `${stripRoomFromNote(booking.note)} [manual-cancelled]`.trim() : booking?.note || null,
        reason: statusReason.trim(),
      });
      await queueBookingSync({
        bookingId: statusBookingId,
        eventType: statusValue === "cancelled" ? "cancel" : "upsert",
        payload: { source: "frontdesk_status_update", status: statusValue },
      });
      setMessage(zh ? "預約狀態已更新。" : "Booking status updated.");
      setStatusReason("");
      await loadBookingsByDate(dateKey);
      await loadAudit();
      if (statusValue === "cancelled" && waitlist.length > 0) {
        const nextCandidate = waitlist[0];
        if (nextCandidate.contact_phone) {
          await fetch("/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              channel: "sms",
              target: sanitizePhoneQuery(nextCandidate.contact_phone),
              message: zh ? "有候補時段釋出，請盡快與櫃檯確認。" : "A waitlist slot is now available, please confirm with frontdesk.",
              memberId: nextCandidate.member_id,
              templateKey: "frontdesk_waitlist_open_slot",
            }),
          }).catch(() => null);
        }
        await fetch(`/api/frontdesk/booking-waitlist/${encodeURIComponent(nextCandidate.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "notified", note: "auto_notified_by_cancel" }),
        }).catch(() => null);
        await loadWaitlist(dateKey);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "更新失敗" : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleCoachVisible(coachId: string) {
    setCoachVisible((prev) => ({ ...prev, [coachId]: !(prev[coachId] ?? true) }));
  }

  async function addWaitlistItem() {
    const parsed = decodeWaitlistInput(waitlistInput);
    if (!parsed) return;
    const payload = {
      memberId: selectedMember?.id || null,
      contactName: selectedMember?.full_name || parsed.contactName,
      contactPhone: selectedMember?.phone || parsed.contactPhone,
      desiredDate: dateKey,
      desiredTime: parsed.desiredTime,
      note: parsed.note,
    };
    await fetch("/api/frontdesk/booking-waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    await loadWaitlist(dateKey);
    setWaitlistInput("");
  }

  async function removeWaitlistItem(waitlistId: string) {
    const target = waitlist.find((item) => item.id === waitlistId);
    if (!target) return;
    await fetch(`/api/frontdesk/booking-waitlist/${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled", note: "removed_from_frontdesk" }),
    }).catch(() => null);
    await loadWaitlist(dateKey);
  }

  async function submitCoachBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!blockCoachId || !blockStartsLocal || !blockEndsLocal || !blockReason.trim()) {
      setError(zh ? "請填寫完整封鎖欄位。" : "Please complete the block form.");
      return;
    }
    const startsAt = localDatetimeToIso(blockStartsLocal);
    const endsAt = localDatetimeToIso(blockEndsLocal);
    if (!startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError(zh ? "封鎖時間格式無效。" : "Invalid block time range.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/frontdesk/coach-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachId: blockCoachId,
          startsAt,
          endsAt,
          reason: blockReason.trim(),
          note: blockNote.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || (zh ? "建立封鎖失敗。" : "Create block failed."));
      setBlockStartsLocal("");
      setBlockEndsLocal("");
      setBlockReason("");
      setBlockNote("");
      setEditingBlockId("");
      await loadCoachBlocksByDate(dateKey);
      setMessage(zh ? "封鎖時段已建立。" : "Blocked slot saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "建立封鎖失敗。" : "Create block failed.");
    } finally {
      setSaving(false);
    }
  }

  async function clearCoachBlock() {
    if (!blockCoachId || !blockStartsLocal || !blockEndsLocal) {
      setBlockCoachId("");
      setBlockStartsLocal("");
      setBlockEndsLocal("");
      setBlockReason("");
      setBlockNote("");
      setEditingBlockId("");
      return;
    }
    const target = coachBlocks.find((item) => item.id === editingBlockId && item.status === "active");
    if (!target) {
      setBlockCoachId("");
      setBlockStartsLocal("");
      setBlockEndsLocal("");
      setBlockReason("");
      setBlockNote("");
      setEditingBlockId("");
      return;
    }
    setSaving(true);
    try {
      await fetch(`/api/frontdesk/coach-blocks/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled", note: zh ? "前台取消封鎖" : "Cancelled by frontdesk" }),
      }).catch(() => null);
      await loadCoachBlocksByDate(dateKey);
      setMessage(zh ? "封鎖時段已取消。" : "Blocked slot cancelled.");
    } finally {
      setSaving(false);
      setBlockCoachId("");
      setBlockStartsLocal("");
      setBlockEndsLocal("");
      setBlockReason("");
      setBlockNote("");
      setEditingBlockId("");
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop fdBkWorkspace">
        <header className="fdGlassPanel fdBkHead">
          <div>
            <div className="fdEyebrow">{zh ? "櫃檯排課工作台" : "FRONTDESK SCHEDULER"}</div>
            <h1 className="h1" style={{ marginTop: 8, fontSize: 34 }}>{zh ? "Google 行事曆風格排課" : "Google Calendar Style Scheduler"}</h1>
            <p className="fdGlassText" style={{ marginTop: 8 }}>
              {zh
                ? "左側搜尋會員與合約堂次，右側依教練與時段排課。拖拉與改期都會先經過確認彈窗與衝突檢查。"
                : "Search members and contracts on the left, schedule by coach and time on the right with confirm-first drag-and-drop."}
            </p>
          </div>
          <div className="fdPillActions" style={{ marginTop: 0 }}>
            <button type="button" className="fdPillBtn" onClick={() => setDateKey(shiftDate(dateKey, -1))}>{zh ? "前一天" : "Prev"}</button>
            <button type="button" className="fdPillBtn" onClick={() => setDateKey(toDateKey(new Date()))}>{zh ? "今天" : "Today"}</button>
            <button type="button" className="fdPillBtn" onClick={() => setDateKey(shiftDate(dateKey, 1))}>{zh ? "後一天" : "Next"}</button>
            <input type="date" className="input" value={dateKey} onChange={(event) => setDateKey(event.target.value || toDateKey(new Date()))} style={{ minWidth: 160 }} />
          </div>
        </header>

        {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : null}
        {message ? <p className="sub" style={{ marginTop: 10, color: "var(--brand)" }}>{message}</p> : null}

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          <section className="fdBkLayout">
            <aside className="fdGlassSubPanel fdBkSidebar">
            <section className="fdBkCard">
              <h2 className="sectionTitle" style={{ margin: 0 }}>{zh ? "會員搜尋" : "Member Search"}</h2>
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
                {memberResults.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className={`fdBkMemberRow ${selectedMember?.id === member.id ? "is-active" : ""}`}
                    onClick={() => {
                      setSelectedMember(member);
                      setMemberMap((prev) => ({ ...prev, [member.id]: member }));
                      setStatusBookingId("");
                      void loadMemberContracts(member.id);
                    }}
                  >
                    <strong>{member.full_name || member.id}</strong>
                    <span>{member.phone || "-"}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="fdBkCard">
              <h3 className="sectionTitle" style={{ margin: 0 }}>{zh ? "會員資訊" : "Member Profile"}</h3>
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
            </section>

            <section className="fdBkCard">
              <h3 className="sectionTitle" style={{ margin: 0 }}>{zh ? "教練課程 / 合約" : "Contracts / Sessions"}</h3>
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
            </section>

            <section className="fdBkCard">
              <h3 className="sectionTitle" style={{ margin: 0 }}>{zh ? "狀態更新" : "Status Update"}</h3>
              <form onSubmit={submitStatusUpdate} className="fdBkStatusForm">
                <select className="input" value={statusBookingId} onChange={(event) => setStatusBookingId(event.target.value)} required>
                  <option value="">{zh ? "選擇預約 ID" : "Select booking"}</option>
                  {dayBookings.map((item) => (<option key={item.id} value={item.id}>{item.id.slice(0, 8)} / {item.member_id}</option>))}
                </select>
                <select className="input" value={statusValue} onChange={(event) => setStatusValue(event.target.value)}>
                  <option value="booked">{statusLabel("booked", zh)}</option>
                  <option value="checked_in">{statusLabel("checked_in", zh)}</option>
                  <option value="completed">{statusLabel("completed", zh)}</option>
                  <option value="no_show">{statusLabel("no_show", zh)}</option>
                  <option value="cancelled">{statusLabel("cancelled", zh)}</option>
                </select>
                <input className="input" value={statusReason} onChange={(event) => setStatusReason(event.target.value)} placeholder={zh ? "更新原因（必填）" : "Reason (required)"} required />
                <button type="submit" className="fdPillBtn" disabled={saving}>{saving ? (zh ? "更新中..." : "Updating...") : zh ? "套用狀態" : "Apply"}</button>
              </form>
            </section>

            <section className="fdBkCard">
              <h3 className="sectionTitle" style={{ margin: 0 }}>{zh ? "封鎖時段（教練不可排）" : "Coach Blocked Slots"}</h3>
              <form onSubmit={submitCoachBlock} className="fdBkStatusForm">
                <select className="input" value={blockCoachId} onChange={(event) => { setBlockCoachId(event.target.value); if (editingBlockId) setEditingBlockId(""); }} required>
                  <option value="">{zh ? "選擇教練" : "Select coach"}</option>
                  {coaches.map((coach) => (
                    <option key={coach.id} value={coach.id}>{coach.displayName || coach.id}</option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  className="input"
                  value={blockStartsLocal}
                  onChange={(event) => { setBlockStartsLocal(event.target.value); if (editingBlockId) setEditingBlockId(""); }}
                  required
                />
                <input
                  type="datetime-local"
                  className="input"
                  value={blockEndsLocal}
                  onChange={(event) => { setBlockEndsLocal(event.target.value); if (editingBlockId) setEditingBlockId(""); }}
                  required
                />
                <input
                  className="input"
                  value={blockReason}
                  onChange={(event) => { setBlockReason(event.target.value); if (editingBlockId) setEditingBlockId(""); }}
                  placeholder={zh ? "封鎖原因（必填）" : "Reason (required)"}
                  required
                />
                <input
                  className="input"
                  value={blockNote}
                  onChange={(event) => { setBlockNote(event.target.value); if (editingBlockId) setEditingBlockId(""); }}
                  placeholder={zh ? "備註（選填）" : "Optional note"}
                />
                <div className="fdBkInline">
                  <button type="submit" className="fdPillBtn">{zh ? "建立封鎖" : "Create block"}</button>
                  <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => void clearCoachBlock()}>
                    {zh ? "取消封鎖 / 清空" : "Cancel block / Reset"}
                  </button>
                </div>
              </form>
            </section>

            <section className="fdBkCard">
              <h3 className="sectionTitle" style={{ margin: 0 }}>{zh ? "候補名單（P2）" : "Waitlist (P2)"}</h3>
              <div className="fdBkInline">
                <input className="input" value={waitlistInput} onChange={(event) => setWaitlistInput(event.target.value)} placeholder={zh ? "姓名 / 電話 / 時段" : "Name / phone / time"} />
                <button type="button" className="fdPillBtn" onClick={addWaitlistItem}>+</button>
              </div>
              <div className="fdBkWaitlist">
                {waitlist.map((item) => (
                  <div key={item.id} className="fdBkWaitRow">
                    <span>{item.contact_name}{item.contact_phone ? ` / ${item.contact_phone}` : ""}{item.desired_time ? ` / ${item.desired_time}` : ""}</span>
                    <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => void removeWaitlistItem(item.id)}>{zh ? "移除" : "Remove"}</button>
                  </div>
                ))}
                {waitlist.length === 0 ? <p className="fdGlassText">{zh ? "尚無候補資料。" : "No waitlist items."}</p> : null}
              </div>
            </section>

            <section className="fdBkCard">
              <h3 className="sectionTitle" style={{ margin: 0 }}>{zh ? "Google Sync（P2 預留）" : "Google Sync (P2 Placeholder)"}</h3>
              <p className="fdGlassText">
                {zh ? "目前保留同步介面：後續可將教練行程同步至 Google Calendar，避免外務衝突。" : "Sync placeholder kept for future Google Calendar integration."}
              </p>
            </section>
          </aside>

          <section className="fdGlassSubPanel fdBkMain">
            <div className="fdBkMainSticky">
              <div>
                <h2 className="sectionTitle" style={{ margin: 0 }}>{zh ? "日排程（06:00 - 23:00）" : "Daily Schedule (06:00 - 23:00)"}</h2>
                <p className="fdGlassText" style={{ marginTop: 4 }}>{dateKey}</p>
              </div>
              <div className="fdBkInline">
                <input className="input" value={coachKeyword} onChange={(event) => setCoachKeyword(event.target.value)} placeholder={zh ? "搜尋教練" : "Search coaches"} />
                <button type="button" className="fdPillBtn" onClick={() => void loadAll(dateKey)}>{zh ? "重新整理" : "Reload"}</button>
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

            <div className="fdBkCalendarViewport">
              <div className="fdBkCalendarBoard" style={{ minWidth: `${88 + Math.max(1, coachOptions.length) * 220}px` }}>
                <div className="fdBkCoachHeaderRow" style={{ gridTemplateColumns: `88px repeat(${Math.max(1, coachOptions.length)}, minmax(220px, 1fr))` }}>
                  <div className="fdBkTimeHeader">{zh ? "時間" : "Time"}</div>
                  {coachOptions.map((coach) => (
                    <div key={coach.id} className="fdBkCoachHeaderCell">
                      <strong>{coach.displayName || coach.id.slice(0, 8)}</strong>
                      <span>{coach.id.slice(0, 6)}</span>
                    </div>
                  ))}
                </div>

                <div className="fdBkCalendarBody" style={{ gridTemplateColumns: `88px repeat(${Math.max(1, coachOptions.length)}, minmax(220px, 1fr))` }}>
                  <div className="fdBkTimeColumn">
                    {timeSlots.map((slot) => (<div key={slot} className="fdBkTimeSlotLabel">{slot}</div>))}
                  </div>

                  {coachOptions.map((coach) => {
                    const coachBookings = bookingsByCoach[coach.id] || [];
                    const coachBlockItems = blocksByCoach[coach.id] || [];
                    return (
                      <div key={coach.id} className="fdBkCoachColumn">
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
                        {coachBlockItems.map((block) => {
                          const startsMinute = minuteFromIso(block.starts_at);
                          const endsMinute = minuteFromIso(block.ends_at);
                          const top = ((startsMinute - DAY_START_MINUTE) / SLOT_MINUTE) * SLOT_HEIGHT;
                          const height = Math.max(((endsMinute - startsMinute) / SLOT_MINUTE) * SLOT_HEIGHT - 2, 24);
                          if (startsMinute < DAY_START_MINUTE || startsMinute >= DAY_END_MINUTE) return null;
                          return (
                            <button
                              key={block.id}
                              type="button"
                              className="fdBkEvent is-blocked"
                              style={{ top: `${top}px`, height: `${height}px` }}
                              onClick={() => {
                                setEditingBlockId(block.id);
                                setBlockCoachId(block.coach_id);
                                setBlockStartsLocal(isoToLocalInputValue(block.starts_at));
                                setBlockEndsLocal(isoToLocalInputValue(block.ends_at));
                                setBlockReason(block.reason);
                                setBlockNote(block.note || "");
                              }}
                            >
                              <strong>{zh ? "封鎖時段" : "Blocked"}</strong>
                              <span>{toTimeLabel(startsMinute)}-{toTimeLabel(endsMinute)}</span>
                              <span>{block.reason}</span>
                            </button>
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
                              className={`fdBkEvent ${statusClassName(status)}`}
                              disabled={!isDraggable}
                              style={{ top: `${top}px`, height: `${height}px` }}
                              onClick={() => {
                                setStatusBookingId(item.id);
                                setStatusReason("");
                                setStatusValue(item.status);
                              }}
                              title={member?.full_name || item.member_id.slice(0, 6)}
                              subtitle={`${toTimeLabel(startsMinute)}-${toTimeLabel(endsMinute)}`}
                              statusText={statusLabel(status, zh)}
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

            <div className="fdBkCard" style={{ marginTop: 12 }}>
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
