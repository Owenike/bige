import { performanceMonthRange, taiwanBusinessDate } from "./staff-performance";

type QueryClient = any;

function occursInMonth(value: string | null | undefined, range: ReturnType<typeof performanceMonthRange>) {
  if (!value) return false;
  const date = taiwanBusinessDate(value);
  return date >= range.start && date <= range.end;
}

/**
 * Mirrors existing BIG E receipt/refund records into the allocation inbox.
 * The upsert deliberately omits workflow columns, so repeated syncs never erase
 * an assistant assignment, manager approval, or daily confirmation.
 */
export async function syncBigePaymentPerformanceSources(admin: QueryClient, tenantId: string, month: string) {
  const range = performanceMonthRange(month);
  const paymentResult = await admin.from("bige_contract_payments")
    .select("id, contract_id, payment_kind, amount, status, paid_at, voided_at, void_reason")
    .eq("tenant_id", tenantId)
    .or(`and(paid_at.gte.${range.startIso},paid_at.lt.${range.nextIso}),and(voided_at.gte.${range.startIso},voided_at.lt.${range.nextIso})`)
    .order("paid_at", { ascending: true });
  if (paymentResult.error) throw new Error(paymentResult.error.message);
  const payments = paymentResult.data || [];
  const contractIds = [...new Set(payments.map((row: any) => String(row.contract_id)))];
  if (!contractIds.length) return;

  const [contractResult, allPaymentsResult] = await Promise.all([
    admin.from("member_plan_contracts").select("id, branch_id, member_id, contract_number, source_trial_booking_id, converted_from_booking_id").eq("tenant_id", tenantId).in("id", contractIds),
    admin.from("bige_contract_payments").select("id, contract_id, paid_at").eq("tenant_id", tenantId).in("contract_id", contractIds).order("paid_at", { ascending: true }),
  ]);
  if (contractResult.error || allPaymentsResult.error) throw new Error(contractResult.error?.message || allPaymentsResult.error?.message || "業績來源讀取失敗");
  const contracts = new Map((contractResult.data || []).map((row: any) => [String(row.id), row]));
  const memberIds = [...new Set((contractResult.data || []).map((row: any) => row.member_id ? String(row.member_id) : "").filter(Boolean))];
  const memberResult = memberIds.length
    ? await admin.from("members").select("id, full_name").eq("tenant_id", tenantId).in("id", memberIds)
    : { data: [], error: null };
  if (memberResult.error) throw new Error(memberResult.error.message);
  const members = new Map((memberResult.data || []).map((row: any) => [String(row.id), String(row.full_name || "會員")]));
  const firstPaymentByContract = new Map<string, string>();
  for (const row of allPaymentsResult.data || []) {
    const key = String(row.contract_id);
    if (!firstPaymentByContract.has(key)) firstPaymentByContract.set(key, String(row.id));
  }

  const rows: Array<Record<string, unknown>> = [];
  const voidedKeys: string[] = [];
  for (const payment of payments) {
    const contract: any = contracts.get(String(payment.contract_id));
    if (!contract) continue;
    const memberName = contract.member_id ? members.get(String(contract.member_id)) || "會員" : "會員";
    const isFirst = firstPaymentByContract.get(String(payment.contract_id)) === String(payment.id);
    const sourceType = !isFirst || payment.payment_kind === "balance"
      ? "final_payment"
      : contract.source_trial_booking_id || contract.converted_from_booking_id ? "fa" : "renewal";
    if (occursInMonth(String(payment.paid_at), range) && payment.status !== "voided") {
      rows.push({ tenant_id: tenantId, branch_id: contract.branch_id || null, business_date: taiwanBusinessDate(String(payment.paid_at)), source_type: sourceType, source_key: `bige-payment:${payment.id}`, source_table: "bige_contract_payments", source_id: payment.id, source_occurred_at: payment.paid_at, member_id: contract.member_id || null, member_name_snapshot: memberName, contract_number: contract.contract_number || null, label: `${sourceType === "fa" ? "FA 成交" : sourceType === "renewal" ? "續約" : "繳交尾款"}｜${memberName}`, amount: Number(payment.amount), metadata: { paymentKind: payment.payment_kind, paymentStatus: payment.status } });
    }
    if (payment.status === "voided") voidedKeys.push(`bige-payment:${payment.id}`);
    if (payment.status === "refunded" && occursInMonth(payment.voided_at ? String(payment.voided_at) : null, range)) {
      rows.push({ tenant_id: tenantId, branch_id: contract.branch_id || null, business_date: taiwanBusinessDate(String(payment.voided_at)), source_type: "refund", source_key: `bige-refund:${payment.id}`, source_table: "bige_contract_payments", source_id: payment.id, source_occurred_at: payment.voided_at, member_id: contract.member_id || null, member_name_snapshot: memberName, contract_number: contract.contract_number || null, label: `退款扣回｜${memberName}`, amount: -Math.abs(Number(payment.amount)), metadata: { paymentKind: payment.payment_kind, refundReason: payment.void_reason || null } });
    }
  }
  if (rows.length) {
    const saved = await admin.from("staff_sales_events").upsert(rows, { onConflict: "tenant_id,source_key" });
    if (saved.error) throw new Error(saved.error.message);
  }
  if (voidedKeys.length) {
    const ignored = await admin.from("staff_sales_events").update({ status: "ignored", assigned_employee_id: null, review_note: "原付款已作廢" }).eq("tenant_id", tenantId).in("source_key", voidedKeys).neq("status", "daily_confirmed");
    if (ignored.error) throw new Error(ignored.error.message);
  }
}
