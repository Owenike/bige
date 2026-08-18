import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, apiSuccess, requireProfile, type ProfileContext } from "../../../lib/auth-context";
import { applyStoredCoachOrder, hasExactCoachSet } from "../../../lib/bige-coach-order";
import {
  collectCoachDayStatuses,
  readCoachDayStatusMarker,
} from "../../../lib/bige-coach-day-status";
import { loadBigeBusinessDaySetting } from "../../../lib/bige-business-day";
import {
  canCancelBigeCourseAnytime,
  getBigeCourseStatusWindow,
  isBigeCourseStatusWindowExempt,
} from "../../../lib/bige-course-status-window";
import {
  BIGE_COURSE_LABELS,
  BIGE_COMPLETED_BOOKING_EDIT_MESSAGE,
  BIGE_MANAGER_ROLES,
  BIGE_SCHEDULE_NOTE_UNDO_WINDOW_MS,
  bigeFitnessActionSchema,
  buildBigeMemberPaymentDetailMap,
  canEditBigeScheduleBooking,
  calculateContractTerms,
  calculateLegacyContractExpiryDate,
  calculateMinimumDeposit,
  flattenBigeMemberPaymentRelations,
  getBigeTrialContractMissingProfileFields,
  getZodMessage,
  isBigeAssistantToContent,
  isBigeContractPaymentAmountAllowed,
  isBigeScheduleNoteUndoAvailable,
  normalizeBigeScheduleEndAt,
  resolveBigeTrialContractIdentity,
  toTaipeiDateString,
  validateCourseAllocationTotal,
} from "../../../lib/bige-fitness";
import { sendNotification } from "../../../lib/integrations/notify";
import { insertDeliveryRows } from "../../../lib/notification-ops";
import {
  createInAppNotifications,
  notifyHighRiskRequestCreated,
} from "../../../lib/in-app-notifications";
import { canCreateBigeContract } from "../../../lib/staff-credentials";
import {
  canDirectlyApproveBigeContractRisk,
  canManageBigeCourseAllocations,
  canManageBigePlansAndDailyReports,
  canRecordBigeContractPayment,
  canViewAllCoachSchedules,
  isBigeContractRiskRequester,
} from "../../../lib/staff-organization";
import {
  canCompleteBigeTrialOutcome,
  canManageBigeSchedule,
  canReorderBigeScheduleCoaches,
  canViewBigeScheduleActivity,
} from "../../../lib/bige-schedule-permissions";
import {
  BIGE_SCHEDULE_TRASH_DELETE_REASON,
  findScheduleEditConflict,
  isScheduleBookingDraggable,
  isScheduleTrashDeletedBooking,
} from "../../../lib/bige-schedule-drag";
import {
  findBigeScheduleBatchConflict,
  type BigeScheduleBatchBookingCandidate,
  type BigeScheduleBatchNoteCandidate,
} from "../../../lib/bige-schedule-batch";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { buildBigeClassroomConflicts } from "../../../lib/bige-classroom-conflicts";
import { resolveBigeMemberSearchRule } from "../../../lib/bige-member-search";

export const dynamic = "force-dynamic";

type AuthContext = Awaited<ReturnType<typeof requireProfile>> extends infer Result
  ? Result extends { ok: true; context: infer Context; supabase: infer Supabase }
    ? { context: Context; supabase: Supabase }
    : never
  : never;

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "booked", "checked_in"];

type ScheduleBatchPreviewConflict = {
  startsAt: string;
  endsAt: string;
  kind:
    | "coach_booking"
    | "coach_note"
    | "member_booking"
    | "closed_day"
    | "outside_hours";
  message: string;
  conflictStartsAt?: string;
  conflictEndsAt?: string;
  conflictMemberId?: string | null;
  conflictMemberName?: string | null;
  conflictCoachId?: string | null;
  conflictCoachName?: string | null;
  conflictCourseType?: string | null;
  conflictServiceName?: string | null;
  conflictNote?: string | null;
};
// Preserve the legacy auth-linked placeholder row, but never surface it as a
// selectable member in fitness operations or contract search.
const LEGACY_MEMBER_PLACEHOLDER_ID = "790c2825-40fb-4e42-b6b0-a5a4a04c7c71";
function isManager(
  context: Pick<ProfileContext, "role" | "department" | "position">,
) {
  if (context.role === "platform_admin") return true;
  if (context.department || context.position) {
    return (
      context.department === "coaching" &&
      (context.position === "coach_manager" || context.position === "coach_city_manager")
    );
  }
  return (BIGE_MANAGER_ROLES as readonly string[]).includes(context.role);
}

function canSeeTrialRevenue(
  context: Pick<ProfileContext, "role" | "department" | "position">,
) {
  if (
    context.department === "coaching" &&
    (context.position === "coach_assistant_manager" ||
      context.position === "coach_manager" ||
      context.position === "coach_city_manager")
  ) {
    return true;
  }
  return (
    !context.department &&
    !context.position &&
    (context.role === "manager" || context.role === "branch_manager")
  );
}

function faFeeRecipientLabel(profile: {
  english_name?: string | null;
  display_name?: string | null;
  employee_number?: string | null;
}) {
  const employeeNumber = profile.employee_number?.trim() || "";
  const name =
    profile.english_name?.trim() ||
    profile.display_name?.trim() ||
    employeeNumber;
  if (!name) return "";
  return employeeNumber && name !== employeeNumber ? `${name}｜${employeeNumber}` : name;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function taipeiRange(date: string) {
  return {
    start: `${date}T00:00:00+08:00`,
    end: `${addDays(date, 1)}T00:00:00+08:00`,
  };
}

function taipeiHourRange(value: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const offsetMs = 8 * 60 * 60 * 1000;
  const taipei = new Date(instant.getTime() + offsetMs);
  taipei.setUTCMinutes(0, 0, 0);
  const start = new Date(taipei.getTime() - offsetMs);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
  };
}

function timeRangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string,
) {
  const firstStartAt = new Date(firstStart).getTime();
  const firstEndAt = new Date(firstEnd).getTime();
  const secondStartAt = new Date(secondStart).getTime();
  const secondEndAt = new Date(secondEnd).getTime();
  return firstStartAt < secondEndAt && secondStartAt < firstEndAt;
}

function taipeiDateTimeParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    year,
    month,
    day,
    hour: get("hour"),
    minute: get("minute"),
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function isValidScheduleWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return false;
  const localStart = taipeiDateTimeParts(startsAt);
  const localEnd = taipeiDateTimeParts(endsAt);
  const nextDate = new Date(Date.UTC(localStart.year, localStart.month - 1, localStart.day + 1))
    .toISOString()
    .slice(0, 10);
  const validMinute = (minute: number) => minute === 0 || minute === 30;
  const endInsideDay =
    localEnd.date === localStart.date ||
    (localEnd.date === nextDate && localEnd.hour === 0 && localEnd.minute === 0);
  return (
    localStart.hour >= 9 &&
    localStart.hour <= 23 &&
    validMinute(localStart.minute) &&
    validMinute(localEnd.minute) &&
    start.getUTCSeconds() === 0 &&
    end.getUTCSeconds() === 0 &&
    endInsideDay
  );
}

async function ensureScheduleDateOpen(tenantId: string, timestamp: string) {
  const businessDate = taipeiDateTimeParts(timestamp).date;
  const setting = await loadBigeBusinessDaySetting({ tenantId, businessDate });
  return {
    open: !setting?.is_closed,
    setting,
    businessDate,
  };
}

async function loadScheduleEditConflict(params: {
  supabase: AuthContext["supabase"];
  tenantId: string;
  coachId: string;
  startsAt: string;
  endsAt: string;
  excludeBookingId?: string;
  excludeNoteId?: string;
}) {
  let bookingsQuery = params.supabase
    .from("bookings")
    .select("id, member_id, coach_id, starts_at, ends_at, status, course_type")
    .eq("tenant_id", params.tenantId)
    .eq("coach_id", params.coachId)
    .eq("is_bige_schedule", true)
    .in("status", ACTIVE_BOOKING_STATUSES)
    .lt("starts_at", params.endsAt)
    .gt("ends_at", params.startsAt);
  if (params.excludeBookingId) {
    bookingsQuery = bookingsQuery.neq("id", params.excludeBookingId);
  }

  let notesQuery = params.supabase
    .from("bige_schedule_notes")
    .select("id, coach_id, starts_at, ends_at, content")
    .eq("tenant_id", params.tenantId)
    .eq("coach_id", params.coachId)
    .lt("starts_at", params.endsAt)
    .gt("ends_at", params.startsAt);
  if (params.excludeNoteId) {
    notesQuery = notesQuery.neq("id", params.excludeNoteId);
  }

  const [bookingsResult, notesResult] = await Promise.all([bookingsQuery, notesQuery]);
  const error = bookingsResult.error || notesResult.error;
  if (error) return { error, conflict: null };

  return {
    error: null,
    conflict: findScheduleEditConflict({
      bookings: bookingsResult.data || [],
      notes: notesResult.data || [],
      coachId: params.coachId,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      excludeBookingId: params.excludeBookingId,
      excludeNoteId: params.excludeNoteId,
    }),
  };
}

