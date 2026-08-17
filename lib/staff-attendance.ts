import ExcelJS from "exceljs";

export const ATTENDANCE_THRESHOLDS = {
  lateMinutes: 5,
  earlyLeaveMinutes: 5,
  lateClockOutMinutes: 15,
} as const;

export const LATE_CLOCK_OUT_CONFIRMATION =
  "系統偵測您於排定下班時間後打卡。本人確認下班後僅從事私人活動或自主運動，未提供勞務或待命。";

export type ParsedAttendanceDailyRow = {
  employeeNumberRaw: string | null;
  employeeNameRaw: string | null;
  workDate: string;
  punchTimes: string[];
  rawRows: Record<string, string | number | boolean | null>[];
  sourceOrderOutOfOrder: boolean;
};

export type AttendanceScheduleEntry = {
  employeeId: string;
  workDate: string;
  entryKind: "work" | "off";
  startsAt: string | null;
  endsAt: string | null;
  crossesMidnight?: boolean;
};

export type AttendanceAnomalyDraft = {
  employeeId: string | null;
  workDate: string;
  anomalyType:
    | "missing_in"
    | "missing_out"
    | "no_punch"
    | "late"
    | "early_leave"
    | "late_clock_out"
    | "off_day_punch"
    | "multiple_punches"
    | "out_of_order"
    | "unmatched_employee";
  scheduledAt: string | null;
  actualAt: string | null;
  varianceMinutes: number | null;
  rawPunches: string[];
};

type HeaderKind = "employeeNumber" | "employeeName" | "date" | "time" | "dateTime" | "clockIn" | "clockOut" | "punchType";

const HEADER_ALIASES: Record<HeaderKind, readonly string[]> = {
  employeeNumber: ["工號", "員工編號", "人員編號", "卡號", "編號", "employeeid", "employeeno", "id"],
  employeeName: ["姓名", "員工姓名", "人員姓名", "名稱", "employeename", "name"],
  date: ["日期", "打卡日期", "出勤日期", "刷卡日期", "年月日", "date"],
  time: ["時間", "打卡時間", "刷卡時間", "簽到時間", "time"],
  dateTime: ["日期時間", "打卡日期時間", "刷卡日期時間", "datetime", "timestamp"],
  clockIn: ["上班", "上班時間", "簽到", "簽到時間", "clockin", "intime"],
  clockOut: ["下班", "下班時間", "簽退", "簽退時間", "clockout", "outtime"],
  punchType: ["狀態", "類型", "打卡類型", "刷卡類型", "上班下班", "type"],
};

function normalizeHeader(input: unknown) {
  return String(input ?? "").trim().toLowerCase().replace(/[\s_\-:：()（）]/g, "");
}

function cellValue(cell: ExcelJS.Cell): string | number | boolean | Date | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined && value.result !== null) return value.result as string | number | boolean | Date;
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("");
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return cell.text || null;
}

function findHeaderMap(worksheet: ExcelJS.Worksheet) {
  let best: { rowNumber: number; columns: Partial<Record<HeaderKind, number>>; score: number } | null = null;
  const maxRow = Math.min(20, worksheet.rowCount);
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const columns: Partial<Record<HeaderKind, number>> = {};
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = normalizeHeader(cellValue(cell));
      for (const [kind, aliases] of Object.entries(HEADER_ALIASES) as Array<[HeaderKind, readonly string[]]>) {
        if (!columns[kind] && aliases.some((alias) => header === normalizeHeader(alias) || header.includes(normalizeHeader(alias)))) {
          columns[kind] = columnNumber;
        }
      }
    });
    const hasEmployee = !!columns.employeeNumber || !!columns.employeeName;
    const hasDate = !!columns.date || !!columns.dateTime;
    const hasPunch = !!columns.time || !!columns.dateTime || !!columns.clockIn || !!columns.clockOut;
    const score = Object.keys(columns).length + (hasEmployee ? 2 : 0) + (hasDate ? 2 : 0) + (hasPunch ? 2 : 0);
    if (hasEmployee && hasDate && hasPunch && (!best || score > best.score)) best = { rowNumber, columns, score };
  }
  return best;
}

