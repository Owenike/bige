"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useI18n } from "../../i18n-provider";

const CANCEL_OR_RESCHEDULE_LOCK_MINUTES = 120;

const BookingSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  coach_id: z.string().nullable().optional(),
  service_name: z.string().nullable().optional(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

const ListSchema = z.object({
  items: z.array(BookingSchema),
});

type Booking = z.infer<typeof BookingSchema>;

type BookingEditState = {
  reason: string;
  rescheduleStartsLocal: string;
  rescheduleEndsLocal: string;
  submitting: boolean;
  error: string | null;
};

function canModifyByTime(startsAtIso: string) {
  const starts = new Date(startsAtIso).getTime();
  if (Number.isNaN(starts)) return false;
  const lockAt = starts - CANCEL_OR_RESCHEDULE_LOCK_MINUTES * 60 * 1000;
  return Date.now() < lockAt;
}

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(local: string) {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function fmt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function statusLabel(value: string, lang: "zh" | "en") {
  const map: Record<string, { zh: string; en: string }> = {
    "": { zh: "全部", en: "All" },
    booked: { zh: "已預約", en: "Booked" },
    checked_in: { zh: "已報到", en: "Checked In" },
    cancelled: { zh: "已取消", en: "Cancelled" },
    completed: { zh: "已完成", en: "Completed" },
    no_show: { zh: "未到場", en: "No Show" },
  };
  return map[value]?.[lang] ?? value;
}

export default function MemberBookingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Booking[]>([]);

  const [edit, setEdit] = useState<Record<string, BookingEditState>>({});

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            title: "我的預約",
            desc: `可依狀態篩選，並可取消或改期（需填 reason；距離開始 ${CANCEL_OR_RESCHEDULE_LOCK_MINUTES} 分鐘內不可修改）。`,
            backMember: "返回會員中心",
            profile: "個人資料",
            reload: "重新整理",
            filter: "狀態篩選",
            loading: "載入中...",
            noData: "目前沒有預約資料",
            booking: "預約",
            service: "服務",
            startsAt: "開始時間",
            endsAt: "結束時間",
            status: "狀態",
            note: "備註",
            canModify: "可修改",
            cannotModify: `不可修改（距開始少於 ${CANCEL_OR_RESCHEDULE_LOCK_MINUTES} 分鐘）`,
            reason: "原因（必填）",
            reasonPh: "請輸入原因",
            cancel: "取消預約",
            reschedule: "改期",
            saving: "處理中...",
            startAt: "新開始時間",
            endAt: "新結束時間",
            lockTip: `距開始少於 ${CANCEL_OR_RESCHEDULE_LOCK_MINUTES} 分鐘不可操作`,
            reasonTip: "請先填寫原因",
            loadFail: "載入預約失敗",
            updateFail: "更新失敗",
            invalidResponse: "預約資料格式錯誤",
            requireReason: "reason is required",
            requireTime: "startsAt and endsAt are required",
            endAfterStart: "endsAt must be after startsAt",
          }
        : {
            title: "My Bookings",
            desc: `Filter by status and cancel/reschedule (reason required; cannot modify within ${CANCEL_OR_RESCHEDULE_LOCK_MINUTES} minutes before start).`,
            backMember: "Back to Member",
            profile: "Profile",
            reload: "Reload",
            filter: "Status Filter",
            loading: "Loading...",
            noData: "No bookings",
            booking: "Booking",
            service: "Service",
            startsAt: "Starts At",
            endsAt: "Ends At",
            status: "Status",
            note: "Note",
            canModify: "Can modify",
            cannotModify: `Cannot modify (< ${CANCEL_OR_RESCHEDULE_LOCK_MINUTES} mins before start)`,
            reason: "Reason (required)",
            reasonPh: "Enter reason",
            cancel: "Cancel",
            reschedule: "Reschedule",
            saving: "Processing...",
            startAt: "New startsAt",
            endAt: "New endsAt",
            lockTip: `Cannot modify within ${CANCEL_OR_RESCHEDULE_LOCK_MINUTES} minutes`,
            reasonTip: "Reason is required",
            loadFail: "Failed to load bookings",
            updateFail: "Update failed",
            invalidResponse: "Invalid /api/member/bookings response",
            requireReason: "reason is required",
            requireTime: "startsAt and endsAt are required",
            endAfterStart: "endsAt must be after startsAt",
          },
    [lang],
  );

  const fetchList = useCallback(
    async (s: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = s ? `?status=${encodeURIComponent(s)}` : "";
        const res = await fetch(`/api/member/bookings${qs}`, { cache: "no-store" });
        const json: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            typeof json === "object" && json && "error" in json && typeof (json as { error?: unknown }).error === "string"
              ? (json as { error: string }).error
              : t.loadFail;
          throw new Error(msg);
        }
        const parsed = ListSchema.safeParse(json);
        if (!parsed.success) throw new Error(t.invalidResponse);

        setItems(parsed.data.items);
        setEdit((prev) => {
          const next: Record<string, BookingEditState> = { ...prev };
          for (const b of parsed.data.items) {
            if (!next[b.id]) {
              next[b.id] = {
                reason: "",
                rescheduleStartsLocal: toLocalInputValue(b.starts_at),
                rescheduleEndsLocal: toLocalInputValue(b.ends_at),
                submitting: false,
                error: null,
              };
            } else {
              next[b.id] = {
                ...next[b.id],
                rescheduleStartsLocal: next[b.id].rescheduleStartsLocal || toLocalInputValue(b.starts_at),
                rescheduleEndsLocal: next[b.id].rescheduleEndsLocal || toLocalInputValue(b.ends_at),
              };
            }
          }
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : t.loadFail);
      } finally {
        setLoading(false);
      }
    },
    [t.invalidResponse, t.loadFail],
  );

  useEffect(() => {
    void fetchList(status);
  }, [fetchList, status]);

  const statusOptions = useMemo(
    () => [
      { value: "", label: statusLabel("", lang) },
      { value: "booked", label: statusLabel("booked", lang) },
      { value: "checked_in", label: statusLabel("checked_in", lang) },
      { value: "cancelled", label: statusLabel("cancelled", lang) },
      { value: "completed", label: statusLabel("completed", lang) },
      { value: "no_show", label: statusLabel("no_show", lang) },
    ],
    [lang],
  );

  async function patchBooking(id: string, body: { action: "cancel" | "reschedule"; reason: string; startsAt?: string; endsAt?: string }) {
    const res = await fetch(`/api/member/bookings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        typeof json === "object" && json && "error" in json && typeof (json as { error?: unknown }).error === "string"
          ? (json as { error: string }).error
          : t.updateFail;
      throw new Error(msg);
    }
  }

  async function onCancel(id: string) {
    const st = edit[id];
    const reason = st?.reason?.trim() ?? "";
    setEdit((p) => ({ ...p, [id]: { ...(p[id] ?? defaultEdit()), submitting: true, error: null } }));
    try {
      if (!reason) throw new Error(t.requireReason);
      await patchBooking(id, { action: "cancel", reason });
      await fetchList(status);
      setEdit((p) => ({ ...p, [id]: { ...(p[id] ?? defaultEdit()), submitting: false, error: null, reason: "" } }));
    } catch (e) {
      setEdit((p) => ({
        ...p,
        [id]: { ...(p[id] ?? defaultEdit()), submitting: false, error: e instanceof Error ? e.message : t.updateFail },
      }));
    }
  }

  async function onReschedule(id: string) {
    const st = edit[id];
    const reason = st?.reason?.trim() ?? "";
    const startsIso = st?.rescheduleStartsLocal ? fromLocalInputValue(st.rescheduleStartsLocal) : null;
    const endsIso = st?.rescheduleEndsLocal ? fromLocalInputValue(st.rescheduleEndsLocal) : null;

    setEdit((p) => ({ ...p, [id]: { ...(p[id] ?? defaultEdit()), submitting: true, error: null } }));
    try {
      if (!reason) throw new Error(t.requireReason);
      if (!startsIso || !endsIso) throw new Error(t.requireTime);
      if (new Date(endsIso).getTime() <= new Date(startsIso).getTime()) throw new Error(t.endAfterStart);
      await patchBooking(id, { action: "reschedule", reason, startsAt: startsIso, endsAt: endsIso });
      await fetchList(status);
      setEdit((p) => ({ ...p, [id]: { ...(p[id] ?? defaultEdit()), submitting: false, error: null, reason: "" } }));
    } catch (e) {
      setEdit((p) => ({
        ...p,
        [id]: {
          ...(p[id] ?? defaultEdit()),
          submitting: false,
          error: e instanceof Error ? e.message : t.updateFail,
        },
      }));
    }
  }

  function defaultEdit(): BookingEditState {
    return { reason: "", rescheduleStartsLocal: "", rescheduleEndsLocal: "", submitting: false, error: null };
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">{lang === "zh" ? "\u9810\u7d04" : "BOOKINGS"}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            {t.title}
          </h1>
          <p className="sub">{t.desc}</p>

          <div className="actions" style={{ marginTop: 10 }}>
            <a className="btn" href="/member">
              {t.backMember}
            </a>
            <a className="btn" href="/member/profile">
              {t.profile}
            </a>
            <button className="btn btnPrimary" type="button" onClick={() => void fetchList(status)} disabled={loading}>
              {t.reload}
            </button>
          </div>

          <div className="card" style={{ marginTop: 12, padding: 12 }}>
            <label className="sub" style={{ display: "block", marginBottom: 6 }}>
              {t.filter}
            </label>
            <select
              className="input"
              value={status}
              onChange={(ev) => {
                const v = ev.target.value;
                const next = new URLSearchParams(searchParams.toString());
                if (v) next.set("status", v);
                else next.delete("status");
                router.push(`/member/bookings?${next.toString()}`);
              }}
            >
              {statusOptions.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="sub" style={{ marginTop: 12 }}>
              {t.loading}
            </p>
          ) : null}

          {error ? (
            <p className="sub" style={{ marginTop: 12, color: "var(--danger, #b00020)" }}>
              {error}
            </p>
          ) : null}

          {!loading && items.length === 0 ? (
            <p className="sub" style={{ marginTop: 12 }}>
              {t.noData}
            </p>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 12 }}>
            {items.map((b) => {
              const editable = canModifyByTime(b.starts_at);
              const st = edit[b.id] ?? defaultEdit();
              const reasonOk = st.reason.trim().length > 0;

              return (
                <div key={b.id} className="card" style={{ padding: 14 }}>
                  <div className="kvLabel">{t.booking}</div>
                  <div className="sub" style={{ marginTop: 6 }}>
                    {lang === "zh" ? "ID" : "id"}: {b.id}
                  </div>
                  <div className="sub">
                    {t.service}: {b.service_name ?? "-"}
                  </div>
                  <div className="sub">
                    {t.startsAt}: {fmt(b.starts_at)}
                  </div>
                  <div className="sub">
                    {t.endsAt}: {fmt(b.ends_at)}
                  </div>
                  <div className="sub">
                    {t.status}: {statusLabel(b.status ?? "", lang)}
                  </div>
                  <div className="sub">
                    {t.note}: {b.note ?? "-"}
                  </div>
                  <div className="sub" style={{ marginTop: 6, opacity: 0.85 }}>
                    {editable ? t.canModify : t.cannotModify}
                  </div>

                  <div className="card" style={{ marginTop: 10, padding: 12 }}>
                    <label className="sub" style={{ display: "block", marginBottom: 6 }}>
                      {t.reason}
                    </label>
                    <input
                      className="input"
                      value={st.reason}
                      onChange={(ev) =>
                        setEdit((p) => ({
                          ...p,
                          [b.id]: { ...(p[b.id] ?? defaultEdit()), reason: ev.target.value, error: null },
                        }))
                      }
                      placeholder={t.reasonPh}
                    />
                    {st.error ? (
                      <div className="sub" style={{ marginTop: 8, color: "var(--danger, #b00020)" }}>
                        {st.error}
                      </div>
                    ) : null}
                  </div>

                  <div className="actions" style={{ marginTop: 10 }}>
                    <button
                      className="btn"
                      type="button"
                      disabled={!editable || !reasonOk || st.submitting}
                      onClick={() => void onCancel(b.id)}
                      title={!editable ? t.lockTip : !reasonOk ? t.reasonTip : ""}
                    >
                      {st.submitting ? t.saving : t.cancel}
                    </button>
                  </div>

                  <div className="card" style={{ marginTop: 10, padding: 12 }}>
                    <div className="kvLabel" style={{ marginBottom: 8 }}>
                      {t.reschedule}
                    </div>
                    <label className="sub" style={{ display: "block", marginBottom: 6 }}>
                      {t.startAt}
                    </label>
                    <input
                      className="input"
                      type="datetime-local"
                      value={st.rescheduleStartsLocal}
                      onChange={(ev) =>
                        setEdit((p) => ({
                          ...p,
                          [b.id]: {
                            ...(p[b.id] ?? defaultEdit()),
                            rescheduleStartsLocal: ev.target.value,
                            error: null,
                          },
                        }))
                      }
                    />

                    <label className="sub" style={{ display: "block", marginTop: 10, marginBottom: 6 }}>
                      {t.endAt}
                    </label>
                    <input
                      className="input"
                      type="datetime-local"
                      value={st.rescheduleEndsLocal}
                      onChange={(ev) =>
                        setEdit((p) => ({
                          ...p,
                          [b.id]: { ...(p[b.id] ?? defaultEdit()), rescheduleEndsLocal: ev.target.value, error: null },
                        }))
                      }
                    />

                    <div className="actions" style={{ marginTop: 10 }}>
                      <button
                        className="btn btnPrimary"
                        type="button"
                        disabled={!editable || !reasonOk || st.submitting}
                        onClick={() => void onReschedule(b.id)}
                        title={!editable ? t.lockTip : !reasonOk ? t.reasonTip : ""}
                      >
                        {st.submitting ? t.saving : t.reschedule}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
