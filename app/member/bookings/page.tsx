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

const MeSchema = z.object({
  role: z.string().nullable().optional(),
});

type Booking = z.infer<typeof BookingSchema>;

type BookingEditState = {
  reason: string;
  rescheduleStartsLocal: string;
  rescheduleEndsLocal: string;
  submitting: boolean;
  error: string | null;
};

type CreateBookingFormState = {
  serviceName: string;
  coachId: string;
  startsLocal: string;
  endsLocal: string;
  note: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
};

function getApiErrorMessage(payload: unknown, status: number, fallback: string, zh: boolean) {
  const body = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const nestedError = typeof body.error === "object" && body.error !== null ? (body.error as Record<string, unknown>) : null;
  const code =
    (typeof body.code === "string" && body.code) ||
    (nestedError && typeof nestedError.code === "string" ? nestedError.code : "");
  const rawMessage =
    (nestedError && typeof nestedError.message === "string" ? nestedError.message : "") ||
    (typeof body.message === "string" ? body.message : "") ||
    (typeof body.errorMessage === "string" ? body.errorMessage : "") ||
    (typeof body.legacyError === "string" ? body.legacyError : "") ||
    (typeof body.error === "string" ? body.error : "");

  if (status === 401 || code === "UNAUTHORIZED") {
    return zh ? "請登入會員帳號以查看個人預約。" : "Please sign in with a member account to view personal bookings.";
  }

  if (status === 403 && (code === "FORBIDDEN" || rawMessage === "Forbidden")) {
    return zh
      ? "目前登入帳號不是會員帳號，無法查看會員預約。"
      : "The current account is not a member account, so personal bookings cannot be shown.";
  }

  if (status === 404 && code === "ENTITLEMENT_NOT_FOUND") {
    return zh ? "找不到會員資料，請聯絡櫃檯確認帳號。" : "Member profile was not found. Please contact frontdesk.";
  }

  return rawMessage || fallback;
}

function mapCreateError(message: string, zh: boolean) {
  const lower = message.toLowerCase();
  if (lower.includes("service name")) return zh ? "請填寫課程 / 服務名稱" : "Please enter a service name.";
  if (lower.includes("customer name")) return zh ? "請填寫姓名" : "Please enter your name.";
  if (lower.includes("customer phone")) return zh ? "請填寫電話" : "Please enter your phone number.";
  if (lower.includes("start")) return zh ? "請選擇開始時間" : "Please choose a start time.";
  if (lower.includes("end")) return zh ? "請選擇結束時間" : "Please choose an end time.";
  if (lower.includes("future")) return zh ? "預約時間必須晚於現在" : "Booking time must be in the future.";
  if (lower.includes("conflict")) return zh ? "此時段已有預約，請改選其他時間。" : "This time conflicts with another booking.";
  return message || (zh ? "預約建立失敗，請稍後再試" : "Booking creation failed. Please try again later.");
}

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
    no_show: { zh: "未到", en: "No Show" },
  };
  return map[value]?.[lang] ?? value;
}

function defaultEdit(): BookingEditState {
  return { reason: "", rescheduleStartsLocal: "", rescheduleEndsLocal: "", submitting: false, error: null };
}

