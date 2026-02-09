"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";

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

function safeParseApiError(payload: any) {
  const raw = typeof payload?.error === "string" ? payload.error : "";
  if (!raw) return "Request failed";
  if (raw === "reason_required") return "請輸入原因";
  if (raw === "audit_logs_missing") return "Audit log table missing (server misconfigured)";
  if (raw === "Forbidden") return "Forbidden";
  if (raw === "Unauthorized") return "Unauthorized";
  return raw;
}

export function ManualAllowPanel() {
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

  const canSubmit = useMemo(() => !!memberId && !!reason.trim() && !submitLoading, [memberId, reason, submitLoading]);

  const searchMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError(null);
    setSubmitOk(null);
    try {
      const res = await fetch(`/api/members?q=${encodeURIComponent(query.trim())}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(safeParseApiError(payload));
      setOptions((payload.items || []) as MemberSearchItem[]);
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : "Member search failed");
      setOptions([]);
    } finally {
      setMembersLoading(false);
    }
  }, [query]);

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
      if (!res.ok) throw new Error(safeParseApiError(payload));
      setResult(payload as ManualAllowResponse);
      setSubmitOk("已手動放行並寫入稽核");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Manual allow failed");
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">手動放行</h2>
        <p className="text-xs text-gray-600">需要原因，並會寫入 audit log</p>
      </div>

      {membersError ? <p className="mt-3 text-sm text-red-600">{membersError}</p> : null}
      {submitError ? <p className="mt-3 text-sm text-red-600">{submitError}</p> : null}
      {submitOk ? <p className="mt-3 text-sm text-green-700">{submitOk}</p> : null}

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="電話 / 姓名"
          className="rounded border px-3 py-2 text-sm md:col-span-2"
        />
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          onClick={() => void searchMembers()}
          disabled={membersLoading}
        >
          {membersLoading ? "搜尋中..." : "搜尋會員"}
        </button>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="rounded border px-3 py-2 text-sm md:col-span-2"
          required
        >
          <option value="">選擇會員</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name} | {m.phone || "-"} | {m.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <input
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder="deviceId (optional)"
          className="rounded border px-3 py-2 text-sm"
        />
      </div>

      <form className="mt-3" onSubmit={submit}>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="手動放行原因 (必填)"
          className="min-h-[84px] w-full rounded border px-3 py-2 text-sm"
          required
        />

        <button type="submit" className="mt-3 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50" disabled={!canSubmit}>
          {submitLoading ? "提交中..." : "手動放行"}
        </button>
      </form>

      {result ? (
        <div className="mt-4 rounded border bg-gray-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              {result.member.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={result.member.photoUrl} alt="member photo" className="h-12 w-12 rounded object-cover" />
              ) : (
                <div className="h-12 w-12 rounded bg-gray-200" />
              )}
              <div className="min-w-0">
                <p className="truncate font-medium">{result.member.fullName || "(no name)"}</p>
                <p className="mt-1 text-xs text-gray-600">phone last4: {result.member.phoneLast4 || "-"}</p>
                <p className="mt-1 text-xs text-gray-600">
                  memberId: <code>{result.member.id}</code>
                </p>
              </div>
            </div>
            <div className="text-right text-xs text-gray-700">
              <p className="font-semibold">{result.result.result}</p>
              <p className="mt-1 text-gray-600">method: {result.result.method}</p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded border bg-white p-3">
              <p className="text-xs font-semibold text-gray-700">Membership</p>
              <p className="mt-2 text-sm">
                monthly:{" "}
                {result.membership.monthly.expiresAt ? new Date(result.membership.monthly.expiresAt).toLocaleDateString() : "-"}
                {" | "}
                {result.membership.monthly.isActive === null ? "unknown" : result.membership.monthly.isActive ? "active" : "inactive"}
              </p>
              <p className="mt-2 text-xs text-gray-600">passes: {result.membership.passes.length}</p>
            </div>
            <div className="rounded border bg-white p-3">
              <p className="text-xs font-semibold text-gray-700">Today</p>
              <p className="mt-2 text-sm">checkins: {result.today.count}</p>
              <p className="mt-1 text-xs text-gray-600">
                recent:{" "}
                {result.recentCheckin ? new Date(result.recentCheckin.checkedAt).toLocaleString() : "-"}
              </p>
            </div>
            <div className="rounded border bg-white p-3 md:col-span-2">
              <p className="text-xs font-semibold text-gray-700">Reason</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{result.result.reason}</p>
              {result.member.note ? <p className="mt-2 text-xs text-gray-600">note: {result.member.note}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

