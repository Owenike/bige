import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createDefaultBookingSettings,
  mapBookingSettingsRow,
  mapBranchSummary,
  mapStorefrontServiceRow,
} from "./storefront";
import type {
  PublicBookingCoach,
  PublicBookingPayload,
  PublicBookingTimeSlot,
  StoreBookingSettings,
  StorefrontBranchSummary,
  StorefrontServiceSummary,
} from "../types/storefront";
import type {
  TherapistBlockItem,
  TherapistRecurringSchedule,
  TherapistSummary,
} from "../types/therapist-scheduling";

type BranchRow = {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
};

type BookingSettingsRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  deposits_enabled: boolean | null;
  packages_enabled: boolean | null;
  deposit_required_mode: "optional" | "required" | null;
  deposit_calculation_type: "fixed" | "percent" | null;
  deposit_value: number | string | null;
  allow_customer_reschedule: boolean | null;
  allow_customer_cancel: boolean | null;
  latest_cancel_hours: number | null;
  latest_reschedule_hours: number | null;
  notifications_enabled: boolean | null;
  reminder_day_before_enabled: boolean | null;
  reminder_hour_before_enabled: boolean | null;
  deposit_reminder_enabled: boolean | null;
  cross_store_therapist_enabled: boolean | null;
  booking_window_days: number | null;
  min_advance_minutes: number | null;
  slot_interval_minutes: number | null;
  timezone: string | null;
  notes: string | null;
  updated_at: string | null;
};

type ServiceRow = {
  id: string;
  branch_id: string | null;
  code: string;
  name: string;
  description: string | null;
  duration_minutes: number | null;
  pre_buffer_minutes: number | null;
  post_buffer_minutes: number | null;
  price_amount: number | string | null;
  requires_deposit: boolean | null;
  deposit_calculation_type: "fixed" | "percent" | null;
  deposit_value: number | string | null;
  is_active: boolean | null;
  deleted_at: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  branch_id: string | null;
  role: "coach" | "therapist";
  is_active: boolean;
};

type CoachBranchLinkRow = {
  coach_id: string;
  branch_id: string;
  is_primary: boolean;
  is_active: boolean;
};

