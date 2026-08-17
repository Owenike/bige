export const BIGE_DRAGGABLE_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "booked",
] as const;

export const BIGE_ACTIVE_SCHEDULE_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "booked",
  "checked_in",
] as const;

export const BIGE_SCHEDULE_TRASH_DELETE_REASON = "schedule_trash_deleted";

export type ScheduleDragBooking = {
  id: string;
  coach_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  course_type?: string;
};

export type ScheduleDragNote = {
  id: string;
  coach_id: string;
  starts_at: string;
  ends_at: string;
  content?: string | null;
  system_kind?: string | null;
  source_booking_ids?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type ScheduleMoveMode = "move" | "swap" | "overwrite";

export type ScheduleMoveResultItem = {
  id: string;
  coachId: string;
  startsAt: string;
  endsAt: string;
  status: string;
};

export type ScheduleFaAssistantToConflict = {
  coach_id: string;
  starts_at: string;
  source_booking_ids: string[];
  message: string;
};

export type ScheduleAssistantCoach = {
  id: string;
  branch_id?: string | null;
  department?: string | null;
  position?: string | null;
};

export type ScheduleDropPlan<TBooking extends ScheduleDragBooking> = {
  source: TBooking;
  sourceItems: TBooking[];
  targetItems: TBooking[];
  targetCoachId: string;
  targetStartsAt: string;
  spanMinutes: number;
};

export type ScheduleDropAnalysis<TBooking extends ScheduleDragBooking> =
  | { ok: true; plan: ScheduleDropPlan<TBooking> }
  | {
      ok: false;
      code:
        | "booking_not_found"
        | "booking_locked"
        | "same_slot"
        | "same_day_only"
        | "alignment_mismatch"
        | "outside_day"
        | "note_blocked";
      message: string;
    };

const taipeiPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function taipeiParts(value: string) {
  const parts = taipeiPartsFormatter.formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  return {
    year,
    month,
    day,
    hour: read("hour"),
    minute: read("minute"),
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function durationMs(item: Pick<ScheduleDragBooking, "starts_at" | "ends_at">) {
  return Math.max(0, new Date(item.ends_at).getTime() - new Date(item.starts_at).getTime());
}

function overlaps(
  item: Pick<ScheduleDragNote, "starts_at" | "ends_at">,
  startsAtMs: number,
  endsAtMs: number,
) {
  return new Date(item.starts_at).getTime() < endsAtMs &&
    new Date(item.ends_at).getTime() > startsAtMs;
}

export function findScheduleEditConflict<
  TBooking extends ScheduleDragBooking,
  TNote extends ScheduleDragNote,
>(params: {
  bookings: TBooking[];
  notes: TNote[];
  coachId: string;
  startsAt: string;
  endsAt: string;
  excludeBookingId?: string;
  excludeNoteId?: string;
}):
  | { kind: "booking"; item: TBooking }
  | { kind: "note"; item: TNote }
  | null {
  const startsAtMs = new Date(params.startsAt).getTime();
  const endsAtMs = new Date(params.endsAt).getTime();
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs) {
    return null;
  }

  const booking = params.bookings
    .filter(
      (item) =>
        item.id !== params.excludeBookingId &&
        item.coach_id === params.coachId &&
        (BIGE_ACTIVE_SCHEDULE_BOOKING_STATUSES as readonly string[]).includes(item.status) &&
        overlaps(item, startsAtMs, endsAtMs),
    )
    .sort(
      (first, second) =>
        new Date(first.starts_at).getTime() - new Date(second.starts_at).getTime(),
    )[0];
  if (booking) return { kind: "booking", item: booking };

  const note = params.notes
    .filter(
      (item) =>
        item.id !== params.excludeNoteId &&
        item.coach_id === params.coachId &&
        overlaps(item, startsAtMs, endsAtMs),
    )
    .sort(
      (first, second) =>
        new Date(first.starts_at).getTime() - new Date(second.starts_at).getTime(),
    )[0];
  return note ? { kind: "note", item: note } : null;
}

export function isScheduleBookingDraggable(booking: Pick<ScheduleDragBooking, "status">) {
  return (BIGE_DRAGGABLE_BOOKING_STATUSES as readonly string[]).includes(booking.status);
}

export function isScheduleTrashDeletedBooking(booking: {
  status?: string | null;
  status_reason?: string | null;
}) {
  return (
    booking.status === "cancelled" &&
    booking.status_reason === BIGE_SCHEDULE_TRASH_DELETE_REASON
  );
}

const LEGACY_SHIFT_MARKERS = new Set(["早", "晚", "休"]);

export function isScheduleDragBlockingNote(note: ScheduleDragNote) {
  if (note.system_kind === "fa_assistant_to") return false;
  return !LEGACY_SHIFT_MARKERS.has((note.content || "").trim());
}

export async function runOptimisticScheduleMutation<TResult>(params: {
  apply: () => void;
  request: () => Promise<TResult>;
  commit?: (result: TResult) => void;
  rollback: (error: unknown) => void;
}) {
  params.apply();
  try {
    const result = await params.request();
    params.commit?.(result);
    return result;
  } catch (error) {
    params.rollback(error);
    throw error;
  }
}

export function buildOptimisticScheduleMoveResult<TBooking extends ScheduleDragBooking>(
  plan: ScheduleDropPlan<TBooking>,
  mode: ScheduleMoveMode,
): ScheduleMoveResultItem[] {
  const sourceAnchorMs = new Date(plan.source.starts_at).getTime();
  const targetAnchorMs = new Date(plan.targetStartsAt).getTime();
  const shift = (item: TBooking, coachId: string, deltaMs: number): ScheduleMoveResultItem => ({
    id: item.id,
    coachId,
    startsAt: new Date(new Date(item.starts_at).getTime() + deltaMs).toISOString(),
    endsAt: new Date(new Date(item.ends_at).getTime() + deltaMs).toISOString(),
    status: item.status,
  });

  const sourceItems = plan.sourceItems.map((item) =>
    shift(item, plan.targetCoachId, targetAnchorMs - sourceAnchorMs),
  );
  if (mode === "swap") {
    return [
      ...sourceItems,
      ...plan.targetItems.map((item) =>
        shift(item, plan.source.coach_id, sourceAnchorMs - targetAnchorMs),
      ),
    ];
  }
  if (mode === "overwrite") {
    return [
      ...sourceItems,
      ...plan.targetItems.map((item) => ({
        id: item.id,
        coachId: item.coach_id,
        startsAt: item.starts_at,
        endsAt: item.ends_at,
        status: "cancelled",
      })),
    ];
  }
  return sourceItems;
}

export function applyScheduleMoveResult<TBooking extends ScheduleDragBooking>(
  bookings: TBooking[],
  items: ScheduleMoveResultItem[],
) {
  const changed = new Map(items.map((item) => [item.id, item]));

  return bookings.flatMap((booking) => {
    const item = changed.get(booking.id);
    if (!item) return [booking];
    if (item.status === "cancelled") return [];

    return [
      {
        ...booking,
        coach_id: item.coachId,
        starts_at: item.startsAt,
        ends_at: item.endsAt,
        status: item.status,
      },
    ];
  });
}

export function applyOptimisticFaAssistantToNotes<TNote extends ScheduleDragNote>(
  notes: TNote[],
  items: ScheduleMoveResultItem[],
) {
  const changedBookings = new Map(items.map((item) => [item.id, item]));
  if (changedBookings.size === 0) return notes;

  const regularNotes = notes.filter((note) => note.system_kind !== "fa_assistant_to");
  const generatedNotes = notes.filter((note) => note.system_kind === "fa_assistant_to");
  const groups = new Map<
    string,
    {
      coachId: string;
      startsAt: string;
      endsAt: string;
      sourceBookingIds: string[];
      template: TNote;
    }
  >();

  const addSource = (params: {
    coachId: string;
    startsAt: string;
    endsAt: string;
    sourceBookingId: string;
    template: TNote;
  }) => {
    const startsAtMs = new Date(params.startsAt).getTime();
    const key = `${params.coachId}|${startsAtMs}`;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.sourceBookingIds.includes(params.sourceBookingId)) {
        existing.sourceBookingIds.push(params.sourceBookingId);
      }
      return;
    }
    groups.set(key, {
      coachId: params.coachId,
      startsAt: new Date(startsAtMs).toISOString(),
      endsAt: new Date(params.endsAt).toISOString(),
      sourceBookingIds: [params.sourceBookingId],
      template: params.template,
    });
  };

  for (const note of generatedNotes) {
    const sourceBookingIds = note.source_booking_ids || [];
    if (sourceBookingIds.length === 0) {
      regularNotes.push(note);
      continue;
    }

    for (const sourceBookingId of sourceBookingIds) {
      const changed = changedBookings.get(sourceBookingId);
      if (!changed) {
        addSource({
          coachId: note.coach_id,
          startsAt: note.starts_at,
          endsAt: note.ends_at,
          sourceBookingId,
          template: note,
        });
        continue;
      }
      if (changed.status === "cancelled" || changed.coachId === note.coach_id) continue;

      const startsAtMs = new Date(changed.startsAt).getTime() + 60 * 60_000;
      addSource({
        coachId: note.coach_id,
        startsAt: new Date(startsAtMs).toISOString(),
        endsAt: new Date(startsAtMs + 60 * 60_000).toISOString(),
        sourceBookingId,
        template: note,
      });
    }
  }

  const optimisticNotes = [...groups.values()].map((group) => ({
    ...group.template,
    id:
      new Date(group.template.starts_at).getTime() === new Date(group.startsAt).getTime()
        ? group.template.id
        : `optimistic-fa-to:${group.coachId}:${new Date(group.startsAt).getTime()}`,
    coach_id: group.coachId,
    starts_at: group.startsAt,
    ends_at: group.endsAt,
    source_booking_ids: group.sourceBookingIds,
    metadata: {
      ...(group.template.metadata || {}),
      sourceCount: group.sourceBookingIds.length,
    },
  })) as TNote[];

  return [...regularNotes, ...optimisticNotes];
}

