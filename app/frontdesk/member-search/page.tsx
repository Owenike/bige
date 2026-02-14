"use client";

import { FormEvent, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface MemberItem {
  id: string;
  full_name: string;
  phone: string | null;
  custom_fields?: Record<string, string>;
}

interface CustomFieldRow {
  key: string;
  value: string;
}

function normalizePhone(input: string) {
  return input.replace(/\D/g, "");
}

function toCustomFields(rows: CustomFieldRow[]) {
  const output: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key || !value) continue;
    output[key] = value;
  }
  return output;
}

export default function FrontdeskMemberSearchPage() {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [customRows, setCustomRows] = useState<CustomFieldRow[]>([{ key: "", value: "" }]);
  const [items, setItems] = useState<MemberItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [recentCreatedId, setRecentCreatedId] = useState<string | null>(null);
  const [duplicateCandidate, setDuplicateCandidate] = useState<MemberItem | null>(null);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "MEMBER DESK",
            title: "會員查詢 / 建檔",
            sub: "快速查詢會員、避免重複建檔，並在櫃檯直接建立完整會員資料。",
            findTitle: "查詢會員",
            findHint: "可用姓名或電話查詢",
            findPlaceholder: "輸入姓名或電話",
            findBtn: "開始查詢",
            creatingBtn: "建立中...",
            createTitle: "新增會員",
            createName: "姓名",
            createPhone: "電話（必填）",
            customTitle: "自訂欄位",
            customKey: "欄位名稱（例：身高）",
            customValue: "欄位內容（例：178）",
            addField: "新增欄位",
            removeField: "刪除",
            createBtn: "建立會員",
            searching: "查詢中...",
            resultTitle: "查詢結果",
            empty: "目前沒有資料",
            searchFail: "查詢失敗",
            createFail: "建立失敗",
            created: "會員已建立",
            duplicatePhone: "此電話已存在會員，請直接使用既有會員資料。",
            invalidPhone: "電話格式不正確，請重新輸入。",
            duplicateTitle: "偵測到重複會員",
            duplicateDesc: "此電話已綁定既有會員，請選擇下一步。",
            useExisting: "使用既有會員",
            editAndRetry: "修改電話後重試",
            usingExisting: "已切換為既有會員",
            continueHint: "可直接用此會員前往收款、預約或入場掃碼。",
            quickActions: "快速下一步",
            goOrder: "新增訂單",
            goBooking: "建立預約",
            goCheckin: "入場掃碼",
            customInfo: "自訂資料",
          }
        : {
            badge: "MEMBER DESK",
            title: "Member Search / Create",
            sub: "Find members quickly, prevent duplicates, and create complete member profiles at frontdesk.",
            findTitle: "Find Member",
            findHint: "Search by name or phone",
            findPlaceholder: "Enter name or phone",
            findBtn: "Search",
            creatingBtn: "Creating...",
            createTitle: "Create Member",
            createName: "Full Name",
            createPhone: "Phone (Required)",
            customTitle: "Custom Fields",
            customKey: "Field name (e.g. Height)",
            customValue: "Field value (e.g. 178)",
            addField: "Add Field",
            removeField: "Remove",
            createBtn: "Create Member",
            searching: "Searching...",
            resultTitle: "Results",
            empty: "No records yet",
            searchFail: "Search failed",
            createFail: "Create failed",
            created: "Member created",
            duplicatePhone: "This phone already exists. Use the existing member record.",
            invalidPhone: "Invalid phone format.",
            duplicateTitle: "Duplicate Member Detected",
            duplicateDesc: "This phone is already linked to an existing member. Choose next action.",
            useExisting: "Use Existing Member",
            editAndRetry: "Edit Phone and Retry",
            usingExisting: "Switched to existing member",
            continueHint: "You can continue with this member for payment, booking, or check-in.",
            quickActions: "Quick Actions",
            goOrder: "New Order",
            goBooking: "New Booking",
            goCheckin: "Check-in",
            customInfo: "Custom Info",
          },
    [lang],
  );

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const keyword = q.trim();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/members?q=${encodeURIComponent(keyword)}`);
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || t.searchFail);
        return;
      }
      setItems((payload.items || []) as MemberItem[]);
    } finally {
      setLoading(false);
    }
  }

  async function createMember(event: FormEvent) {
    event.preventDefault();
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || normalizedPhone.length < 8) {
      setError(t.invalidPhone);
      return;
    }

    setError(null);
    setMessage(null);
    setDuplicateCandidate(null);
    setCreating(true);
    try {
      const customFields = toCustomFields(customRows);
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name.trim(), phone: normalizedPhone, customFields }),
      });
      const payload = await res.json();
      if (!res.ok) {
        if (res.status === 409 && payload?.existingMember) {
          setDuplicateCandidate({
            id: String(payload.existingMember.id || ""),
            full_name: String(payload.existingMember.full_name || "-"),
            phone: typeof payload.existingMember.phone === "string" ? payload.existingMember.phone : null,
            custom_fields: payload.existingMember.custom_fields || {},
          });
          return;
        }
        setError(payload?.error || t.createFail);
        return;
      }
      const createdId = String(payload?.member?.id || "");
      setName("");
      setPhone("");
      setCustomRows([{ key: "", value: "" }]);
      setRecentCreatedId(createdId || null);
      setQ(payload?.member?.phone || "");
      setMessage(`${t.created}: ${createdId}`);
      await search();
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{t.badge}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {t.title}
            </h1>
            <p className="fdGlassText">{t.sub}</p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}
        {duplicateCandidate ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, .35)",
              display: "grid",
              placeItems: "center",
              zIndex: 80,
              padding: 16,
            }}
            onClick={() => {
              setDuplicateCandidate(null);
              setError(t.duplicatePhone);
            }}
          >
            <div
              className="fdGlassSubPanel"
              style={{ width: "min(560px, 100%)", padding: 16, borderColor: "rgba(190, 24, 93, .45)" }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <h2 className="sectionTitle" style={{ marginBottom: 6 }}>{t.duplicateTitle}</h2>
              <p className="fdGlassText" style={{ marginTop: 0 }}>{t.duplicateDesc}</p>
              <p className="fdGlassText" style={{ marginTop: 6 }}>
                {duplicateCandidate.full_name} | {duplicateCandidate.phone || "-"}
              </p>
              <div className="actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="fdPillBtn fdPillBtnPrimary"
                  onClick={async () => {
                    setDuplicateCandidate(null);
                    setRecentCreatedId(duplicateCandidate.id);
                    setMessage(`${t.usingExisting}: ${duplicateCandidate.id}`);
                    setQ(duplicateCandidate.phone || duplicateCandidate.full_name);
                    await search();
                  }}
                >
                  {t.useExisting}
                </button>
                <button
                  type="button"
                  className="fdPillBtn"
                  onClick={() => {
                    setDuplicateCandidate(null);
                    setError(t.duplicatePhone);
                  }}
                >
                  {t.editAndRetry}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="fdTwoCol" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <div className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.findTitle}</h2>
            <p className="fdGlassText" style={{ marginTop: 6 }}>
              {t.findHint}
            </p>
            <form onSubmit={search} className="field">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.findPlaceholder} className="input" />
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={loading}>
                {loading ? t.searching : t.findBtn}
              </button>
            </form>
          </div>

          <div className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.createTitle}</h2>
            <form onSubmit={createMember} className="field">
              <label className="fdGlassText" style={{ marginTop: 0 }}>
                {t.createName}
              </label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.createName} className="input" required />

              <label className="fdGlassText">{t.createPhone}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.createPhone} className="input" required />

              <label className="fdGlassText">{t.customTitle}</label>
              {customRows.map((row, idx) => (
                <div key={`${idx}-${row.key}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
                  <input
                    value={row.key}
                    onChange={(e) =>
                      setCustomRows((prev) => prev.map((item, i) => (i === idx ? { ...item, key: e.target.value } : item)))
                    }
                    placeholder={t.customKey}
                    className="input"
                  />
                  <input
                    value={row.value}
                    onChange={(e) =>
                      setCustomRows((prev) => prev.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item)))
                    }
                    placeholder={t.customValue}
                    className="input"
                  />
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() =>
                      setCustomRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))
                    }
                  >
                    {t.removeField}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="fdPillBtn"
                onClick={() => setCustomRows((prev) => [...prev, { key: "", value: "" }])}
              >
                {t.addField}
              </button>

              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={creating}>
                {creating ? t.creatingBtn : t.createBtn}
              </button>
            </form>
            <p className="fdGlassText" style={{ marginTop: 10, fontSize: 12 }}>{t.continueHint}</p>
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          {recentCreatedId ? (
            <div className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 12 }}>
              <h2 className="sectionTitle" style={{ marginBottom: 8 }}>{t.quickActions}</h2>
              <div className="actions" style={{ marginTop: 0 }}>
                <a className="fdPillBtn fdPillBtnPrimary" href={`/frontdesk/orders/new?memberId=${encodeURIComponent(recentCreatedId)}`}>{t.goOrder}</a>
                <a className="fdPillBtn" href={`/frontdesk/bookings?memberId=${encodeURIComponent(recentCreatedId)}`}>{t.goBooking}</a>
                <a className="fdPillBtn" href="/frontdesk/checkin">{t.goCheckin}</a>
              </div>
            </div>
          ) : null}

          <h2 className="sectionTitle">{t.resultTitle}</h2>
          <div className="fdActionGrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {items.length === 0 ? (
              <div className="fdGlassSubPanel" style={{ padding: 14 }}>
                <div className="kvValue">{t.empty}</div>
              </div>
            ) : (
              items.map((item) => (
                <article
                  key={item.id}
                  className="fdGlassSubPanel fdActionCard"
                  style={{
                    padding: 14,
                    borderColor: item.id === recentCreatedId ? "rgba(116, 182, 241, .9)" : undefined,
                    boxShadow: item.id === recentCreatedId ? "0 0 0 2px rgba(159, 212, 255, .45)" : undefined,
                  }}
                >
                  <h3 className="fdActionTitle" style={{ fontSize: 20 }}>{item.full_name}</h3>
                  <p className="fdGlassText" style={{ marginTop: 6 }}>{item.phone || "-"}</p>
                  {item.custom_fields && Object.keys(item.custom_fields).length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <p className="fdGlassText" style={{ marginTop: 0, fontSize: 12 }}>{t.customInfo}</p>
                      <div className="actions" style={{ marginTop: 6 }}>
                        {Object.entries(item.custom_fields).map(([key, value]) => (
                          <span key={`${item.id}-${key}`} className="fdChip">{key}: {value}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