type RecurringScheduleRow = {
  id: string;
  coach_id: string;
  branch_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string | null;
  effective_from: string | null;
  effective_until: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CoachSlotRow = {
  id: string;
  coach_id: string;
  branch_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string | null;
};

type BusyBookingRow = {
  id: string;
  coach_id: string | null;
  branch_id: string | null;
  starts_at: string;
  ends_at: string;
  occupied_starts_at?: string | null;
  occupied_ends_at?: string | null;
  status: string;
};

type CoachBlockRow = {
  id: string;
  coach_id: string;
  branch_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string;
  note: string | null;
  status: string;
  block_type?: "time_off" | "blocked" | "offsite" | "other" | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type TherapistWindow = {
  coachId: string;
  branchId: string | null;
  startsAt: string;
  endsAt: string;
  source: "recurring" | "slot";
};

type NormalizedBusyRange = {
  id: string;
  coachId: string;
  branchId: string | null;
  startsAt: string;
  endsAt: string;
  status?: string;
};

type AvailabilityContext = {
  coaches: PublicBookingCoach[];
  service: StorefrontServiceSummary;
  bookingSettings: StoreBookingSettings;
  windows: TherapistWindow[];
  bookings: NormalizedBusyRange[];
  blocks: TherapistBlockItem[];
};

export type SchedulingValidationResult =
  | {
      ok: true;
      assignedCoachId: string | null;
      service: StorefrontServiceSummary | null;
      bookingSettings: StoreBookingSettings;
      occupiedStartsAt: string;
      occupiedEndsAt: string;
      branch: StorefrontBranchSummary | null;
    }
  | {
      ok: false;
      code:
        | "SERVICE_NOT_FOUND"
        | "THERAPIST_NOT_FOUND"
        | "THERAPIST_UNAVAILABLE"
        | "THERAPIST_CONFLICT"
        | "THERAPIST_BLOCKED"
        | "MEMBER_CONFLICT"
        | "BOOKING_WINDOW_EXCEEDED"
        | "TOO_SOON"
        | "INVALID_RANGE";
      message: string;
    };

export const OCCUPYING_BOOKING_STATUSES = ["pending", "confirmed", "booked", "checked_in"] as const;
export const CANONICAL_COACH_DB_ROLE = "coach" as const;
export const BOOKING_THERAPIST_ROLES = [CANONICAL_COACH_DB_ROLE, "therapist"] as const;

function isBookingTherapistRole(value: unknown): value is (typeof BOOKING_THERAPIST_ROLES)[number] {
  return typeof value === "string" && BOOKING_THERAPIST_ROLES.includes(value as (typeof BOOKING_THERAPIST_ROLES)[number]);
}

function isMissingSchemaObject(message: string | undefined, target: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const object = target.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(object)) ||
    (lower.includes("could not find the table") && lower.includes(object)) ||
    (lower.includes("column") && lower.includes(object) && lower.includes("does not exist"))
  );
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function toIsoDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function addDaysToDateKey(dateKey: string, days: number) {
  const next = parseDateKey(dateKey);
  next.setUTCDate(next.getUTCDate() + days);
  return toIsoDateKey(next);
}

function enumerateDateKeys(startKey: string, count: number) {
  return Array.from({ length: Math.max(0, count) }, (_, index) => addDaysToDateKey(startKey, index));
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((item) => [item.type, item.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    second: Number(map.get("second")),
  };
}

function getTimeZoneOffset(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  const utcTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return utcTime - date.getTime();
}

function zonedDateTimeToUtc(dateKey: string, timeValue: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute, secondRaw] = timeValue.split(":").map(Number);
  const second = Number.isFinite(secondRaw) ? secondRaw : 0;
  const utcGuess = Date.UTC(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, second || 0);
  const firstOffset = getTimeZoneOffset(new Date(utcGuess), timeZone);
  const candidate = new Date(utcGuess - firstOffset);
  const secondOffset = getTimeZoneOffset(candidate, timeZone);
  return new Date(utcGuess - secondOffset);
}

function formatDateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDayOfWeek(dateKey: string, timeZone: string) {
  const noon = zonedDateTimeToUtc(dateKey, "12:00:00", timeZone);
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(noon);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

function formatTimeLabel(isoString: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function normalizeBusyRange(row: BusyBookingRow): NormalizedBusyRange | null {
  if (!row.coach_id) return null;
  return {
    id: row.id,
    coachId: row.coach_id,
    branchId: row.branch_id,
    startsAt: row.occupied_starts_at || row.starts_at,
    endsAt: row.occupied_ends_at || row.ends_at,
    status: row.status,
  };
}

function normalizeBlockType(value: string | null | undefined): TherapistBlockItem["blockType"] {
  if (value === "time_off" || value === "blocked" || value === "offsite" || value === "other") return value;
  return "blocked";
}

function sortServices(rows: ServiceRow[], branchId: string | null) {
  return [...rows].sort((left, right) => {
    const leftRank = left.branch_id === branchId ? 0 : left.branch_id ? 1 : 2;
    const rightRank = right.branch_id === branchId ? 0 : right.branch_id ? 1 : 2;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.name.localeCompare(right.name);
  });
}

async function resolveBranchSummary(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
}) {
  if (!params.branchId) return null;
  const result = await params.supabase
    .from("branches")
    .select("id, tenant_id, name, code, address, is_active")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.branchId)
    .maybeSingle();

  if (result.error) throw new Error(result.error.message);
  return result.data ? mapBranchSummary(result.data as BranchRow) : null;
}

export async function resolveBookingSettingsForBranch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  branchCode?: string | null;
  branchName?: string | null;
}) {
  const [branchResult, defaultResult] = await Promise.all([
    params.branchId
      ? params.supabase
          .from("store_booking_settings")
          .select(
            "id, tenant_id, branch_id, deposits_enabled, packages_enabled, deposit_required_mode, deposit_calculation_type, deposit_value, allow_customer_reschedule, allow_customer_cancel, latest_cancel_hours, latest_reschedule_hours, notifications_enabled, reminder_day_before_enabled, reminder_hour_before_enabled, deposit_reminder_enabled, cross_store_therapist_enabled, booking_window_days, min_advance_minutes, slot_interval_minutes, timezone, notes, updated_at",
          )
          .eq("tenant_id", params.tenantId)
          .eq("branch_id", params.branchId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    params.supabase
      .from("store_booking_settings")
      .select(
        "id, tenant_id, branch_id, deposits_enabled, packages_enabled, deposit_required_mode, deposit_calculation_type, deposit_value, allow_customer_reschedule, allow_customer_cancel, latest_cancel_hours, latest_reschedule_hours, notifications_enabled, reminder_day_before_enabled, reminder_hour_before_enabled, deposit_reminder_enabled, cross_store_therapist_enabled, booking_window_days, min_advance_minutes, slot_interval_minutes, timezone, notes, updated_at",
      )
      .eq("tenant_id", params.tenantId)
      .is("branch_id", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const chosen = (branchResult.data as BookingSettingsRow | null) || (defaultResult.data as BookingSettingsRow | null);
  return chosen
    ? mapBookingSettingsRow({
        row: chosen,
        tenantId: params.tenantId,
        branchId: params.branchId,
        branchCode: params.branchCode,
        branchName: params.branchName,
        resolvedFromScope: branchResult.data ? "branch_override" : "tenant_default",
      })
    : createDefaultBookingSettings({
        tenantId: params.tenantId,
        branchId: params.branchId,
        branchCode: params.branchCode,
        branchName: params.branchName,
      });
}

export async function resolveSchedulingService(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  serviceCode?: string | null;
  serviceName?: string | null;
}) {
  let result = params.supabase
    .from("services")
    .select(
      "id, branch_id, code, name, description, duration_minutes, pre_buffer_minutes, post_buffer_minutes, price_amount, requires_deposit, deposit_calculation_type, deposit_value, is_active, deleted_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (params.serviceCode) result = result.eq("code", params.serviceCode);
  if (params.serviceName) result = result.ilike("name", params.serviceName);

  const response = await result.limit(50);
  if (response.error) {
    if (
      isMissingSchemaObject(response.error.message, "pre_buffer_minutes") ||
      isMissingSchemaObject(response.error.message, "post_buffer_minutes") ||
      isMissingSchemaObject(response.error.message, "requires_deposit") ||
      isMissingSchemaObject(response.error.message, "deleted_at")
    ) {
      let fallback = params.supabase
        .from("services")
        .select("id, branch_id, code, name, duration_minutes, is_active")
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true);
      if (params.serviceCode) fallback = fallback.eq("code", params.serviceCode);
      if (params.serviceName) fallback = fallback.ilike("name", params.serviceName);
      const fallbackResult = await fallback.limit(50);
      if (fallbackResult.error) throw new Error(fallbackResult.error.message);
      const row = sortServices((fallbackResult.data || []) as ServiceRow[], params.branchId)[0];
      return row
        ? mapStorefrontServiceRow({
            ...row,
            description: "",
            pre_buffer_minutes: 0,
            post_buffer_minutes: 0,
            price_amount: 0,
            requires_deposit: false,
            deposit_calculation_type: "fixed",
            deposit_value: 0,
          } as ServiceRow)
        : null;
    }
    throw new Error(response.error.message);
  }

  const row = sortServices((response.data || []) as ServiceRow[], params.branchId)[0];
  return row ? mapStorefrontServiceRow(row) : null;
}

export async function resolveBranchTherapists(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  coachIds?: string[] | null;
  includeInactive?: boolean;
}) {
  const profileResult = await params.supabase
    .from("profiles")
    .select("id, display_name, branch_id, role, is_active")
    .eq("tenant_id", params.tenantId)
    .order("created_at", { ascending: true });
  if (profileResult.error) throw new Error(profileResult.error.message);

  let profiles = ((profileResult.data || []) as ProfileRow[]).filter((item) => isBookingTherapistRole(item.role));
  if (!params.includeInactive) profiles = profiles.filter((item) => item.is_active);
  if (params.coachIds?.length) {
    const allowed = new Set(params.coachIds);
    profiles = profiles.filter((item) => allowed.has(item.id));
  }

  const linkResult = await params.supabase
    .from("coach_branch_links")
    .select("coach_id, branch_id, is_primary, is_active")
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true);
  if (linkResult.error && !isMissingSchemaObject(linkResult.error.message, "coach_branch_links")) {
    throw new Error(linkResult.error.message);
  }
  const linkRows = isMissingSchemaObject(linkResult.error?.message, "coach_branch_links")
    ? []
    : ((linkResult.data || []) as CoachBranchLinkRow[]);

  const branchResult = await params.supabase
    .from("branches")
    .select("id, tenant_id, name, code, address, is_active")
    .eq("tenant_id", params.tenantId)
    .order("created_at", { ascending: true });
  if (branchResult.error) throw new Error(branchResult.error.message);
  const branchMap = new Map<string, StorefrontBranchSummary>();
  for (const row of (branchResult.data || []) as BranchRow[]) branchMap.set(row.id, mapBranchSummary(row));

  const linksByCoach = new Map<string, CoachBranchLinkRow[]>();
  for (const row of linkRows) {
    const existing = linksByCoach.get(row.coach_id) || [];
    existing.push(row);
    linksByCoach.set(row.coach_id, existing);
  }

  const visible: TherapistSummary[] = [];
  for (const profile of profiles) {
    const links = linksByCoach.get(profile.id) || [];
    const branchIds = Array.from(new Set(links.map((item) => item.branch_id).concat(profile.branch_id ? [profile.branch_id] : [])));
    if (params.branchId) {
      const visibleForBranch =
        branchIds.length === 0 || branchIds.includes(params.branchId) || (!links.length && (!profile.branch_id || profile.branch_id === params.branchId));
      if (!visibleForBranch) continue;
    }

    const primaryLink = links.find((item) => item.is_primary) || null;
    const primaryBranchId = primaryLink?.branch_id || profile.branch_id || branchIds[0] || null;
    visible.push({
      id: profile.id,
      displayName: profile.display_name,
      role: profile.role,
      primaryBranchId,
      primaryBranchName: primaryBranchId ? branchMap.get(primaryBranchId)?.name || null : null,
      branchIds,
      branchLinks: branchIds.map((branchId) => ({
        branchId,
        branchName: branchMap.get(branchId)?.name || null,
        isPrimary: branchId === primaryBranchId,
        isActive: true,
      })),
      serviceNames: [],
      isActive: profile.is_active,
    });
  }

  return visible;
}

async function loadRecurringWindows(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  coachIds: string[];
  bookingSettings: StoreBookingSettings;
  dateKeys: string[];
}) {
  if (!params.coachIds.length || !params.dateKeys.length) return { windows: [] as TherapistWindow[], schedules: [] as TherapistRecurringSchedule[] };
  const firstDateKey = params.dateKeys[0];
  const lastDateKey = params.dateKeys[params.dateKeys.length - 1];
  const scheduleResult = await params.supabase
    .from("coach_recurring_schedules")
    .select("id, coach_id, branch_id, day_of_week, start_time, end_time, timezone, effective_from, effective_until, is_active, note, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true)
    .in("coach_id", params.coachIds);
  if (scheduleResult.error) {
    if (isMissingSchemaObject(scheduleResult.error.message, "coach_recurring_schedules")) {
      return { windows: [] as TherapistWindow[], schedules: [] as TherapistRecurringSchedule[] };
    }
    throw new Error(scheduleResult.error.message);
  }

  const rows = (scheduleResult.data || []) as RecurringScheduleRow[];
  const windows: TherapistWindow[] = [];
  const schedules: TherapistRecurringSchedule[] = [];
  for (const row of rows) {
    if (params.branchId && row.branch_id && row.branch_id !== params.branchId) continue;
    if (!params.branchId && row.branch_id) continue;
    if (row.effective_from && row.effective_from > lastDateKey) continue;
    if (row.effective_until && row.effective_until < firstDateKey) continue;
    schedules.push({
      id: row.id,
      coachId: row.coach_id,
      branchId: row.branch_id,
      dayOfWeek: row.day_of_week,
      startTime: row.start_time,
      endTime: row.end_time,
      timezone: row.timezone || params.bookingSettings.timezone,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until,
      isActive: row.is_active,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });

    for (const dateKey of params.dateKeys) {
      const timeZone = row.timezone || params.bookingSettings.timezone;
      if (localDayOfWeek(dateKey, timeZone) !== row.day_of_week) continue;
      if (row.effective_from && dateKey < row.effective_from) continue;
      if (row.effective_until && dateKey > row.effective_until) continue;
      const startsAt = zonedDateTimeToUtc(dateKey, row.start_time, timeZone);
      const endsAt = zonedDateTimeToUtc(dateKey, row.end_time, timeZone);
      if (endsAt.getTime() <= startsAt.getTime()) continue;
      windows.push({
        coachId: row.coach_id,
        branchId: row.branch_id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        source: "recurring",
      });
    }
  }
  return { windows, schedules };
}

async function loadManualSlotWindows(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  coachIds: string[];
  rangeStart: Date;
  rangeEnd: Date;
}) {
  if (!params.coachIds.length) return [] as TherapistWindow[];
  const slotResult = await params.supabase
    .from("coach_slots")
    .select("id, coach_id, branch_id, starts_at, ends_at, status, note")
    .eq("tenant_id", params.tenantId)
    .eq("status", "active")
    .in("coach_id", params.coachIds)
    .lte("starts_at", params.rangeEnd.toISOString())
    .gte("ends_at", params.rangeStart.toISOString());
  if (slotResult.error) {
    if (isMissingSchemaObject(slotResult.error.message, "coach_slots")) return [] as TherapistWindow[];
    throw new Error(slotResult.error.message);
  }
  return ((slotResult.data || []) as CoachSlotRow[])
    .filter((row) => !row.branch_id || !params.branchId || row.branch_id === params.branchId)
    .map((row) => ({
      coachId: row.coach_id,
      branchId: row.branch_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      source: "slot" as const,
    }));
}

