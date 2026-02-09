"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

const MemberSchema = z
  .object({
    full_name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    photo_url: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    consent_status: z.string().nullable().optional(),
    consent_signed_at: z.string().nullable().optional(),
  })
  .passthrough();

const MeResponseSchema = z
  .object({
    member: MemberSchema,
  })
  .passthrough();

type Member = z.infer<typeof MemberSchema>;

type FormState = {
  full_name: string;
  phone: string;
  photo_url: string;
  notes: string;
  consentAgree: boolean;
};

function toText(v: string | null | undefined) {
  return typeof v === "string" ? v : "";
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function MemberProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [member, setMember] = useState<Member | null>(null);

  const [form, setForm] = useState<FormState>({
    full_name: "",
    phone: "",
    photo_url: "",
    notes: "",
    consentAgree: false,
  });

  const consentAgreed = useMemo(() => {
    return (member?.consent_status ?? "").toLowerCase() === "agreed";
  }, [member]);

  const fetchMe = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/member/me", { cache: "no-store" });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof json === "object" && json && "error" in json && typeof (json as { error?: unknown }).error === "string"
            ? (json as { error: string }).error
            : "Failed to load member profile";
        throw new Error(msg);
      }

      const parsed = MeResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error("Invalid /api/member/me response");

      const m = parsed.data.member;
      setMember(m);
      setForm({
        full_name: toText(m.full_name),
        phone: toText(m.phone),
        photo_url: toText(m.photo_url),
        notes: toText(m.notes),
        consentAgree: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load member profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        full_name: form.full_name,
        phone: form.phone,
        photo_url: form.photo_url,
        notes: form.notes,
        consent_agree: form.consentAgree === true,
      };

      const res = await fetch("/api/member/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof json === "object" && json && "error" in json && typeof (json as { error?: unknown }).error === "string"
            ? (json as { error: string }).error
            : "Update failed";
        throw new Error(msg);
      }

      setSuccess("已儲存");
      await fetchMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">PROFILE</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            個人資料
          </h1>

          <div className="actions" style={{ marginTop: 10 }}>
            <a className="btn" href="/member">
              返回會員中心
            </a>
            <a className="btn btnPrimary" href="/member/bookings">
              我的預約
            </a>
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

          {success ? (
            <p className="sub" style={{ marginTop: 12, color: "var(--success, #0b6b3a)" }}>
              {success}
            </p>
          ) : null}

          {!loading && member ? (
            <>
              <div className="card" style={{ marginTop: 14, padding: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                  <div>
                    <div className="kvLabel" style={{ marginBottom: 6 }}>
                      現況
                    </div>
                    <div className="sub">full_name: {toText(member.full_name) || "-"}</div>
                    <div className="sub">phone: {toText(member.phone) || "-"}</div>
                    <div className="sub">photo_url: {toText(member.photo_url) || "-"}</div>
                    <div className="sub">notes: {toText(member.notes) || "-"}</div>
                    <div className="sub">consent_status: {toText(member.consent_status) || "-"}</div>
                    <div className="sub">
                      consent_signed_at: {formatDateTime(member.consent_signed_at) || "-"}
                    </div>
                  </div>
                </div>
              </div>

              <form onSubmit={onSubmit} className="card" style={{ marginTop: 14, padding: 14 }}>
                <div className="kvLabel" style={{ marginBottom: 10 }}>
                  編輯
                </div>

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  姓名
                </label>
                <input
                  className="input"
                  value={form.full_name}
                  onChange={(ev) => setForm((s) => ({ ...s, full_name: ev.target.value }))}
                  placeholder="full_name"
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  電話
                </label>
                <input
                  className="input"
                  value={form.phone}
                  onChange={(ev) => setForm((s) => ({ ...s, phone: ev.target.value }))}
                  placeholder="phone"
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  照片 URL
                </label>
                <input
                  className="input"
                  value={form.photo_url}
                  onChange={(ev) => setForm((s) => ({ ...s, photo_url: ev.target.value }))}
                  placeholder="photo_url"
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  備註
                </label>
                <textarea
                  className="input"
                  value={form.notes}
                  onChange={(ev) => setForm((s) => ({ ...s, notes: ev.target.value }))}
                  placeholder="notes"
                  rows={4}
                />

                <div className="card" style={{ marginTop: 12, padding: 12 }}>
                  <label className="sub" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={consentAgreed ? true : form.consentAgree}
                      disabled={consentAgreed}
                      onChange={(ev) => setForm((s) => ({ ...s, consentAgree: ev.target.checked }))}
                    />
                    我已閱讀並同意
                    {consentAgreed ? (
                      <span className="sub" style={{ opacity: 0.8 }}>
                        (已同意，無法變更)
                      </span>
                    ) : null}
                  </label>
                  {!consentAgreed ? (
                    <div className="sub" style={{ marginTop: 6, opacity: 0.8 }}>
                      勾選後儲存會將 consent_status 設為 agreed，並將 consent_signed_at 設為目前時間。
                    </div>
                  ) : null}
                </div>

                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="btn btnPrimary" type="submit" disabled={saving}>
                    {saving ? "儲存中..." : "儲存"}
                  </button>
                  <button className="btn" type="button" onClick={() => void fetchMe()} disabled={saving}>
                    重新載入
                  </button>
                </div>
              </form>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

