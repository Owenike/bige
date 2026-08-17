"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MobileSignaturePad from "./mobile-signature-pad";
import styles from "../app/staff/attendance/page.module.css";

type Anomaly = {
  id: string;
  work_date: string;
  anomaly_type: string;
  scheduled_at: string | null;
  actual_at: string | null;
  variance_minutes: number | null;
  raw_punches: string[];
};
type Item = {
  anomaly_id: string;
  staff_attendance_anomalies: Anomaly | Anomaly[];
};
type ResponsePackage = {
  id: string;
  status: string;
  statement_snapshot: string;
  signed_at: string | null;
  items: Item[];
  responses: Array<{
    anomaly_id: string;
    response: string;
    actual_work_minutes: number | null;
    explanation: string | null;
  }>;
};
type State = { month: string; responsePackages: ResponsePackage[] };
type Answer = {
  response:
    "confirm_as_shown" | "confirm_personal_activity" | "content_incorrect" | "";
  actualWorkMinutes: string;
  explanation: string;
};
const LABELS: Record<string, string> = {
  missing_in: "缺上班卡",
  missing_out: "缺下班卡",
  no_punch: "整日無打卡",
  late: "遲到",
  early_leave: "提早下班",
  late_clock_out: "晚打卡",
  off_day_punch: "休假日有打卡",
  multiple_punches: "多筆打卡",
  out_of_order: "打卡順序異常",
};
const LATE_TEXT =
  "系統偵測您於排定下班時間後打卡。本人確認下班後僅從事私人活動或自主運動，未提供勞務或待命。";
function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}
function time(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
async function parse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok)
    throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as State;
}