async function loadBusyBookings(params: {
  supabase: SupabaseClient;
  tenantId: string;
  coachIds: string[];
  rangeStart: Date;
  rangeEnd: Date;
}) {
  if (!params.coachIds.length) return [] as NormalizedBusyRange[];
  const paddedStart = addMinutes(params.rangeStart, -720).toISOString();
  const paddedEnd = addMinutes(params.rangeEnd, 720).toISOString();
  const result = await params.supabase
    .from("bookings")
    .select("id, coach_id, branch_id, starts_at, ends_at, occupied_starts_at, occupied_ends_at, status")
    .eq("tenant_id", params.tenantId)
    .in("status", [...OCCUPYING_BOOKING_STATUSES])
    .in("coach_id", params.coachIds)
    .lte("starts_at", paddedEnd)
    .gte("ends_at", paddedStart);
  if (result.error) {
    if (isMissingSchemaObject(result.error.message, "occupied_starts_at")) {
      const fallback = await params.supabase
        .from("bookings")
        .select("id, coach_id, branch_id, starts_at, ends_at, status")
        .eq("tenant_id", params.tenantId)
        .in("status", [...OCCUPYING_BOOKING_STATUSES])
        .in("coach_id", params.coachIds)
        .lte("starts_at", paddedEnd)
        .gte("ends_at", paddedStart);
      if (fallback.error) throw new Error(fallback.error.message);
      return ((fallback.data || []) as BusyBookingRow[]).map(normalizeBusyRange).filter(Boolean) as NormalizedBusyRange[];
    }
    throw new Error(result.error.message);
  }
  return ((result.data || []) as BusyBookingRow[]).map(normalizeBusyRange).filter(Boolean) as NormalizedBusyRange[];
}

