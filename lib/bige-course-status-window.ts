const COURSE_STATUS_WINDOW_MINUTES = 30;

const COURSE_STATUS_WINDOW_EXEMPT_ROLES = new Set([
  "platform_admin",
  "manager",
  "branch_manager",
  "store_owner",
  "store_manager",
]);

const COURSE_STATUS_WINDOW_EXEMPT_POSITIONS = new Set([
  "general_affairs_assistant_manager",
  "general_affairs_manager",
  "coach_assistant_manager",
  "coach_manager",
  "coach_city_manager",
]);

const COURSE_CANCELLATION_ANYTIME_EMPLOYEE_NUMBERS = new Set(["E000006"]);
const COURSE_CANCELLATION_ANYTIME_ROLES = new Set(["supervisor"]);

function normalizeCancellationEmployeeNumber(value?: string | null) {
  const normalized = String(value || "").trim().toUpperCase();
  if (/^\d{1,6}$/.test(normalized)) {
    return `E${normalized.padStart(6, "0")}`;
  }
  return normalized;
}

export function isBigeCourseStatusWindowExempt(identity: {
  role?: string | null;
  position?: string | null;
}) {
  return (
    COURSE_STATUS_WINDOW_EXEMPT_ROLES.has(identity.role || "") ||
    COURSE_STATUS_WINDOW_EXEMPT_POSITIONS.has(identity.position || "")
  );
}

export function canCancelBigeCourseAnytime(identity: {
  role?: string | null;
  position?: string | null;
  employeeNumber?: string | null;
}) {
  return (
    isBigeCourseStatusWindowExempt(identity) ||
    COURSE_CANCELLATION_ANYTIME_ROLES.has(identity.role || "") ||
    COURSE_CANCELLATION_ANYTIME_EMPLOYEE_NUMBERS.has(
      normalizeCancellationEmployeeNumber(identity.employeeNumber),
    )
  );
}

export function getBigeCourseStatusWindow(input: {
  startsAt: string;
  endsAt: string;
  now?: number;
}) {
  const startsAt = new Date(input.startsAt).getTime();
  const endsAt = new Date(input.endsAt).getTime();
  const earliest = startsAt - COURSE_STATUS_WINDOW_MINUTES * 60_000;
  const latest = endsAt + COURSE_STATUS_WINDOW_MINUTES * 60_000;
  const now = input.now ?? Date.now();

  return {
    allowed:
      Number.isFinite(startsAt) &&
      Number.isFinite(endsAt) &&
      now >= earliest &&
      now <= latest,
    earliest,
    latest,
  };
}

export const BIGE_COURSE_STATUS_WINDOW_MINUTES = COURSE_STATUS_WINDOW_MINUTES;
