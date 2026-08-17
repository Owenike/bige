export const COURSE_FEE_FORMULA_VERSION = "bige-course-fee-2026-08-v1";

export type PerformanceEmploymentType = "full_time" | "part_time";

export type CourseFeeTier = {
  salesThreshold: number;
  sessionThreshold: number | null;
  sessionRate: number;
};

export const FULL_TIME_COURSE_FEE_TIERS: readonly CourseFeeTier[] = [
  { salesThreshold: 0, sessionThreshold: 0, sessionRate: 250 },
  { salesThreshold: 200_000, sessionThreshold: 110, sessionRate: 280 },
  { salesThreshold: 250_000, sessionThreshold: 120, sessionRate: 360 },
  { salesThreshold: 300_000, sessionThreshold: 130, sessionRate: 455 },
  { salesThreshold: 350_000, sessionThreshold: 140, sessionRate: 520 },
] as const;

export const PART_TIME_COURSE_FEE_TIERS: readonly CourseFeeTier[] = [
  { salesThreshold: 0, sessionThreshold: null, sessionRate: 250 },
  { salesThreshold: 200_000, sessionThreshold: null, sessionRate: 280 },
  { salesThreshold: 250_000, sessionThreshold: null, sessionRate: 360 },
  { salesThreshold: 300_000, sessionThreshold: null, sessionRate: 455 },
  { salesThreshold: 350_000, sessionThreshold: null, sessionRate: 520 },
] as const;

export function courseFeeTiers(employmentType: PerformanceEmploymentType) {
  return employmentType === "part_time"
    ? PART_TIME_COURSE_FEE_TIERS
    : FULL_TIME_COURSE_FEE_TIERS;
}

export function resolveCourseFeeTier(params: {
  employmentType: PerformanceEmploymentType;
  salesAmount: number;
  completedSessions: number;
}) {
  const salesAmount = Number.isFinite(params.salesAmount)
    ? params.salesAmount
    : 0;
  const completedSessions = Math.max(0, Math.floor(params.completedSessions));
  const tiers = courseFeeTiers(params.employmentType);
  let achieved = tiers[0];
  for (const tier of tiers) {
    const meetsSales = salesAmount >= tier.salesThreshold;
    const meetsSessions =
      tier.sessionThreshold === null ||
      completedSessions >= tier.sessionThreshold;
    if (meetsSales && meetsSessions) achieved = tier;
  }
  const next = tiers.find((tier) => tier.sessionRate > achieved.sessionRate) || null;
  return {
    formulaVersion: COURSE_FEE_FORMULA_VERSION,
    salesAmount,
    completedSessions,
    sessionRate: achieved.sessionRate,
    courseFeeAmount: completedSessions * achieved.sessionRate,
    achievedTier: achieved,
    nextTier: next,
    salesRemaining: next
      ? Math.max(0, next.salesThreshold - salesAmount)
      : 0,
    sessionsRemaining:
      next?.sessionThreshold === null || next === null
        ? 0
        : Math.max(0, next.sessionThreshold - completedSessions),
  };
}

export function taiwanBusinessDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function performanceMonthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月份格式錯誤");
  const [year, monthNumber] = month.split("-").map(Number);
  const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const start = `${month}-01`;
  const end = `${month}-${String(endDay).padStart(2, "0")}`;
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1));
  const next = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return {
    start,
    end,
    startIso: `${start}T00:00:00+08:00`,
    nextIso: `${next}T00:00:00+08:00`,
  };
}
