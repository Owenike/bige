"use client";

import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../i18n-provider";
import Link from "next/link";

type ApiErrorPayload = {
  error?: { code?: string; message?: string } | string;
  message?: string;
  code?: string;
};

type BillingSubscriptionSnapshot = {
  tenantId: string;
  tenantName: string;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  subscriptionEndsAt: string | null;
  subscriptionGraceEndsAt: string | null;
  subscriptionRemainingDays: number | null;
  subscriptionUsable: boolean;
  subscriptionAccessCode: string | null;
};

type UnreconciledItem = {
  auditId: string;
  tenantId: string;
  branchId: string | null;
  eventType: string;
  refId: string;
  amount: number | null;
  paymentMethod: string | null;
  actorId: string | null;
  actorName: string | null;
  reason: string | null;
  createdAt: string;
  unreconciledReason: string;
};

type ReconciliationShiftCandidate = {
  id: string;
  branchId: string | null;
  status: string;
  openedAt: string;
  closedAt: string | null;
};

type NotificationItem = {
  id: string;
  status: "unread" | "read" | "archived";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  eventType: string;
  actionUrl: string | null;
  createdAt: string;
};

type CrmFunnelSummary = {
  total: number;
  newCount: number;
  trialBooked: number;
  trialAttended: number;
  won: number;
  lost: number;
  staleFollowups: number;
  pendingNextActions: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byOwner: Record<string, number>;
};

function getApiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const data = payload as ApiErrorPayload;
  if (typeof data.error === "string" && data.error) return data.error;
  if (data.error && typeof data.error === "object" && typeof data.error.message === "string" && data.error.message) {
    return data.error.message;
  }
  if (typeof data.message === "string" && data.message) return data.message;
  return fallback;
}

function getApiCode(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as ApiErrorPayload;
  if (data.error && typeof data.error === "object" && typeof data.error.code === "string") return data.error.code;
  if (typeof data.code === "string") return data.code;
  return null;
}

