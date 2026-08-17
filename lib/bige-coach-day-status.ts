export type BigeCoachDayStatusValue = "early" | "late" | "off";

export type BigeCoachDayStatus = {
  coach_id: string;
  status: BigeCoachDayStatusValue;
  label: "早班" | "晚班" | "休假";
};

type CoachDayStatusNote = {
  coach_id: string;
  content?: unknown;
};

const COACH_DAY_STATUS_BY_MARKER: Record<string, BigeCoachDayStatusValue> = {
  早: "early",
  晚: "late",
  休: "off",
};

const COACH_DAY_STATUS_LABELS: Record<
  BigeCoachDayStatusValue,
  BigeCoachDayStatus["label"]
> = {
  early: "早班",
  late: "晚班",
  off: "休假",
};

const SHIFT_RANGE_PATTERN = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/;

export function readCoachDayStatusMarker(content: unknown): BigeCoachDayStatusValue | null {
  return COACH_DAY_STATUS_BY_MARKER[String(content ?? "").trim()] || null;
}

export function readCoachShiftRangeStatus(content: unknown): Exclude<BigeCoachDayStatusValue, "off"> | null {
  const match = String(content ?? "").trim().match(SHIFT_RANGE_PATTERN);
  if (!match) return null;
  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  if (
    startHour > 23 ||
    endHour > 23 ||
    startMinute > 59 ||
    endMinute > 59 ||
    startHour * 60 + startMinute >= endHour * 60 + endMinute
  ) {
    return null;
  }

  // BIG E's 12:00–21:00 Wednesday shift is still an early shift. Only
  // shifts beginning at 13:00 or later belong to the late/middle group.
  return startHour * 60 + startMinute < 13 * 60 ? "early" : "late";
}

export function collectCoachDayStatuses(
  notes: readonly CoachDayStatusNote[],
  activeCoachIds: ReadonlySet<string>,
): BigeCoachDayStatus[] {
  const byCoach = new Map<
    string,
    { status: BigeCoachDayStatusValue; priority: number }
  >();

  for (const note of notes) {
    if (!activeCoachIds.has(note.coach_id)) continue;
    const markerStatus = readCoachDayStatusMarker(note.content);
    const shiftStatus = readCoachShiftRangeStatus(note.content);
    if (!markerStatus && !shiftStatus) continue;

    const status = shiftStatus || markerStatus!;
    const priority = shiftStatus ? 2 : status === "off" ? 1 : 3;
    const current = byCoach.get(note.coach_id);
    if (!current || priority > current.priority) {
      byCoach.set(note.coach_id, { status, priority });
    }
  }

  return [...byCoach.entries()].map(([coach_id, value]) => ({
    coach_id,
    status: value.status,
    label: COACH_DAY_STATUS_LABELS[value.status],
  }));
}
