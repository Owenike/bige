"use client";

import { FormEvent, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface MemberItem {
  id: string;
  full_name: string;
  phone: string | null;
  email?: string | null;
  status?: string | null;
  birth_date?: string | null;
  member_code?: string | null;
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

export function FrontdeskMemberSearchView({ embedded = false }: { embedded?: boolean }) {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [customRows, setCustomRows] = useState<CustomFieldRow[]>([{ key: "", value: "" }]);

  const [items, setItems] = useState<MemberItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [allMembersOpen, setAllMembersOpen] = useState(false);
  const [allMembersLoading, setAllMembersLoading] = useState(false);
  const [allMembersError, setAllMembersError] = useState<string | null>(null);
  const [allMembers, setAllMembers] = useState<MemberItem[]>([]);
  const [selectedAllMemberId, setSelectedAllMemberId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [recentCreatedId, setRecentCreatedId] = useState<string | null>(null);
  const [duplicateCandidate, setDuplicateCandidate] = useState<MemberItem | null>(null);

  const t = useMemo(
    () =>
            zh
        ? {
            badge: "MEMBER DESK",
            title: "會員查詢 / 建檔",
            sub: "快速查詢會員、避免重複建檔，並在櫃檯完成完整會員資料建立。",
            findTitle: "查詢會員",
            findHint: "可用姓名、電話或 Email 查詢",
            findPlaceholder: "輸入姓名 / 電話 / Email",
            findBtn: "開始查詢",
            findAllBtn: "查看所有會員",
            searching: "查詢中...",
            createTitle: "新增會員",
            createName: "姓名",
            createPhone: "電話（必填）",
            createEmail: "Email（選填）",
            createBirthDate: "生日（選填）",
            createGender: "性別（選填）",
            emergencyName: "緊急聯絡人（選填）",
            emergencyPhone: "緊急聯絡電話（選填）",
            leadSource: "來源（選填）",
            customTitle: "自訂欄位",
            customKey: "欄位名稱（例：身高）",
            customValue: "欄位內容（例：178）",
            addField: "新增欄位",
            removeField: "刪除",
            createBtn: "建立會員",
            creatingBtn: "建立中...",
            resultTitle: "查詢結果",
            empty: "目前沒有資料",
            searchFail: "查詢失敗",
            createFail: "建立失敗",
            created: "會員建立成功",
            invalidPhone: "電話格式錯誤，請輸入有效電話。",
            duplicateTitle: "偵測到重複會員",
            duplicateDesc: "此電話或 Email 已存在，請選擇下一步操作。",
            useExisting: "使用既有會員",
            editAndRetry: "返回修改後重試",
            usingExisting: "已切換為既有會員",
            continueHint: "可直接用此會員前往收款、預約或入場掃碼。",
            quickActions: "快速下一步",
            goOrder: "新增訂單",
            goBooking: "建立預約",
            goCheckin: "入場掃碼",
            customInfo: "自訂資訊",
            status: "狀態",
            active: "啟用",
            allMembersTitle: "所有會員",
            allMembersSub: "左側按會員編號排序，點選即可查看詳細資料。",
            allMembersLoading: "載入會員中...",
            allMembersEmpty: "目前沒有會員資料",
            memberCode: "會員編號",
            memberId: "會員 ID",
            phoneLabel: "電話",
            emailLabel: "Email",
            birthDateLabel: "生日",
            close: "關閉",
          }
        : {
            badge: "MEMBER DESK",
            title: "Member Search / Create",
            sub: "Find members quickly, prevent duplicates, and create complete member profiles at frontdesk.",
            findTitle: "Find Member",
            findHint: "Search by name, phone, or email",
            findPlaceholder: "Enter name / phone / email",
            findBtn: "Search",
            findAllBtn: "View All Members",
            searching: "Searching...",
            createTitle: "Create Member",
            createName: "Full Name",
            createPhone: "Phone (Required)",
            createEmail: "Email (Optional)",
            createBirthDate: "Birth Date (Optional)",
            createGender: "Gender (Optional)",
            emergencyName: "Emergency Contact (Optional)",
            emergencyPhone: "Emergency Phone (Optional)",
            leadSource: "Lead Source (Optional)",
            customTitle: "Custom Fields",
            customKey: "Field name (e.g. Height)",
            customValue: "Field value (e.g. 178)",
            addField: "Add Field",
            removeField: "Remove",
            createBtn: "Create Member",
            creatingBtn: "Creating...",
            resultTitle: "Results",
            empty: "No records yet",
            searchFail: "Search failed",
            createFail: "Create failed",
            created: "Member created",
            invalidPhone: "Invalid phone format.",
            duplicateTitle: "Duplicate Member Detected",
            duplicateDesc: "This phone/email already exists. Choose next action.",
            useExisting: "Use Existing Member",
            editAndRetry: "Edit and Retry",
            usingExisting: "Switched to existing member",
            continueHint: "You can continue with this member for payment, booking, or check-in.",
            quickActions: "Quick Actions",
            goOrder: "New Order",
            goBooking: "New Booking",
            goCheckin: "Check-in",
            customInfo: "Custom Info",
            status: "Status",
            active: "Active",
            allMembersTitle: "All Members",
            allMembersSub: "Left list is sorted by member code. Click one member to view details.",
            allMembersLoading: "Loading members...",
            allMembersEmpty: "No members found",
            memberCode: "Member Code",
            memberId: "Member ID",
            phoneLabel: "Phone",
            emailLabel: "Email",
            birthDateLabel: "Birth Date",
            close: "Close",
          },
    [zh],
  );

  async function fetchMembers(keyword: string, options?: { limit?: number }) {
    const params = new URLSearchParams();
    const trimmed = keyword.trim();
    if (trimmed) params.set("q", trimmed);
    if (options?.limit && Number.isFinite(options.limit) && options.limit > 0) {
      params.set("limit", String(Math.trunc(options.limit)));
    }
    const endpoint = params.size > 0 ? `/api/members?${params.toString()}` : "/api/members";
    const res = await fetch(endpoint);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.error || t.searchFail);
    }
    return (payload.items || []) as MemberItem[];
  }

  function memberSortKey(item: MemberItem) {
    const code = typeof item.member_code === "string" ? item.member_code.trim() : "";
    if (!code) return Number.POSITIVE_INFINITY;
    const parsed = Number(code);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }

  function sortMembersByCode(list: MemberItem[]) {
    return [...list].sort((a, b) => {
      const aNum = memberSortKey(a);
      const bNum = memberSortKey(b);
      if (aNum !== bNum) return aNum - bNum;
      const aCode = (a.member_code || "").trim();
      const bCode = (b.member_code || "").trim();
      if (aCode !== bCode) return aCode.localeCompare(bCode, "zh-Hant");
      return a.full_name.localeCompare(b.full_name, "zh-Hant");
    });
  }

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const keyword = q.trim();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const nextItems = await fetchMembers(keyword);
      setItems(nextItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.searchFail);
    } finally {
      setLoading(false);
    }
  }

  async function openAllMembersModal() {
    setError(null);
    setMessage(null);
    setAllMembersError(null);
    setAllMembersOpen(true);
    setAllMembersLoading(true);
    try {
      const nextItems = sortMembersByCode(await fetchMembers("", { limit: 500 }));
      setAllMembers(nextItems);
      setSelectedAllMemberId((current) => {
        if (current && nextItems.some((item) => item.id === current)) return current;
        return nextItems[0]?.id || null;
      });
    } catch (err) {
      const nextError = err instanceof Error ? err.message : t.searchFail;
      setAllMembersError(nextError);
      setAllMembers([]);
      setSelectedAllMemberId(null);
    } finally {
      setAllMembersLoading(false);
    }
  }

  const selectedAllMember = useMemo(
    () => allMembers.find((item) => item.id === selectedAllMemberId) || null,
    [allMembers, selectedAllMemberId],
  );

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
        body: JSON.stringify({
          fullName: name.trim(),
          phone: normalizedPhone,
          email: email.trim() || null,
          birthDate: birthDate || null,
          gender: gender.trim() || null,
          emergencyName: emergencyName.trim() || null,
          emergencyPhone: emergencyPhone.trim() || null,
          leadSource: leadSource.trim() || null,
          customFields,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        if (res.status === 409 && payload?.existingMember) {
          setDuplicateCandidate({
            id: String(payload.existingMember.id || ""),
            full_name: String(payload.existingMember.full_name || "-"),
            phone: typeof payload.existingMember.phone === "string" ? payload.existingMember.phone : null,
            email: typeof payload.existingMember.email === "string" ? payload.existingMember.email : null,
            custom_fields:
              payload.existingMember.custom_fields && typeof payload.existingMember.custom_fields === "object"
                ? payload.existingMember.custom_fields
                : {},
          });
          return;
        }
        setError(payload?.error || t.createFail);
        return;
      }
      const createdId = String(payload?.member?.id || "");
      setName("");
      setPhone("");
      setEmail("");
      setBirthDate("");
      setGender("");
      setEmergencyName("");
      setEmergencyPhone("");
      setLeadSource("");
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
    <main className={embedded ? "fdEmbedScene" : "fdGlassScene"} style={embedded ? { width: "100%", margin: 0, padding: 0 } : undefined}>
      <section
        className={embedded ? "fdEmbedBackdrop" : "fdGlassBackdrop"}
        style={embedded ? { minHeight: "auto", height: "auto", padding: 12 } : undefined}
      >
        {!embedded ? (
          <section className="hero" style={{ paddingTop: 0 }}>
            <div className="fdGlassPanel">
              <div className="fdEyebrow">{t.badge}</div>
              <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>{t.title}</h1>
              <p className="fdGlassText">{t.sub}</p>
            </div>
          </section>
        ) : (
          <div className="fdGlassSubPanel" style={{ padding: 12, marginBottom: 12 }}>
            <h2 className="sectionTitle" style={{ marginBottom: 2 }}>{t.title}</h2>
            <p className="fdGlassText" style={{ marginTop: 0 }}>{t.sub}</p>
          </div>
        )}

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        {duplicateCandidate ? (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.35)", display: "grid", placeItems: "center", zIndex: 80, padding: 16 }}
            onClick={() => setDuplicateCandidate(null)}
          >
            <div
              className="fdGlassSubPanel"
              style={{ width: "min(560px, 100%)", padding: 16, borderColor: "rgba(190,24,93,.45)" }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <h2 className="sectionTitle">{t.duplicateTitle}</h2>
              <p className="fdGlassText" style={{ marginTop: 4 }}>{t.duplicateDesc}</p>
              <p className="fdGlassText" style={{ marginTop: 6 }}>
                {duplicateCandidate.full_name} | {duplicateCandidate.phone || "-"} | {duplicateCandidate.email || "-"}
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
                <button type="button" className="fdPillBtn" onClick={() => setDuplicateCandidate(null)}>
                  {t.editAndRetry}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="fdTwoCol" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
          <div className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.findTitle}</h2>
            <p className="fdGlassText" style={{ marginTop: 6 }}>{t.findHint}</p>
            <form onSubmit={search} className="field">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.findPlaceholder} className="input" />
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={loading}>
                {loading ? t.searching : t.findBtn}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void openAllMembersModal()} disabled={allMembersLoading}>
                {allMembersLoading ? t.allMembersLoading : t.findAllBtn}
              </button>
            </form>
          </div>

          <div className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.createTitle}</h2>
            <form onSubmit={createMember} className="field">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.createName} className="input" required />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.createPhone} className="input" required />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.createEmail} className="input" />
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="input" />
              <input value={gender} onChange={(e) => setGender(e.target.value)} placeholder={t.createGender} className="input" />
              <input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} placeholder={t.emergencyName} className="input" />
              <input value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} placeholder={t.emergencyPhone} className="input" />
              <input value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder={t.leadSource} className="input" />

              <label className="fdGlassText" style={{ marginTop: 0 }}>{t.customTitle}</label>
              {customRows.map((row, idx) => (
                <div key={`${idx}-${row.key}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
                  <input
                    value={row.key}
                    onChange={(e) => setCustomRows((prev) => prev.map((it, i) => (i === idx ? { ...it, key: e.target.value } : it)))}
                    placeholder={t.customKey}
                    className="input"
                  />
                  <input
                    value={row.value}
                    onChange={(e) => setCustomRows((prev) => prev.map((it, i) => (i === idx ? { ...it, value: e.target.value } : it)))}
                    placeholder={t.customValue}
                    className="input"
                  />
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() => setCustomRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))}
                  >
                    {t.removeField}
                  </button>
                </div>
              ))}
              <button type="button" className="fdPillBtn" onClick={() => setCustomRows((prev) => [...prev, { key: "", value: "" }])}>
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
                    borderColor: item.id === recentCreatedId ? "rgba(116,182,241,.9)" : undefined,
                    boxShadow: item.id === recentCreatedId ? "0 0 0 2px rgba(159,212,255,.45)" : undefined,
                  }}
                >
                  <h3 className="fdActionTitle" style={{ fontSize: 20 }}>{item.full_name}</h3>
                  <p className="fdGlassText" style={{ marginTop: 6 }}>{item.phone || "-"}</p>
                  <p className="fdGlassText" style={{ marginTop: 4 }}>{item.email || "-"}</p>
                  <p className="fdGlassText" style={{ marginTop: 4 }}>
                    {t.status}: {item.status || t.active}
                  </p>
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

        {allMembersOpen ? (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 90, padding: 16 }}
            onClick={() => setAllMembersOpen(false)}
          >
            <div
              className="fdGlassSubPanel"
              style={{
                width: "min(1120px, 100%)",
                maxHeight: "88vh",
                padding: 16,
                overflow: "hidden",
                background: "rgba(248,250,252,.98)",
                borderColor: "rgba(148,163,184,.45)",
              }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t.allMembersTitle}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 className="sectionTitle" style={{ margin: 0 }}>{t.allMembersTitle}</h2>
                  <p className="sub" style={{ marginTop: 4 }}>{t.allMembersSub}</p>
                </div>
                <button type="button" className="fdPillBtn" onClick={() => setAllMembersOpen(false)}>
                  {t.close}
                </button>
              </div>

              {allMembersError ? <div className="error" style={{ marginTop: 10 }}>{allMembersError}</div> : null}

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "minmax(260px, 330px) 1fr", gap: 12, minHeight: 420 }}>
                <aside
                  style={{
                    border: "1px solid rgba(148,163,184,.35)",
                    borderRadius: 14,
                    background: "rgba(255,255,255,.88)",
                    overflowY: "auto",
                    padding: 8,
                  }}
                >
                  {allMembersLoading ? (
                    <p className="sub" style={{ padding: 8 }}>{t.allMembersLoading}</p>
                  ) : allMembers.length === 0 ? (
                    <p className="sub" style={{ padding: 8 }}>{t.allMembersEmpty}</p>
                  ) : (
                    allMembers.map((item, idx) => {
                      const selected = item.id === selectedAllMemberId;
                      const memberCode = item.member_code?.trim() || String(idx + 1).padStart(4, "0");
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedAllMemberId(item.id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: selected ? "1px solid rgba(20,184,166,.6)" : "1px solid rgba(148,163,184,.3)",
                            background: selected ? "rgba(20,184,166,.1)" : "rgba(255,255,255,.84)",
                            borderRadius: 10,
                            padding: "10px 12px",
                            marginBottom: 8,
                            cursor: "pointer",
                          }}
                        >
                          <div className="kvLabel">#{memberCode}</div>
                          <div className="kvValue" style={{ marginTop: 4 }}>{item.full_name}</div>
                          <div className="sub" style={{ marginTop: 4 }}>{item.phone || "-"}</div>
                        </button>
                      );
                    })
                  )}
                </aside>

                <section
                  style={{
                    border: "1px solid rgba(148,163,184,.35)",
                    borderRadius: 14,
                    background: "rgba(255,255,255,.88)",
                    padding: 14,
                    overflowY: "auto",
                  }}
                >
                  {selectedAllMember ? (
                    <>
                      <h3 className="sectionTitle" style={{ marginTop: 0 }}>{selectedAllMember.full_name}</h3>
                      <div className="fdTwoCol" style={{ marginTop: 10, gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
                          <div className="kvLabel">{t.memberCode}</div>
                          <div className="kvValue">{selectedAllMember.member_code?.trim() || "-"}</div>
                        </div>
                        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
                          <div className="kvLabel">{t.memberId}</div>
                          <div className="kvValue" style={{ fontSize: 14, wordBreak: "break-all" }}>{selectedAllMember.id}</div>
                        </div>
                        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
                          <div className="kvLabel">{t.phoneLabel}</div>
                          <div className="kvValue">{selectedAllMember.phone || "-"}</div>
                        </div>
                        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
                          <div className="kvLabel">{t.emailLabel}</div>
                          <div className="kvValue">{selectedAllMember.email || "-"}</div>
                        </div>
                        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
                          <div className="kvLabel">{t.birthDateLabel}</div>
                          <div className="kvValue">{selectedAllMember.birth_date || "-"}</div>
                        </div>
                        <div className="fdGlassSubPanel" style={{ padding: 10, background: "rgba(255,255,255,.92)" }}>
                          <div className="kvLabel">{t.status}</div>
                          <div className="kvValue">{selectedAllMember.status || t.active}</div>
                        </div>
                      </div>

                      {selectedAllMember.custom_fields && Object.keys(selectedAllMember.custom_fields).length > 0 ? (
                        <div className="fdGlassSubPanel" style={{ marginTop: 12, padding: 10, background: "rgba(255,255,255,.92)" }}>
                          <div className="kvLabel">{t.customInfo}</div>
                          <div className="actions" style={{ marginTop: 6 }}>
                            {Object.entries(selectedAllMember.custom_fields).map(([key, value]) => (
                              <span key={`${selectedAllMember.id}-${key}`} className="fdChip">{key}: {value}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="sub">{t.allMembersEmpty}</p>
                  )}
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

