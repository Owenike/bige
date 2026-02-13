"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
      setError(bookingsPayload?.error || "Load bookings failed");
      setLoading(false);
      return;
    }
    if (!servicesRes.ok) {
      setError(servicesPayload?.error || "Load services failed");
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
      setMessage(`Booking created: ${payload?.booking?.id || "success"}`);
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
        setError(payload?.error || "Update booking failed");
        return;
      }
      setUpdateReason("");
      setMessage(`Booking updated: ${updateId}`);
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
            <div className="fdEyebrow">BOOKING ASSIST</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Frontdesk Bookings
            </h1>
            <p className="fdGlassText">Create bookings, apply status updates, and track the latest reservations from one workspace.</p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createBooking} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Create Booking</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="memberId" className="input" required />
              <input value={coachId} onChange={(e) => setCoachId(e.target.value)} placeholder="coachId (optional)" className="input" />
              <select value={serviceName} onChange={(e) => setServiceName(e.target.value)} className="input" required>
                <option value="">Select service</option>
                {services.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.durationMinutes}m / cap {s.capacity})
                  </option>
                ))}
              </select>
              <input value={startsAt} onChange={(e) => setStartsAt(e.target.value)} placeholder="startsAt (ISO)" className="input" required />
              <input value={endsAt} onChange={(e) => setEndsAt(e.target.value)} placeholder="endsAt (ISO)" className="input" required />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="input" />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </button>
          </form>

          <form onSubmit={updateBooking} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Cancel / Update Booking</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={updateId} onChange={(e) => setUpdateId(e.target.value)} placeholder="bookingId" className="input" required />
              <select value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value)} className="input">
                <option value="cancelled">cancelled</option>
                <option value="no_show">no_show</option>
                <option value="booked">booked</option>
                <option value="checked_in">checked_in</option>
                <option value="completed">completed</option>
              </select>
              <input value={updateReason} onChange={(e) => setUpdateReason(e.target.value)} placeholder="reason (required)" className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={updating}>
              {updating ? "Updating..." : "Update"}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">Booking List</h2>
          <div className="fdActionGrid">
            {loading ? (
              <div className="fdGlassSubPanel" style={{ padding: 14 }}>
                <p className="fdGlassText" style={{ marginTop: 0 }}>Loading bookings...</p>
              </div>
            ) : null}
            {!loading && sortedItems.length === 0 ? (
              <div className="fdGlassSubPanel" style={{ padding: 14 }}>
                <p className="fdGlassText" style={{ marginTop: 0 }}>No bookings yet.</p>
              </div>
            ) : null}
            {!loading &&
              sortedItems.map((item) => (
                <article key={item.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 14 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{item.service_name}</h3>
                  <div className="fdDataGrid" style={{ marginTop: 8 }}>
                    <p className="sub" style={{ marginTop: 0 }}>status: {item.status}</p>
                    <p className="sub" style={{ marginTop: 0 }}>member: {item.member_id}</p>
                    <p className="sub" style={{ marginTop: 0 }}>coach: {item.coach_id || "-"}</p>
                    <p className="sub" style={{ marginTop: 0 }}>start: {fmtDate(item.starts_at)}</p>
                    <p className="sub" style={{ marginTop: 0 }}>end: {fmtDate(item.ends_at)}</p>
                    <p className="sub" style={{ marginTop: 0 }}>bookingId: {item.id}</p>
                    <p className="sub" style={{ marginTop: 0 }}>note: {item.note || "-"}</p>
                  </div>
                </article>
              ))}
          </div>
        </section>
      </section>
    </main>
  );
}