export default function MemberBookingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";
  const zh = lang === "zh";

  const [authChecked, setAuthChecked] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Booking[]>([]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateBookingFormState>({
    serviceName: "",
    coachId: "",
    startsLocal: "",
    endsLocal: "",
    note: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
  });
  const [edit, setEdit] = useState<Record<string, BookingEditState>>({});

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            eyebrow: "預約",
            title: "預約服務",
            desc: "免登入即可送出預約；若需要查看或取消個人預約，請登入會員帳號。",
            createTitle: "新增預約",
            createService: "課程 / 服務名稱",
            createCoach: "教練 ID（可選）",
            createStartsAt: "開始時間",
            createEndsAt: "結束時間",
            createNote: "備註",
            contactName: "聯絡姓名",
            contactPhone: "聯絡電話",
            contactEmail: "Email（可選）",
            createAction: "送出預約",
            creating: "送出中...",
            filter: "狀態篩選",
            myBookings: "我的預約",
            loading: "載入中...",
            noData: "尚無預約資料",
            booking: "預約",
            service: "服務",
            startsAt: "開始時間",
            endsAt: "結束時間",
            status: "狀態",
            note: "備註",
            canModify: "可修改",
            cannotModify: `不可修改（開始前 ${CANCEL_OR_RESCHEDULE_LOCK_MINUTES} 分鐘內）`,
            reason: "原因（必填）",
            reasonPh: "請輸入原因",
            cancel: "取消預約",
            reschedule: "改期",
            saving: "處理中...",
            startAt: "新的開始時間",
            endAt: "新的結束時間",
            lockTip: `開始前 ${CANCEL_OR_RESCHEDULE_LOCK_MINUTES} 分鐘內不可修改`,
            reasonTip: "請先填寫原因",
            loadFail: "載入預約失敗",
            updateFail: "更新失敗",
            invalidResponse: "預約資料格式不正確",
            requireReason: "請填寫原因",
            requireTime: "請選擇開始時間與結束時間",
            requireService: "請填寫課程 / 服務名稱",
            requireName: "請填寫姓名",
            requirePhone: "請填寫電話",
            endAfterStart: "結束時間必須晚於開始時間",
            createSuccess: "預約已送出",
          }
        : {
            eyebrow: "BOOKING",
            title: "Book a Service",
            desc: "You can submit a booking without signing in. Sign in as a member to view or cancel personal bookings.",
            createTitle: "Create Booking",
            createService: "Service Name",
            createCoach: "Coach ID (optional)",
            createStartsAt: "Starts At",
            createEndsAt: "Ends At",
            createNote: "Note",
            contactName: "Contact Name",
            contactPhone: "Contact Phone",
            contactEmail: "Email (optional)",
            createAction: "Submit Booking",
            creating: "Submitting...",
            filter: "Status Filter",
            myBookings: "My Bookings",
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
            requireReason: "Reason is required",
            requireTime: "Please choose a start and end time.",
            requireService: "Please enter a service name.",
            requireName: "Please enter your name.",
            requirePhone: "Please enter your phone number.",
            endAfterStart: "endsAt must be after startsAt",
            createSuccess: "Booking submitted",
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
          throw new Error(getApiErrorMessage(json, res.status, t.loadFail, zh));
        }
        const parsed = ListSchema.safeParse(json);
        if (!parsed.success) throw new Error(t.invalidResponse);

        setItems(parsed.data.items);
        setEdit((prev) => {
          const next: Record<string, BookingEditState> = { ...prev };
          for (const b of parsed.data.items) {
            next[b.id] = {
              ...(next[b.id] ?? defaultEdit()),
              rescheduleStartsLocal: next[b.id]?.rescheduleStartsLocal || toLocalInputValue(b.starts_at),
              rescheduleEndsLocal: next[b.id]?.rescheduleEndsLocal || toLocalInputValue(b.ends_at),
            };
          }
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : t.loadFail);
      } finally {
        setLoading(false);
      }
    },
    [t.invalidResponse, t.loadFail, zh],
  );

  useEffect(() => {
    let alive = true;
    async function loadAuthState() {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!alive) return;
        if (!res.ok) {
          setIsMember(false);
          setItems([]);
          return;
        }
        const json: unknown = await res.json().catch(() => ({}));
        const parsed = MeSchema.safeParse(json);
        const role = parsed.success ? parsed.data.role : null;
        setIsMember(role === "member" || role === "customer");
      } finally {
        if (alive) setAuthChecked(true);
      }
    }
    void loadAuthState();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!isMember) {
      setLoading(false);
      setError(null);
      setItems([]);
      return;
    }
    void fetchList(status);
  }, [authChecked, fetchList, isMember, status]);

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
      throw new Error(getApiErrorMessage(json, res.status, t.updateFail, zh));
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

  async function onCreateBooking() {
    setCreateBusy(true);
    setCreateError(null);
    setCreateMessage(null);
    try {
      const startsAt = fromLocalInputValue(createForm.startsLocal);
      const endsAt = fromLocalInputValue(createForm.endsLocal);
      if (!createForm.serviceName.trim()) throw new Error(t.requireService);
      if (!createForm.contactName.trim()) throw new Error(t.requireName);
      if (!createForm.contactPhone.trim()) throw new Error(t.requirePhone);
      if (!startsAt) throw new Error(zh ? "請選擇開始時間" : "Please choose a start time.");
      if (!endsAt) throw new Error(zh ? "請選擇結束時間" : "Please choose an end time.");
      if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw new Error(t.endAfterStart);

      const endpoint = isMember ? "/api/member/bookings" : "/api/public/bookings";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceName: createForm.serviceName.trim(),
          coachId: createForm.coachId.trim() || null,
          startsAt,
          endsAt,
          note: createForm.note.trim() || null,
          contactName: createForm.contactName.trim(),
          contactPhone: createForm.contactPhone.trim(),
          contactEmail: createForm.contactEmail.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(mapCreateError(getApiErrorMessage(payload, res.status, t.updateFail, zh), zh));

      setCreateMessage(t.createSuccess);
      setCreateForm({
        serviceName: "",
        coachId: "",
        startsLocal: "",
        endsLocal: "",
        note: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
      });
      if (isMember) await fetchList(status);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t.updateFail);
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">{t.eyebrow}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            {t.title}
          </h1>
          <p className="sub">{t.desc}</p>

          <div className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{t.createTitle}</div>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <input
                className="input"
                value={createForm.serviceName}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, serviceName: event.target.value }))}
                placeholder={t.createService}
              />
              <input
                className="input"
                value={createForm.coachId}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, coachId: event.target.value }))}
                placeholder={t.createCoach}
              />
              <input
                className="input"
                value={createForm.contactName}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, contactName: event.target.value }))}
                placeholder={t.contactName}
              />
              <input
                className="input"
                value={createForm.contactPhone}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, contactPhone: event.target.value }))}
                placeholder={t.contactPhone}
              />
              <input
                className="input"
                type="email"
                value={createForm.contactEmail}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
                placeholder={t.contactEmail}
              />
              <label className="sub" style={{ marginBottom: -4 }}>
                {t.createStartsAt}
              </label>
              <input
                className="input"
                type="datetime-local"
                value={createForm.startsLocal}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, startsLocal: event.target.value }))}
              />
              <label className="sub" style={{ marginBottom: -4 }}>
                {t.createEndsAt}
              </label>
              <input
                className="input"
                type="datetime-local"
                value={createForm.endsLocal}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, endsLocal: event.target.value }))}
              />
              <textarea
                className="input"
                value={createForm.note}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, note: event.target.value }))}
                placeholder={t.createNote}
                rows={2}
              />
            </div>
            {createError ? (
              <div className="sub" style={{ marginTop: 8, color: "var(--danger, #b00020)" }}>
                {createError}
              </div>
            ) : null}
            {createMessage ? (
              <div className="sub" style={{ marginTop: 8, color: "var(--success, #0b6b3a)" }}>
                {createMessage}
              </div>
            ) : null}
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn btnPrimary" type="button" onClick={() => void onCreateBooking()} disabled={createBusy}>
                {createBusy ? t.creating : t.createAction}
              </button>
            </div>
          </div>

          {isMember ? (
            <div className="card" style={{ marginTop: 12, padding: 12 }}>
              <div className="kvLabel" style={{ marginBottom: 8 }}>
                {t.myBookings}
              </div>
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
                  const qs = next.toString();
                  router.push(qs ? `/member/bookings?${qs}` : "/member/bookings");
                }}
              >
                {statusOptions.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {isMember && loading ? (
            <p className="sub" style={{ marginTop: 12 }}>
              {t.loading}
            </p>
          ) : null}

          {isMember && error ? (
            <p className="sub" style={{ marginTop: 12, color: "var(--danger, #b00020)" }}>
              {error}
            </p>
          ) : null}

          {isMember && !loading && items.length === 0 ? (
            <p className="sub" style={{ marginTop: 12 }}>
              {t.noData}
            </p>
          ) : null}

          {isMember ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 12 }}>
              {items.map((b) => {
                const editable = canModifyByTime(b.starts_at);
                const st = edit[b.id] ?? defaultEdit();
                const reasonOk = st.reason.trim().length > 0;

                return (
                  <div key={b.id} className="card" style={{ padding: 14 }}>
                    <div className="kvLabel">{t.booking}</div>
                    <div className="sub" style={{ marginTop: 6 }}>
                      id: {b.id}
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
          ) : null}
        </div>
      </section>
    </main>
  );
}
