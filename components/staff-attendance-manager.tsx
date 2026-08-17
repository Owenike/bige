"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../app/manager/staff-attendance/page.module.css";

type Anomaly = {
  id: string;
  employee_id: string | null;
  work_date: string;
  anomaly_type: string;
  scheduled_at: string | null;
  actual_at: string | null;
  variance_minutes: number | null;
  raw_punches: string[];
  supervisor_selected: boolean;
  status: string;
  resolution: string | null;
  resolution_minutes: number | null;
};

type PackageItem = {
  anomaly_id: string;
  staff_attendance_anomalies: Anomaly | Anomaly[];
};
type AttendancePackage = {
  id: string;
  employee_id: string;
  status: string;
  signed_at: string | null;
  statement_snapshot: string;
  items: PackageItem[];
  responses: Array<{
    anomaly_id: string;
    response: string;
    actual_work_minutes: number | null;
    explanation: string | null;
  }>;
  reviews: Array<{
    stage: string;
    decision: string;
    reason: string | null;
    decided_at: string;
  }>;
};

type State = {
  actor: {
    canManage: boolean;
    canAssistantReview: boolean;
    canFinalReview: boolean;
  };
  month: string;
  batches: Array<{
    id: string;
    file_name: string;
    period_start: string | null;
    period_end: string | null;
    status: string;
    row_count: number;
    imported_at: string;
  }>;
  selectedBatchId: string | null;
  employees: Array<{
    id: string;
    display_name: string | null;
    english_name: string | null;
    employee_number: string | null;
  }>;
  anomalies: Anomaly[];
  packages: AttendancePackage[];
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
  unmatched_employee: "找不到員工",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function employeeName(item: State["employees"][number] | undefined) {
  return (
    item?.display_name ||
    item?.english_name ||
    item?.employee_number ||
    "無法對應員工"
  );
}

function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

async function parse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok)
    throw new Error(payload?.message || payload?.error?.message || "操作失敗");
  return payload.data as State;
}

