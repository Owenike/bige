"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";
import { MemberTabs } from "../_components/MemberTabs";

type ProgressStatus = "active" | "completed" | "archived";

type InBodyItem = {
  id: string;
  title: string;
  note: string | null;
  status: ProgressStatus;
  measuredAt: string;
  createdAt: string;
  updatedAt: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  muscleKg: number | null;
};

type GoalItem = {
  id: string;
  title: string;
  note: string | null;
  status: ProgressStatus;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  targetValue: number | null;
  unit: string | null;
};

type TaskItem = {
  id: string;
  title: string;
  note: string | null;
  status: ProgressStatus;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: "coach" | "member";
};

type ProgressPayload = {
  available?: boolean;
  summary?: {
    checkins30d?: number;
    redemptions30d?: number;
    latestCheckinAt?: string | null;
  };
  inbody?: InBodyItem[];
  goals?: GoalItem[];
  tasks?: TaskItem[];
  error?: string;
};

function fmtDateTime(input: string | null | undefined) {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleString();
}

function fmtDate(input: string | null | undefined) {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleDateString();
}

function toOptionalNumber(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}

function statusLabel(status: ProgressStatus, zh: boolean) {
  if (status === "active") return zh ? "進行中" : "Active";
  if (status === "completed") return zh ? "已完成" : "Completed";
  return zh ? "已封存" : "Archived";
}

