"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface MemberSearchItem {
  id: string;
  full_name: string;
  phone: string | null;
}

interface ManualAllowResponse {
  result: { method: string; result: string; reason: string };
  member: { id: string; fullName: string; phoneLast4: string | null; photoUrl: string | null; note: string | null };
  membership: {
    monthly: { expiresAt: string | null; isActive: boolean | null };
    passes: Array<{ id: string; passType: string | null; remaining: number | null; expiresAt: string | null; status: string | null }>;
  };
  today: { from: string; to: string; count: number };
  recentCheckin: null | { checkedAt: string; result: string; reason: string | null };
  checkin: { id: string; checkedAt: string | null };
}

function safeParseApiError(payload: any, lang: "zh" | "en") {
  const raw = typeof payload?.error === "string" ? payload.error : "";
  if (!raw) return lang === "zh" ? "請求失敗" : "Request failed";
  if (raw === "reason_required") return lang === "zh" ? "必須填寫原因" : "reason is required";
  if (raw === "audit_logs_missing") return lang === "zh" ? "缺少稽核記錄資料表（伺服器設定異常）" : "Audit log table missing (server misconfigured)";
  if (raw === "Forbidden") return lang === "zh" ? "無權限" : "Forbidden";
  if (raw === "Unauthorized") return lang === "zh" ? "未授權" : "Unauthorized";
  return raw;
}

export function ManualAllowPanel() {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const [query, setQuery] = useState("");
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [options, setOptions] = useState<MemberSearchItem[]>([]);
  const [memberId, setMemberId] = useState("");
  const [reason, setReason] = useState("");
  const [deviceId, setDeviceId] = useState("");

  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<string | null>(null);
  const [result, setResult] = useState<ManualAllowResponse | null>(null);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            title: "人工放行",
            hint: "僅用於例外情境，系統會寫入稽核記錄。",
            searchPlaceholder: "姓名 / 電話",
            searchBtn: "搜尋會員",
            searchBusy: "搜尋中...",
            memberSelect: "選擇會員",
            deviceId: "裝置 ID（選填）",
            reasonPlaceholder: "放行原因（必填）",
            submit: "執行人工放行",
            submitBusy: "提交中...",
            success: "人工放行已完成並記錄",
            result: "結果",
            membership: "會員權益",
            today: "今日",
            reason: "原因",
            unknown: "未知",
            active: "啟用中",
            inactive: "未啟用",
          }
        : {
            title: "Manual Allow",
            hint: "Use for exceptional cases only. Action will be written to audit log.",
            searchPlaceholder: "name / phone",
            searchBtn: "Search Member",
            searchBusy: "Searching...",
            memberSelect: "Select member",
            deviceId: "deviceId (optional)",
            reasonPlaceholder: "Reason (required)",
            submit: "Run Manual Allow",
            submitBusy: "Submitting...",
            success: "Manual allow completed and logged",
            result: "Result",
            membership: "Membership",
            today: "Today",
            reason: "Reason",
            unknown: "unknown",
            active: "active",
            inactive: "inactive",
          },
    [lang],
  );

  const canSubmit = useMemo(() => !!memberId && !!reason.trim() && !submitLoading, [memberId, reason, submitLoading]);

  const searchMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError(null);
    setSubmitOk(null);
    try {
      const res = await fetch(`/api/members?q=${encodeURIComponent(query.trim())}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(safeParseApiError(payload, lang));
      setOptions((payload.items || []) as MemberSearchItem[]);
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : lang === "zh" ? "會員搜尋失敗" : "Member search failed");
      setOptions([]);
    } finally {
      setMembersLoading(false);
    }
  }, [lang, query]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitLoading(true);
    setSubmitError(null);
    setSubmitOk(null);
    setResult(null);
    try {
      const res = await fetch("/api/entry/manual-allow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          reason: reason.trim(),
          deviceId: deviceId.trim() || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(safeParseApiError(payload, lang));
      setResult(payload as ManualAllowResponse);
      setSubmitOk(t.success);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : lang === "zh" ? "人工放行失敗" : "Manual allow failed");
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <section className="fdGlassSubPanel" style={{ marginTop: 14, padding: 14 }}>
      <div className="actions" style={{ marginTop: 0, justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="sectionTitle" style={{ margin: 0 }}>{t.title}</h2>
        <p className="fdGlassText" style={{ marginTop: 0, fontSize: 12 }}>{t.hint}</p>
      </div>

      {membersError ? <p className="error" style={{ marginTop: 8 }}>{membersError}</p> : null}
      {submitError ? <p className="error" style={{ marginTop: 8 }}>{submitError}</p> : null}
      {submitOk ? <p className="fdGlassText" style={{ marginTop: 8, color: "#d9ffe0" }}>{submitOk}</p> : null}

      <div className="fdTwoCol" style={{ marginTop: 8 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="input"
          />
          <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void searchMembers()} disabled={membersLoading}>
            {membersLoading ? t.searchBusy : t.searchBtn}
          </button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="input" required>
            <option value="">{t.memberSelect}</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name} | {m.phone || "-"} | {m.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder={t.deviceId} className="input" />
        </div>
      </div>

      <form style={{ marginTop: 8 }} onSubmit={submit}>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t.reasonPlaceholder}
          className="input"
          style={{ minHeight: 92 }}
          required
        />
        <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={!canSubmit}>
          {submitLoading ? t.submitBusy : t.submit}
        </button>
      </form>

      {result ? (
        <div className="fdTwoCol" style={{ marginTop: 12 }}>
          <div className="fdGlassSubPanel" style={{ padding: 12 }}>
            <div className="actions" style={{ marginTop: 0, justifyContent: "space-between" }}>
              <strong>{t.result}</strong>
              <strong>{result.result.result}</strong>
            </div>
            <p className="fdGlassText" style={{ marginTop: 6 }}>{lang === "zh" ? "方式" : "method"}: {result.result.method}</p>
            <p className="fdGlassText" style={{ marginTop: 6 }}>
              {result.member.fullName || (lang === "zh" ? "（未命名）" : "(no name)")} | {result.member.phoneLast4 || "-"}
            </p>
            <p className="fdGlassText" style={{ marginTop: 6 }}>
              {lang === "zh" ? "會員編號" : "memberId"}: <code>{result.member.id}</code>
            </p>
          </div>

          <div className="fdGlassSubPanel" style={{ padding: 12 }}>
            <p className="fdGlassText" style={{ marginTop: 0 }}>{t.membership}</p>
            <p className="fdGlassText">
              {lang === "zh" ? "月會員" : "monthly"}: {result.membership.monthly.expiresAt ? new Date(result.membership.monthly.expiresAt).toLocaleDateString() : "-"}
              {" | "}
              {result.membership.monthly.isActive === null ? t.unknown : result.membership.monthly.isActive ? t.active : t.inactive}
            </p>
            <p className="fdGlassText">{lang === "zh" ? "票券" : "passes"}: {result.membership.passes.length}</p>
            <p className="fdGlassText">{t.today}: {result.today.count}</p>
            <p className="fdGlassText" style={{ marginTop: 8 }}>
              {t.reason}: {result.result.reason}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