export default function ManagerDashboardPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [orders, setOrders] = useState<Array<{ id: string; status: string; amount: number }>>([]);
  const [audit, setAudit] = useState<Array<{ id: string; action: string; reason: string | null }>>([]);
  const [approvals, setApprovals] = useState<
    Array<{
      id: string;
      action: string;
      target_type: string;
      target_id: string;
      reason: string;
      status: string;
      created_at: string;
    }>
  >([]);
  const [reportFrom, setReportFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<{
    range: { from: string; to: string };
    payments: {
      totalPaid: number;
      totalRefunded: number;
      paidCount: number;
      refundedCount: number;
      byMethod: { cash: number; card: number; transfer: number; newebpay: number; manual: number };
    };
    checkins: { allow: number; deny: number };
    bookings: { total: number; byStatus: Record<string, number> };
    handover: {
      openShiftCount: number;
      closedShiftCount: number;
      differenceShiftCount: number;
      unconfirmedCloseCount: number;
      closedTotals: {
        cash: number;
        card: number;
        transfer: number;
        expectedCash: number;
        countedCash: number;
        difference: number;
        cashAdjustmentNet?: number;
      };
    };
    operations: {
      invoiceCount: number;
      redemptionCount: number;
      voidCount: number;
      refundCount: number;
      entryCount: number;
      unreconciledCount?: number;
      unreconciledByEventType?: Record<string, number>;
    };
    opportunities?: {
      total: number;
      actionable: number;
      open: number;
      inProgress: number;
      highPriority: number;
      dueSoon: number;
      overdue: number;
      byType: Record<string, number>;
      byStatus: Record<string, number>;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [subscriptionSnapshot, setSubscriptionSnapshot] = useState<BillingSubscriptionSnapshot | null>(null);
  const [tenantBlocked, setTenantBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unreconciledItems, setUnreconciledItems] = useState<UnreconciledItem[]>([]);
  const [reconciliationShifts, setReconciliationShifts] = useState<ReconciliationShiftCandidate[]>([]);
  const [attachShiftByAuditId, setAttachShiftByAuditId] = useState<Record<string, string>>({});
  const [attachingAuditId, setAttachingAuditId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [crmSummary, setCrmSummary] = useState<CrmFunnelSummary | null>(null);

  const [voidOrderId, setVoidOrderId] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [passId, setPassId] = useState("");
  const [delta, setDelta] = useState("1");
  const [adjustReason, setAdjustReason] = useState("");

  function paymentMethodLabel(method: string) {
    if (!zh) return method;
    if (method === "cash") return "\u73fe\u91d1";
    if (method === "card") return "\u5237\u5361";
    if (method === "transfer") return "\u8f49\u5e33";
    if (method === "newebpay") return "\u85cd\u65b0";
    if (method === "manual") return "\u624b\u52d5";
    return method;
  }

  function orderStatusLabel(status: string) {
    if (!zh) return status;
    if (status === "pending") return "\u5f85\u8655\u7406";
    if (status === "paid") return "\u5df2\u4ed8\u6b3e";
    if (status === "cancelled") return "\u5df2\u53d6\u6d88";
    if (status === "voided") return "\u5df2\u4f5c\u5ee2";
    if (status === "refunded") return "\u5df2\u9000\u6b3e";
    return status;
  }

  function auditActionLabel(action: string) {
    if (!zh) return action;
    if (action === "order_voided") return "\u8a02\u55ae\u4f5c\u5ee2";
    if (action === "payment_refunded") return "\u4ed8\u6b3e\u9000\u6b3e";
    if (action === "pass_adjusted") return "\u7968\u5238\u8abf\u6574";
    if (action === "booking_updated") return "\u9810\u7d04\u66f4\u65b0";
    if (action === "member_updated") return "\u6703\u54e1\u8cc7\u6599\u66f4\u65b0";
    if (action === "branch_created") return "\u5206\u9928\u5efa\u7acb";
    return action;
  }

  function approvalActionLabel(action: string) {
    if (!zh) return action === "order_void" ? "Order Void" : action === "payment_refund" ? "Payment Refund" : action;
    if (action === "order_void") return "\u8a02\u55ae\u4f5c\u5ee2";
    if (action === "payment_refund") return "\u4ed8\u6b3e\u9000\u6b3e";
    return action;
  }

  async function markNotificationRead(notificationId: string) {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", notificationIds: [notificationId] }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setError(getApiError(payload, zh ? "?湔?憭望?" : "Failed to update notification"));
      return;
    }
    setNotifications((prev) => prev.map((item) => (item.id === notificationId ? { ...item, status: "read" } : item)));
    setUnreadNotificationCount((prev) => Math.max(0, prev - 1));
  }

  async function load() {
    setLoading(true);
    setError(null);
    setTenantBlocked(null);
    await fetch("/api/notifications/sweep", { method: "POST" }).catch(() => null);
    const [ordersRes, auditRes, reportRes, approvalsRes, billingRes, unreconciledRes, notificationsRes, crmSummaryRes] = await Promise.all([
      fetch("/api/orders"),
      fetch("/api/platform/audit?limit=30"),
      fetch(`/api/manager/reports/summary?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`),
      fetch("/api/approvals?status=pending&limit=30"),
      fetch("/api/platform/billing?days=30"),
      fetch(`/api/manager/reconciliation/unreconciled?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}&limit=100`),
      fetch("/api/notifications?status=all&limit=20"),
      fetch(`/api/manager/crm/summary?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`),
    ]);
    const ordersPayload = await ordersRes.json();
    const auditPayload = await auditRes.json();
    const reportPayload = await reportRes.json();
    const approvalsPayload = await approvalsRes.json();
    const billingPayload = await billingRes.json();
    const unreconciledPayload = await unreconciledRes.json();
    const notificationsPayload = await notificationsRes.json();
    const crmSummaryPayload = await crmSummaryRes.json();

    if (!ordersRes.ok) {
      const code = getApiCode(ordersPayload);
      if (code?.startsWith("SUBSCRIPTION_") || code === "TENANT_DISABLED" || code === "TENANT_SUSPENDED") {
        setTenantBlocked(code);
      }
      setError(getApiError(ordersPayload, zh ? "\u8f09\u5165\u8a02\u55ae\u5931\u6557" : "Load orders failed"));
    }
    if (!auditRes.ok) setError(getApiError(auditPayload, zh ? "\u8f09\u5165\u7a3d\u6838\u5931\u6557" : "Load audit failed"));
    if (!reportRes.ok) setError(getApiError(reportPayload, zh ? "\u8f09\u5165\u5831\u8868\u5931\u6557" : "Load report failed"));
    if (!approvalsRes.ok) setError(getApiError(approvalsPayload, zh ? "\u8f09\u5165\u5f85\u5be9\u5931\u6557" : "Load approvals failed"));
    if (!billingRes.ok) {
      const code = getApiCode(billingPayload);
      if (code?.startsWith("SUBSCRIPTION_") || code === "TENANT_DISABLED" || code === "TENANT_SUSPENDED") {
        setTenantBlocked(code);
      }
      setError(getApiError(billingPayload, zh ? "頛蝘閮憭望?" : "Load tenant subscription failed"));
    }

    if (!unreconciledRes.ok) setError(getApiError(unreconciledPayload, zh ? "載入未歸戶事件失敗" : "Load unreconciled events failed"));
    if (!notificationsRes.ok) setError(getApiError(notificationsPayload, zh ? "載入通知失敗" : "Load notifications failed"));
    if (!crmSummaryRes.ok) setError(getApiError(crmSummaryPayload, zh ? "載入 CRM 摘要失敗" : "Load CRM summary failed"));
    if (ordersRes.ok) setOrders(ordersPayload.items || []);
    if (auditRes.ok) setAudit(auditPayload.items || []);
    if (reportRes.ok) setReport(reportPayload);
    if (approvalsRes.ok) setApprovals(approvalsPayload.items || []);
    if (billingRes.ok) {
      const billingData = (billingPayload?.data || billingPayload) as { items?: BillingSubscriptionSnapshot[] };
      const item = (billingData?.items || [])[0] as BillingSubscriptionSnapshot | undefined;
      setSubscriptionSnapshot(item || null);
    }
    if (notificationsRes.ok) {
      const notificationData = (notificationsPayload?.data || notificationsPayload) as {
        items?: NotificationItem[];
        unreadCount?: number;
      };
      setNotifications(notificationData.items || []);
      setUnreadNotificationCount(notificationData.unreadCount || 0);
    }
    if (crmSummaryRes.ok) {
      const crmData = (crmSummaryPayload?.data || crmSummaryPayload) as { summary?: CrmFunnelSummary };
      setCrmSummary(crmData.summary || null);
    }
    if (unreconciledRes.ok) {
      const unreconciledData = (unreconciledPayload?.data || unreconciledPayload) as {
        items?: UnreconciledItem[];
        candidateShifts?: ReconciliationShiftCandidate[];
      };
      const items = unreconciledData.items || [];
      const shifts = unreconciledData.candidateShifts || [];
      setUnreconciledItems(items);
      setReconciliationShifts(shifts);
      setAttachShiftByAuditId((prev) => {
        const next = { ...prev };
        for (const item of items) {
          if (next[item.auditId]) continue;
          const candidate = shifts.find((shift) => !item.branchId || !shift.branchId || shift.branchId === item.branchId);
          if (candidate?.id) next[item.auditId] = candidate.id;
        }
        return next;
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function attachUnreconciledEvent(auditId: string) {
    const shiftId = attachShiftByAuditId[auditId];
    if (!shiftId) {
      setError(zh ? "隢??豢?閬????剖" : "Select a target shift first");
      return;
    }
    setAttachingAuditId(auditId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/manager/reconciliation/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId, shiftId }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(getApiError(payload, zh ? "鋆?憭望?" : "Attach failed"));
        return;
      }
      setMessage(zh ? "補掛成功" : "Attached successfully");
      await load();
    } finally {
      setAttachingAuditId(null);
    }
  }

  async function voidOrder(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await fetch(`/api/orders/${encodeURIComponent(voidOrderId)}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: voidReason }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(getApiError(payload, zh ? "\u4f5c\u5ee2\u5931\u6557" : "Void failed"));
      return;
    }
    setMessage(`${zh ? "\u8a02\u55ae\u5df2\u4f5c\u5ee2" : "Voided order"}: ${voidOrderId}`);
    await load();
  }

  async function refundPayment(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await fetch(`/api/payments/${encodeURIComponent(refundPaymentId)}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: refundReason }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(getApiError(payload, zh ? "\u9000\u6b3e\u5931\u6557" : "Refund failed"));
      return;
    }
    setMessage(`${zh ? "\u4ed8\u6b3e\u5df2\u9000\u6b3e" : "Refunded payment"}: ${refundPaymentId}`);
    await load();
  }

  async function adjustPass(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await fetch("/api/manager/pass-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passId, delta: Number(delta), reason: adjustReason }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(getApiError(payload, zh ? "\u8abf\u6574\u5931\u6557" : "Adjust failed"));
      return;
    }
    setMessage(`${zh ? "\u7968\u5238\u5df2\u8abf\u6574" : "Adjusted pass"}: ${payload.adjustment?.pass_id || passId}`);
    await load();
  }

  async function decideApproval(requestId: string, decision: "approve" | "reject") {
    setMessage(null);
    setError(null);
    const res = await fetch(`/api/approvals/${encodeURIComponent(requestId)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(getApiError(payload, zh ? "\u5be9\u6838\u5931\u6557" : "Approval action failed"));
      return;
    }
    setMessage(
      decision === "approve"
        ? zh
          ? "\u5df2\u6838\u51c6\u7533\u8acb"
          : "Approval request approved"
        : zh
          ? "\u5df2\u99c1\u56de\u7533\u8acb"
          : "Approval request rejected",
    );
    await load();
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u7ba1\u7406\u4e2d\u5fc3" : "MANAGER HUB"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u7ba1\u7406\u8005\u5100\u8868\u677f" : "Manager Dashboard"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u5728\u55ae\u4e00\u9762\u677f\u8ffd\u8e64\u71df\u904b KPI\u3001\u57f7\u884c\u4fee\u6b63\u64cd\u4f5c\u8207\u532f\u51fa\u5831\u8868\u3002"
                : "Track operation KPIs, run corrective actions, and export reports from one control panel."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}
        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">
            {zh ? `待辦提醒（未讀 ${unreadNotificationCount}）` : `Action Notifications (Unread ${unreadNotificationCount})`}
          </h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {notifications.map((item) => (
              <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  [{item.severity}] {item.title}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>{item.message}</p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {new Date(item.createdAt).toLocaleString()} | {item.eventType} | {item.status}
                </p>
                <div className="actions" style={{ marginTop: 8 }}>
                  {item.actionUrl ? (
                    <a className="fdPillBtn" href={item.actionUrl}>
                      {zh ? "前往處理" : "Open"}
                    </a>
                  ) : null}
                  {item.status === "unread" ? (
                    <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void markNotificationRead(item.id)}>
                      {zh ? "標記已讀" : "Mark Read"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {notifications.length === 0 ? <p className="fdGlassText">{zh ? "目前沒有通知。" : "No notifications."}</p> : null}
          </div>
        </section>
        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">{zh ? "租戶訂閱提醒" : "Tenant Subscription Notice"}</h2>
          {subscriptionSnapshot ? (
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "方案 / 狀態" : "Plan / Status"}: {subscriptionSnapshot.planName || subscriptionSnapshot.planCode || "-"} /{" "}
                {subscriptionSnapshot.subscriptionStatus || "-"}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "到期 / 寬限 / 剩餘天數" : "Ends / Grace Ends / Remaining"}:{" "}
                {subscriptionSnapshot.subscriptionEndsAt || "-"} / {subscriptionSnapshot.subscriptionGraceEndsAt || "-"} /{" "}
                {subscriptionSnapshot.subscriptionRemainingDays ?? "-"}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "可用狀態" : "Access"}:{" "}
                {subscriptionSnapshot.subscriptionUsable ? (zh ? "可用" : "Usable") : (zh ? "阻擋" : "Blocked")}{" "}
                {subscriptionSnapshot.subscriptionAccessCode ? `(${subscriptionSnapshot.subscriptionAccessCode})` : ""}
              </p>
              {subscriptionSnapshot.subscriptionStatus === "grace" ? (
                <p className="error" style={{ marginTop: 0 }}>
                  {zh ? "租戶已進入寬限期，請儘速續約。" : "Tenant is in grace period. Renew soon."}
                </p>
              ) : null}
              {subscriptionSnapshot.subscriptionRemainingDays !== null && subscriptionSnapshot.subscriptionRemainingDays <= 14 ? (
                <p className="sub" style={{ marginTop: 0, color: "var(--warn)" }}>
                  {zh
                    ? `租戶訂閱剩餘 ${subscriptionSnapshot.subscriptionRemainingDays} 天到期。`
                    : `Subscription expires in ${subscriptionSnapshot.subscriptionRemainingDays} days.`}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="fdGlassText" style={{ marginTop: 8 }}>
              {tenantBlocked
                ? zh
                  ? `租戶目前被阻擋 (${tenantBlocked})，請聯繫平台管理員續約或恢復。`
                  : `Tenant access is blocked (${tenantBlocked}). Contact platform admin for renewal or restore.`
                : zh
                  ? "目前無法載入租戶訂閱資料。"
                  : "Unable to load tenant subscription data."}
            </p>
          )}
        </section>
        {tenantBlocked ? (
          <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
            <p className="error" style={{ marginTop: 0 }}>
              {zh
                ? `租戶存取受限 (${tenantBlocked})，管理操作與交易 API 可能被阻擋，請聯繫平台管理員。`
                : `Tenant access is restricted (${tenantBlocked}). Management operations and transaction APIs are blocked. Contact platform admin.`}
            </p>
          </section>
        ) : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u7ba1\u7406\u529f\u80fd" : "Management Areas"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <a className="fdPillBtn" href="/manager/products">{zh ? "\u5546\u54c1" : "Products"}</a>
            <a className="fdPillBtn" href="/manager/branches">{zh ? "\u5206\u9928" : "Branches"}</a>
            <a className="fdPillBtn" href="/manager/services">{zh ? "\u670d\u52d9" : "Services"}</a>
            <a className="fdPillBtn" href="/manager/coach-slots">{zh ? "\u6559\u7df4\u6642\u6bb5" : "Coach Slots"}</a>
            <a className="fdPillBtn" href="/manager/staff">{zh ? "\u4eba\u54e1" : "Staff"}</a>
            <a className="fdPillBtn" href="/manager/plans">{zh ? "\u6703\u54e1\u65b9\u6848" : "Member Plans"}</a>
            <Link className="fdPillBtn" href="/manager/crm">{zh ? "CRM / 線索" : "CRM / Leads"}</Link>
            <Link className="fdPillBtn" href="/manager/opportunities">{zh ? "續約 / 回購機會" : "Renewal Opportunities"}</Link>
            <Link className="fdPillBtn" href="/manager/notifications-ops">{zh ? "通知運維" : "Notification Ops"}</Link>
            <Link className="fdPillBtn" href="/manager/members">{zh ? "\u6703\u54e1" : "Members"}</Link>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "CRM 漏斗摘要" : "CRM Funnel Summary"}</h2>
          {crmSummary ? (
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "新進線索 / 試上預約 / 到課" : "New / Trial Booked / Attended"}: {crmSummary.newCount} / {crmSummary.trialBooked} / {crmSummary.trialAttended}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "成交 / 失單" : "Won / Lost"}: {crmSummary.won} / {crmSummary.lost}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "未跟進 / 待辦" : "Stale Follow-up / Pending Next"}: {crmSummary.staleFollowups} / {crmSummary.pendingNextActions}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "來源分布" : "Source"}: {Object.entries(crmSummary.bySource || {}).map(([key, value]) => `${key}:${value}`).join(" | ") || "-"}
              </p>
              <div className="actions">
                <Link className="fdPillBtn fdPillBtnPrimary" href="/manager/crm">{zh ? "前往 CRM" : "Open CRM"}</Link>
              </div>
            </div>
          ) : (
            <p className="fdGlassText" style={{ marginTop: 8 }}>{zh ? "尚無 CRM 摘要資料。" : "CRM summary is not available yet."}</p>
          )}
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "續約 / 回購機會摘要" : "Renewal / Repurchase Opportunity Summary"}</h2>
          {report?.opportunities ? (
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "可行動 / 開啟 / 跟進中" : "Actionable / Open / In Progress"}:{" "}
                {report.opportunities.actionable} / {report.opportunities.open} / {report.opportunities.inProgress}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "高優先 / 近期到期 / 已逾期" : "High Priority / Due Soon / Overdue"}:{" "}
                {report.opportunities.highPriority} / {report.opportunities.dueSoon} / {report.opportunities.overdue}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "機會類型分布" : "By Type"}:{" "}
                {Object.entries(report.opportunities.byType || {}).map(([key, value]) => `${key}:${value}`).join(" | ") || "-"}
              </p>
              <div className="actions">
                <Link className="fdPillBtn fdPillBtnPrimary" href="/manager/opportunities">
                  {zh ? "前往機會清單" : "Open Opportunities"}
                </Link>
                <button
                  type="button"
                  className="fdPillBtn"
                  onClick={async () => {
                    const res = await fetch("/api/manager/opportunities/sweep", { method: "POST" });
                    const payload = await res.json().catch(() => null);
                    if (!res.ok) {
                      setError(getApiError(payload, zh ? "機會掃描失敗" : "Opportunity sweep failed"));
                      return;
                    }
                    setMessage(zh ? "機會掃描完成" : "Opportunity sweep completed");
                    await load();
                  }}
                >
                  {zh ? "重新掃描機會" : "Run Sweep"}
                </button>
              </div>
            </div>
          ) : (
            <p className="fdGlassText" style={{ marginTop: 8 }}>
              {zh ? "尚無機會摘要資料。" : "Opportunity summary is not available yet."}
            </p>
          )}
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u71df\u904b\u6458\u8981" : "Operations Summary"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="input" />
            <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="input" />
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load()} disabled={loading}>
              {loading ? (zh ? "\u66f4\u65b0\u4e2d..." : "Refreshing...") : zh ? "\u66f4\u65b0\u5831\u8868" : "Refresh Report"}
            </button>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            CSV:{" "}
            <a href={`/api/manager/reports/details?type=payments&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`} target="_blank" rel="noreferrer">{zh ? "\u4ed8\u6b3e" : "payments"}</a>
            {" | "}
            <a href={`/api/manager/reports/details?type=checkins&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`} target="_blank" rel="noreferrer">{zh ? "\u5165\u5834" : "checkins"}</a>
            {" | "}
            <a href={`/api/manager/reports/details?type=bookings&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`} target="_blank" rel="noreferrer">{zh ? "\u9810\u7d04" : "bookings"}</a>
          </p>
          {report ? (
            <div className="fdDataGrid" style={{ marginTop: 10 }}>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5340\u9593" : "range"}: {report.range.from} {zh ? "\u81f3" : "to"} {report.range.to}</p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5df2\u4ed8" : "paid"}: {report.payments.totalPaid} ({zh ? "\u7b46\u6578" : "count"}: {report.payments.paidCount})</p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5df2\u9000" : "refunded"}: {report.payments.totalRefunded} ({zh ? "\u7b46\u6578" : "count"}: {report.payments.refundedCount})</p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "\u65b9\u5f0f\u7d71\u8a08" : "by method"}: {paymentMethodLabel("cash")} {report.payments.byMethod.cash}, {paymentMethodLabel("card")} {report.payments.byMethod.card}, {paymentMethodLabel("transfer")} {report.payments.byMethod.transfer}, {paymentMethodLabel("newebpay")} {report.payments.byMethod.newebpay}, {paymentMethodLabel("manual")} {report.payments.byMethod.manual}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5165\u5834" : "check-ins"}: {zh ? "\u901a\u904e" : "allow"} {report.checkins.allow}, {zh ? "\u62d2\u7d55" : "deny"} {report.checkins.deny}</p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u9810\u7d04\u7e3d\u6578" : "bookings total"}: {report.bookings.total}</p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u958b\u73ed\u4e2d\u6b21\u6578" : "open shifts"}: {report.handover.openShiftCount}</p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5df2\u7d50\u73ed\u6b21" : "closed shifts"}: {report.handover.closedShiftCount}</p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "\u73ed\u6b21\u7d50\u7b97" : "shift totals"}: {zh ? "\u73fe\u91d1" : "cash"} {report.handover.closedTotals.cash}, {zh ? "\u5237\u5361" : "card"} {report.handover.closedTotals.card}, {zh ? "\u8f49\u5e33" : "transfer"} {report.handover.closedTotals.transfer}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "\u73ed\u5225\u5c0d\u5e33" : "shift reconciliation"}: {zh ? "\u9810\u671f\u73fe\u91d1" : "expected cash"} {report.handover.closedTotals.expectedCash}, {zh ? "\u5be6\u9ede\u73fe\u91d1" : "counted cash"} {report.handover.closedTotals.countedCash}, {zh ? "\u5dee\u7570" : "difference"} {report.handover.closedTotals.difference}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "現金異動淨額" : "cash adjustment net"}: {report.handover.closedTotals.cashAdjustmentNet || 0}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "\u5f02\u5e38\u73ed\u5225" : "difference shifts"}: {report.handover.differenceShiftCount}, {zh ? "\u672a\u78ba\u8a8d\u7d50\u73ed" : "unconfirmed close"}: {report.handover.unconfirmedCloseCount}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "\u7576\u65e5\u71df\u904b" : "today operations"}: {zh ? "\u767c\u7968" : "invoices"} {report.operations.invoiceCount}, {zh ? "\u6838\u92b7" : "redemptions"} {report.operations.redemptionCount}, {zh ? "\u4f5c\u5ee2" : "voids"} {report.operations.voidCount}, {zh ? "\u9000\u6b3e" : "refunds"} {report.operations.refundCount}, {zh ? "\u5165\u5834" : "entries"} {report.operations.entryCount}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "未歸戶事件" : "unreconciled events"}: {report.operations.unreconciledCount || 0}
              </p>
            </div>
          ) : null}
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "未歸戶事件與班別補掛" : "Unreconciled Events & Shift Attach"}</h2>
          <div className="fdDataGrid">
            {unreconciledItems.map((item) => {
              const availableShifts = reconciliationShifts.filter((shift) => !item.branchId || !shift.branchId || shift.branchId === item.branchId);
              return (
                <div key={item.auditId} className="fdGlassSubPanel" style={{ padding: 10 }}>
                  <p className="sub" style={{ marginTop: 0 }}>
                    {item.eventType} | {item.refId} | {item.amount ?? 0} | {item.createdAt}
                  </p>
                  <p className="sub" style={{ marginTop: 0 }}>
                    {zh ? "分館" : "branch"}: {item.branchId || "-"} | {zh ? "執行者" : "actor"}: {item.actorName || item.actorId || "-"}
                  </p>
                  <div className="actions" style={{ marginTop: 8 }}>
                    <select
                      className="input"
                      value={attachShiftByAuditId[item.auditId] || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAttachShiftByAuditId((prev) => ({ ...prev, [item.auditId]: value }));
                      }}
                    >
                      <option value="">{zh ? "選擇班別" : "Select shift"}</option>
                      {availableShifts.map((shift) => (
                        <option key={shift.id} value={shift.id}>
                          {shift.id.slice(0, 8)} | {shift.status} | {shift.openedAt}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="fdPillBtn fdPillBtnPrimary"
                      disabled={attachingAuditId === item.auditId || !attachShiftByAuditId[item.auditId]}
                      onClick={() => void attachUnreconciledEvent(item.auditId)}
                    >
                      {attachingAuditId === item.auditId ? (zh ? "補掛中..." : "Attaching...") : (zh ? "補掛到班別" : "Attach to Shift")}
                    </button>
                  </div>
                </div>
              );
            })}
            {unreconciledItems.length === 0 ? (
              <p className="fdGlassText">{zh ? "目前沒有未歸戶事件。" : "No unreconciled events."}</p>
            ) : null}
          </div>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <form onSubmit={voidOrder} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u4f5c\u5ee2\u8a02\u55ae" : "Void Order"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={voidOrderId} onChange={(e) => setVoidOrderId(e.target.value)} placeholder={zh ? "\u8a02\u55ae ID" : "orderId"} className="input" required />
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder={zh ? "\u539f\u56e0" : "reason"} className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>{zh ? "\u4f5c\u5ee2\u8a02\u55ae" : "Void Order"}</button>
          </form>

          <form onSubmit={refundPayment} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u4ed8\u6b3e\u9000\u6b3e" : "Refund Payment"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={refundPaymentId} onChange={(e) => setRefundPaymentId(e.target.value)} placeholder={zh ? "\u4ed8\u6b3e ID" : "paymentId"} className="input" required />
              <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder={zh ? "\u539f\u56e0" : "reason"} className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>{zh ? "\u9000\u6b3e" : "Refund Payment"}</button>
          </form>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <form onSubmit={adjustPass} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u7968\u5238\u8abf\u6574" : "Pass Adjustment"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={passId} onChange={(e) => setPassId(e.target.value)} placeholder={zh ? "\u7968\u5238 ID" : "passId"} className="input" required />
              <input value={delta} onChange={(e) => setDelta(e.target.value)} placeholder={zh ? "\u8abf\u6574\u503c (+/-)" : "delta (+/-)"} className="input" required />
              <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder={zh ? "\u539f\u56e0" : "reason"} className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>{zh ? "\u8abf\u6574" : "Adjust Pass"}</button>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u6700\u65b0\u8a02\u55ae" : "Recent Orders"}</h2>
            <div className="fdDataGrid">
              {orders.map((item) => (
                <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                  {item.id} | {orderStatusLabel(item.status)} | {item.amount}
                </p>
              ))}
              {orders.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u8a02\u55ae\u3002" : "No orders found."}</p> : null}
            </div>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u9ad8\u98a8\u96aa\u5f85\u5be9" : "Pending High-Risk Approvals"}</h2>
          <div className="fdDataGrid">
            {approvals.map((item) => (
              <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  {approvalActionLabel(item.action)} | {item.target_type}:{item.target_id}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u539f\u56e0" : "Reason"}: {item.reason}</p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void decideApproval(item.id, "approve")}>
                    {zh ? "\u6838\u51c6" : "Approve"}
                  </button>
                  <button type="button" className="fdPillBtn" onClick={() => void decideApproval(item.id, "reject")}>
                    {zh ? "\u99c1\u56de" : "Reject"}
                  </button>
                </div>
              </div>
            ))}
            {approvals.length === 0 ? <p className="fdGlassText">{zh ? "\u76ee\u524d\u7121\u5f85\u5be9\u7533\u8acb\u3002" : "No pending approval requests."}</p> : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u7a3d\u6838\u65e5\u8a8c" : "Audit Logs"}</h2>
          <div className="fdDataGrid">
            {audit.map((item) => (
              <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                {auditActionLabel(item.action)} | {item.reason || "-"}
              </p>
            ))}
            {audit.length === 0 ? <p className="fdGlassText">{zh ? "\u7121\u7a3d\u6838\u8a18\u9304\u3002" : "No audit logs found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}


