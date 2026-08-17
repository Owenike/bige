"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "../app/staff/leave/page.module.css";

type LeaveRequest = {
  id: string;
  leave_type: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  unit: string;
  reason: string | null;
  proof_required: boolean;
  proof_due_at: string | null;
  proofOverdue: boolean;
  status: string;
  assistant_reason: string | null;
  manager_reason: string | null;
  proposed_starts_at: string | null;
  proposed_ends_at: string | null;
  staff_leave_attachments: Array<{
    id: string;
    file_name: string;
    uploaded_at: string;
  }>;
};
type State = { requests: LeaveRequest[] };
const LABELS: Record<string, string> = {
  annual: "特休",
  sick: "病假",
  personal: "事假",
  family_care: "家庭照顧假",
  marriage: "婚假",
  bereavement: "喪假",
  official: "公假",
  other: "其他假",
};
const PROOF_TYPES = new Set([
  "sick",
  "family_care",
  "marriage",
  "bereavement",
  "official",
  "other",
]);
function toIso(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("請填入有效日期時間");
  return date.toISOString();
}
function format(value: string | null) {
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
export default function StaffLeaveSelfService() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<State | null>(null);
  const [type, setType] = useState("annual");
  const [unit, setUnit] = useState("full_day");
  const [start, setStart] = useState(`${month}-01T09:00`);
  const [end, setEnd] = useState(`${month}-01T17:00`);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
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
          await fetch(`/api/staff-leave?month=${month}`, { cache: "no-store" }),
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
  useEffect(() => {
    setStart(`${month}-01T09:00`);
    setEnd(`${month}-01T17:00`);
  }, [month]);
  const units = useMemo(
    () =>
      type === "annual"
        ? ["full_day"]
        : ["sick", "personal"].includes(type)
          ? ["full_day", "half_day"]
          : type === "family_care"
            ? ["hourly", "half_day", "full_day"]
            : ["actual", "hourly", "full_day"],
    [type],
  );
  useEffect(() => {
    if (!units.includes(unit)) setUnit(units[0]);
  }, [unit, units]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("action", "submit_leave");
      form.set("month", month);
      form.set("leaveType", type);
      form.set("unit", unit);
      form.set("startsAt", toIso(start));
      form.set("endsAt", toIso(end));
      form.set("reason", reason);
      if (file) form.set("file", file);
      setData(
        await parse(
          await fetch("/api/staff-leave", { method: "POST", body: form }),
        ),
      );
      setNotice(
        "請假單已送出，等待副理檢查及經理最終核准。即使證明尚未備妥，也可在 3 天內補上。",
      );
      setFile(null);
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "送出失敗");
    } finally {
      setBusy(false);
    }
  }
  async function supplement(requestId: string, proof: File | null) {
    if (!proof) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("action", "supplement_proof");
      form.set("month", month);
      form.set("requestId", requestId);
      form.set("file", proof);
      setData(
        await parse(
          await fetch("/api/staff-leave", { method: "POST", body: form }),
        ),
      );
      setNotice("證明附件已補上");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上傳失敗");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className={styles.page}>
        <div className={styles.empty}>正在讀取請假資料…</div>
      </main>
    );
  return (
    <main className={styles.page}>
      <header>
        <div>
          <p>巨挺健身館 · 員工專區</p>
          <h1>請假申請</h1>
          <span>這裡的法定請假不受每月自選 8 天限制。</span>
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
      <form className={styles.form} onSubmit={submit}>
        <div>
          <h2>新增請假單</h2>
          <p>
            特休只能整天；病假、事假可整天或半天；家庭照顧假可按小時；婚喪公假依實際期間。
          </p>
        </div>
        <div className={styles.fields}>
          <label>
            假別
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {Object.entries(LABELS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            時間單位
            <select
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            >
              {units.map((value) => (
                <option value={value} key={value}>
                  {value === "full_day"
                    ? "整天"
                    : value === "half_day"
                      ? "半天"
                      : value === "hourly"
                        ? "按小時"
                        : "實際期間"}
                </option>
              ))}
            </select>
          </label>
          <label>
            開始時間
            <input
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            結束時間
            <input
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <label className={styles.reason}>
            原因或說明
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className={styles.file}>
            證明附件
            {PROOF_TYPES.has(type) ? (
              <strong>可先送出，3 天內補照片／PDF</strong>
            ) : (
              <span>此假別不要求附件</span>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <small>{file?.name || "尚未選擇附件"}</small>
          </label>
        </div>
        <button disabled={busy} type="submit">
          送出請假申請
        </button>
      </form>
      <section className={styles.history}>
        <h2>我的申請紀錄</h2>
        {!data?.requests.length ? (
          <div className={styles.empty}>本月尚無請假申請。</div>
        ) : (
          data.requests.map((item) => (
            <article
              key={item.id}
              className={item.proofOverdue ? styles.overdue : ""}
            >
              <header>
                <div>
                  <strong>{LABELS[item.leave_type] || item.leave_type}</strong>
                  <span>
                    {format(item.starts_at)} ～ {format(item.ends_at)}
                  </span>
                </div>
                <b>{item.status}</b>
              </header>
              <p>{item.reason || "無附註"}</p>
              {item.proposed_starts_at ? (
                <div className={styles.proposal}>
                  主管建議調整為：{format(item.proposed_starts_at)} ～{" "}
                  {format(item.proposed_ends_at)}
                </div>
              ) : null}
              <div className={styles.proof}>
                <span>
                  {item.staff_leave_attachments?.length
                    ? <>
                        已上傳：
                        {item.staff_leave_attachments.map((file, index) => (
                          <span key={file.id}>
                            {index > 0 ? "、" : ""}
                            <a href={`/api/staff-leave/attachments/${file.id}`} target="_blank" rel="noreferrer">{file.file_name}</a>
                          </span>
                        ))}
                      </>
                    : item.proof_required
                      ? `尚未上傳證明；期限 ${format(item.proof_due_at)}`
                      : "本假別不需證明"}
                </span>
                {item.proof_required &&
                !item.staff_leave_attachments?.length ? (
                  <label>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      disabled={busy}
                      onChange={(event) =>
                        void supplement(
                          item.id,
                          event.target.files?.[0] || null,
                        )
                      }
                    />
                    <em>補上證明</em>
                  </label>
                ) : null}
              </div>
              {item.assistant_reason || item.manager_reason ? (
                <small>
                  主管說明：{item.manager_reason || item.assistant_reason}
                </small>
              ) : null}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