async function loadCoachBlocks(params: {
  supabase: SupabaseClient;
  tenantId: string;
  coachIds: string[];
  rangeStart: Date;
  rangeEnd: Date;
}) {
  if (!params.coachIds.length) return [] as TherapistBlockItem[];
  const result = await params.supabase
    .from("coach_blocks")
    .select("id, coach_id, branch_id, starts_at, ends_at, reason, note, status, block_type, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("status", "active")
    .in("coach_id", params.coachIds)
    .lte("starts_at", params.rangeEnd.toISOString())
    .gte("ends_at", params.rangeStart.toISOString());
  if (result.error) {
    if (isMissingSchemaObject(result.error.message, "coach_blocks")) return [] as TherapistBlockItem[];
    if (isMissingSchemaObject(result.error.message, "block_type")) {
      const fallback = await params.supabase
        .from("coach_blocks")
        .select("id, coach_id, branch_id, starts_at, ends_at, reason, note, status, created_at, updated_at")
        .eq("tenant_id", params.tenantId)
        .eq("status", "active")
        .in("coach_id", params.coachIds)
        .lte("starts_at", params.rangeEnd.toISOString())
        .gte("ends_at", params.rangeStart.toISOString());
      if (fallback.error) throw new Error(fallback.error.message);
      return ((fallback.data || []) as CoachBlockRow[]).map((row) => ({
        id: row.id,
        coachId: row.coach_id,
        branchId: row.branch_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        reason: row.reason,
        note: row.note,
        status: row.status,
        blockType: normalizeBlockType("blocked"),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      }));
    }
    throw new Error(result.error.message);
  }
  return ((result.data || []) as CoachBlockRow[]).map((row) => ({
    id: row.id,
    coachId: row.coach_id,
    branchId: row.branch_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
    note: row.note,
    status: row.status,
    blockType: normalizeBlockType(row.block_type),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }));
}

function shouldConflictAcrossBranches(settings: StoreBookingSettings) {
  return Boolean(settings.crossStoreTherapistEnabled);
}

function filterCoachScopedBlocks(blocks: TherapistBlockItem[], coachId: string, branchId: string | null, settings: StoreBookingSettings) {
  return blocks.filter((item) => {
    if (item.coachId !== coachId) return false;
    if (shouldConflictAcrossBranches(settings)) return true;
    return !item.branchId || item.branchId === branchId;
  });
}

function filterCoachScopedBookings(bookings: NormalizedBusyRange[], coachId: string, branchId: string | null, settings: StoreBookingSettings, ignoreBookingId?: string | null) {
  return bookings.filter((item) => {
    if (item.coachId !== coachId) return false;
    if (ignoreBookingId && item.id === ignoreBookingId) return false;
    if (shouldConflictAcrossBranches(settings)) return true;
    return !item.branchId || item.branchId === branchId;
  });
}

function coachWindowCovers(window: TherapistWindow, occupiedStart: Date, occupiedEnd: Date) {
  return new Date(window.startsAt).getTime() <= occupiedStart.getTime() && new Date(window.endsAt).getTime() >= occupiedEnd.getTime();
}

function buildAvailabilityContext(params: {
  coaches: TherapistSummary[];
  service: StorefrontServiceSummary;
  bookingSettings: StoreBookingSettings;
  windows: TherapistWindow[];
  bookings: NormalizedBusyRange[];
  blocks: TherapistBlockItem[];
}): AvailabilityContext {
  return {
    coaches: params.coaches.map((item) => ({
      id: item.id,
      displayName: item.displayName,
      branchId: item.primaryBranchId,
      branchIds: item.branchIds,
      role: item.role,
    })),
    service: params.service,
    bookingSettings: params.bookingSettings,
    windows: params.windows,
    bookings: params.bookings,
    blocks: params.blocks,
  };
}

function candidateFitsCoach(params: {
  context: AvailabilityContext;
  coachId: string;
  branchId: string | null;
  serviceStart: Date;
  serviceEnd: Date;
  ignoreBookingId?: string | null;
}) {
  const occupiedStart = addMinutes(params.serviceStart, -params.context.service.preBufferMinutes);
  const occupiedEnd = addMinutes(params.serviceEnd, params.context.service.postBufferMinutes);
  const coachWindows = params.context.windows.filter((item) => item.coachId === params.coachId);
  const covered = coachWindows.some((item) => coachWindowCovers(item, occupiedStart, occupiedEnd));
  if (!covered) return { ok: false as const, code: "THERAPIST_UNAVAILABLE" as const, occupiedStart, occupiedEnd };

  const bookingConflict = filterCoachScopedBookings(
    params.context.bookings,
    params.coachId,
    params.branchId,
    params.context.bookingSettings,
    params.ignoreBookingId,
  ).some((item) => overlaps(occupiedStart.getTime(), occupiedEnd.getTime(), new Date(item.startsAt).getTime(), new Date(item.endsAt).getTime()));
  if (bookingConflict) return { ok: false as const, code: "THERAPIST_CONFLICT" as const, occupiedStart, occupiedEnd };

  const blockConflict = filterCoachScopedBlocks(
    params.context.blocks,
    params.coachId,
    params.branchId,
    params.context.bookingSettings,
  ).some((item) => overlaps(occupiedStart.getTime(), occupiedEnd.getTime(), new Date(item.startsAt).getTime(), new Date(item.endsAt).getTime()));
  if (blockConflict) return { ok: false as const, code: "THERAPIST_BLOCKED" as const, occupiedStart, occupiedEnd };

  return { ok: true as const, occupiedStart, occupiedEnd };
}

async function loadSharedSchedulingData(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  bookingSettings: StoreBookingSettings;
  coachIds: string[];
  dateKeys: string[];
}) {
  const rangeStart = zonedDateTimeToUtc(params.dateKeys[0], "00:00:00", params.bookingSettings.timezone);
  const rangeEnd = zonedDateTimeToUtc(params.dateKeys[params.dateKeys.length - 1], "23:59:59", params.bookingSettings.timezone);
  const [recurringResult, slotWindows, bookings, blocks] = await Promise.all([
    loadRecurringWindows(params),
    loadManualSlotWindows({
      supabase: params.supabase,
      tenantId: params.tenantId,
      branchId: params.branchId,
      coachIds: params.coachIds,
      rangeStart,
      rangeEnd,
    }),
    loadBusyBookings({
      supabase: params.supabase,
      tenantId: params.tenantId,
      coachIds: params.coachIds,
      rangeStart,
      rangeEnd,
    }),
    loadCoachBlocks({
      supabase: params.supabase,
      tenantId: params.tenantId,
      coachIds: params.coachIds,
      rangeStart,
      rangeEnd,
    }),
  ]);

  return {
    rangeStart,
    rangeEnd,
    windows: [...recurringResult.windows, ...slotWindows],
    bookings,
    blocks,
    schedules: recurringResult.schedules,
  };
}

