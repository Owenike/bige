"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type StudentCheckInHistoryMode = "autonomous" | "drop_in";

type StudentCheckInHistoryEntry = {
  id: string;
  requestedAt: string | null;
  approvedAt: string | null;
  checkedInAt: string;
  dailySequence: number | null;
  monthSequence: number | null;
  useSequence: number | null;
  priceTwd?: number | null;
  entryPlan?: "review_50" | "standard_100" | null;
};

type StudentCheckInHistoryResponse = {
  ok?: boolean;
  history?: StudentCheckInHistoryEntry[];
  error?: string;
};

function formatHistoryDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value)).replaceAll("-", "/");
}

function formatHistoryWeekday(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    weekday: "long",
  }).format(new Date(value));
}

function formatHistoryClock(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value)).replace(/(上午|下午)/, "$1 ");
}

function formatHistoryMonth(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(value)).replace("-", "/");
}

function HistoryTimestamp({ value }: { value: string | null }) {
  if (!value) return <span className="studentCheckInHistoryMissing">未記錄</span>;
  return (
    <time dateTime={value}>
      <b>{formatHistoryDay(value)}</b>
      <strong>{formatHistoryClock(value)}</strong>
    </time>
  );
}

function sequenceLabel(mode: StudentCheckInHistoryMode, entry: StudentCheckInHistoryEntry) {
  if (mode === "drop_in") {
    const price = entry.priceTwd ? `NT$${entry.priceTwd}` : "訪客";
    return entry.useSequence ? `${price}・第 ${entry.useSequence} 次入場` : `${price} 入場`;
  }
  const daily = entry.dailySequence ? `當日第 ${entry.dailySequence} 次` : "";
  const monthly = entry.monthSequence ? `本月第 ${entry.monthSequence} 次` : "";
  return [daily, monthly].filter(Boolean).join("・") || "自主訓練";
}

export function StudentCheckInHistory({
  mode,
  studentId,
  returnTo,
}: {
  mode: StudentCheckInHistoryMode;
  studentId: string;
  returnTo: string;
}) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [history, setHistory] = useState<StudentCheckInHistoryEntry[]>([]);
  const [error, setError] = useState("");
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const monthlyHistory = useMemo(() => {
    const months = new Map<string, StudentCheckInHistoryEntry[]>();
    for (const entry of history) {
      const month = formatHistoryMonth(entry.checkedInAt);
      const monthEntries = months.get(month);
      if (monthEntries) monthEntries.push(entry);
      else months.set(month, [entry]);
    }
    return Array.from(months, ([month, entries]) => ({ month, entries }));
  }, [history]);

  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      setOpenMonth(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || hasLoaded) return;
    const controller = new AbortController();

    async function loadHistory() {
      setIsLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ mode });
        const response = await fetch(
          `/api/admin/student-check-ins/students/${encodeURIComponent(studentId)}/history?${params.toString()}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (response.status === 401) {
          const loginUrl = new URL("/admin/student-check-ins/login", window.location.origin);
          loginUrl.searchParams.set("returnTo", returnTo);
          window.location.replace(loginUrl.toString());
          return;
        }
        const payload = (await response.json().catch(() => null)) as StudentCheckInHistoryResponse | null;
        if (!response.ok || !payload?.ok) {
          setError(response.status === 403 ? "此帳號沒有查看歷史記錄的權限。" : "歷史記錄載入失敗，請稍後再試。");
          return;
        }
        setHistory(payload.history || []);
        setHasLoaded(true);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError("網路連線不穩定，無法載入歷史記錄。");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadHistory();
    return () => controller.abort();
  }, [hasLoaded, isOpen, loadAttempt, mode, returnTo, studentId]);

  return (
    <div className="studentCheckInHistory">
      <button
        ref={triggerRef}
        className="studentCheckInHistoryToggle"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setIsOpen(true)}
      >
        <span>歷史記錄</span>
        <em>{hasLoaded ? `${history.length} 筆` : "查看"}</em>
      </button>

      {isOpen && typeof document !== "undefined" ? createPortal(
        <div
          className="studentCheckInHistoryModalBackdrop"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            setIsOpen(false);
            setOpenMonth(null);
          }}
        >
          <section
            className="studentCheckInHistoryPanel"
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${panelId}-title`}
          >
            <header>
              <div>
                <h3 id={`${panelId}-title`}>入場歷史記錄</h3>
                <p>先選擇月份，再查看該月每次申請與放行時間</p>
              </div>
              <div className="studentCheckInHistoryDialogActions">
                {hasLoaded ? <strong>{history.length} 筆</strong> : null}
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="關閉歷史記錄"
                  onClick={() => {
                    setIsOpen(false);
                    setOpenMonth(null);
                  }}
                >
                  ×
                </button>
              </div>
            </header>

            <div className="studentCheckInHistoryBody">
              {isLoading ? <div className="studentCheckInHistoryStatus">正在載入歷史記錄…</div> : null}
              {error ? (
                <div className="studentCheckInHistoryStatus is-error">
                  <span>{error}</span>
                  <button type="button" onClick={() => { setError(""); setLoadAttempt((current) => current + 1); }}>重新載入</button>
                </div>
              ) : null}
              {!isLoading && !error && hasLoaded && history.length === 0 ? (
                <div className="studentCheckInHistoryStatus">目前沒有已放行的歷史記錄。</div>
              ) : null}

              {!isLoading && !error && monthlyHistory.length > 0 ? (
                <div className="studentCheckInHistoryMonths">
                  {monthlyHistory.map(({ month, entries }, monthIndex) => {
                    const isMonthOpen = openMonth === month;
                    const monthPanelId = `${panelId}-month-${monthIndex}`;
                    return (
                      <section className="studentCheckInHistoryMonth" key={month}>
                        <button
                          className="studentCheckInHistoryMonthToggle"
                          type="button"
                          aria-expanded={isMonthOpen}
                          aria-controls={monthPanelId}
                          onClick={() => setOpenMonth((current) => current === month ? null : month)}
                        >
                          <span>
                            <strong>{month}</strong>
                            <em>本月 {entries.length} 次{mode === "autonomous" ? "運動" : "入場"}</em>
                          </span>
                          <i aria-hidden="true">{isMonthOpen ? "收起" : "查看"}</i>
                        </button>

                        {isMonthOpen ? (
                          <div className="studentCheckInHistoryList studentCheckInHistoryMonthEntries" id={monthPanelId}>
                            {entries.map((entry) => (
                              <article key={entry.id}>
                                <header>
                                  <div className="studentCheckInHistoryDate">
                                    <time dateTime={entry.checkedInAt}>{formatHistoryDay(entry.checkedInAt)}</time>
                                    <small>{formatHistoryWeekday(entry.checkedInAt)}</small>
                                  </div>
                                  <span>{sequenceLabel(mode, entry)}</span>
                                </header>
                                <div className="studentCheckInHistoryEvents">
                                  <div>
                                    <i className="is-request" aria-hidden="true">1</i>
                                    <span>會員送出放行申請</span>
                                    <HistoryTimestamp value={entry.requestedAt} />
                                  </div>
                                  <div>
                                    <i className="is-approved" aria-hidden="true">2</i>
                                    <span>控制端人員按下放行</span>
                                    <HistoryTimestamp value={entry.approvedAt} />
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <p className="studentCheckInHistoryTimezone">以上時間皆為台灣時間（Asia/Taipei）</p>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
