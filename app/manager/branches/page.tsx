"use client";

import { FormEvent, useEffect, useState } from "react";

interface BranchItem {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
}

export default function ManagerBranchesPage() {
  const [items, setItems] = useState<BranchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [isActive, setIsActive] = useState(true);

  async function load() {
    setError(null);
    const res = await fetch("/api/manager/branches");
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load branches failed");
      return;
    }
    setItems((payload.items || []) as BranchItem[]);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const res = await fetch("/api/manager/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        code: code || null,
        address: address || null,
        isActive,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Create failed");
      return;
    }

    setMessage(`Created: ${payload.branch?.name || name}`);
    setName("");
    setCode("");
    setAddress("");
    setIsActive(true);
    await load();
  }

  return (
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Branches</h1>
        <p>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
        {message ? <p style={{ color: "green" }}>{message}</p> : null}

        <section style={{ marginTop: 16 }}>
          <h2>Create Branch</h2>
          <form onSubmit={create}>
            <p>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" required />
            </p>
            <p>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="code (optional)" />
            </p>
            <p>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="address (optional)" />
            </p>
            <p>
              <label>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> isActive
              </label>
            </p>
            <button type="submit">Create</button>
            <button type="button" onClick={() => void load()} style={{ marginLeft: 8 }}>
              Reload
            </button>
          </form>
        </section>

        <section style={{ marginTop: 16 }}>
          <h2>Branch List</h2>
          <ul>
            {items.map((b) => (
              <li key={b.id}>
                {b.name} | {b.code || "-"} | active {b.is_active ? "1" : "0"} | id {b.id}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
