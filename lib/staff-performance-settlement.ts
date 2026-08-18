export const STAFF_PERFORMANCE_ALLOCATION_VERSION = "bige-sales-allocation-2026-08-v2";
export const STAFF_EPO_RULE_VERSION = "bige-epo-2026-08-v1";

export type SalesSourceType = "fa" | "renewal" | "final_payment" | "refund" | "manual_adjustment";

export type SalesAllocationDraft = {
  employeeId: string;
  amount: number;
  allocationKind?: "origin_default" | "manual" | "refund_reversal" | "legacy";
  sourceAllocationId?: string | null;
};

function toCents(value: number) {
  if (!Number.isFinite(value)) throw new Error("業績金額格式錯誤");
  return Math.round(value * 100);
}

function fromCents(value: number) {
  return value / 100;
}

export function buildDefaultSalesAllocations(params: {
  amount: number;
  sourceType: SalesSourceType;
  originEmployeeId: string | null;
}) {
  const totalCents = toCents(params.amount);
  if (totalCents <= 0 || !params.originEmployeeId || !["fa", "renewal"].includes(params.sourceType)) {
    return { allocations: [] as SalesAllocationDraft[], allocatedAmount: 0, remainingAmount: params.amount };
  }
  const originCents = Math.round(totalCents / 2);
  return {
    allocations: [{ employeeId: params.originEmployeeId, amount: fromCents(originCents), allocationKind: "origin_default" as const }],
    allocatedAmount: fromCents(originCents),
    remainingAmount: fromCents(totalCents - originCents),
  };
}

export function validateSalesAllocations(totalAmount: number, allocations: SalesAllocationDraft[]) {
  const totalCents = toCents(totalAmount);
  const seen = new Set<string>();
  let allocatedCents = 0;
  for (const allocation of allocations) {
    const employeeId = allocation.employeeId.trim();
    if (!employeeId) throw new Error("每筆業績分配都必須指定教練");
    if (seen.has(employeeId)) throw new Error("同一位教練不可在同一筆業績中重複分配");
    seen.add(employeeId);
    const amountCents = toCents(allocation.amount);
    if (amountCents <= 0) throw new Error("每位教練的分配金額必須大於 0");
    allocatedCents += amountCents;
  }
  return {
    valid: allocatedCents === totalCents,
    totalAmount: fromCents(totalCents),
    allocatedAmount: fromCents(allocatedCents),
    remainingAmount: fromCents(totalCents - allocatedCents),
  };
}

export function allocateRefundByOriginal(params: {
  refundAmount: number;
  originalAllocations: Array<{ id: string; employeeId: string; amount: number }>;
}) {
  const refundCents = Math.abs(toCents(params.refundAmount));
  const originals = params.originalAllocations.map((allocation) => ({
    ...allocation,
    cents: Math.abs(toCents(allocation.amount)),
  })).filter((allocation) => allocation.cents > 0);
  const originalTotal = originals.reduce((sum, allocation) => sum + allocation.cents, 0);
  if (!originals.length || originalTotal <= 0) throw new Error("找不到原業績分配，退款不可重新自由分配");
  if (refundCents > originalTotal) throw new Error("退款金額不可超過原業績分配總額");

  const shares = originals.map((allocation) => {
    const numerator = refundCents * allocation.cents;
    const base = Math.floor(numerator / originalTotal);
    return { ...allocation, refundCents: base, remainder: numerator % originalTotal };
  });
  let remaining = refundCents - shares.reduce((sum, allocation) => sum + allocation.refundCents, 0);
  const remainderOrder = [...shares].sort((left, right) => right.remainder - left.remainder || left.id.localeCompare(right.id));
  for (let index = 0; remaining > 0; index = (index + 1) % remainderOrder.length) {
    remainderOrder[index].refundCents += 1;
    remaining -= 1;
  }
  const refundById = new Map(remainderOrder.map((allocation) => [allocation.id, allocation.refundCents]));
  return shares.map((allocation) => ({
    employeeId: allocation.employeeId,
    amount: -fromCents(refundById.get(allocation.id) || 0),
    allocationKind: "refund_reversal" as const,
    sourceAllocationId: allocation.id,
  }));
}