const ACTIVE_FA_TO_STATUSES = new Set(["pending", "confirmed", "booked", "checked_in"]);

export function buildOptimisticFaAssistantToState<
  TBooking extends ScheduleDragBooking & {
    branch_id?: string | null;
    operation_kind?: string | null;
  },
  TNote extends ScheduleDragNote,
>(params: {
  bookings: TBooking[];
  notes: TNote[];
  coaches: ScheduleAssistantCoach[];
  offCoachIds?: string[];
}): { notes: TNote[]; conflicts: ScheduleFaAssistantToConflict[] } {
  const activeBookings = params.bookings.filter((booking) =>
    ACTIVE_FA_TO_STATUSES.has(String(booking.status || "").toLowerCase()),
  );
  const regularNotes = params.notes.filter((note) => note.system_kind !== "fa_assistant_to");
  const generatedTemplates = params.notes.filter(
    (note) => note.system_kind === "fa_assistant_to",
  );
  const assistantManagers = params.coaches.filter(
    (coach) =>
      coach.department === "coaching" && coach.position === "coach_assistant_manager",
  );
  const offCoachIds = new Set(params.offCoachIds || []);
  const groupedSources = new Map<
    string,
    { assistant: ScheduleAssistantCoach; startsAt: string; sourceBookingIds: string[] }
  >();

  for (const booking of activeBookings) {
    if (booking.operation_kind !== "trial") continue;
    const assistant = booking.branch_id
      ? assistantManagers.find((coach) => coach.branch_id === booking.branch_id) ||
        assistantManagers.find((coach) => !coach.branch_id)
      : assistantManagers.find((coach) => !coach.branch_id);
    if (!assistant || assistant.id === booking.coach_id || offCoachIds.has(assistant.id)) continue;

    const startsAt = new Date(new Date(booking.starts_at).getTime() + 60 * 60_000).toISOString();
    const key = `${assistant.id}|${startsAt}`;
    const existing = groupedSources.get(key);
    if (existing) {
      existing.sourceBookingIds.push(booking.id);
    } else {
      groupedSources.set(key, {
        assistant,
        startsAt,
        sourceBookingIds: [booking.id],
      });
    }
  }

  const optimisticNotes: TNote[] = [];
  const conflicts: ScheduleFaAssistantToConflict[] = [];
  for (const group of groupedSources.values()) {
    const startsAtMs = new Date(group.startsAt).getTime();
    const endsAtMs = startsAtMs + 60 * 60_000;
    const manualToSatisfiesSlot = regularNotes.some(
      (note) =>
        note.coach_id === group.assistant.id &&
        !note.system_kind &&
        (note.content || "").trim().toUpperCase() === "TO" &&
        overlaps(note, startsAtMs, endsAtMs),
    );
    if (manualToSatisfiesSlot) continue;

    const hasBookingConflict = activeBookings.some(
      (booking) =>
        booking.coach_id === group.assistant.id && overlaps(booking, startsAtMs, endsAtMs),
    );
    const hasManualNoteConflict = regularNotes.some((note) => {
      const content = (note.content || "").trim();
      return (
        note.coach_id === group.assistant.id &&
        !note.system_kind &&
        content.toUpperCase() !== "TO" &&
        !LEGACY_SHIFT_MARKERS.has(content) &&
        overlaps(note, startsAtMs, endsAtMs)
      );
    });

    if (hasBookingConflict || hasManualNoteConflict) {
      conflicts.push({
        coach_id: group.assistant.id,
        starts_at: group.startsAt,
        source_booking_ids: [...group.sourceBookingIds],
        message: "FA 第二小時需要 TO，但此時段已有正式安排",
      });
      continue;
    }

    const template = generatedTemplates.find(
      (note) =>
        note.coach_id === group.assistant.id &&
        new Date(note.starts_at).getTime() === startsAtMs,
    );
    optimisticNotes.push({
      ...(template || {}),
      id: template?.id || `optimistic-fa-to:${group.assistant.id}:${startsAtMs}`,
      coach_id: group.assistant.id,
      starts_at: group.startsAt,
      ends_at: new Date(endsAtMs).toISOString(),
      content: "TO",
      system_kind: "fa_assistant_to",
      source_booking_ids: [...group.sourceBookingIds],
      metadata: {
        ...(template?.metadata || {}),
        reason: "fa_second_hour",
        sourceCount: group.sourceBookingIds.length,
      },
    } as unknown as TNote);
  }

  return { notes: [...regularNotes, ...optimisticNotes], conflicts };
}

