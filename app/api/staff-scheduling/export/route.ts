import ExcelJS from "exceljs";
import { apiError, requireProfile } from "../../../../lib/auth-context";
import { requireStaffPermission } from "../../../../lib/staff-operation-permissions";
import { writeStaffAudit } from "../../../../lib/staff-audit";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

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
const OFF_LABELS: Record<string, string> = {
  regular_day_off: "例假",
  rest_day: "休息日",
  facility_closure: "館休",
  preferred_off: "自選休假",
  national_holiday: "國定假日",
  holiday_adjustment: "國定假日調休",
  annual_leave: "特休",
  sick_leave: "病假",
  personal_leave: "事假",
  family_care_leave: "家庭照顧假",
  marriage_leave: "婚假",
  bereavement_leave: "喪假",
  official_leave: "公假",
  other_leave: "其他假",
};

function safeCell(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export async function GET(request: Request) {
  const auth = await requireProfile([...STAFF_ROLES], request);
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  try {
    const month = new URL(request.url).searchParams.get("month") || "";
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("月份格式錯誤");
    const profile = await admin
      .from("profiles")
      .select("id, tenant_id, branch_id")
      .eq("id", auth.context.userId)
      .maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    if (!profile.data?.tenant_id) throw new Error("帳號尚未設定館別");
    const tenantId = String(profile.data.tenant_id);
    await requireStaffPermission({
      supabase: admin,
      tenantId,
      employeeId: auth.context.userId,
      context: auth.context,
      permission: "export_schedule",
      message: "您沒有匯出班表的權限",
    });
    let periodQuery = admin
      .from("staff_schedule_periods")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("month_start", `${month}-01`);
    periodQuery = profile.data.branch_id
      ? periodQuery.eq("branch_id", profile.data.branch_id)
      : periodQuery.is("branch_id", null);
    const period = await periodQuery.maybeSingle();
    if (period.error || !period.data) throw new Error("找不到這個月份的班表");
    const version = await admin
      .from("staff_schedule_versions")
      .select("id, version_number, status, published_at")
      .eq("period_id", period.data.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (version.error || !version.data)
      throw new Error("這個月份尚未建立班表版本");
    const [entries, acknowledgements] = await Promise.all([
      admin
        .from("staff_schedule_entries")
        .select("*")
        .eq("version_id", version.data.id)
        .order("work_date"),
      admin
        .from("staff_schedule_acknowledgements")
        .select("employee_id, status, signed_at, submitted_at")
        .eq("version_id", version.data.id),
    ]);
    if (entries.error || acknowledgements.error)
      throw new Error(
        entries.error?.message ||
          acknowledgements.error?.message ||
          "班表匯出失敗",
      );
    const employeeIds = Array.from(
      new Set((entries.data || []).map((row) => String(row.employee_id))),
    );
    const [employees, employments] = await Promise.all([
      employeeIds.length
        ? admin
            .from("profiles")
            .select(
              "id, display_name, english_name, employee_number, department, position",
            )
            .in("id", employeeIds)
        : Promise.resolve({ data: [], error: null }),
      employeeIds.length
        ? admin
            .from("staff_employment_profiles")
            .select("employee_id, employment_type, work_group")
            .in("employee_id", employeeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (employees.error || employments.error)
      throw new Error(
        employees.error?.message ||
          employments.error?.message ||
          "員工資料讀取失敗",
      );
    const employeeMap = new Map(
      (employees.data || []).map((row) => [String(row.id), row]),
    );
    const employmentMap = new Map(
      (employments.data || []).map((row) => [String(row.employee_id), row]),
    );
    const dates = Array.from(
      new Set((entries.data || []).map((row) => String(row.work_date))),
    ).sort();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "巨挺健身館班表系統";
    workbook.created = new Date();
    workbook.subject = `${month} 全員班表 V${version.data.version_number}`;
    const sheet = workbook.addWorksheet("全員班表", {
      views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
    });
    sheet.pageSetup = {
      orientation: "landscape",
      paperSize: 9 as ExcelJS.PaperSize,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.2,
        right: 0.2,
        top: 0.35,
        bottom: 0.35,
        header: 0.15,
        footer: 0.15,
      },
    };
    sheet.mergeCells(1, 1, 1, dates.length + 1);
    sheet.getCell(1, 1).value =
      `巨挺健身館｜${month} 全員班表｜V${version.data.version_number} ${version.data.status}`;
    sheet.getCell(1, 1).font = {
      bold: true,
      size: 16,
      color: { argb: "FFFFFFFF" },
    };
    sheet.getCell(1, 1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF173B67" },
    };
    sheet.getCell(1, 1).alignment = {
      horizontal: "center",
      vertical: "middle",
    };
    sheet.getRow(1).height = 28;
    sheet.getCell(2, 1).value =
      `匯出時間：${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date())}`;
    sheet.mergeCells(2, 1, 2, dates.length + 1);
    const header = sheet.getRow(3);
    header.values = [
      "員工",
      ...dates.map(
        (date) =>
          `${Number(date.slice(-2))}日\n${["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T12:00:00+08:00`).getDay()]}`,
      ),
    ];
    header.height = 34;
    header.eachCell((cell, col) => {
      const weekend =
        col > 1 &&
        [0, 6].includes(new Date(`${dates[col - 2]}T12:00:00+08:00`).getDay());
      cell.font = {
        bold: true,
        color: { argb: weekend ? "FF9C322B" : "FF26384E" },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: weekend ? "FFFFE7E1" : "FFEAF0F7" },
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });
    for (const employeeId of employeeIds) {
      const employee = employeeMap.get(employeeId);
      const employment = employmentMap.get(employeeId);
      const label = `${safeCell(employee?.display_name || employee?.english_name || "未命名")}\n${safeCell(employee?.employee_number || "無編號")} · ${employment?.employment_type === "part_time" ? "兼職" : "正職"}`;
      const row = sheet.addRow([
        label,
        ...dates.map((date) => {
          const entry = (entries.data || []).find(
            (item) =>
              item.employee_id === employeeId && item.work_date === date,
          );
          if (!entry) return "—";
          return entry.entry_kind === "off"
            ? OFF_LABELS[String(entry.off_kind)] || "休"
            : `${safeCell(entry.shift_label || "上班")}\n${String(entry.starts_at).slice(0, 5)}–${String(entry.ends_at).slice(0, 5)}`;
        }),
      ]);
      row.height = 42;
      row.eachCell((cell, col) => {
        const entry =
          col > 1
            ? (entries.data || []).find(
                (item) =>
                  item.employee_id === employeeId &&
                  item.work_date === dates[col - 2],
              )
            : null;
        cell.alignment = {
          horizontal: col === 1 ? "left" : "center",
          vertical: "middle",
          wrapText: true,
        };
        if (entry?.entry_kind === "off")
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFFE49A" },
          };
      });
    }
    sheet.getColumn(1).width = 23;
    for (let index = 2; index <= dates.length + 1; index += 1)
      sheet.getColumn(index).width = 13;
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFD7DFEA" } },
          left: { style: "thin", color: { argb: "FFD7DFEA" } },
          bottom: { style: "thin", color: { argb: "FFD7DFEA" } },
          right: { style: "thin", color: { argb: "FFD7DFEA" } },
        };
      }),
    );
    const stats = workbook.addWorksheet("每日統計", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    stats.columns = [
      { header: "日期", key: "date", width: 14 },
      { header: "星期", key: "weekday", width: 10 },
      { header: "上班人數", key: "work", width: 12 },
      { header: "休假人數", key: "off", width: 12 },
      { header: "中班上班", key: "middle", width: 12 },
      { header: "早班上班", key: "early", width: 12 },
    ];
    for (const date of dates) {
      const rows = (entries.data || []).filter(
        (item) => item.work_date === date,
      );
      stats.addRow({
        date,
        weekday: ["日", "一", "二", "三", "四", "五", "六"][
          new Date(`${date}T12:00:00+08:00`).getDay()
        ],
        work: rows.filter((item) => item.entry_kind === "work").length,
        off: rows.filter((item) => item.entry_kind === "off").length,
        middle: rows.filter(
          (item) =>
            item.entry_kind === "work" && item.counts_toward_middle_limit,
        ).length,
        early: rows.filter(
          (item) =>
            item.entry_kind === "work" &&
            String(item.shift_code || "").includes("EARLY"),
        ).length,
      });
    }
    stats.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    stats.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2764A5" },
    };
    const signatures = workbook.addWorksheet("簽署狀態");
    signatures.columns = [
      { header: "員工", key: "name", width: 24 },
      { header: "員工編號", key: "number", width: 16 },
      { header: "狀態", key: "status", width: 18 },
      { header: "完成時間", key: "signedAt", width: 24 },
    ];
    for (const employeeId of employeeIds) {
      const employee = employeeMap.get(employeeId);
      const ack = (acknowledgements.data || []).find(
        (item) => item.employee_id === employeeId,
      );
      signatures.addRow({
        name: safeCell(
          employee?.display_name || employee?.english_name || "未命名",
        ),
        number: safeCell(employee?.employee_number || ""),
        status: ack?.status || "待簽",
        signedAt: ack?.signed_at || ack?.submitted_at || "",
      });
    }
    signatures.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    signatures.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2764A5" },
    };
    const output = await workbook.xlsx.writeBuffer();
    await writeStaffAudit({
      supabase: admin,
      request,
      tenantId,
      actorId: auth.context.userId,
      action: "staff_schedule_exported",
      targetType: "staff_schedule_version",
      targetId: version.data.id,
      payload: {
        month,
        format: "xlsx",
        versionNumber: version.data.version_number,
      },
    });
    return new Response(new Uint8Array(output), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="Bige-Schedule-${month}-V${version.data.version_number}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return apiError(
      400,
      "FORBIDDEN",
      error instanceof Error ? error.message : "班表匯出失敗",
    );
  }
}