export async function buildPublicBookingAvailability(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branch: StorefrontBranchSummary | null;
  branches: StorefrontBranchSummary[];
  services: StorefrontServiceSummary[];
  bookingSettings: StoreBookingSettings;
  selectedCoachId?: string | null;
  selectedServiceCode?: string | null;
  selectedDate?: string | null;
}) {
  const selectedService =
    params.services.find((item) => item.code === params.selectedServiceCode) || params.services[0] || null;
  const therapists = await resolveBranchTherapists({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branch?.id || null,
  });
  const dateKeys = enumerateDateKeys(
    formatDateKeyInTimeZone(new Date(), params.bookingSettings.timezone),
    params.bookingSettings.bookingWindowDays + 1,
  );
  const coachIds = therapists
    .filter((item) => !params.selectedCoachId || item.id === params.selectedCoachId)
    .map((item) => item.id);

  if (!selectedService || !coachIds.length) {
    return {
      branch: params.branch,
      branches: params.branches,
      coaches: therapists.map((item) => ({
        id: item.id,
        displayName: item.displayName,
        branchId: item.primaryBranchId,
        branchIds: item.branchIds,
        role: item.role,
      })),
      services: params.services,
      bookingSettings: params.bookingSettings,
      availableDates: [],
      disabledDates: dateKeys,
      slots: [],
    } satisfies PublicBookingPayload;
  }

  const shared = await loadSharedSchedulingData({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branch?.id || null,
    bookingSettings: params.bookingSettings,
    coachIds,
    dateKeys,
  });
  const context = buildAvailabilityContext({
    coaches: therapists.filter((item) => coachIds.includes(item.id)),
    service: selectedService,
    bookingSettings: params.bookingSettings,
    windows: shared.windows,
    bookings: shared.bookings,
    blocks: shared.blocks,
  });
  const minAdvanceAt = addMinutes(new Date(), params.bookingSettings.minAdvanceMinutes);
  const slotsByDate = new Map<string, PublicBookingTimeSlot[]>();

  for (const window of context.windows) {
    if (params.selectedCoachId && window.coachId !== params.selectedCoachId) continue;
    const windowStart = new Date(window.startsAt);
    const windowEnd = new Date(window.endsAt);
    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) continue;

    let earliest = addMinutes(windowStart, selectedService.preBufferMinutes);
    if (earliest.getTime() < minAdvanceAt.getTime()) earliest = new Date(minAdvanceAt);
    const minuteRemainder = earliest.getMinutes() % params.bookingSettings.slotIntervalMinutes;
    if (minuteRemainder !== 0) {
      earliest = addMinutes(earliest, params.bookingSettings.slotIntervalMinutes - minuteRemainder);
      earliest.setSeconds(0, 0);
    }

    let cursor = new Date(earliest);
    while (addMinutes(addMinutes(cursor, selectedService.durationMinutes), selectedService.postBufferMinutes).getTime() <= windowEnd.getTime()) {
      const serviceStart = new Date(cursor);
      const serviceEnd = addMinutes(serviceStart, selectedService.durationMinutes);
      const fit = candidateFitsCoach({
        context,
        coachId: window.coachId,
        branchId: params.branch?.id || null,
        serviceStart,
        serviceEnd,
      });
      if (fit.ok) {
        const dateKey = formatDateKeyInTimeZone(serviceStart, params.bookingSettings.timezone);
        const nextSlot: PublicBookingTimeSlot = {
          startsAt: serviceStart.toISOString(),
          endsAt: serviceEnd.toISOString(),
          label: formatTimeLabel(serviceStart.toISOString(), params.bookingSettings.timezone),
          coachIds: [window.coachId],
        };
        const existing = slotsByDate.get(dateKey) || [];
        const duplicate = existing.find((item) => item.startsAt === nextSlot.startsAt);
        if (duplicate) duplicate.coachIds = Array.from(new Set([...duplicate.coachIds, window.coachId]));
        else existing.push(nextSlot);
        slotsByDate.set(dateKey, existing);
      }
      cursor = addMinutes(cursor, params.bookingSettings.slotIntervalMinutes);
    }
  }

  const availableDates = Array.from(slotsByDate.keys()).sort();
  const requestedDate = params.selectedDate && slotsByDate.has(params.selectedDate) ? params.selectedDate : availableDates[0] || null;
  const slots = requestedDate
    ? (slotsByDate.get(requestedDate) || []).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    : [];

  return {
    branch: params.branch,
    branches: params.branches,
    coaches: therapists.map((item) => ({
      id: item.id,
      displayName: item.displayName,
      branchId: item.primaryBranchId,
      branchIds: item.branchIds,
      role: item.role,
    })),
    services: params.services,
    bookingSettings: params.bookingSettings,
    availableDates,
    disabledDates: dateKeys.filter((item) => !availableDates.includes(item)),
    slots,
  } satisfies PublicBookingPayload;
}