export default function MemberProgressPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [summary, setSummary] = useState({
    checkins30d: 0,
    redemptions30d: 0,
    latestCheckinAt: null as string | null,
  });
  const [inbody, setInbody] = useState<InBodyItem[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  const [weightKg, setWeightKg] = useState("");
  const [bodyFatPct, setBodyFatPct] = useState("");
  const [muscleKg, setMuscleKg] = useState("");
  const [inbodyMeasuredAt, setInbodyMeasuredAt] = useState("");
  const [inbodyNote, setInbodyNote] = useState("");

  const [goalTitle, setGoalTitle] = useState("");
  const [goalTargetValue, setGoalTargetValue] = useState("");
  const [goalUnit, setGoalUnit] = useState("");
  const [goalDueAt, setGoalDueAt] = useState("");
  const [goalNote, setGoalNote] = useState("");
  const [statusNoteByEntry, setStatusNoteByEntry] = useState<Record<string, string>>({});

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskNote, setTaskNote] = useState("");

  const loadProgress = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/member/progress?limit=150", { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as ProgressPayload | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "載入進度失敗" : "Failed to load progress"));
      setAvailable(payload?.available !== false);
      setSummary({
        checkins30d: payload?.summary?.checkins30d || 0,
        redemptions30d: payload?.summary?.redemptions30d || 0,
        latestCheckinAt: payload?.summary?.latestCheckinAt || null,
      });
      setInbody(payload?.inbody || []);
      setGoals(payload?.goals || []);
      setTasks(payload?.tasks || []);
      const notes: Record<string, string> = {};
      for (const item of payload?.goals || []) notes[item.id] = item.note || "";
      for (const item of payload?.tasks || []) notes[item.id] = item.note || "";
      setStatusNoteByEntry(notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "載入進度失敗" : "Failed to load progress");
      setAvailable(true);
      setSummary({ checkins30d: 0, redemptions30d: 0, latestCheckinAt: null });
      setInbody([]);
      setGoals([]);
      setTasks([]);
      setStatusNoteByEntry({});
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  const activeGoalsCount = useMemo(() => goals.filter((item) => item.status === "active").length, [goals]);
  const activeTasksCount = useMemo(() => tasks.filter((item) => item.status === "active").length, [tasks]);
  const latestInBody = inbody[0] || null;

  async function createInBody() {
    if (saving) return;
    const weight = toOptionalNumber(weightKg);
    const bodyFat = toOptionalNumber(bodyFatPct);
    const muscle = toOptionalNumber(muscleKg);
    if (weight === null && bodyFat === null && muscle === null) {
      setError(zh ? "至少填入一個身體數據。" : "Enter at least one body metric.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/member/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_inbody",
          measuredAt: inbodyMeasuredAt || null,
          weightKg: weight,
          bodyFatPct: bodyFat,
          muscleKg: muscle,
          note: inbodyNote.trim() || null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as ProgressPayload | { error?: string } | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "新增 InBody 失敗" : "Failed to add InBody"));
      setWeightKg("");
      setBodyFatPct("");
      setMuscleKg("");
      setInbodyMeasuredAt("");
      setInbodyNote("");
      setMessage(zh ? "InBody 紀錄已新增。" : "InBody record added.");
      await loadProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "新增 InBody 失敗" : "Failed to add InBody");
    } finally {
      setSaving(false);
    }
  }

  async function createGoal() {
    if (saving) return;
    if (!goalTitle.trim()) {
      setError(zh ? "請輸入目標標題。" : "Goal title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/member/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_goal",
          title: goalTitle.trim(),
          targetValue: toOptionalNumber(goalTargetValue),
          unit: goalUnit.trim() || null,
          dueAt: goalDueAt || null,
          note: goalNote.trim() || null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as ProgressPayload | { error?: string } | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "新增目標失敗" : "Failed to add goal"));
      setGoalTitle("");
      setGoalTargetValue("");
      setGoalUnit("");
      setGoalDueAt("");
      setGoalNote("");
      setMessage(zh ? "目標已新增。" : "Goal added.");
      await loadProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "新增目標失敗" : "Failed to add goal");
    } finally {
      setSaving(false);
    }
  }

  async function createTask() {
    if (saving) return;
    if (!taskTitle.trim()) {
      setError(zh ? "請輸入作業標題。" : "Task title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/member/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_task",
          title: taskTitle.trim(),
          dueAt: taskDueAt || null,
          note: taskNote.trim() || null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as ProgressPayload | { error?: string } | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "新增作業失敗" : "Failed to add task"));
      setTaskTitle("");
      setTaskDueAt("");
      setTaskNote("");
      setMessage(zh ? "作業已新增。" : "Task added.");
      await loadProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "新增作業失敗" : "Failed to add task");
    } finally {
      setSaving(false);
    }
  }

  async function setItemStatus(entryId: string, status: ProgressStatus, note?: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const requestBody: Record<string, unknown> = { action: "set_status", entryId, status };
      if (typeof note === "string") requestBody.note = note.trim() || null;
      const res = await fetch("/api/member/progress", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = (await res.json().catch(() => null)) as ProgressPayload | { error?: string } | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "更新狀態失敗" : "Failed to update status"));
      setMessage(zh ? "狀態已更新。" : "Status updated.");
      await loadProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "更新狀態失敗" : "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">{zh ? "進度" : "PROGRESS"}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            {zh ? "訓練進度" : "Training Progress"}
          </h1>
          <p className="sub">
            {zh ? "管理 InBody、訓練目標與教練作業，並追蹤最近 30 天出缺勤。" : "Manage InBody, goals, and coach tasks with 30-day attendance tracking."}
          </p>
          <MemberTabs />

          {error ? <p className="sub" style={{ marginTop: 10, color: "var(--danger, #b00020)" }}>{error}</p> : null}
          {message ? <p className="sub" style={{ marginTop: 10, color: "var(--success, #0b6b3a)" }}>{message}</p> : null}
          {loading ? <p className="sub" style={{ marginTop: 10 }}>{zh ? "載入中..." : "Loading..."}</p> : null}

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="kvLabel">{zh ? "近 30 天簽到" : "Check-ins (30d)"}</div>
              <div className="kvValue" style={{ marginTop: 8 }}>{summary.checkins30d}</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="kvLabel">{zh ? "近 30 天扣課" : "Redemptions (30d)"}</div>
              <div className="kvValue" style={{ marginTop: 8 }}>{summary.redemptions30d}</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="kvLabel">{zh ? "進行中目標" : "Active Goals"}</div>
              <div className="kvValue" style={{ marginTop: 8 }}>{activeGoalsCount}</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="kvLabel">{zh ? "進行中作業" : "Active Tasks"}</div>
              <div className="kvValue" style={{ marginTop: 8 }}>{activeTasksCount}</div>
            </div>
          </div>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "最近簽到與最新身體數據" : "Latest Check-in & Body Data"}</div>
            <p className="sub" style={{ marginTop: 8, marginBottom: 0 }}>
              {zh ? "最近簽到" : "Latest check-in"}: {fmtDateTime(summary.latestCheckinAt)}
            </p>
            <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>
              {zh ? "最新 InBody" : "Latest InBody"}:{" "}
              {latestInBody
                ? `${fmtDateTime(latestInBody.measuredAt)} | W ${latestInBody.weightKg ?? "-"}kg, BF ${latestInBody.bodyFatPct ?? "-"}%, M ${latestInBody.muscleKg ?? "-"}kg`
                : zh
                  ? "尚無資料"
                  : "No record"}
            </p>
            {!available ? (
              <p className="sub" style={{ marginTop: 8 }}>
                {zh ? "進度資料表尚未啟用，請先套用最新 migration。" : "Progress table is unavailable. Apply latest migrations first."}
              </p>
            ) : null}
          </section>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "InBody 紀錄" : "InBody Records"}</div>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              <input className="input" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder={zh ? "體重 kg" : "Weight kg"} />
              <input className="input" inputMode="decimal" value={bodyFatPct} onChange={(e) => setBodyFatPct(e.target.value)} placeholder={zh ? "體脂 %" : "Body fat %"} />
              <input className="input" inputMode="decimal" value={muscleKg} onChange={(e) => setMuscleKg(e.target.value)} placeholder={zh ? "肌肉量 kg" : "Muscle kg"} />
              <input className="input" type="datetime-local" value={inbodyMeasuredAt} onChange={(e) => setInbodyMeasuredAt(e.target.value)} />
            </div>
            <textarea
              className="input"
              rows={2}
              style={{ marginTop: 8 }}
              value={inbodyNote}
              onChange={(e) => setInbodyNote(e.target.value)}
              placeholder={zh ? "備註（選填）" : "Note (optional)"}
            />
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn btnPrimary" disabled={saving || !available} onClick={() => void createInBody()}>
                {saving ? (zh ? "儲存中..." : "Saving...") : zh ? "新增 InBody" : "Add InBody"}
              </button>
            </div>
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
              {inbody.slice(0, 8).map((item) => (
                <li key={item.id} className="card" style={{ padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong>{fmtDateTime(item.measuredAt)}</strong>
                    <span className="fdChip">{statusLabel(item.status, zh)}</span>
                  </div>
                  <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>
                    W {item.weightKg ?? "-"}kg | BF {item.bodyFatPct ?? "-"}% | M {item.muscleKg ?? "-"}kg
                  </p>
                  {item.note ? <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>{item.note}</p> : null}
                </li>
              ))}
              {!loading && inbody.length === 0 ? <li className="sub">{zh ? "尚無 InBody 紀錄。" : "No InBody records yet."}</li> : null}
            </ul>
          </section>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "訓練目標" : "Goals"}</div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <input className="input" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder={zh ? "目標標題" : "Goal title"} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <input className="input" inputMode="decimal" value={goalTargetValue} onChange={(e) => setGoalTargetValue(e.target.value)} placeholder={zh ? "目標數值" : "Target value"} />
                <input className="input" value={goalUnit} onChange={(e) => setGoalUnit(e.target.value)} placeholder={zh ? "單位（kg、次）" : "Unit (kg, reps)"} />
                <input className="input" type="date" value={goalDueAt} onChange={(e) => setGoalDueAt(e.target.value)} />
              </div>
              <textarea className="input" rows={2} value={goalNote} onChange={(e) => setGoalNote(e.target.value)} placeholder={zh ? "備註（選填）" : "Note (optional)"} />
            </div>
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn btnPrimary" disabled={saving || !available} onClick={() => void createGoal()}>
                {saving ? (zh ? "儲存中..." : "Saving...") : zh ? "新增目標" : "Add Goal"}
              </button>
            </div>
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
              {goals.map((item) => (
                <li key={item.id} className="card" style={{ padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong>{item.title}</strong>
                    <span className="fdChip">{statusLabel(item.status, zh)}</span>
                  </div>
                  <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>
                    {zh ? "目標" : "Target"}: {item.targetValue ?? "-"} {item.unit || ""}
                  </p>
                  <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                    {zh ? "到期" : "Due"}: {fmtDate(item.dueAt)}
                  </p>
                  {item.note ? <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>{item.note}</p> : null}
                  <textarea
                    className="input"
                    rows={2}
                    style={{ marginTop: 8 }}
                    value={statusNoteByEntry[item.id] ?? ""}
                    onChange={(event) => setStatusNoteByEntry((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    placeholder={zh ? "完成回報（選填）" : "Completion note (optional)"}
                  />
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      onClick={() => void setItemStatus(item.id, "active", statusNoteByEntry[item.id] || "")}
                    >
                      {zh ? "設為進行中" : "Set Active"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      onClick={() => void setItemStatus(item.id, "completed", statusNoteByEntry[item.id] || "")}
                    >
                      {zh ? "回報完成" : "Report Complete"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      onClick={() => void setItemStatus(item.id, "archived", statusNoteByEntry[item.id] || "")}
                    >
                      {zh ? "封存" : "Archive"}
                    </button>
                  </div>
                </li>
              ))}
              {!loading && goals.length === 0 ? <li className="sub">{zh ? "尚無目標。" : "No goals yet."}</li> : null}
            </ul>
          </section>

          <section className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{zh ? "教練作業與自我作業" : "Coach & Self Tasks"}</div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              <input className="input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder={zh ? "作業標題" : "Task title"} />
              <input className="input" type="date" value={taskDueAt} onChange={(e) => setTaskDueAt(e.target.value)} />
              <textarea className="input" rows={2} value={taskNote} onChange={(e) => setTaskNote(e.target.value)} placeholder={zh ? "作業內容（選填）" : "Task note (optional)"} />
            </div>
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn btnPrimary" disabled={saving || !available} onClick={() => void createTask()}>
                {saving ? (zh ? "儲存中..." : "Saving...") : zh ? "新增作業" : "Add Task"}
              </button>
            </div>
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
              {tasks.map((item) => (
                <li key={item.id} className="card" style={{ padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong>{item.title}</strong>
                    <span className="fdChip">{statusLabel(item.status, zh)}</span>
                  </div>
                  <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>
                    {zh ? "來源" : "Source"}: {item.source === "coach" ? (zh ? "教練" : "Coach") : (zh ? "會員" : "Member")}
                  </p>
                  <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                    {zh ? "到期" : "Due"}: {fmtDate(item.dueAt)}
                  </p>
                  {item.note ? <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>{item.note}</p> : null}
                  <textarea
                    className="input"
                    rows={2}
                    style={{ marginTop: 8 }}
                    value={statusNoteByEntry[item.id] ?? ""}
                    onChange={(event) => setStatusNoteByEntry((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    placeholder={zh ? "完成回報（選填）" : "Completion note (optional)"}
                  />
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      onClick={() => void setItemStatus(item.id, "active", statusNoteByEntry[item.id] || "")}
                    >
                      {zh ? "設為進行中" : "Set Active"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      onClick={() => void setItemStatus(item.id, "completed", statusNoteByEntry[item.id] || "")}
                    >
                      {zh ? "回報完成" : "Report Complete"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={saving}
                      onClick={() => void setItemStatus(item.id, "archived", statusNoteByEntry[item.id] || "")}
                    >
                      {zh ? "封存" : "Archive"}
                    </button>
                  </div>
                </li>
              ))}
              {!loading && tasks.length === 0 ? <li className="sub">{zh ? "尚無作業。" : "No tasks yet."}</li> : null}
            </ul>
          </section>
        </div>
      </section>
    </main>
  );
}
