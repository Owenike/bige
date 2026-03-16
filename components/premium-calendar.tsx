"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./premium-calendar.module.css";

type PremiumCalendarProps = {
  selectedDate: string | null;
  onSelectDate?: (date: string) => void;
  disabledDates?: string[];
  availableDates?: string[];
  minDate?: string | null;
  maxDate?: string | null;
  helperText?: string;
  actionLabel?: string;
};

type DayCell = {
  date: Date;
  iso: string;
  label: number;
  isCurrentMonth: boolean;
};

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildMonthGrid(viewDate: Date): DayCell[] {
  const first = startOfMonth(viewDate);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);
  const days: DayCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    days.push({
      date,
      iso: toIsoDate(date),
      label: date.getDate(),
      isCurrentMonth: date.getMonth() === viewDate.getMonth(),
    });
  }
  return days;
}

export function PremiumCalendar(props: PremiumCalendarProps) {
  const [viewDate, setViewDate] = useState(() => {
    if (props.selectedDate) return new Date(`${props.selectedDate}T00:00:00`);
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  useEffect(() => {
    if (!props.selectedDate) return;
    const next = new Date(`${props.selectedDate}T00:00:00`);
    if (Number.isNaN(next.getTime())) return;
    if (next.getFullYear() === viewDate.getFullYear() && next.getMonth() === viewDate.getMonth()) return;
    setViewDate(new Date(next.getFullYear(), next.getMonth(), 1));
  }, [props.selectedDate, viewDate]);

  const todayIso = toIsoDate(new Date());
  const disabledSet = useMemo(() => new Set(props.disabledDates || []), [props.disabledDates]);
  const availableSet = useMemo(
    () => (props.availableDates && props.availableDates.length > 0 ? new Set(props.availableDates) : null),
    [props.availableDates],
  );
  const monthGrid = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const title = useMemo(
    () => new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(viewDate),
    [viewDate],
  );

  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <div className={styles.title}>{title}</div>
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Previous month"
            onClick={() => setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
          >
            {"<"}
          </button>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Next month"
            onClick={() => setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
          >
            {">"}
          </button>
        </div>
      </div>

      <div className={styles.weekdays}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((item) => (
          <div key={item} className={styles.weekday}>
            {item}
          </div>
        ))}
      </div>

      <div className={styles.grid}>
        {monthGrid.map((item) => {
          const isSelected = props.selectedDate === item.iso;
          const isBeforeMin = props.minDate ? item.iso < props.minDate : false;
          const isAfterMax = props.maxDate ? item.iso > props.maxDate : false;
          const isUnavailable = availableSet ? !availableSet.has(item.iso) : false;
          const isDisabled = disabledSet.has(item.iso) || isBeforeMin || isAfterMax || isUnavailable;
          const className = [
            styles.day,
            !item.isCurrentMonth ? styles.outside : "",
            item.iso === todayIso ? styles.today : "",
            isSelected ? styles.selected : "",
            isDisabled ? styles.disabled : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={item.iso}
              type="button"
              className={className}
              disabled={isDisabled}
              onClick={() => {
                if (!isDisabled) props.onSelectDate?.(item.iso);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className={styles.footer}>
        <div className={styles.hint}>{props.helperText || "Selected dates appear as a solid black circle."}</div>
        {props.actionLabel ? <button type="button" className={styles.cta}>{props.actionLabel}</button> : null}
      </div>
    </div>
  );
}
