"use client";

import { FormEvent, useEffect, useState } from "react";

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

export default function FrontdeskBookingsPage() {
  const [items, setItems] = useState<BookingItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [coachId, setCoachId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
  const [updateId, setUpdateId] = useState("");
  const [updateStatus, setUpdateStatus] = useState("cancelled");
  const [updateReason, setUpdateReason] = useState("");

  async function load() {
    setError(null);
    const [bookingsRes, servicesRes] = await Promise.all([fetch("/api/bookings"), fetch("/api/services")]);
    const bookingsPayload = await bookingsRes.json();
    const servicesPayload = await servicesRes.json();

    if (!bookingsRes.ok) {
      setError(bookingsPayload?.error || "Load bookings failed");
      return;
    }
    if (!servicesRes.ok) {
      setError(servicesPayload?.error || "Load services failed");
      return;
    }
    setItems((bookingsPayload.items || []) as BookingItem[]);
    setServices((servicesPayload.items || []) as ServiceItem[]);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createBooking(event: FormEvent) {
    event.preventDefault();
    setError(null);
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
    await load();
  }

  async function updateBooking(event: FormEvent) {
    event.preventDefault();
    setError(null);
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
    await load();
  }

  return (
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Frontdesk Bookings</h1>
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

        <form onSubmit={createBooking}>
          <h2>Create Booking</h2>
          <p><input value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="memberId" required /></p>
          <p><input value={coachId} onChange={(e) => setCoachId(e.target.value)} placeholder="coachId (optional)" /></p>
          <p>
            <select value={serviceName} onChange={(e) => setServiceName(e.target.value)} required>
              <option value="">Select service</option>
              {services.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.durationMinutes}m)
                </option>
              ))}
            </select>
          </p>
          <p><input value={startsAt} onChange={(e) => setStartsAt(e.target.value)} placeholder="startsAt (ISO)" required /></p>
          <p><input value={endsAt} onChange={(e) => setEndsAt(e.target.value)} placeholder="endsAt (ISO)" required /></p>
          <p><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" /></p>
          <button type="submit">Create</button>
        </form>

        <form onSubmit={updateBooking} style={{ marginTop: 20 }}>
          <h2>Cancel/Update Booking</h2>
          <p><input value={updateId} onChange={(e) => setUpdateId(e.target.value)} placeholder="bookingId" required /></p>
          <p>
            <select value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value)}>
              <option value="cancelled">cancelled</option>
              <option value="no_show">no_show</option>
              <option value="booked">booked</option>
              <option value="checked_in">checked_in</option>
              <option value="completed">completed</option>
            </select>
          </p>
          <p><input value={updateReason} onChange={(e) => setUpdateReason(e.target.value)} placeholder="reason (required)" required /></p>
          <button type="submit">Update</button>
        </form>

        <h2>Booking List</h2>
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              {new Date(item.starts_at).toLocaleString()} | {item.service_name} | {item.status} | bookingId: {item.id}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
