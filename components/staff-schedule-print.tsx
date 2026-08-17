"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../app/manager/staff-scheduling/print/page.module.css";

type State = {
  monthStart: string;
  version: null | { version_number: number; status: string };
  employees: Array<{
    id: string;
    displayName: string;
    employeeNumber: string | null;
  }>;
  scheduleEntries: Array<{
    employeeId: string;
    workDate: string;
    entryKind: string;
    shiftLabel: string | null;
    startsAt: string | null;
    endsAt: string | null;
    offKind: string | null;
  }>;
};
const OFF: Record<string, string> = {
  regular_day_off: "例假",
  rest_day: "休息日",
  facility_closure: "館休",
  preferred_off: "自選休假",
  national_holiday: "國定假日",
  holiday_adjustment: "國定假日調休",
  annual_leave: "特休",
  sick_leave: "病假",
  personal_leave: "事假",
  family_care_leave: "家庭照顧假",
  marriage_leave: "婚假",
  bereavement_leave: "喪假",
  official_leave: "公假",
  other_leave: "其他假",
};

export default function StaffSchedulePrint({ month }: { month: string }) {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch(`/api/staff-scheduling?month=${month}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok)
          throw new Error(payload.message || "讀取失敗");
        setData(payload.data);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "讀取失敗"),
      );
  }, [month]);
  const dates = useMemo(
    () =>
      Array.from(
        new Set((data?.scheduleEntries || []).map((entry) => entry.workDate)),
      ).sort(),
    [data?.scheduleEntries],
  );
  const entryMap = useMemo(
    () =>
      new Map(
        (data?.scheduleEntries || []).map((entry) => [
          `${entry.employeeId}:${entry.workDate}`,
          entry,
        ]),
      ),
    [data?.scheduleEntries],
  );
  if (error)
    return (
      <main className={styles.page}>
        <div className={styles.error}>{error}</div>
      </main>
    );
  if (!data) return <main className={styles.page}>正在準備列印班表…</main>;
  return (
    <main className={styles.page}>
      <div className={styles.tools}>
        <button onClick={() => window.print()}>列印／另存 PDF</button>
        <a href={`/manager/staff-scheduling?month=${month}`}>返回班表</a>
      </div>
      <header>
        <h1>巨挺健身館｜{month} 全員班表</h1>
        <p>
          版本 V{data.version?.version_number || "—"} ·{" "}
          {data.version?.status || "尚未建立"}
        </p>
      </header>
      <div className={styles.scroller}>
        <table>
          <thead>
            <tr>
              <th>員工</th>
              {dates.map((date) => (
                <th key={date}>
                  {Number(date.slice(-2))}
                  <small>
                    {
                      ["日", "一", "二", "三", "四", "五", "六"][
                        new Date(`${date}T12:00:00+08:00`).getDay()
                      ]
                    }
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.employees.map((employee) => (
              <tr key={employee.id}>
                <th>
                  {employee.displayName}
                  <small>{employee.employeeNumber}</small>
                </th>
                {dates.map((date) => {
                  const entry = entryMap.get(`${employee.id}:${date}`);
                  return (
                    <td
                      key={date}
                      className={entry?.entryKind === "off" ? styles.off : ""}
                    >
                      {entry?.entryKind === "off" ? (
                        OFF[entry.offKind || ""] || "休"
                      ) : entry ? (
                        <>
                          {entry.shiftLabel}
                          <small>
                            {entry.startsAt}–{entry.endsAt}
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer>
        本表由巨挺健身館班表系統產生 · 列印時間{" "}
        {new Intl.DateTimeFormat("zh-TW", {
          timeZone: "Asia/Taipei",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date())}
      </footer>
    </main>
  );
}