export default function StaffAttendanceManager() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<State | null>(null);
  const [batchId, setBatchId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const employeeMap = useMemo(
    () => new Map((data?.employees || []).map((item) => [item.id, item])),
    [data?.employees],
  );

  const load = useCallback(
    async (targetBatch = "") => {
      setLoading(true);
      setError("");
      try {
        const suffix = targetBatch;
        const response = await fetch(
          `/api/staff-attendance?month=${month}${suffix ? `&batch=${suffix}` : ""}`,
          { cache: "no-store" },
        );
        const next = await parse(response);
        setData(next);
        setBatchId(next.selectedBatchId || "");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "讀取失敗");
      } finally {
        setLoading(false);
      }
    },
    [month],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  async function jsonAction(
    action: string,
    values: Record<string, unknown>,
    success: string,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/staff-attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, month, ...values }),
      });
      const next = await parse(response);
      setData(next);
      setNotice(success);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失敗");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/staff-attendance", {
        method: "POST",
        body: form,
      });
      const next = await parse(response);
      setData(next);
      setBatchId(next.selectedBatchId || "");
      setNotice("Excel 已解析；目前只是預覽，尚未通知任何員工。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "匯入失敗");
    } finally {
      setBusy(false);
    }
  }

  const selectedCount =
    data?.anomalies.filter(
      (item) => item.supervisor_selected && item.status === "preview",
    ).length || 0;
  const previewIds =
    data?.anomalies
      .filter((item) => item.status === "preview" && item.employee_id)
      .map((item) => item.id) || [];

  if (loading && !data)
    return (
      <main className={styles.page}>
        <div className={styles.loading}>正在讀取打卡匯入紀錄…</div>
      </main>
    );
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>巨挺健身館 · 出勤覆核</p>
          <h1>打卡 Excel 與異常確認</h1>
          <span>
            匯入 → 主管預覽勾選 → 員工逐日回答並簽一次 → 主管一次覆核
          </span>
        </div>
        <div>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <a href="/manager/staff-scheduling">返回班表</a>
        </div>
      </header>
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}
      <section className={styles.uploadPanel}>
        <div>
          <span>1</span>
          <div>
            <h2>匯入打卡機 Excel</h2>
            <p>可累積數天一次匯入。系統保留原始列，只先產生異常預覽。</p>
          </div>
        </div>
        <div className={styles.uploadActions}>
          <label>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <span>{file?.name || "選擇 .xlsx 檔案"}</span>
          </label>
          <button disabled={!file || busy} onClick={() => void upload()}>
            解析並預覽
          </button>
        </div>
      </section>
      <section className={styles.batchBar}>
        <label>
          已匯入批次
          <select
            value={batchId}
            onChange={(event) => {
              setBatchId(event.target.value);
              void load(event.target.value);
            }}
          >
            <option value="">尚無批次</option>
            {data?.batches.map((batch) => (
              <option value={batch.id} key={batch.id}>
                {batch.file_name} · {batch.period_start}～{batch.period_end}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void load(batchId)}>重新整理</button>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <span>2</span>
            <div>
              <h2>異常預覽</h2>
              <p>
                先勾選要請員工確認的項目；未勾選不會通知，也不會直接計入薪資。
              </p>
            </div>
          </div>
          <div className={styles.actions}>
            <button
              disabled={!previewIds.length || busy}
              onClick={() =>
                void jsonAction(
                  "select_anomalies",
                  { anomalyIds: previewIds, selected: true, batchId },
                  "已全選可通知的異常",
                )
              }
            >
              全選可通知
            </button>
            <button
              className={styles.primary}
              disabled={!selectedCount || busy}
              onClick={() => {
                if (
                  window.confirm(
                    `確認向員工發出 ${selectedCount} 筆異常？同一員工會合併成一份通知。`,
                  )
                )
                  void jsonAction(
                    "send_notifications",
                    { batchId },
                    "通知已發出；同一員工逐日回答後只簽一次",
                  );
              }}
            >
              通知已勾選員工（{selectedCount}）
            </button>
          </div>
        </div>
        {!data?.anomalies.length ? (
          <div className={styles.empty}>目前沒有異常預覽。</div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>通知</th>
                  <th>員工</th>
                  <th>日期</th>
                  <th>異常</th>
                  <th>排定</th>
                  <th>實際</th>
                  <th>差異</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {data.anomalies.map((item) => (
                  <tr
                    key={item.id}
                    className={item.employee_id ? "" : styles.unmatched}
                  >
                    <td>
                      <input
                        type="checkbox"
                        disabled={
                          item.status !== "preview" || !item.employee_id || busy
                        }
                        checked={item.supervisor_selected}
                        onChange={(event) =>
                          void jsonAction(
                            "select_anomalies",
                            {
                              anomalyIds: [item.id],
                              selected: event.target.checked,
                              batchId,
                            },
                            event.target.checked ? "已勾選" : "已取消勾選",
                          )
                        }
                      />
                    </td>
                    <td>
                      {employeeName(
                        item.employee_id
                          ? employeeMap.get(item.employee_id)
                          : undefined,
                      )}
                    </td>
                    <td>{item.work_date}</td>
                    <td>
                      <strong>
                        {LABELS[item.anomaly_type] || item.anomaly_type}
                      </strong>
                    </td>
                    <td>{formatTime(item.scheduled_at)}</td>
                    <td>
                      {formatTime(item.actual_at)}
                      <small>{item.raw_punches?.join("、")}</small>
                    </td>
                    <td>
                      {item.variance_minutes === null
                        ? "—"
                        : `${item.variance_minutes} 分`}
                    </td>
                    <td>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {data?.packages.length ? (
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span>3</span>
              <div>
                <h2>員工回覆與主管覆核</h2>
                <p>
                  晚打卡若員工表示有實際工作，不能以「自主運動」聲明取代，會進入薪資處理。
                </p>
              </div>
            </div>
          </div>
          <div className={styles.packageList}>
            {data.packages.map((responsePackage) => (
              <article key={responsePackage.id} className={styles.packageCard}>
                <header>
                  <div>
                    <h3>
                      {employeeName(
                        employeeMap.get(responsePackage.employee_id),
                      )}
                    </h3>
                    <span>
                      {responsePackage.status} ·{" "}
                      {responsePackage.signed_at
                        ? `簽名 ${formatTime(responsePackage.signed_at)}`
                        : "等待員工"}
                    </span>
                  </div>
                </header>
                {responsePackage.items.map((item) => {
                  const anomaly = one(item.staff_attendance_anomalies);
                  const response = responsePackage.responses.find(
                    (entry) => entry.anomaly_id === item.anomaly_id,
                  );
                  return (
                    <div className={styles.responseRow} key={item.anomaly_id}>
                      <span>
                        {anomaly?.work_date} ·{" "}
                        {LABELS[anomaly?.anomaly_type] || anomaly?.anomaly_type}
                      </span>
                      <strong>
                        {response?.response === "confirm_personal_activity"
                          ? "確認為私人活動／自主運動"
                          : response?.response === "confirm_as_shown"
                            ? "確認資料正確"
                            : response?.response === "content_incorrect"
                              ? "內容不符"
                              : "尚未回答"}
                      </strong>
                      <p>
                        {response?.actual_work_minutes
                          ? `實際工作 ${response.actual_work_minutes} 分鐘。`
                          : ""}
                        {response?.explanation || ""}
                      </p>
                    </div>
                  );
                })}
                <div className={styles.reviewActions}>
                  {data.actor.canAssistantReview &&
                  responsePackage.status === "assistant_review" ? (
                    <>
                      <button
                        className={styles.primary}
                        onClick={() =>
                          void jsonAction(
                            "review_package",
                            {
                              packageId: responsePackage.id,
                              stage: "assistant_manager",
                              decision: "approved",
                              batchId,
                            },
                            "主管覆核完成",
                          )
                        }
                      >
                        主管確認通過
                      </button>
                      <button
                        onClick={() => {
                          const reason =
                            window.prompt("退回員工的理由（必填）");
                          if (reason)
                            void jsonAction(
                              "review_package",
                              {
                                packageId: responsePackage.id,
                                stage: "assistant_manager",
                                decision: "returned",
                                reason,
                                batchId,
                              },
                              "已退回員工補充",
                            );
                        }}
                      >
                        退回補充
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