export default function StaffAttendanceSelfService() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<State | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(
        await parse(
          await fetch(`/api/staff-attendance?month=${month}`, {
            cache: "no-store",
          }),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);
  const pending = useMemo(
    () =>
      data?.responsePackages.find((item) => item.status === "pending") || null,
    [data],
  );
  useEffect(() => {
    if (!pending) return;
    const next: Record<string, Answer> = {};
    for (const item of pending.items) {
      const saved = pending.responses.find(
        (response) => response.anomaly_id === item.anomaly_id,
      );
      next[item.anomaly_id] = {
        response: (saved?.response as Answer["response"]) || "",
        actualWorkMinutes: saved?.actual_work_minutes
          ? String(saved.actual_work_minutes)
          : "",
        explanation: saved?.explanation || "",
      };
    }
    setAnswers(next);
    setSignature(null);
  }, [pending]);
  function update(id: string, patch: Partial<Answer>) {
    setAnswers((current) => ({
      ...current,
      [id]: {
        ...(current[id] || {
          response: "",
          actualWorkMinutes: "",
          explanation: "",
        }),
        ...patch,
      },
    }));
  }
  const complete =
    !!pending &&
    pending.items.every((item) => {
      const answer = answers[item.anomaly_id];
      return (
        !!answer?.response &&
        (answer.response !== "content_incorrect" ||
          answer.explanation.trim().length >= 2)
      );
    });
  async function submit() {
    if (!pending || !signature) return;
    setBusy(true);
    setError("");
    try {
      setData(
        await parse(
          await fetch("/api/staff-attendance", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "respond_package",
              month,
              packageId: pending.id,
              signatureDataUrl: signature,
              answers: pending.items.map((item) => ({
                anomalyId: item.anomaly_id,
                response: answers[item.anomaly_id].response,
                actualWorkMinutes: answers[item.anomaly_id].actualWorkMinutes
                  ? Number(answers[item.anomaly_id].actualWorkMinutes)
                  : null,
                explanation: answers[item.anomaly_id].explanation || null,
              })),
            }),
          }),
        ),
      );
      setNotice("所有日期已回答並完成一次手機簽名，等待主管覆核。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "送出失敗");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className={styles.page}>
        <div className={styles.empty}>正在讀取打卡異常…</div>
      </main>
    );
  return (
    <main className={styles.page}>
      <header>
        <div>
          <p>巨挺健身館 · 員工專區</p>
          <h1>我的打卡確認</h1>
          <span>同一批多個日期逐日回答，最後只簽名一次。</span>
        </div>
        <div>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <a href="/staff/schedule">我的班表</a>
        </div>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}
      {pending ? (
        <section className={styles.panel}>
          <div className={styles.intro}>
            <span>{pending.items.length} 筆</span>
            <div>
              <h2>請逐日確認</h2>
              <p>{pending.statement_snapshot}</p>
            </div>
          </div>
          <div className={styles.items}>
            {pending.items.map((item) => {
              const anomaly = one(item.staff_attendance_anomalies);
              const answer = answers[item.anomaly_id] || {
                response: "",
                actualWorkMinutes: "",
                explanation: "",
              };
              const late = anomaly.anomaly_type === "late_clock_out";
              return (
                <article key={item.anomaly_id}>
                  <header>
                    <div>
                      <strong>{anomaly.work_date}</strong>
                      <span>
                        {LABELS[anomaly.anomaly_type] || anomaly.anomaly_type}
                      </span>
                    </div>
                    <small>
                      排定 {time(anomaly.scheduled_at)}　實際{" "}
                      {time(anomaly.actual_at)}
                      {anomaly.variance_minutes
                        ? `　差 ${anomaly.variance_minutes} 分鐘`
                        : ""}
                    </small>
                  </header>
                  {late ? (
                    <div className={styles.lateText}>{LATE_TEXT}</div>
                  ) : null}
                  <label className={styles.option}>
                    <input
                      type="radio"
                      name={item.anomaly_id}
                      checked={
                        answer.response ===
                        (late
                          ? "confirm_personal_activity"
                          : "confirm_as_shown")
                      }
                      onChange={() =>
                        update(item.anomaly_id, {
                          response: late
                            ? "confirm_personal_activity"
                            : "confirm_as_shown",
                        })
                      }
                    />
                    <span>
                      {late
                        ? "確認以上內容（下班後是私人活動／自主運動）"
                        : "確認系統顯示的異常資料正確"}
                    </span>
                  </label>
                  <label className={styles.option}>
                    <input
                      type="radio"
                      name={item.anomaly_id}
                      checked={answer.response === "content_incorrect"}
                      onChange={() =>
                        update(item.anomaly_id, {
                          response: "content_incorrect",
                        })
                      }
                    />
                    <span>內容不符，提出說明</span>
                  </label>
                  {answer.response === "content_incorrect" ? (
                    <div className={styles.explanation}>
                      <label>
                        實際有提供勞務的分鐘數（沒有則填 0）
                        <input
                          type="number"
                          min="0"
                          max="1440"
                          value={answer.actualWorkMinutes}
                          onChange={(event) =>
                            update(item.anomaly_id, {
                              actualWorkMinutes: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        實際情況說明
                        <textarea
                          rows={3}
                          value={answer.explanation}
                          onChange={(event) =>
                            update(item.anomaly_id, {
                              explanation: event.target.value,
                            })
                          }
                        />
                      </label>
                      <p>
                        若您確實有工作，主管會依法覆核工時及加班處理，不會因未事先申請就直接歸零。
                      </p>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          <div className={styles.signature}>
            <h2>全部日期確認完後，簽名一次</h2>
            <MobileSignaturePad onChange={setSignature} />
            <button
              disabled={busy || !complete || !signature}
              onClick={() => {
                if (
                  window.confirm(
                    "確認所有日期的回答都正確，並送出本次手機簽名？",
                  )
                )
                  void submit();
              }}
            >
              確認並送出手機簽名
            </button>
          </div>
        </section>
      ) : (
        <section className={styles.empty}>
          <span>✓</span>
          <h2>目前沒有待回答的打卡異常</h2>
          <p>已完成的案件仍會保留在主管覆核與薪資紀錄中。</p>
        </section>
      )}
      {data?.responsePackages.filter((item) => item.status !== "pending")
        .length ? (
        <section className={styles.history}>
          <h2>處理紀錄</h2>
          {data.responsePackages
            .filter((item) => item.status !== "pending")
            .map((item) => (
              <div key={item.id}>
                <span>
                  {item.items
                    .map(
                      (row) => one(row.staff_attendance_anomalies)?.work_date,
                    )
                    .filter(Boolean)
                    .join("、")}
                </span>
                <strong>{item.status}</strong>
                <small>
                  {item.signed_at ? `簽名 ${time(item.signed_at)}` : ""}
                </small>
              </div>
            ))}
        </section>
      ) : null}
    </main>
  );
}
