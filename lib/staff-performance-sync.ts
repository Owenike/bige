import {
  allocateRefundByOriginal,
  buildDefaultSalesAllocations,
  type SalesSourceType,
} from "./staff-performance-settlement";
import { performanceMonthRange, taiwanBusinessDate } from "./staff-performance";

type QueryClient = any;

export function resolveSalesPerformanceOccurrence(params: {
  sourceType: SalesSourceType;
  paidAt: string;
  originBookingStartsAt?: string | null;
}) {
  const usesOriginBooking = (
    params.sourceType === "fa" || params.sourceType === "bb"
  ) && Boolean(params.originBookingStartsAt);
  const occurredAt = usesOriginBooking
    ? String(params.originBookingStartsAt)
    : params.paidAt;
  return {
    businessDate: taiwanBusinessDate(occurredAt),
    occurredAt,
    dateSource: usesOriginBooking ? "origin_booking" : "payment",
  } as const;
}

export function resolvePaymentOriginEmployeeId(params: {
  contractOriginEmployeeId?: unknown;
  convertedBookingCoachId?: unknown;
  paymentBookingCoachId?: unknown;
  memberPrimaryCoachId?: unknown;
}) {
  for (const value of [
    params.contractOriginEmployeeId,
    params.convertedBookingCoachId,
    params.paymentBookingCoachId,
    params.memberPrimaryCoachId,
  ]) {
    const employeeId = value ? String(value).trim() : "";
    if (employeeId) return employeeId;
  }
  return null;
}

function occursInMonth(value: string | null | undefined, range: ReturnType<typeof performanceMonthRange>) {
  if (!value) return false;
  const date = taiwanBusinessDate(value);
  return date >= range.start && date <= range.end;
}

function sourceTypeForPayment(params: {
  paymentId: string;
  contractId: string;
  paymentKind: string | null;
  firstPaymentByContract: Map<string, string>;
  isFa: boolean;
  originKind: string | null;
}): SalesSourceType {
  if (params.originKind === "bb") return "bb";
  const first = params.firstPaymentByContract.get(params.contractId) === params.paymentId;
  if (!first || params.paymentKind === "balance") return "final_payment";
  if (params.originKind === "manual") return "final_payment";
  return params.isFa ? "fa" : "renewal";
}

function activeAllocationRows(event: any, allocations: any[]) {
  const version = Number(event.active_allocation_version || 0);
  return allocations.filter((row) =>
    String(row.event_id) === String(event.id) &&
    Number(row.allocation_version) === version &&
    row.status !== "cancelled",
  );
}

/**
 * Mirrors BIG E receipts/refunds into the settlement inbox, snapshots the
 * source coach, creates the editable 50% receipt default, and generates
 * exact refund reversals from the frozen original allocation rows.
 */
