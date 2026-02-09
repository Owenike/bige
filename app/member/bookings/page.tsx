"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";

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

export default function MemberBookingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Booking[]>([]);

  const [edit, setEdit] = useState<Record<string, BookingEditState>>({});

  const fetchList = useCallback(async (s: string) => {
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
            : "Failed to load bookings";
        throw new Error(msg);
      }
      const parsed = ListSchema.safeParse(json);
      if (!parsed.success) throw new Error("Invalid /api/member/bookings response");

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
            // Keep existing reason, but refresh default suggested times.
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
      setError(e instanceof Error ? e.message : "Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList(status);
  }, [fetchList, status]);

  const statusOptions = useMemo(
    () => [
      { value: "", label: "全部" },
      { value: "booked", label: "booked" },
      { value: "checked_in", label: "checked_in" },
      { value: "cancelled", label: "cancelled" },
      { value: "completed", label: "completed" },
      { value: "no_show", label: "no_show" },
    ],
    [],
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
          : "Update failed";
      throw new Error(msg);
    }
  }

  async function onCancel(id: string) {
    const st = edit[id];
    const reason = st?.reason?.trim() ?? "";
    setEdit((p) => ({ ...p, [id]: { ...(p[id] ?? defaultEdit()), submitting: true, error: null } }));
    try {
      if (!reason) throw new Error("reason is required");
      await patchBooking(id, { action: "cancel", reason });
      await fetchList(status);
      setEdit((p) => ({ ...p, [id]: { ...(p[id] ?? defaultEdit()), submitting: false, error: null, reason: "" } }));
    } catch (e) {
      setEdit((p) => ({
        ...p,
        [id]: { ...(p[id] ?? defaultEdit()), submitting: false, error: e instanceof Error ? e.message : "Cancel failed" },
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
      if (!reason) throw new Error("reason is required");
      if (!startsIso || !endsIso) throw new Error("startsAt and endsAt are required");
      if (new Date(endsIso).getTime() <= new Date(startsIso).getTime()) throw new Error("endsAt must be after startsAt");
      await patchBooking(id, { action: "reschedule", reason, startsAt: startsIso, endsAt: endsIso });
      await fetchList(status);
      setEdit((p) => ({ ...p, [id]: { ...(p[id] ?? defaultEdit()), submitting: false, error: null, reason: "" } }));
    } catch (e) {
      setEdit((p) => ({
        ...p,
        [id]: {
          ...(p[id] ?? defaultEdit()),
          submitting: false,
          error: e instanceof Error ? e.message : "Reschedule failed",
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
          <div className="kvLabel">BOOKINGS</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            我的預約
          </h1>
          <p className="sub">可依狀態篩選，並可取消或改期（需填 reason；距離開始 120 分鐘內不可修改）。</p>

          <div className="actions" style={{ marginTop: 10 }}>
            <a className="btn" href="/member">
              返回會員中心
            </a>
            <a className="btn" href="/member/profile">
              個人資料
            </a>
            <button className="btn btnPrimary" type="button" onClick={() => void fetchList(status)} disabled={loading}>
              重新整理
            </button>
          </div>

          <div className="card" style={{ marginTop: 12, padding: 12 }}>
            <label className="sub" style={{ display: "block", marginBottom: 6 }}>
              status filter
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
              載入中...
            </p>
          ) : null}

          {error ? (
            <p className="sub" style={{ marginTop: 12, color: "var(--danger, #b00020)" }}>
              {error}
            </p>
          ) : null}

          {!loading && items.length === 0 ? (
            <p className="sub" style={{ marginTop: 12 }}>
              目前沒有預約。
            </p>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 12 }}>
            {items.map((b) => {
              const editable = canModifyByTime(b.starts_at);
              const st = edit[b.id] ?? defaultEdit();
              const reasonOk = st.reason.trim().length > 0;

              return (
                <div key={b.id} className="card" style={{ padding: 14 }}>
                  <div className="kvLabel">BOOKING</div>
                  <div className="sub" style={{ marginTop: 6 }}>
                    id: {b.id}
                  </div>
                  <div className="sub">service: {b.service_name ?? "-"}</div>
                  <div className="sub">starts_at: {fmt(b.starts_at)}</div>
                  <div className="sub">ends_at: {fmt(b.ends_at)}</div>
                  <div className="sub">status: {b.status ?? "-"}</div>
                  <div className="sub">note: {b.note ?? "-"}</div>
                  <div className="sub" style={{ marginTop: 6, opacity: 0.85 }}>
                    可修改: {editable ? "是" : `否（距離開始 < ${CANCEL_OR_RESCHEDULE_LOCK_MINUTES} 分鐘）`}
                  </div>

                  <div className="card" style={{ marginTop: 10, padding: 12 }}>
                    <label className="sub" style={{ display: "block", marginBottom: 6 }}>
                      reason (必填)
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
                      placeholder="請輸入原因"
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
                      title={!editable ? "距離開始 120 分鐘內不可取消" : !reasonOk ? "請先填 reason" : ""}
                    >
                      {st.submitting ? "處理中..." : "取消"}
                    </button>
                  </div>

                  <div className="card" style={{ marginTop: 10, padding: 12 }}>
                    <div className="kvLabel" style={{ marginBottom: 8 }}>
                      改期
                    </div>
                    <label className="sub" style={{ display: "block", marginBottom: 6 }}>
                      startsAt
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
                      endsAt
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
                        title={!editable ? "距離開始 120 分鐘內不可改期" : !reasonOk ? "請先填 reason" : ""}
                      >
                        {st.submitting ? "處理中..." : "改期"}
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

