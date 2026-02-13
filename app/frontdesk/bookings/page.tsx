"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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

export default function FrontdeskBookingsPage() {
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
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");

  const [updateId, setUpdateId] = useState("");
  const [updateStatus, setUpdateStatus] = useState("cancelled");
  const [updateReason, setUpdateReason] = useState("");

  function bookingStatusLabel(status: string) {
    if (!zh) return status;
    if (status === "booked") return "\u5df2\u9810\u7d04";
    if (status === "checked_in") return "\u5df2\u5831\u5230";
    if (status === "completed") return "\u5df2\u5b8c\u6210";
    if (status === "cancelled") return "\u5df2\u53d6\u6d88";
    if (status === "no_show") return "\u672a\u51fa\u5e2d";
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
      setError(bookingsPayload?.error || (zh ? "\u8f09\u5165\u9810\u7d04\u5931\u6557" : "Load bookings failed"));
      setLoading(false);
      return;
    }
    if (!servicesRes.ok) {
      setError(servicesPayload?.error || (zh ? "\u8f09\u5165\u670d\u52d9\u5931\u6557" : "Load services failed"));
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

  async function createBooking(event: FormEvent) {
    event.preventDefault();
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
        setError(payload?.error || "Create booking failed");
        return;
      }
      setMemberId("");
      setCoachId("");
      setServiceName("");
      setStartsAt("");
      setEndsAt("");
      setNote("");
      setMessage(`${zh ? "\u9810\u7d04\u5df2\u5efa\u7acb" : "Booking created"}: ${payload?.booking?.id || "success"}`);
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
        setError(payload?.error || (zh ? "\u66f4\u65b0\u9810\u7d04\u5931\u6557" : "Update booking failed"));
        return;
      }
      setUpdateReason("");
      setMessage(`${zh ? "\u9810\u7d04\u5df2\u66f4\u65b0" : "Booking updated"}: ${updateId}`);
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
            <div className="fdEyebrow">{zh ? "\u9810\u7d04\u5de5\u4f5c\u53f0" : "BOOKING ASSIST"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u6ac3\u6aaf\u9810\u7d04" : "Frontdesk Bookings"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u5728\u540c\u4e00\u500b\u9801\u9762\u5efa\u7acb\u9810\u7d04\u3001\u66f4\u65b0\u72c0\u614b\u4e26\u8ffd\u8e64\u6700\u65b0\u8a18\u9304\u3002"
                : "Create bookings, apply status updates, and track the latest reservations from one workspace."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createBooking} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u5efa\u7acb\u9810\u7d04" : "Create Booking"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="memberId" className="input" required />
              <input value={coachId} onChange={(e) => setCoachId(e.target.value)} placeholder={zh ? "coachId（選填）" : "coachId (optional)"} className="input" />
              <select value={serviceName} onChange={(e) => setServiceName(e.target.value)} className="input" required>
                <option value="">{zh ? "\u9078\u64c7\u670d\u52d9" : "Select service"}</option>
                {services.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.durationMinutes}m / cap {s.capacity})
                  </option>
                ))}
              </select>
              <input value={startsAt} onChange={(e) => setStartsAt(e.target.value)} placeholder={zh ? "startsAt（ISO）" : "startsAt (ISO)"} className="input" required />
              <input value={endsAt} onChange={(e) => setEndsAt(e.target.value)} placeholder={zh ? "endsAt（ISO）" : "endsAt (ISO)"} className="input" required />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={zh ? "\u5099\u8a3b" : "note"} className="input" />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={creating}>
              {creating ? (zh ? "\u5efa\u7acb\u4e2d..." : "Creating...") : zh ? "\u5efa\u7acb" : "Create"}
            </button>
          </form>

          <form onSubmit={updateBooking} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u53d6\u6d88 / \u66f4\u65b0\u9810\u7d04" : "Cancel / Update Booking"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={updateId} onChange={(e) => setUpdateId(e.target.value)} placeholder="bookingId" className="input" required />
              <select value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value)} className="input">
                <option value="cancelled">{bookingStatusLabel("cancelled")}</option>
                <option value="no_show">{bookingStatusLabel("no_show")}</option>
                <option value="booked">{bookingStatusLabel("booked")}</option>
                <option value="checked_in">{bookingStatusLabel("checked_in")}</option>
                <option value="completed">{bookingStatusLabel("completed")}</option>
              </select>
              <input value={updateReason} onChange={(e) => setUpdateReason(e.target.value)} placeholder={zh ? "\u539f\u56e0\uff08\u5fc5\u586b\uff09" : "reason (required)"} className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={updating}>
              {updating ? (zh ? "\u66f4\u65b0\u4e2d..." : "Updating...") : zh ? "\u66f4\u65b0" : "Update"}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u9810\u7d04\u6e05\u55ae" : "Booking List"}</h2>
          <div className="fdActionGrid">
            {loading ? (
              <div className="fdGlassSubPanel" style={{ padding: 14 }}>
                <p className="fdGlassText" style={{ marginTop: 0 }}>{zh ? "\u8f09\u5165\u9810\u7d04\u4e2d..." : "Loading bookings..."}</p>
              </div>
            ) : null}
            {!loading && sortedItems.length === 0 ? (
              <div className="fdGlassSubPanel" style={{ padding: 14 }}>
                <p className="fdGlassText" style={{ marginTop: 0 }}>{zh ? "\u5c1a\u7121\u9810\u7d04\u8cc7\u6599\u3002" : "No bookings yet."}</p>
              </div>
            ) : null}
            {!loading &&
              sortedItems.map((item) => (
                <article key={item.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 14 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{item.service_name}</h3>
                  <div className="fdDataGrid" style={{ marginTop: 8 }}>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u72c0\u614b" : "status"}: {bookingStatusLabel(item.status)}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u6703\u54e1" : "member"}: {item.member_id}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u6559\u7df4" : "coach"}: {item.coach_id || "-"}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u958b\u59cb" : "start"}: {fmtDate(item.starts_at)}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u7d50\u675f" : "end"}: {fmtDate(item.ends_at)}</p>
                    <p className="sub" style={{ marginTop: 0 }}>bookingId: {item.id}</p>
                    <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5099\u8a3b" : "note"}: {item.note || "-"}</p>
                  </div>
                </article>
              ))}
          </div>
        </section>
      </section>
    </main>
  );
}
