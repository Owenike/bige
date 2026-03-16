"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./coverage.module.css";
import type {
  MemberRecipientCoverageItem,
  NotificationCoverageBucket,
  NotificationCoverageSummary,
  NotificationRemediationActionSummary,
  NotificationRemediationHistoryDetail,
  NotificationRemediationHistoryListMeta,
  NotificationRemediationHistoryOutcomeFilter,
  NotificationRemediationHistoryListItem,
  NotificationRemediationHistorySort,
  NotificationRemediationItem,
  NotificationRemediationSummary,
} from "../../../types/notification-coverage";

type CoverageResponse = { summary: NotificationCoverageSummary };
type MemberCoverageResponse = { items: MemberRecipientCoverageItem[] };
type RemediationResponse = { summary: NotificationRemediationSummary; items: NotificationRemediationItem[] };
type RemediationHistoryListResponse = {
  items: NotificationRemediationHistoryListItem[];
  meta: NotificationRemediationHistoryListMeta;
};
type RemediationHistoryDetailResponse = { detail: NotificationRemediationHistoryDetail };
type PresetValue = "today" | "this_week" | "this_month" | "custom";
type HistoryActionType = "bulk_resend" | "";
type HistoryOutcomeFilter = NotificationRemediationHistoryOutcomeFilter | "";
type HistorySort = NotificationRemediationHistorySort;
type HistoryChannel = "email" | "line" | "sms" | "webhook" | "in_app" | "other" | "";
type HistoryPageSize = "10" | "20" | "50";

const STORAGE_KEY = "manager-notification-coverage:last-action";
const PRESETS: PresetValue[] = ["today", "this_week", "this_month", "custom"];
const BUCKETS: Array<{ value: NotificationCoverageBucket | ""; label: string }> = [
  { value: "", label: "All buckets" },
  { value: "recipient_missing:email", label: "Missing email" },
  { value: "recipient_missing:line_user_id", label: "Missing LINE identity" },
  { value: "channel_disabled", label: "Channel disabled" },
  { value: "provider_unconfigured", label: "Provider unconfigured" },
  { value: "preference_opt_out", label: "Preference opt-out" },
  { value: "invalid_recipient", label: "Invalid recipient" },
  { value: "template_missing", label: "Template missing" },
  { value: "other", label: "Other" },
];

function fmtDate(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function presetRange(preset: PresetValue) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (preset === "today") return { dateFrom: fmtDate(start), dateTo: fmtDate(end) };
  if (preset === "this_week") {
    const day = start.getDay();
    start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
    end.setDate(start.getDate() + 6);
    return { dateFrom: fmtDate(start), dateTo: fmtDate(end) };
  }
  if (preset === "this_month") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
    return { dateFrom: fmtDate(start), dateTo: fmtDate(end) };
  }
  return { dateFrom: "", dateTo: "" };
}

function channelBadge(mode: MemberRecipientCoverageItem["channelStates"][number]["effectiveMode"]) {
  if (mode === "provider") return `${styles.badge} ${styles.statusReachable}`;
  if (mode === "simulated") return `${styles.badge} ${styles.statusSimulated}`;
  if (mode === "missing_recipient") return `${styles.badge} ${styles.statusIssue}`;
  return `${styles.badge} ${styles.statusBlocked}`;
}

function runtimeBadge(mode: NotificationRemediationItem["currentRuntime"]) {
  if (mode === "provider") return `${styles.badge} ${styles.statusReachable}`;
  if (mode === "simulated") return `${styles.badge} ${styles.statusSimulated}`;
  return `${styles.badge} ${styles.statusBlocked}`;
}

export default function ManagerNotificationCoveragePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initPreset = (searchParams.get("preset") as PresetValue | null) || "this_month";
  const initialHistoryPage = Math.max(1, Number(searchParams.get("page") || 1) || 1);
  const range = presetRange(initPreset);
  const [branchId, setBranchId] = useState(searchParams.get("branch_id") || "");
  const [bucket, setBucket] = useState<NotificationCoverageBucket | "">((searchParams.get("bucket") as NotificationCoverageBucket | null) || "");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [preset, setPreset] = useState<PresetValue>(initPreset);
  const [dateFrom, setDateFrom] = useState(searchParams.get("date_from") || range.dateFrom);
  const [dateTo, setDateTo] = useState(searchParams.get("date_to") || range.dateTo);
  const [summary, setSummary] = useState<NotificationCoverageSummary | null>(null);
  const [members, setMembers] = useState<MemberRecipientCoverageItem[]>([]);
  const [queue, setQueue] = useState<NotificationRemediationItem[]>([]);
  const [queueSummary, setQueueSummary] = useState<NotificationRemediationSummary | null>(null);
  const [historyItems, setHistoryItems] = useState<NotificationRemediationHistoryListItem[]>([]);
  const [historyMeta, setHistoryMeta] = useState<NotificationRemediationHistoryListMeta | null>(null);
  const [historyActionType, setHistoryActionType] = useState<HistoryActionType>((searchParams.get("action_type") as HistoryActionType | null) || "bulk_resend");
  const [historyOutcome, setHistoryOutcome] = useState<HistoryOutcomeFilter>((searchParams.get("outcome") as HistoryOutcomeFilter | null) || "");
  const [historyChannel, setHistoryChannel] = useState<HistoryChannel>((searchParams.get("channel") as HistoryChannel | null) || "");
  const [historySort, setHistorySort] = useState<HistorySort>((searchParams.get("sort") as HistorySort | null) || "latest");
  const [historyPage, setHistoryPage] = useState(initialHistoryPage);
  const [historyPageSize, setHistoryPageSize] = useState<HistoryPageSize>(((searchParams.get("page_size") as HistoryPageSize | null) || "20"));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lastAction, setLastAction] = useState<NotificationRemediationActionSummary | null>(null);
  const [drawerSummary, setDrawerSummary] = useState<NotificationRemediationActionSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const historyRunId = searchParams.get("history_run_id");

  useEffect(() => {
    if (preset === "custom") return;
    const next = presetRange(preset);
    setDateFrom(next.dateFrom);
    setDateTo(next.dateTo);
  }, [preset]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (branchId) params.set("branch_id", branchId);
    if (bucket) params.set("bucket", bucket);
    if (search.trim()) params.set("search", search.trim());
    if (preset) params.set("preset", preset);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (historyActionType) params.set("action_type", historyActionType);
    if (historyOutcome) params.set("outcome", historyOutcome);
    if (historyChannel) params.set("channel", historyChannel);
    if (historySort) params.set("sort", historySort);
    if (historyPage > 1) params.set("page", String(historyPage));
    if (historyPageSize !== "20") params.set("page_size", historyPageSize);
    if (drawerOpen && drawerSummary?.runId) params.set("history_run_id", drawerSummary.runId);
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }, [branchId, bucket, dateFrom, dateTo, drawerOpen, drawerSummary?.runId, historyActionType, historyChannel, historyOutcome, historyPage, historyPageSize, historySort, pathname, preset, router, search]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try { setLastAction(JSON.parse(raw) as NotificationRemediationActionSummary); } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !lastAction) return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lastAction));
  }, [lastAction]);

  const scopeQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (branchId) p.set("branch_id", branchId);
    if (bucket) p.set("bucket", bucket);
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    p.set("preset", preset);
    return p;
  }, [branchId, bucket, dateFrom, dateTo, preset]);

  const listQuery = useMemo(() => {
    const p = new URLSearchParams(scopeQuery);
    if (search.trim()) p.set("search", search.trim());
    p.set("limit", "160");
    return p.toString();
  }, [scopeQuery, search]);

  const historyQuery = useMemo(() => {
    const p = new URLSearchParams(scopeQuery);
    if (search.trim()) p.set("search", search.trim());
    if (historyActionType) p.set("action_type", historyActionType);
    if (historyOutcome) p.set("outcome", historyOutcome);
    if (historyChannel) p.set("channel", historyChannel);
    if (historySort) p.set("sort", historySort);
    p.set("page", String(historyPage));
    p.set("page_size", historyPageSize);
    return p.toString();
  }, [historyActionType, historyChannel, historyOutcome, historyPage, historyPageSize, historySort, scopeQuery, search]);

  const historyFilterKey = useMemo(
    () =>
      JSON.stringify({
        branchId,
        bucket,
        dateFrom,
        dateTo,
        preset,
        search: search.trim(),
        historyActionType,
        historyOutcome,
        historyChannel,
        historySort,
        historyPageSize,
      }),
    [branchId, bucket, dateFrom, dateTo, historyActionType, historyChannel, historyOutcome, historyPageSize, historySort, preset, search],
  );
  const [historyFilterSignature, setHistoryFilterSignature] = useState(historyFilterKey);

  useEffect(() => {
    if (historyFilterSignature === historyFilterKey) return;
    setHistoryFilterSignature(historyFilterKey);
    setHistoryPage(1);
  }, [historyFilterKey, historyFilterSignature]);

  const coverageHref = useCallback((nextBucket?: NotificationCoverageBucket | "") => {
    const p = new URLSearchParams(scopeQuery);
    if (nextBucket) p.set("bucket", nextBucket);
    else p.delete("bucket");
    return `/manager/notification-coverage?${p.toString()}`;
  }, [scopeQuery]);

  const coverageHrefForScope = useCallback((scope: NotificationRemediationActionSummary["scope"]) => {
    const p = new URLSearchParams();
    if (scope.branchId) p.set("branch_id", scope.branchId);
    if (scope.bucket) p.set("bucket", scope.bucket);
    if (scope.search) p.set("search", scope.search);
    if (scope.dateFrom) p.set("date_from", scope.dateFrom);
    if (scope.dateTo) p.set("date_to", scope.dateTo);
    p.set("preset", "custom");
    return `/manager/notification-coverage?${p.toString()}`;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [a, b, c, d] = await Promise.all([
      fetch(`/api/manager/notifications/coverage?${scopeQuery.toString()}`, { cache: "no-store" }),
      fetch(`/api/manager/notifications/coverage/members?${listQuery}`, { cache: "no-store" }),
      fetch(`/api/manager/notifications/remediation?${listQuery}`, { cache: "no-store" }),
      fetch(`/api/manager/notifications/remediation/history?${historyQuery}`, { cache: "no-store" }),
    ]);
    const ap = await a.json().catch(() => null);
    const bp = await b.json().catch(() => null);
    const cp = await c.json().catch(() => null);
    const dp = await d.json().catch(() => null);
    if (!a.ok || !b.ok || !c.ok || !d.ok) {
      setError(ap?.error?.message || bp?.error?.message || cp?.error?.message || dp?.error?.message || "Failed to load coverage data.");
      setLoading(false);
      return;
    }
    const nextSummary = ((ap?.data || ap) as CoverageResponse).summary;
    const nextMembers = ((bp?.data || bp) as MemberCoverageResponse).items || [];
    const nextQueuePayload = (cp?.data || cp) as RemediationResponse;
    const nextHistoryPayload = (dp?.data || dp) as RemediationHistoryListResponse;
    const nextHistory = nextHistoryPayload.items || [];
    setSummary(nextSummary);
    setMembers(nextMembers);
    setQueue(nextQueuePayload.items || []);
    setQueueSummary(nextQueuePayload.summary);
    setHistoryItems(nextHistory);
    setHistoryMeta(nextHistoryPayload.meta || null);
    setSelectedIds((current) => current.filter((id) => (nextQueuePayload.items || []).some((item) => item.deliveryId === id)));
    setDrafts((current) => {
      const next = { ...current };
      for (const item of nextMembers) if (typeof next[item.memberId] !== "string") next[item.memberId] = item.email || "";
      return next;
    });
    setLoading(false);
  }, [historyQuery, listQuery, scopeQuery]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!historyMeta) return;
    if (historyMeta.page !== historyPage) {
      setHistoryPage(historyMeta.page);
    }
    const resolvedPageSize = String(historyMeta.pageSize) as HistoryPageSize;
    if (resolvedPageSize !== historyPageSize && (resolvedPageSize === "10" || resolvedPageSize === "20" || resolvedPageSize === "50")) {
      setHistoryPageSize(resolvedPageSize);
    }
  }, [historyMeta, historyPage, historyPageSize]);

  async function saveEmail(memberId: string) {
    setSavingMemberId(memberId);
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/manager/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: (drafts[memberId] || "").trim() || null }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message || payload?.error || "Failed to update member email.");
      setSavingMemberId(null);
      return;
    }
    setSavingMemberId(null);
    setMessage("Member email updated. Coverage refreshed.");
    await load();
  }

  const openPersistedHistory = useCallback(async (runId: string, fallback?: NotificationRemediationActionSummary | null) => {
    const response = await fetch(`/api/manager/notifications/remediation/history/${runId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (fallback) {
        setDrawerSummary(fallback);
        setDrawerOpen(true);
        return;
      }
      setError(payload?.error?.message || "Failed to load remediation history detail.");
      return;
    }
    const detail = ((payload?.data || payload) as RemediationHistoryDetailResponse).detail;
    setDrawerSummary(detail);
    setDrawerOpen(true);
  }, []);

  async function reopenLastAction() {
    if (!lastAction) return;
    if (lastAction.runId) {
      await openPersistedHistory(lastAction.runId, lastAction);
      return;
    }
    setDrawerSummary(lastAction);
    setDrawerOpen(true);
  }

  async function resendSelected() {
    if (selectedIds.length === 0) {
      setError("Select at least one remediation item.");
      return;
    }
    setResending(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/manager/notifications/remediation/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliveryIds: selectedIds,
        branchId: branchId || null,
        bucket: bucket || null,
        search: search.trim() || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message || "Bulk resend failed.");
      setResending(false);
      return;
    }
    const next = (payload?.data?.summary || payload?.summary) as NotificationRemediationActionSummary;
    setLastAction(next);
    setDrawerSummary(next);
    setDrawerOpen(true);
    setSelectedIds([]);
    setMessage(`Bulk resend finished. Succeeded ${next.succeeded}, failed ${next.failed}, skipped ${next.skipped}, blocked ${next.blocked}.`);
    setResending(false);
    await load();
  }

  useEffect(() => {
    if (!historyRunId) return;
    if (drawerSummary?.runId === historyRunId && drawerOpen) return;
    void openPersistedHistory(historyRunId, lastAction && lastAction.runId === historyRunId ? lastAction : null);
  }, [drawerOpen, drawerSummary?.runId, historyRunId, lastAction, openPersistedHistory]);

  const allSelected = queue.length > 0 && queue.every((item) => selectedIds.includes(item.deliveryId));

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>Notification Coverage</div>
          <h1 className={styles.title}>Coverage, remediation, and result traceability</h1>
          <p className={styles.subtitle}>Summary, bucket, member, and delivery drilldown now share the same branch/date scope and default ranking.</p>
          <div className={styles.heroRow}>
            <Link className={styles.pill} href="/manager/notifications">Open notifications</Link>
            <Link className={styles.pill} href="/manager/members">Open members</Link>
          </div>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}
        {message ? <div className={styles.notice}>{message}</div> : null}

        <section className={styles.panel}>
          <div className={styles.filterHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Scope</h2>
              <p className={styles.muted}>Branch/date filters are shared across summary, bucket metrics, members, and remediation queue.</p>
            </div>
            <div className={styles.badgeRow}>
              {PRESETS.map((value) => (
                <button key={value} type="button" className={`${styles.tabButton} ${preset === value ? styles.tabButtonActive : ""}`} onClick={() => setPreset(value)}>
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.filters}>
            <select className={styles.select} value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">All branches</option>
              {(summary?.branches || []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
            <select className={styles.select} value={bucket} onChange={(event) => setBucket(event.target.value as NotificationCoverageBucket | "")}>
              {BUCKETS.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
            </select>
            <input className={styles.input} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            <input className={styles.input} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            <input className={styles.input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search member or booking reference" />
            <button className={styles.ghostButton} type="button" onClick={() => void load()}>Refresh</button>
          </div>
        </section>

        <section className={styles.grid}>
          <article className={styles.panel}>
            <h2 className={styles.sectionTitle}>Coverage Summary</h2>
            <div className={styles.cardGrid}>
              <div className={styles.card}><div className={styles.cardLabel}>Members</div><div className={styles.cardValue}>{summary?.memberCount || 0}</div></div>
              <div className={styles.card}><div className={styles.cardLabel}>Email reachable</div><div className={styles.cardValue}>{summary?.emailReachableCount || 0}</div></div>
              <div className={styles.card}><div className={styles.cardLabel}>LINE reachable</div><div className={styles.cardValue}>{summary?.lineReachableCount || 0}</div></div>
              <div className={styles.card}><div className={styles.cardLabel}>Simulated only</div><div className={styles.cardValue}>{summary?.simulatedOnlyCount || 0}</div></div>
              <div className={styles.card}><div className={styles.cardLabel}>Skipped</div><div className={styles.cardValue}>{summary?.skippedCount || 0}</div></div>
            </div>
          </article>

          <article className={styles.panel}>
            <h2 className={styles.sectionTitle}>Skipped Reason Breakdown</h2>
            <div className={styles.reasonList}>
              {(summary?.skippedReasonBreakdown || []).map((item) => (
                <button key={item.bucket} type="button" className={styles.listItem} onClick={() => setBucket(item.bucket)}>
                  <span>{item.bucket}</span>
                  <strong>{item.count}</strong>
                </button>
              ))}
              {!loading && (summary?.skippedReasonBreakdown || []).length === 0 ? <div className={styles.muted}>No skipped deliveries in this scope.</div> : null}
            </div>
          </article>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.sectionTitle}>Bucket Metrics</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Bucket</th><th>Members</th><th>Deliveries</th><th>Latest</th><th>Remediable</th><th>Blocked</th></tr></thead>
              <tbody>
                {(summary?.bucketMetrics || []).map((metric) => (
                  <tr key={metric.bucket}>
                    <td><button type="button" className={styles.linkButton} onClick={() => setBucket(metric.bucket)}>{metric.bucket}</button></td>
                    <td>{metric.affectedMembersCount}</td>
                    <td>{metric.affectedDeliveriesCount}</td>
                    <td>{metric.latestOccurrence || "-"}</td>
                    <td>{metric.remediableNowCount}</td>
                    <td>{metric.blockedNowCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.sectionTitle}>Member Recipient Coverage</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Member</th><th>Contact</th><th>Channel state</th><th>Latest issue</th><th>Actions</th></tr></thead>
              <tbody>
                {members.map((item) => (
                  <tr key={item.memberId}>
                    <td className={styles.memberCell}>
                      <div className={styles.memberName}>{item.fullName}</div>
                      <div className={styles.muted}>{item.branchName || "Unassigned branch"}</div>
                      <Link href={`/manager/members/${item.memberId}`}>Open member</Link>
                    </td>
                    <td><div className={styles.compactStack}><span>Email: {item.email || "-"}</span><span>Phone: {item.phone || "-"}</span><span>LINE: {item.lineUserId || "-"}</span></div></td>
                    <td><div className={styles.compactStack}>{item.channelStates.map((state) => <span key={`${item.memberId}:${state.channel}`} className={channelBadge(state.effectiveMode)}>{state.channel}: {state.effectiveMode}</span>)}</div></td>
                    <td><div className={styles.compactStack}><strong>{item.lastIssueBucket || "-"}</strong><span className={styles.muted}>{item.lastIssueReason || "No issue in scope."}</span></div></td>
                    <td>
                      <div className={styles.actionStack}>
                        <div className={styles.inlineField}>
                          <input className={styles.input} value={drafts[item.memberId] || ""} onChange={(event) => setDrafts((current) => ({ ...current, [item.memberId]: event.target.value }))} placeholder="Update email" />
                          <button className={styles.saveButton} type="button" disabled={savingMemberId === item.memberId} onClick={() => void saveEmail(item.memberId)}>{savingMemberId === item.memberId ? "Saving..." : "Save email"}</button>
                        </div>
                        <div className={styles.helper}>LINE identity remains read-only here. This workflow only routes you to the member detail.</div>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && members.length === 0 ? <tr><td colSpan={5} className={styles.muted}>No members match this scope.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.listMeta}>
            <div>
              <h2 className={styles.sectionTitle}>Remediation Queue</h2>
              <p className={styles.muted}>Rows are ranked by actionability, latest occurrence, then member and booking reference.</p>
            </div>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>total {queueSummary?.total || 0}</span>
              <span className={styles.badge}>remediable {queueSummary?.remediableNow || 0}</span>
              <span className={styles.badge}>config {queueSummary?.blockedByConfig || 0}</span>
              <span className={styles.badge}>preference {queueSummary?.blockedByPreference || 0}</span>
              <span className={styles.badge}>identity {queueSummary?.blockedByIdentity || 0}</span>
            </div>
          </div>
          <div className={styles.heroRow}>
            <button className={styles.primaryButton} type="button" onClick={() => void resendSelected()} disabled={resending || selectedIds.length === 0}>{resending ? "Running bulk resend..." : "Bulk resend selected"}</button>
            {lastAction ? <button className={styles.ghostButton} type="button" onClick={() => void reopenLastAction()}>Open last bulk resend result</button> : null}
            <button className={styles.ghostButton} type="button" onClick={() => setSelectedIds(allSelected ? [] : queue.map((item) => item.deliveryId))}>{allSelected ? "Clear selection" : "Select visible rows"}</button>
          </div>
          <div className={styles.notice}>
            This workflow only uses resend. It does not introduce a source booking requeue model. Provider/config/preference/identity blocks remain visible and blocked.
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : queue.map((item) => item.deliveryId))} /></th><th>Bucket / delivery</th><th>Member / booking</th><th>Runtime / contact</th><th>Suggestion</th><th>Links</th></tr></thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item.deliveryId}>
                    <td><input type="checkbox" checked={selectedIds.includes(item.deliveryId)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.deliveryId] : current.filter((value) => value !== item.deliveryId))} /></td>
                    <td><div className={styles.compactStack}><strong>{item.bucket}</strong><span className={styles.muted}>{item.channel} / {item.deliveryStatus} / {item.deliveryId.slice(0, 8)}</span><span className={styles.muted}>{item.rawReason || "-"}</span></div></td>
                    <td><div className={styles.compactStack}><strong>{item.memberName || "Unknown member"}</strong><span className={styles.muted}>{item.bookingReference || "No booking reference"}</span><span className={styles.muted}>{item.bookingStartsAt || "-"}</span></div></td>
                    <td><div className={styles.compactStack}><span className={runtimeBadge(item.currentRuntime)}>runtime: {item.currentRuntime}</span><span>Email: {item.currentEmail || "-"}</span><span>LINE: {item.currentLineUserId || "-"}</span></div></td>
                    <td><div className={styles.compactStack}><strong>{item.hintLabel}</strong><span className={styles.muted}>{item.canResendNow ? "Ready for resend now" : "Blocked until fixed"}</span></div></td>
                    <td><div className={styles.compactStack}>{item.memberId ? <Link href={`/manager/members/${item.memberId}`}>Open member</Link> : null}<Link href={`/manager/notifications?search=${encodeURIComponent(item.bookingReference || item.deliveryId)}`}>Open notifications</Link><Link href={coverageHref(item.bucket)}>Open coverage</Link></div></td>
                  </tr>
                ))}
                {!loading && queue.length === 0 ? <tr><td colSpan={6} className={styles.muted}>No remediation items match this scope.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.listMeta}>
            <div>
              <h2 className={styles.sectionTitle}>Recent Remediation Runs</h2>
              <p className={styles.muted}>Server-side persisted bulk resend history stays available after refresh and across sessions. Search uses the shared scope input above.</p>
            </div>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>runs {historyMeta?.totalCount || 0}</span>
              <span className={styles.badge}>page {historyMeta?.page || historyPage} / {historyMeta?.totalPages || 1}</span>
              <span className={styles.badge}>page size {historyMeta?.pageSize || historyPageSize}</span>
            </div>
          </div>
          <div className={styles.filters}>
            <select className={styles.select} value={historyActionType} onChange={(event) => setHistoryActionType(event.target.value as HistoryActionType)}>
              <option value="">All actions</option>
              <option value="bulk_resend">bulk_resend</option>
            </select>
            <select className={styles.select} value={historyOutcome} onChange={(event) => setHistoryOutcome(event.target.value as HistoryOutcomeFilter)}>
              <option value="">All outcomes</option>
              <option value="has_failed">Has failed</option>
              <option value="has_blocked">Has blocked</option>
              <option value="all_success">All success</option>
            </select>
            <select className={styles.select} value={historyChannel} onChange={(event) => setHistoryChannel(event.target.value as HistoryChannel)}>
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="line">LINE</option>
              <option value="sms">SMS</option>
              <option value="webhook">Webhook</option>
              <option value="in_app">In App</option>
              <option value="other">Other</option>
            </select>
            <select className={styles.select} value={historySort} onChange={(event) => setHistorySort(event.target.value as HistorySort)}>
              <option value="latest">Latest first</option>
              <option value="issues_desc">Most issues first</option>
              <option value="requested_desc">Largest batch first</option>
              <option value="success_rate_asc">Lowest success rate first</option>
            </select>
            <select className={styles.select} value={historyPageSize} onChange={(event) => setHistoryPageSize(event.target.value as HistoryPageSize)}>
              <option value="10">10 per page</option>
              <option value="20">20 per page</option>
              <option value="50">50 per page</option>
            </select>
            <button className={styles.ghostButton} type="button" onClick={() => { setHistoryActionType("bulk_resend"); setHistoryOutcome(""); setHistoryChannel(""); setHistorySort("latest"); setHistoryPageSize("20"); }}>
              Reset history filters
            </button>
          </div>
          {historyMeta?.defaultedDateWindow ? (
            <div className={styles.notice}>
              History date scope defaulted to {historyMeta.effectiveDateFrom} - {historyMeta.effectiveDateTo} to avoid wide audit log scans.
            </div>
          ) : null}
          {historyMeta?.pageOverflowed ? (
            <div className={styles.notice}>
              Requested page exceeded the available remediation history pages. The list was reset to page {historyMeta.page}.
            </div>
          ) : null}
          <div className={styles.listMeta}>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>current {historyMeta?.currentCount || historyItems.length}</span>
              <span className={styles.badge}>failed + blocked {(historyItems.reduce((sum, item) => sum + item.problemCount, 0))}</span>
            </div>
            <div className={styles.badgeRow}>
              <button className={styles.ghostButton} type="button" disabled={!historyMeta?.hasPrev} onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}>
                Previous page
              </button>
              <button className={styles.ghostButton} type="button" disabled={!historyMeta?.hasNext} onClick={() => setHistoryPage((current) => current + 1)}>
                Next page
              </button>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Performed</th><th>Scope</th><th>Counts</th><th>Channels / buckets</th><th>Links</th></tr></thead>
              <tbody>
                {historyItems.map((item) => (
                  <tr key={item.runId}>
                    <td>
                      <div className={styles.compactStack}>
                        <strong>{item.performedAt}</strong>
                        <span className={styles.muted}>{item.performedByName || item.performedByUserId || "Unknown operator"}</span>
                        <span className={styles.muted}>{item.actionType}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.compactStack}>
                        <span>branch: {item.scope.branchId || "all"}</span>
                        <span>date: {item.scope.dateFrom || "-"} to {item.scope.dateTo || "-"}</span>
                        <span>bucket: {item.scope.bucket || "all"}</span>
                        <span>search: {item.scope.search || "-"}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.compactStack}>
                        <span>requested {item.requested}</span>
                        <span>succeeded {item.succeeded}</span>
                        <span>failed {item.failed}</span>
                        <span>skipped {item.skipped}</span>
                        <span>blocked {item.blocked}</span>
                        <span className={styles.muted}>success rate {(item.successRate * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.compactStack}>
                        <span>{item.channels.join(", ") || "-"}</span>
                        <span className={styles.muted}>{item.buckets.join(", ") || "-"}</span>
                        <span className={styles.muted}>issues {item.problemCount} / success {(item.successRate * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.compactStack}>
                        <button className={styles.linkButton} type="button" onClick={() => void openPersistedHistory(item.runId)}>
                          Open detail
                        </button>
                        <Link href={`/manager/notifications${item.scope.search ? `?search=${encodeURIComponent(item.scope.search)}` : ""}`}>Open notifications</Link>
                        <Link href={coverageHrefForScope(item.scope)}>Open coverage</Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && historyItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles.muted}>
                      {historyMeta?.totalCount === 0
                        ? "No persisted remediation runs in this scope yet."
                        : `No items on page ${historyMeta?.page || historyPage}.`}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {drawerSummary && drawerOpen ? (
          <>
            <button className={styles.drawerBackdrop} type="button" aria-label="Close result detail" onClick={() => setDrawerOpen(false)} />
            <aside className={styles.drawer}>
              <div className={styles.drawerHeader}>
                <div>
                  <div className={styles.eyebrow}>Remediation Result</div>
                  <h2 className={styles.sectionTitle}>Last bulk resend result</h2>
                  <p className={styles.muted}>{drawerSummary.actionType} at {drawerSummary.performedAt}</p>
                </div>
                <button className={styles.ghostButton} type="button" onClick={() => setDrawerOpen(false)}>Close</button>
              </div>
              <div className={styles.badgeRow}>
                <span className={styles.badge}>requested {drawerSummary.requested}</span>
                <span className={styles.badge}>succeeded {drawerSummary.succeeded}</span>
                <span className={styles.badge}>failed {drawerSummary.failed}</span>
                <span className={styles.badge}>skipped {drawerSummary.skipped}</span>
                <span className={styles.badge}>blocked {drawerSummary.blocked}</span>
              </div>
              <div className={styles.notice}>Run {drawerSummary.runId} / operator {drawerSummary.performedByName || drawerSummary.performedByUserId || "-"} / scope: branch {drawerSummary.scope.branchId || "all"} / date {drawerSummary.scope.dateFrom || "-"} to {drawerSummary.scope.dateTo || "-"} / bucket {drawerSummary.scope.bucket || "all"} / search {drawerSummary.scope.search || "-"}</div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Outcome</th><th>Delivery lineage</th><th>Member / booking</th><th>Channel / bucket</th><th>Reason</th><th>Links</th></tr></thead>
                  <tbody>
                    {drawerSummary.results.map((item) => (
                      <tr key={`${item.sourceDeliveryId}:${item.childDeliveryId || item.outcome}`}>
                        <td><span className={`${styles.badge} ${item.outcome === "succeeded" ? styles.statusReachable : item.outcome === "failed" ? styles.statusIssue : styles.statusBlocked}`}>{item.outcome}</span></td>
                        <td><div className={styles.compactStack}><span>source: {item.sourceDeliveryId}</span><span>child: {item.childDeliveryId || "-"}</span><span className={styles.muted}>{item.childDeliveryId ? "Child delivery created" : "No child delivery created"}</span></div></td>
                        <td><div className={styles.compactStack}><span>{item.memberName || "Unknown member"}</span><span className={styles.muted}>member: {item.memberId || "-"}</span><span className={styles.muted}>booking: {item.bookingReference || "-"}</span></div></td>
                        <td><div className={styles.compactStack}><span>{item.channel}</span><span className={styles.muted}>{item.bucket}</span></div></td>
                        <td>{item.reason || "-"}</td>
                        <td><div className={styles.compactStack}><Link href={`/manager/notifications?search=${encodeURIComponent(item.bookingReference || item.childDeliveryId || item.sourceDeliveryId)}`}>Open notifications</Link>{item.memberId ? <Link href={`/manager/members/${item.memberId}`}>Open member</Link> : null}<Link href={coverageHrefForScope(drawerSummary.scope)}>Open coverage</Link></div></td>
                      </tr>
                    ))}
                    {drawerSummary.results.length === 0 ? <tr><td colSpan={6} className={styles.muted}>No remediation action details are available yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              {drawerSummary.blockedItems.length > 0 ? <div className={styles.notice}>Blocked items: {drawerSummary.blockedItems.map((item) => `${item.id.slice(0, 8)} (${item.reason})`).join(" | ")}</div> : null}
            </aside>
          </>
        ) : null}
      </div>
    </main>
  );
}
