"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

type MemberListItem = {
  id: string;
  fullName: string;
  phone: string | null;
  notes: string | null;
  photoUrl: string | null;
  storeId: string | null;
  createdAt: string;
  updatedAt: string;
  contractStatus?: string;
  nearestEndsAt?: string | null;
  remainingDays?: number | null;
  eligibility?: {
    eligible?: boolean;
    reasonCode?: string;
    message?: string;
  };
};

type ContractItem = {
  id: string;
  planCode: string | null;
  planName: string | null;
  planType: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  remainingUses: number | null;
  remainingSessions: number | null;
  passId: string | null;
  passRemaining: number | null;
  passTotalSessions: number | null;
};

type MemberDetail = {
  member: {
    id: string;
    fullName: string;
    phone: string | null;
    notes: string | null;
    photoUrl: string | null;
    storeId: string | null;
  };
  contracts: ContractItem[];
  recentBookings: Array<Record<string, unknown>>;
  recentOrders: Array<Record<string, unknown>>;
  recentPayments: Array<Record<string, unknown>>;
  adjustments: Array<Record<string, unknown>>;
};

type ApiPayload = {
  ok?: boolean;
  error?: string | { message?: string };
  data?: Record<string, unknown>;
  items?: MemberListItem[];
  member?: MemberListItem;
};

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseError(payload: ApiPayload | null, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error && typeof payload.error.message === "string") return payload.error.message;
  return fallback;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function ManagerMembersPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [items, setItems] = useState<MemberListItem[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [detail, setDetail] = useState<MemberDetail | null>(null);

  const [q, setQ] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createStoreId, setCreateStoreId] = useState("");
  const [createNotes, setCreateNotes] = useState("");

  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editStoreId, setEditStoreId] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [assignPlanCode, setAssignPlanCode] = useState("");
  const [assignStatus, setAssignStatus] = useState("active");
  const [assignStartsAt, setAssignStartsAt] = useState("");
  const [assignEndsAt, setAssignEndsAt] = useState("");
  const [assignRemainingSessions, setAssignRemainingSessions] = useState("");
  const [assignRemainingUses, setAssignRemainingUses] = useState("");
  const [assignNote, setAssignNote] = useState("");

  const [adjustPassId, setAdjustPassId] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("1");
  const [adjustReason, setAdjustReason] = useState("");

  async function loadMembers(nextQ?: string, nextLifecycle?: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const query = (nextQ ?? q).trim();
      if (query) params.set("q", query);
      const life = (nextLifecycle ?? lifecycle).trim();
      if (life) params.set("lifecycle", life);
      const res = await fetch(`/api/manager/members?${params.toString()}`);
      const payload = (await parseJsonSafe<ApiPayload>(res)) || null;
      if (!res.ok) {
        setError(parseError(payload, zh ? "載入會員失敗" : "Load members failed"));
        setItems([]);
        setLoading(false);
        return;
      }
      const nextItems = ((payload?.data?.items || payload?.items) as MemberListItem[] | undefined) || [];
      setItems(nextItems);

      if (selectedMemberId && !nextItems.find((item) => item.id === selectedMemberId)) {
        setSelectedMemberId("");
        setDetail(null);
      }
      if (!selectedMemberId && nextItems.length > 0) {
        setSelectedMemberId(nextItems[0].id);
      }
    } catch {
      setError(zh ? "載入會員失敗" : "Load members failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(memberId: string) {
    if (!memberId) return;
    const res = await fetch(`/api/manager/members/${encodeURIComponent(memberId)}`);
    const payload = (await parseJsonSafe<ApiPayload>(res)) || null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "載入會員詳情失敗" : "Load member detail failed"));
      setDetail(null);
      return;
    }
    const data = (payload?.data || {}) as Record<string, unknown>;
    const member = (data.member || null) as MemberDetail["member"] | null;
    if (!member) {
      setDetail(null);
      return;
    }
    setDetail({
      member,
      contracts: ((data.contracts || []) as ContractItem[]) || [],
      recentBookings: ((data.recentBookings || []) as Array<Record<string, unknown>>) || [],
      recentOrders: ((data.recentOrders || []) as Array<Record<string, unknown>>) || [],
      recentPayments: ((data.recentPayments || []) as Array<Record<string, unknown>>) || [],
      adjustments: ((data.adjustments || []) as Array<Record<string, unknown>>) || [],
    });
    setEditName(member.fullName || "");
    setEditPhone(member.phone || "");
    setEditStoreId(member.storeId || "");
    setEditNotes(member.notes || "");
  }

  useEffect(() => {
    void loadMembers("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedMemberId) return;
    void loadDetail(selectedMemberId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMemberId]);

  async function createMember(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const res = await fetch("/api/manager/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: createName,
        phone: createPhone || null,
        storeId: createStoreId || null,
        notes: createNotes || null,
      }),
    });
    const payload = (await parseJsonSafe<ApiPayload>(res)) || null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "建立會員失敗" : "Create member failed"));
      setSaving(false);
      return;
    }

    setMessage(zh ? "會員已建立" : "Member created");
    setCreateName("");
    setCreatePhone("");
    setCreateStoreId("");
    setCreateNotes("");
    await loadMembers();
    setSaving(false);
  }

  async function saveMember(event: FormEvent) {
    event.preventDefault();
    if (!selectedMemberId) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const res = await fetch(`/api/manager/members/${encodeURIComponent(selectedMemberId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: editName,
        phone: editPhone,
        storeId: editStoreId,
        notes: editNotes,
      }),
    });
    const payload = (await parseJsonSafe<ApiPayload>(res)) || null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "儲存會員失敗" : "Save member failed"));
      setSaving(false);
      return;
    }

    setMessage(zh ? "會員資料已更新" : "Member updated");
    await Promise.all([loadMembers(), loadDetail(selectedMemberId)]);
    setSaving(false);
  }

  async function assignPlan(event: FormEvent) {
    event.preventDefault();
    if (!selectedMemberId) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const res = await fetch(`/api/manager/members/${encodeURIComponent(selectedMemberId)}/plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planCode: assignPlanCode || null,
        status: assignStatus,
        startsAt: assignStartsAt || null,
        endsAt: assignEndsAt || null,
        remainingSessions: assignRemainingSessions ? Number(assignRemainingSessions) : null,
        remainingUses: assignRemainingUses ? Number(assignRemainingUses) : null,
        note: assignNote || null,
      }),
    });
    const payload = (await parseJsonSafe<ApiPayload>(res)) || null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "發放方案失敗" : "Assign plan failed"));
      setSaving(false);
      return;
    }
    setMessage(zh ? "方案已發放給會員" : "Plan assigned");
    setAssignPlanCode("");
    setAssignStartsAt("");
    setAssignEndsAt("");
    setAssignRemainingSessions("");
    setAssignRemainingUses("");
    setAssignNote("");
    await Promise.all([loadMembers(), loadDetail(selectedMemberId)]);
    setSaving(false);
  }

  async function adjustPass(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/manager/pass-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passId: adjustPassId,
        delta: Number(adjustDelta),
        reason: adjustReason,
      }),
    });
    const payload = (await parseJsonSafe<ApiPayload>(res)) || null;
    if (!res.ok) {
      setError(parseError(payload, zh ? "調整失敗" : "Adjustment failed"));
      setSaving(false);
      return;
    }
    setMessage(zh ? "票券堂數已調整" : "Pass updated");
    await Promise.all([loadMembers(), selectedMemberId ? loadDetail(selectedMemberId) : Promise.resolve()]);
    setSaving(false);
  }

  const stats = useMemo(() => {
    return {
      total: items.length,
      expiring: items.filter((item) => typeof item.remainingDays === "number" && item.remainingDays >= 0 && item.remainingDays <= 14).length,
      expired: items.filter((item) => item.contractStatus === "expired").length,
      exhausted: items.filter((item) => item.contractStatus === "exhausted").length,
    };
  }, [items]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "會員中心" : "MEMBER CENTER"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "會員 / 合約 / 權益管理" : "Members / Contracts / Entitlements"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "集中查看會員持有方案、剩餘堂數與到期狀態，並執行發放與調整。"
                : "Manage member ownership, remaining sessions, expiry lifecycle, and manual adjustments."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "返回管理儀表板" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "會員數" : "Members"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.total}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "14 天內到期" : "Expiring 14d"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.expiring}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "已到期 / 已用盡" : "Expired / Exhausted"}</h3>
            <p className="sub" style={{ marginTop: 8 }}>{stats.expired} / {stats.exhausted}</p>
          </article>
        </section>

        <section className="fdTwoCol" style={{ alignItems: "start" }}>
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "會員搜尋" : "Search Members"}</h2>
            <form
              className="actions"
              style={{ marginTop: 8 }}
              onSubmit={(event) => {
                event.preventDefault();
                void loadMembers();
              }}
            >
              <input
                className="input"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder={zh ? "姓名 / 電話" : "name / phone"}
              />
              <select className="input" value={lifecycle} onChange={(event) => setLifecycle(event.target.value)}>
                <option value="">{zh ? "全部狀態" : "all states"}</option>
                <option value="expiring">{zh ? "即將到期" : "expiring"}</option>
                <option value="expired">{zh ? "已到期" : "expired"}</option>
                <option value="exhausted">{zh ? "已用盡" : "exhausted"}</option>
              </select>
              <button className="fdPillBtn fdPillBtnPrimary" type="submit" disabled={loading}>
                {loading ? (zh ? "查詢中..." : "Loading...") : zh ? "查詢" : "Search"}
              </button>
            </form>

            <div className="fdDataGrid" style={{ marginTop: 10 }}>
              {items.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className="fdGlassSubPanel"
                  style={{
                    padding: 10,
                    textAlign: "left",
                    borderColor: selectedMemberId === member.id ? "var(--brand)" : undefined,
                  }}
                  onClick={() => setSelectedMemberId(member.id)}
                >
                  <div className="fdActionTitle" style={{ fontSize: 16 }}>{member.fullName}</div>
                  <div className="sub" style={{ marginTop: 4 }}>{member.phone || "-"}</div>
                  <div className="sub" style={{ marginTop: 4 }}>
                    {zh ? "狀態" : "status"}: {member.contractStatus || "none"}{" "}
                    {typeof member.remainingDays === "number" ? `(${member.remainingDays}d)` : ""}
                  </div>
                  {member.eligibility ? (
                    <div className="sub" style={{ marginTop: 2 }}>
                      {zh ? "可用性" : "eligibility"}: {member.eligibility.eligible ? "OK" : "DENY"} /{" "}
                      {member.eligibility.reasonCode || "-"}
                    </div>
                  ) : null}
                </button>
              ))}
              {items.length === 0 ? <p className="fdGlassText">{zh ? "找不到會員。" : "No members found."}</p> : null}
            </div>
          </section>

          <section className="fdDataGrid">
            <form onSubmit={createMember} className="fdGlassSubPanel" style={{ padding: 14 }}>
              <h2 className="sectionTitle">{zh ? "新增會員" : "Create Member"}</h2>
              <div style={{ display: "grid", gap: 8 }}>
                <input className="input" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder={zh ? "姓名" : "full name"} required />
                <input className="input" value={createPhone} onChange={(e) => setCreatePhone(e.target.value)} placeholder={zh ? "電話 (選填)" : "phone"} />
                <input className="input" value={createStoreId} onChange={(e) => setCreateStoreId(e.target.value)} placeholder={zh ? "分館 ID (選填)" : "branch id"} />
                <input className="input" value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} placeholder={zh ? "備註 (選填)" : "notes"} />
              </div>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>
                {saving ? (zh ? "建立中..." : "Creating...") : zh ? "建立會員" : "Create Member"}
              </button>
            </form>

            {detail ? (
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <h2 className="sectionTitle">{zh ? "會員詳情" : "Member Detail"}</h2>
                <p className="sub">{detail.member.fullName} | {detail.member.phone || "-"}</p>
                <p className="sub">{zh ? "分館" : "branch"}: {detail.member.storeId || "-"}</p>
                <p className="sub">{zh ? "備註" : "notes"}: {detail.member.notes || "-"}</p>

                <form onSubmit={saveMember} style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={zh ? "姓名" : "full name"} />
                  <input className="input" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder={zh ? "電話" : "phone"} />
                  <input className="input" value={editStoreId} onChange={(e) => setEditStoreId(e.target.value)} placeholder={zh ? "分館 ID" : "branch id"} />
                  <input className="input" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder={zh ? "備註" : "notes"} />
                  <button type="submit" className="fdPillBtn" disabled={saving}>
                    {saving ? (zh ? "儲存中..." : "Saving...") : zh ? "儲存會員資料" : "Save Member"}
                  </button>
                </form>

                <h3 className="fdActionTitle" style={{ marginTop: 12 }}>{zh ? "持有方案 / 合約" : "Owned Plans / Contracts"}</h3>
                <div className="fdDataGrid" style={{ marginTop: 8 }}>
                  {detail.contracts.map((contract) => (
                    <div key={contract.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                      <p className="sub" style={{ marginTop: 0 }}>
                        {(contract.planName || contract.planCode || "-")} | {contract.status}
                      </p>
                      <p className="sub" style={{ marginTop: 0 }}>
                        {zh ? "到期" : "ends"}: {fmtDate(contract.endsAt)}
                      </p>
                      <p className="sub" style={{ marginTop: 0 }}>
                        {zh ? "剩餘次數 / 堂數" : "remaining uses / sessions"}: {contract.remainingUses ?? "-"} / {contract.remainingSessions ?? "-"}
                      </p>
                      {contract.passId ? (
                        <button
                          type="button"
                          className="fdPillBtn"
                          style={{ marginTop: 6 }}
                          onClick={() => setAdjustPassId(contract.passId || "")}
                        >
                          {zh ? "帶入調整票券" : "Use for pass adjustment"}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {detail.contracts.length === 0 ? <p className="fdGlassText">{zh ? "目前沒有合約。" : "No contracts yet."}</p> : null}
                </div>

                <form onSubmit={assignPlan} className="fdGlassSubPanel" style={{ padding: 10, marginTop: 12 }}>
                  <h3 className="fdActionTitle">{zh ? "發放方案 / 合約" : "Assign Plan Contract"}</h3>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    <input className="input" value={assignPlanCode} onChange={(e) => setAssignPlanCode(e.target.value)} placeholder={zh ? "方案代碼 planCode" : "planCode"} />
                    <select className="input" value={assignStatus} onChange={(e) => setAssignStatus(e.target.value)}>
                      <option value="active">{zh ? "啟用" : "active"}</option>
                      <option value="pending">{zh ? "待啟用" : "pending"}</option>
                      <option value="frozen">{zh ? "凍結" : "frozen"}</option>
                    </select>
                    <input className="input" type="datetime-local" value={assignStartsAt} onChange={(e) => setAssignStartsAt(e.target.value)} />
                    <input className="input" type="datetime-local" value={assignEndsAt} onChange={(e) => setAssignEndsAt(e.target.value)} />
                    <input className="input" type="number" min="0" value={assignRemainingSessions} onChange={(e) => setAssignRemainingSessions(e.target.value)} placeholder={zh ? "剩餘堂數 (選填)" : "remaining sessions"} />
                    <input className="input" type="number" min="0" value={assignRemainingUses} onChange={(e) => setAssignRemainingUses(e.target.value)} placeholder={zh ? "剩餘次數 (選填)" : "remaining uses"} />
                    <input className="input" value={assignNote} onChange={(e) => setAssignNote(e.target.value)} placeholder={zh ? "備註" : "note"} />
                  </div>
                  <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 8 }} disabled={saving}>
                    {saving ? (zh ? "發放中..." : "Assigning...") : zh ? "發放方案" : "Assign Plan"}
                  </button>
                </form>

                <form onSubmit={adjustPass} className="fdGlassSubPanel" style={{ padding: 10, marginTop: 12 }}>
                  <h3 className="fdActionTitle">{zh ? "票券堂數調整" : "Pass Adjustment"}</h3>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    <input className="input" value={adjustPassId} onChange={(e) => setAdjustPassId(e.target.value)} placeholder={zh ? "票券 ID" : "passId"} required />
                    <input className="input" type="number" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} placeholder={zh ? "調整值 (+/-)" : "delta"} required />
                    <input className="input" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder={zh ? "原因" : "reason"} required />
                  </div>
                  <button type="submit" className="fdPillBtn" style={{ marginTop: 8 }} disabled={saving}>
                    {saving ? (zh ? "調整中..." : "Adjusting...") : zh ? "送出調整" : "Submit Adjustment"}
                  </button>
                </form>

                <section className="fdGlassSubPanel" style={{ padding: 10, marginTop: 12 }}>
                  <h3 className="fdActionTitle">{zh ? "近期預約 / 訂單 / 付款 / 調整" : "Recent Activity"}</h3>
                  <div className="fdDataGrid" style={{ marginTop: 8 }}>
                    {detail.recentBookings.slice(0, 5).map((row, idx) => (
                      <p key={`b-${idx}`} className="sub">{zh ? "預約" : "booking"}: {String(row.id || "-")} | {String(row.status || "-")} | {fmtDate(String(row.starts_at || ""))}</p>
                    ))}
                    {detail.recentOrders.slice(0, 5).map((row, idx) => (
                      <p key={`o-${idx}`} className="sub">{zh ? "訂單" : "order"}: {String(row.id || "-")} | {String(row.status || "-")} | {String(row.amount || "-")}</p>
                    ))}
                    {detail.recentPayments.slice(0, 5).map((row, idx) => (
                      <p key={`p-${idx}`} className="sub">{zh ? "付款" : "payment"}: {String(row.id || "-")} | {String(row.status || "-")} | {String(row.amount || "-")}</p>
                    ))}
                    {detail.adjustments.slice(0, 5).map((row, idx) => (
                      <p key={`a-${idx}`} className="sub">{zh ? "調整" : "adjustment"}: {String(row.source_type || "-")} | {String(row.reason || "-")} | {fmtDate(String(row.created_at || ""))}</p>
                    ))}
                  </div>
                </section>
              </section>
            ) : (
              <section className="fdGlassSubPanel" style={{ padding: 14 }}>
                <p className="fdGlassText">{zh ? "請先選擇一位會員。" : "Select a member to view detail."}</p>
              </section>
            )}
          </section>
        </section>
      </section>
    </main>
  );
}
