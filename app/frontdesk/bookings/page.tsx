"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "../../i18n-provider";

interface BookingItem {
  id: string;
  member_id: string;
  coach_id: string | null;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string | null;
}

interface ServiceItem {
  code: string;
  name: string;
  durationMinutes: number;
  capacity: number;
}

function fmtDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function localDatetimeToIso(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export default function FrontdeskBookingsPage() {
  const searchParams = useSearchParams();
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [items, setItems] = useState<BookingItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);

  const [memberId, setMemberId] = useState("");
  const [coachId, setCoachId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [startsLocal, setStartsLocal] = useState("");
  const [endsLocal, setEndsLocal] = useState("");
  const [note, setNote] = useState("");

  const [updateId, setUpdateId] = useState("");
  const [updateStatus, setUpdateStatus] = useState("cancelled");
  const [updateReason, setUpdateReason] = useState("");

  function bookingStatusLabel(status: string) {
    if (!zh) return status;
    if (status === "booked") return "已預約";
    if (status === "checked_in") return "已報到";
    if (status === "completed") return "已完成";
    if (status === "cancelled") return "已取消";
    if (status === "no_show") return "未出席";
    return status;
  }

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()),
    [items],
  );

  async function load() {
    setLoading(true);
    setError(null);
    const [bookingsRes, servicesRes] = await Promise.all([fetch("/api/bookings"), fetch("/api/services")]);
    const bookingsPayload = await bookingsRes.json();
    const servicesPayload = await servicesRes.json();

    if (!bookingsRes.ok) {
      setError(bookingsPayload?.error || (zh ? "載入預約失敗" : "Load bookings failed"));
      setLoading(false);
      return;
    }
    if (!servicesRes.ok) {
      setError(servicesPayload?.error || (zh ? "載入服務失敗" : "Load services failed"));
      setLoading(false);
      return;
    }

    setItems((bookingsPayload.items || []) as BookingItem[]);
    setServices((servicesPayload.items || []) as ServiceItem[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const queryMemberId = (searchParams.get("memberId") || "").trim();
    if (!queryMemberId) return;
    setMemberId((prev) => prev || queryMemberId);
  }, [searchParams]);

  async function createBooking(event: FormEvent) {
    event.preventDefault();
    const startsAt = localDatetimeToIso(startsLocal);
    const endsAt = localDatetimeToIso(endsLocal);

    if (!startsAt || !endsAt) {
      setError(zh ? "請輸入有效的開始/結束時間" : "Please enter valid start/end time");
      return;
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setError(zh ? "結束時間必須晚於開始時間" : "End time must be after start time");
      return;
    }

    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          coachId: coachId || null,
          serviceName,
          startsAt,
          endsAt,
          note: note || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || (zh ? "建立預約失敗" : "Create booking failed"));
        return;
      }
      setMemberId("");
      setCoachId("");
      setServiceName("");
      setStartsLocal("");
      setEndsLocal("");
      setNote("");
      setMessage(`${zh ? "預約已建立" : "Booking created"}: ${payload?.booking?.id || "success"}`);
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function updateBooking(event: FormEvent) {
    event.preventDefault();
    setUpdating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(updateId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: updateStatus,
          reason: updateReason,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || (zh ? "更新預約失敗" : "Update booking failed"));
        return;
      }
      setUpdateReason("");
      setMessage(`${zh ? "預約已更新" : "Booking updated"}: ${updateId}`);
      await load();
    } finally {
      setUpdating(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "預約工作台" : "BOOKING ASSIST"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "櫃檯預約" : "Frontdesk Bookings"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "在同一個頁面建立預約、更新狀態並追蹤最新記錄。"
                : "Create bookings, apply status updates, and track the latest reservations from one workspace."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createBooking} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "建立預約" : "Create Booking"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder={zh ? "會員 ID" : "memberId"}
                className="input"
                required
              />
              <input
                value={coachId}
                onChange={(e) => setCoachId(e.target.value)}
                placeholder={zh ? "教練 ID（選填）" : "coachId (optional)"}
                className="input"
              />
              <select value={serviceName} onChange={(e) => setServiceName(e.target.value)} className="input" required>
                <option value="">{zh ? "選擇服務" : "Select service"}</option>
                {services.map((s) => (
                  <option key={s.code} value={s.code}>
                    {zh
                      ? `${s.name}（${s.durationMinutes} 分鐘 / 容量 ${s.capacity}）`
                      : `${s.name} (${s.durationMinutes}m / cap ${s.capacity})`}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={startsLocal}
                onChange={(e) => setStartsLocal(e.target.value)}
                className="input"
                required
              />
              <input
                type="datetime-local"
                value={endsLocal}
                onChange={(e) => setEndsLocal(e.target.value)}
                className="input"
                required
              />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={zh ? "備註" : "note"} className="input" />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={creating}>
              {creating ? (zh ? "建立中..." : "Creating...") : zh ? "建立" : "Create"}
            </button>
          </form>

          <form onSubmit={updateBooking} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "取消 / 更新預約" : "Cancel / Update Booking"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                value={updateId}
                onChange={(e) => setUpdateId(e.target.value)}
                placeholder={zh ? "預約 ID" : "bookingId"}
                className="input"
                required
              />
              <select value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value)} className="input">
                <option value="cancelled">{bookingStatusLabel("cancelled")}</option>
                <option value="no_show">{bookingStatusLabel("no_show")}</option>
                <option value="booked">{bookingStatusLabel("booked")}</option>
                <option value="checked_in">{bookingStatusLabel("checked_in")}</option>
                <option value="completed">{bookingStatusLabel("completed")}</option>
              </select>
              <input value={updateReason} onChange={(e) => setUpdateReason(e.target.value)} placeholder={zh ? "原因（必填）" : "reason (required)"} className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={updating}>
              {updating ? (zh ? "更新中..." : "Updating...") : zh ? "更新" : "Update"}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "預約清單" : "Booking List"}</h2>
          <div className="fdActionGrid">
            {loading ? (
              <div className="fdGlassSubPanel" style={{ padding: 14 }}>
                <p className="fdGlassText" style={{ marginTop: 0 }}>{zh ? "載入預約中..." : "Loading bookings..."}</p>
              </div>
            ) : null}
            {!loading && sortedItems.length === 0 ? (
              <div className="fdGlassSubPanel" style={{ padding: 14 }}>
                <p className="fdGlassText" style={{ marginTop: 0 }}>{zh ? "尚無預約資料。" : "No bookings yet."}</p>
              </div>
            ) : null}
            {!loading &&
              sortedItems.map((item) => (
                <article key={item.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 14 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{item.service_name}</h3>
                  <div className="fdDataGrid" style={{ marginTop: 8 }}>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "狀態" : "status"}: {bookingStatusLabel(item.status)}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "會員" : "member"}: {item.member_id}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "教練" : "coach"}: {item.coach_id || "-"}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "開始" : "start"}: {fmtDate(item.starts_at)}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "結束" : "end"}: {fmtDate(item.ends_at)}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "預約 ID" : "bookingId"}: {item.id}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "備註" : "note"}: {item.note || "-"}</p>
                  </div>
                </article>
              ))}
          </div>
        </section>
      </section>
    </main>
  );
}
