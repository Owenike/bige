import type { BigeCourseType } from "./bige-fitness";

export type BigeMonthlyDateTimes = Record<string, string>;
export type BigeMonthlyDateCourseTypes = Record<string, BigeCourseType>;

export function assignBigeMonthlyDateTimes(
  current: BigeMonthlyDateTimes,
  dates: string[],
  time: string,
) {
  let changed = false;
  const next = { ...current };
  for (const date of dates) {
    if (next[date]) continue;
    next[date] = time;
    changed = true;
  }
  return changed ? next : current;
}

export function removeBigeMonthlyDateTime(
  current: BigeMonthlyDateTimes,
  date: string,
) {
  if (!current[date]) return current;
  const next = { ...current };
  delete next[date];
  return next;
}

export function retainBigeMonthlyDateTimes(
  current: BigeMonthlyDateTimes,
  dates: string[],
) {
  const retainedDates = new Set(dates);
  return Object.fromEntries(
    Object.entries(current).filter(([date]) => retainedDates.has(date)),
  );
}

export function assignBigeMonthlyDateCourseTypes(
  current: BigeMonthlyDateCourseTypes,
  dates: string[],
  courseType: BigeCourseType,
) {
  let changed = false;
  const next = { ...current };
  for (const date of dates) {
    if (next[date]) continue;
    next[date] = courseType;
    changed = true;
  }
  return changed ? next : current;
}

export function removeBigeMonthlyDateCourseType(
  current: BigeMonthlyDateCourseTypes,
  date: string,
) {
  if (!current[date]) return current;
  const next = { ...current };
  delete next[date];
  return next;
}

export function retainBigeMonthlyDateCourseTypes(
  current: BigeMonthlyDateCourseTypes,
  dates: string[],
) {
  const retainedDates = new Set(dates);
  return Object.fromEntries(
    Object.entries(current).filter(([date]) => retainedDates.has(date)),
  ) as BigeMonthlyDateCourseTypes;
}
