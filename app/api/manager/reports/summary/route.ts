import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

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

  const [paymentsResult, checkinsResult, bookingsResult, shiftsResult] = await Promise.all([
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
      .select("status, cash_total, card_total, transfer_total")
      .eq("tenant_id", auth.context.tenantId)
      .gte("opened_at", range.from)
      .lte("opened_at", range.to),
  ]);

  if (paymentsResult.error) return NextResponse.json({ error: paymentsResult.error.message }, { status: 500 });
  if (checkinsResult.error) return NextResponse.json({ error: checkinsResult.error.message }, { status: 500 });
  if (bookingsResult.error) return NextResponse.json({ error: bookingsResult.error.message }, { status: 500 });
  if (shiftsResult.error) return NextResponse.json({ error: shiftsResult.error.message }, { status: 500 });

  const payments = (paymentsResult.data || []) as Array<{ status: string; method: string; amount: number | string | null }>;
  const checkins = (checkinsResult.data || []) as Array<{ result: string }>;
  const bookings = (bookingsResult.data || []) as Array<{ status: string }>;
  const shifts = (shiftsResult.data || []) as Array<{
    status: string;
    cash_total: number | string | null;
    card_total: number | string | null;
    transfer_total: number | string | null;
  }>;

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
      }
      return acc;
    },
    { cash: 0, card: 0, transfer: 0 },
  );

  return NextResponse.json({
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
      closedShiftCount: shifts.filter((item) => item.status === "closed").length,
      closedTotals: shiftTotals,
    },
  });
}
