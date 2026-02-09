"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

interface ServiceItem {
  id: string;
  code: string;
  name: string;
  durationMinutes: number;
  capacity: number;
  isActive: boolean;
}

export default function ManagerServicesPage() {
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [code, setCode] = useState("personal_training");
  const [name, setName] = useState("Personal Training");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [capacity, setCapacity] = useState("1");
  const [isActive, setIsActive] = useState(true);

  const codeToExisting = useMemo(() => {
    const map = new Map<string, ServiceItem>();
    for (const s of items) map.set(s.code, s);
    return map;
  }, [items]);

  async function load() {
    setError(null);
    const res = await fetch("/api/manager/services");
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load services failed");
      return;
    }
    setItems((payload.items || []) as ServiceItem[]);
  }

  useEffect(() => {
    void load();
  }, []);

  function loadIntoForm(s: ServiceItem) {
    setCode(s.code);
    setName(s.name);
    setDurationMinutes(String(s.durationMinutes));
    setCapacity(String(s.capacity));
    setIsActive(s.isActive);
    setError(null);
    setMessage(null);
  }

  async function upsert(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const res = await fetch("/api/manager/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name,
        durationMinutes: Number(durationMinutes),
        capacity: Number(capacity),
        isActive,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Save failed");
      return;
    }
    setMessage(`Saved: ${payload.service?.code || code}`);
    await load();
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Services (Course Templates)</h1>
      <p>
        <a href="/manager">Back to dashboard</a>
      </p>

      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
      {message ? <p style={{ color: "green" }}>{message}</p> : null}

      <section style={{ marginTop: 16 }}>
        <h2>Upsert Service</h2>
        <form onSubmit={upsert}>
          <p>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="code" required />
          </p>
          <p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" required />
          </p>
          <p>
            <input
              type="number"
              min="1"
              step="1"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              placeholder="durationMinutes"
              required
            />
          </p>
          <p>
            <input
              type="number"
              min="1"
              step="1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="capacity"
              required
            />
          </p>
          <p>
            <label>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> isActive
            </label>
          </p>
          <button type="submit">{codeToExisting.has(code) ? "Update" : "Create"}</button>
          <button type="button" onClick={() => void load()} style={{ marginLeft: 8 }}>
            Reload
          </button>
        </form>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Service List</h2>
        <ul>
          {items.map((s) => (
            <li key={s.code}>
              <button type="button" onClick={() => loadIntoForm(s)} style={{ marginRight: 8 }}>
                Edit
              </button>
              {s.code} | {s.name} | {s.durationMinutes}m | cap {s.capacity} | active {s.isActive ? "1" : "0"}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

