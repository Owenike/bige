"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "../../i18n-provider";

type TenantStatus = "active" | "suspended" | "disabled" | null;

type TenantOpsOverviewItem = {
  tenantId: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  subscription: {
    planCode: string | null;
    planName: string | null;
    status: string | null;
    startsAt: string | null;
    endsAt: string | null;
    graceEndsAt: string | null;
    isUsable: boolean;
    blockedCode: string | null;
    warningCode: "SUBSCRIPTION_GRACE" | "SUBSCRIPTION_EXPIRING_SOON" | null;
    remainingDays: number | null;
  };
  notificationOps: {
    failedDeliveries: number;
    retryingDeliveries: number;
    lastJobStatus: string | null;
    lastJobAt: string | null;
    lastNotificationSweepStatus: string | null;
    lastOpportunitySweepStatus: string | null;
    lastDispatchStatus: string | null;
  };
  anomalies: {
    unreconciledEvents: number;
    openShifts: number;
    openShiftsTooLong: number;
    shiftsWithDifference: number;
    pendingApprovals: number;
  };
  opportunities: {
    open: number;
    overdue: number;
    highPriority: number;
    trialNotConverted: number;
    expiredNoRenewal: number;
  };
  crm: {
    staleLeads: number;
    trialNotConvertedLeads: number;
  };
  memberRisk: {
    expiringMembers7d: number;
    lowBalanceContracts: number;
    expiredNoRenewal: number;
  };
  supportScore: number;
  supportFlags: string[];
};

type TenantOpsOverview = {
  generatedAt: string;
  rangeDays: number;
  totals: {
    tenants: number;
    blockedTenants: number;
    tenantsWithAnomalies: number;
    tenantsNeedingSupport: number;
    failedDeliveries: number;
    unreconciledEvents: number;
    overdueOpportunities: number;
  };
  items: TenantOpsOverviewItem[];
  warnings: string[];
};

type TenantOpsDetail = {
  generatedAt: string;
  tenant: TenantOpsOverviewItem;
  recent: {
    failedDeliveries: Array<{
      createdAt: string;
      channel: string | null;
      status: string | null;
      sourceRefType: string | null;
      sourceRefId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }>;
    jobRuns: Array<{
      createdAt: string;
      jobType: string;
      triggerMode: string;
      status: string;
      errorCount: number;
      errorSummary: string | null;
    }>;
    pendingApprovals: Array<{
      action: string | null;
      createdAt: string;
    }>;
    overdueOpportunities: Array<{
      id: string;
      type: string;
      priority: string;
      dueAt: string | null;
      ownerStaffId: string | null;
      reason: string;
    }>;
    expiringContracts: Array<{
      contractId: string;
      memberId: string;
      endsAt: string | null;
      remainingUses: number | null;
      remainingSessions: number | null;
    }>;
  };
  supportLinks: {
    subscription: string;
    notificationsOps: string;
    observability: string;
    audit: string;
    opportunities: string;
    crm: string;
    managerSummary: string;
    handover: string;
  };
  warnings: string[];
};

type ApiEnvelope<TData> = {
  ok?: boolean;
  data?: TData;
  error?: { code?: string; message?: string } | string;
  message?: string;
};

function toErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const data = payload as ApiEnvelope<unknown>;
  if (typeof data.error === "string" && data.error) return data.error;
  if (data.error && typeof data.error === "object" && typeof data.error.message === "string") return data.error.message;
  if (typeof data.message === "string" && data.message) return data.message;
  return fallback;
}

function dateTime(input: string | null, locale: string) {
  if (!input) return "-";
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) return "-";
  return value.toLocaleString(locale);
}

function dateOnly(input: string | null, locale: string) {
  if (!input) return "-";
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) return "-";
  return value.toLocaleDateString(locale);
}

