import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { apiError, apiSuccess, requireProfile, type ProfileContext } from "../../../lib/auth-context";
import {
  BIGE_MANAGER_ROLES,
  bigeFitnessActionSchema,
  calculateContractTerms,
  getZodMessage,
  toTaipeiDateString,
  validateCourseAllocationTotal,
} from "../../../lib/bige-fitness";
import { sendNotification } from "../../../lib/integrations/notify";
import { insertDeliveryRows } from "../../../lib/notification-ops";
import { verifySensitiveOperator } from "../../../lib/sensitive-reauth";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type AuthContext = Awaited<ReturnType<typeof requireProfile>> extends infer Result
  ? Result extends { ok: true; context: infer Context; supabase: infer Supabase }
    ? { context: Context; supabase: Supabase }
    : never
  : never;

const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "booked", "checked_in"];
const SENSITIVE_ACTIONS = new Set([
  "create_plan",
  "create_contract",
  "record_payment",
  "reverse_payment",
  "extend_contract",
  "confirm_day",
  "reopen_day",
]);

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

function normalizeErrorMessage(message: string) {
  const key = message.split("\n")[0]?.trim() || message;
  const messages: Record<string, string> = {
    forbidden: "您沒有此操作權限",
    invalid_time_range: "結束時間必須晚於開始時間",
    outside_business_hours: "排課時間必須介於 09:00 到 24:00，並使用整點或 30 分",
    coach_capacity_exceeded: "這位教練在同一時段最多只能帶 3 位學員",
    group_course_type_mismatch: "同一位教練同時帶的學員必須是相同課別",
    shared_equipment_capacity_exceeded: "器械皮拉提斯與放鬆課同時最多共 2 位學員",
    member_time_conflict: "這位學員在同一時段已有安排",
    completed_trial_required: "只有實際完成的 FA 才能成交",
    trial_already_converted: "這筆 FA 已經完成成交",
    existing_member_requires_selection: "資料符合現有會員，請先選擇該會員",
    fitness_plan_not_found: "找不到可用的正式課程方案",
    fitness_plan_invalid: "方案的價格、堂數或課別分配不完整",
    minimum_deposit_not_met: "首次付款不得低於此方案一堂課的金額",
    payment_schedule_total_mismatch: "付款排程加總必須等於合約總價",
    payment_reversal_reason_required: "退款或作廢必須填寫原因",
    attendance_pin_invalid: "學員輸入的 6 位密碼不正確",
    attendance_pin_setup_required: "學員尚未設定上課密碼",
    outside_completion_window: "只能在預約前 30 分鐘至結束後 30 分鐘內操作",
    eligible_contract_not_found: "找不到可扣堂且課別相符的合約",
    unlocked_sessions_exhausted: "目前已付款金額沒有可用堂數",
    course_allocation_exhausted: "這個課別的堂數已用完",
    contract_extension_required: "合約期限已到，需由主管完成延期與學員簽名",
    extension_window_not_open: "到期前 30 天才可辦理延期",
    extension_limit_exceeded: "延期天數超過此合約可延期上限",
    no_remaining_sessions_to_extend: "此合約沒有可延期的剩餘堂數",
    manager_required: "此操作僅限主管",
    email_or_unavailable_required: "請填寫有效 Email，或明確勾選沒有 Email",
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

export async function GET(request: Request) {
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

  const branchId = url.searchParams.get("branchId") || auth.context.branchId;
  const search = (url.searchParams.get("search") || "").trim().slice(0, 60);
  if (search) {
    const escaped = search.replace(/[%_]/g, (value) => `\\${value}`).replace(/[(),]/g, " ");
    const membersResult = await auth.supabase
      .from("members")
      .select(
        "id, full_name, phone, email, email_unavailable, birth_date, member_code, photo_url, is_prospect, attendance_pin_set_at, attendance_pin_reset_required",
      )
      .eq("tenant_id", tenantId)
      .or(`full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%,member_code.ilike.%${escaped}%`)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (membersResult.error) return apiError(500, "INTERNAL_ERROR", membersResult.error.message);

    let trials: any[] = [];
    if (auth.context.role !== "coach") {
      const trialResult = await auth.supabase
        .from("trial_bookings")
        .select(
          "id, member_id, name, phone, birthday, service, appointment_date, appointment_time, booking_status, note",
        )
        .or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (trialResult.error) return apiError(500, "INTERNAL_ERROR", trialResult.error.message);
      trials = trialResult.data || [];
    }
    return apiSuccess({ members: membersResult.data || [], trials });
  }

  const memberId = url.searchParams.get("memberId");
  if (memberId) {
    const [memberResult, contractsResult] = await Promise.all([
      auth.supabase
        .from("members")
        .select(
          "id, full_name, phone, email, email_unavailable, birth_date, member_code, photo_url, is_prospect, attendance_pin_set_at, attendance_pin_reset_required",
        )
        .eq("tenant_id", tenantId)
        .eq("id", memberId)
        .maybeSingle(),
      auth.supabase
        .from("member_plan_contracts")
        .select(
          "id, contract_number, plan_catalog_id, status, payment_status, signed_on, starts_at, ends_at, total_sessions, total_amount, unlocked_sessions, used_sessions, remaining_sessions, course_allocations, course_used, extension_limit_days, extension_used_days, original_ends_at",
        )
        .eq("tenant_id", tenantId)
        .eq("member_id", memberId)
        .not("total_sessions", "is", null)
        .order("created_at", { ascending: false }),
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
              .select("id, contract_id, payment_kind, amount, method, status, paid_at, note")
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
    return apiSuccess({
      member: memberResult.data,
      contracts,
      paymentSchedule: scheduleResult.data || [],
      payments: paymentsResult.data || [],
      extensions: extensionsResult.data || [],
    });
  }

  const range = taipeiRange(businessDate);

  let bookingsQuery = auth.supabase
    .from("bookings")
    .select(
      "id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, note, operation_kind, course_type, trial_stage, operation_result, trial_booking_id, group_id, reminder_status, converted_at, converted_contract_id, member_plan_contract_id",
    )
    .eq("tenant_id", tenantId)
    .eq("is_bige_schedule", true)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at", { ascending: true });
  if (branchId) bookingsQuery = bookingsQuery.eq("branch_id", branchId);
  if (auth.context.role === "coach") bookingsQuery = bookingsQuery.eq("coach_id", auth.context.userId);

  let notesQuery = auth.supabase
    .from("bige_schedule_notes")
    .select("id, branch_id, coach_id, starts_at, ends_at, content, updated_at")
    .eq("tenant_id", tenantId)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at", { ascending: true });
  if (branchId) notesQuery = notesQuery.eq("branch_id", branchId);
  if (auth.context.role === "coach") notesQuery = notesQuery.eq("coach_id", auth.context.userId);

  let coachesQuery = auth.supabase
    .from("profiles")
    .select("id, branch_id, display_name, role, is_active")
    .eq("tenant_id", tenantId)
    .in("role", ["coach", "therapist"])
    .eq("is_active", true)
    .order("display_name");
  if (branchId) coachesQuery = coachesQuery.or(`branch_id.eq.${branchId},branch_id.is.null`);
  if (auth.context.role === "coach") coachesQuery = coachesQuery.eq("id", auth.context.userId);

  const [bookingsResult, notesResult, coachesResult, plansResult, closureResult] = await Promise.all([
    bookingsQuery,
    notesQuery,
    coachesQuery,
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
  ]);

  for (const result of [bookingsResult, notesResult, coachesResult, plansResult, closureResult]) {
    if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);
  }

  const bookings = bookingsResult.data || [];
  const memberIds = [...new Set(bookings.map((row: any) => row.member_id).filter(Boolean))];
  const membersResult =
    memberIds.length > 0
      ? await auth.supabase
          .from("members")
          .select(
            "id, full_name, phone, email, email_unavailable, birth_date, member_code, photo_url, is_prospect, attendance_pin_set_at, attendance_pin_reset_required",
          )
          .eq("tenant_id", tenantId)
          .in("id", memberIds)
      : { data: [], error: null };
  if (membersResult.error) return apiError(500, "INTERNAL_ERROR", membersResult.error.message);

  let expiringContracts: any[] = [];
  if (isManager(auth.context) || auth.context.role === "frontdesk" || auth.context.department === "general_affairs") {
    const expiryEnd = `${addDays(toTaipeiDateString(), 31)}T00:00:00+08:00`;
    const contractsResult = await auth.supabase
      .from("member_plan_contracts")
      .select(
        "id, member_id, contract_number, ends_at, total_sessions, unlocked_sessions, used_sessions, remaining_sessions, extension_limit_days, extension_used_days, status, payment_status",
      )
      .eq("tenant_id", tenantId)
      .not("total_sessions", "is", null)
      .gt("remaining_sessions", 0)
      .lt("ends_at", expiryEnd)
      .order("ends_at", { ascending: true })
      .limit(200);
    if (contractsResult.error) return apiError(500, "INTERNAL_ERROR", contractsResult.error.message);
    expiringContracts = contractsResult.data || [];
  }

  return apiSuccess({
    businessDate,
    role: auth.context.role,
    tenantId,
    branchId,
    bookings,
    notes: notesResult.data || [],
    coaches: coachesResult.data || [],
    members: membersResult.data || [],
    plans: plansResult.data || [],
    closure: closureResult.data || null,
    expiringContracts,
    rules: {
      openHour: 9,
      closeHour: 24,
      slotMinutes: 30,
      maxStudentsPerCoach: 3,
      sharedPilatesRelaxationCapacity: 2,
      weightTrainingCapacity: null,
      operationWindowMinutes: 30,
    },
  });
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

  let operationSupabase = auth.supabase;
  let operationContext: Pick<
    ProfileContext,
    "userId" | "role" | "department" | "position" | "tenantId" | "branchId"
  > = auth.context;
  if (SENSITIVE_ACTIONS.has(input.action)) {
    const reauthenticated = await verifySensitiveOperator({
      session: auth.context,
      credentials:
        payload && typeof payload === "object"
          ? ((payload as { reauth?: unknown }).reauth as
              | { account?: string; password?: string; reason?: string }
              | undefined)
          : undefined,
    });
    if (!reauthenticated.ok) {
      return apiError(401, "UNAUTHORIZED", reauthenticated.message);
    }
    operationContext = reauthenticated.operator;
    operationSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      {
        accessToken: async () => reauthenticated.accessToken,
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ) as typeof auth.supabase;
  }

  if (input.action === "create_schedule") {
    if (auth.context.role === "coach") return apiError(403, "FORBIDDEN", "教練不能建立排課");
    const result = await auth.supabase.rpc("bige_create_schedule_booking", {
      p_tenant_id: tenantId,
      p_branch_id: input.branchId || auth.context.branchId,
      p_member_id: input.memberId || null,
      p_trial_booking_id: input.trialBookingId || null,
      p_coach_id: input.coachId,
      p_operation_kind: input.operationKind,
      p_course_type: input.courseType,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_note: input.note || null,
      p_group_id: input.groupId || null,
      p_idempotency_key: input.idempotencyKey,
    });
    if (result.error) return handleDatabaseError(result.error, "建立排課失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "create_note") {
    if (auth.context.role === "coach" && input.coachId !== auth.context.userId) {
      return apiError(403, "FORBIDDEN", "教練只能編輯自己的行程備註");
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

  if (input.action === "create_plan") {
    if (!isManager(operationContext)) return apiError(403, "FORBIDDEN", "只有教練經理或城市經理能建立方案");
    if (!validateCourseAllocationTotal(input.allocations, input.totalSessions)) {
      return apiError(400, "FORBIDDEN", "三種課別分配加總必須等於總堂數");
    }
    const terms = calculateContractTerms(input.totalSessions);
    const result = await operationSupabase
      .from("member_plan_catalog")
      .insert({
        tenant_id: tenantId,
        branch_id: auth.context.branchId,
        code: input.code.toLowerCase(),
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

  if (input.action === "create_contract") {
    if (operationContext.role === "coach") return apiError(403, "FORBIDDEN", "教練不能建立合約");
    if (input.emailUnavailable && input.email) {
      return apiError(400, "FORBIDDEN", "已有 Email 時請不要勾選沒有 Email");
    }
    const result = await operationSupabase.rpc("bige_create_member_contract", {
      p_tenant_id: tenantId,
      p_branch_id: input.branchId || auth.context.branchId,
      p_member_id: input.memberId || null,
      p_source_booking_id: input.sourceBookingId || null,
      p_full_name: input.fullName,
      p_phone: input.phone,
      p_birth_date: input.birthDate,
      p_email: input.email || null,
      p_email_unavailable: input.emailUnavailable,
      p_plan_id: input.planId,
      p_signed_on: input.signedOn,
      p_pin: input.pin,
      p_initial_payment: input.initialPayment,
      p_payment_method: input.paymentMethod || null,
      p_payment_schedule: input.paymentSchedule,
      p_future_trial_action: input.futureTrialAction || "none",
    });
    if (result.error) return handleDatabaseError(result.error, "建立正式會員失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "record_payment") {
    if (operationContext.role === "coach") return apiError(403, "FORBIDDEN", "教練不能登記付款");
    const result = await operationSupabase.rpc("bige_record_contract_payment", {
      p_contract_id: input.contractId,
      p_schedule_item_id: input.scheduleItemId || null,
      p_payment_kind: input.paymentKind,
      p_amount: input.amount,
      p_method: input.method,
      p_paid_at: input.paidAt || new Date().toISOString(),
      p_idempotency_key: input.idempotencyKey,
      p_note: input.note || null,
    });
    if (result.error) return handleDatabaseError(result.error, "付款紀錄失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "reverse_payment") {
    if (!isManager(operationContext)) return apiError(403, "FORBIDDEN", "只有教練經理或城市經理能退款或作廢");
    const result = await operationSupabase.rpc("bige_reverse_contract_payment", {
      p_payment_id: input.paymentId,
      p_action: input.reversal,
      p_reason: input.reason,
    });
    if (result.error) return handleDatabaseError(result.error, "退款或作廢失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "set_pin") {
    const result = await auth.supabase.rpc("bige_set_attendance_pin", {
      p_member_id: input.memberId,
      p_pin: input.pin,
    });
    if (result.error) return handleDatabaseError(result.error, "密碼設定失敗");
    return apiSuccess({ item: result.data });
  }

  if (input.action === "complete_booking") {
    const result = await auth.supabase.rpc("bige_complete_schedule_booking", {
      p_booking_id: input.bookingId,
      p_pin: input.pin,
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

  if (input.action === "update_schedule") {
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
    if (auth.context.role === "coach" && booking.coach_id !== auth.context.userId) {
      return apiError(403, "FORBIDDEN", "教練只能操作自己的課程");
    }
    const now = Date.now();
    const earliest = new Date(booking.starts_at).getTime() - 30 * 60_000;
    const latest = new Date(booking.ends_at).getTime() + 30 * 60_000;
    if (now < earliest || now > latest) {
      return apiError(400, "FORBIDDEN", "只能在預約前 30 分鐘至結束後 30 分鐘內操作");
    }
    if (booking.operation_kind === "pt" && input.result === "completed") {
      return apiError(400, "FORBIDDEN", "PT 完成必須由學員輸入 6 位密碼");
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
    if (auth.context.role === "coach") return apiError(403, "FORBIDDEN", "教練不能操作 FA 聯絡清單");
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
    if (!isManager(operationContext)) return apiError(403, "FORBIDDEN", "只有教練經理或城市經理能辦理延期");
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

  if (input.action === "confirm_day" || input.action === "reopen_day") {
    if (!isManager(operationContext)) return apiError(403, "FORBIDDEN", "只有教練經理或城市經理能確認或重開日報");
    if (input.action === "reopen_day" && !input.reason) {
      return apiError(400, "FORBIDDEN", "重開日報必須填寫原因");
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
