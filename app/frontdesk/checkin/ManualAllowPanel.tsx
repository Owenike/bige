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
  if (!raw) return lang === "zh" ? "\u8acb\u6c42\u5931\u6557" : "Request failed";
  if (raw === "reason_required") return lang === "zh" ? "\u8acb\u8f38\u5165\u539f\u56e0" : "reason is required";
  if (raw === "audit_logs_missing") return lang === "zh" ? "\u7a3d\u6838\u8cc7\u6599\u8868\u907a\u5931\uff08\u4f3a\u670d\u5668\u8a2d\u5b9a\u554f\u984c\uff09" : "Audit log table missing (server misconfigured)";
  if (raw === "Forbidden") return lang === "zh" ? "\u7121\u6b0a\u9650" : "Forbidden";
  if (raw === "Unauthorized") return lang === "zh" ? "\u672a\u767b\u5165" : "Unauthorized";
  return raw;
}

export function ManualAllowPanel({ onDone }: { onDone?: () => void }) {
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
            title: "\u4eba\u5de5\u653e\u884c",
            hint: "\u50c5\u9650\u4f8b\u5916\u60c5\u5883\u4f7f\u7528\uff0c\u64cd\u4f5c\u6703\u5beb\u5165\u7a3d\u6838\u65e5\u8a8c\u3002",
            searchPlaceholder: "\u59d3\u540d / \u96fb\u8a71",
            searchBtn: "\u641c\u5c0b\u6703\u54e1",
            searchBusy: "\u641c\u5c0b\u4e2d...",
            memberSelect: "\u9078\u64c7\u6703\u54e1",
            deviceId: "\u8a2d\u5099 ID\uff08\u9078\u586b\uff09",
            reasonPlaceholder: "\u653e\u884c\u539f\u56e0\uff08\u5fc5\u586b\uff09",
            submit: "\u9001\u51fa\u4eba\u5de5\u653e\u884c",
            submitBusy: "\u63d0\u4ea4\u4e2d...",
            success: "\u4eba\u5de5\u653e\u884c\u5df2\u5b8c\u6210\u4e26\u8a18\u9304",
            result: "\u7d50\u679c",
            membership: "\u6703\u7c4d\u6982\u89bd",
            today: "\u4eca\u65e5",
            reason: "\u539f\u56e0",
            unknown: "\u672a\u77e5",
            active: "\u6709\u6548",
            inactive: "\u7121\u6548",
            methodLabel: "\u65b9\u5f0f",
            noName: "\uff08\u7121\u59d3\u540d\uff09",
            memberIdLabel: "\u6703\u54e1 ID",
            monthlyLabel: "\u6708\u8cbb",
            passesLabel: "\u6b21\u6578\u5361",
            searchFail: "\u6703\u54e1\u641c\u5c0b\u5931\u6557",
            submitFail: "\u4eba\u5de5\u653e\u884c\u5931\u6557",
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
            methodLabel: "method",
            noName: "(no name)",
            memberIdLabel: "memberId",
            monthlyLabel: "monthly",
            passesLabel: "passes",
            searchFail: "Member search failed",
            submitFail: "Manual allow failed",
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
      setMembersError(err instanceof Error ? err.message : t.searchFail);
      setOptions([]);
    } finally {
      setMembersLoading(false);
    }
  }, [lang, query, t.searchFail]);

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
      onDone?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t.submitFail);
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
            <p className="fdGlassText" style={{ marginTop: 6 }}>{t.methodLabel}: {result.result.method}</p>
            <p className="fdGlassText" style={{ marginTop: 6 }}>
              {result.member.fullName || t.noName} | {result.member.phoneLast4 || "-"}
            </p>
            <p className="fdGlassText" style={{ marginTop: 6 }}>
              {t.memberIdLabel}: <code>{result.member.id}</code>
            </p>
          </div>

          <div className="fdGlassSubPanel" style={{ padding: 12 }}>
            <p className="fdGlassText" style={{ marginTop: 0 }}>{t.membership}</p>
            <p className="fdGlassText">
              {t.monthlyLabel}: {result.membership.monthly.expiresAt ? new Date(result.membership.monthly.expiresAt).toLocaleDateString() : "-"}
              {" | "}
              {result.membership.monthly.isActive === null ? t.unknown : result.membership.monthly.isActive ? t.active : t.inactive}
            </p>
            <p className="fdGlassText">{t.passesLabel}: {result.membership.passes.length}</p>
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
