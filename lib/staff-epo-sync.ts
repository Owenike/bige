import { createHash } from "node:crypto";
import {
  classifyCompletedSessionsAgainstShift,
  contractThresholdEpoRule,
  evaluateDailyTop,
  sessionLoadEpoRule,
  STAFF_EPO_RULE_VERSION,
} from "./staff-performance-settlement";

type QueryClient = any;

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function findAward(admin: QueryClient, tenantId: string, ruleKey: string) {
  const result = await admin.from("staff_epo_awards").select("*")
    .eq("tenant_id", tenantId).eq("rule_key", ruleKey).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function insertAward(admin: QueryClient, row: Record<string, unknown>) {
  const existing = row.rule_key ? await findAward(admin, String(row.tenant_id), String(row.rule_key)) : null;
  if (existing) return existing;
  const result = await admin.from("staff_epo_awards").insert(row).select("*").single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function ensureThresholdAwards(params: {
  admin: QueryClient;
  tenantId: string;
  businessDate: string;
  actorId: string;
  events: any[];
}) {
  for (const event of params.events) {
    if (!["fa", "renewal"].includes(String(event.source_type)) || !event.origin_employee_id || !event.contract_id) continue;
    if (["refunded", "voided"].includes(String(event.metadata?.paymentStatus)) || event.metadata?.contractStatus === "canceled") continue;
    const rule = contractThresholdEpoRule({
      sourceType: event.source_type,
      totalSessions: event.contract_sessions == null ? null : Number(event.contract_sessions),
    });
    if (!rule.eligible) continue;
    const ruleKey = `contract-threshold:${event.contract_id}`;
    await insertAward(params.admin, {
      tenant_id: params.tenantId,
      branch_id: event.branch_id || null,
      business_date: event.business_date,
      employee_id: event.origin_employee_id,
      quantity: 1,
      reason: rule.label,
      status: "manager_approved",
      proposed_by: params.actorId,
      award_type: "contract_threshold",
      rule_key: ruleKey,
      source_contract_id: event.contract_id,
      source_event_id: event.id,
      calculation: {
        ruleVersion: STAFF_EPO_RULE_VERSION,
        sourceType: event.source_type,
        totalSessions: Number(event.contract_sessions || 0),
        threshold: event.source_type === "fa" ? 72 : 48,
      },
    });
  }

  for (const refundEvent of params.events.filter((event) => event.source_type === "refund" && event.contract_id)) {
    const fullyReturned = refundEvent.metadata?.contractStatus === "canceled" || refundEvent.metadata?.contractPaymentStatus === "refunded";
    if (!fullyReturned) continue;
    const originalResult = await params.admin.from("staff_epo_awards").select("*")
      .eq("tenant_id", params.tenantId)
      .eq("source_contract_id", refundEvent.contract_id)
      .eq("award_type", "contract_threshold")
      .gt("quantity", 0)
      .maybeSingle();
    if (originalResult.error) throw new Error(originalResult.error.message);
    const original = originalResult.data;
    if (!original) continue;
    if (original.status !== "daily_confirmed") {
      const cancelled = await params.admin.from("staff_epo_awards").update({
        status: "cancelled",
        review_note: "合約已退單，門檻 EPO 不成立",
      }).eq("id", original.id).neq("status", "daily_confirmed");
      if (cancelled.error) throw new Error(cancelled.error.message);
      continue;
    }
    await insertAward(params.admin, {
      tenant_id: params.tenantId,
      branch_id: refundEvent.branch_id || null,
      business_date: params.businessDate,
      employee_id: original.employee_id,
      quantity: -Math.abs(Number(original.quantity || 1)),
      reason: `退單追回｜${original.reason}`,
      status: "manager_approved",
      proposed_by: params.actorId,
      award_type: "reversal",
      rule_key: `contract-threshold-reversal:${original.id}`,
      source_contract_id: refundEvent.contract_id,
      source_event_id: refundEvent.id,
      source_award_id: original.id,
      calculation: {
        ruleVersion: STAFF_EPO_RULE_VERSION,
        refundBusinessDate: params.businessDate,
        originalAwardBusinessDate: original.business_date,
      },
    });
  }
}

async function reconcileDailyTop(params: {
  admin: QueryClient;
  tenantId: string;
  branchId: string | null;
  originalBusinessDate: string;
  adjustmentBusinessDate: string;
  actorId: string;
}) {
  const eventResult = await params.admin.from("staff_sales_events").select("*")
    .eq("tenant_id", params.tenantId)
    .eq("business_date", params.originalBusinessDate)
    .in("source_type", ["fa", "renewal", "final_payment"])
    .gt("amount", 0);
  if (eventResult.error) throw new Error(eventResult.error.message);
  const events = eventResult.data || [];
  const top = evaluateDailyTop(events.map((event: any) => ({
    employeeId: event.origin_employee_id ? String(event.origin_employee_id) : null,
    amount: Number(event.amount),
    refunded: event.metadata?.paymentStatus === "refunded" || event.metadata?.paymentStatus === "voided",
  })));
  const sourceFingerprint = fingerprint(top.totals);
  const stateResult = await params.admin.from("staff_epo_daily_top_states").select("*")
    .eq("tenant_id", params.tenantId).eq("business_date", params.originalBusinessDate).maybeSingle();
  if (stateResult.error) throw new Error(stateResult.error.message);
  const existing = stateResult.data;
  const candidates = top.candidateEmployeeIds;
  const sourceChanged = Boolean(existing && existing.source_fingerprint !== sourceFingerprint);
  let selectedEmployeeId: string | null = null;
  let status: "none" | "auto_selected" | "tie_pending" | "assistant_selected" | "manager_selected" = "none";
  if (top.status === "unique") {
    selectedEmployeeId = candidates[0];
    status = "auto_selected";
  } else if (top.status === "tie") {
    const existingSelected = existing?.selected_employee_id ? String(existing.selected_employee_id) : null;
    const manuallySelected = ["assistant_selected", "manager_selected"].includes(String(existing?.status));
    if (!sourceChanged && existingSelected && manuallySelected && candidates.includes(existingSelected)) {
      selectedEmployeeId = existingSelected;
      status = existing.status;
    } else {
      status = "tie_pending";
    }
  }

  const stateValues = {
    branch_id: params.branchId,
    adjustment_business_date: params.adjustmentBusinessDate,
    top_amount: top.amount,
    candidate_employee_ids: candidates,
    selected_employee_id: selectedEmployeeId,
    status,
    source_fingerprint: sourceFingerprint,
    ...(status === "auto_selected" ? { decision_by: null, decision_at: null } : {}),
  };
  let state: any;
  if (existing) {
    const update = await params.admin.from("staff_epo_daily_top_states").update(stateValues)
      .eq("id", existing.id).select("*").single();
    if (update.error) throw new Error(update.error.message);
    state = update.data;
  } else {
    const insert = await params.admin.from("staff_epo_daily_top_states").insert({
      tenant_id: params.tenantId,
      business_date: params.originalBusinessDate,
      ...stateValues,
    }).select("*").single();
    if (insert.error) throw new Error(insert.error.message);
    state = insert.data;
  }

  const oldAward = state.active_award_id
    ? await params.admin.from("staff_epo_awards").select("*").eq("id", state.active_award_id).maybeSingle()
    : { data: null, error: null };
  if (oldAward.error) throw new Error(oldAward.error.message);
  const old = oldAward.data;
  if (old && String(old.employee_id) !== String(selectedEmployeeId || "")) {
    if (old.status === "daily_confirmed") {
      await insertAward(params.admin, {
        tenant_id: params.tenantId,
        branch_id: params.branchId,
        business_date: params.adjustmentBusinessDate,
        employee_id: old.employee_id,
        quantity: -Math.abs(Number(old.quantity || 1)),
        reason: `退單重算追回｜${params.originalBusinessDate} 每日數字最高`,
        status: "manager_approved",
        proposed_by: params.actorId,
        award_type: "reversal",
        rule_key: `daily-top-reversal:${old.id}:${sourceFingerprint}`,
        source_award_id: old.id,
        calculation: { ruleVersion: STAFF_EPO_RULE_VERSION, originalBusinessDate: params.originalBusinessDate, sourceFingerprint },
      });
    } else {
      const cancelled = await params.admin.from("staff_epo_awards").update({ status: "cancelled", review_note: "每日最高數字已重新計算" })
        .eq("id", old.id).neq("status", "daily_confirmed");
      if (cancelled.error) throw new Error(cancelled.error.message);
    }
    const cleared = await params.admin.from("staff_epo_daily_top_states").update({ active_award_id: null }).eq("id", state.id);
    if (cleared.error) throw new Error(cleared.error.message);
    state.active_award_id = null;
  }

  if (selectedEmployeeId && !state.active_award_id) {
    const isAdjustment = params.adjustmentBusinessDate !== params.originalBusinessDate || Boolean(old);
    const award = await insertAward(params.admin, {
      tenant_id: params.tenantId,
      branch_id: params.branchId,
      business_date: isAdjustment ? params.adjustmentBusinessDate : params.originalBusinessDate,
      employee_id: selectedEmployeeId,
      quantity: 1,
      reason: isAdjustment
        ? `退單重算補發｜${params.originalBusinessDate} 每日數字最高 ${top.amount}`
        : `每日數字最高｜分配前實收 ${top.amount}`,
      status: status === "assistant_selected" ? "assistant_proposed" : "manager_approved",
      proposed_by: state.decision_by || params.actorId,
      reviewed_by: status === "manager_selected" ? state.decision_by || params.actorId : null,
      reviewed_at: status === "manager_selected" ? new Date().toISOString() : null,
      award_type: isAdjustment ? "reassignment" : "daily_top",
      rule_key: `daily-top-award:${params.originalBusinessDate}:${selectedEmployeeId}:${sourceFingerprint}`,
      calculation: {
        ruleVersion: STAFF_EPO_RULE_VERSION,
        originalBusinessDate: params.originalBusinessDate,
        adjustmentBusinessDate: params.adjustmentBusinessDate,
        preAllocationReceivedAmount: top.amount,
        candidateEmployeeIds: candidates,
        sourceFingerprint,
      },
    });
    const linked = await params.admin.from("staff_epo_daily_top_states").update({ active_award_id: award.id }).eq("id", state.id);
    if (linked.error) throw new Error(linked.error.message);
    state.active_award_id = award.id;
  }
  return { ...state, totals: top.totals };
}

async function ensureSessionLoadAwards(params: {
  admin: QueryClient;
  tenantId: string;
  businessDate: string;
  actorId: string;
}) {
  const [employmentResult, scheduleResult, bookingResult] = await Promise.all([
    params.admin.from("staff_employment_profiles").select("employee_id, employment_type")
      .eq("tenant_id", params.tenantId).eq("work_group", "coach"),
    params.admin.from("staff_schedule_entries").select("employee_id, starts_at, ends_at, crosses_midnight, entry_kind, staff_schedule_versions!inner(status)")
      .eq("tenant_id", params.tenantId).eq("work_date", params.businessDate)
      .eq("entry_kind", "work").eq("staff_schedule_versions.status", "published"),
    params.admin.from("bookings").select("id, coach_id, starts_at, ends_at")
      .eq("tenant_id", params.tenantId).eq("is_bige_schedule", true)
      .eq("operation_kind", "pt").eq("status", "completed")
      .gte("starts_at", `${params.businessDate}T00:00:00+08:00`).lte("starts_at", `${params.businessDate}T23:59:59.999+08:00`),
  ]);
  if (employmentResult.error || scheduleResult.error || bookingResult.error) {
    throw new Error(employmentResult.error?.message || scheduleResult.error?.message || bookingResult.error?.message || "堂數 EPO 資料讀取失敗");
  }
  const schedules = new Map((scheduleResult.data || []).map((row: any) => [String(row.employee_id), row]));
  const evidence: any[] = [];
  for (const employment of employmentResult.data || []) {
    const employeeId = String(employment.employee_id);
    const schedule: any = schedules.get(employeeId);
    const sessions = (bookingResult.data || []).filter((row: any) => String(row.coach_id || "") === employeeId)
      .map((row: any) => ({ startsAt: String(row.starts_at), endsAt: String(row.ends_at) }));
    const classified = classifyCompletedSessionsAgainstShift({
      shiftStartsAt: schedule?.starts_at || null,
      shiftEndsAt: schedule?.ends_at || null,
      crossesMidnight: Boolean(schedule?.crosses_midnight),
      sessions,
    });
    const employmentType = employment.employment_type === "part_time" ? "part_time" as const : "full_time" as const;
    const rule = sessionLoadEpoRule({ employmentType, insideSessions: classified.inside, outsideSessions: classified.outside });
    const item = { employeeId, employmentType, scheduleReady: classified.ready, ...classified, ...rule };
    evidence.push(item);
    const ruleKey = `session-load:${params.businessDate}:${employeeId}`;
    const existing = await findAward(params.admin, params.tenantId, ruleKey);
    if (!classified.ready || !rule.eligible) {
      if (existing && existing.status !== "daily_confirmed" && existing.status !== "cancelled") {
        const cancelled = await params.admin.from("staff_epo_awards").update({
          status: "cancelled",
          review_note: "課程狀態或班表變更後已不符合堂數 EPO",
        }).eq("id", existing.id).neq("status", "daily_confirmed");
        if (cancelled.error) throw new Error(cancelled.error.message);
      }
      continue;
    }
    const awardValues = {
      tenant_id: params.tenantId,
      business_date: params.businessDate,
      employee_id: employeeId,
      quantity: 1,
      reason: `堂數達標｜${rule.label}`,
      status: "manager_approved",
      proposed_by: params.actorId,
      award_type: "session_load",
      rule_key: ruleKey,
      calculation: {
        ruleVersion: STAFF_EPO_RULE_VERSION,
        employmentType,
        shiftStartsAt: schedule.starts_at,
        shiftEndsAt: schedule.ends_at,
        insideSessions: classified.inside,
        outsideSessions: classified.outside,
        boundarySessions: classified.boundary,
        requiredInside: rule.requiredInside,
        requiredOutside: rule.requiredOutside,
      },
    };
    if (existing?.status === "cancelled") {
      const reactivated = await params.admin.from("staff_epo_awards").update({
        ...awardValues,
        status: "manager_approved",
        reviewed_by: null,
        reviewed_at: null,
        review_note: "課程狀態更新後重新符合堂數 EPO",
        daily_report_id: null,
      }).eq("id", existing.id).eq("status", "cancelled");
      if (reactivated.error) throw new Error(reactivated.error.message);
    } else {
      await insertAward(params.admin, awardValues);
    }
  }
  return evidence;
}

export async function syncAutomaticEpoForDate(params: {
  admin: QueryClient;
  tenantId: string;
  branchId: string | null;
  businessDate: string;
  actorId: string;
}) {
  const eventResult = await params.admin.from("staff_sales_events").select("*")
    .eq("tenant_id", params.tenantId).eq("business_date", params.businessDate);
  if (eventResult.error) throw new Error(eventResult.error.message);
  const events = eventResult.data || [];
  await ensureThresholdAwards({ ...params, events });
  const dailyTopStates = [await reconcileDailyTop({
    ...params,
    originalBusinessDate: params.businessDate,
    adjustmentBusinessDate: params.businessDate,
  })];
  for (const refundEvent of events.filter((event: any) => event.source_type === "refund")) {
    const sourceKey = String(refundEvent.metadata?.originalSourceKey || `bige-payment:${refundEvent.source_id}`);
    const originalResult = await params.admin.from("staff_sales_events").select("business_date")
      .eq("tenant_id", params.tenantId).eq("source_key", sourceKey).maybeSingle();
    if (originalResult.error) throw new Error(originalResult.error.message);
    const originalDate = originalResult.data?.business_date ? String(originalResult.data.business_date) : null;
    if (!originalDate || originalDate === params.businessDate) continue;
    dailyTopStates.push(await reconcileDailyTop({
      ...params,
      originalBusinessDate: originalDate,
      adjustmentBusinessDate: params.businessDate,
    }));
  }
  const sessionEvidence = await ensureSessionLoadAwards(params);
  return { dailyTopStates, sessionEvidence };
}
