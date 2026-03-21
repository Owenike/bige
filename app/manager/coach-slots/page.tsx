"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";
import type { TherapistBlockItem, TherapistManagementPayload, TherapistRecurringSchedule, TherapistSummary } from "../../../types/therapist-scheduling";

const DAY_OPTIONS = [
  { value: 0, labelEn: "Sunday", labelZh: "週日" },
  { value: 1, labelEn: "Monday", labelZh: "週一" },
  { value: 2, labelEn: "Tuesday", labelZh: "週二" },
  { value: 3, labelEn: "Wednesday", labelZh: "週三" },
  { value: 4, labelEn: "Thursday", labelZh: "週四" },
  { value: 5, labelEn: "Friday", labelZh: "週五" },
  { value: 6, labelEn: "Saturday", labelZh: "週六" },
];

const EMPTY_THERAPISTS: TherapistSummary[] = [];
const EMPTY_SCHEDULES: TherapistRecurringSchedule[] = [];
const EMPTY_BLOCKS: TherapistBlockItem[] = [];

function toDateInputValue(input: Date) {
  return input.toISOString().slice(0, 10);
}

function toDatetimeLocalValue(input: Date) {
  const next = new Date(input.getTime() - input.getTimezoneOffset() * 60 * 1000);
  return next.toISOString().slice(0, 16);
}

function localDatetimeToIso(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function statusBadgeStyle(active: boolean) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    color: active ? "#155e75" : "#7c2d12",
    background: active ? "rgba(34,197,94,0.16)" : "rgba(251,146,60,0.18)",
  } as const;
}

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function dayLabel(dayOfWeek: number, zh: boolean) {
  const found = DAY_OPTIONS.find((item) => item.value === dayOfWeek);
  if (!found) return String(dayOfWeek);
  return zh ? found.labelZh : found.labelEn;
}

function scheduleStatusLabel(isActive: boolean, zh: boolean) {
  if (zh) return isActive ? "啟用中" : "已停用";
  return isActive ? "Active" : "Inactive";
}

function blockStatusLabel(status: string, zh: boolean) {
  if (!zh) return status;
  if (status === "active") return "啟用中";
  if (status === "cancelled") return "已取消";
  return status;
}

function blockTypeLabel(blockType: TherapistBlockItem["blockType"], zh: boolean) {
  if (!zh) return blockType;
  if (blockType === "time_off") return "休假";
  if (blockType === "offsite") return "外出";
  if (blockType === "other") return "其他";
  return "封鎖";
}