export default function PlatformTenantOpsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [days, setDays] = useState("14");
  const [search, setSearch] = useState("");
  const [tenantStatusFilter, setTenantStatusFilter] = useState("all");
  const [focusFilter, setFocusFilter] = useState("all");

  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [overview, setOverview] = useState<TenantOpsOverview | null>(null);
  const [detail, setDetail] = useState<TenantOpsDetail | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");

  const filteredItems = useMemo(() => {
    const items = overview?.items || [];
    return items.filter((item) => {
      if (tenantStatusFilter !== "all" && item.tenantStatus !== tenantStatusFilter) return false;
      if (focusFilter === "blocked" && item.subscription.isUsable) return false;
      if (focusFilter === "failed_delivery" && item.notificationOps.failedDeliveries <= 0) return false;
      if (focusFilter === "unreconciled" && item.anomalies.unreconciledEvents <= 0) return false;
      if (focusFilter === "shift_open_too_long" && item.anomalies.openShiftsTooLong <= 0) return false;
      if (focusFilter === "approval_pending" && item.anomalies.pendingApprovals <= 0) return false;
      if (focusFilter === "opportunity_overdue" && item.opportunities.overdue <= 0) return false;
      if (focusFilter === "member_risk" && item.memberRisk.expiringMembers7d + item.memberRisk.lowBalanceContracts <= 0) return false;
      if (!search.trim()) return true;
      const keyword = search.trim().toLowerCase();
      return (
        item.tenantName.toLowerCase().includes(keyword) ||
        item.tenantId.toLowerCase().includes(keyword) ||
        (item.subscription.planCode || "").toLowerCase().includes(keyword) ||
        (item.subscription.planName || "").toLowerCase().includes(keyword)
      );
    });
  }, [focusFilter, overview?.items, search, tenantStatusFilter]);

  async function loadOverview() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("days", String(Math.min(90, Math.max(1, Number(days || 14)))));
    const res = await fetch(`/api/platform/tenant-ops?${params.toString()}`);
    const payload = (await res.json().catch(() => null)) as ApiEnvelope<TenantOpsOverview> | null;
    if (!res.ok) {
      setError(toErrorMessage(payload, zh ? "載入租戶營運總覽失敗" : "Failed to load tenant operations overview"));
      setLoading(false);
      return;
    }
    const data = (payload?.data || payload) as TenantOpsOverview;
    setOverview(data);
    if (!selectedTenantId && data.items.length > 0) {
      setSelectedTenantId(data.items[0].tenantId);
    }
    setLoading(false);
  }

  async function loadDetail(tenantId: string) {
    if (!tenantId) return;
    setLoadingDetail(true);
    setDetailError(null);
    const params = new URLSearchParams();
    params.set("tenantId", tenantId);
    params.set("days", String(Math.min(90, Math.max(1, Number(days || 14)))));
    const res = await fetch(`/api/platform/tenant-ops?${params.toString()}`);
    const payload = (await res.json().catch(() => null)) as ApiEnvelope<TenantOpsDetail> | null;
    if (!res.ok) {
      setDetailError(toErrorMessage(payload, zh ? "載入租戶支援細節失敗" : "Failed to load tenant support detail"));
      setLoadingDetail(false);
      return;
    }
    const data = (payload?.data || payload) as TenantOpsDetail;
    setDetail(data);
    setLoadingDetail(false);
  }

  useEffect(() => {
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTenantId) return;
    void loadDetail(selectedTenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "平台 / 租戶營運支援" : "PLATFORM / TENANT OPS SUPPORT"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 34 }}>
              {zh ? "租戶級營運支援總覽" : "Tenant Operations Support Overview"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "聚合各租戶通知、排程、交接班、未歸戶、待審、CRM 與續約風險，快速定位需要平台支援的租戶。"
                : "Aggregate notification, jobs, handover, unreconciled, approvals, CRM, and renewal risks by tenant for fast support triage."}
            </p>
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="fdPillBtn" href="/platform-admin">
                {zh ? "返回平台首頁" : "Back to Platform Admin"}
              </Link>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void loadOverview()} disabled={loading}>
                {loading ? (zh ? "載入中..." : "Loading...") : zh ? "重新整理總覽" : "Refresh Overview"}
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">{zh ? "篩選" : "Filters"}</h2>
          <div className="fdThreeCol" style={{ gap: 10, marginTop: 8 }}>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={zh ? "搜尋租戶名稱 / tenant id / 方案" : "Search tenant name / tenant id / plan"}
            />
            <select className="input" value={tenantStatusFilter} onChange={(event) => setTenantStatusFilter(event.target.value)}>
              <option value="all">{zh ? "全部租戶狀態" : "All tenant status"}</option>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="disabled">disabled</option>
            </select>
            <select className="input" value={focusFilter} onChange={(event) => setFocusFilter(event.target.value)}>
              <option value="all">{zh ? "全部支援視角" : "All support focus"}</option>
              <option value="blocked">{zh ? "訂閱不可用" : "Subscription blocked"}</option>
              <option value="failed_delivery">{zh ? "通知失敗高" : "High failed deliveries"}</option>
              <option value="unreconciled">{zh ? "未歸戶事件" : "Unreconciled events"}</option>
              <option value="shift_open_too_long">{zh ? "未結班過久" : "Open shift too long"}</option>
              <option value="approval_pending">{zh ? "高風險待審" : "Pending high-risk approvals"}</option>
              <option value="opportunity_overdue">{zh ? "商機逾期" : "Overdue opportunities"}</option>
              <option value="member_risk">{zh ? "會員風險" : "Member risk pressure"}</option>
            </select>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <input className="input" value={days} onChange={(event) => setDays(event.target.value)} placeholder={zh ? "統計天數" : "range days"} />
            <button type="button" className="fdPillBtn" onClick={() => void loadOverview()} disabled={loading}>
              {zh ? "套用天數" : "Apply Days"}
            </button>
          </div>
        </section>

        <section className="fdInventorySummary" style={{ marginBottom: 14 }}>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "租戶總數" : "Tenants"}</div>
            <strong className="fdInventorySummaryValue">{overview?.totals.tenants ?? "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "需支援租戶" : "Needs Support"}</div>
            <strong className="fdInventorySummaryValue">{overview?.totals.tenantsNeedingSupport ?? "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "訂閱不可用" : "Blocked"}</div>
            <strong className="fdInventorySummaryValue">{overview?.totals.blockedTenants ?? "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "通知失敗總數" : "Failed Deliveries"}</div>
            <strong className="fdInventorySummaryValue">{overview?.totals.failedDeliveries ?? "-"}</strong>
          </div>
        </section>

        {overview?.warnings?.length ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <h2 className="sectionTitle">{zh ? "資料來源警告" : "Data Source Warnings"}</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {overview.warnings.map((warning) => (
                <p className="sub" key={warning} style={{ marginTop: 0 }}>
                  {warning}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">{zh ? "租戶營運摘要列表" : "Tenant Operations List"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {filteredItems.map((item) => (
              <div key={item.tenantId} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <div className="actions" style={{ justifyContent: "space-between" }}>
                  <p className="sub" style={{ marginTop: 0 }}>
                    <strong>{item.tenantName}</strong> ({item.tenantStatus || "-"})
                  </p>
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() => {
                      setSelectedTenantId(item.tenantId);
                      void loadDetail(item.tenantId);
                    }}
                  >
                    {zh ? "查看支援細節" : "View Support Detail"}
                  </button>
                </div>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "方案 / 訂閱狀態" : "Plan / Subscription"}: {item.subscription.planName || item.subscription.planCode || "-"} /{" "}
                  {item.subscription.status || "none"} | {zh ? "可用" : "usable"}: {item.subscription.isUsable ? "yes" : "no"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "通知失敗 / retrying / 最後 job" : "Failed / Retrying / Last Job"}: {item.notificationOps.failedDeliveries} /{" "}
                  {item.notificationOps.retryingDeliveries} / {item.notificationOps.lastJobStatus || "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "未歸戶 / 未結班過久 / 班別差異 / 待審" : "Unreconciled / Open too long / Shift diff / Pending approvals"}:{" "}
                  {item.anomalies.unreconciledEvents} / {item.anomalies.openShiftsTooLong} / {item.anomalies.shiftsWithDifference} /{" "}
                  {item.anomalies.pendingApprovals}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "商機 Open / Overdue / 高優先" : "Opportunity Open / Overdue / High Priority"}: {item.opportunities.open} /{" "}
                  {item.opportunities.overdue} / {item.opportunities.highPriority}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "會員到期7天 / 低餘額 / expired_no_renewal" : "Expiring 7d / Low balance / expired_no_renewal"}:{" "}
                  {item.memberRisk.expiringMembers7d} / {item.memberRisk.lowBalanceContracts} / {item.memberRisk.expiredNoRenewal}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "支援分數 / 標記" : "Support score / flags"}: {item.supportScore} |{" "}
                  {(item.supportFlags || []).join(", ") || "-"}
                </p>
              </div>
            ))}
            {!loading && filteredItems.length === 0 ? (
              <p className="fdGlassText">{zh ? "沒有符合條件的租戶。" : "No tenants matched the current filters."}</p>
            ) : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "租戶支援細節" : "Tenant Support Detail"}</h2>
          {detailError ? <div className="error" style={{ marginTop: 8 }}>{detailError}</div> : null}
          {loadingDetail ? <p className="fdGlassText">{zh ? "載入中..." : "Loading..."}</p> : null}
          {!loadingDetail && detail ? (
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                <strong>{detail.tenant.tenantName}</strong> ({detail.tenant.tenantId})
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "訂閱" : "Subscription"}: {detail.tenant.subscription.status || "none"} | {zh ? "到期" : "ends"}:{" "}
                {dateOnly(detail.tenant.subscription.endsAt, locale)} | {zh ? "寬限" : "grace"}:{" "}
                {dateOnly(detail.tenant.subscription.graceEndsAt, locale)}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "通知運維" : "Notification Ops"}: failed {detail.tenant.notificationOps.failedDeliveries}, retrying{" "}
                {detail.tenant.notificationOps.retryingDeliveries}, {zh ? "最後 job" : "last job"}{" "}
                {detail.tenant.notificationOps.lastJobStatus || "-"} ({dateTime(detail.tenant.notificationOps.lastJobAt, locale)})
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "交接班 / 對帳異常" : "Shift / Reconciliation"}: open {detail.tenant.anomalies.openShifts}, open-too-long{" "}
                {detail.tenant.anomalies.openShiftsTooLong}, difference {detail.tenant.anomalies.shiftsWithDifference}, unreconciled{" "}
                {detail.tenant.anomalies.unreconciledEvents}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "待審 / 商機 / CRM" : "Approvals / Opportunities / CRM"}: {detail.tenant.anomalies.pendingApprovals} / overdue{" "}
                {detail.tenant.opportunities.overdue} / stale leads {detail.tenant.crm.staleLeads}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "會員風險" : "Member risk"}: expiring7d {detail.tenant.memberRisk.expiringMembers7d}, low balance{" "}
                {detail.tenant.memberRisk.lowBalanceContracts}, expired_no_renewal {detail.tenant.memberRisk.expiredNoRenewal}
              </p>

              <div className="actions" style={{ marginTop: 8 }}>
                <Link className="fdPillBtn" href={detail.supportLinks.subscription}>{zh ? "訂閱管理" : "Subscription"}</Link>
                <Link className="fdPillBtn" href={detail.supportLinks.notificationsOps}>{zh ? "通知運維" : "Notifications Ops"}</Link>
                <Link className="fdPillBtn" href={detail.supportLinks.observability}>{zh ? "Observability" : "Observability"}</Link>
                <Link className="fdPillBtn" href={detail.supportLinks.audit}>{zh ? "稽核" : "Audit"}</Link>
                <Link className="fdPillBtn" href={detail.supportLinks.opportunities}>{zh ? "商機" : "Opportunities"}</Link>
                <Link className="fdPillBtn" href={detail.supportLinks.crm}>{zh ? "CRM" : "CRM"}</Link>
                <Link className="fdPillBtn" href={detail.supportLinks.managerSummary}>{zh ? "租戶總覽" : "Tenant Dashboard"}</Link>
                <Link className="fdPillBtn" href={detail.supportLinks.handover}>{zh ? "交接班" : "Handover"}</Link>
              </div>

              <section className="fdGlassSubPanel" style={{ padding: 10 }}>
                <h3 className="sectionTitle">{zh ? "最近 Failed/Retrying Delivery" : "Recent Failed/Retrying Deliveries"}</h3>
                {(detail.recent.failedDeliveries || []).slice(0, 10).map((row, idx) => (
                  <p className="sub" key={`${row.createdAt}-${idx}`} style={{ marginTop: 0 }}>
                    {dateTime(row.createdAt, locale)} | {row.channel || "-"} | {row.status || "-"} | {row.errorCode || "-"} |{" "}
                    {row.sourceRefType || "-"}:{row.sourceRefId || "-"}
                  </p>
                ))}
                {detail.recent.failedDeliveries.length === 0 ? <p className="fdGlassText">{zh ? "無" : "None"}</p> : null}
              </section>

              <section className="fdGlassSubPanel" style={{ padding: 10 }}>
                <h3 className="sectionTitle">{zh ? "最近 Job Runs" : "Recent Job Runs"}</h3>
                {(detail.recent.jobRuns || []).slice(0, 10).map((row, idx) => (
                  <p className="sub" key={`${row.createdAt}-${idx}`} style={{ marginTop: 0 }}>
                    {dateTime(row.createdAt, locale)} | {row.jobType} | {row.triggerMode} | {row.status} | err:{row.errorCount}
                  </p>
                ))}
                {detail.recent.jobRuns.length === 0 ? <p className="fdGlassText">{zh ? "無" : "None"}</p> : null}
              </section>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