export async function validateBookingSchedule(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  memberId?: string | null;
  coachId?: string | null;
  serviceCode?: string | null;
  serviceName?: string | null;
  startsAt: string;
  endsAt: string;
  ignoreBookingId?: string | null;
  enforceBookingWindow?: boolean;
}) : Promise<SchedulingValidationResult> {
  const serviceStart = new Date(params.startsAt);
  const serviceEnd = new Date(params.endsAt);
  if (Number.isNaN(serviceStart.getTime()) || Number.isNaN(serviceEnd.getTime()) || serviceEnd.getTime() <= serviceStart.getTime()) {
    return { ok: false, code: "INVALID_RANGE", message: "Invalid booking time range" };
  }

  const branch = await resolveBranchSummary({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
  });
  const bookingSettings = await resolveBookingSettingsForBranch({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
    branchCode: branch?.code || null,
    branchName: branch?.name || null,
  });

  if (params.enforceBookingWindow) {
    const minAdvanceAt = addMinutes(new Date(), bookingSettings.minAdvanceMinutes);
    if (serviceStart.getTime() < minAdvanceAt.getTime()) {
      return { ok: false, code: "TOO_SOON", message: "This time no longer satisfies the minimum advance requirement" };
    }
    const lastBookable = addMinutes(new Date(), bookingSettings.bookingWindowDays * 24 * 60);
    if (serviceStart.getTime() > lastBookable.getTime()) {
      return { ok: false, code: "BOOKING_WINDOW_EXCEEDED", message: "This time falls outside the booking window" };
    }
  }

  const service = await resolveSchedulingService({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
    serviceCode: params.serviceCode,
    serviceName: params.serviceName,
  });
  if (!service && (params.serviceCode || params.serviceName)) {
    return { ok: false, code: "SERVICE_NOT_FOUND", message: "Service not found for the selected branch" };
  }

  const normalizedService =
    service ||
    ({
      id: "",
      code: params.serviceCode || "",
      name: params.serviceName || "",
      description: "",
      durationMinutes: Math.max(1, Math.round((serviceEnd.getTime() - serviceStart.getTime()) / 60000)),
      preBufferMinutes: 0,
      postBufferMinutes: 0,
      priceAmount: 0,
      requiresDeposit: false,
      depositCalculationType: "fixed",
      depositValue: 0,
    } satisfies StorefrontServiceSummary);

  if (params.memberId) {
    const overlapResult = await params.supabase
      .from("bookings")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("member_id", params.memberId)
      .in("status", [...OCCUPYING_BOOKING_STATUSES])
      .lt("starts_at", params.endsAt)
      .gt("ends_at", params.startsAt)
      .limit(1)
      .maybeSingle();
    if (overlapResult.error) throw new Error(overlapResult.error.message);
    if (overlapResult.data && (!params.ignoreBookingId || overlapResult.data.id !== params.ignoreBookingId)) {
      return { ok: false, code: "MEMBER_CONFLICT", message: "Customer already has another booking in this time range" };
    }
  }

  const therapists = await resolveBranchTherapists({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
    coachIds: params.coachId ? [params.coachId] : null,
  });
  if (params.coachId && !therapists.some((item) => item.id === params.coachId)) {
    return { ok: false, code: "THERAPIST_NOT_FOUND", message: "Therapist is not available for this branch" };
  }
  const coachIds = params.coachId ? [params.coachId] : therapists.map((item) => item.id);
  if (!coachIds.length) {
    return { ok: false, code: "THERAPIST_NOT_FOUND", message: "No therapist is available for this branch" };
  }

  const dateKey = formatDateKeyInTimeZone(serviceStart, bookingSettings.timezone);
  const shared = await loadSharedSchedulingData({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
    bookingSettings,
    coachIds,
    dateKeys: [dateKey],
  });
  const context = buildAvailabilityContext({
    coaches: therapists,
    service: normalizedService,
    bookingSettings,
    windows: shared.windows,
    bookings: shared.bookings,
    blocks: shared.blocks,
  });

  const targetCoachIds = params.coachId ? [params.coachId] : context.coaches.map((item) => item.id);
  for (const candidateCoachId of targetCoachIds) {
    const fit = candidateFitsCoach({
      context,
      coachId: candidateCoachId,
      branchId: params.branchId,
      serviceStart,
      serviceEnd,
      ignoreBookingId: params.ignoreBookingId,
    });
    if (fit.ok) {
      return {
        ok: true,
        assignedCoachId: candidateCoachId,
        service: normalizedService,
        bookingSettings,
        occupiedStartsAt: fit.occupiedStart.toISOString(),
        occupiedEndsAt: fit.occupiedEnd.toISOString(),
        branch,
      };
    }
  }

  return {
    ok: false,
    code: "THERAPIST_UNAVAILABLE",
    message: "This time has just become unavailable. Please choose another slot.",
  };
}

export function mapBookingConflictError(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return null;
  const message = error.message || "";
  if (error.code === "23P01" || message.includes("bookings_coach_occupancy_excl")) {
    return {
      code: "THERAPIST_CONFLICT",
      message: "This time has just been booked. Please choose another slot.",
    };
  }
  return null;
}
