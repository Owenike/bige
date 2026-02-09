"use client";

import { FormEvent, useState } from "react";

interface MemberItem {
  id: string;
  full_name: string;
  phone: string | null;
  store_id: string | null;
}

export default function FrontdeskMemberSearchPage() {
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [items, setItems] = useState<MemberItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    const res = await fetch(`/api/members?q=${encodeURIComponent(q)}`);
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Search failed");
      return;
    }
    setItems((payload.items || []) as MemberItem[]);
  }

  async function createMember(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: name, phone }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Create failed");
      return;
    }
    setName("");
    setPhone("");
    await search();
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Frontdesk Member Search</h1>
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      <form onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name/phone" />
        <button type="submit">Search</button>
      </form>

      <h2>Create Member</h2>
      <form onSubmit={createMember}>
        <p><input value={name} onChange={(e) => setName(e.target.value)} placeholder="full name" required /></p>
        <p><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="phone" /></p>
        <button type="submit">Create</button>
      </form>

      <h2>Results</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.full_name} | {item.phone || "-"} | memberId: {item.id}
          </li>
        ))}
      </ul>
    </main>
  );
}