function excelSerialToDate(value: number) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + value * 86_400_000);
}

function parseDateValue(input: unknown): string | null {
  if (input instanceof Date && Number.isFinite(input.getTime())) {
    return `${input.getUTCFullYear()}-${String(input.getUTCMonth() + 1).padStart(2, "0")}-${String(input.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof input === "number" && input > 20_000 && input < 100_000) return parseDateValue(excelSerialToDate(input));
  const value = String(input ?? "").trim();
  if (!value) return null;
  const datePart = value.split(/[ T]/)[0];
  const match = /^(\d{2,4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})日?$/.exec(datePart);
  if (!match) return null;
  let year = Number(match[1]);
  if (year < 1911) year += 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseTimeValue(input: unknown): string | null {
  if (input instanceof Date && Number.isFinite(input.getTime())) {
    return `${String(input.getUTCHours()).padStart(2, "0")}:${String(input.getUTCMinutes()).padStart(2, "0")}`;
  }
  if (typeof input === "number") {
    const fraction = ((input % 1) + 1) % 1;
    const totalMinutes = Math.round(fraction * 24 * 60) % (24 * 60);
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  }
  const value = String(input ?? "").trim();
  if (!value) return null;
  const combined = value.match(/(?:\d{2,4}[\/.\-年]\d{1,2}[\/.\-月]\d{1,2}日?)[ T]+(\d{1,2}):(\d{2})/);
  const match = combined || value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(上午|下午|am|pm)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const marker = String(match[3] || "").toLowerCase();
  if ((marker === "下午" || marker === "pm") && hours < 12) hours += 12;
  if ((marker === "上午" || marker === "am") && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function text(input: unknown) {
  const value = String(input ?? "").trim();
  return value || null;
}

export async function parseAttendanceWorkbook(buffer: Buffer): Promise<{
  rows: ParsedAttendanceDailyRow[];
  warnings: string[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const grouped = new Map<string, ParsedAttendanceDailyRow>();
  const warnings: string[] = [];
  let readableSheets = 0;

  for (const worksheet of workbook.worksheets) {
    const header = findHeaderMap(worksheet);
    if (!header) {
      warnings.push(`工作表「${worksheet.name}」找不到員工、日期與打卡時間欄位，已略過。`);
      continue;
    }
    readableSheets += 1;
    for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const read = (kind: HeaderKind) => header.columns[kind] ? cellValue(row.getCell(header.columns[kind]!)) : null;
      const employeeNumberRaw = text(read("employeeNumber"));
      const employeeNameRaw = text(read("employeeName"));
      const dateInput = read("dateTime") ?? read("date");
      const workDate = parseDateValue(dateInput);
      if ((!employeeNumberRaw && !employeeNameRaw) || !workDate) continue;
      const punches = [read("clockIn"), read("clockOut")].map(parseTimeValue).filter((item): item is string => !!item);
      const singleTime = parseTimeValue(read("dateTime") ?? read("time"));
      if (singleTime) punches.push(singleTime);
      if (punches.length === 0) continue;
      const rawPayload: Record<string, string | number | boolean | null> = {};
      for (const [kind, columnNumber] of Object.entries(header.columns) as Array<[HeaderKind, number]>) {
        const value = cellValue(row.getCell(columnNumber));
        rawPayload[kind] = value instanceof Date ? value.toISOString() : value;
      }
      rawPayload.sheet = worksheet.name;
      rawPayload.row = rowNumber;
      const identity = employeeNumberRaw ? `number:${employeeNumberRaw.toUpperCase().replace(/\s/g, "")}` : `name:${employeeNameRaw}`;
      const key = `${identity}:${workDate}`;
      const current = grouped.get(key) || {
        employeeNumberRaw,
        employeeNameRaw,
        workDate,
        punchTimes: [],
        rawRows: [],
        sourceOrderOutOfOrder: false,
      };
      for (const punch of punches) {
        const last = current.punchTimes.length ? current.punchTimes[current.punchTimes.length - 1] : undefined;
        if (last && punch < last) current.sourceOrderOutOfOrder = true;
        current.punchTimes.push(punch);
      }
      current.rawRows.push(rawPayload);
      grouped.set(key, current);
    }
  }
  if (readableSheets === 0) throw new Error("找不到可辨識的打卡工作表；請確認檔案內有員工編號或姓名、日期及打卡時間欄位。");
  return {
    rows: Array.from(grouped.values()).map((row) => ({ ...row, punchTimes: Array.from(new Set(row.punchTimes)).sort() })),
    warnings,
  };
}

function minuteOfDay(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function dateTime(workDate: string, time: string | null) {
  return time ? `${workDate}T${time}:00+08:00` : null;
}

export function detectAttendanceAnomalies(params: {
  row: ParsedAttendanceDailyRow;
  employeeId: string | null;
  schedule: AttendanceScheduleEntry | null;
  thresholds?: Partial<typeof ATTENDANCE_THRESHOLDS>;
}) {
  const thresholds = { ...ATTENDANCE_THRESHOLDS, ...params.thresholds };
  const result: AttendanceAnomalyDraft[] = [];
  const punches = [...params.row.punchTimes].sort();
  const first = punches[0] || null;
  const last = punches.length ? punches[punches.length - 1] : null;
  const add = (
    anomalyType: AttendanceAnomalyDraft["anomalyType"],
    scheduledAt: string | null,
    actualAt: string | null,
    varianceMinutes: number | null,
  ) => result.push({
    employeeId: params.employeeId,
    workDate: params.row.workDate,
    anomalyType,
    scheduledAt,
    actualAt,
    varianceMinutes,
    rawPunches: punches,
  });

  if (!params.employeeId) {
    add("unmatched_employee", null, first ? dateTime(params.row.workDate, first) : null, null);
    return result;
  }
  if (!params.schedule || params.schedule.entryKind === "off") {
    if (punches.length > 0) add("off_day_punch", null, dateTime(params.row.workDate, first), null);
    return result;
  }
  const scheduledStart = params.schedule.startsAt?.slice(0, 5) || null;
  const scheduledEnd = params.schedule.endsAt?.slice(0, 5) || null;
  if (punches.length === 0) {
    add("no_punch", dateTime(params.row.workDate, scheduledStart), null, null);
    return result;
  }
  if (punches.length === 1) {
    const punch = minuteOfDay(punches[0]);
    const start = scheduledStart ? minuteOfDay(scheduledStart) : 0;
    const end = scheduledEnd ? minuteOfDay(scheduledEnd) : 24 * 60;
    const type = Math.abs(punch - start) <= Math.abs(punch - end) ? "missing_out" : "missing_in";
    add(type, dateTime(params.row.workDate, type === "missing_out" ? scheduledEnd : scheduledStart), dateTime(params.row.workDate, punches[0]), null);
  }
  if (punches.length > 2) add("multiple_punches", null, dateTime(params.row.workDate, first), punches.length);
  if (params.row.sourceOrderOutOfOrder) add("out_of_order", null, dateTime(params.row.workDate, first), null);
  if (first && scheduledStart) {
    const difference = minuteOfDay(first) - minuteOfDay(scheduledStart);
    if (difference > thresholds.lateMinutes) add("late", dateTime(params.row.workDate, scheduledStart), dateTime(params.row.workDate, first), difference);
  }
  if (last && scheduledEnd) {
    const difference = minuteOfDay(last) - minuteOfDay(scheduledEnd);
    if (difference < -thresholds.earlyLeaveMinutes) add("early_leave", dateTime(params.row.workDate, scheduledEnd), dateTime(params.row.workDate, last), Math.abs(difference));
    if (difference > thresholds.lateClockOutMinutes) add("late_clock_out", dateTime(params.row.workDate, scheduledEnd), dateTime(params.row.workDate, last), difference);
  }
  return result;
}

export function attendanceAnomalyLabel(type: AttendanceAnomalyDraft["anomalyType"]) {
  return {
    missing_in: "缺上班卡",
    missing_out: "缺下班卡",
    no_punch: "整日無打卡",
    late: "遲到",
    early_leave: "提早下班",
    late_clock_out: "晚打卡",
    off_day_punch: "休假日有打卡",
    multiple_punches: "多筆打卡",
    out_of_order: "打卡順序異常",
    unmatched_employee: "找不到員工",
  }[type];
}