export function contractThresholdEpoRule(params: {
  sourceType: SalesSourceType;
  totalSessions: number | null;
}) {
  const sessions = Math.max(0, Math.floor(Number(params.totalSessions || 0)));
  if (params.sourceType === "fa" && sessions >= 72) {
    return { eligible: true, ruleKey: "contract_fa_72", label: `新單 ${sessions} 堂（門檻 72 堂）` } as const;
  }
  if (params.sourceType === "renewal" && sessions >= 48) {
    return { eligible: true, ruleKey: "contract_renewal_48", label: `續約 ${sessions} 堂（門檻 48 堂）` } as const;
  }
  return { eligible: false, ruleKey: null, label: null } as const;
}

export function evaluateDailyTop(receipts: Array<{
  employeeId: string | null;
  amount: number;
  refunded?: boolean;
}>) {
  const totals = new Map<string, number>();
  for (const receipt of receipts) {
    if (!receipt.employeeId || receipt.refunded || receipt.amount <= 0) continue;
    totals.set(receipt.employeeId, (totals.get(receipt.employeeId) || 0) + toCents(receipt.amount));
  }
  const ranked = [...totals.entries()]
    .map(([employeeId, cents]) => ({ employeeId, amount: fromCents(cents) }))
    .sort((left, right) => right.amount - left.amount || left.employeeId.localeCompare(right.employeeId));
  if (!ranked.length) return { status: "none" as const, amount: 0, candidateEmployeeIds: [] as string[], totals: ranked };
  const amount = ranked[0].amount;
  const candidateEmployeeIds = ranked.filter((item) => item.amount === amount).map((item) => item.employeeId);
  return {
    status: candidateEmployeeIds.length === 1 ? "unique" as const : "tie" as const,
    amount,
    candidateEmployeeIds,
    totals: ranked,
  };
}

function taipeiTimeMinutes(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function clockMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

export function classifyCompletedSessionsAgainstShift(params: {
  shiftStartsAt: string | null;
  shiftEndsAt: string | null;
  crossesMidnight?: boolean;
  sessions: Array<{ startsAt: string; endsAt: string }>;
}) {
  if (!params.shiftStartsAt || !params.shiftEndsAt) {
    return { ready: false, inside: 0, outside: 0, boundary: params.sessions.length };
  }
  const shiftStart = clockMinutes(params.shiftStartsAt);
  let shiftEnd = clockMinutes(params.shiftEndsAt);
  if (params.crossesMidnight || shiftEnd <= shiftStart) shiftEnd += 24 * 60;
  let inside = 0;
  let outside = 0;
  let boundary = 0;
  for (const session of params.sessions) {
    let sessionStart = taipeiTimeMinutes(session.startsAt);
    let sessionEnd = taipeiTimeMinutes(session.endsAt);
    if (sessionEnd <= sessionStart) sessionEnd += 24 * 60;
    if (shiftEnd > 24 * 60 && sessionStart < shiftStart) {
      sessionStart += 24 * 60;
      sessionEnd += 24 * 60;
    }
    if (sessionStart >= shiftStart && sessionEnd <= shiftEnd) inside += 1;
    else if (sessionEnd <= shiftStart || sessionStart >= shiftEnd) outside += 1;
    else boundary += 1;
  }
  return { ready: true, inside, outside, boundary };
}

export function sessionLoadEpoRule(params: {
  employmentType: "full_time" | "part_time";
  insideSessions: number;
  outsideSessions: number;
}) {
  const requiredInside = params.employmentType === "part_time" ? 3 : 6;
  const requiredOutside = params.employmentType === "part_time" ? 1 : 2;
  return {
    eligible: params.insideSessions >= requiredInside && params.outsideSessions >= requiredOutside,
    requiredInside,
    requiredOutside,
    label: `${params.employmentType === "part_time" ? "兼職" : "正職"}班內 ${params.insideSessions}/${requiredInside}、班外 ${params.outsideSessions}/${requiredOutside}`,
  };
}
