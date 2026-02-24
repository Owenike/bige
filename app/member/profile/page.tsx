"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useI18n } from "../../i18n-provider";
import { MemberTabs } from "../_components/MemberTabs";

const MemberSchema = z
  .object({
    full_name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    emergency_contact_name: z.string().nullable().optional(),
    emergency_contact_phone: z.string().nullable().optional(),
    photo_url: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    consent_status: z.string().nullable().optional(),
    consent_signed_at: z.string().nullable().optional(),
    portal_status: z.string().nullable().optional(),
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
  email: string;
  address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
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
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [member, setMember] = useState<Member | null>(null);

  const [form, setForm] = useState<FormState>({
    full_name: "",
    phone: "",
    email: "",
    address: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    photo_url: "",
    notes: "",
    consentAgree: false,
  });

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            profile: "個人資料",
            backMember: "返回會員首頁",
            myBookings: "我的預約",
            loading: "載入中...",
            loadFail: "載入會員資料失敗",
            invalidResponse: "會員資料回應格式錯誤",
            updateFail: "更新失敗",
            updated: "已更新",
            current: "目前資料",
            edit: "編輯資料",
            fullName: "姓名",
            phone: "電話",
            email: "Email",
            address: "地址",
            emergencyName: "緊急聯絡人",
            emergencyPhone: "緊急聯絡電話",
            photoUrl: "照片網址",
            notes: "備註",
            consentStatus: "同意狀態",
            consentSignedAt: "同意時間",
            portalStatus: "會員入口狀態",
            agree: "我同意會員條款",
            alreadyAgreed: "（已同意）",
            agreeHint: "勾選後會把同意狀態設為 agreed，並寫入同意時間。",
            save: "儲存",
            refresh: "重新載入",
            saving: "儲存中...",
          }
        : {
            profile: "Profile",
            backMember: "Back to Member",
            myBookings: "My Bookings",
            loading: "Loading...",
            loadFail: "Failed to load member profile",
            invalidResponse: "Invalid /api/member/me response",
            updateFail: "Update failed",
            updated: "Updated",
            current: "Current",
            edit: "Edit",
            fullName: "Full Name",
            phone: "Phone",
            email: "Email",
            address: "Address",
            emergencyName: "Emergency Contact",
            emergencyPhone: "Emergency Phone",
            photoUrl: "Photo URL",
            notes: "Notes",
            consentStatus: "Consent Status",
            consentSignedAt: "Consent Signed At",
            portalStatus: "Portal Status",
            agree: "I agree to member terms",
            alreadyAgreed: "(Already agreed)",
            agreeHint: "Checking this sets consent_status=agreed and writes consent_signed_at.",
            save: "Save",
            refresh: "Refresh",
            saving: "Saving...",
          },
    [lang],
  );

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
            : t.loadFail;
        throw new Error(msg);
      }

      const parsed = MeResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error(t.invalidResponse);

      const m = parsed.data.member;
      setMember(m);
      setForm({
        full_name: toText(m.full_name),
        phone: toText(m.phone),
        email: toText(m.email),
        address: toText(m.address),
        emergency_contact_name: toText(m.emergency_contact_name),
        emergency_contact_phone: toText(m.emergency_contact_phone),
        photo_url: toText(m.photo_url),
        notes: toText(m.notes),
        consentAgree: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t.loadFail);
    } finally {
      setLoading(false);
    }
  }, [t.invalidResponse, t.loadFail]);

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
        email: form.email,
        address: form.address,
        emergency_contact_name: form.emergency_contact_name,
        emergency_contact_phone: form.emergency_contact_phone,
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
            : t.updateFail;
        throw new Error(msg);
      }

      setSuccess(t.updated);
      await fetchMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.updateFail);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">{lang === "zh" ? "個人資料" : "PROFILE"}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            {t.profile}
          </h1>
          <MemberTabs />

          <div className="actions" style={{ marginTop: 10 }}>
            <a className="btn" href="/member">
              {t.backMember}
            </a>
            <a className="btn btnPrimary" href="/member/bookings">
              {t.myBookings}
            </a>
            <a className="btn" href="/member/notifications">
              {lang === "zh" ? "通知中心" : "Notifications"}
            </a>
            <a className="btn" href="/member/support">
              {lang === "zh" ? "客服工單" : "Support"}
            </a>
            <a className="btn" href="/member/rules">
              {lang === "zh" ? "規則" : "Rules"}
            </a>
            <a className="btn" href="/member/settings">
              {lang === "zh" ? "設定" : "Settings"}
            </a>
          </div>

          {loading ? (
            <p className="sub" style={{ marginTop: 12 }}>
              {t.loading}
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
                      {t.current}
                    </div>
                    <div className="sub">
                      {t.fullName}: {toText(member.full_name) || "-"}
                    </div>
                    <div className="sub">
                      {t.phone}: {toText(member.phone) || "-"}
                    </div>
                    <div className="sub">
                      {t.email}: {toText(member.email) || "-"}
                    </div>
                    <div className="sub">
                      {t.address}: {toText(member.address) || "-"}
                    </div>
                    <div className="sub">
                      {t.emergencyName}: {toText(member.emergency_contact_name) || "-"}
                    </div>
                    <div className="sub">
                      {t.emergencyPhone}: {toText(member.emergency_contact_phone) || "-"}
                    </div>
                    <div className="sub">
                      {t.photoUrl}: {toText(member.photo_url) || "-"}
                    </div>
                    <div className="sub">
                      {t.notes}: {toText(member.notes) || "-"}
                    </div>
                    <div className="sub">
                      {t.consentStatus}: {toText(member.consent_status) || "-"}
                    </div>
                    <div className="sub">
                      {t.consentSignedAt}: {formatDateTime(member.consent_signed_at) || "-"}
                    </div>
                    <div className="sub">
                      {t.portalStatus}: {toText(member.portal_status) || "-"}
                    </div>
                  </div>
                </div>
              </div>

              <form onSubmit={onSubmit} className="card" style={{ marginTop: 14, padding: 14 }}>
                <div className="kvLabel" style={{ marginBottom: 10 }}>
                  {t.edit}
                </div>

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  {t.fullName}
                </label>
                <input
                  className="input"
                  value={form.full_name}
                  onChange={(ev) => setForm((s) => ({ ...s, full_name: ev.target.value }))}
                  placeholder={lang === "zh" ? "姓名" : "full_name"}
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  {t.phone}
                </label>
                <input
                  className="input"
                  value={form.phone}
                  onChange={(ev) => setForm((s) => ({ ...s, phone: ev.target.value }))}
                  placeholder={lang === "zh" ? "電話" : "phone"}
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  {t.email}
                </label>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(ev) => setForm((s) => ({ ...s, email: ev.target.value }))}
                  placeholder="you@example.com"
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  {t.address}
                </label>
                <input
                  className="input"
                  value={form.address}
                  onChange={(ev) => setForm((s) => ({ ...s, address: ev.target.value }))}
                  placeholder={lang === "zh" ? "地址" : "address"}
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  {t.emergencyName}
                </label>
                <input
                  className="input"
                  value={form.emergency_contact_name}
                  onChange={(ev) => setForm((s) => ({ ...s, emergency_contact_name: ev.target.value }))}
                  placeholder={lang === "zh" ? "緊急聯絡人姓名" : "emergency contact name"}
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  {t.emergencyPhone}
                </label>
                <input
                  className="input"
                  value={form.emergency_contact_phone}
                  onChange={(ev) => setForm((s) => ({ ...s, emergency_contact_phone: ev.target.value }))}
                  placeholder={lang === "zh" ? "緊急聯絡電話" : "emergency contact phone"}
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  {t.photoUrl}
                </label>
                <input
                  className="input"
                  value={form.photo_url}
                  onChange={(ev) => setForm((s) => ({ ...s, photo_url: ev.target.value }))}
                  placeholder={lang === "zh" ? "照片網址" : "photo_url"}
                />

                <label className="sub" style={{ display: "block", marginTop: 10 }}>
                  {t.notes}
                </label>
                <textarea
                  className="input"
                  value={form.notes}
                  onChange={(ev) => setForm((s) => ({ ...s, notes: ev.target.value }))}
                  placeholder={lang === "zh" ? "備註" : "notes"}
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
                    {t.agree}
                    {consentAgreed ? (
                      <span className="sub" style={{ opacity: 0.8 }}>
                        {t.alreadyAgreed}
                      </span>
                    ) : null}
                  </label>
                  {!consentAgreed ? (
                    <div className="sub" style={{ marginTop: 6, opacity: 0.8 }}>
                      {t.agreeHint}
                    </div>
                  ) : null}
                </div>

                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="btn btnPrimary" type="submit" disabled={saving}>
                    {saving ? t.saving : t.save}
                  </button>
                  <button className="btn" type="button" onClick={() => void fetchMe()} disabled={saving}>
                    {t.refresh}
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