export default function ManagerCoachSlotsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [payload, setPayload] = useState<TherapistManagementPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedCoachId, setSelectedCoachId] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingBlock, setSavingBlock] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const laterTomorrow = new Date(tomorrow.getTime() + 60 * 60 * 1000);

  const [scheduleBranchId, setScheduleBranchId] = useState("");
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(tomorrow.getDay());
  const [scheduleStartTime, setScheduleStartTime] = useState("09:00");
  const [scheduleEndTime, setScheduleEndTime] = useState("17:00");
  const [scheduleTimezone, setScheduleTimezone] = useState("Asia/Taipei");
  const [scheduleEffectiveFrom, setScheduleEffectiveFrom] = useState(toDateInputValue(tomorrow));
  const [scheduleEffectiveUntil, setScheduleEffectiveUntil] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");

  const [blockBranchId, setBlockBranchId] = useState("");
  const [blockStartsLocal, setBlockStartsLocal] = useState(toDatetimeLocalValue(tomorrow));
  const [blockEndsLocal, setBlockEndsLocal] = useState(toDatetimeLocalValue(laterTomorrow));
  const [blockReason, setBlockReason] = useState("manager_unavailable");
  const [blockType, setBlockType] = useState<TherapistBlockItem["blockType"]>("blocked");
  const [blockNote, setBlockNote] = useState("");

  const branches = payload?.branches || [];
  const coaches = payload?.therapists || EMPTY_THERAPISTS;

  const selectedCoach = useMemo(
    () => coaches.find((item) => item.id === selectedCoachId) || coaches[0] || null,
    [coaches, selectedCoachId],
  );

  const schedules = useMemo(
    () => (payload?.schedules || EMPTY_SCHEDULES).filter((item) => item.coachId === selectedCoach?.id),
    [payload?.schedules, selectedCoach?.id],
  );
  const blocks = useMemo(
    () =>
      (payload?.blocks || EMPTY_BLOCKS)
        .filter((item) => item.coachId === selectedCoach?.id)
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()),
    [payload?.blocks, selectedCoach?.id],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/manager/therapists", { cache: "no-store" });
      const next = (await parseJsonSafe(response)) as TherapistManagementPayload & { error?: string };
      if (!response.ok) throw new Error(next.error || "Failed to load coach availability");
      setPayload(next);
      setSelectedCoachId((current) => current || next.therapists[0]?.id || "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load coach availability");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedCoach) return;
    const nextBranchId = selectedCoach.primaryBranchId || selectedCoach.branchIds[0] || "";
    setScheduleBranchId(nextBranchId);
    setBlockBranchId(nextBranchId);
  }, [selectedCoach]);

  async function createSchedule() {
    if (!selectedCoach) return;
    setSavingSchedule(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/manager/therapist-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachId: selectedCoach.id,
          branchId: scheduleBranchId || null,
          dayOfWeek: scheduleDayOfWeek,
          startTime: scheduleStartTime,
          endTime: scheduleEndTime,
          timezone: scheduleTimezone,
          effectiveFrom: scheduleEffectiveFrom || null,
          effectiveUntil: scheduleEffectiveUntil || null,
          note: scheduleNote || null,
        }),
      });
      const next = await parseJsonSafe(response);
      if (!response.ok) throw new Error(String(next?.error || "Failed to create recurring availability"));
      setMessage(zh ? "已建立固定可排時段。" : "Recurring availability created.");
      setScheduleNote("");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create recurring availability");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function toggleSchedule(item: TherapistRecurringSchedule) {
    setWorkingId(item.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/manager/therapist-schedules/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isActive: !item.isActive,
        }),
      });
      const next = await parseJsonSafe(response);
      if (!response.ok) throw new Error(String(next?.error || "Failed to update recurring availability"));
      setMessage(zh ? "已更新固定可排時段。" : "Recurring availability updated.");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update recurring availability");
    } finally {
      setWorkingId(null);
    }
  }

  async function createBlock() {
    if (!selectedCoach) return;
    setSavingBlock(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/frontdesk/coach-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coachId: selectedCoach.id,
          branchId: blockBranchId || null,
          startsAt: localDatetimeToIso(blockStartsLocal),
          endsAt: localDatetimeToIso(blockEndsLocal),
          reason: blockReason,
          note: blockNote || null,
          blockType,
        }),
      });
      const next = await parseJsonSafe(response);
      if (!response.ok) throw new Error(String(next?.error || "Failed to create blocked time"));
      setMessage(zh ? "已建立不可排時段。" : "Blocked time created.");
      setBlockNote("");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create blocked time");
    } finally {
      setSavingBlock(false);
    }
  }

  async function toggleBlock(item: TherapistBlockItem) {
    setWorkingId(item.id);
    setError(null);
    setMessage(null);
    try {
      const nextStatus = item.status === "active" ? "cancelled" : "active";
      const response = await fetch(`/api/frontdesk/coach-blocks/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          reason: nextStatus === "cancelled" ? "manager_cancel" : "manager_reactivate",
        }),
      });
      const next = await parseJsonSafe(response);
      if (!response.ok) throw new Error(String(next?.error || "Failed to update blocked time"));
      setMessage(zh ? "已更新不可排時段。" : "Blocked time updated.");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update blocked time");
    } finally {
      setWorkingId(null);
    }
  }

  function coachTitle(item: TherapistSummary | null) {
    return item?.displayName || item?.id.slice(0, 8) || (zh ? "選擇教練" : "Select coach");
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "排班 / 不可排管理" : "AVAILABILITY / BLOCKS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "教練供給側可用性規則" : "Coach Availability Rules"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "這一頁只負責管理教練固定可排時段與不可排例外時段。教練主資料、服務規則、營運權限與前台排課流程都不在這裡維護。"
                : "This page only manages recurring coach availability and blocked time exceptions. Coach master data, service rules, operations policy, and frontdesk booking flows stay elsewhere."}
            </p>
            <div className="actions" style={{ marginTop: 14 }}>
              <Link className="fdPillBtn" href="/manager">
                {zh ? "回後台首頁" : "Back to dashboard"}
              </Link>
              <Link className="fdPillBtn" href="/manager/therapists">
                {zh ? "教練主資料" : "Coach master data"}
              </Link>
              <Link className="fdPillBtn" href="/manager/services">
                {zh ? "服務項目" : "Services"}
              </Link>
              <Link className="fdPillBtn" href="/manager/settings/operations">
                {zh ? "營運 / 權限" : "Operations & permissions"}
              </Link>
            </div>
          </div>
        </section>

        {message ? (
          <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }} data-coach-slots-message>
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <section className="fdTwoCol" style={{ alignItems: "start" }}>
          <aside className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "教練清單" : "Coaches"}</h2>
            <p className="fdGlassText" style={{ marginBottom: 12 }}>
              {zh
                ? "先選教練，再查看或更新該教練的固定可排時段與不可排例外。"
                : "Select a coach first, then review and update recurring availability and blocked-time exceptions."}
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              {coaches.map((coach) => {
                const active = selectedCoach?.id === coach.id;
                return (
                  <button
                    key={coach.id}
                    type="button"
                    data-coach-slot-coach={coach.id}
                    onClick={() => setSelectedCoachId(coach.id)}
                    style={{
                      textAlign: "left",
                      borderRadius: 18,
                      border: active ? "1px solid rgba(23,94,120,0.45)" : "1px solid rgba(15,23,42,0.08)",
                      background: active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.72)",
                      padding: 12,
                      boxShadow: active ? "0 18px 40px rgba(23,94,120,0.16)" : "0 10px 24px rgba(15,23,42,0.08)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <strong>{coach.displayName || coach.id.slice(0, 8)}</strong>
                      <span style={statusBadgeStyle(coach.isActive)}>{coach.isActive ? "Active" : "Inactive"}</span>
                    </div>
                    <div className="sub" style={{ marginTop: 6 }}>
                      {zh ? "主分館" : "Primary branch"}: {coach.primaryBranchName || (zh ? "未設定" : "Not set")}
                    </div>
                    <div className="sub" style={{ marginTop: 4 }}>
                      {zh ? "分館覆蓋" : "Branch coverage"}: {coach.branchLinks.length}
                    </div>
                  </button>
                );
              })}
              {!loading && coaches.length === 0 ? <p className="fdGlassText">{zh ? "找不到教練。" : "No coaches found."}</p> : null}
              {loading ? <p className="fdGlassText">{zh ? "載入中..." : "Loading..."}</p> : null}
            </div>
          </aside>

          <section style={{ display: "grid", gap: 16 }}>
            <section className="fdGlassSubPanel" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                <div>
                  <h2 className="sectionTitle">{coachTitle(selectedCoach)}</h2>
                  <p className="fdGlassText">
                    {zh
                      ? "這裡只維護供給側可用性規則：固定每週可排時段，以及不可排 / 休假 / 封鎖例外。"
                      : "This page only maintains supply-side availability rules: recurring weekly slots and blocked-time exceptions."}
                  </p>
                </div>
                <div className="sub">
                  {zh ? "主分館" : "Primary branch"}: {selectedCoach?.primaryBranchName || (zh ? "未設定" : "Not set")}
                </div>
              </div>
            </section>

            <section className="fdTwoCol" style={{ alignItems: "start" }}>
              <article className="fdGlassSubPanel" style={{ padding: 16 }}>
                <h2 className="sectionTitle">{zh ? "固定可排時段" : "Recurring availability"}</h2>
                <p className="fdGlassText" style={{ marginBottom: 12 }}>
                  {zh
                    ? "維護每週固定可排的時段。這些規則屬於供給側設定，不屬於教練主資料。"
                    : "Maintain weekly recurring availability windows. These rules belong to supply-side scheduling, not coach master data."}
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  <select data-schedule-branch className="input" value={scheduleBranchId} onChange={(event) => setScheduleBranchId(event.target.value)}>
                    <option value="">{zh ? "（無分館）" : "(No branch)"}</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                  <select data-schedule-day className="input" value={scheduleDayOfWeek} onChange={(event) => setScheduleDayOfWeek(Number(event.target.value))}>
                    {DAY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {zh ? option.labelZh : option.labelEn}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    <input data-schedule-start className="input" type="time" value={scheduleStartTime} onChange={(event) => setScheduleStartTime(event.target.value)} />
                    <input data-schedule-end className="input" type="time" value={scheduleEndTime} onChange={(event) => setScheduleEndTime(event.target.value)} />
                  </div>
                  <input data-schedule-timezone className="input" value={scheduleTimezone} onChange={(event) => setScheduleTimezone(event.target.value)} />
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    <input data-schedule-effective-from className="input" type="date" value={scheduleEffectiveFrom} onChange={(event) => setScheduleEffectiveFrom(event.target.value)} />
                    <input data-schedule-effective-until className="input" type="date" value={scheduleEffectiveUntil} onChange={(event) => setScheduleEffectiveUntil(event.target.value)} />
                  </div>
                  <input
                    data-schedule-note
                    className="input"
                    value={scheduleNote}
                    onChange={(event) => setScheduleNote(event.target.value)}
                    placeholder={zh ? "備註（例如：平日固定班）" : "Note (for example: weekday recurring slot)"}
                  />
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button data-create-schedule type="button" className="fdPillBtn fdPillBtnPrimary" disabled={!selectedCoach || savingSchedule} onClick={() => void createSchedule()}>
                    {savingSchedule ? (zh ? "建立中..." : "Creating...") : zh ? "建立固定時段" : "Create recurring slot"}
                  </button>
                </div>

                <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                  {schedules.map((item) => {
                    const branchName = branches.find((branch) => branch.id === item.branchId)?.name || item.branchId || "-";
                    return (
                      <article key={item.id} className="fdGlassSubPanel" data-schedule-id={item.id} style={{ padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <strong>{dayLabel(item.dayOfWeek, zh)} · {item.startTime.slice(0, 5)} - {item.endTime.slice(0, 5)}</strong>
                          <span style={statusBadgeStyle(item.isActive)}>{scheduleStatusLabel(item.isActive, zh)}</span>
                        </div>
                        <div className="sub" style={{ marginTop: 6 }}>{zh ? "分館" : "Branch"}: {branchName}</div>
                        <div className="sub" style={{ marginTop: 4 }}>{zh ? "時區" : "Timezone"}: {item.timezone}</div>
                        <div className="sub" style={{ marginTop: 4 }}>
                          {zh ? "生效區間" : "Effective range"}: {item.effectiveFrom || "-"} ~ {item.effectiveUntil || "-"}
                        </div>
                        <div className="sub" style={{ marginTop: 4 }}>{zh ? "備註" : "Note"}: {item.note || "-"}</div>
                          <button
                            data-schedule-toggle={item.id}
                            type="button"
                          className="fdPillBtn"
                          style={{ marginTop: 10 }}
                          disabled={workingId === item.id}
                          onClick={() => void toggleSchedule(item)}
                        >
                          {workingId === item.id
                            ? zh ? "更新中..." : "Updating..."
                            : item.isActive
                              ? zh ? "停用時段" : "Deactivate"
                              : zh ? "重新啟用" : "Activate"}
                        </button>
                      </article>
                    );
                  })}
                  {!loading && schedules.length === 0 ? (
                    <p className="fdGlassText">{zh ? "這位教練目前沒有固定可排時段。" : "No recurring availability for this coach yet."}</p>
                  ) : null}
                </div>
              </article>

              <article className="fdGlassSubPanel" style={{ padding: 16 }}>
                <h2 className="sectionTitle">{zh ? "不可排 / 例外時段" : "Blocked time / exceptions"}</h2>
                <p className="fdGlassText" style={{ marginBottom: 12 }}>
                  {zh
                    ? "維護休假、封鎖、外出等例外不可排時段。這些資料直接影響前台是否能排進某個時間。"
                    : "Maintain time-off, blocked, or offsite exceptions. These records directly affect whether frontdesk can book a time range."}
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  <select data-block-branch className="input" value={blockBranchId} onChange={(event) => setBlockBranchId(event.target.value)}>
                    <option value="">{zh ? "（無分館）" : "(No branch)"}</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    <input data-block-start className="input" type="datetime-local" value={blockStartsLocal} onChange={(event) => setBlockStartsLocal(event.target.value)} />
                    <input data-block-end className="input" type="datetime-local" value={blockEndsLocal} onChange={(event) => setBlockEndsLocal(event.target.value)} />
                  </div>
                  <input data-block-reason className="input" value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder={zh ? "原因（必填）" : "Reason (required)"} />
                  <select data-block-type className="input" value={blockType} onChange={(event) => setBlockType(event.target.value as TherapistBlockItem["blockType"])}>
                    <option value="blocked">{zh ? "封鎖" : "blocked"}</option>
                    <option value="time_off">{zh ? "休假" : "time_off"}</option>
                    <option value="offsite">{zh ? "外出" : "offsite"}</option>
                    <option value="other">{zh ? "其他" : "other"}</option>
                  </select>
                  <input
                    data-block-note
                    className="input"
                    value={blockNote}
                    onChange={(event) => setBlockNote(event.target.value)}
                    placeholder={zh ? "備註（例如：臨時請假）" : "Note (for example: temporary leave)"}
                  />
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button data-create-block type="button" className="fdPillBtn fdPillBtnPrimary" disabled={!selectedCoach || savingBlock} onClick={() => void createBlock()}>
                    {savingBlock ? (zh ? "建立中..." : "Creating...") : zh ? "建立不可排時段" : "Create blocked time"}
                  </button>
                </div>

                <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                  {blocks.map((item) => {
                    const branchName = branches.find((branch) => branch.id === item.branchId)?.name || item.branchId || "-";
                    const active = item.status === "active";
                    return (
                      <article key={item.id} className="fdGlassSubPanel" data-block-id={item.id} style={{ padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <strong>{new Date(item.startsAt).toLocaleString()} - {new Date(item.endsAt).toLocaleString()}</strong>
                          <span style={statusBadgeStyle(active)}>{blockStatusLabel(item.status, zh)}</span>
                        </div>
                        <div className="sub" style={{ marginTop: 6 }}>{zh ? "類型" : "Type"}: {blockTypeLabel(item.blockType, zh)}</div>
                        <div className="sub" style={{ marginTop: 4 }}>{zh ? "分館" : "Branch"}: {branchName}</div>
                        <div className="sub" style={{ marginTop: 4 }}>{zh ? "原因" : "Reason"}: {item.reason}</div>
                        <div className="sub" style={{ marginTop: 4 }}>{zh ? "備註" : "Note"}: {item.note || "-"}</div>
                        <button
                          data-block-toggle={item.id}
                          type="button"
                          className="fdPillBtn"
                          style={{ marginTop: 10 }}
                          disabled={workingId === item.id}
                          onClick={() => void toggleBlock(item)}
                        >
                          {workingId === item.id
                            ? zh ? "更新中..." : "Updating..."
                            : active
                              ? zh ? "取消不可排" : "Cancel block"
                              : zh ? "重新啟用" : "Reactivate"}
                        </button>
                      </article>
                    );
                  })}
                  {!loading && blocks.length === 0 ? (
                    <p className="fdGlassText">{zh ? "這位教練目前沒有不可排例外時段。" : "No blocked time entries for this coach yet."}</p>
                  ) : null}
                </div>
              </article>
            </section>

            <section className="fdGlassSubPanel" style={{ padding: 16 }}>
              <h2 className="sectionTitle">{zh ? "這頁不負責的事項" : "Out of scope for this page"}</h2>
              <p className="fdGlassText">
                {zh
                  ? "這頁不維護教練主資料、服務項目、堂次 / 扣課規則、權限政策、候補名單、外部整合，也不承擔前台排課建立流程。"
                  : "This page does not maintain coach master data, services, entitlement rules, permission policy, waitlists, external integrations, or the frontdesk booking flow."}
              </p>
              <div className="actions" style={{ marginTop: 12 }}>
                <Link className="fdPillBtn" href="/manager/therapists">
                  {zh ? "教練主資料" : "Coach master data"}
                </Link>
                <Link className="fdPillBtn" href="/manager/services">
                  {zh ? "服務項目" : "Services"}
                </Link>
                <Link className="fdPillBtn" href="/manager/plans">
                  {zh ? "堂次 / 規則" : "Plan rules"}
                </Link>
                <Link className="fdPillBtn" href="/manager/settings/operations">
                  {zh ? "營運 / 權限" : "Operations & permissions"}
                </Link>
              </div>
            </section>
          </section>
        </section>
      </section>
    </main>
  );
}