function scheduleEditConflictMessage(conflict: NonNullable<Awaited<ReturnType<typeof loadScheduleEditConflict>>["conflict"]>) {
  const time = taipeiDateTimeParts(conflict.item.starts_at);
  const timeLabel = `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
  return conflict.kind === "booking"
    ? `調整後會與 ${timeLabel} 的既有課程重疊，請先取消該課程，再進行操作。`
    : `調整後會與 ${timeLabel}「${conflict.item.content}」的排課資料重疊，請先刪除或調整該筆資料，再進行操作。`;
}

function normalizeErrorMessage(message: string) {
  const key = message.split("\n")[0]?.trim() || message;
  if (
    key.includes("bookings_coach_occupancy_excl") ||
    key.includes("conflicting key value violates exclusion constraint")
  ) {
    return "教練在這個時段已有其他預約，請重新整理課表後再試一次";
  }
  const messages: Record<string, string> = {
    forbidden: "您沒有此操作權限",
    invalid_time_range: "結束時間必須晚於開始時間",
    outside_business_hours: "排課時間必須介於 09:00 到 24:00，並使用整點或 30 分",
    schedule_cell_occupied: "這個時段格已有資料，請直接編輯原資料",
    schedule_time_overlap: "調整後的時段已有其他課程，請先取消或調整衝突資料，再進行操作",
    invalid_schedule_move_mode: "無效的課表拖拉方式",
    schedule_drag_forbidden: "您的帳號沒有拖拉課表的權限",
    schedule_booking_not_found: "找不到要移動的課程",
    schedule_target_coach_not_found: "找不到目標教練",
    schedule_booking_locked: "交換範圍含有已完成、已取消、已報到或已核銷的課程，無法拖拉",
    schedule_booking_redeemed: "這堂課已核銷，不能拖拉",
    schedule_move_same_slot: "課程已經在這個時段",
    schedule_move_same_day_only: "目前只支援同一天內拖拉",
    schedule_move_alignment_mismatch: "整點課程只能移到整點，半點課程只能移到半點",
    schedule_move_outside_day: "拖拉後的課程會超出當天 09:00–24:00 的課表範圍",
    schedule_note_not_draggable: "原時段或目標時段已有自由文字，請先處理該筆資料再移動課程",
    schedule_move_conflict: "目標時段仍有其他資料，請重新整理課表後再試一次",
    schedule_move_target_empty: "目標時段已變成空白，請重新確認後再拖拉",
    schedule_move_internal_conflict: "交換後的課程時段會互相重疊，無法完成拖拉",
    schedule_move_undo_forbidden: "您的帳號沒有復原課表移動的權限",
    schedule_move_undo_not_found: "找不到可復原的課表移動紀錄",
    schedule_move_already_undone: "這次課表移動已經復原",
    schedule_move_undo_expired: "復原時間已超過 10 秒",
    schedule_move_undo_snapshot_invalid: "課表移動紀錄不完整，無法自動復原",
    schedule_move_undo_conflict: "課表已被再次修改，無法復原這次移動",
    coach_capacity_exceeded: "這位教練在同一時段只能帶 1 位學員",
    group_course_type_mismatch: "這位教練在同一時段已有其他課程",
    shared_equipment_capacity_exceeded: "放鬆／器械皮拉提斯教室時段重疊，請確認教室安排",
    member_time_conflict: "這位學員在同一時段已有安排",
    active_trial_required: "已取消或未出席的 FA 無法成交",
    trial_already_converted: "這筆 FA 已經完成成交",
    existing_member_requires_selection: "資料符合現有會員，請先選擇該會員",
    fitness_plan_not_found: "找不到可用的正式課程方案",
    fitness_plan_invalid: "方案的價格、堂數或課別分配不完整",
    fa_initial_payment_required: "FA 成交必須付款，且不得低於此方案一堂課的金額",
    minimum_deposit_not_met: "首次付款不得低於此方案一堂課的金額",
    payment_amount_invalid: "付款金額不可小於 0",
    payment_amount_exceeds_contract_balance: "付款金額不能超過合約尚有尾款",
    payment_schedule_total_mismatch: "付款排程加總必須等於合約總價",
    invalid_payment_method: "付款方式無效，請重新選擇後再試一次",
    payment_method_invalid: "付款方式無效，請重新選擇後再試一次",
    invalid_installment_count: "綠界分期期數必須是 2 至 60 期",
    installment_count_not_allowed: "只有綠界分期可以填寫分期期數",
    payment_reversal_reason_required: "退款或作廢必須填寫原因",
    outside_completion_window: "只能在預約前 30 分鐘至結束後 30 分鐘內操作",
    completion_restore_not_available: "這堂課目前不是已完成狀態，無法復原",
    cancellation_restore_not_available: "這堂課目前不是已取消狀態，無法復原",
    no_show_restore_not_available: "這堂課目前不是未出席狀態，無法復原",
    completion_redemption_not_found: "找不到這堂課的扣堂紀錄，請聯絡管理員",
    completed_booking_restore_required: BIGE_COMPLETED_BOOKING_EDIT_MESSAGE,
    eligible_contract_not_found: "找不到可扣堂且課別相符的合約",
    unlocked_sessions_exhausted: "目前已付款金額沒有可用堂數",
    course_allocation_exhausted: "這個課別的堂數已用完",
    course_allocations_invalid: "專項堂數格式不正確",
    course_allocation_total_mismatch: "各專項分配加總必須等於合約總堂數",
    course_allocation_below_used: "專項分配堂數不能低於已使用堂數",
    contract_course_allocation_not_available: "這份合約目前不能設定專項堂數",
    contract_extension_required: "合約期限已到，需由主管完成延期與學員簽名",
    extension_window_not_open: "到期前 30 天才可辦理延期",
    extension_limit_exceeded: "延期天數超過此合約可延期上限",
    no_remaining_sessions_to_extend: "此合約沒有可延期的剩餘堂數",
    manager_required: "此操作僅限主管",
    email_or_unavailable_required: "請填寫有效 Email，或明確勾選沒有 Email",
    invalid_trial_conversion_outcome: "無效的 FA 成交結果",
    trial_booking_not_found: "找不到這筆 FA 預約",
    fa_fee_recipient_invalid: "請選擇或輸入 1 至 80 字的 FA 收款人",
    fa_fee_recipient_profile_invalid: "所選員工已停用或不屬於目前場館，請重新選擇",
    fa_fee_recipient_not_allowed: "這個操作不能記錄 FA 收款人",
    fa_conversion_not_found: "這筆 FA 目前沒有可操作的成交紀錄",
    fa_conversion_contract_not_editable: "這筆 FA 的合約目前不能變更",
    fa_conversion_payment_amount_invalid: "成交金額必須大於 0，且不能超過合約總額",
    fa_conversion_initial_payment_not_editable: "找不到可變更的首次付款，或該付款已退款／作廢",
    fa_conversion_payment_below_used_sessions: "變更後的付款金額不足以涵蓋已使用堂數",
    fa_conversion_restore_not_available: "這筆 FA 的成交目前不能復原",
    fa_conversion_has_used_sessions: "此合約已有使用堂數，不能直接復原成交",
    fa_conversion_has_linked_bookings: "此合約已有其他連結課程，請先處理後再復原",
    fa_conversion_has_redemptions: "此合約已有扣堂紀錄，不能直接復原成交",
    fa_conversion_has_extensions: "此合約已有展延紀錄，不能直接復原成交",
    fa_conversion_has_additional_payments: "此合約已有後續付款，請先處理後再復原",
    invalid_contract_plan_mode: "請選擇內建方案或自訂方案",
    custom_plan_invalid: "自訂方案的價格、堂數、有效期限或課別分配不完整",
    sales_origin_kind_invalid: "成交來源類型不正確",
    sales_origin_coach_invalid: "原成交教練已停用或不屬於目前場館",
    contract_sales_origin_update_failed: "合約已建立但成交教練快照失敗，請重新操作",
  };
  return messages[key] || key;
}

function handleDatabaseError(error: { message: string } | null, fallback: string) {
  return apiError(400, "FORBIDDEN", normalizeErrorMessage(error?.message || fallback));
}

async function resolveAuth(request: Request) {
  const auth = await requireProfile(
    ["platform_admin", "manager", "frontdesk", "coach"],
    request,
  );
  if (!auth.ok) return auth;
  if (!auth.context.tenantId && auth.context.role !== "platform_admin") {
    return {
      ok: false as const,
      response: apiError(403, "FORBIDDEN", "找不到所屬場館"),
    };
  }
  return auth;
}

async function buildDailySnapshot(
  auth: AuthContext,
  tenantId: string,
  businessDate: string,
  branchId: string | null,
) {
  const range = taipeiRange(businessDate);
  let query = auth.supabase
    .from("bookings")
    .select("id, operation_kind, course_type, status, operation_result, starts_at, member_id, coach_id")
    .eq("tenant_id", tenantId)
    .eq("is_bige_schedule", true)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end);
  query = branchId ? query.eq("branch_id", branchId) : query;
  const result = await query;
  if (result.error) throw new Error(result.error.message);

  const rows = result.data || [];
  return {
    businessDate,
    generatedAt: new Date().toISOString(),
    total: rows.length,
    completed: rows.filter((row: any) => row.status === "completed").length,
    cancelled: rows.filter((row: any) => row.status === "cancelled").length,
    noShow: rows.filter((row: any) => row.status === "no_show").length,
    pending: rows.filter((row: any) => ACTIVE_BOOKING_STATUSES.includes(row.status)).length,
    trialCompleted: rows.filter(
      (row: any) => row.operation_kind === "trial" && row.status === "completed",
    ).length,
    ptCompleted: rows.filter(
      (row: any) => row.operation_kind === "pt" && row.status === "completed",
    ).length,
  };
}

async function loadLegacyPurchaseDateReminders(
  supabase: AuthContext["supabase"],
  tenantId: string,
  businessDate: string,
  branchId: string | null,
) {
  const range = taipeiRange(businessDate);
  let bookingQuery = supabase
    .from("bookings")
    .select("member_id, starts_at")
    .eq("tenant_id", tenantId)
    .eq("is_bige_schedule", true)
    .eq("operation_kind", "pt")
    .eq("status", "completed")
    .gte("starts_at", range.start)
    .lt("starts_at", range.end);
  if (branchId) bookingQuery = bookingQuery.eq("branch_id", branchId);
  const bookingsResult = await bookingQuery;
  if (bookingsResult.error) throw new Error(bookingsResult.error.message);

  const firstClassByMember = new Map<string, string>();
  for (const booking of bookingsResult.data || []) {
    const memberId = String(booking.member_id || "");
    if (!memberId) continue;
    const startsAt = String(booking.starts_at || "");
    const current = firstClassByMember.get(memberId);
    if (!current || startsAt < current) firstClassByMember.set(memberId, startsAt);
  }
  const memberIds = [...firstClassByMember.keys()];
  if (memberIds.length === 0) return [];

  const sharedMembersResult = await supabase
    .from("member_plan_contract_members")
    .select("contract_id, member_id")
    .eq("tenant_id", tenantId)
    .in("member_id", memberIds);
  if (sharedMembersResult.error) throw new Error(sharedMembersResult.error.message);
  const sharedContractIds = [
    ...new Set((sharedMembersResult.data || []).map((row: any) => String(row.contract_id))),
  ];
  const directMemberFilter = `member_id.in.(${memberIds.join(",")})`;
  const contractFilter = sharedContractIds.length
    ? `${directMemberFilter},id.in.(${sharedContractIds.join(",")})`
    : directMemberFilter;

  const [contractsResult, membersResult] = await Promise.all([
    supabase
      .from("member_plan_contracts")
      .select(
        "id, member_id, contract_number, total_sessions, remaining_sessions, signed_on, ends_at, status, is_legacy_import",
      )
      .eq("tenant_id", tenantId)
      .eq("is_legacy_import", true)
      .is("signed_on", null)
      .neq("status", "canceled")
      .or(contractFilter)
      .order("created_at", { ascending: true }),
    supabase
      .from("members")
      .select("id, full_name, member_code")
      .eq("tenant_id", tenantId)
      .in("id", memberIds),
  ]);
  if (contractsResult.error) throw new Error(contractsResult.error.message);
  if (membersResult.error) throw new Error(membersResult.error.message);

  const members = await attachLegacyNumbers(tenantId, membersResult.data || []);
  const memberMap = new Map(members.map((member) => [String(member.id), member]));
  const sharedAttendeeByContract = new Map<string, string>();
  for (const row of sharedMembersResult.data || []) {
    const memberId = String(row.member_id);
    if (!firstClassByMember.has(memberId)) continue;
    const contractId = String(row.contract_id);
    if (!sharedAttendeeByContract.has(contractId)) {
      sharedAttendeeByContract.set(contractId, memberId);
    }
  }
  return (contractsResult.data || []).map((contract: any) => {
    const directMemberId = String(contract.member_id);
    const attendanceMemberId = firstClassByMember.has(directMemberId)
      ? directMemberId
      : sharedAttendeeByContract.get(String(contract.id)) || directMemberId;
    const member = memberMap.get(attendanceMemberId);
    return {
      ...contract,
      member_name: member?.full_name || "未命名會員",
      member_code: member?.member_code || null,
      legacy_numbers: member?.legacy_numbers || [],
      first_class_at: firstClassByMember.get(attendanceMemberId) || null,
    };
  });
}

async function attachLegacyNumbers(tenantId: string, members: any[]) {
  if (members.length === 0) return members;
  const admin = createSupabaseAdminClient();
  const memberIds = [...new Set(members.map((member) => member.id).filter(Boolean))];
  const legacyResult = await admin
    .from("bige_member_legacy_numbers")
    .select("member_id, legacy_number")
    .eq("tenant_id", tenantId)
    .in("member_id", memberIds);
  if (legacyResult.error) throw legacyResult.error;

  const legacyRows = legacyResult.data || [];
  const legacyNumbers = [...new Set(legacyRows.map((row) => row.legacy_number))];
  const sharedCounts = new Map<string, number>();
  if (legacyNumbers.length > 0) {
    const sharedResult = await admin
      .from("bige_member_legacy_numbers")
      .select("member_id, legacy_number")
      .eq("tenant_id", tenantId)
      .in("legacy_number", legacyNumbers);
    if (sharedResult.error) throw sharedResult.error;
    const sharedMembers = new Map<string, Set<string>>();
    for (const row of sharedResult.data || []) {
      const values = sharedMembers.get(row.legacy_number) || new Set<string>();
      values.add(row.member_id);
      sharedMembers.set(row.legacy_number, values);
    }
    for (const [legacyNumber, values] of sharedMembers) {
      sharedCounts.set(legacyNumber, values.size);
    }
  }

  const byMember = new Map<string, string[]>();
  for (const row of legacyRows) {
    const values = byMember.get(row.member_id) || [];
    values.push(row.legacy_number);
    byMember.set(row.member_id, values);
  }
  return members.map((member) => {
    const values = byMember.get(member.id) || [];
    return {
      ...member,
      legacy_numbers: values,
      legacy_shared: values.some((value) => (sharedCounts.get(value) || 0) > 1),
    };
  });
}

async function attachSharedContracts(tenantId: string, members: any[]) {
  if (members.length === 0) return members;
  const admin = createSupabaseAdminClient();
  const memberIds = [...new Set(members.map((member) => String(member.id)).filter(Boolean))];
  const membershipsResult = await admin
    .from("member_plan_contract_members")
    .select("contract_id, member_id")
    .eq("tenant_id", tenantId)
    .in("member_id", memberIds);
  if (membershipsResult.error) throw membershipsResult.error;
  const contractIds = [
    ...new Set((membershipsResult.data || []).map((row) => String(row.contract_id))),
  ];
  if (contractIds.length === 0) return members;

  const contractsResult = await admin
    .from("member_plan_contracts")
    .select(`
      id,
      created_at,
      contract_number,
      plan_catalog_id,
      status,
      payment_status,
      signed_on,
      is_legacy_import,
      purchase_date_recorded_at,
      starts_at,
      ends_at,
      total_sessions,
      total_amount,
      unlocked_sessions,
      used_sessions,
      remaining_sessions,
      course_allocations,
      course_used,
      course_allocations_configured_at,
      extension_limit_days,
      extension_used_days,
      original_ends_at,
      payments:bige_contract_payments!bige_contract_payments_contract_id_fkey(
        id,
        contract_id,
        payment_kind,
        amount,
        method,
        installment_count,
        status,
        paid_at,
        note
      )
    `)
    .eq("tenant_id", tenantId)
    .in("id", contractIds)
    .not("total_sessions", "is", null)
    .order("created_at", { ascending: false });
  if (contractsResult.error) throw contractsResult.error;
  const contractMap = new Map(
    (contractsResult.data || []).map((contract) => [String(contract.id), contract]),
  );
  const contractIdsByMember = new Map<string, string[]>();
  for (const membership of membershipsResult.data || []) {
    const values = contractIdsByMember.get(String(membership.member_id)) || [];
    values.push(String(membership.contract_id));
    contractIdsByMember.set(String(membership.member_id), values);
  }

  return members.map((member) => {
    const existingContracts = [...(member.contracts || [])];
    const existingIds = new Set(existingContracts.map((contract: any) => String(contract.id)));
    for (const contractId of contractIdsByMember.get(String(member.id)) || []) {
      const contract = contractMap.get(contractId);
      if (contract && !existingIds.has(contractId)) existingContracts.push(contract);
    }
    return { ...member, contracts: existingContracts };
  });
}

async function attachScheduleMemberRelationships(tenantId: string, members: any[]) {
  if (members.length === 0) return members;
  const [membersWithLegacyNumbers, membersWithSharedContracts] = await Promise.all([
    attachLegacyNumbers(tenantId, members),
    attachSharedContracts(tenantId, members),
  ]);
  const sharedContractsByMemberId = new Map(
    membersWithSharedContracts.map((member) => [String(member.id), member.contracts || []]),
  );
  return membersWithLegacyNumbers.map((member) => ({
    ...member,
    contracts:
      sharedContractsByMemberId.get(String(member.id)) || member.contracts || [],
  }));
}

export async function GET(request: Request) {
  const requestStartedAt = performance.now();
  const auth = await resolveAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const businessDate = url.searchParams.get("date") || toTaipeiDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return apiError(400, "FORBIDDEN", "日期格式錯誤");
  }

  const requestedTenantId = url.searchParams.get("tenantId");
  const tenantId =
    auth.context.role === "platform_admin" ? requestedTenantId || auth.context.tenantId : auth.context.tenantId;
  if (!tenantId) return apiError(400, "FORBIDDEN", "tenantId is required");

  const hasAllCoachScheduleAccess = canViewAllCoachSchedules({
    role: auth.context.role,
    department: auth.context.department ?? null,
    position: auth.context.position ?? null,
    branchId: auth.context.branchId,
  });
  const requestedBranchId = url.searchParams.get("branchId");
  const branchId = hasAllCoachScheduleAccess
    ? requestedBranchId
    : requestedBranchId || auth.context.branchId;
  if (url.searchParams.get("faFeeRecipients") === "1") {
    const recipientsResult = await auth.supabase
      .from("profiles")
      .select("id, branch_id, display_name, english_name, employee_number")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("employee_number", { ascending: true, nullsFirst: false })
      .limit(500);
    if (recipientsResult.error) {
      return apiError(500, "INTERNAL_ERROR", recipientsResult.error.message);
    }
    return apiSuccess({
      options: (recipientsResult.data || [])
        .map((profile: {
          id: string;
          branch_id: string | null;
          display_name: string | null;
          english_name: string | null;
          employee_number: string | null;
        }) => ({
          id: String(profile.id),
          label: faFeeRecipientLabel(profile),
          employeeNumber: profile.employee_number || null,
          branchId: profile.branch_id || null,
        }))
        .filter((profile: { label: string }) => profile.label),
    });
  }
  const search = (url.searchParams.get("search") || "").trim().slice(0, 60);
  const formalMembersOnly = url.searchParams.get("memberScope") === "formal";
  if (search) {
    const searchRule = resolveBigeMemberSearchRule(search);
    let legacyMemberIds: string[] = [];
    if (searchRule.mode === "legacy_number") {
      const legacyResult = await auth.supabase
        .from("bige_member_legacy_numbers")
        .select("member_id")
        .eq("tenant_id", tenantId)
        .eq("legacy_number", searchRule.legacyNumber)
        .limit(20);
      if (legacyResult.error) {
        return apiError(500, "INTERNAL_ERROR", legacyResult.error.message);
      }
      legacyMemberIds = [
        ...new Set(
          ((legacyResult.data || []) as Array<{ member_id: string }>).map((row) =>
            String(row.member_id),
          ),
        ),
      ];
    }
    let membersQuery = auth.supabase
      .from("members")
      .select(
        "id, full_name, phone, email, email_unavailable, birth_date, member_code, photo_url, is_prospect",
      )
      .eq("tenant_id", tenantId)
      .neq("id", LEGACY_MEMBER_PLACEHOLDER_ID);
    if (formalMembersOnly) {
      membersQuery = membersQuery.eq("is_prospect", false);
    }
    if (searchRule.mode === "member_number") {
      membersQuery = membersQuery.eq("member_code", searchRule.memberCode);
    } else if (searchRule.mode === "legacy_number") {
      membersQuery = membersQuery.in(
        "id",
        legacyMemberIds.length ? legacyMemberIds : [LEGACY_MEMBER_PLACEHOLDER_ID],
      );
    } else if (searchRule.mode === "phone") {
      membersQuery = membersQuery.in("phone", searchRule.phoneVariants);
    } else {
      const escapedName = searchRule.name
        .replace(/[%_]/g, (value) => `\\${value}`)
        .replace(/[(),]/g, " ");
      membersQuery = membersQuery.ilike("full_name", `%${escapedName}%`);
    }
    const membersResult = await membersQuery
      .order("updated_at", { ascending: false })
      .limit(20);
    if (membersResult.error) return apiError(500, "INTERNAL_ERROR", membersResult.error.message);

    const matchingMembers = membersResult.data || [];
    let membersWithLegacy: any[];
    try {
      membersWithLegacy = await attachLegacyNumbers(tenantId, matchingMembers);
    } catch (caught) {
      return apiError(
        500,
        "INTERNAL_ERROR",
        caught instanceof Error ? caught.message : "legacy_member_lookup_failed",
      );
    }

    let trials: any[] = [];
    if (
      auth.context.role !== "coach" &&
      (searchRule.mode === "phone" || searchRule.mode === "name")
    ) {
      let trialQuery = auth.supabase
        .from("trial_bookings")
        .select(
          "id, member_id, name, phone, birthday, service, appointment_date, appointment_time, booking_status, note",
        );
      if (searchRule.mode === "phone") {
        trialQuery = trialQuery.in("phone", searchRule.phoneVariants);
      } else {
        const escapedName = searchRule.name
          .replace(/[%_]/g, (value) => `\\${value}`)
          .replace(/[(),]/g, " ");
        trialQuery = trialQuery.ilike("name", `%${escapedName}%`);
      }
      const trialResult = await trialQuery
        .order("created_at", { ascending: false })
        .limit(20);
      if (trialResult.error) return apiError(500, "INTERNAL_ERROR", trialResult.error.message);
      trials = trialResult.data || [];
    }
    return apiSuccess({ members: membersWithLegacy, trials });
  }

  const memberScheduleMemberId = url.searchParams.get("memberScheduleMemberId");
  const memberScheduleMonth = url.searchParams.get("month");
  if (memberScheduleMemberId || memberScheduleMonth) {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    if (
      !memberScheduleMemberId ||
      !memberScheduleMonth ||
      !/^\d{4}-\d{2}$/.test(memberScheduleMonth)
    ) {
      return apiError(400, "FORBIDDEN", "月份或會員資料不完整");
    }
    const [year, month] = memberScheduleMonth.split("-").map(Number);
    const monthStart = `${memberScheduleMonth}-01T00:00:00+08:00`;
    const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
    const monthEnd = `${nextMonth}-01T00:00:00+08:00`;
    const admin = createSupabaseAdminClient();
    const [memberResult, bookingsResult] = await Promise.all([
      admin
        .from("members")
        .select("id, full_name, phone, member_code")
        .eq("tenant_id", tenantId)
        .eq("id", memberScheduleMemberId)
        .maybeSingle(),
      admin
        .from("bookings")
        .select(
          "id, coach_id, service_name, starts_at, ends_at, status, status_reason, operation_kind, course_type, trial_stage, operation_result, note",
        )
        .eq("tenant_id", tenantId)
        .eq("member_id", memberScheduleMemberId)
        .eq("is_bige_schedule", true)
        .gte("starts_at", monthStart)
        .lt("starts_at", monthEnd)
        .order("starts_at", { ascending: true }),
    ]);
    if (memberResult.error || bookingsResult.error) {
      return apiError(
        500,
        "INTERNAL_ERROR",
        memberResult.error?.message || bookingsResult.error?.message || "讀取月排課失敗",
      );
    }
    if (!memberResult.data) return apiError(404, "FORBIDDEN", "找不到會員資料");
    const visibleMonthlyBookings = (bookingsResult.data || []).filter(
      (booking) => !isScheduleTrashDeletedBooking(booking),
    );
    const coachIds = [
      ...new Set(visibleMonthlyBookings.map((row) => row.coach_id).filter(Boolean)),
    ];
    const coachesResult =
      coachIds.length > 0
        ? await admin
            .from("profiles")
            .select("id, display_name, english_name")
            .in("id", coachIds)
        : { data: [], error: null };
    if (coachesResult.error) {
      return apiError(500, "INTERNAL_ERROR", coachesResult.error.message);
    }
    return apiSuccess({
      member: memberResult.data,
      month: memberScheduleMonth,
      bookings: visibleMonthlyBookings,
      coaches: coachesResult.data || [],
    });
  }

  const activityDate = url.searchParams.get("activityDate");
  if (activityDate) {
    if (!canViewBigeScheduleActivity(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號無法查看營運操作紀錄");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) {
      return apiError(400, "FORBIDDEN", "日期格式錯誤");
    }
    const activityRange = taipeiRange(activityDate);
    const admin = createSupabaseAdminClient();
    const [logsResult, loginEventsResult, pageSessionsResult] = await Promise.all([
      admin
        .from("audit_logs")
        .select("id, actor_id, action, target_type, target_id, reason, payload, created_at")
        .eq("tenant_id", tenantId)
        .gte("created_at", activityRange.start)
        .lt("created_at", activityRange.end)
        .or("action.ilike.bige_%,target_type.in.(booking,member_plan_contract,bige_schedule_note)")
        .order("created_at", { ascending: false })
        .limit(1000),
      admin
        .from("staff_login_events")
        .select("id, profile_id, employee_number, event_type, user_agent, created_at")
        .eq("tenant_id", tenantId)
        .gte("created_at", activityRange.start)
        .lt("created_at", activityRange.end)
        .order("created_at", { ascending: false })
        .limit(500),
      admin
        .from("staff_page_sessions")
        .select("id, profile_id, path, started_at, last_seen_at, ended_at, duration_seconds")
        .eq("tenant_id", tenantId)
        .gte("started_at", activityRange.start)
        .lt("started_at", activityRange.end)
        .order("started_at", { ascending: false })
        .limit(1000),
    ]);
    if (logsResult.error || loginEventsResult.error || pageSessionsResult.error) {
      return apiError(
        500,
        "INTERNAL_ERROR",
        logsResult.error?.message ||
          loginEventsResult.error?.message ||
          pageSessionsResult.error?.message ||
          "讀取營運紀錄失敗",
      );
    }
    const actorIds = [
      ...new Set(
        [
          ...(logsResult.data || []).map((row) => row.actor_id),
          ...(loginEventsResult.data || []).map((row) => row.profile_id),
          ...(pageSessionsResult.data || []).map((row) => row.profile_id),
        ].filter(Boolean),
      ),
    ];
    const actorsResult =
      actorIds.length > 0
        ? await admin
            .from("profiles")
            .select("id, display_name, english_name, employee_number, role, position")
            .in("id", actorIds)
        : { data: [], error: null };
    if (actorsResult.error) return apiError(500, "INTERNAL_ERROR", actorsResult.error.message);
    return apiSuccess({
      businessDate: activityDate,
      logs: logsResult.data || [],
      loginEvents: loginEventsResult.data || [],
      pageSessions: pageSessionsResult.data || [],
      actors: actorsResult.data || [],
    });
  }

  const paymentMemberId = url.searchParams.get("paymentMemberId");
  if (paymentMemberId) {
    const detailResult = await auth.supabase
      .from("members")
      .select(`
        id,
        full_name,
        phone,
        email,
        email_unavailable,
        birth_date,
        member_code,
        photo_url,
        is_prospect,
        contracts:member_plan_contracts!member_plan_contracts_member_id_fkey(
          id,
          created_at,
          contract_number,
          plan_catalog_id,
          status,
          payment_status,
          signed_on,
          is_legacy_import,
          purchase_date_recorded_at,
          starts_at,
          ends_at,
          total_sessions,
          total_amount,
          unlocked_sessions,
          used_sessions,
          remaining_sessions,
          course_allocations,
          course_used,
          course_allocations_configured_at,
          extension_limit_days,
          extension_used_days,
          original_ends_at,
          payments:bige_contract_payments!bige_contract_payments_contract_id_fkey(
            id,
            contract_id,
            payment_kind,
            amount,
            method,
            installment_count,
            status,
            paid_at,
            note
          )
        )
      `)
      .eq("tenant_id", tenantId)
      .eq("id", paymentMemberId)
      .not("contracts.total_sessions", "is", null)
      .maybeSingle();
    if (detailResult.error) {
      return apiError(500, "INTERNAL_ERROR", detailResult.error.message);
    }
    if (!detailResult.data) {
      return apiError(404, "FORBIDDEN", "找不到學員資料");
    }

    const [memberWithSharedContracts] = await attachSharedContracts(tenantId, [
      detailResult.data,
    ]);
    const detail = flattenBigeMemberPaymentRelations(
      memberWithSharedContracts as Record<string, unknown> & {
        contracts?: Array<Record<string, unknown>>;
      },
    );
    return apiSuccess({
      member: detail.member,
      contracts: detail.contracts,
      paymentSchedule: [],
      payments: detail.payments,
      extensions: [],
      canViewDetailedPaymentDates: isBigeContractRiskRequester(auth.context),
      canRecordContractPayment: canRecordBigeContractPayment(auth.context),
      canManageCourseAllocations: canManageBigeCourseAllocations(auth.context),
    });
  }

  const memberId = url.searchParams.get("memberId");
  if (memberId) {
    const sharedMembershipsResult = await auth.supabase
      .from("member_plan_contract_members")
      .select("contract_id")
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId);
    if (sharedMembershipsResult.error) {
      return apiError(500, "INTERNAL_ERROR", sharedMembershipsResult.error.message);
    }
    const sharedContractIds = [
      ...new Set(
        (sharedMembershipsResult.data || []).map((row: any) => String(row.contract_id)),
      ),
    ];
    let contractsQuery = auth.supabase
      .from("member_plan_contracts")
      .select(
        "id, contract_number, plan_catalog_id, status, payment_status, signed_on, is_legacy_import, purchase_date_recorded_at, starts_at, ends_at, total_sessions, total_amount, unlocked_sessions, used_sessions, remaining_sessions, course_allocations, course_used, course_allocations_configured_at, extension_limit_days, extension_used_days, original_ends_at",
      )
      .eq("tenant_id", tenantId)
      .not("total_sessions", "is", null)
      .order("created_at", { ascending: false });
    contractsQuery = sharedContractIds.length
      ? contractsQuery.or(`member_id.eq.${memberId},id.in.(${sharedContractIds.join(",")})`)
      : contractsQuery.eq("member_id", memberId);

    const [memberResult, contractsResult] = await Promise.all([
      auth.supabase
        .from("members")
        .select(
          "id, full_name, phone, email, email_unavailable, birth_date, member_code, photo_url, is_prospect",
        )
        .eq("tenant_id", tenantId)
        .eq("id", memberId)
        .maybeSingle(),
      contractsQuery,
    ]);
    if (memberResult.error || contractsResult.error) {
      return apiError(
        500,
        "INTERNAL_ERROR",
        memberResult.error?.message || contractsResult.error?.message || "讀取會員資料失敗",
      );
    }
    const contracts = contractsResult.data || [];
    const contractIds = contracts.map((row: any) => row.id);
    const [scheduleResult, paymentsResult, extensionsResult] =
      contractIds.length > 0
        ? await Promise.all([
            auth.supabase
              .from("bige_contract_payment_schedule")
              .select("id, contract_id, sequence_no, payment_kind, due_on, due_amount, paid_amount, status, note")
              .in("contract_id", contractIds)
              .order("sequence_no"),
            auth.supabase
              .from("bige_contract_payments")
              .select("id, contract_id, payment_kind, amount, method, installment_count, status, paid_at, note")
              .in("contract_id", contractIds)
              .order("paid_at", { ascending: false }),
            auth.supabase
              .from("bige_contract_extensions")
              .select(
                "id, contract_id, old_ends_at, new_ends_at, extension_days, cumulative_extension_days, reason, signed_member_name, signed_at, created_at",
              )
              .in("contract_id", contractIds)
              .order("created_at", { ascending: false }),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];
    for (const result of [scheduleResult, paymentsResult, extensionsResult]) {
      if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);
    }
    let memberWithLegacy = memberResult.data;
    if (memberResult.data) {
      try {
        memberWithLegacy = (await attachLegacyNumbers(tenantId, [memberResult.data]))[0];
      } catch (caught) {
        return apiError(
          500,
          "INTERNAL_ERROR",
          caught instanceof Error ? caught.message : "legacy_member_lookup_failed",
        );
      }
    }
    return apiSuccess({
      member: memberWithLegacy,
      contracts,
      paymentSchedule: scheduleResult.data || [],
      payments: paymentsResult.data || [],
      extensions: extensionsResult.data || [],
      canViewDetailedPaymentDates: isBigeContractRiskRequester(auth.context),
      canRecordContractPayment: canRecordBigeContractPayment(auth.context),
      canManageCourseAllocations: canManageBigeCourseAllocations(auth.context),
    });
  }

  const range = taipeiRange(businessDate);
  // Scope is authorized from the authenticated server-side profile above. The
  // admin client is only used for the authorized overview read so RLS cannot
  // collapse a team lead's result back to their own coach row.
  const scheduleSupabase = hasAllCoachScheduleAccess
    ? createSupabaseAdminClient()
    : auth.supabase;
  const shouldLoadOperationalReminders =
    isManager(auth.context) ||
    auth.context.role === "frontdesk" ||
    auth.context.department === "general_affairs";
  const expiryEnd = `${addDays(toTaipeiDateString(), 31)}T00:00:00+08:00`;
  const expiringContractsPromise = shouldLoadOperationalReminders
    ? auth.supabase
        .from("member_plan_contracts")
        .select(
          "id, member_id, contract_number, ends_at, total_sessions, unlocked_sessions, used_sessions, remaining_sessions, extension_limit_days, extension_used_days, status, payment_status",
        )
        .eq("tenant_id", tenantId)
        .not("total_sessions", "is", null)
        .gt("remaining_sessions", 0)
        .lt("ends_at", expiryEnd)
        .order("ends_at", { ascending: true })
        .limit(200)
    : Promise.resolve({ data: [], error: null });
  const legacyPurchaseDateRemindersPromise = loadLegacyPurchaseDateReminders(
    auth.supabase,
    tenantId,
    businessDate,
    branchId,
  )
    .then((data) => ({ data, error: null as Error | null }))
    .catch((caught) => ({
      data: [],
      error:
        caught instanceof Error
          ? caught
          : new Error("legacy_purchase_date_reminder_lookup_failed"),
    }));

  let bookingsQuery = scheduleSupabase
    .from("bookings")
    .select(
      "id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, status_reason, note, operation_kind, course_type, trial_stage, operation_result, trial_conversion_outcome, trial_booking_id, group_id, reminder_status, converted_at, converted_contract_id, member_plan_contract_id, requires_contract_followup, import_batch_id, import_row_key, fa_fee_amount, fa_fee_recipient_profile_id, fa_fee_recipient_name, fa_fee_recorded_at",
    )
    .eq("tenant_id", tenantId)
    .eq("is_bige_schedule", true)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at", { ascending: true });
  if (branchId) bookingsQuery = bookingsQuery.eq("branch_id", branchId);
  if (auth.context.role === "coach" && !hasAllCoachScheduleAccess) {
    bookingsQuery = bookingsQuery.eq("coach_id", auth.context.userId);
  }

  let notesQuery = scheduleSupabase
    .from("bige_schedule_notes")
    .select("id, branch_id, coach_id, starts_at, ends_at, content, system_kind, source_booking_ids, metadata, updated_at")
    .eq("tenant_id", tenantId)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at", { ascending: true });
  if (branchId) notesQuery = notesQuery.eq("branch_id", branchId);
  if (auth.context.role === "coach" && !hasAllCoachScheduleAccess) {
    notesQuery = notesQuery.eq("coach_id", auth.context.userId);
  }

  let coachesQuery = scheduleSupabase
    .from("profiles")
    .select("id, branch_id, display_name, english_name, employee_number, role, department, position, is_active")
    .eq("tenant_id", tenantId)
    .or("role.in.(coach,therapist),department.eq.coaching")
    .eq("is_active", true)
    .order("english_name", { nullsFirst: false })
    .order("display_name");
  if (branchId) coachesQuery = coachesQuery.or(`branch_id.eq.${branchId},branch_id.is.null`);
  if (auth.context.role === "coach" && !hasAllCoachScheduleAccess) {
    coachesQuery = coachesQuery.eq("id", auth.context.userId);
  }

  const [
    bookingsResult,
    notesResult,
    coachesResult,
    coachOrderResult,
    plansResult,
    closureResult,
    businessDayResult,
    expiringContractsResult,
    legacyPurchaseDateRemindersResult,
  ] = await Promise.all([
    bookingsQuery,
    notesQuery,
    coachesQuery,
    createSupabaseAdminClient()
      .from("bige_schedule_coach_order")
      .select("coach_id, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true }),
    auth.supabase
      .from("member_plan_catalog")
      .select(
        "id, code, name, description, total_sessions, price_amount, course_allocations, fitness_plan_kind, is_active, version",
      )
      .eq("tenant_id", tenantId)
      .eq("fitness_visible", true)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    auth.supabase
      .from("bige_daily_closures")
      .select(
        "id, business_date, status, revision, confirmed_at, reopened_at, reopen_reason, snapshot, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("business_date", businessDate)
      .limit(1)
      .maybeSingle(),
    createSupabaseAdminClient()
      .from("bige_business_day_settings")
      .select(
        "id, branch_id, business_date, is_closed, closure_label, frontdesk_name, source, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("business_date", businessDate)
      .limit(1)
      .maybeSingle(),
    expiringContractsPromise,
    legacyPurchaseDateRemindersPromise,
  ]);
  const boardReadsCompletedAt = performance.now();

  for (const result of [
    bookingsResult,
    notesResult,
    coachesResult,
    coachOrderResult,
    plansResult,
    closureResult,
    businessDayResult,
    expiringContractsResult,
  ]) {
    if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);
  }
  if (legacyPurchaseDateRemindersResult.error) {
    return apiError(
      500,
      "INTERNAL_ERROR",
      legacyPurchaseDateRemindersResult.error.message,
    );
  }

  const orderedCoaches = applyStoredCoachOrder(
    coachesResult.data || [],
    coachOrderResult.data || [],
  );
  const rawNotes = notesResult.data || [];
  let bookings = (bookingsResult.data || []).filter(
    (booking: any) => !isScheduleTrashDeletedBooking(booking),
  );
  const showTrialRevenue = canSeeTrialRevenue(auth.context);
  if (showTrialRevenue) {
    const convertedContractIds = [
      ...new Set(
        bookings
          .map((booking: any) => booking.converted_contract_id)
          .filter((value: unknown): value is string => typeof value === "string" && value.length > 0),
      ),
    ];
    if (convertedContractIds.length > 0) {
      const convertedPaymentsResult = await scheduleSupabase
        .from("bige_contract_payments")
        .select("id, contract_id, amount, status, paid_at, idempotency_key")
        .eq("tenant_id", tenantId)
        .in("contract_id", convertedContractIds)
        .eq("status", "recorded")
        .order("paid_at", { ascending: true });
      if (convertedPaymentsResult.error) {
        return apiError(500, "INTERNAL_ERROR", convertedPaymentsResult.error.message);
      }
      const amountByContractId = new Map<string, number>();
      for (const payment of convertedPaymentsResult.data || []) {
        const contractId = String(payment.contract_id);
        const isInitialPayment = payment.idempotency_key === `contract-create:${contractId}`;
        if (isInitialPayment || !amountByContractId.has(contractId)) {
          amountByContractId.set(contractId, Number(payment.amount || 0));
        }
      }
      bookings = bookings.map((booking: any) => ({
        ...booking,
        converted_payment_amount: booking.converted_contract_id
          ? amountByContractId.get(String(booking.converted_contract_id)) || null
          : null,
      }));
    }
  }
  const activeCoachIds = new Set(orderedCoaches.map((coach: any) => coach.id));
  const coachDayStatuses = collectCoachDayStatuses(rawNotes, activeCoachIds);
  const visibleNotes = rawNotes.filter((note: any) => !readCoachDayStatusMarker(note.content));

  // A real class or a manual note wins over the assistant-manager's automatic
  // FA second-hour TO marker. Surface that exception on the board so the
  // manager can resolve it instead of silently losing the operational cue.
  const activeBookings = bookings.filter((booking: any) =>
    ACTIVE_BOOKING_STATUSES.includes(String(booking.status || "").toLowerCase()),
  );
  const classroomConflicts = buildBigeClassroomConflicts(bookings);
  const assistantManagers = orderedCoaches.filter(
    (coach: any) =>
      coach.department === "coaching" && coach.position === "coach_assistant_manager",
  );
  const offCoachIds = new Set(
    coachDayStatuses
      .filter((status) => status.status === "off")
      .map((status) => status.coach_id),
  );
  const conflictMap = new Map<
    string,
    { coach_id: string; starts_at: string; source_booking_ids: string[]; message: string }
  >();

  for (const sourceBooking of activeBookings) {
    if (sourceBooking.operation_kind !== "trial") continue;
    const assistant =
      assistantManagers.find(
        (coach: any) =>
          sourceBooking.branch_id && coach.branch_id === sourceBooking.branch_id,
      ) || assistantManagers.find((coach: any) => !coach.branch_id);
    if (!assistant || assistant.id === sourceBooking.coach_id || offCoachIds.has(assistant.id)) {
      continue;
    }

    const secondHourAt = new Date(sourceBooking.starts_at).getTime() + 60 * 60 * 1000;
    const secondHourEndAt = secondHourAt + 60 * 60 * 1000;
    const secondHour = new Date(secondHourAt).toISOString();
    const secondHourEnd = new Date(secondHourEndAt).toISOString();
    const hasBookingConflict = activeBookings.some(
      (booking: any) =>
        booking.coach_id === assistant.id &&
        timeRangesOverlap(
          booking.starts_at,
          booking.ends_at,
          secondHour,
          secondHourEnd,
        ),
    );
    const hasManualNoteConflict = rawNotes.some(
      (note: any) =>
        note.coach_id === assistant.id &&
        !note.system_kind &&
        !readCoachDayStatusMarker(note.content) &&
        !isBigeAssistantToContent(note.content) &&
        timeRangesOverlap(note.starts_at, note.ends_at, secondHour, secondHourEnd),
    );
    if (!hasBookingConflict && !hasManualNoteConflict) continue;

    const key = `${assistant.id}:${secondHour}`;
    const existing = conflictMap.get(key);
    if (existing) {
      existing.source_booking_ids.push(sourceBooking.id);
    } else {
      conflictMap.set(key, {
        coach_id: assistant.id,
        starts_at: secondHour,
        source_booking_ids: [sourceBooking.id],
        message: "FA 第二小時需要 TO，但此時段已有正式安排",
      });
    }
  }

  const memberIds = [...new Set(bookings.map((row: any) => row.member_id).filter(Boolean))];
  const [membersResult, futureTrialsResult] = await Promise.all([
    memberIds.length > 0
      ? scheduleSupabase
          .from("members")
          .select(`
            id,
            full_name,
            phone,
            email,
            email_unavailable,
            birth_date,
            member_code,
            photo_url,
            is_prospect,
            contracts:member_plan_contracts!member_plan_contracts_member_id_fkey(
              id,
              created_at,
              contract_number,
              plan_catalog_id,
              status,
              payment_status,
              signed_on,
              is_legacy_import,
              purchase_date_recorded_at,
              starts_at,
              ends_at,
              total_sessions,
              total_amount,
              unlocked_sessions,
              used_sessions,
              remaining_sessions,
              course_allocations,
              course_used,
              course_allocations_configured_at,
              extension_limit_days,
              extension_used_days,
              original_ends_at,
              payments:bige_contract_payments!bige_contract_payments_contract_id_fkey(
                id,
                contract_id,
                payment_kind,
                amount,
                method,
                installment_count,
                status,
                paid_at,
                note
              )
            )
          `)
          .eq("tenant_id", tenantId)
          .in("id", memberIds)
          .not("contracts.total_sessions", "is", null)
      : Promise.resolve({ data: [], error: null }),
    memberIds.length > 0
      ? scheduleSupabase
          .from("bookings")
          .select("id, member_id")
          .eq("tenant_id", tenantId)
          .eq("is_bige_schedule", true)
          .eq("operation_kind", "trial")
          .in("status", ACTIVE_BOOKING_STATUSES)
          .gt("starts_at", new Date().toISOString())
          .in("member_id", memberIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const memberReadsCompletedAt = performance.now();
  if (membersResult.error) return apiError(500, "INTERNAL_ERROR", membersResult.error.message);
  if (futureTrialsResult.error) {
    return apiError(500, "INTERNAL_ERROR", futureTrialsResult.error.message);
  }
  const futureTrialIdsByMember = new Map<string, Set<string>>();
  for (const row of futureTrialsResult.data || []) {
    const memberId = String(row.member_id || "");
    if (!memberId) continue;
    const ids = futureTrialIdsByMember.get(memberId) || new Set<string>();
    ids.add(String(row.id));
    futureTrialIdsByMember.set(memberId, ids);
  }
  bookings = bookings.map((booking: any) => {
    const futureIds = futureTrialIdsByMember.get(String(booking.member_id)) || new Set<string>();
    return {
      ...booking,
      future_trial_booking_count:
        futureIds.size - (futureIds.has(String(booking.id)) ? 1 : 0),
    };
  });
  const trialBookingIds = [
    ...new Set(bookings.map((row: any) => row.trial_booking_id).filter(Boolean)),
  ];
  const scheduleMembersPromise = attachScheduleMemberRelationships(
    tenantId,
    membersResult.data || [],
  )
    .then((data) => ({ data, error: null as Error | null }))
    .catch((caught) => ({
      data: [],
      error: caught instanceof Error ? caught : new Error("legacy_member_lookup_failed"),
    }));
  const trialBookingsPromise =
    trialBookingIds.length > 0
      ? createSupabaseAdminClient()
          .from("trial_bookings")
          .select("id, name, phone, birthday, service")
          .in("id", trialBookingIds)
      : Promise.resolve({ data: [], error: null });
  const [scheduleMembersResult, trialBookingsResult] = await Promise.all([
    scheduleMembersPromise,
    trialBookingsPromise,
  ]);
  const relationshipReadsCompletedAt = performance.now();
  if (scheduleMembersResult.error) {
    return apiError(
      500,
      "INTERNAL_ERROR",
      scheduleMembersResult.error.message,
    );
  }
  if (trialBookingsResult.error) {
    return apiError(500, "INTERNAL_ERROR", trialBookingsResult.error.message);
  }
  let scheduleMembers: any[] = scheduleMembersResult.data;
  const paymentDetailsByMemberId = buildBigeMemberPaymentDetailMap(
    scheduleMembers,
    {
      canViewDetailedPaymentDates: isBigeContractRiskRequester(auth.context),
      canRecordContractPayment: canRecordBigeContractPayment(auth.context),
      canManageCourseAllocations: canManageBigeCourseAllocations(auth.context),
    },
  );
  scheduleMembers = scheduleMembers.map(
    (member) => paymentDetailsByMemberId[String(member.id)]?.member || member,
  );

  console.info("[bige-fitness] coach schedule scope", {
    role: auth.context.role,
    department: auth.context.department,
    position: auth.context.position,
    scope: hasAllCoachScheduleAccess ? "all" : "assigned",
    branchId,
    coachCount: orderedCoaches.length,
    bookingCount: bookings.length,
  });

  const expiringContracts = expiringContractsResult.data || [];

  const legacyPurchaseDateReminders = legacyPurchaseDateRemindersResult.data;

  const response = apiSuccess({
    businessDate,
    role: auth.context.role,
    coachScheduleScope: hasAllCoachScheduleAccess ? "all" : "assigned",
    tenantId,
    branchId,
    bookings,
    notes: visibleNotes,
    coachDayStatuses,
    faAssistantToConflicts: [...conflictMap.values()],
    classroomConflicts,
    coaches: orderedCoaches,
    members: scheduleMembers,
    paymentDetailsByMemberId,
    trialBookings: trialBookingsResult.data || [],
    plans: plansResult.data || [],
    closure: closureResult.data || null,
    businessDay: businessDayResult.data || null,
    canManageBusinessClosure: isManager(auth.context),
    canManageFrontdesk:
      isManager(auth.context) || auth.context.role === "frontdesk",
    canManageSchedule: canManageBigeSchedule(auth.context),
    canReorderCoaches: canReorderBigeScheduleCoaches(auth.context),
    canViewScheduleActivity: canViewBigeScheduleActivity(auth.context),
    canSeeTrialRevenue: showTrialRevenue,
    canViewDetailedPaymentDates: isBigeContractRiskRequester(auth.context),
    canRecordContractPayment: canRecordBigeContractPayment(auth.context),
    canManageCourseAllocations: canManageBigeCourseAllocations(auth.context),
    canCreateContract: canCreateBigeContract(auth.context.employeeNumber),
    canChangeTrialConversion: canRecordBigeContractPayment(auth.context),
    canRestoreTrialConversion: canDirectlyApproveBigeContractRisk(auth.context),
    canManageDailyReports: canManageBigePlansAndDailyReports(auth.context),
    canConfirmDailyReports: canDirectlyApproveBigeContractRisk(auth.context),
    legacyPurchaseDateReminders,
    expiringContracts,
    rules: {
      openHour: 9,
      closeHour: 24,
      slotMinutes: 30,
      perCoachConcurrentMemberCapacity: 1,
      weightTrainingConcurrentCoachCapacity: null,
      classroomConflictThreshold: 2,
      classroomConflictMode: "warning",
      operationWindowMinutes: 30,
    },
  });
  const responseReadyAt = performance.now();
  const timing = {
    authAndCoreMs: Math.round(boardReadsCompletedAt - requestStartedAt),
    memberReadsMs: Math.round(memberReadsCompletedAt - boardReadsCompletedAt),
    relationshipReadsMs: Math.round(
      relationshipReadsCompletedAt - memberReadsCompletedAt,
    ),
    composeMs: Math.round(responseReadyAt - relationshipReadsCompletedAt),
    totalMs: Math.round(responseReadyAt - requestStartedAt),
  };
  response.headers.set(
    "Server-Timing",
    [
      `auth-core;dur=${timing.authAndCoreMs}`,
      `members;dur=${timing.memberReadsMs}`,
      `relationships;dur=${timing.relationshipReadsMs}`,
      `compose;dur=${timing.composeMs}`,
      `total;dur=${timing.totalMs}`,
    ].join(", "),
  );
  console.info("[bige-fitness] daily board timing", {
    businessDate,
    ...timing,
  });
  return response;
}

export async function POST(request: Request) {
  const auth = await resolveAuth(request);
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => null);
  const parsed = bigeFitnessActionSchema.safeParse(payload);
  if (!parsed.success) return apiError(400, "FORBIDDEN", getZodMessage(parsed.error));

  const input = parsed.data;
  const tenantId = auth.context.tenantId;
  if (!tenantId) return apiError(400, "FORBIDDEN", "目前帳號沒有場館範圍");

  const operationSupabase = auth.supabase;
  const operationContext: Pick<
    ProfileContext,
    "userId" | "role" | "employeeNumber" | "department" | "position" | "tenantId" | "branchId"
  > = auth.context;

  if (input.action === "update_business_day") {
    const canManageClosure = isManager(auth.context);
    const canManageFrontdesk = canManageClosure || auth.context.role === "frontdesk";
    if (!canManageFrontdesk) {
      return apiError(403, "FORBIDDEN", "您的帳號不能調整營業日設定");
    }
    if ((input.isClosed !== undefined || input.closureLabel !== undefined) && !canManageClosure) {
      return apiError(403, "FORBIDDEN", "只有 01 或主管帳號能調整館休");
    }

    const admin = createSupabaseAdminClient();
    const existingResult = await admin
      .from("bige_business_day_settings")
      .select("id, branch_id, is_closed, closure_label, frontdesk_name")
      .eq("tenant_id", tenantId)
      .eq("business_date", input.businessDate)
      .limit(1)
      .maybeSingle();
    if (existingResult.error) {
      return apiError(500, "INTERNAL_ERROR", existingResult.error.message);
    }
    const existing = existingResult.data;
    const row = {
      tenant_id: tenantId,
      branch_id: input.branchId || auth.context.branchId || existing?.branch_id || null,
      business_date: input.businessDate,
      is_closed: canManageClosure
        ? input.isClosed ?? existing?.is_closed ?? false
        : existing?.is_closed ?? false,
      closure_label: canManageClosure
        ? input.closureLabel === undefined
          ? existing?.closure_label || null
          : input.closureLabel
        : existing?.closure_label || null,
      frontdesk_name:
        input.frontdeskName === undefined
          ? existing?.frontdesk_name || null
          : input.frontdeskName,
      source: "manual",
      created_by: existing ? undefined : auth.context.userId,
      updated_by: auth.context.userId,
      updated_at: new Date().toISOString(),
    };
    const result = await admin
      .from("bige_business_day_settings")
      .upsert(row, { onConflict: "tenant_id,business_date" })
      .select(
        "id, branch_id, business_date, is_closed, closure_label, frontdesk_name, source, updated_at",
      )
      .single();
    if (result.error) return handleDatabaseError(result.error, "儲存營業日設定失敗");
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: auth.context.userId,
      action: "bige_business_day_setting_updated",
      target_type: "business_day",
      target_id: input.businessDate,
      reason: null,
      payload: result.data,
    });
    return apiSuccess({ businessDay: result.data });
  }

  if (input.action === "reorder_schedule_coaches") {
    if (!canReorderBigeScheduleCoaches(auth.context)) {
      return apiError(403, "FORBIDDEN", "您的帳號不能調整教練順序");
    }

    const admin = createSupabaseAdminClient();
    const hasAllCoachScheduleAccess = canViewAllCoachSchedules({
      role: auth.context.role,
      department: auth.context.department ?? null,
      position: auth.context.position ?? null,
      branchId: auth.context.branchId,
    });
    let coachesQuery = admin
      .from("profiles")
      .select("id")
      .eq("tenant_id", tenantId)
      .or("role.in.(coach,therapist),department.eq.coaching")
      .eq("is_active", true);
    if (!hasAllCoachScheduleAccess && auth.context.branchId) {
      coachesQuery = coachesQuery.or(
        `branch_id.eq.${auth.context.branchId},branch_id.is.null`,
      );
    }
    const coachesResult = await coachesQuery;
    if (coachesResult.error) {
      return apiError(500, "INTERNAL_ERROR", coachesResult.error.message);
    }
    const expectedCoachIds = (coachesResult.data || []).map((coach) => coach.id);
    if (!hasExactCoachSet(expectedCoachIds, input.coachIds)) {
      return apiError(409, "FORBIDDEN", "教練名單已更新，請重新整理後再調整順序");
    }

    const now = new Date().toISOString();
    const result = await admin
      .from("bige_schedule_coach_order")
      .upsert(
        input.coachIds.map((coachId, sortOrder) => ({
          tenant_id: tenantId,
          coach_id: coachId,
          sort_order: sortOrder,
          updated_at: now,
          updated_by: auth.context.userId,
        })),
        { onConflict: "tenant_id,coach_id" },
      );
    if (result.error) return handleDatabaseError(result.error, "儲存教練順序失敗");

    const auditResult = await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: auth.context.userId,
      action: "bige_schedule_coaches_reordered",
      target_type: "schedule_coach_order",
      target_id: tenantId,
      reason: null,
      payload: { coachIds: input.coachIds },
    });
    if (auditResult.error) {
      console.warn("[bige-fitness] coach order audit failed", auditResult.error.message);
    }
    return apiSuccess({ coachIds: input.coachIds });
  }

  if (input.action === "create_schedule") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const endsAt = normalizeBigeScheduleEndAt(
      input.operationKind,
      input.startsAt,
      input.endsAt,
    );
    if (!isValidScheduleWindow(input.startsAt, endsAt)) {
      return apiError(400, "FORBIDDEN", normalizeErrorMessage("outside_business_hours"));
    }
    const openDay = await ensureScheduleDateOpen(tenantId, input.startsAt);
    if (!openDay.open) {
      return apiError(409, "FORBIDDEN", openDay.setting?.closure_label || "當日館休，不能新增排課");
    }
    const result = await auth.supabase.rpc("bige_create_schedule_booking_v2", {
      p_tenant_id: tenantId,
      p_branch_id: input.branchId || auth.context.branchId,
      p_member_id: input.memberId || null,
      p_trial_booking_id: input.trialBookingId || null,
      p_coach_id: input.coachId,
      p_operation_kind: input.operationKind,
      p_course_type: input.courseType,
      p_starts_at: input.startsAt,
      p_ends_at: endsAt,
      p_note: input.note || null,
      p_group_id: input.groupId || null,
      p_idempotency_key: input.idempotencyKey,
    });
    if (result.error) return handleDatabaseError(result.error, "建立排課失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "check_schedule_batch") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "您沒有批次安排課程的權限");
    }

    const startsAtValues = [...new Set(input.startsAt)].sort();
    const slots = startsAtValues.map((startsAt) => ({
      startsAt,
      endsAt: normalizeBigeScheduleEndAt(
        input.operationKind,
        startsAt,
        new Date(
          new Date(startsAt).getTime() +
            (input.operationKind === "trial" ? 120 : 60) * 60_000,
        ).toISOString(),
      ),
    }));
    const rangeStart = slots[0]?.startsAt;
    const rangeEnd = slots.at(-1)?.endsAt;
    if (!rangeStart || !rangeEnd) {
      return apiError(400, "FORBIDDEN", "請至少選擇一個排課日期");
    }

    const admin = createSupabaseAdminClient();
    const [bookingsResult, notesResult, openDays] = await Promise.all([
      admin
        .from("bookings")
        .select(
          "id, member_id, coach_id, service_name, starts_at, ends_at, status, course_type, is_bige_schedule",
        )
        .eq("tenant_id", tenantId)
        .in("status", ACTIVE_BOOKING_STATUSES)
        .lt("starts_at", rangeEnd)
        .gt("ends_at", rangeStart)
        .limit(5000),
      admin
        .from("bige_schedule_notes")
        .select("id, coach_id, starts_at, ends_at, content")
        .eq("tenant_id", tenantId)
        .eq("coach_id", input.coachId)
        .lt("starts_at", rangeEnd)
        .gt("ends_at", rangeStart)
        .limit(2000),
      Promise.all(slots.map((slot) => ensureScheduleDateOpen(tenantId, slot.startsAt))),
    ]);
    const queryError = bookingsResult.error || notesResult.error;
    if (queryError) return handleDatabaseError(queryError, "檢查排課衝突失敗");

    const bookings = (bookingsResult.data || []) as BigeScheduleBatchBookingCandidate[];
    const notes = (notesResult.data || []) as BigeScheduleBatchNoteCandidate[];
    const memberIds = Array.from(
      new Set(bookings.map((booking) => booking.member_id).filter((value): value is string => Boolean(value))),
    );
    const coachIds = Array.from(
      new Set([
        input.coachId,
        ...bookings
          .map((booking) => booking.coach_id)
          .filter((value): value is string => Boolean(value)),
      ]),
    );
    const [membersResult, coachesResult] = await Promise.all([
      memberIds.length
        ? admin.from("members").select("id, full_name").eq("tenant_id", tenantId).in("id", memberIds)
        : Promise.resolve({ data: [], error: null }),
      coachIds.length
        ? admin
            .from("profiles")
            .select("id, display_name, english_name")
            .eq("tenant_id", tenantId)
            .in("id", coachIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const lookupError = membersResult.error || coachesResult.error;
    if (lookupError) return handleDatabaseError(lookupError, "讀取衝突排課資料失敗");

    const memberNames = new Map(
      (membersResult.data || []).map((member) => [member.id, member.full_name]),
    );
    const coachNames = new Map(
      (coachesResult.data || []).map((coach) => [
        coach.id,
        coach.english_name || coach.display_name || "未命名教練",
      ]),
    );
    const conflicts: ScheduleBatchPreviewConflict[] = [];
    const available: Array<{ startsAt: string; endsAt: string }> = [];

    for (const [index, slot] of slots.entries()) {
      if (!isValidScheduleWindow(slot.startsAt, slot.endsAt)) {
        conflicts.push({
          ...slot,
          kind: "outside_hours",
          message: normalizeErrorMessage("outside_business_hours"),
        });
        continue;
      }
      if (!openDays[index]?.open) {
        conflicts.push({
          ...slot,
          kind: "closed_day",
          message: openDays[index]?.setting?.closure_label || "該日期已設定為不營業日",
        });
        continue;
      }

      const conflict = findBigeScheduleBatchConflict({
        memberId: input.memberId,
        coachId: input.coachId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        bookings,
        notes,
      });
      if (!conflict) {
        available.push(slot);
        continue;
      }

      if (conflict.kind === "coach_note") {
        conflicts.push({
          ...slot,
          kind: conflict.kind,
          message: `該教練同時段已有「${conflict.item.content}」排課資料`,
          conflictStartsAt: conflict.item.starts_at,
          conflictEndsAt: conflict.item.ends_at,
          conflictCoachId: conflict.item.coach_id,
          conflictCoachName: coachNames.get(conflict.item.coach_id) || null,
          conflictNote: conflict.item.content,
        });
        continue;
      }

      const conflictMemberName = conflict.item.member_id
        ? memberNames.get(conflict.item.member_id) || null
        : null;
      const conflictCoachName = conflict.item.coach_id
        ? coachNames.get(conflict.item.coach_id) || null
        : null;
      conflicts.push({
        ...slot,
        kind: conflict.kind,
        message:
          conflict.kind === "coach_booking"
            ? `該教練同時段已安排${conflictMemberName ? `「${conflictMemberName}」` : "其他學員"}`
            : `該學員同時段已有${conflictCoachName ? `「${conflictCoachName}」教練的` : "其他"}課程`,
        conflictStartsAt: conflict.item.starts_at,
        conflictEndsAt: conflict.item.ends_at,
        conflictMemberId: conflict.item.member_id,
        conflictMemberName,
        conflictCoachId: conflict.item.coach_id,
        conflictCoachName,
        conflictCourseType: conflict.item.course_type || null,
        conflictServiceName: conflict.item.service_name || null,
      });
    }

    return apiSuccess({
      requestedCount: slots.length,
      available,
      conflicts,
    });
  }

  if (input.action === "create_schedule_batch") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }

    const startsAtValues = [...new Set(input.startsAt)].sort();
    const created: Array<{ startsAt: string; item: unknown }> = [];
    const failures: Array<{ startsAt: string; message: string }> = [];

    for (const [index, startsAt] of startsAtValues.entries()) {
      const endsAt = normalizeBigeScheduleEndAt(
        input.operationKind,
        startsAt,
        new Date(
          new Date(startsAt).getTime() +
            (input.operationKind === "trial" ? 120 : 60) * 60_000,
        ).toISOString(),
      );
      if (!isValidScheduleWindow(startsAt, endsAt)) {
        failures.push({
          startsAt,
          message: normalizeErrorMessage("outside_business_hours"),
        });
        continue;
      }

      const openDay = await ensureScheduleDateOpen(tenantId, startsAt);
      if (!openDay.open) {
        failures.push({
          startsAt,
          message: openDay.setting?.closure_label || "當日館休，不能新增排課",
        });
        continue;
      }

      const result = await auth.supabase.rpc("bige_create_schedule_booking_v2", {
        p_tenant_id: tenantId,
        p_branch_id: input.branchId || auth.context.branchId,
        p_member_id: input.memberId,
        p_trial_booking_id: null,
        p_coach_id: input.coachId,
        p_operation_kind: input.operationKind,
        p_course_type: input.courseType,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_note: input.note || null,
        p_group_id: null,
        p_idempotency_key: `${input.idempotencyKey}:${index}:${startsAt}`,
      });
      if (result.error) {
        failures.push({
          startsAt,
          message: normalizeErrorMessage(result.error.message || "建立排課失敗"),
        });
        continue;
      }
      created.push({ startsAt, item: result.data });
    }

    await createSupabaseAdminClient().from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: auth.context.userId,
      action: "bige_schedule_batch_created",
      target_type: "member",
      target_id: input.memberId,
      reason: null,
      payload: {
        coachId: input.coachId,
        operationKind: input.operationKind,
        courseType: input.courseType,
        requestedCount: startsAtValues.length,
        createdCount: created.length,
        failureCount: failures.length,
        startsAt: startsAtValues,
        failures,
      },
    });

    return apiSuccess({ created, failures });
  }

  if (input.action === "create_note") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const openDay = await ensureScheduleDateOpen(tenantId, input.startsAt);
    if (!openDay.open) {
      return apiError(409, "FORBIDDEN", openDay.setting?.closure_label || "當日館休，不能新增自由文字");
    }
    const result = await auth.supabase
      .from("bige_schedule_notes")
      .insert({
        tenant_id: tenantId,
        branch_id: input.branchId || auth.context.branchId,
        coach_id: input.coachId,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        content: input.content,
        created_by: auth.context.userId,
        updated_by: auth.context.userId,
      })
      .select("id, branch_id, coach_id, starts_at, ends_at, content, updated_at")
      .single();
    if (result.error) return handleDatabaseError(result.error, "建立備註失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "edit_schedule_booking") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    if (!isValidScheduleWindow(input.startsAt, input.endsAt)) {
      return apiError(400, "FORBIDDEN", normalizeErrorMessage("outside_business_hours"));
    }
    const openDay = await ensureScheduleDateOpen(tenantId, input.startsAt);
    if (!openDay.open) {
      return apiError(409, "FORBIDDEN", openDay.setting?.closure_label || "當日館休，不能調整排課");
    }
    const bookingResult = await auth.supabase
      .from("bookings")
      .select("id, tenant_id, operation_kind, status")
      .eq("id", input.bookingId)
      .eq("tenant_id", tenantId)
      .eq("is_bige_schedule", true)
      .maybeSingle();
    if (bookingResult.error || !bookingResult.data) {
      return apiError(404, "FORBIDDEN", "找不到這筆排課");
    }
    if (!canEditBigeScheduleBooking(bookingResult.data.status)) {
      return apiError(409, "FORBIDDEN", BIGE_COMPLETED_BOOKING_EDIT_MESSAGE);
    }
    const endsAt = normalizeBigeScheduleEndAt(
      bookingResult.data.operation_kind === "trial" ? "trial" : "pt",
      input.startsAt,
      input.endsAt,
    );
    if (!isValidScheduleWindow(input.startsAt, endsAt)) {
      return apiError(400, "FORBIDDEN", normalizeErrorMessage("outside_business_hours"));
    }
    const conflictResult = await loadScheduleEditConflict({
      supabase: auth.supabase,
      tenantId,
      coachId: input.coachId,
      startsAt: input.startsAt,
      endsAt,
      excludeBookingId: input.bookingId,
    });
    if (conflictResult.error) {
      return handleDatabaseError(conflictResult.error, "確認調整後時段失敗");
    }
    if (conflictResult.conflict) {
      return apiError(409, "FORBIDDEN", scheduleEditConflictMessage(conflictResult.conflict));
    }
    const result = await auth.supabase
      .from("bookings")
      .update({
        coach_id: input.coachId,
        course_type: input.courseType,
        service_name: BIGE_COURSE_LABELS[input.courseType],
        starts_at: input.startsAt,
        ends_at: endsAt,
        note: input.note || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.bookingId)
      .eq("tenant_id", tenantId)
      .eq("is_bige_schedule", true)
      .select(
        "id, member_id, coach_id, service_name, starts_at, ends_at, status, note, operation_kind, course_type, trial_stage, operation_result, reminder_status, converted_at",
      )
      .single();
    if (result.error) return handleDatabaseError(result.error, "儲存排課變更失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "edit_schedule_note") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    if (!isValidScheduleWindow(input.startsAt, input.endsAt)) {
      return apiError(400, "FORBIDDEN", normalizeErrorMessage("outside_business_hours"));
    }
    const openDay = await ensureScheduleDateOpen(tenantId, input.startsAt);
    if (!openDay.open) {
      return apiError(409, "FORBIDDEN", openDay.setting?.closure_label || "當日館休，不能調整自由文字");
    }
    const noteResult = await auth.supabase
      .from("bige_schedule_notes")
      .select("id, coach_id")
      .eq("id", input.noteId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (noteResult.error || !noteResult.data) {
      return apiError(404, "FORBIDDEN", "找不到這筆自由文字");
    }
    const conflictResult = await loadScheduleEditConflict({
      supabase: auth.supabase,
      tenantId,
      coachId: input.coachId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      excludeNoteId: input.noteId,
    });
    if (conflictResult.error) {
      return handleDatabaseError(conflictResult.error, "確認調整後時段失敗");
    }
    if (conflictResult.conflict) {
      return apiError(409, "FORBIDDEN", scheduleEditConflictMessage(conflictResult.conflict));
    }
    const result = await auth.supabase
      .from("bige_schedule_notes")
      .update({
        coach_id: input.coachId,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        content: input.content,
        updated_by: auth.context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.noteId)
      .eq("tenant_id", tenantId)
      .select("id, branch_id, coach_id, starts_at, ends_at, content, updated_at")
      .single();
    if (result.error) return handleDatabaseError(result.error, "儲存自由文字失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "delete_schedule_note") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "您沒有刪除課表自由文字的權限");
    }

    const noteResult = await auth.supabase
      .from("bige_schedule_notes")
      .select(
        "id, branch_id, coach_id, starts_at, ends_at, content, system_kind, source_booking_ids, metadata, created_by, created_at, updated_by, updated_at",
      )
      .eq("id", input.noteId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (noteResult.error) {
      return handleDatabaseError(noteResult.error, "讀取自由文字失敗");
    }
    if (!noteResult.data) {
      return apiError(404, "FORBIDDEN", "找不到這筆自由文字");
    }
    if (noteResult.data.system_kind) {
      return apiError(409, "FORBIDDEN", "系統自動產生的課表標記不能手動刪除");
    }

    const deleteResult = await auth.supabase
      .from("bige_schedule_notes")
      .delete()
      .eq("id", input.noteId)
      .eq("tenant_id", tenantId)
      .select("id")
      .single();
    if (deleteResult.error) {
      return handleDatabaseError(deleteResult.error, "刪除自由文字失敗");
    }

    const deletedAt = new Date().toISOString();
    const auditResult = await createSupabaseAdminClient().from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: auth.context.userId,
      action: "bige_schedule_note_deleted",
      target_type: "bige_schedule_note",
      target_id: input.noteId,
      reason: null,
      payload: {
        deleted_at: deletedAt,
        note: noteResult.data,
      },
    });
    if (auditResult.error) {
      console.warn(
        "[bige-fitness] schedule note deletion audit failed",
        auditResult.error.message,
      );
    }

    return apiSuccess({
      item: deleteResult.data,
      undo: auditResult.error
        ? null
        : {
            noteId: noteResult.data.id,
            coachId: noteResult.data.coach_id,
            startsAt: noteResult.data.starts_at,
            endsAt: noteResult.data.ends_at,
            content: noteResult.data.content,
            expiresAt: new Date(
              Date.parse(deletedAt) + BIGE_SCHEDULE_NOTE_UNDO_WINDOW_MS,
            ).toISOString(),
          },
    });
  }

  if (input.action === "restore_schedule_note") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "目前帳號沒有復原自由文字的權限");
    }

    const admin = createSupabaseAdminClient();
    const auditResult = await admin
      .from("audit_logs")
      .select("id, actor_id, payload, created_at")
      .eq("tenant_id", tenantId)
      .eq("action", "bige_schedule_note_deleted")
      .eq("target_type", "bige_schedule_note")
      .eq("target_id", input.noteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (auditResult.error) {
      return handleDatabaseError(auditResult.error, "讀取自由文字復原資料失敗");
    }
    if (!auditResult.data || auditResult.data.actor_id !== auth.context.userId) {
      return apiError(404, "FORBIDDEN", "找不到可復原的自由文字");
    }

    const payload = auditResult.data.payload as Record<string, unknown> | null;
    const note = payload?.note as Record<string, unknown> | null;
    const deletedAt =
      typeof payload?.deleted_at === "string"
        ? payload.deleted_at
        : auditResult.data.created_at;
    if (!isBigeScheduleNoteUndoAvailable(deletedAt)) {
      return apiError(410, "FORBIDDEN", "復原時間已超過 30 秒");
    }
    if (
      !note ||
      typeof note.id !== "string" ||
      typeof note.coach_id !== "string" ||
      typeof note.starts_at !== "string" ||
      typeof note.ends_at !== "string" ||
      typeof note.content !== "string"
    ) {
      return apiError(409, "FORBIDDEN", "自由文字復原資料不完整");
    }

    const hourRange = taipeiHourRange(note.starts_at);
    if (!hourRange) {
      return apiError(409, "FORBIDDEN", "自由文字的原始時段無效");
    }

    const [existingNoteResult, existingBookingResult] = await Promise.all([
      admin
        .from("bige_schedule_notes")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("coach_id", note.coach_id)
        .lt("starts_at", hourRange.end)
        .gt("ends_at", hourRange.start)
        .limit(1),
      admin
        .from("bookings")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("coach_id", note.coach_id)
        .eq("is_bige_schedule", true)
        .lt("starts_at", hourRange.end)
        .gt("ends_at", hourRange.start)
        .limit(1),
    ]);
    if (existingNoteResult.error || existingBookingResult.error) {
      return handleDatabaseError(
        existingNoteResult.error || existingBookingResult.error,
        "確認原時段是否可復原失敗",
      );
    }
    if (existingNoteResult.data?.length || existingBookingResult.data?.length) {
      return apiError(409, "FORBIDDEN", "原時段已有新資料，無法復原");
    }

    const restoredAt = new Date().toISOString();
    const restoreResult = await admin
      .from("bige_schedule_notes")
      .insert({
        id: note.id,
        tenant_id: tenantId,
        branch_id: typeof note.branch_id === "string" ? note.branch_id : null,
        coach_id: note.coach_id,
        starts_at: note.starts_at,
        ends_at: note.ends_at,
        content: note.content,
        system_kind: null,
        source_booking_ids: Array.isArray(note.source_booking_ids)
          ? note.source_booking_ids
          : [],
        metadata:
          note.metadata && typeof note.metadata === "object" ? note.metadata : {},
        created_by: typeof note.created_by === "string" ? note.created_by : auth.context.userId,
        created_at: typeof note.created_at === "string" ? note.created_at : restoredAt,
        updated_by: auth.context.userId,
        updated_at: restoredAt,
      })
      .select("id, branch_id, coach_id, starts_at, ends_at, content, updated_at")
      .single();
    if (restoreResult.error) {
      return handleDatabaseError(restoreResult.error, "復原自由文字失敗");
    }

    const restoredAuditResult = await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: auth.context.userId,
      action: "bige_schedule_note_restored",
      target_type: "bige_schedule_note",
      target_id: input.noteId,
      reason: null,
      payload: {
        deleted_audit_id: auditResult.data.id,
        restored_at: restoredAt,
        note: restoreResult.data,
      },
    });
    if (restoredAuditResult.error) {
      console.warn(
        "[bige-fitness] schedule note restoration audit failed",
        restoredAuditResult.error.message,
      );
    }

    return apiSuccess({ item: restoreResult.data });
  }

  if (input.action === "move_schedule_booking") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const openDay = await ensureScheduleDateOpen(tenantId, input.targetStartsAt);
    if (!openDay.open) {
      return apiError(409, "FORBIDDEN", openDay.setting?.closure_label || "當日館休，不能拖拉課程");
    }
    const startedAt = performance.now();
    const result = await auth.supabase.rpc("bige_drag_schedule_booking", {
      p_tenant_id: tenantId,
      p_source_booking_id: input.bookingId,
      p_target_coach_id: input.targetCoachId,
      p_target_starts_at: input.targetStartsAt,
      p_mode: input.mode,
    });
    if (result.error) {
      console.error("[bige-fitness] schedule drag failed", {
        mode: input.mode,
        durationMs: Math.round(performance.now() - startedAt),
        code: result.error.code,
      });
      return handleDatabaseError(result.error, "調整課表失敗");
    }
    console.info("[bige-fitness] schedule drag completed", {
      mode: input.mode,
      durationMs: Math.round(performance.now() - startedAt),
      itemCount: Array.isArray(result.data?.items) ? result.data.items.length : 0,
    });
    return apiSuccess({ item: result.data });
  }

  if (input.action === "undo_schedule_booking_move") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const result = await auth.supabase.rpc("bige_undo_schedule_booking_move", {
      p_tenant_id: tenantId,
      p_operation_id: input.operationId,
    });
    if (result.error) return handleDatabaseError(result.error, "復原課表移動失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "create_plan") {
    if (!canManageBigePlansAndDailyReports(operationContext)) {
      return apiError(403, "FORBIDDEN", "只有教練經理、副理或城市經理能建立方案");
    }
    if (!validateCourseAllocationTotal(input.allocations, input.totalSessions)) {
      return apiError(400, "FORBIDDEN", "三種課別分配加總必須等於總堂數");
    }
    const terms = calculateContractTerms(input.totalSessions);
    const result = await operationSupabase
      .from("member_plan_catalog")
      .insert({
        tenant_id: tenantId,
        branch_id: auth.context.branchId,
        code: `fitness_${crypto.randomUUID().replaceAll("-", "")}`,
        name: input.name,
        description: input.description || null,
        plan_type: "coach_pack",
        fulfillment_kind: "none",
        default_duration_days: terms.validityDays,
        default_quantity: input.totalSessions,
        service_scope: Object.entries(input.allocations)
          .filter(([, count]) => count > 0)
          .map(([course]) => course),
        price_amount: input.totalAmount,
        is_active: true,
        fitness_plan_kind: input.isCustom ? "pt_custom" : "pt_fixed",
        total_sessions: input.totalSessions,
        course_allocations: input.allocations,
        validity_bonus_days: 30,
        fitness_visible: true,
        metadata: {
          baseValidityDays: terms.baseDays,
          extensionLimitDays: terms.extensionLimitDays,
        },
        created_by: operationContext.userId,
        updated_by: operationContext.userId,
      })
      .select(
        "id, code, name, description, total_sessions, price_amount, course_allocations, fitness_plan_kind, is_active, version",
      )
      .single();
    if (result.error) return handleDatabaseError(result.error, "建立方案失敗");
    return apiSuccess({ item: result.data, terms });
  }

  if (input.action === "update_course_allocations") {
    if (!canManageBigeCourseAllocations(operationContext)) {
      return apiError(403, "FORBIDDEN", "只有教練經理或副理能設定專項堂數");
    }
    const result = await operationSupabase.rpc(
      "bige_configure_contract_course_allocations",
      {
        p_contract_id: input.contractId,
        p_allocations: input.allocations,
      },
    );
    if (result.error) {
      return handleDatabaseError(result.error, "設定專項堂數失敗");
    }
    return apiSuccess({ item: result.data });
  }

  if (input.action === "create_contract") {
    if (!canCreateBigeContract(operationContext.employeeNumber)) {
      return apiError(403, "FORBIDDEN", "員工編號 06 不能建立正式會員與合約");
    }
    if (!input.sourceMemberBookingId && input.emailUnavailable && input.email) {
      return apiError(400, "FORBIDDEN", "已有 Email 時請不要勾選沒有 Email");
    }
    if (input.planMode === "builtin" && !input.planId) {
      return apiError(400, "FORBIDDEN", "請先選擇內建方案");
    }
    if (input.planMode === "custom") {
      if (
        !input.customPlan ||
        !validateCourseAllocationTotal(input.customPlan.allocations, input.customPlan.totalSessions)
      ) {
        return apiError(400, "FORBIDDEN", "自訂方案的課別分配加總必須等於總堂數");
      }
    }
    let contractTotalAmount = Number(input.customPlan?.totalAmount || 0);
    let contractTotalSessions = Number(input.customPlan?.totalSessions || 0);
    if (input.planMode === "builtin") {
      const planResult = await operationSupabase
        .from("member_plan_catalog")
        .select("price_amount, total_sessions")
        .eq("tenant_id", tenantId)
        .eq("id", input.planId as string)
        .eq("is_active", true)
        .eq("fitness_visible", true)
        .maybeSingle();
      if (planResult.error) {
        return handleDatabaseError(planResult.error, "讀取合約方案失敗");
      }
      if (!planResult.data) {
        return apiError(400, "FORBIDDEN", "找不到可使用的正式課程方案");
      }
      contractTotalAmount = Number(planResult.data.price_amount || 0);
      contractTotalSessions = Number(planResult.data.total_sessions || 0);
    }
    const requiresInitialPayment = Boolean(
      input.sourceBookingId || input.sourceMemberBookingId,
    );
    const minimumInitialPayment = requiresInitialPayment
      ? calculateMinimumDeposit(contractTotalAmount, contractTotalSessions)
      : 0;
    if (
      !isBigeContractPaymentAmountAllowed(
        input.initialPayment,
        contractTotalAmount,
        { minimumAmount: minimumInitialPayment },
      )
    ) {
      return apiError(
        400,
        "FORBIDDEN",
        requiresInitialPayment
          ? `本次付款最低為 ${minimumInitialPayment} 元，且不可超過合約總額 ${contractTotalAmount} 元`
          : `首次付款不可超過合約總額 ${contractTotalAmount} 元`,
      );
    }
    if (
      (input.paymentMethod === "ecpay_installment" && !input.installmentCount) ||
      (input.paymentMethod !== "ecpay_installment" && input.installmentCount != null)
    ) {
      return apiError(
        400,
        "FORBIDDEN",
        input.paymentMethod === "ecpay_installment"
          ? "請輸入綠界分期期數"
          : "只有綠界分期可以填寫分期期數",
      );
    }

    let trustedFullName = input.fullName;
    let trustedPhone = input.phone;
    let trustedBirthDate: string | null = input.birthDate || null;
    let trustedEmail: string | null = input.email || null;
    let trustedEmailUnavailable = input.emailUnavailable;
    let trustedMemberId = input.memberId || null;
    let trustedSalesOriginCoachId: string | null = null;
    let sourceMissingProfileFields: string[] = [];
    if (input.sourceBookingId && input.sourceMemberBookingId) {
      return apiError(400, "FORBIDDEN", "同一筆合約不能同時指定 FA 成交與學員付款來源");
    }
    if (!input.sourceBookingId && !input.sourceMemberBookingId && !trustedBirthDate) {
      return apiError(400, "FORBIDDEN", "建立一般正式會員時必須填寫生日");
    }
    if (input.sourceMemberBookingId) {
      const admin = createSupabaseAdminClient();
      const sourceBookingResult = await admin
        .from("bookings")
        .select("id, member_id, coach_id, operation_kind")
        .eq("id", input.sourceMemberBookingId)
        .eq("tenant_id", tenantId)
        .eq("is_bige_schedule", true)
        .maybeSingle();
      if (sourceBookingResult.error || !sourceBookingResult.data?.member_id) {
        return apiError(404, "FORBIDDEN", "找不到這筆課程的學員資料");
      }
      if (sourceBookingResult.data.operation_kind === "trial") {
        return apiError(400, "FORBIDDEN", "FA 付款的款項類型固定為新單 New");
      }
      if (trustedMemberId && trustedMemberId !== sourceBookingResult.data.member_id) {
        return apiError(400, "FORBIDDEN", "課程學員與續約會員不一致");
      }
      const sourceMemberResult = await admin
        .from("members")
        .select("id, full_name, phone, birth_date, email, email_unavailable, primary_coach_id")
        .eq("id", sourceBookingResult.data.member_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (sourceMemberResult.error || !sourceMemberResult.data) {
        return apiError(404, "FORBIDDEN", "找不到這筆課程的學員資料");
      }
      trustedMemberId = sourceMemberResult.data.id;
      trustedFullName = sourceMemberResult.data.full_name;
      trustedPhone = sourceMemberResult.data.phone || "";
      trustedBirthDate = sourceMemberResult.data.birth_date || null;
      trustedEmail = sourceMemberResult.data.email || null;
      trustedEmailUnavailable = Boolean(sourceMemberResult.data.email_unavailable);
      trustedSalesOriginCoachId = sourceBookingResult.data.coach_id || sourceMemberResult.data.primary_coach_id || null;
      if (!trustedFullName || !trustedPhone) {
        return apiError(400, "FORBIDDEN", "學員姓名或電話資料不完整，請先由主管補齊");
      }
      if (!trustedEmailUnavailable && !trustedEmail) {
        return apiError(400, "FORBIDDEN", "學員 Email 資料不完整，請先由主管補齊");
      }
    }
    if (input.sourceBookingId) {
      const admin = createSupabaseAdminClient();
      const sourceBookingResult = await admin
        .from("bookings")
        .select("id, member_id, coach_id, trial_booking_id")
        .eq("id", input.sourceBookingId)
        .eq("tenant_id", tenantId)
        .eq("operation_kind", "trial")
        .maybeSingle();
      if (sourceBookingResult.error || !sourceBookingResult.data?.member_id) {
        return apiError(404, "FORBIDDEN", "找不到這筆 FA 的學員資料");
      }
      const [sourceMemberResult, sourceTrialBookingResult] = await Promise.all([
        admin
          .from("members")
          .select("id, full_name, phone, birth_date")
          .eq("id", sourceBookingResult.data.member_id)
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        sourceBookingResult.data.trial_booking_id
          ? admin
              .from("trial_bookings")
              .select("id, name, phone, birthday")
              .eq("id", sourceBookingResult.data.trial_booking_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (sourceMemberResult.error || sourceTrialBookingResult.error || !sourceMemberResult.data) {
        return apiError(400, "FORBIDDEN", "FA 學員資料讀取失敗，請重新整理後再試");
      }
      const identity = resolveBigeTrialContractIdentity({
        trialBooking: sourceTrialBookingResult.data,
        member: sourceMemberResult.data,
      });
      sourceMissingProfileFields = getBigeTrialContractMissingProfileFields(identity);
      if (!identity.fullName || !identity.phone) {
        return apiError(400, "FORBIDDEN", "FA 姓名或電話資料不完整，請先補齊");
      }
      trustedMemberId = sourceMemberResult.data.id;
      trustedFullName = identity.fullName;
      trustedPhone = identity.phone;
      trustedBirthDate = identity.birthDate || null;
      trustedSalesOriginCoachId = sourceBookingResult.data.coach_id || null;
    }

    const trustedSignedOn = input.sourceBookingId ? toTaipeiDateString() : input.signedOn;
    const result = await operationSupabase.rpc("bige_create_member_contract_v5", {
      p_tenant_id: tenantId,
      p_branch_id: input.branchId || auth.context.branchId,
      p_member_id: trustedMemberId,
      p_source_booking_id: input.sourceBookingId || null,
      p_full_name: trustedFullName,
      p_phone: trustedPhone,
      p_birth_date: trustedBirthDate,
      p_email: trustedEmail,
      p_email_unavailable: trustedEmailUnavailable,
      p_plan_mode: input.planMode,
      p_plan_id: input.planId || null,
      p_custom_plan: input.planMode === "custom" ? input.customPlan : null,
      p_signed_on: trustedSignedOn,
      // The legacy RPC still has a PIN parameter. Keep it server-only while
      // the user-facing attendance PIN feature remains removed.
      p_pin: String(randomInt(0, 1_000_000)).padStart(6, "0"),
      p_initial_payment: input.initialPayment,
      p_payment_method: input.paymentMethod || null,
      p_installment_count: input.installmentCount || null,
      p_payment_schedule: input.paymentSchedule,
      p_future_trial_action: input.futureTrialAction || "none",
      p_fa_fee_recipient_profile_id: input.faFeeRecipientProfileId || null,
      p_fa_fee_recipient_name: input.faFeeRecipientName || null,
      p_sales_origin_coach_id: trustedSalesOriginCoachId,
      p_sales_origin_kind: input.sourceBookingId ? "fa" : input.sourceMemberBookingId ? "renewal" : "manual",
    });
    if (result.error) return handleDatabaseError(result.error, "建立正式會員失敗");

    let profileChangeNotification: { status: "skipped" | "sent" | "failed"; error?: string } = {
      status: "skipped",
    };
    const createdMemberId = String((result.data as Record<string, unknown> | null)?.memberId || "");
    const shouldNotifyManagerProfileChange =
      input.notifyManagerProfileChange || sourceMissingProfileFields.length > 0;
    if (shouldNotifyManagerProfileChange && createdMemberId) {
      const admin = createSupabaseAdminClient();
      const recipientsResult = await admin
        .from("profiles")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("department", "coaching")
        .in("position", ["coach_assistant_manager", "coach_manager"])
        .eq("is_active", true);
      if (recipientsResult.error) {
        profileChangeNotification = { status: "failed", error: recipientsResult.error.message };
      } else {
        const notificationResult = await createInAppNotifications({
          supabase: admin,
          tenantId,
          branchId: input.branchId || auth.context.branchId,
          recipientUserIds: (recipientsResult.data || []).map((profile) => String(profile.id)),
          title: "學員個資需要更改",
          message: sourceMissingProfileFields.length > 0
            ? `${trustedFullName} 的原始 FA 資料缺少${sourceMissingProfileFields.join("、")}，請主管補齊。`
            : `${trustedFullName} 的個人資料需要主管確認並更改。`,
          severity: "warning",
          eventType: "member_profile_change_requested",
          targetType: "member",
          targetId: createdMemberId,
          actionUrl: `/manager/members?memberId=${encodeURIComponent(createdMemberId)}&edit=personal-data`,
          payload: {
            memberId: createdMemberId,
            memberName: trustedFullName,
            sourceBookingId: input.sourceBookingId || null,
            missingProfileFields: sourceMissingProfileFields,
          },
          dedupeKey: `member-profile-change:${createdMemberId}:${input.sourceBookingId || "direct"}`,
          createdBy: operationContext.userId,
        });
        profileChangeNotification = notificationResult.ok
          ? { status: "sent" }
          : { status: "failed", error: notificationResult.error };
      }
    }

    return apiSuccess({ item: result.data, profileChangeNotification });
  }

  if (input.action === "record_payment") {
    if (!canRecordBigeContractPayment(operationContext)) {
      return apiError(403, "FORBIDDEN", "只有櫃台、教練副理或經理能登記付款");
    }
    if (
      (input.method === "ecpay_installment" && !input.installmentCount) ||
      (input.method !== "ecpay_installment" && input.installmentCount != null)
    ) {
      return apiError(
        400,
        "FORBIDDEN",
        input.method === "ecpay_installment"
          ? "請輸入綠界分期期數"
          : "只有綠界分期可以填寫分期期數",
      );
    }
    if (input.sourceBookingId) {
      const admin = createSupabaseAdminClient();
      const [sourceBookingResult, contractResult] = await Promise.all([
        admin
          .from("bookings")
          .select("id, member_id")
          .eq("id", input.sourceBookingId)
          .eq("tenant_id", tenantId)
          .eq("is_bige_schedule", true)
          .maybeSingle(),
        admin
          .from("member_plan_contracts")
          .select("id, member_id")
          .eq("id", input.contractId)
          .eq("tenant_id", tenantId)
          .maybeSingle(),
      ]);
      if (
        sourceBookingResult.error ||
        contractResult.error ||
        !sourceBookingResult.data?.member_id ||
        !contractResult.data?.member_id
      ) {
        return apiError(404, "FORBIDDEN", "找不到課程學員或付款合約");
      }
      if (sourceBookingResult.data.member_id !== contractResult.data.member_id) {
        return apiError(400, "FORBIDDEN", "課程學員與付款合約不一致");
      }
    }
    const result = await operationSupabase.rpc("bige_record_contract_payment_v2", {
      p_contract_id: input.contractId,
      p_schedule_item_id: input.scheduleItemId || null,
      p_payment_kind: input.paymentKind,
      p_amount: input.amount,
      p_method: input.method,
      p_installment_count: input.installmentCount || null,
      p_paid_at: input.paidAt || new Date().toISOString(),
      p_idempotency_key: input.idempotencyKey,
      p_note: input.note || null,
    });
    if (result.error) return handleDatabaseError(result.error, "付款紀錄失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "reverse_payment") {
    if (!isBigeContractRiskRequester(operationContext)) {
      return apiError(403, "FORBIDDEN", "只有教練經理或教練副理能退款或作廢");
    }

    if (!canDirectlyApproveBigeContractRisk(operationContext)) {
      const payment = await auth.supabase
        .from("bige_contract_payments")
        .select("id, contract_id, tenant_id, status")
        .eq("id", input.paymentId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (payment.error || !payment.data) {
        return apiError(404, "FORBIDDEN", "找不到付款紀錄");
      }
      if (payment.data.status !== "recorded") {
        return apiError(409, "FORBIDDEN", "此付款已退款或作廢");
      }

      const action = input.reversal === "refund"
        ? "bige_contract_payment_refund"
        : "bige_contract_payment_void";
      const requestResult = await auth.supabase
        .from("high_risk_action_requests")
        .insert({
          tenant_id: tenantId,
          branch_id: auth.context.branchId,
          requested_by: auth.context.userId,
          action,
          target_type: "bige_contract_payment",
          target_id: input.paymentId,
          owning_department: "coaching",
          reason: input.reason,
          payload: {
            contractId: payment.data.contract_id,
            reversal: input.reversal,
          },
        })
        .select("id, status, created_at")
        .maybeSingle();
      if (requestResult.error) {
        if (requestResult.error.code === "23505") {
          return apiError(409, "FORBIDDEN", "此付款已有待覆核申請");
        }
        return apiError(500, "INTERNAL_ERROR", requestResult.error.message);
      }

      await auth.supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor_id: auth.context.userId,
        action: "high_risk_request_created",
        target_type: "bige_contract_payment",
        target_id: input.paymentId,
        reason: input.reason,
        payload: { requestId: requestResult.data?.id, action },
      });
      if (requestResult.data?.id) {
        await notifyHighRiskRequestCreated({
          tenantId,
          branchId: auth.context.branchId,
          requestId: String(requestResult.data.id),
          action,
          targetType: "bige_contract_payment",
          targetId: input.paymentId,
          requestedBy: auth.context.userId,
        }).catch(() => null);
      }
      return apiSuccess({
        request: requestResult.data,
        pendingApproval: true,
        message: "已送交經理覆核，核准後才會執行退款或作廢",
      });
    }

    const result = await operationSupabase.rpc("bige_reverse_contract_payment", {
      p_payment_id: input.paymentId,
      p_action: input.reversal,
      p_reason: input.reason,
    });
    if (result.error) return handleDatabaseError(result.error, "退款或作廢失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "complete_booking") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const result = await auth.supabase.rpc("bige_complete_schedule_booking_without_pin", {
      p_booking_id: input.bookingId,
    });
    if (result.error) return handleDatabaseError(result.error, "完成上課失敗");

    const item = result.data as Record<string, any>;
    let emailDelivery: { status: string; error?: string | null } = { status: "skipped" };
    if (!item.replayed && item.memberEmail && !item.emailUnavailable) {
      const notifyResult = await sendNotification({
        channel: "email",
        target: String(item.memberEmail),
        templateKey: "BIG E 上課完成通知",
        message: [
          `${item.memberName} 您好：`,
          "",
          `您於 ${new Intl.DateTimeFormat("zh-TW", {
            timeZone: "Asia/Taipei",
            dateStyle: "long",
            timeStyle: "short",
          }).format(new Date(item.startsAt))} 完成 ${String(item.courseType)} 課程。`,
          "這次的投入已經替自己累積了一步，謝謝您今天認真完成訓練。",
          "",
          "BIG E FITNESS",
        ].join("\n"),
      });
      emailDelivery = {
        status: notifyResult.ok ? "sent" : "failed",
        error: notifyResult.error,
      };
      await insertDeliveryRows({
        supabase: auth.supabase,
        rows: [
          {
            tenantId,
            branchId: auth.context.branchId,
            bookingId: input.bookingId,
            memberId: item.memberId,
            sourceRefType: "fitness_session_completed",
            sourceRefId: input.bookingId,
            templateKey: "bige_session_completed",
            recipientName: item.memberName,
            recipientEmail: item.memberEmail,
            channel: "email",
            status: notifyResult.ok ? "sent" : "retrying",
            attempts: 1,
            nextRetryAt: notifyResult.ok ? null : new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
            sentAt: notifyResult.ok ? new Date().toISOString() : null,
            lastAttemptAt: new Date().toISOString(),
            errorMessage: notifyResult.error,
            deliveryMode: "provider",
            dedupeKey: `bige-session-completed:${input.bookingId}`,
            payload: {
              eventType: "fitness_session_completed",
              message: `${item.memberName} 您好，您已完成本次 BIG E FITNESS 課程。謝謝您今天認真完成訓練。`,
              emailSubject: "BIG E 上課完成通知",
            },
            createdBy: auth.context.userId,
          },
        ],
      });
    } else if (!item.replayed) {
      await insertDeliveryRows({
        supabase: auth.supabase,
        rows: [
          {
            tenantId,
            branchId: auth.context.branchId,
            bookingId: input.bookingId,
            memberId: item.memberId,
            sourceRefType: "fitness_session_completed",
            sourceRefId: input.bookingId,
            templateKey: "bige_session_completed",
            recipientName: item.memberName,
            channel: "email",
            status: "skipped",
            skippedReason: "member_email_unavailable",
            dedupeKey: `bige-session-completed:${input.bookingId}`,
            payload: { eventType: "fitness_session_completed" },
            createdBy: auth.context.userId,
          },
        ],
      });
    }
    return apiSuccess({ item, emailDelivery });
  }

  if (input.action === "complete_trial_outcome") {
    const bookingResult = await auth.supabase
      .from("bookings")
      .select("id, coach_id")
      .eq("id", input.bookingId)
      .eq("tenant_id", tenantId)
      .eq("is_bige_schedule", true)
      .eq("operation_kind", "trial")
      .maybeSingle();
    if (bookingResult.error) {
      return handleDatabaseError(bookingResult.error, "讀取 FA 預約失敗");
    }
    if (!bookingResult.data) {
      return apiError(404, "FORBIDDEN", "找不到這筆 FA 預約");
    }
    if (!canCompleteBigeTrialOutcome(auth.context, bookingResult.data.coach_id)) {
      return apiError(403, "FORBIDDEN", "一般教練只能處理自己的 FA 結果");
    }
    const result = await auth.supabase.rpc("bige_complete_trial_outcome_v2", {
      p_booking_id: input.bookingId,
      p_outcome: input.outcome,
      p_fa_fee_recipient_profile_id: input.faFeeRecipientProfileId || null,
      p_fa_fee_recipient_name: input.faFeeRecipientName || null,
    });
    if (result.error) return handleDatabaseError(result.error, "更新 FA 成交結果失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "change_trial_conversion_payment") {
    if (!canRecordBigeContractPayment(operationContext)) {
      return apiError(403, "FORBIDDEN", "只有櫃台、教練副理或經理能變更 FA 成交金額");
    }
    const result = await auth.supabase.rpc("bige_change_fa_conversion_payment", {
      p_booking_id: input.bookingId,
      p_amount: input.amount,
    });
    if (result.error) return handleDatabaseError(result.error, "變更 FA 成交金額失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "change_trial_conversion_outcome") {
    if (!canDirectlyApproveBigeContractRisk(operationContext)) {
      return apiError(403, "FORBIDDEN", "只有經理或系統管理員能將已成交 FA 改為未成交");
    }
    const result = await auth.supabase.rpc("bige_change_fa_conversion_outcome", {
      p_booking_id: input.bookingId,
      p_outcome: input.outcome,
    });
    if (result.error) return handleDatabaseError(result.error, "變更 FA 成交結果失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "restore_trial_conversion") {
    if (!canDirectlyApproveBigeContractRisk(operationContext)) {
      return apiError(403, "FORBIDDEN", "只有經理或系統管理員能復原 FA 成交");
    }
    const result = await auth.supabase.rpc("bige_restore_fa_conversion", {
      p_booking_id: input.bookingId,
    });
    if (result.error) return handleDatabaseError(result.error, "復原 FA 成交失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "restore_booking_completion") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const result = await auth.supabase.rpc("bige_restore_completed_schedule_booking", {
      p_booking_id: input.bookingId,
    });
    if (result.error) return handleDatabaseError(result.error, "復原扣堂狀態失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "restore_cancelled_booking") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const result = await auth.supabase.rpc("bige_restore_cancelled_schedule_booking", {
      p_booking_id: input.bookingId,
    });
    if (result.error) return handleDatabaseError(result.error, "復原課程失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "restore_no_show_booking") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const result = await auth.supabase.rpc("bige_restore_no_show_schedule_booking", {
      p_booking_id: input.bookingId,
    });
    if (result.error) return handleDatabaseError(result.error, "復原未出席狀態失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "delete_schedule_booking") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const bookingResult = await auth.supabase
      .from("bookings")
      .select("id, tenant_id, coach_id, operation_kind, starts_at, ends_at, status")
      .eq("id", input.bookingId)
      .eq("tenant_id", tenantId)
      .eq("is_bige_schedule", true)
      .maybeSingle();
    if (bookingResult.error || !bookingResult.data) {
      return apiError(404, "FORBIDDEN", "找不到這筆排課");
    }
    const booking = bookingResult.data;
    if (!isScheduleBookingDraggable(booking)) {
      return apiError(409, "FORBIDDEN", "只有尚未執行的預約可以從課表刪除");
    }

    const statusWindow = getBigeCourseStatusWindow({
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
    });
    let cancellationEmployeeNumber: string | null = null;
    if (
      !isBigeCourseStatusWindowExempt(operationContext) &&
      operationContext.role !== "supervisor"
    ) {
      const actorProfileResult = await createSupabaseAdminClient()
        .from("profiles")
        .select("employee_number")
        .eq("id", operationContext.userId)
        .maybeSingle();
      if (!actorProfileResult.error) {
        cancellationEmployeeNumber = actorProfileResult.data?.employee_number || null;
      }
    }
    const canDeleteAnytime = canCancelBigeCourseAnytime({
      ...operationContext,
      employeeNumber: cancellationEmployeeNumber,
    });
    if (!canDeleteAnytime && !statusWindow.allowed) {
      return apiError(400, "FORBIDDEN", "只能在預約前 30 分鐘至結束後 30 分鐘內刪除預約");
    }

    const now = new Date().toISOString();
    const result = await auth.supabase
      .from("bookings")
      .update({
        status: "cancelled",
        operation_result: "cancelled",
        status_reason: BIGE_SCHEDULE_TRASH_DELETE_REASON,
        cancelled_at: now,
        status_updated_at: now,
        updated_at: now,
      })
      .eq("id", booking.id)
      .eq("tenant_id", tenantId)
      .in("status", ["pending", "confirmed", "booked"])
      .select("id, status, operation_result")
      .maybeSingle();
    if (result.error) return handleDatabaseError(result.error, "刪除預約失敗");
    if (!result.data) return apiError(409, "FORBIDDEN", "預約狀態已變更，請重新整理後再試");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "update_schedule") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const bookingResult = await auth.supabase
      .from("bookings")
      .select("id, tenant_id, coach_id, operation_kind, starts_at, ends_at, status")
      .eq("id", input.bookingId)
      .eq("tenant_id", tenantId)
      .eq("is_bige_schedule", true)
      .maybeSingle();
    if (bookingResult.error || !bookingResult.data) {
      return apiError(404, "FORBIDDEN", "找不到這筆排課");
    }
    const booking = bookingResult.data;
    const statusWindow = getBigeCourseStatusWindow({
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
    });
    let cancellationEmployeeNumber: string | null = null;
    if (
      input.result === "cancelled" &&
      !isBigeCourseStatusWindowExempt(operationContext) &&
      operationContext.role !== "supervisor"
    ) {
      const actorProfileResult = await createSupabaseAdminClient()
        .from("profiles")
        .select("employee_number")
        .eq("id", operationContext.userId)
        .maybeSingle();
      if (!actorProfileResult.error) {
        cancellationEmployeeNumber = actorProfileResult.data?.employee_number || null;
      }
    }
    const canBypassStatusWindow =
      isBigeCourseStatusWindowExempt(operationContext) ||
      (input.result === "cancelled" &&
        canCancelBigeCourseAnytime({
          ...operationContext,
          employeeNumber: cancellationEmployeeNumber,
        }));
    if (!canBypassStatusWindow && !statusWindow.allowed) {
      return apiError(400, "FORBIDDEN", "只能在預約前 30 分鐘至結束後 30 分鐘內操作");
    }
    if (booking.operation_kind === "pt" && input.result === "completed") {
      return apiError(400, "FORBIDDEN", "請使用完成上課並扣除一堂");
    }
    if (booking.operation_kind === "pt" && booking.status === "completed" && input.result === "cancelled") {
      return apiError(400, "FORBIDDEN", "已完成課程請先復原扣堂狀態");
    }
    const status =
      input.result === "completed"
        ? "completed"
        : input.result === "no_show"
          ? "no_show"
          : input.result === "rescheduled"
            ? "cancelled"
            : "cancelled";
    const updates: Record<string, unknown> = {
      status,
      operation_result: input.result,
      status_reason: input.note || null,
      status_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (status === "completed") updates.completed_at = new Date().toISOString();
    if (status === "cancelled") updates.cancelled_at = new Date().toISOString();
    const result = await auth.supabase
      .from("bookings")
      .update(updates)
      .eq("id", booking.id)
      .select("id, status, operation_result")
      .single();
    if (result.error) return handleDatabaseError(result.error, "更新課程狀態失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "update_reminder") {
    if (!canManageBigeSchedule(auth.context)) {
      return apiError(403, "FORBIDDEN", "此帳號只有課表檢視權限");
    }
    const bookingResult = await auth.supabase
      .from("bookings")
      .update({
        reminder_status: input.status,
        reminder_updated_at: new Date().toISOString(),
        reminder_updated_by: auth.context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.bookingId)
      .eq("tenant_id", tenantId)
      .eq("operation_kind", "trial")
      .select("id, reminder_status")
      .single();
    if (bookingResult.error) return handleDatabaseError(bookingResult.error, "更新聯絡狀態失敗");
    const logResult = await auth.supabase.from("bige_trial_call_logs").insert({
      tenant_id: tenantId,
      booking_id: input.bookingId,
      status: input.status,
      note: input.note || null,
      created_by: auth.context.userId,
    });
    if (logResult.error) return handleDatabaseError(logResult.error, "聯絡紀錄寫入失敗");
    return apiSuccess({ item: bookingResult.data });
  }

  if (input.action === "extend_contract") {
    if (!isBigeContractRiskRequester(operationContext)) {
      return apiError(403, "FORBIDDEN", "只有教練經理或教練副理能辦理延期");
    }
    const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(input.signatureDataUrl);
    if (!match) return apiError(400, "FORBIDDEN", "簽名圖片格式錯誤");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 1_048_576) return apiError(400, "FORBIDDEN", "簽名圖片不可超過 1MB");
    const extension = match[1] === "image/jpeg" ? "jpg" : "png";
    const path = `${tenantId}/${input.contractId}/${crypto.randomUUID()}.${extension}`;
    const admin = createSupabaseAdminClient();
    const uploadResult = await admin.storage
      .from("bige-contract-signatures")
      .upload(path, bytes, { contentType: match[1], upsert: false });
    if (uploadResult.error) return apiError(500, "INTERNAL_ERROR", uploadResult.error.message);

    const statement = `本人 ${input.signedMemberName} 確認合約期限已到或即將到期，並同意本次延期 ${input.extensionDays} 天。`;

    if (!canDirectlyApproveBigeContractRisk(operationContext)) {
      const contract = await auth.supabase
        .from("member_plan_contracts")
        .select("id, tenant_id, branch_id, member_id")
        .eq("id", input.contractId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (contract.error || !contract.data) {
        await admin.storage.from("bige-contract-signatures").remove([path]);
        return apiError(404, "FORBIDDEN", "找不到合約");
      }

      const requestResult = await auth.supabase
        .from("high_risk_action_requests")
        .insert({
          tenant_id: tenantId,
          branch_id: contract.data.branch_id || auth.context.branchId,
          requested_by: auth.context.userId,
          action: "bige_contract_extension",
          target_type: "member_plan_contract",
          target_id: input.contractId,
          owning_department: "coaching",
          reason: input.reason,
          payload: {
            extensionDays: input.extensionDays,
            signaturePath: path,
            signatureStatement: statement,
            signedMemberName: input.signedMemberName,
            signedAt: input.signedAt,
            memberId: contract.data.member_id,
          },
        })
        .select("id, status, created_at")
        .maybeSingle();
      if (requestResult.error) {
        await admin.storage.from("bige-contract-signatures").remove([path]);
        if (requestResult.error.code === "23505") {
          return apiError(409, "FORBIDDEN", "此合約已有待覆核的延期申請");
        }
        return apiError(500, "INTERNAL_ERROR", requestResult.error.message);
      }

      await auth.supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor_id: auth.context.userId,
        action: "high_risk_request_created",
        target_type: "member_plan_contract",
        target_id: input.contractId,
        reason: input.reason,
        payload: {
          requestId: requestResult.data?.id,
          action: "bige_contract_extension",
          extensionDays: input.extensionDays,
        },
      });
      if (requestResult.data?.id) {
        await notifyHighRiskRequestCreated({
          tenantId,
          branchId: contract.data.branch_id || auth.context.branchId,
          requestId: String(requestResult.data.id),
          action: "bige_contract_extension",
          targetType: "member_plan_contract",
          targetId: input.contractId,
          requestedBy: auth.context.userId,
        }).catch(() => null);
      }
      return apiSuccess({
        request: requestResult.data,
        pendingApproval: true,
        message: "延期申請與學員簽名已送交經理覆核",
      });
    }

    const result = await operationSupabase.rpc("bige_extend_contract", {
      p_contract_id: input.contractId,
      p_extension_days: input.extensionDays,
      p_reason: input.reason,
      p_signature_path: path,
      p_signature_statement: statement,
      p_signed_member_name: input.signedMemberName,
      p_signed_at: input.signedAt,
    });
    if (result.error) {
      await admin.storage.from("bige-contract-signatures").remove([path]);
      return handleDatabaseError(result.error, "合約延期失敗");
    }

    const contractResult = await operationSupabase
      .from("member_plan_contracts")
      .select("member_id, branch_id")
      .eq("id", input.contractId)
      .single();
    let emailDelivery: { status: string; error?: string | null } = { status: "skipped" };
    if (contractResult.data?.member_id) {
      const memberResult = await operationSupabase
        .from("members")
        .select("full_name, email, email_unavailable")
        .eq("id", contractResult.data.member_id)
        .single();
      if (memberResult.data?.email && !memberResult.data.email_unavailable) {
        const notifyResult = await sendNotification({
          channel: "email",
          target: memberResult.data.email,
          templateKey: "BIG E 合約延期完成通知",
          message: [
            `${memberResult.data.full_name} 您好：`,
            "",
            `您的課程合約已完成延期 ${input.extensionDays} 天。`,
            `新的有效期限：${String((result.data as any)?.newEndsAt || "")}`,
            `辦理原因：${input.reason}`,
            "",
            "本次延期已由您現場簽名確認。如內容有疑問，請洽 BIG E FITNESS 櫃台。",
          ].join("\n"),
        });
        emailDelivery = {
          status: notifyResult.ok ? "sent" : "failed",
          error: notifyResult.error,
        };
        await insertDeliveryRows({
          supabase: operationSupabase,
          rows: [
            {
              tenantId,
              branchId: contractResult.data.branch_id,
              memberId: contractResult.data.member_id,
              sourceRefType: "fitness_contract_extended",
              sourceRefId: input.contractId,
              templateKey: "bige_contract_extended",
              recipientName: memberResult.data.full_name,
              recipientEmail: memberResult.data.email,
              channel: "email",
              status: notifyResult.ok ? "sent" : "retrying",
              attempts: 1,
              nextRetryAt: notifyResult.ok ? null : new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
              sentAt: notifyResult.ok ? new Date().toISOString() : null,
              lastAttemptAt: new Date().toISOString(),
              errorMessage: notifyResult.error,
              deliveryMode: "provider",
              dedupeKey: `bige-contract-extended:${String((result.data as any)?.extensionId || "")}`,
              payload: {
                eventType: "fitness_contract_extended",
                message: `${memberResult.data.full_name} 您好，您的 BIG E FITNESS 課程合約已完成延期 ${input.extensionDays} 天。`,
                emailSubject: "BIG E 合約延期完成通知",
              },
              createdBy: operationContext.userId,
            },
          ],
        });
      }
    }
    return apiSuccess({ item: result.data, emailDelivery });
  }

  if (input.action === "update_legacy_contract_purchase_date") {
    if (!canManageBigePlansAndDailyReports(operationContext)) {
      return apiError(403, "FORBIDDEN", "只有教練副理或主管能補登舊合約購買日");
    }
    if (input.purchaseDate > toTaipeiDateString()) {
      return apiError(400, "FORBIDDEN", "購買日不能晚於今天");
    }

    const contractResult = await operationSupabase
      .from("member_plan_contracts")
      .select(
        "id, member_id, contract_number, signed_on, ends_at, total_sessions, is_legacy_import",
      )
      .eq("tenant_id", tenantId)
      .eq("id", input.contractId)
      .maybeSingle();
    if (contractResult.error) {
      return handleDatabaseError(contractResult.error, "讀取舊合約失敗");
    }
    if (!contractResult.data) {
      return apiError(404, "FORBIDDEN", "找不到這份合約");
    }
    if (!contractResult.data.is_legacy_import) {
      return apiError(400, "FORBIDDEN", "只有舊資料匯入合約能從日報補登購買日");
    }

    const expectedExpiryDate = calculateLegacyContractExpiryDate(
      input.purchaseDate,
      Number(contractResult.data.total_sessions),
    );
    const now = new Date().toISOString();
    const updateResult = await operationSupabase
      .from("member_plan_contracts")
      .update({
        signed_on: input.purchaseDate,
        purchase_date_recorded_at: now,
        purchase_date_recorded_by: operationContext.userId,
        updated_by: operationContext.userId,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", input.contractId)
      .eq("is_legacy_import", true)
      .select(
        "id, member_id, contract_number, signed_on, starts_at, ends_at, original_ends_at, total_sessions, remaining_sessions, status, is_legacy_import, purchase_date_recorded_at",
      )
      .single();
    if (updateResult.error) {
      return handleDatabaseError(updateResult.error, "補登購買日失敗");
    }

    await operationSupabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: operationContext.userId,
      action: "legacy_contract_purchase_date_recorded",
      target_type: "member_plan_contract",
      target_id: input.contractId,
      reason: "daily_closure_purchase_date_reminder",
      payload: {
        previousPurchaseDate: contractResult.data.signed_on,
        previousEndsAt: contractResult.data.ends_at,
        purchaseDate: input.purchaseDate,
        expectedExpiryDate,
        totalSessions: contractResult.data.total_sessions,
      },
    });

    return apiSuccess({ item: updateResult.data, expectedExpiryDate });
  }

  if (input.action === "confirm_day" || input.action === "reopen_day") {
    if (!canDirectlyApproveBigeContractRisk(operationContext)) {
      return apiError(403, "FORBIDDEN", "副理可先完成初審；只有教練經理或城市經理能正式結算或重開日報");
    }
    if (input.action === "reopen_day" && !input.reason) {
      return apiError(400, "FORBIDDEN", "重開日報必須填寫原因");
    }
    if (input.action === "confirm_day") {
      let missingPurchaseDates;
      try {
        missingPurchaseDates = await loadLegacyPurchaseDateReminders(
          operationSupabase,
          tenantId,
          input.businessDate,
          input.branchId || auth.context.branchId,
        );
      } catch (error) {
        return apiError(
          500,
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : "舊合約購買日檢查失敗",
        );
      }
      if (missingPurchaseDates.length > 0) {
        return apiError(
          409,
          "FORBIDDEN",
          `尚有 ${missingPurchaseDates.length} 份舊合約未輸入購買日，請先完成日報提醒項目`,
        );
      }
    }
    let snapshot;
    try {
      snapshot = await buildDailySnapshot(
        { context: operationContext, supabase: operationSupabase } as AuthContext,
        tenantId,
        input.businessDate,
        input.branchId || auth.context.branchId,
      );
    } catch (error) {
      return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "日報產生失敗");
    }
    const now = new Date().toISOString();
    const isConfirm = input.action === "confirm_day";
    const closureResult = await operationSupabase
      .from("bige_daily_closures")
      .upsert(
        {
          tenant_id: tenantId,
          branch_id: input.branchId || auth.context.branchId,
          business_date: input.businessDate,
          status: isConfirm ? "confirmed" : "reopened",
          snapshot,
          confirmed_by: isConfirm ? operationContext.userId : null,
          confirmed_at: isConfirm ? now : null,
          reopened_by: isConfirm ? null : operationContext.userId,
          reopened_at: isConfirm ? null : now,
          reopen_reason: isConfirm ? null : input.reason,
          updated_at: now,
        },
        { onConflict: "tenant_id,branch_id,business_date" },
      )
      .select("id, status, revision, snapshot, confirmed_at, reopened_at, reopen_reason")
      .single();
    if (closureResult.error) return handleDatabaseError(closureResult.error, "日報更新失敗");
    await operationSupabase.from("bige_daily_closure_history").insert({
      tenant_id: tenantId,
      closure_id: closureResult.data.id,
      action: isConfirm ? "confirmed" : "reopened",
      reason: input.reason || null,
      snapshot,
      actor_id: operationContext.userId,
    });
    return apiSuccess({ item: closureResult.data });
  }

  return NextResponse.json({ ok: false, message: "Unsupported action" }, { status: 400 });
}
