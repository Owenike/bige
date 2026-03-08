import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { listUnreconciledShiftEvents } from "../../../../../lib/shift-reconciliation";
import { summarizeOpportunities, type OpportunityRow } from "../../../../../lib/opportunities";

function isMissingTableError(message: string | undefined, table: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = table.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target))
  );
}

function toIsoRange(from: string | null, to: string | null) {
  const dateFrom = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : new Date().toISOString().slice(0, 10);
  const dateTo = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : dateFrom;
  return {
    from: `${dateFrom}T00:00:00.000Z`,
    to: `${dateTo}T23:59:59.999Z`,
    dateFrom,
    dateTo,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const range = toIsoRange(params.get("from"), params.get("to"));

  const [paymentsResult, checkinsResult, bookingsResult, shiftsResult, redemptionsResult, invoicesResult, orderRiskResult, adjustmentItemsResult, opportunitiesResult] = await Promise.all([
    auth.supabase
      .from("payments")
      .select("status, method, amount")
      .eq("tenant_id", auth.context.tenantId)
      .gte("created_at", range.from)
      .lte("created_at", range.to),
    auth.supabase
      .from("checkins")
      .select("result")
      .eq("tenant_id", auth.context.tenantId)
      .gte("checked_at", range.from)
      .lte("checked_at", range.to),
    auth.supabase
      .from("bookings")
      .select("status")
      .eq("tenant_id", auth.context.tenantId)
      .gte("starts_at", range.from)
      .lte("starts_at", range.to),
    auth.supabase
      .from("frontdesk_shifts")
      .select("status, cash_total, card_total, transfer_total, expected_cash, counted_cash, difference, closing_confirmed")
      .eq("tenant_id", auth.context.tenantId)
      .gte("opened_at", range.from)
      .lte("opened_at", range.to),
    auth.supabase
      .from("session_redemptions")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .gte("created_at", range.from)
      .lte("created_at", range.to),
    auth.supabase
      .from("audit_logs")
      .select("action")
      .eq("tenant_id", auth.context.tenantId)
      .eq("target_type", "order")
      .in("action", ["invoice_issue", "invoice_void", "invoice_allowance"])
      .gte("created_at", range.from)
      .lte("created_at", range.to),
    auth.supabase
      .from("audit_logs")
      .select("action")
      .eq("tenant_id", auth.context.tenantId)
      .in("action", ["order_void", "payment_refund"])
      .gte("created_at", range.from)
      .lte("created_at", range.to),
    auth.supabase
      .from("frontdesk_shift_items")
      .select("amount")
      .eq("tenant_id", auth.context.tenantId)
      .eq("event_type", "cash_adjustment")
      .gte("created_at", range.from)
      .lte("created_at", range.to),
    auth.supabase
      .from("crm_opportunities")
      .select("id, tenant_id, branch_id, type, status, member_id, lead_id, source_ref_type, source_ref_id, owner_staff_id, priority, reason, note, due_at, next_action_at, snoozed_until, won_at, lost_at, last_activity_at, dedupe_key, created_by, updated_by, created_at, updated_at")
      .eq("tenant_id", auth.context.tenantId)
      .limit(3000),
  ]);

  if (paymentsResult.error) return apiError(500, "INTERNAL_ERROR", paymentsResult.error.message);
  if (checkinsResult.error) return apiError(500, "INTERNAL_ERROR", checkinsResult.error.message);
  if (bookingsResult.error) return apiError(500, "INTERNAL_ERROR", bookingsResult.error.message);
  if (shiftsResult.error) return apiError(500, "INTERNAL_ERROR", shiftsResult.error.message);
  if (redemptionsResult.error) return apiError(500, "INTERNAL_ERROR", redemptionsResult.error.message);
  if (invoicesResult.error) return apiError(500, "INTERNAL_ERROR", invoicesResult.error.message);
  if (orderRiskResult.error) return apiError(500, "INTERNAL_ERROR", orderRiskResult.error.message);
  if (adjustmentItemsResult.error) return apiError(500, "INTERNAL_ERROR", adjustmentItemsResult.error.message);
  if (opportunitiesResult.error && !isMissingTableError(opportunitiesResult.error.message, "crm_opportunities")) {
    return apiError(500, "INTERNAL_ERROR", opportunitiesResult.error.message);
  }

  const payments = (paymentsResult.data || []) as Array<{ status: string; method: string; amount: number | string | null }>;
  const checkins = (checkinsResult.data || []) as Array<{ result: string }>;
  const bookings = (bookingsResult.data || []) as Array<{ status: string }>;
  const shifts = (shiftsResult.data || []) as Array<{
    status: string;
    cash_total: number | string | null;
    card_total: number | string | null;
    transfer_total: number | string | null;
    expected_cash: number | string | null;
    counted_cash: number | string | null;
    difference: number | string | null;
    closing_confirmed: boolean | null;
  }>;
  const redemptions = (redemptionsResult.data || []) as Array<{ id: string }>;
  const invoiceAudits = (invoicesResult.data || []) as Array<{ action: string }>;
  const riskAudits = (orderRiskResult.data || []) as Array<{ action: string }>;
  const adjustments = (adjustmentItemsResult.data || []) as Array<{ amount: number | string | null }>;
  const opportunities = ((opportunitiesResult.data || []) as OpportunityRow[]) || [];

  const totalPaid = payments
    .filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const totalRefunded = payments
    .filter((item) => item.status === "refunded")
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const paidByMethod = {
    cash: payments
      .filter((item) => item.status === "paid" && item.method === "cash")
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
    card: payments
      .filter((item) => item.status === "paid" && item.method === "card")
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
    transfer: payments
      .filter((item) => item.status === "paid" && item.method === "transfer")
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
    newebpay: payments
      .filter((item) => item.status === "paid" && item.method === "newebpay")
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
    manual: payments
      .filter((item) => item.status === "paid" && item.method === "manual")
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
  };

  const checkinAllow = checkins.filter((item) => item.result === "allow").length;
  const checkinDeny = checkins.filter((item) => item.result === "deny").length;
  const bookingByStatus: Record<string, number> = {};
  for (const item of bookings) {
    const key = item.status || "unknown";
    bookingByStatus[key] = (bookingByStatus[key] || 0) + 1;
  }

  const shiftTotals = shifts.reduce(
    (acc, item) => {
      if (item.status === "closed") {
        acc.cash += Number(item.cash_total ?? 0);
        acc.card += Number(item.card_total ?? 0);
        acc.transfer += Number(item.transfer_total ?? 0);
        acc.expectedCash += Number(item.expected_cash ?? 0);
        acc.countedCash += Number(item.counted_cash ?? item.cash_total ?? 0);
        acc.difference += Number(item.difference ?? 0);
      }
      return acc;
    },
    { cash: 0, card: 0, transfer: 0, expectedCash: 0, countedCash: 0, difference: 0 },
  );

  const openShiftCount = shifts.filter((item) => item.status === "open").length;
  const closedShiftCount = shifts.filter((item) => item.status === "closed").length;
  const differenceShiftCount = shifts.filter((item) => item.status === "closed" && Math.abs(Number(item.difference ?? 0)) >= 0.01).length;
  const unconfirmedCloseCount = shifts.filter((item) => item.status === "closed" && item.closing_confirmed === false).length;
  const invoiceCount = invoiceAudits.length;
  const voidCount = riskAudits.filter((item) => item.action === "order_void").length;
  const refundCount = riskAudits.filter((item) => item.action === "payment_refund").length;
  const cashAdjustmentNet = adjustments.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const unreconciled = await listUnreconciledShiftEvents({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId!,
    from: range.from,
    to: range.to,
    limit: 200,
  });
  if (!unreconciled.ok) return apiError(500, "INTERNAL_ERROR", unreconciled.error);
  const unreconciledByEventType = unreconciled.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.eventType] = (acc[item.eventType] || 0) + 1;
    return acc;
  }, {});
  const opportunitySummary = summarizeOpportunities(opportunities, new Date());
  const actionableOpportunities = opportunitySummary.open + opportunitySummary.inProgress + opportunitySummary.snoozed;

  return apiSuccess({
    range: { from: range.dateFrom, to: range.dateTo },
    payments: {
      totalPaid,
      totalRefunded,
      paidCount: payments.filter((item) => item.status === "paid").length,
      refundedCount: payments.filter((item) => item.status === "refunded").length,
      byMethod: paidByMethod,
    },
    checkins: {
      allow: checkinAllow,
      deny: checkinDeny,
    },
    bookings: {
      total: bookings.length,
      byStatus: bookingByStatus,
    },
    handover: {
      openShiftCount,
      closedShiftCount,
      differenceShiftCount,
      unconfirmedCloseCount,
      closedTotals: {
        ...shiftTotals,
        cashAdjustmentNet,
      },
    },
    operations: {
      invoiceCount,
      redemptionCount: redemptions.length,
      voidCount,
      refundCount,
      entryCount: checkinAllow,
      unreconciledCount: unreconciled.items.length,
      unreconciledByEventType,
    },
    opportunities: {
      total: opportunitySummary.total,
      actionable: actionableOpportunities,
      open: opportunitySummary.open,
      inProgress: opportunitySummary.inProgress,
      highPriority: opportunitySummary.highPriority,
      dueSoon: opportunitySummary.dueSoon,
      overdue: opportunitySummary.overdue,
      byType: opportunitySummary.byType,
      byStatus: opportunitySummary.byStatus,
    },
  });
}