export async function syncBigePaymentPerformanceSources(
  admin: QueryClient,
  tenantId: string,
  month: string,
  actorId: string,
) {
  const range = performanceMonthRange(month);
  const originBookingResult = await admin.from("bookings")
    .select("id, converted_contract_id")
    .eq("tenant_id", tenantId)
    .eq("is_bige_schedule", true)
    .in("operation_kind", ["trial", "bb"])
    .gte("starts_at", range.startIso)
    .lt("starts_at", range.nextIso)
    .not("converted_contract_id", "is", null);
  if (originBookingResult.error) throw new Error(originBookingResult.error.message);
  const originContractIds = [...new Set((originBookingResult.data || [])
    .map((row: any) => row.converted_contract_id ? String(row.converted_contract_id) : "")
    .filter(Boolean))];
  const datedPaymentPromise = admin.from("bige_contract_payments")
    .select("id, contract_id, payment_kind, amount, status, paid_at, voided_at, void_reason, recorded_by, source_booking_id")
    .eq("tenant_id", tenantId)
    .or(`and(paid_at.gte.${range.startIso},paid_at.lt.${range.nextIso}),and(voided_at.gte.${range.startIso},voided_at.lt.${range.nextIso})`)
    .order("paid_at", { ascending: true });
  const originPaymentPromise = originContractIds.length
    ? admin.from("bige_contract_payments")
      .select("id, contract_id, payment_kind, amount, status, paid_at, voided_at, void_reason, recorded_by, source_booking_id")
      .eq("tenant_id", tenantId)
      .in("contract_id", originContractIds)
      .order("paid_at", { ascending: true })
    : Promise.resolve({ data: [], error: null });
  const [datedPaymentResult, originPaymentResult] = await Promise.all([
    datedPaymentPromise,
    originPaymentPromise,
  ]);
  if (datedPaymentResult.error || originPaymentResult.error) {
    throw new Error(datedPaymentResult.error?.message || originPaymentResult.error?.message || "業績來源讀取失敗");
  }
  const payments = [...new Map([
    ...(datedPaymentResult.data || []),
    ...(originPaymentResult.data || []),
  ].map((row: any) => [String(row.id), row])).values()];
  const contractIds = [...new Set(payments.map((row: any) => String(row.contract_id)))];
  if (!contractIds.length) return;

  const [contractResult, allPaymentsResult] = await Promise.all([
    admin.from("member_plan_contracts")
      .select("id, branch_id, member_id, contract_number, total_sessions, status, payment_status, source_trial_booking_id, converted_from_booking_id, sales_origin_coach_id, sales_origin_kind")
      .eq("tenant_id", tenantId).in("id", contractIds),
    admin.from("bige_contract_payments").select("id, contract_id, paid_at")
      .eq("tenant_id", tenantId).in("contract_id", contractIds).order("paid_at", { ascending: true }),
  ]);
  if (contractResult.error || allPaymentsResult.error) {
    throw new Error(contractResult.error?.message || allPaymentsResult.error?.message || "業績來源讀取失敗");
  }
  const contracts = new Map((contractResult.data || []).map((row: any) => [String(row.id), row]));
  const memberIds = [...new Set((contractResult.data || []).map((row: any) => row.member_id ? String(row.member_id) : "").filter(Boolean))];
  const bookingIds = [...new Set([
    ...(contractResult.data || []).map((row: any) => row.converted_from_booking_id),
    ...payments.map((row: any) => row.source_booking_id),
  ].filter(Boolean).map(String))];
  const [memberResult, bookingResult] = await Promise.all([
    memberIds.length
      ? admin.from("members").select("id, full_name, primary_coach_id").eq("tenant_id", tenantId).in("id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    bookingIds.length
      ? admin.from("bookings").select("id, coach_id, starts_at, operation_kind").eq("tenant_id", tenantId).in("id", bookingIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (memberResult.error || bookingResult.error) throw new Error(memberResult.error?.message || bookingResult.error?.message || "原成交教練讀取失敗");
  const members = new Map((memberResult.data || []).map((row: any) => [String(row.id), row]));
  const originBookings = new Map<string, any>((bookingResult.data || []).map((row: any) => [String(row.id), row]));
  const firstPaymentByContract = new Map<string, string>();
  for (const row of allPaymentsResult.data || []) {
    const key = String(row.contract_id);
    if (!firstPaymentByContract.has(key)) firstPaymentByContract.set(key, String(row.id));
  }

  const sourceRows: Array<Record<string, unknown>> = [];
  const voidedKeys: string[] = [];
  for (const payment of payments) {
    const contract: any = contracts.get(String(payment.contract_id));
    if (!contract) continue;
    const member: any = contract.member_id ? members.get(String(contract.member_id)) : null;
    const memberName = String(member?.full_name || "會員");
    const originEmployeeId = resolvePaymentOriginEmployeeId({
      contractOriginEmployeeId: contract.sales_origin_coach_id,
      convertedBookingCoachId: contract.converted_from_booking_id
        ? originBookings.get(String(contract.converted_from_booking_id))?.coach_id
        : null,
      paymentBookingCoachId: payment.source_booking_id
        ? originBookings.get(String(payment.source_booking_id))?.coach_id
        : null,
      memberPrimaryCoachId: member?.primary_coach_id,
    });
    const isFa = contract.sales_origin_kind === "fa" || (
      !contract.sales_origin_kind && Boolean(contract.converted_from_booking_id || contract.source_trial_booking_id)
    );
    const sourceType = sourceTypeForPayment({
      paymentId: String(payment.id),
      contractId: String(payment.contract_id),
      paymentKind: payment.payment_kind ? String(payment.payment_kind) : null,
      firstPaymentByContract,
      isFa,
      originKind: contract.sales_origin_kind ? String(contract.sales_origin_kind) : null,
    });
    const originBooking = contract.converted_from_booking_id
      ? originBookings.get(String(contract.converted_from_booking_id))
      : null;
    const occurrence = resolveSalesPerformanceOccurrence({
      sourceType,
      paidAt: String(payment.paid_at),
      originBookingStartsAt: originBooking?.starts_at || null,
    });
    const shared = {
      tenant_id: tenantId,
      branch_id: contract.branch_id || null,
      contract_id: contract.id,
      contract_sessions: contract.total_sessions || null,
      origin_employee_id: originEmployeeId,
      member_id: contract.member_id || null,
      member_name_snapshot: memberName,
      contract_number: contract.contract_number || null,
      source_table: "bige_contract_payments",
      source_id: payment.id,
    };
    if ((occursInMonth(occurrence.businessDate, range) || payment.status === "refunded") && payment.status !== "voided") {
      sourceRows.push({
        ...shared,
        business_date: occurrence.businessDate,
        source_type: sourceType,
        source_key: `bige-payment:${payment.id}`,
        source_occurred_at: occurrence.occurredAt,
        label: `${sourceType === "fa" ? "FA 成交" : sourceType === "bb" ? "BB 成交" : sourceType === "renewal" ? "續約" : "繳交尾款"}｜${memberName}`,
        amount: Number(payment.amount),
        metadata: {
          paymentKind: payment.payment_kind,
          paymentStatus: payment.status,
          contractStatus: contract.status,
          contractPaymentStatus: contract.payment_status,
          originEmployeeId,
          paymentPaidAt: payment.paid_at,
          paymentSourceBookingId: payment.source_booking_id || null,
          settlementDateSource: occurrence.dateSource,
          originBookingStartsAt: originBooking?.starts_at || null,
        },
      });
    }
    if (payment.status === "voided") voidedKeys.push(`bige-payment:${payment.id}`);
    if (payment.status === "refunded" && occursInMonth(payment.voided_at ? String(payment.voided_at) : null, range)) {
      sourceRows.push({
        ...shared,
        business_date: taiwanBusinessDate(String(payment.voided_at)),
        source_type: "refund",
        source_key: `bige-refund:${payment.id}`,
        source_occurred_at: payment.voided_at,
        label: `退款扣回｜${memberName}`,
        amount: -Math.abs(Number(payment.amount)),
        metadata: {
          paymentKind: payment.payment_kind,
          paymentStatus: payment.status,
          contractStatus: contract.status,
          contractPaymentStatus: contract.payment_status,
          refundReason: payment.void_reason || null,
          originalSourceKey: `bige-payment:${payment.id}`,
          originEmployeeId,
        },
      });
    }
  }
  if (sourceRows.length) {
    const sourceKeys = sourceRows.map((row) => String(row.source_key));
    const existingResult = await admin.from("staff_sales_events")
      .select("source_key, business_date, source_occurred_at, status")
      .eq("tenant_id", tenantId)
      .in("source_key", sourceKeys);
    if (existingResult.error) throw new Error(existingResult.error.message);
    const confirmedEvents = new Map<string, any>((existingResult.data || [])
      .filter((row: any) => row.status === "daily_confirmed")
      .map((row: any) => [String(row.source_key), row]));
    const safeSourceRows = sourceRows.map((row) => {
      const confirmed = confirmedEvents.get(String(row.source_key));
      return confirmed ? {
        ...row,
        business_date: confirmed.business_date,
        source_occurred_at: confirmed.source_occurred_at,
      } : row;
    });
    const saved = await admin.from("staff_sales_events").upsert(safeSourceRows, { onConflict: "tenant_id,source_key" });
    if (saved.error) throw new Error(saved.error.message);
  }

  const sourceKeys = sourceRows.map((row) => String(row.source_key));
  const originalKeys = payments.map((payment: any) => `bige-payment:${payment.id}`);
  const eventResult = await admin.from("staff_sales_events").select("*")
    .eq("tenant_id", tenantId).in("source_key", [...new Set([...sourceKeys, ...originalKeys])]);
  if (eventResult.error) throw new Error(eventResult.error.message);
  const events = eventResult.data || [];
  const eventIds = events.map((event: any) => String(event.id));
  const allocationResult = eventIds.length
    ? await admin.from("staff_sales_allocations").select("*").eq("tenant_id", tenantId).in("event_id", eventIds)
    : { data: [], error: null };
  if (allocationResult.error) throw new Error(allocationResult.error.message);
  const allocations = allocationResult.data || [];

  for (const event of events) {
    const current = activeAllocationRows(event, allocations);
    if (event.source_type === "refund" || current.length || event.status !== "unassigned") continue;
    const proposal = buildDefaultSalesAllocations({
      amount: Number(event.amount),
      sourceType: event.source_type as SalesSourceType,
      originEmployeeId: event.origin_employee_id ? String(event.origin_employee_id) : null,
    });
    if (!proposal.allocations.length) continue;
    const allocation = proposal.allocations[0];
    const seeded = await admin.rpc("staff_seed_default_allocation_v1", {
      p_tenant_id: tenantId,
      p_event_id: event.id,
      p_actor_id: actorId,
      p_employee_id: allocation.employeeId,
      p_amount: allocation.amount,
      p_remaining_amount: proposal.remainingAmount,
    });
    if (seeded.error) throw new Error(seeded.error.message);
  }

  const refreshedAllocationResult = eventIds.length
    ? await admin.from("staff_sales_allocations").select("*").eq("tenant_id", tenantId).in("event_id", eventIds)
    : { data: [], error: null };
  if (refreshedAllocationResult.error) throw new Error(refreshedAllocationResult.error.message);
  const refreshedAllocations = refreshedAllocationResult.data || [];
  const bySourceKey = new Map(events.map((event: any) => [String(event.source_key), event]));
  for (const refundEvent of events.filter((event: any) => event.source_type === "refund")) {
    if (activeAllocationRows(refundEvent, refreshedAllocations).length) continue;
    const originalSourceKey = String(refundEvent.metadata?.originalSourceKey || `bige-payment:${refundEvent.source_id}`);
    const originalEvent: any = bySourceKey.get(originalSourceKey);
    if (!originalEvent || originalEvent.status !== "daily_confirmed") {
      const update = await admin.from("staff_sales_events").update({
        status: "unassigned",
        allocation_note: "原收款尚未正式結算，必須先完成原分配才能精確扣回",
      }).eq("id", refundEvent.id).neq("status", "daily_confirmed");
      if (update.error) throw new Error(update.error.message);
      continue;
    }
    const originalAllocations = activeAllocationRows(originalEvent, refreshedAllocations)
      .filter((allocation: any) => allocation.status === "daily_confirmed")
      .map((allocation: any) => ({
        id: String(allocation.id),
        employeeId: String(allocation.employee_id),
        amount: Number(allocation.amount),
      }));
    const reversals = allocateRefundByOriginal({ refundAmount: Math.abs(Number(refundEvent.amount)), originalAllocations });
    const seeded = await admin.rpc("staff_seed_refund_allocations_v1", {
      p_tenant_id: tenantId,
      p_event_id: refundEvent.id,
      p_actor_id: actorId,
      p_allocations: reversals.map((allocation) => ({
        employee_id: allocation.employeeId,
        amount: allocation.amount,
        source_allocation_id: allocation.sourceAllocationId,
      })),
    });
    if (seeded.error) throw new Error(seeded.error.message);
  }

  if (voidedKeys.length) {
    const voidedEvents = events.filter((event: any) => voidedKeys.includes(String(event.source_key)) && event.status !== "daily_confirmed");
    if (voidedEvents.length) {
      const voidedIds = voidedEvents.map((event: any) => String(event.id));
      const [ignored, cancelled] = await Promise.all([
        admin.from("staff_sales_events").update({ status: "ignored", assigned_employee_id: null, review_note: "原付款已作廢" }).eq("tenant_id", tenantId).in("id", voidedIds),
        admin.from("staff_sales_allocations").update({ status: "cancelled", review_note: "原付款已作廢" }).eq("tenant_id", tenantId).in("event_id", voidedIds).neq("status", "daily_confirmed"),
      ]);
      if (ignored.error || cancelled.error) throw new Error(ignored.error?.message || cancelled.error?.message || "作廢業績同步失敗");
    }
  }
}
