"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ManagerMemberPackageItem, ManagerPackageTemplateItem, ManagerPackagesResponse } from "../../../types/booking-commerce";

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string } | string;
  message?: string;
};

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as ApiEnvelope<unknown>;
  if (typeof body.error === "string" && body.error) return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") return body.error.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

async function requestJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | T | null;
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, "Request failed"));
  }
  if (payload && typeof payload === "object" && "data" in payload && payload.data) {
    return payload.data as T;
  }
  return payload as T;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function ManagerPackagesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ManagerPackageTemplateItem[]>([]);
  const [memberPackages, setMemberPackages] = useState<ManagerMemberPackageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [form, setForm] = useState({
    code: "massage_pack_6",
    name: "Recovery Pack 6",
    description: "Six recovery sessions for repeat care.",
    planType: "coach_pack" as "entry_pass" | "coach_pack",
    totalSessions: "6",
    validDays: "90",
    priceAmount: "7800",
    serviceScope: "",
    isActive: true,
  });

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedId) || null,
    [selectedId, templates],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const payload = await requestJson<ManagerPackagesResponse>("/api/manager/packages");
      setTemplates(payload.templates || []);
      setMemberPackages(payload.memberPackages || []);
      if (!selectedId && payload.templates?.[0]) {
        setSelectedId(payload.templates[0].id);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load packages");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await requestJson("/api/manager/packages", {
        method: "POST",
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          description: form.description,
          planType: form.planType,
          totalSessions: Number(form.totalSessions),
          validDays: form.validDays ? Number(form.validDays) : null,
          priceAmount: Number(form.priceAmount),
          serviceScope: form.serviceScope
            .split(",")
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean),
          isActive: form.isActive,
        }),
      });
      setMessage("Package template saved.");
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save package template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">PACKAGE FLOW</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>Package Templates & Issued Passes</h1>
            <p className="fdGlassText">
              Keep package templates, issued customer passes, remaining sessions, reserved sessions, and expiry in one place so booking reserve / consume / release stays inspectable.
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createTemplate} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Create Package Template</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input className="input" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} placeholder="code" required />
              <input className="input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Template name" required />
              <input className="input" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Description" />
              <select className="input" value={form.planType} onChange={(event) => setForm((current) => ({ ...current, planType: event.target.value as "entry_pass" | "coach_pack" }))}>
                <option value="coach_pack">Coach / therapist pack</option>
                <option value="entry_pass">Entry pass</option>
              </select>
              <input className="input" type="number" min="1" value={form.totalSessions} onChange={(event) => setForm((current) => ({ ...current, totalSessions: event.target.value }))} placeholder="Total sessions" />
              <input className="input" type="number" min="1" value={form.validDays} onChange={(event) => setForm((current) => ({ ...current, validDays: event.target.value }))} placeholder="Valid days" />
              <input className="input" type="number" min="0" value={form.priceAmount} onChange={(event) => setForm((current) => ({ ...current, priceAmount: event.target.value }))} placeholder="Price amount" />
              <input className="input" value={form.serviceScope} onChange={(event) => setForm((current) => ({ ...current, serviceScope: event.target.value }))} placeholder="service codes or names, comma separated" />
              <label className="sub">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /> Template active
              </label>
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>
              {saving ? "Saving..." : "Save Template"}
            </button>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Package Templates</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {templates.map((item) => (
                <article
                  key={item.id}
                  className="fdGlassSubPanel"
                  style={{
                    padding: 12,
                    border: item.id === selectedId ? "1px solid rgba(17,17,17,0.24)" : undefined,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    setSelectedId(item.id);
                    setForm({
                      code: item.code,
                      name: item.name,
                      description: item.description || "",
                      planType: item.planType,
                      totalSessions: String(item.totalSessions),
                      validDays: item.validDays === null ? "" : String(item.validDays),
                      priceAmount: String(item.priceAmount),
                      serviceScope: item.serviceScope.join(", "),
                      isActive: item.isActive,
                    });
                  }}
                >
                  <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{item.name}</h3>
                  <p className="sub" style={{ marginTop: 4 }}>{item.code} • {item.planType}</p>
                  <p className="sub" style={{ marginTop: 4 }}>
                    {item.totalSessions} sessions • {item.validDays ?? "-"} days • {formatMoney(item.priceAmount)}
                  </p>
                  <p className="sub" style={{ marginTop: 4 }}>
                    Scope: {item.serviceScope.length ? item.serviceScope.join(", ") : "All services"}
                  </p>
                  <p className="sub" style={{ marginTop: 4 }}>Status: {item.isActive ? "active" : "inactive"}</p>
                </article>
              ))}
              {!templates.length ? <div className="fdGlassText">{loading ? "Loading..." : "No package templates yet."}</div> : null}
            </div>

            {selectedTemplate ? <div className="sub" style={{ marginTop: 14 }}>Click a template to load it into the form above, then save to update the existing code.</div> : null}
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">Issued Customer Packages</h2>
          <div className="fdActionGrid">
            {memberPackages.map((item) => (
              <article key={item.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{item.memberName}</h3>
                <p className="sub" style={{ marginTop: 4 }}>{item.packageName} {item.packageCode ? `• ${item.packageCode}` : ""}</p>
                <p className="sub" style={{ marginTop: 4 }}>
                  Remaining {item.remainingSessions} • Reserved {item.reservedSessions} • Total {item.totalSessions ?? "-"}
                </p>
                <p className="sub" style={{ marginTop: 4 }}>
                  {item.branchName || "All branches"} • expires {formatDate(item.expiresAt)}
                </p>
                <p className="sub" style={{ marginTop: 4 }}>Status: {item.status}</p>
              </article>
            ))}
            {!memberPackages.length ? <div className="fdGlassText">{loading ? "Loading..." : "No issued packages in scope."}</div> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
