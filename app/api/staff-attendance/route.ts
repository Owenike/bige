import { createHash } from "node:crypto";
import { z } from "zod";
import {
  apiError,
  apiSuccess,
  requireProfile,
  type ProfileContext,
} from "../../../lib/auth-context";
import {
  LATE_CLOCK_OUT_CONFIRMATION,
  detectAttendanceAnomalies,
  parseAttendanceWorkbook,
  type AttendanceScheduleEntry,
} from "../../../lib/staff-attendance";
import { createInAppNotifications } from "../../../lib/in-app-notifications";
import { hasStaffPermission, requireStaffPermission } from "../../../lib/staff-operation-permissions";
import { writeStaffAudit } from "../../../lib/staff-audit";
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
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type ProfileRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  role: string;
  display_name: string | null;
  english_name: string | null;
  employee_number: string | null;
  position: string | null;
};

async function getProfile(admin: AdminClient, userId: string) {
  const result = await admin
    .from("profiles")
    .select(
      "id, tenant_id, branch_id, role, display_name, english_name, employee_number, position",
    )
    .eq("id", userId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("找不到員工帳號");
  return result.data as ProfileRow;
}

function normalizeEmployeeNumber(value: string | null) {
  if (!value) return "";
  return value.trim().toUpperCase().replace(/\s/g, "");
}

function numericEmployeeAlias(value: string | null) {
  const digits = String(value || "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
  return digits || (value ? "0" : "");
}

function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月份格式錯誤");
  const [year, monthNumber] = month.split("-").map(Number);
  const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(endDay).padStart(2, "0")}`,
  };
}

function dateTime(workDate: string, time: string | null) {
  return time ? `${workDate}T${time}:00+08:00` : null;
}

function decodeSignature(dataUrl: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("簽名圖片格式不支援");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024)
    throw new Error("簽名圖片大小不正確");
  return {
    buffer,
    extension: match[1] === "jpeg" ? "jpg" : match[1],
    mimeType: `image/${match[1]}`,
  };
}

async function loadState(params: {
  admin: AdminClient;
  profile: ProfileRow;
  context: ProfileContext;
  month: string;
  requestedBatchId?: string | null;
}) {
  const tenantId = params.profile.tenant_id;
  if (!tenantId) throw new Error("帳號尚未設定館別");
  const manager = await hasStaffPermission({
    supabase: params.admin,
    tenantId,
    employeeId: params.profile.id,
    context: params.context,
    permission: "manage_attendance",
  });
  const range = monthRange(params.month);
  if (manager) {
    const batchesResult = await params.admin
      .from("staff_attendance_import_batches")
      .select("*")
      .eq("tenant_id", tenantId)
      .or(`period_start.lte.${range.end},period_start.is.null`)
      .order("imported_at", { ascending: false })
      .limit(30);
    if (batchesResult.error) throw new Error(batchesResult.error.message);
    const batches = (batchesResult.data || []).filter(
      (batch) => !batch.period_end || String(batch.period_end) >= range.start,
    );
    const batchId = params.requestedBatchId || batches[0]?.id || null;
    let anomalies: Record<string, unknown>[] = [];
    let packages: Record<string, unknown>[] = [];
    if (batchId) {
      const [anomalyResult, packageResult] = await Promise.all([
        params.admin
          .from("staff_attendance_anomalies")
          .select("*")
          .eq("batch_id", batchId)
          .order("work_date")
          .order("created_at"),
        params.admin
          .from("staff_attendance_response_packages")
          .select("*")
          .eq("batch_id", batchId)
          .order("created_at"),
      ]);
      if (anomalyResult.error) throw new Error(anomalyResult.error.message);
      if (packageResult.error) throw new Error(packageResult.error.message);
      anomalies = anomalyResult.data || [];
      packages = packageResult.data || [];
    }
    const employeeIds = Array.from(
      new Set([
        ...anomalies
          .map((item) => String(item.employee_id || ""))
          .filter(Boolean),
        ...packages
          .map((item) => String(item.employee_id || ""))
          .filter(Boolean),
      ]),
    );
    const employeeResult = employeeIds.length
      ? await params.admin
          .from("profiles")
          .select("id, display_name, english_name, employee_number")
          .in("id", employeeIds)
      : { data: [], error: null };
    if (employeeResult.error) throw new Error(employeeResult.error.message);
    const packageDetails: Record<string, unknown>[] = [];
    for (const responsePackage of packages) {
      const [itemResult, responseResult, reviewResult] = await Promise.all([
        params.admin
          .from("staff_attendance_package_items")
          .select("id, package_id, anomaly_id, staff_attendance_anomalies(*)")
          .eq("package_id", responsePackage.id)
          .order("display_order"),
        params.admin
          .from("staff_attendance_responses")
          .select("*")
          .eq("package_id", responsePackage.id),
        params.admin
          .from("staff_attendance_reviews")
          .select("*")
          .eq("package_id", responsePackage.id)
          .order("decided_at"),
      ]);
      if (itemResult.error) throw new Error(itemResult.error.message);
      if (responseResult.error) throw new Error(responseResult.error.message);
      if (reviewResult.error) throw new Error(reviewResult.error.message);
      packageDetails.push({
        ...responsePackage,
        items: itemResult.data || [],
        responses: responseResult.data || [],
        reviews: reviewResult.data || [],
      });
    }
    return {
      actor: {
        id: params.profile.id,
        canManage: true,
        canAssistantReview: true,
        canFinalReview: false,
      },
      month: params.month,
      batches,
      selectedBatchId: batchId,
      employees: employeeResult.data || [],
      anomalies,
      packages: packageDetails,
      responsePackages: [],
    };
  }

  const packagesResult = await params.admin
    .from("staff_attendance_response_packages")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("employee_id", params.profile.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (packagesResult.error) throw new Error(packagesResult.error.message);
  const packages = packagesResult.data || [];
  const items: Record<string, unknown>[] = [];
  for (const responsePackage of packages) {
    const itemResult = await params.admin
      .from("staff_attendance_package_items")
      .select("id, package_id, anomaly_id, staff_attendance_anomalies(*)")
      .eq("package_id", responsePackage.id)
      .order("display_order");
    if (itemResult.error) throw new Error(itemResult.error.message);
    items.push(...(itemResult.data || []));
  }
  const responseResult = packages.length
    ? await params.admin
        .from("staff_attendance_responses")
        .select("*")
        .in(
          "package_id",
          packages.map((item) => item.id),
        )
    : { data: [], error: null };
  if (responseResult.error) throw new Error(responseResult.error.message);
  return {
    actor: {
      id: params.profile.id,
      canManage: false,
      canAssistantReview: false,
      canFinalReview: false,
    },
    month: params.month,
    batches: [],
    selectedBatchId: null,
    employees: [
      {
        id: params.profile.id,
        display_name: params.profile.display_name,
        english_name: params.profile.english_name,
        employee_number: params.profile.employee_number,
      },
    ],
    anomalies: [],
    packages: [],
    responsePackages: packages.map((responsePackage) => ({
      ...responsePackage,
      items: items.filter((item) => item.package_id === responsePackage.id),
      responses: (responseResult.data || []).filter(
        (item) => item.package_id === responsePackage.id,
      ),
    })),
  };
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
    const profile = await getProfile(admin, auth.context.userId);
    return apiSuccess(
      await loadState({
        admin,
        profile,
        context: auth.context,
        month,
        requestedBatchId: url.searchParams.get("batch"),
      }),
    );
  } catch (error) {
    return apiError(
      400,
      "FORBIDDEN",
      error instanceof Error ? error.message : "無法讀取打卡異常",
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  try {
    const profile = await getProfile(admin, auth.context.userId);
    const tenantId = profile.tenant_id;
    if (!tenantId) throw new Error("帳號尚未設定館別");
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_attendance", message: "您沒有匯入打卡資料的權限" });
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("請選擇 Excel 檔案");
      if (!file.name.toLowerCase().endsWith(".xlsx"))
        throw new Error("目前請匯出為 .xlsx 格式後上傳");
      if (file.size <= 0 || file.size > 15 * 1024 * 1024)
        throw new Error("Excel 檔案必須小於 15MB");
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileSha256 = createHash("sha256").update(buffer).digest("hex");
      const duplicate = await admin
        .from("staff_attendance_import_batches")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("file_sha256", fileSha256)
        .maybeSingle();
      if (duplicate.error) throw new Error(duplicate.error.message);
      if (duplicate.data)
        throw new Error("這份 Excel 已匯入過；請直接開啟原本的異常預覽");
      const parsed = await parseAttendanceWorkbook(buffer);
      if (parsed.rows.length === 0) throw new Error("Excel 內沒有可用的打卡列");
      const dates = parsed.rows.map((row) => row.workDate).sort();
      const periodStart = dates[0];
      const periodEnd = dates.at(-1)!;
      const batchResult = await admin
        .from("staff_attendance_import_batches")
        .insert({
          tenant_id: tenantId,
          branch_id: profile.branch_id,
          file_name: file.name,
          file_sha256: fileSha256,
          period_start: periodStart,
          period_end: periodEnd,
          status: "uploading",
          row_count: parsed.rows.length,
          imported_by: profile.id,
        })
        .select("*")
        .single();
      if (batchResult.error) throw new Error(batchResult.error.message);

      const employeesResult = await admin
        .from("profiles")
        .select("id, display_name, english_name, employee_number")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("staff_deleted_at", null);
      if (employeesResult.error) throw new Error(employeesResult.error.message);
      const employees = employeesResult.data || [];
      const exactNumber = new Map<string, string>();
      const numericAliases = new Map<string, string[]>();
      const names = new Map<string, string[]>();
      for (const employee of employees) {
        const employeeNumber = normalizeEmployeeNumber(
          employee.employee_number,
        );
        if (employeeNumber)
          exactNumber.set(employeeNumber, String(employee.id));
        const numeric = numericEmployeeAlias(employee.employee_number);
        if (numeric)
          numericAliases.set(numeric, [
            ...(numericAliases.get(numeric) || []),
            String(employee.id),
          ]);
        for (const name of [employee.display_name, employee.english_name]) {
          const normalized = String(name || "")
            .trim()
            .toLowerCase();
          if (normalized)
            names.set(normalized, [
              ...(names.get(normalized) || []),
              String(employee.id),
            ]);
        }
      }
      const resolveEmployee = (
        employeeNumberRaw: string | null,
        employeeNameRaw: string | null,
      ) => {
        const exact = exactNumber.get(
          normalizeEmployeeNumber(employeeNumberRaw),
        );
        if (exact) return exact;
        const numericMatches =
          numericAliases.get(numericEmployeeAlias(employeeNumberRaw)) || [];
        if (numericMatches.length === 1) return numericMatches[0];
        const nameMatches =
          names.get(
            String(employeeNameRaw || "")
              .trim()
              .toLowerCase(),
          ) || [];
        return nameMatches.length === 1 ? nameMatches[0] : null;
      };

      const scheduleResult = await admin
        .from("staff_schedule_entries")
        .select(
          "employee_id, work_date, entry_kind, starts_at, ends_at, crosses_midnight, staff_schedule_versions!inner(status)",
        )
        .eq("tenant_id", tenantId)
        .eq("staff_schedule_versions.status", "published")
        .gte("work_date", periodStart)
        .lte("work_date", periodEnd);
      if (scheduleResult.error) throw new Error(scheduleResult.error.message);
      const scheduleMap = new Map<string, AttendanceScheduleEntry>();
      for (const row of scheduleResult.data || []) {
        scheduleMap.set(`${row.employee_id}:${row.work_date}`, {
          employeeId: String(row.employee_id),
          workDate: String(row.work_date),
          entryKind: row.entry_kind,
          startsAt: row.starts_at ? String(row.starts_at).slice(0, 5) : null,
          endsAt: row.ends_at ? String(row.ends_at).slice(0, 5) : null,
          crossesMidnight: Boolean(row.crosses_midnight),
        });
      }

      const normalizedRows = parsed.rows.map((row) => ({
        ...row,
        employeeId: resolveEmployee(row.employeeNumberRaw, row.employeeNameRaw),
      }));
      const importedKeys = new Set(
        normalizedRows
          .filter((row) => row.employeeId)
          .map((row) => `${row.employeeId}:${row.workDate}`),
      );
      for (const schedule of scheduleMap.values()) {
        if (
          schedule.entryKind !== "work" ||
          importedKeys.has(`${schedule.employeeId}:${schedule.workDate}`)
        )
          continue;
        const employee = employees.find(
          (item) => item.id === schedule.employeeId,
        );
        normalizedRows.push({
          employeeNumberRaw: employee?.employee_number || null,
          employeeNameRaw:
            employee?.display_name || employee?.english_name || null,
          employeeId: schedule.employeeId,
          workDate: schedule.workDate,
          punchTimes: [],
          rawRows: [{ generatedMissingPunchRow: true }],
          sourceOrderOutOfOrder: false,
        });
      }

      const dailyInsert = await admin
        .from("staff_attendance_daily_rows")
        .insert(
          normalizedRows.map((row) => ({
            batch_id: batchResult.data.id,
            tenant_id: tenantId,
            employee_id: row.employeeId,
            employee_number_raw: row.employeeNumberRaw,
            employee_name_raw: row.employeeNameRaw,
            work_date: row.workDate,
            punch_times: row.punchTimes.map((time) =>
              dateTime(row.workDate, time),
            ),
            first_punch_at: row.punchTimes[0]
              ? dateTime(row.workDate, row.punchTimes[0])
              : null,
            last_punch_at: row.punchTimes.at(-1)
              ? dateTime(row.workDate, row.punchTimes.at(-1)!)
              : null,
            raw_payload: {
              sourceRows: row.rawRows,
              parserWarnings: parsed.warnings,
            },
            mapping_status: row.employeeId ? "matched" : "unmatched",
          })),
        )
        .select(
          "id, employee_id, employee_number_raw, employee_name_raw, work_date",
        );
      if (dailyInsert.error) throw new Error(dailyInsert.error.message);
      const anomalyRows: Record<string, unknown>[] = [];
      for (const daily of dailyInsert.data || []) {
        const source = normalizedRows.find(
          (row) =>
            row.workDate === daily.work_date &&
            row.employeeId === daily.employee_id &&
            row.employeeNumberRaw === daily.employee_number_raw &&
            row.employeeNameRaw === daily.employee_name_raw,
        );
        if (!source) continue;
        const schedule = source.employeeId
          ? scheduleMap.get(`${source.employeeId}:${source.workDate}`) || null
          : null;
        const anomalies = detectAttendanceAnomalies({
          row: source,
          employeeId: source.employeeId,
          schedule,
        });
        for (const anomaly of anomalies) {
          anomalyRows.push({
            batch_id: batchResult.data.id,
            daily_row_id: daily.id,
            tenant_id: tenantId,
            employee_id: anomaly.employeeId,
            work_date: anomaly.workDate,
            anomaly_type: anomaly.anomalyType,
            scheduled_at: anomaly.scheduledAt,
            actual_at: anomaly.actualAt,
            variance_minutes: anomaly.varianceMinutes,
            raw_punches: anomaly.rawPunches,
            status: "preview",
          });
        }
      }
      if (anomalyRows.length > 0) {
        const anomalyInsert = await admin
          .from("staff_attendance_anomalies")
          .insert(anomalyRows);
        if (anomalyInsert.error) throw new Error(anomalyInsert.error.message);
      }
      await admin
        .from("staff_attendance_import_batches")
        .update({ status: "preview", row_count: normalizedRows.length })
        .eq("id", batchResult.data.id);
      await writeStaffAudit({
        supabase: admin,
        request,
        tenantId,
        actorId: profile.id,
        action: "staff_attendance_workbook_imported",
        targetType: "staff_attendance_import_batch",
        targetId: batchResult.data.id,
        after: { fileName: file.name, fileSha256, periodStart, periodEnd, rowCount: normalizedRows.length, anomalyCount: anomalyRows.length, parserWarnings: parsed.warnings },
      });
      const month = periodStart.slice(0, 7);
      return apiSuccess(
        await loadState({
          admin,
          profile,
          context: auth.context,
          month,
          requestedBatchId: batchResult.data.id,
        }),
      );
    }

    const body = await request.json().catch(() => null);
    const action = z
      .object({
        action: z.string().min(1),
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      })
      .passthrough()
      .parse(body);
    const month = action.month || new Date().toISOString().slice(0, 7);
    if (action.action === "select_anomalies") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_attendance", message: "您沒有勾選打卡異常的權限" });
      const anomalyIds = z
        .array(z.string().uuid())
        .min(1)
        .max(1000)
        .parse(action.anomalyIds);
      const selected = z.boolean().parse(action.selected);
      const update = await admin
        .from("staff_attendance_anomalies")
        .update({ supervisor_selected: selected })
        .eq("tenant_id", tenantId)
        .in("id", anomalyIds)
        .eq("status", "preview");
      if (update.error) throw new Error(update.error.message);
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: profile.id, action: "staff_attendance_anomalies_selected", targetType: "staff_attendance_anomaly", payload: { anomalyIds, selected } });
    } else if (action.action === "send_notifications") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_attendance", message: "您沒有發出打卡確認通知的權限" });
      const batchId = z.string().uuid().parse(action.batchId);
      const selectedResult = await admin
        .from("staff_attendance_anomalies")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("batch_id", batchId)
        .eq("supervisor_selected", true)
        .eq("status", "preview")
        .not("employee_id", "is", null)
        .order("work_date");
      if (selectedResult.error) throw new Error(selectedResult.error.message);
      const grouped = new Map<string, typeof selectedResult.data>();
      for (const anomaly of selectedResult.data || []) {
        const employeeId = String(anomaly.employee_id);
        grouped.set(employeeId, [...(grouped.get(employeeId) || []), anomaly]);
      }
      if (grouped.size === 0)
        throw new Error("請先勾選至少一筆可對應員工的異常");
      for (const [employeeId, anomalies] of grouped) {
        const containsLateClockOut = anomalies.some(
          (item) => item.anomaly_type === "late_clock_out",
        );
        const statement = containsLateClockOut
          ? `請逐日確認下列打卡異常。晚打卡項目適用聲明：「${LATE_CLOCK_OUT_CONFIRMATION}」若內容不符，請選擇「內容不符，提出說明」並填寫實際工作情況。`
          : "請逐日確認下列打卡異常；若系統內容不符，請提出說明。所有日期完成後只需簽名一次。";
        const packageResult = await admin
          .from("staff_attendance_response_packages")
          .upsert(
            {
              tenant_id: tenantId,
              employee_id: employeeId,
              batch_id: batchId,
              status: "pending",
              statement_snapshot: statement,
            },
            { onConflict: "batch_id,employee_id" },
          )
          .select("id")
          .single();
        if (packageResult.error) throw new Error(packageResult.error.message);
        const itemInsert = await admin
          .from("staff_attendance_package_items")
          .upsert(
            anomalies.map((anomaly, index) => ({
              package_id: packageResult.data.id,
              anomaly_id: anomaly.id,
              tenant_id: tenantId,
              employee_id: employeeId,
              display_order: index,
            })),
            { onConflict: "package_id,anomaly_id" },
          );
        if (itemInsert.error) throw new Error(itemInsert.error.message);
        await admin
          .from("staff_attendance_anomalies")
          .update({ status: "employee_response" })
          .in(
            "id",
            anomalies.map((item) => item.id),
          );
        await createInAppNotifications({
          supabase: admin,
          tenantId,
          recipientUserIds: [employeeId],
          title: `請確認 ${anomalies.length} 筆打卡異常`,
          message:
            "請逐日回答，全部完成後以手機簽名一次；晚打卡不會直接自動算成加班。",
          severity: "warning",
          eventType: "staff_attendance_confirmation_required",
          targetType: "staff_attendance_response_package",
          targetId: packageResult.data.id,
          actionUrl: `/staff/attendance?month=${month}`,
          dedupeKey: `staff-attendance-package:${packageResult.data.id}`,
          createdBy: profile.id,
        });
      }
      await admin
        .from("staff_attendance_import_batches")
        .update({ status: "notifications_sent" })
        .eq("id", batchId);
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: profile.id, action: "staff_attendance_notifications_sent", targetType: "staff_attendance_import_batch", targetId: batchId, after: { recipientCount: grouped.size, anomalyCount: (selectedResult.data || []).length } });
    } else if (action.action === "respond_package") {
      const packageId = z.string().uuid().parse(action.packageId);
      const responsePackage = await admin
        .from("staff_attendance_response_packages")
        .select("*")
        .eq("id", packageId)
        .eq("employee_id", profile.id)
        .maybeSingle();
      if (responsePackage.error || !responsePackage.data)
        throw new Error("找不到待確認的打卡異常");
      const itemResult = await admin
        .from("staff_attendance_package_items")
        .select("anomaly_id, staff_attendance_anomalies(anomaly_type)")
        .eq("package_id", packageId);
      if (itemResult.error) throw new Error(itemResult.error.message);
      const answers = z
        .array(
          z.object({
            anomalyId: z.string().uuid(),
            response: z.enum([
              "confirm_as_shown",
              "confirm_personal_activity",
              "content_incorrect",
            ]),
            actualWorkMinutes: z.coerce
              .number()
              .int()
              .min(0)
              .max(1440)
              .nullable()
              .optional(),
            explanation: z.string().trim().max(2000).nullable().optional(),
          }),
        )
        .parse(action.answers);
      const requiredIds = new Set(
        (itemResult.data || []).map((item) => String(item.anomaly_id)),
      );
      if (
        answers.length !== requiredIds.size ||
        answers.some((answer) => !requiredIds.has(answer.anomalyId))
      )
        throw new Error("請逐日完成所有異常項目");
      for (const answer of answers) {
        if (answer.response === "content_incorrect" && !answer.explanation)
          throw new Error("選擇內容不符時必須填寫說明");
        const anomalyItem = (itemResult.data || []).find(
          (item) => String(item.anomaly_id) === answer.anomalyId,
        );
        const anomalyRelation = Array.isArray(
          anomalyItem?.staff_attendance_anomalies,
        )
          ? anomalyItem?.staff_attendance_anomalies[0]
          : anomalyItem?.staff_attendance_anomalies;
        if (
          anomalyRelation?.anomaly_type === "late_clock_out" &&
          answer.response === "confirm_as_shown"
        )
          throw new Error("晚打卡請選擇私人活動確認，或提出內容不符說明");
      }
      const signature = decodeSignature(
        z.string().max(8_000_000).parse(action.signatureDataUrl),
      );
      const sha256 = createHash("sha256")
        .update(signature.buffer)
        .digest("hex");
      const objectPath = `${tenantId}/${profile.id}/attendance-${packageId}-${Date.now()}.${signature.extension}`;
      const upload = await admin.storage
        .from("staff-signatures")
        .upload(objectPath, signature.buffer, {
          contentType: signature.mimeType,
          upsert: false,
        });
      if (upload.error) throw new Error(upload.error.message);
      for (const answer of answers) {
        const responseInsert = await admin
          .from("staff_attendance_responses")
          .upsert(
            {
              package_id: packageId,
              anomaly_id: answer.anomalyId,
              tenant_id: tenantId,
              employee_id: profile.id,
              response: answer.response,
              actual_work_minutes: answer.actualWorkMinutes ?? null,
              explanation: answer.explanation || null,
            },
            { onConflict: "package_id,anomaly_id" },
          );
        if (responseInsert.error) throw new Error(responseInsert.error.message);
        const resolution =
          answer.response === "confirm_personal_activity"
            ? "personal_activity_confirmed"
            : answer.response === "content_incorrect" &&
                Number(answer.actualWorkMinutes || 0) > 0
              ? "worked_overtime"
              : answer.response === "content_incorrect"
                ? "other"
                : null;
        const anomalyUpdate = await admin
          .from("staff_attendance_anomalies")
          .update({
            status: "assistant_review",
            resolution,
            resolution_minutes: answer.actualWorkMinutes ?? null,
          })
          .eq("id", answer.anomalyId);
        if (anomalyUpdate.error) throw new Error(anomalyUpdate.error.message);
      }
      const packageUpdate = await admin
        .from("staff_attendance_response_packages")
        .update({
          status: "assistant_review",
          signature_object_path: objectPath,
          signature_sha256: sha256,
          signed_at: new Date().toISOString(),
          submitted_at: new Date().toISOString(),
        })
        .eq("id", packageId);
      if (packageUpdate.error) throw new Error(packageUpdate.error.message);
      await createInAppNotifications({
        supabase: admin,
        tenantId,
        recipientRoles: ["supervisor"],
        title: "員工已完成打卡異常確認",
        message: `${profile.display_name || profile.employee_number || "員工"}已逐日回答並簽名，請主管覆核。`,
        eventType: "staff_attendance_assistant_review",
        targetType: "staff_attendance_response_package",
        targetId: packageId,
        actionUrl: `/manager/staff-attendance?month=${month}`,
        dedupeKey: `staff-attendance-assistant-review:${packageId}`,
        createdBy: profile.id,
      });
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: profile.id, action: "staff_attendance_response_signed", targetType: "staff_attendance_response_package", targetId: packageId, after: { answerCount: answers.length, signatureSha256: sha256 } });
    } else if (action.action === "review_package") {
      await requireStaffPermission({ supabase: admin, tenantId, employeeId: profile.id, context: auth.context, permission: "manage_attendance", message: "您沒有覆核打卡異常的權限" });
      const packageId = z.string().uuid().parse(action.packageId);
      const stage = z.literal("assistant_manager").parse(action.stage);
      const decision = z
        .enum(["approved", "rejected", "returned"])
        .parse(action.decision);
      const reason = z
        .string()
        .trim()
        .max(2000)
        .nullable()
        .optional()
        .parse(action.reason);
      if (decision !== "approved" && !reason)
        throw new Error("退回或駁回必須填寫理由");
      const review = await admin.from("staff_attendance_reviews").upsert(
        {
          package_id: packageId,
          tenant_id: tenantId,
          stage,
          decision,
          reason: reason || null,
          decided_by: profile.id,
          decided_at: new Date().toISOString(),
        },
        { onConflict: "package_id,stage" },
      );
      if (review.error) throw new Error(review.error.message);
      const nextStatus = decision === "approved" ? "resolved" : "pending";
      await admin
        .from("staff_attendance_response_packages")
        .update({ status: nextStatus })
        .eq("id", packageId);
      await admin
        .from("staff_attendance_anomalies")
        .update({
          status: decision === "approved" ? "resolved" : "employee_response",
        })
        .in(
          "id",
          (
            await admin
              .from("staff_attendance_package_items")
              .select("anomaly_id")
              .eq("package_id", packageId)
          ).data?.map((item) => item.anomaly_id) || [],
        );
      const packageOwner = await admin
        .from("staff_attendance_response_packages")
        .select("employee_id")
        .eq("id", packageId)
        .maybeSingle();
      if (packageOwner.data?.employee_id) {
        await createInAppNotifications({
          supabase: admin,
          tenantId,
          recipientUserIds: [String(packageOwner.data.employee_id)],
          title:
            decision === "approved"
              ? "打卡異常覆核已通過"
              : "打卡異常確認需要補充",
          message:
            decision === "approved"
              ? "主管已完成覆核。"
              : reason || "請重新查看並補充內容。",
          severity: decision === "approved" ? "info" : "warning",
          eventType: "staff_attendance_review_decision",
          targetType: "staff_attendance_response_package",
          targetId: packageId,
          actionUrl: `/staff/attendance?month=${month}`,
          dedupeKey: `staff-attendance-review:${packageId}:${stage}:${decision}`,
          createdBy: profile.id,
        });
      }
      await writeStaffAudit({ supabase: admin, request, tenantId, actorId: profile.id, action: "staff_attendance_package_reviewed", targetType: "staff_attendance_response_package", targetId: packageId, reason: reason || null, after: { decision, status: nextStatus } });
    } else {
      throw new Error("不支援的打卡異常操作");
    }
    return apiSuccess(
      await loadState({
        admin,
        profile,
        context: auth.context,
        month,
        requestedBatchId:
          typeof action.batchId === "string" ? action.batchId : null,
      }),
    );
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message || "欄位格式錯誤"
        : error instanceof Error
          ? error.message
          : "打卡異常操作失敗";
    return apiError(400, "FORBIDDEN", message);
  }
}
