"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";
import {
  buildFeedbackItems,
  type FeedbackActorRole,
  type FeedbackEventItem,
} from "../../../lib/member-progress-feedback";

type ProgressStatus = "active" | "completed" | "archived";
type ProgressStatusFilter = "all" | ProgressStatus;

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
  inbody?: InBodyItem[];
  goals?: GoalItem[];
  tasks?: TaskItem[];
  feedbackEvents?: FeedbackEventItem[];
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

function feedbackActorLabel(actorRole: FeedbackActorRole, zh: boolean) {
  if (actorRole === "member") return zh ? "會員回報" : "Member";
  return zh ? "教練/櫃台註記" : "Coach/Staff";
}

function statusLabel(status: ProgressStatus, zh: boolean) {
  if (status === "active") return zh ? "進行中" : "Active";
  if (status === "completed") return zh ? "已完成" : "Completed";
  return zh ? "已封存" : "Archived";
}

function statusFilterLabel(status: ProgressStatusFilter, zh: boolean) {
  if (status === "all") return zh ? "全部" : "All";
  return statusLabel(status, zh);
}

export function MemberProgressPanel({ memberId, memberName }: { memberId: string; memberName: string }) {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProgressStatusFilter>("all");
  const [onlyMemberFeedback, setOnlyMemberFeedback] = useState(false);

  const [inbody, setInbody] = useState<InBodyItem[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackEventItem[]>([]);
  const [noteByEntry, setNoteByEntry] = useState<Record<string, string>>({});

  const [goalTitle, setGoalTitle] = useState("");
  const [goalTargetValue, setGoalTargetValue] = useState("");
  const [goalUnit, setGoalUnit] = useState("");
  const [goalDueAt, setGoalDueAt] = useState("");
  const [goalNote, setGoalNote] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskNote, setTaskNote] = useState("");

  const [weightKg, setWeightKg] = useState("");
  const [bodyFatPct, setBodyFatPct] = useState("");
  const [muscleKg, setMuscleKg] = useState("");
  const [inbodyMeasuredAt, setInbodyMeasuredAt] = useState("");
  const [inbodyNote, setInbodyNote] = useState("");

  const activeGoalCount = useMemo(() => goals.filter((item) => item.status === "active").length, [goals]);
  const activeTaskCount = useMemo(() => tasks.filter((item) => item.status === "active").length, [tasks]);

  const filteredGoals = useMemo(
    () => (statusFilter === "all" ? goals : goals.filter((item) => item.status === statusFilter)),
    [goals, statusFilter],
  );
  const filteredTasks = useMemo(
    () => (statusFilter === "all" ? tasks : tasks.filter((item) => item.status === statusFilter)),
    [tasks, statusFilter],
  );
  const feedbackItems = useMemo(
    () => buildFeedbackItems({ feedbackEvents, goals, tasks, onlyMemberFeedback, limit: 12 }),
    [feedbackEvents, goals, onlyMemberFeedback, tasks],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/frontdesk/member-progress?memberId=${encodeURIComponent(memberId)}`, { cache: "no-store" });
      const payload = (await res.json().catch(() => null)) as ProgressPayload | null;
      if (!res.ok) throw new Error(payload?.error || (zh ? "頛??脣漲憭望?" : "Failed to load member progress"));
      setAvailable(payload?.available !== false);
      const nextInbody = payload?.inbody || [];
      const nextGoals = payload?.goals || [];
      const nextTasks = payload?.tasks || [];
      const nextFeedbackEvents = payload?.feedbackEvents || [];
      setInbody(nextInbody);
      setGoals(nextGoals);
      setTasks(nextTasks);
      setFeedbackEvents(nextFeedbackEvents);
      const nextNotes: Record<string, string> = {};
      for (const row of nextGoals) nextNotes[row.id] = row.note || "";
      for (const row of nextTasks) nextNotes[row.id] = row.note || "";
      setNoteByEntry(nextNotes);
    } catch (err) {
      setAvailable(true);
      setInbody([]);
      setGoals([]);
      setTasks([]);
      setFeedbackEvents([]);
      setNoteByEntry({});
      setError(err instanceof Error ? err.message : zh ? "頛??脣漲憭望?" : "Failed to load member progress");
    } finally {
      setLoading(false);
    }
  }, [memberId, zh]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postAction(payload: Record<string, unknown>, successMessage: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/frontdesk/member-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || (zh ? "?脣?憭望?" : "Save failed"));
      setMessage(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "?脣?憭望?" : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function createGoal() {
    if (!goalTitle.trim()) {
      setError("Goal title is required.");
      return;
    }
    await postAction(
      {
        action: "add_goal",
        memberId,
        title: goalTitle.trim(),
        targetValue: toOptionalNumber(goalTargetValue),
        unit: goalUnit.trim() || null,
        dueAt: goalDueAt || null,
        note: goalNote.trim() || null,
      },
      "Goal assigned.",
    );
    setGoalTitle("");
    setGoalTargetValue("");
    setGoalUnit("");
    setGoalDueAt("");
    setGoalNote("");
  }

  async function createTask() {
    if (!taskTitle.trim()) {
      setError("Task title is required.");
      return;
    }
    await postAction(
      {
        action: "add_task",
        memberId,
        title: taskTitle.trim(),
        dueAt: taskDueAt || null,
        note: taskNote.trim() || null,
      },
      "Task assigned.",
    );
    setTaskTitle("");
    setTaskDueAt("");
    setTaskNote("");
  }

  async function createInBody() {
    const weight = toOptionalNumber(weightKg);
    const bodyFat = toOptionalNumber(bodyFatPct);
    const muscle = toOptionalNumber(muscleKg);
    if (weight === null && bodyFat === null && muscle === null) {
      setError("Enter at least one body metric.");
      return;
    }
    await postAction(
      {
        action: "add_inbody",
        memberId,
        measuredAt: inbodyMeasuredAt || null,
        weightKg: weight,
        bodyFatPct: bodyFat,
        muscleKg: muscle,
        note: inbodyNote.trim() || null,
      },
      "InBody record added.",
    );
    setWeightKg("");
    setBodyFatPct("");
    setMuscleKg("");
    setInbodyMeasuredAt("");
    setInbodyNote("");
  }

  async function setStatus(entryId: string, status: ProgressStatus, note?: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const requestBody: Record<string, unknown> = {
        action: "set_status",
        memberId,
        entryId,
        status,
      };
      if (typeof note === "string") requestBody.note = note.trim() || null;
      const res = await fetch("/api/frontdesk/member-progress", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(payload?.error || ("Failed to update status"));
      setMessage("Status updated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fdGlassSubPanel" style={{ marginTop: 6, padding: 10, background: "rgba(255,255,255,.96)" }}>
      <div className="kvLabel">{zh ? "??脣漲蝞∠?" : "Member Progress Desk"}</div>
      <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>
        {zh ? `撠情嚗?{memberName || memberId}` : `Member: ${memberName || memberId}`}
      </p>
      <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
        {zh ? `?脰?銝剔璅?${activeGoalCount} / ?脰?銝凋?璆?${activeTaskCount}` : `Active goals ${activeGoalCount} / Active tasks ${activeTaskCount}`}
      </p>
      {error ? <p className="sub" style={{ marginTop: 8, color: "#c2410c" }}>{error}</p> : null}
      {message ? <p className="sub" style={{ marginTop: 8, color: "#0b6b3a" }}>{message}</p> : null}
      {loading ? <p className="sub" style={{ marginTop: 8 }}>{zh ? "頛銝?.." : "Loading..."}</p> : null}
      {!available ? (
        <p className="sub" style={{ marginTop: 8 }}>
          {"Progress table is unavailable. Apply latest migrations first."}
        </p>
      ) : null}

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
          <div className="kvLabel">{"Status Filter"}</div>
          <div className="actions" style={{ marginTop: 8 }}>
            {(["all", "active", "completed", "archived"] as ProgressStatusFilter[]).map((status) => (
              <button
                key={status}
                type="button"
                className={statusFilter === status ? "fdPillBtn fdPillBtnPrimary" : "fdPillBtn"}
                onClick={() => setStatusFilter(status)}
              >
                {statusFilterLabel(status, zh)}
              </button>
            ))}
          </div>
        </div>

        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
          <div className="kvLabel">{zh ? "?晷?格?" : "Assign Goal"}</div>
          <div style={{ marginTop: 6, display: "grid", gap: 8 }}>
            <input className="input" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder={zh ? "?格?璅?" : "Goal title"} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <input className="input" inputMode="decimal" value={goalTargetValue} onChange={(e) => setGoalTargetValue(e.target.value)} placeholder={"Target value"} />
              <input className="input" value={goalUnit} onChange={(e) => setGoalUnit(e.target.value)} placeholder={zh ? "?桐?" : "Unit"} />
              <input className="input" type="date" value={goalDueAt} onChange={(e) => setGoalDueAt(e.target.value)} />
            </div>
            <textarea className="input" rows={2} value={goalNote} onChange={(e) => setGoalNote(e.target.value)} placeholder={zh ? "?酉嚗憛恬?" : "Note (optional)"} />
            <div className="actions" style={{ marginTop: 0 }}>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={saving || !available} onClick={() => void createGoal()}>
                {zh ? "?啣??格?" : "Add Goal"}
              </button>
            </div>
          </div>
        </div>

        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
          <div className="kvLabel">{zh ? "?晷雿平" : "Assign Task"}</div>
          <div style={{ marginTop: 6, display: "grid", gap: 8 }}>
            <input className="input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder={zh ? "雿平璅?" : "Task title"} />
            <input className="input" type="date" value={taskDueAt} onChange={(e) => setTaskDueAt(e.target.value)} />
            <textarea className="input" rows={2} value={taskNote} onChange={(e) => setTaskNote(e.target.value)} placeholder={zh ? "雿平隤芣?嚗憛恬?" : "Task note (optional)"} />
            <div className="actions" style={{ marginTop: 0 }}>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={saving || !available} onClick={() => void createTask()}>
                {zh ? "?啣?雿平" : "Add Task"}
              </button>
            </div>
          </div>
        </div>

        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
          <div className="kvLabel">{zh ? "?啣? InBody" : "Add InBody"}</div>
          <div style={{ marginTop: 6, display: "grid", gap: 8, gridTemplateColumns: "repeat(4, minmax(120px, 1fr))" }}>
            <input className="input" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder={zh ? "擃? kg" : "Weight kg"} />
            <input className="input" inputMode="decimal" value={bodyFatPct} onChange={(e) => setBodyFatPct(e.target.value)} placeholder={zh ? "擃? %" : "Body fat %"} />
            <input className="input" inputMode="decimal" value={muscleKg} onChange={(e) => setMuscleKg(e.target.value)} placeholder={zh ? "????kg" : "Muscle kg"} />
            <input className="input" type="datetime-local" value={inbodyMeasuredAt} onChange={(e) => setInbodyMeasuredAt(e.target.value)} />
          </div>
          <textarea className="input" rows={2} style={{ marginTop: 8 }} value={inbodyNote} onChange={(e) => setInbodyNote(e.target.value)} placeholder={zh ? "?酉嚗憛恬?" : "Note (optional)"} />
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" disabled={saving || !available} onClick={() => void createInBody()}>
              {zh ? "?啣? InBody" : "Add InBody"}
            </button>
          </div>
        </div>

        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
          <div className="kvLabel">{"Recent Feedback"}</div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className={onlyMemberFeedback ? "fdPillBtn fdPillBtnPrimary" : "fdPillBtn"}
              onClick={() => setOnlyMemberFeedback((prev) => !prev)}
            >
              {zh ? "?芰???" : "Member only"}
            </button>
          </div>
          {feedbackItems.length === 0 ? (
            <p className="sub" style={{ marginTop: 8 }}>{onlyMemberFeedback ? (zh ? "目前沒有會員回報。" : "No member feedback yet.") : (zh ? "目前沒有回報註記。" : "No feedback notes yet.")}</p>
          ) : (
            <div className="fdListStack" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
              {feedbackItems.map((item) => (
                <div key={`${item.kind}-${item.id}`} className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.9)" }}>
                  <p className="sub" style={{ marginTop: 0, marginBottom: 0, fontWeight: 700 }}>
                    [{item.kind === "goal" ? (zh ? "?格?" : "Goal") : (zh ? "雿平" : "Task")}] {item.title}
                  </p>
                  <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                    {statusLabel(item.status, zh)} | {feedbackActorLabel(item.actorRole, zh)} | {fmtDateTime(item.createdAt)}
                  </p>
                  <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>{item.note}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
          <div className="kvLabel">{zh ? "?桀??格?" : "Current Goals"}</div>
          {filteredGoals.length === 0 ? (
            <p className="sub" style={{ marginTop: 8 }}>{"No goals in current filter."}</p>
          ) : (
            <div className="fdListStack" style={{ marginTop: 8, maxHeight: 280, overflowY: "auto" }}>
              {filteredGoals.map((item) => (
                <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.9)" }}>
                  <p className="sub" style={{ marginTop: 0, fontWeight: 700 }}>{item.title}</p>
                  <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                    {"Status"}: {statusLabel(item.status, zh)} | {zh ? "?唳?" : "Due"}: {fmtDate(item.dueAt)}
                  </p>
                  <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                    {zh ? "?格?" : "Target"}: {item.targetValue ?? "-"} {item.unit || ""}
                  </p>
                  <textarea
                    className="input"
                    rows={2}
                    style={{ marginTop: 8 }}
                    value={noteByEntry[item.id] ?? ""}
                    onChange={(event) => setNoteByEntry((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    placeholder={zh ? "?/?酉嚗憛恬?" : "Feedback note (optional)"}
                  />
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void setStatus(item.id, "active", noteByEntry[item.id] || "")}>
                      {"Active"}
                    </button>
                    <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void setStatus(item.id, "completed", noteByEntry[item.id] || "")}>
                      {zh ? "摰?" : "Completed"}
                    </button>
                    <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void setStatus(item.id, "archived", noteByEntry[item.id] || "")}>
                      {zh ? "撠?" : "Archive"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
          <div className="kvLabel">{zh ? "?桀?雿平" : "Current Tasks"}</div>
          {filteredTasks.length === 0 ? (
            <p className="sub" style={{ marginTop: 8 }}>{"No tasks in current filter."}</p>
          ) : (
            <div className="fdListStack" style={{ marginTop: 8, maxHeight: 280, overflowY: "auto" }}>
              {filteredTasks.map((item) => (
                <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.9)" }}>
                  <p className="sub" style={{ marginTop: 0, fontWeight: 700 }}>{item.title}</p>
                  <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                    {"Status"}: {statusLabel(item.status, zh)} | {zh ? "?唳?" : "Due"}: {fmtDate(item.dueAt)}
                  </p>
                  <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                    {zh ? "靘?" : "Source"}: {item.source === "coach" ? (zh ? "?毀/瑹" : "Coach/Staff") : (zh ? "?" : "Member")}
                  </p>
                  <textarea
                    className="input"
                    rows={2}
                    style={{ marginTop: 8 }}
                    value={noteByEntry[item.id] ?? ""}
                    onChange={(event) => setNoteByEntry((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    placeholder={zh ? "?/?酉嚗憛恬?" : "Feedback note (optional)"}
                  />
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void setStatus(item.id, "active", noteByEntry[item.id] || "")}>
                      {"Active"}
                    </button>
                    <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void setStatus(item.id, "completed", noteByEntry[item.id] || "")}>
                      {zh ? "摰?" : "Completed"}
                    </button>
                    <button type="button" className="fdPillBtn" disabled={saving} onClick={() => void setStatus(item.id, "archived", noteByEntry[item.id] || "")}>
                      {zh ? "撠?" : "Archive"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
          <div className="kvLabel">{"Recent InBody"}</div>
          {inbody.length === 0 ? (
            <p className="sub" style={{ marginTop: 8 }}>{"No InBody records yet."}</p>
          ) : (
            <div className="fdListStack" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
              {inbody.slice(0, 12).map((item) => (
                <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.9)" }}>
                  <p className="sub" style={{ marginTop: 0, marginBottom: 0, fontWeight: 700 }}>{fmtDateTime(item.measuredAt)}</p>
                  <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>
                    W {item.weightKg ?? "-"}kg | BF {item.bodyFatPct ?? "-"}% | M {item.muscleKg ?? "-"}kg
                  </p>
                  {item.note ? <p className="sub" style={{ marginTop: 4, marginBottom: 0 }}>{item.note}</p> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