export function analyzeScheduleDrop<TBooking extends ScheduleDragBooking>(params: {
  bookings: TBooking[];
  notes: ScheduleDragNote[];
  sourceBookingId: string;
  targetCoachId: string;
  targetStartsAt: string;
}): ScheduleDropAnalysis<TBooking> {
  const source = params.bookings.find((booking) => booking.id === params.sourceBookingId);
  if (!source) {
    return { ok: false, code: "booking_not_found", message: "找不到要移動的課程" };
  }
  if (!isScheduleBookingDraggable(source)) {
    return {
      ok: false,
      code: "booking_locked",
      message: "已完成、已取消、已報到或已核銷的課程不能拖拉",
    };
  }

  const requestedTargetMs = new Date(params.targetStartsAt).getTime();
  const targetPrimary = params.bookings.find(
    (booking) =>
      booking.id !== source.id &&
      booking.coach_id === params.targetCoachId &&
      requestedTargetMs >= new Date(booking.starts_at).getTime() &&
      requestedTargetMs < new Date(booking.ends_at).getTime(),
  );
  const targetStartsAt = targetPrimary?.starts_at || params.targetStartsAt;
  const sourceMs = new Date(source.starts_at).getTime();
  const targetMs = new Date(targetStartsAt).getTime();

  if (source.coach_id === params.targetCoachId && sourceMs === targetMs) {
    return { ok: false, code: "same_slot", message: "課程已經在這個時段" };
  }

  const sourceParts = taipeiParts(source.starts_at);
  const targetParts = taipeiParts(targetStartsAt);
  if (sourceParts.date !== targetParts.date) {
    return { ok: false, code: "same_day_only", message: "目前只支援同一天內拖拉" };
  }
  if (sourceParts.minute !== targetParts.minute) {
    return {
      ok: false,
      code: "alignment_mismatch",
      message: "整點課程只能移到整點，半點課程只能移到半點",
    };
  }

  let spanMs = Math.max(durationMs(source), targetPrimary ? durationMs(targetPrimary) : 0);
  let sourceItems: TBooking[] = [];
  let targetItems: TBooking[] = [];

  // Expand both windows until every booking starting in either window is fully
  // contained. This is what lets a two-hour FA exchange with two one-hour PTs.
  for (let attempt = 0; attempt < params.bookings.length + 2; attempt += 1) {
    const sourceEnd = sourceMs + spanMs;
    const targetEnd = targetMs + spanMs;
    sourceItems = params.bookings.filter((booking) => {
      const start = new Date(booking.starts_at).getTime();
      return booking.coach_id === source.coach_id && start >= sourceMs && start < sourceEnd;
    });
    const sourceIds = new Set(sourceItems.map((booking) => booking.id));
    targetItems = params.bookings.filter((booking) => {
      const start = new Date(booking.starts_at).getTime();
      return (
        booking.coach_id === params.targetCoachId &&
        start >= targetMs &&
        start < targetEnd &&
        !sourceIds.has(booking.id)
      );
    });
    const expandedSpan = Math.max(
      spanMs,
      ...sourceItems.map((booking) => new Date(booking.ends_at).getTime() - sourceMs),
      ...targetItems.map((booking) => new Date(booking.ends_at).getTime() - targetMs),
    );
    if (expandedSpan <= spanMs) break;
    spanMs = expandedSpan;
  }

  if ([...sourceItems, ...targetItems].some((booking) => !isScheduleBookingDraggable(booking))) {
    return {
      ok: false,
      code: "booking_locked",
      message: "交換範圍含有已完成、已取消、已報到或已核銷的課程，無法拖拉",
    };
  }

  const sourceEnd = sourceMs + spanMs;
  const targetEnd = targetMs + spanMs;
  if (
    params.notes.some(
      (note) =>
        isScheduleDragBlockingNote(note) &&
        ((note.coach_id === source.coach_id && overlaps(note, sourceMs, sourceEnd)) ||
          (note.coach_id === params.targetCoachId && overlaps(note, targetMs, targetEnd))),
    )
  ) {
    return {
      ok: false,
      code: "note_blocked",
      message: "自由文字不能拖拉、交換或覆蓋，請直接點擊原資料編輯",
    };
  }

  const dayEndMs = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day, 16);
  if (targetParts.hour < 9 || targetEnd > dayEndMs || sourceEnd > dayEndMs) {
    return {
      ok: false,
      code: "outside_day",
      message: "拖拉後的課程會超出當天 09:00–24:00 的課表範圍",
    };
  }

  return {
    ok: true,
    plan: {
      source,
      sourceItems,
      targetItems,
      targetCoachId: params.targetCoachId,
      targetStartsAt,
      spanMinutes: spanMs / 60_000,
    },
  };
}
