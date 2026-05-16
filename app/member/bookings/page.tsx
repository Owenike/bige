"use client";

import React, { useState } from "react";
import { useI18n } from "../../i18n-provider";

type BookingRequestFormState = {
  contactName: string;
  gender: string;
  contactPhone: string;
  birthdate: string;
  preferredDayType: string;
  preferredTimeSlot: string;
  note: string;
};

const NOTE_PLACEHOLDER =
  "例如：希望指定女教練、目前想改善的目標、過去受傷經驗，或任何想提前讓教練知道的身體狀況。";

function readApiMessage(payload: unknown, fallback: string) {
  const body = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const nested = typeof body.error === "object" && body.error !== null ? (body.error as Record<string, unknown>) : null;
  return (
    (nested && typeof nested.message === "string" ? nested.message : "") ||
    (typeof body.message === "string" ? body.message : "") ||
    (typeof body.errorMessage === "string" ? body.errorMessage : "") ||
    (typeof body.error === "string" ? body.error : "") ||
    fallback
  );
}

export default function MemberBookingsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<BookingRequestFormState>({
    contactName: "",
    gender: "",
    contactPhone: "",
    birthdate: "",
    preferredDayType: "",
    preferredTimeSlot: "",
    note: "",
  });

  const t = zh
    ? {
        eyebrow: "預約",
        title: "預約服務",
        desc: "免登入即可送出預約需求。請留下基本資料與方便聯繫的時段，我們會再主動與你確認實際預約時間。",
        formTitle: "填寫預約需求",
        name: "姓名",
        namePh: "請輸入姓名",
        gender: "性別",
        genderPh: "請選擇性別",
        phone: "手機號碼",
        phonePh: "請輸入手機號碼",
        birthdate: "出生年月日",
        preferredDayType: "可預約日期",
        preferredDayTypePh: "請選擇可預約日期",
        preferredTimeSlot: "可預約時段",
        preferredTimeSlotPh: "請選擇可預約時段",
        note: "備註",
        submit: "送出預約需求",
        submitting: "送出中...",
        success: "已送出預約需求，我們會再與你聯繫確認時間。",
        fail: "預約需求送出失敗，請稍後再試，或直接聯繫櫃台協助。",
        requireName: "請填寫姓名",
        requireGender: "請選擇性別",
        requirePhone: "請填寫手機號碼",
        requireBirthdate: "請選擇出生年月日",
        requireDay: "請選擇可預約日期",
        requireTime: "請選擇可預約時段",
        genders: [
          { value: "男性", label: "男性" },
          { value: "女性", label: "女性" },
        ],
        dayTypes: [
          { value: "平日", label: "平日" },
          { value: "假日", label: "假日" },
          { value: "都可以", label: "都可以" },
        ],
        timeSlots: [
          { value: "下午", label: "下午" },
          { value: "晚上", label: "晚上" },
          { value: "都可以", label: "都可以" },
        ],
      }
    : {
        eyebrow: "BOOKING",
        title: "Book a Service",
        desc: "Submit a booking request without signing in. Leave your basic details and preferred contact window, and we will confirm the actual booking time with you.",
        formTitle: "Booking Request",
        name: "Name",
        namePh: "Enter your name",
        gender: "Gender",
        genderPh: "Select gender",
        phone: "Mobile phone",
        phonePh: "Enter your mobile phone",
        birthdate: "Birthdate",
        preferredDayType: "Preferred days",
        preferredDayTypePh: "Select preferred days",
        preferredTimeSlot: "Preferred time",
        preferredTimeSlotPh: "Select preferred time",
        note: "Note",
        submit: "Submit Request",
        submitting: "Submitting...",
        success: "Your booking request has been sent. We will contact you to confirm the time.",
        fail: "Booking request failed. Please try again later or contact frontdesk.",
        requireName: "Please enter your name.",
        requireGender: "Please select gender.",
        requirePhone: "Please enter your mobile phone.",
        requireBirthdate: "Please select birthdate.",
        requireDay: "Please select preferred days.",
        requireTime: "Please select preferred time.",
        genders: [
          { value: "男性", label: "Male" },
          { value: "女性", label: "Female" },
        ],
        dayTypes: [
          { value: "平日", label: "Weekdays" },
          { value: "假日", label: "Weekends / holidays" },
          { value: "都可以", label: "Any day" },
        ],
        timeSlots: [
          { value: "下午", label: "Afternoon" },
          { value: "晚上", label: "Evening" },
          { value: "都可以", label: "Any time" },
        ],
      };

  function update<K extends keyof BookingRequestFormState>(key: K, value: BookingRequestFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitRequest() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!form.contactName.trim()) throw new Error(t.requireName);
      if (!form.gender) throw new Error(t.requireGender);
      if (!form.contactPhone.trim()) throw new Error(t.requirePhone);
      if (!form.birthdate) throw new Error(t.requireBirthdate);
      if (!form.preferredDayType) throw new Error(t.requireDay);
      if (!form.preferredTimeSlot) throw new Error(t.requireTime);

      const response = await fetch("/api/public/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactName: form.contactName.trim(),
          gender: form.gender,
          contactPhone: form.contactPhone.trim(),
          birthdate: form.birthdate || null,
          preferredDayType: form.preferredDayType,
          preferredTimeSlot: form.preferredTimeSlot,
          note: form.note.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readApiMessage(payload, t.fail));

      setMessage(t.success);
      setForm({
        contactName: "",
        gender: "",
        contactPhone: "",
        birthdate: "",
        preferredDayType: "",
        preferredTimeSlot: "",
        note: "",
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t.fail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <div className="card" style={{ padding: 18 }}>
          <div className="kvLabel">{t.eyebrow}</div>
          <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
            {t.title}
          </h1>
          <p className="sub">{t.desc}</p>

          <div className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="kvLabel">{t.formTitle}</div>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {t.name}
                </span>
                <input
                  className="input"
                  value={form.contactName}
                  onChange={(event) => update("contactName", event.target.value)}
                  placeholder={t.namePh}
                />
              </label>

              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {t.gender}
                </span>
                <select className="input" value={form.gender} onChange={(event) => update("gender", event.target.value)}>
                  <option value="">{t.genderPh}</option>
                  {t.genders.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {t.phone}
                </span>
                <input
                  className="input"
                  value={form.contactPhone}
                  onChange={(event) => update("contactPhone", event.target.value)}
                  placeholder={t.phonePh}
                />
              </label>

              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {t.birthdate}
                </span>
                <input className="input" type="date" value={form.birthdate} onChange={(event) => update("birthdate", event.target.value)} />
              </label>

              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {t.preferredDayType}
                </span>
                <select
                  className="input"
                  value={form.preferredDayType}
                  onChange={(event) => update("preferredDayType", event.target.value)}
                >
                  <option value="">{t.preferredDayTypePh}</option>
                  {t.dayTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {t.preferredTimeSlot}
                </span>
                <select
                  className="input"
                  value={form.preferredTimeSlot}
                  onChange={(event) => update("preferredTimeSlot", event.target.value)}
                >
                  <option value="">{t.preferredTimeSlotPh}</option>
                  {t.timeSlots.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="kvLabel" style={{ textTransform: "none" }}>
                  {t.note}
                </span>
                <textarea
                  className="input"
                  value={form.note}
                  onChange={(event) => update("note", event.target.value)}
                  placeholder={NOTE_PLACEHOLDER}
                  rows={4}
                />
              </label>
            </div>

            {error ? (
              <div className="sub" style={{ marginTop: 8, color: "var(--danger, #b00020)" }}>
                {error}
              </div>
            ) : null}
            {message ? (
              <div className="sub" style={{ marginTop: 8, color: "var(--success, #0b6b3a)" }}>
                {message}
              </div>
            ) : null}
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn btnPrimary" type="button" onClick={() => void submitRequest()} disabled={busy}>
                {busy ? t.submitting : t.submit}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
