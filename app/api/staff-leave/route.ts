import { createHash } from "node:crypto";
import { z } from "zod";
import {
  apiError,
  apiSuccess,
  requireProfile,
  type ProfileContext,
} from "../../../lib/auth-context";
import { createInAppNotifications } from "../../../lib/in-app-notifications";
import { hasStaffPermission, requireStaffPermission } from "../../../lib/staff-operation-permissions";
import { writeStaffAudit } from "../../../lib/staff-audit";
import { syncApprovedLeaveToSchedule } from "../../../lib/staff-leave-schedule-sync";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

export const runtime = "nodejs";
const STAFF_ROLES = [
  "platform_admin",
  "manager",
  "supervisor",
  "branch_manager",
  "store_owner",
  "store_manager",
  "frontdesk",
  "coach",
  "therapist",
  "sales",
] as const;
const finalRoles = new Set([
  "platform_admin",
  "manager",
  "branch_manager",
  "store_owner",
  "store_manager",
]);
const assistantPositions = new Set([
  "general_affairs_assistant_manager",
  "coach_assistant_manager",
]);
const finalPositions = new Set([
  "general_affairs_manager",
  "coach_manager",
  "coach_city_manager",
]);
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type ProfileRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  display_name: string | null;
  english_name: string | null;
  employee_number: string | null;
};
function canAssistant(context: ProfileContext) {
  return (
    context.role === "platform_admin" ||
    context.role === "supervisor" ||
    (!!context.position && assistantPositions.has(context.position))
  );
}
function canFinal(context: ProfileContext) {
  return (
    finalRoles.has(context.role) ||
    (!!context.position && finalPositions.has(context.position))
  );
}
function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月份格式錯誤");
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${month}-01T00:00:00+08:00`,
    end: `${month}-${String(end).padStart(2, "0")}T23:59:59+08:00`,
  };
}
async function getProfile(admin: AdminClient, id: string) {
  const result = await admin
    .from("profiles")
    .select(
      "id, tenant_id, branch_id, display_name, english_name, employee_number",
    )
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("找不到員工帳號");
  return result.data as ProfileRow;
}
function rules(type: string) {
  if (type === "annual") return { units: ["full_day"], proof: false };
  if (type === "sick") return { units: ["full_day", "half_day"], proof: true };
  if (type === "personal")
    return { units: ["full_day", "half_day"], proof: false };
  if (type === "family_care")
    return { units: ["hourly", "half_day", "full_day"], proof: true };
  if (["marriage", "bereavement", "official", "other"].includes(type))
    return { units: ["actual", "hourly", "full_day"], proof: true };
  throw new Error("不支援的假別");
}
function durationMinutes(startsAt: string, endsAt: string, unit: string) {
  const diff = Math.round(
    (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000,
  );
  if (!Number.isFinite(diff) || diff <= 0)
    throw new Error("請假結束時間必須晚於開始時間");
  if (unit === "full_day") return 480;
  if (unit === "half_day") return 240;
  return diff;
}
function decodeFile(file: File) {
  if (file.size <= 0 || file.size > 15 * 1024 * 1024)
    throw new Error("證明附件必須小於 15MB");
  const allowed = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  ]);
  if (!allowed.has(file.type))
    throw new Error("證明附件只接受 JPG、PNG、WebP 或 PDF");
  return file;
}

async function loadState(
  admin: AdminClient,
  user: ProfileRow,
  context: ProfileContext,
  month: string,
) {
  const tenantId = user.tenant_id;
  if (!tenantId) throw new Error("帳號尚未設定館別");
  const period = monthRange(month);
  const manager = await hasStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context, permission: "review_leave_requests" });
  let query = admin
    .from("staff_leave_requests")
    .select(
      "*, staff_leave_attachments(id, file_name, mime_type, byte_size, uploaded_at)",
    )
    .eq("tenant_id", tenantId)
    .lte("starts_at", period.end)
    .gte("ends_at", period.start)
    .order("starts_at", { ascending: false });
  if (!manager) query = query.eq("employee_id", user.id);
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  const requests = result.data || [];
  const employeeIds = Array.from(
    new Set(requests.map((item) => String(item.employee_id))),
  );
  const employees = employeeIds.length
    ? await admin
        .from("profiles")
        .select("id, display_name, english_name, employee_number")
        .in("id", employeeIds)
    : { data: [], error: null };
  if (employees.error) throw new Error(employees.error.message);
  return {
    actor: {
      id: user.id,
      canManage: manager,
      canAssistant: manager && canAssistant(context),
      canFinal: manager && canFinal(context),
    },
    month,
    employees: employees.data || [],
    requests: requests.map((item) => ({
      ...item,
      proofOverdue:
        item.proof_required &&
        !item.staff_leave_attachments?.length &&
        item.proof_due_at &&
        new Date(item.proof_due_at).getTime() < Date.now(),
    })),
  };
}

async function storeAttachment(
  admin: AdminClient,
  tenantId: string,
  employeeId: string,
  requestId: string,
  file: File,
) {
  decodeFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const safeName =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "proof";
  const objectPath = `${tenantId}/${employeeId}/${requestId}-${Date.now()}-${safeName}`;
  const upload = await admin.storage
    .from("staff-leave-proofs")
    .upload(objectPath, buffer, { contentType: file.type, upsert: false });
  if (upload.error) throw new Error(upload.error.message);
  const insert = await admin
    .from("staff_leave_attachments")
    .insert({
      request_id: requestId,
      tenant_id: tenantId,
      employee_id: employeeId,
      object_path: objectPath,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
      sha256,
    });
  if (insert.error) throw new Error(insert.error.message);
}

export async function GET(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const month =
      url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    monthRange(month);
    const admin = createSupabaseAdminClient();
    const user = await getProfile(admin, auth.context.userId);
    return apiSuccess(await loadState(admin, user, auth.context, month));
  } catch (error) {
    return apiError(
      400,
      "FORBIDDEN",
      error instanceof Error ? error.message : "無法讀取請假資料",
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  try {
    const user = await getProfile(admin, auth.context.userId);
    const tenantId = user.tenant_id;
    if (!tenantId) throw new Error("帳號尚未設定館別");
    const contentType = request.headers.get("content-type") || "";
    let month = new Date().toISOString().slice(0, 7);
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const action = String(form.get("action") || "");
      month = String(form.get("month") || month);
      monthRange(month);
      if (action === "submit_leave") {
        const leaveType = z
          .enum([
            "annual",
            "sick",
            "personal",
            "family_care",
            "marriage",
            "bereavement",
            "official",
            "other",
          ])
          .parse(String(form.get("leaveType") || ""));
        const unit = z
          .enum(["full_day", "half_day", "hourly", "actual"])
          .parse(String(form.get("unit") || ""));
        const rule = rules(leaveType);
        if (!rule.units.includes(unit))
          throw new Error("此假別不支援所選的時間單位");
        const startsAt = z
          .string()
          .datetime({ offset: true })
          .parse(String(form.get("startsAt") || ""));
        const endsAt = z
          .string()
          .datetime({ offset: true })
          .parse(String(form.get("endsAt") || ""));
        const reason = String(form.get("reason") || "").trim();
        const file = form.get("file");
        const requestInsert = await admin
          .from("staff_leave_requests")
          .insert({
            tenant_id: tenantId,
            branch_id: user.branch_id,
            employee_id: user.id,
            leave_type: leaveType,
            starts_at: startsAt,
            ends_at: endsAt,
            duration_minutes: durationMinutes(startsAt, endsAt, unit),
            unit,
            reason: reason || null,
            proof_required: rule.proof,
            proof_due_at: rule.proof
              ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
              : null,
            status: "assistant_review",
          })
          .select("id")
          .single();
        if (requestInsert.error) throw new Error(requestInsert.error.message);
        if (file instanceof File && file.size > 0)
          await storeAttachment(
            admin,
            tenantId,
            user.id,
            requestInsert.data.id,
            file,
          );
        await writeStaffAudit({
          supabase: admin,
          request,
          tenantId,
          actorId: user.id,
          action: "staff_leave_submitted",
          targetType: "staff_leave_request",
          targetId: requestInsert.data.id,
          after: { leaveType, unit, startsAt, endsAt, proofRequired: rule.proof },
        });
        await createInAppNotifications({
          supabase: admin,
          tenantId,
          recipientRoles: ["supervisor"],
          title: "新請假單等待副理檢查",
          message: `${user.display_name || user.employee_number || "員工"}已送出請假申請。`,
          eventType: "staff_leave_assistant_review",
          targetType: "staff_leave_request",
          targetId: requestInsert.data.id,
          actionUrl: `/manager/staff-leave?month=${month}`,
          dedupeKey: `staff-leave-assistant:${requestInsert.data.id}`,
          createdBy: user.id,
        });
      } else if (action === "supplement_proof") {
        const requestId = z
          .string()
          .uuid()
          .parse(String(form.get("requestId") || ""));
        const file = form.get("file");
        if (!(file instanceof File)) throw new Error("請選擇證明附件");
        const leaveRequest = await admin
          .from("staff_leave_requests")
          .select("id")
          .eq("id", requestId)
          .eq("employee_id", user.id)
          .maybeSingle();
        if (leaveRequest.error || !leaveRequest.data)
          throw new Error("找不到您的請假單");
        await storeAttachment(admin, tenantId, user.id, requestId, file);
        await writeStaffAudit({
          supabase: admin,
          request,
          tenantId,
          actorId: user.id,
          action: "staff_leave_proof_supplemented",
          targetType: "staff_leave_request",
          targetId: requestId,
          payload: { fileName: file.name, mimeType: file.type, byteSize: file.size },
        });
      } else throw new Error("不支援的請假操作");
    } else {
      const body = z
        .object({
          action: z.string(),
          month: z.string().regex(/^\d{4}-\d{2}$/),
        })
        .passthrough()
        .parse(await request.json());
      month = body.month;
      if (body.action === "review") {
        await requireStaffPermission({ supabase: admin, tenantId, employeeId: user.id, context: auth.context, permission: "review_leave_requests", message: "您沒有覆核請假的權限" });
        const requestId = z.string().uuid().parse(body.requestId);
        const stage = z
          .enum(["assistant_manager", "manager"])
          .parse(body.stage);
        const decision = z
          .enum(["approved", "rejected", "returned", "adjustment_proposed"])
          .parse(body.decision);
        const reason =
          z.string().trim().max(2000).optional().parse(body.reason) || "";
        if (stage === "assistant_manager" && !canAssistant(auth.context))
          return apiError(403, "FORBIDDEN", "只有副理可初審請假單");
        if (stage === "manager" && !canFinal(auth.context))
          return apiError(403, "FORBIDDEN", "只有經理可最終核准請假單");
        if (decision !== "approved" && !reason)
          throw new Error("退回、駁回或建議調整日期時必須填寫理由");
        const requestResult = await admin
          .from("staff_leave_requests")
          .select("*")
          .eq("id", requestId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (requestResult.error || !requestResult.data)
          throw new Error("找不到請假單");
        const leave = requestResult.data;
        const proposedStartsAt = body.proposedStartsAt
          ? z.string().datetime({ offset: true }).parse(body.proposedStartsAt)
          : null;
        const proposedEndsAt = body.proposedEndsAt
          ? z.string().datetime({ offset: true }).parse(body.proposedEndsAt)
          : null;
        if (
          decision === "adjustment_proposed" &&
          (!proposedStartsAt || !proposedEndsAt)
        )
          throw new Error("建議調整日期時必須填入新起訖時間");
        if (stage === "manager") {
          if (leave.assistant_decision !== "approved")
            throw new Error("請假單必須先由副理初審通過");
          if (String(leave.assistant_decided_by) === user.id)
            throw new Error("副理初審與經理終審必須由不同帳號完成");
        }
        const patch =
          stage === "assistant_manager"
            ? {
                assistant_decision: decision,
                assistant_reason: reason || null,
                assistant_decided_by: user.id,
                assistant_decided_at: new Date().toISOString(),
                status:
                  decision === "approved"
                    ? "manager_review"
                    : decision === "adjustment_proposed"
                      ? "adjustment_proposed"
                      : decision === "rejected"
                        ? "rejected"
                        : "assistant_review",
                proposed_starts_at: proposedStartsAt,
                proposed_ends_at: proposedEndsAt,
              }
            : {
                manager_decision: decision,
                manager_reason: reason || null,
                manager_decided_by: user.id,
                manager_decided_at: new Date().toISOString(),
                status:
                  decision === "approved"
                    ? "approved"
                    : decision === "adjustment_proposed"
                      ? "adjustment_proposed"
                      : decision === "rejected"
                        ? "rejected"
                        : "manager_review",
                proposed_starts_at: proposedStartsAt,
                proposed_ends_at: proposedEndsAt,
              };
        const update = await admin
          .from("staff_leave_requests")
          .update(patch)
          .eq("id", requestId);
        if (update.error) throw new Error(update.error.message);
        const scheduleSync =
          stage === "manager" && decision === "approved"
            ? await syncApprovedLeaveToSchedule({
                supabase: admin,
                tenantId,
                branchId: user.branch_id,
                actorId: user.id,
                leave: {
                  id: String(leave.id),
                  employee_id: String(leave.employee_id),
                  leave_type: String(leave.leave_type),
                  starts_at: String(leave.starts_at),
                  ends_at: String(leave.ends_at),
                  unit: String(leave.unit),
                },
              })
            : null;
        await createInAppNotifications({
          supabase: admin,
          tenantId,
          recipientUserIds: [String(leave.employee_id)],
          title:
            decision === "approved"
              ? stage === "manager"
                ? "請假單已核准"
                : "請假單已通過副理初審"
              : decision === "adjustment_proposed"
                ? "主管建議調整請假日期"
                : "請假單需要補充或未通過",
          message: reason || "請查看最新狀態。",
          severity: decision === "approved" ? "info" : "warning",
          eventType: "staff_leave_review_decision",
          targetType: "staff_leave_request",
          targetId: requestId,
          actionUrl: `/staff/leave?month=${month}`,
          dedupeKey: `staff-leave-review:${requestId}:${stage}:${decision}`,
          createdBy: user.id,
        });
        if (stage === "assistant_manager" && decision === "approved")
          await createInAppNotifications({
            supabase: admin,
            tenantId,
            recipientRoles: ["manager"],
            title: "請假單等待經理逐筆核准",
            message: `${leave.leave_type} · ${String(leave.starts_at).slice(0, 10)}`,
            eventType: "staff_leave_manager_review",
            targetType: "staff_leave_request",
            targetId: requestId,
            actionUrl: `/manager/staff-leave?month=${month}`,
            dedupeKey: `staff-leave-manager:${requestId}`,
            createdBy: user.id,
          });
        if (scheduleSync?.synced)
          await createInAppNotifications({
            supabase: admin,
            tenantId,
            recipientRoles: ["supervisor", "manager"],
            title: "核准請假已帶入新版班表",
            message: "系統已建立或更新正式班表草稿，請副理重新檢查並送經理發布。",
            severity: "warning",
            eventType: "staff_leave_schedule_synced",
            targetType: "staff_schedule_version",
            targetId: scheduleSync.versionId,
            actionUrl: `/manager/staff-scheduling?month=${scheduleSync.monthStart.slice(0, 7)}`,
            dedupeKey: `staff-leave-schedule-sync:${requestId}:${scheduleSync.versionId}`,
            createdBy: user.id,
          });
        await writeStaffAudit({
          supabase: admin,
          request,
          tenantId,
          actorId: user.id,
          action: "staff_leave_reviewed",
          targetType: "staff_leave_request",
          targetId: requestId,
          reason: reason || null,
          before: {
            status: leave.status,
            assistantDecision: leave.assistant_decision,
            managerDecision: leave.manager_decision,
          },
          after: { stage, decision, status: patch.status, scheduleSync },
        });
      } else throw new Error("不支援的請假操作");
    }
    return apiSuccess(await loadState(admin, user, auth.context, month));
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message || "欄位格式錯誤"
        : error instanceof Error
          ? error.message
          : "請假操作失敗";
    return apiError(400, "FORBIDDEN", message);
  }
}
