import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const PERIOD_START = "2026-08-01";
const PERIOD_END = "2026-08-31";
const PERIOD_END_EXCLUSIVE = "2026-09-01";
const DEFAULT_SOURCE = "C:\\Users\\User\\Downloads\\8月教練預約本.xlsx-.xlsx";
const DEFAULT_OUTPUT = path.resolve(".tmp", "schedule-import-analysis", "output");
const APPLY_CONFIRMATION = "REPLACE_2026_08";
const COACH_PAIRS = [
  [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17],
];
const EXPECTED_COACHES = new Set(["Becky", "Wiwi", "Lily", "Wade", "Una", "Bae", "Owen"]);
const KNOWN_MARKERS = new Set(["PT", "FA1", "FA2", "FAN"]);
const COURSE_LABELS = {
  weight_training: "重訓",
  reformer_pilates: "器械皮拉提斯",
  relaxation: "筋膜放鬆",
  sports_cupping: "運動拔罐",
  fascia_knife: "筋膜刀",
  onsite_assessment: "現場評估",
};
const TRIAL_SERVICES = {
  weight_training: "weight_training",
  reformer_pilates: "pilates",
  relaxation: "sports_massage",
  onsite_assessment: "onsite_assessment",
};
const FIXED_PT_LEGACY = new Map([
  ["呂建輝", "8"],
  ["李媚琳", "117"],
  ["彭鷥雅", "35"],
  ["鄭宏憶", "79"],
  ["曾筠棠", "85"],
  ["彭華怡", "87"],
]);
const FA_LEGACY = new Map([
  ["顏紫涵", "124"],
  ["陳媛希", "127"],
  ["王信凱", "126"],
  ["陳奕蓁", "125"],
  ["陳光晉", "130"],
  ["楊美櫻", "128"],
  ["沈佳虹", "133"],
]);
const PHONE_OVERRIDES = new Map([
  ["2026-08-10|Wiwi|12:00|陳葳", "0928765568"],
]);
const NAME_ALIASES = new Map([
  ["黃玥禔", "黃玥褆"],
  ["徐佩璇", "徐珮璇"],
]);
const COURSE_OVERRIDES = new Map([
  ["2026-08-07|Becky|11:00|蘇玉艷", "onsite_assessment"],
  ["2026-08-11|Owen|20:00|林鈺堯", "sports_cupping"],
  ["2026-08-18|Una|10:00|盧薇安", "weight_training"],
  ["2026-08-18|Una|11:00|盧謝秋月", "weight_training"],
  ["2026-08-25|Una|10:00|盧薇安", "weight_training"],
  ["2026-08-25|Una|11:00|盧謝秋月", "weight_training"],
]);

const clean = (value) => String(value ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
const compact = (value) => clean(value).replace(/\s+/g, "");
const normalizePhone = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const normalizeCoach = (value) => clean(value).replace(/^ST\s+/i, "");
const safeKey = (value) => String(value).normalize("NFKC").replace(/[^\p{L}\p{N}:|._-]+/gu, "_");
const rowIdentity = (row) => `${row.date}|${row.coach}|${row.time}|${row.name || row.content || ""}`;
const toIso = (date, time, durationMinutes = 0) => {
  const start = new Date(`${date}T${time}:00+08:00`);
  start.setMinutes(start.getMinutes() + durationMinutes);
  return start.toISOString();
};

function parseArgs(argv) {
  const result = { apply: false, retryBatch: null, confirm: null, source: DEFAULT_SOURCE, output: DEFAULT_OUTPUT };
  for (const arg of argv) {
    if (arg === "--apply") result.apply = true;
    else if (arg.startsWith("--retry-batch=")) result.retryBatch = arg.slice("--retry-batch=".length);
    else if (arg.startsWith("--confirm-replace-august=")) result.confirm = arg.slice("--confirm-replace-august=".length);
    else if (arg.startsWith("--source=")) result.source = path.resolve(arg.slice("--source=".length));
    else if (arg.startsWith("--output=")) result.output = path.resolve(arg.slice("--output=".length));
  }
  if (result.retryBatch) result.apply = true;
  return result;
}

function inferCourseType(text) {
  const value = compact(text);
  if (/現場評估/.test(value)) return "onsite_assessment";
  if (/拔罐/.test(value)) return "sports_cupping";
  if (/筋膜刀/.test(value)) return "fascia_knife";
  if (/重訓|重量訓練|肌力/.test(value)) return "weight_training";
  if (/皮拉提斯|皮拉|拉提斯/.test(value)) return "reformer_pilates";
  if (/放鬆|筋膜|筋磨|按摩/.test(value)) return "relaxation";
  return null;
}

function parsePt(raw) {
  const value = compact(raw).replace(/[－—–]/g, "-");
  const courseType = inferCourseType(value);
  const phone = value.match(/09\d{8}/)?.[0] || null;
  let left = value;
  if (value.includes("-")) left = value.split("-")[0];
  else if (courseType === "weight_training") left = value.replace(/重訓|重量訓練/g, "");
  else if (courseType === "reformer_pilates") left = value.replace(/器械皮拉提斯|皮拉提斯|皮拉|拉提斯/g, "");
  else if (courseType === "relaxation") left = value.replace(/筋膜放鬆|放鬆|筋膜|筋磨刀?|按摩\d*min?/gi, "");
  if (phone) left = left.replace(phone, "");
  left = left.replace(/[()（）].*$/, "");
  const match = left.match(/^(.*?)(\d{1,3})?$/);
  return {
    name: clean(match?.[1] || left).replace(/[-_]+$/, ""),
    legacyNumber: match?.[2] || null,
    courseType,
    phone,
  };
}

function parseFa(raw) {
  const value = clean(raw);
  const phone = value.replace(/[^0-9]/g, "").match(/09\d{8}/)?.[0] || null;
  let name = value;
  if (phone) {
    const firstDigit = value.search(/\d/);
    name = value.slice(0, firstDigit < 0 ? value.length : firstDigit).replace(/[\s:：,，-]+$/, "");
  }
  return { name: clean(name).replace(/^(FA\d?|FAN)[:：-]?/i, "").trim(), phone };
}

async function readWorkbook(sourcePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const sheet = workbook.getWorksheet("總表");
  if (!sheet) throw new Error("找不到 Excel 工作表：總表");
  const schedules = [];
  const unmarked = [];
  for (let day = 1; day <= 31; day += 1) {
    const headerRow = 1 + (day - 1) * 24;
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    for (const [markerColumn, contentColumn] of COACH_PAIRS) {
      const coach = normalizeCoach(sheet.getRow(headerRow).getCell(contentColumn).text);
      if (!coach || coach === "Miranda") continue;
      for (let hour = 6; hour <= 23; hour += 1) {
        const excelRow = headerRow + 1 + (hour - 6);
        const marker = compact(sheet.getRow(excelRow).getCell(markerColumn).text).toUpperCase();
        const content = clean(sheet.getRow(excelRow).getCell(contentColumn).text);
        const time = `${String(hour).padStart(2, "0")}:00`;
        if (KNOWN_MARKERS.has(marker)) {
          let continuation = null;
          if (hour < 23) {
            const nextMarker = compact(sheet.getRow(excelRow + 1).getCell(markerColumn).text).toUpperCase();
            const nextContent = clean(sheet.getRow(excelRow + 1).getCell(contentColumn).text);
            if (!nextMarker && nextContent && inferCourseType(nextContent)) continuation = nextContent;
          }
          const parsed = marker === "PT" ? parsePt(content) : parseFa(content);
          schedules.push({
            sourceCell: `${sheet.name}!${sheet.getRow(excelRow).getCell(contentColumn).address}`,
            date, day, hour, time, coach, marker,
            operationKind: marker === "PT" ? "pt" : "trial",
            trialStage: marker === "PT" ? null : marker,
            rawContent: content,
            continuation,
            name: parsed.name || null,
            phone: parsed.phone || null,
            legacyNumber: parsed.legacyNumber || null,
            courseType: marker === "PT"
              ? parsed.courseType || inferCourseType(continuation || "")
              : inferCourseType(continuation || "") || inferCourseType(content),
            durationMinutes: marker === "PT" ? 60 : 120,
          });
        } else if (marker || content) {
          const isContinuation = hour > 6 && schedules.some((item) =>
            item.date === date && item.coach === coach && item.hour === hour - 1 && item.continuation === content,
          );
          if (!isContinuation) unmarked.push({
            sourceCell: `${sheet.name}!${sheet.getRow(excelRow).getCell(contentColumn).address}`,
            date, day, hour, time, coach, marker: marker || null, content,
          });
        }
      }
    }
  }
  return { schedules, unmarked };
}

function normalizeImport(raw) {
  const schedules = raw.schedules.map((row) => ({
    ...row,
    name: NAME_ALIASES.get(row.name) || row.name,
    issues: [],
  }));
  const ptNumbersByName = new Map();
  for (const row of schedules.filter((item) => item.operationKind === "pt")) {
    if (!ptNumbersByName.has(row.name)) ptNumbersByName.set(row.name, new Set());
    if (row.legacyNumber) ptNumbersByName.get(row.name).add(String(row.legacyNumber));
  }
  for (const [name, number] of FIXED_PT_LEGACY) {
    if (!ptNumbersByName.has(name)) ptNumbersByName.set(name, new Set());
    ptNumbersByName.get(name).add(number);
  }
  for (const row of schedules) {
    const key = rowIdentity(row);
    row.courseType = COURSE_OVERRIDES.get(key) || row.courseType;
    row.phone = PHONE_OVERRIDES.get(key) || row.phone;
    if (row.operationKind === "pt" && !row.legacyNumber) {
      const candidates = ptNumbersByName.get(row.name) || new Set();
      if (candidates.size === 1) row.legacyNumber = [...candidates][0];
    }
    if (row.operationKind === "trial") {
      const candidates = ptNumbersByName.get(row.name) || new Set();
      row.legacyNumber = FA_LEGACY.get(row.name) || (candidates.size === 1 ? [...candidates][0] : null);
    }
    if (!row.name) row.issues.push("missing_name");
    if (!row.courseType) row.issues.push("missing_course_type");
    if (!EXPECTED_COACHES.has(row.coach)) row.issues.push("unknown_coach");
    if (row.operationKind === "trial" && !row.phone) row.issues.push("missing_phone");
    if (row.operationKind === "trial" && !TRIAL_SERVICES[row.courseType]) row.issues.push("invalid_trial_course_type");
    row.sourceRowKey = safeKey(`booking:${row.date}:${row.time}:${row.coach}:${row.marker}:${row.name}`);
  }

  const ptIdentityByNameLegacy = new Map();
  const members = new Map();
  for (const row of schedules.filter((item) => item.operationKind === "pt")) {
    const identity = `formal:${row.name}:${row.legacyNumber || "none"}`;
    row.memberKey = identity;
    ptIdentityByNameLegacy.set(`${row.name}:${row.legacyNumber || "none"}`, identity);
    if (!members.has(identity)) members.set(identity, {
      sourceRowKey: safeKey(`member:${identity}`), memberKey: identity, fullName: row.name,
      phone: row.phone || null, legacyNumber: row.legacyNumber || null, isProspect: false,
    });
    else if (row.phone && !members.get(identity).phone) members.get(identity).phone = row.phone;
  }
  for (const row of schedules.filter((item) => item.operationKind === "trial")) {
    const formalIdentity = row.legacyNumber
      ? ptIdentityByNameLegacy.get(`${row.name}:${row.legacyNumber}`)
      : ptIdentityByNameLegacy.get(`${row.name}:none`);
    const identity = formalIdentity || `prospect:${row.name}:${row.phone || "none"}`;
    row.memberKey = identity;
    if (!members.has(identity)) members.set(identity, {
      sourceRowKey: safeKey(`member:${identity}`), memberKey: identity, fullName: row.name,
      phone: row.phone || null, legacyNumber: row.legacyNumber || null, isProspect: true,
    });
    else if (row.phone && !members.get(identity).phone) members.get(identity).phone = row.phone;
  }

  const notes = raw.unmarked
    .filter((row) => row.content && row.content !== "休")
    .filter((row) => !(row.coach === "Owen" && row.hour === 6))
    .filter((row) => row.content !== "館休")
    .map((row) => ({
      ...row,
      durationMinutes: 60,
      sourceRowKey: safeKey(`note:${row.date}:${row.time}:${row.coach}:${row.content}`),
      issues: EXPECTED_COACHES.has(row.coach) ? [] : ["unknown_coach"],
    }));

  const frontdeskRows = raw.unmarked
    .filter((row) => row.coach === "Owen" && row.hour === 6)
    .filter((row) => ["Annie", "Miffy", "Annie/Miffy"].includes(row.content));
  const businessDays = frontdeskRows.map((row) => ({
    date: row.date,
    frontdeskName: row.content,
    isClosed: false,
    closureLabel: null,
    sourceCell: row.sourceCell,
    sourceRowKey: `business-day:${row.date}`,
    issues: [],
  }));
  const closureSource = raw.unmarked.find((row) => row.date === "2026-08-09" && row.content === "館休");
  const existingClosure = businessDays.find((row) => row.date === "2026-08-09");
  if (existingClosure) {
    existingClosure.isClosed = true;
    existingClosure.closureLabel = "館休";
  } else {
    businessDays.push({
      date: "2026-08-09", frontdeskName: null, isClosed: true, closureLabel: "館休",
      sourceCell: closureSource?.sourceCell || "總表", sourceRowKey: "business-day:2026-08-09", issues: [],
    });
  }

  const occupancy = new Map();
  for (const row of [...schedules, ...notes]) {
    if (row.issues.length) continue;
    for (let minute = 0; minute < row.durationMinutes; minute += 30) {
      const start = new Date(`${row.date}T${row.time}:00+08:00`);
      start.setMinutes(start.getMinutes() + minute);
      const slot = `${row.coach}|${start.toISOString()}`;
      const conflict = occupancy.get(slot);
      if (conflict && conflict !== row.sourceRowKey) {
        row.issues.push(`slot_conflict:${conflict}`);
      } else occupancy.set(slot, row.sourceRowKey);
    }
  }
  const closureConflicts = schedules
    .filter((row) => row.date === "2026-08-09")
    .map((row) => ({ ...row, issues: [...row.issues, "facility_closed"] }));
  for (const row of closureConflicts) {
    const target = schedules.find((item) => item.sourceRowKey === row.sourceRowKey);
    if (target && !target.issues.includes("facility_closed")) target.issues.push("facility_closed");
  }
  return { schedules, notes, businessDays, members: [...members.values()], closureConflicts };
}

function summarizePlan(plan) {
  const all = [...plan.members, ...plan.schedules, ...plan.notes, ...plan.businessDays];
  return {
    sourcePeriod: `${PERIOD_START}..${PERIOD_END}`,
    totalRows: all.length,
    memberRows: plan.members.length,
    bookingRows: plan.schedules.length,
    ptRows: plan.schedules.filter((row) => row.operationKind === "pt").length,
    faRows: plan.schedules.filter((row) => row.operationKind === "trial").length,
    noteRows: plan.notes.length,
    businessDayRows: plan.businessDays.length,
    failedValidationRows: all.filter((row) => row.issues?.length).length,
    closureConflictRows: plan.closureConflicts.length,
    sharedLegacyNumbers: [...new Set(plan.members.map((row) => row.legacyNumber).filter(Boolean))]
      .filter((number) => plan.members.filter((row) => row.legacyNumber === number).length > 1),
    missingLegacyReminder: plan.members
      .filter((row) => !row.isProspect && !row.legacyNumber)
      .map((row) => row.fullName),
  };
}

async function writeReport(outputDir, sourcePath, sourceSha256, plan, results = []) {
  await fs.mkdir(outputDir, { recursive: true });
  const summary = summarizePlan(plan);
  await fs.writeFile(path.join(outputDir, "august-import-plan.json"), JSON.stringify({
    generatedAt: new Date().toISOString(), sourcePath, sourceSha256, summary, plan,
  }, null, 2), "utf8");
  const resultByKey = new Map(results.map((row) => [row.sourceRowKey, row]));
  const workbook = new ExcelJS.Workbook();
  const headerStyle = { font: { bold: true, color: { argb: "FFF0D07A" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF101A28" } } };
  const summarySheet = workbook.addWorksheet("匯入摘要");
  summarySheet.addRows([
    ["8 月教練預約本匯入報告", ""], ["來源檔案", sourcePath], ["SHA-256", sourceSha256],
    ["產生時間", new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })],
    ["項目", "數量"],
    ["排課", summary.bookingRows], ["PT", summary.ptRows], ["FA", summary.faRows],
    ["自由文字", summary.noteRows], ["會員候選", summary.memberRows],
    ["館休/櫃台設定", summary.businessDayRows], ["驗證異常", summary.failedValidationRows],
  ]);
  summarySheet.getRow(1).font = { bold: true, size: 18, color: { argb: "FFD9B65D" } };
  summarySheet.getRow(5).eachCell((cell) => Object.assign(cell, { style: headerStyle }));
  summarySheet.columns = [{ width: 24 }, { width: 78 }];

  const rowsSheet = workbook.addWorksheet("逐筆結果");
  rowsSheet.addRow(["種類", "日期", "時間", "教練", "姓名/內容", "課別", "舊編號", "狀態", "異常", "來源儲存格", "稽核鍵"]);
  rowsSheet.getRow(1).eachCell((cell) => Object.assign(cell, { style: headerStyle }));
  for (const [kind, rows] of [["會員", plan.members], ["排課", plan.schedules], ["自由文字", plan.notes], ["營業日", plan.businessDays]]) {
    for (const row of rows) {
      const result = resultByKey.get(row.sourceRowKey);
      rowsSheet.addRow([
        kind, row.date || "", row.time || "", row.coach || "", row.fullName || row.name || row.content || row.closureLabel || row.frontdeskName || "",
        row.courseType ? COURSE_LABELS[row.courseType] : "", row.legacyNumber || "",
        result?.status || (row.issues?.length ? "驗證失敗" : "待匯入"),
        result?.errorMessage || row.issues?.join("；") || "", row.sourceCell || "", row.sourceRowKey,
      ]);
    }
  }
  rowsSheet.columns = [12, 13, 9, 12, 28, 18, 10, 12, 34, 18, 56].map((width) => ({ width }));
  rowsSheet.views = [{ state: "frozen", ySplit: 1 }];
  rowsSheet.autoFilter = "A1:K1";

  const reminderSheet = workbook.addWorksheet("待辦提醒");
  reminderSheet.addRow(["類型", "內容"]);
  reminderSheet.getRow(1).eachCell((cell) => Object.assign(cell, { style: headerStyle }));
  for (const name of summary.missingLegacyReminder) reminderSheet.addRow(["舊編號待補", `${name}：已建立系統會員編號，舊預約本編號留白`]);
  for (const number of summary.sharedLegacyNumbers) reminderSheet.addRow(["共用合約", `舊編號 ${number} 由兩位會員共用，個別保留排課歷程`]);
  reminderSheet.addRow(["館休", "2026/08/09 館休：阻擋排課、首次體驗與自主訓練報到/放行"]);
  reminderSheet.columns = [{ width: 18 }, { width: 90 }];
  const reportPath = path.join(outputDir, "august-import-report.xlsx");
  await workbook.xlsx.writeFile(reportPath);
  return { reportPath, summary };
}

function loadDotEnv(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

async function createAdminClient() {
  try { loadDotEnv(await fs.readFile(path.resolve(".env.local"), "utf8")); } catch {}
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireData(query, label) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function insertChunks(supabase, table, rows, selectColumns, chunkSize = 100) {
  const inserted = [];
  const failures = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const result = await supabase.from(table).insert(chunk.map((item) => item.payload)).select(selectColumns);
    if (!result.error) {
      inserted.push(...(result.data || []));
      continue;
    }
    for (const item of chunk) {
      const single = await supabase.from(table).insert(item.payload).select(selectColumns).maybeSingle();
      if (single.error || !single.data) failures.push({ sourceRowKey: item.sourceRowKey, errorMessage: single.error?.message || "insert_failed" });
      else inserted.push(single.data);
    }
  }
  return { inserted, failures };
}

export async function runApply({ args, sourcePath, sourceSha256, plan, outputDir }) {
  if (!args.retryBatch && args.confirm !== APPLY_CONFIRMATION) {
    throw new Error(`正式匯入必須提供 --confirm-replace-august=${APPLY_CONFIRMATION}`);
  }
  const supabase = await createAdminClient();
  const tenantCoachMatches = await requireData(
    supabase
      .from("profiles")
      .select("tenant_id, english_name")
      .eq("is_active", true)
      .in("english_name", [...EXPECTED_COACHES]),
    "尋找正式場館",
  );
  const tenantCoachCounts = new Map();
  for (const profile of tenantCoachMatches || []) {
    const names = tenantCoachCounts.get(profile.tenant_id) || new Set();
    names.add(clean(profile.english_name).toLowerCase());
    tenantCoachCounts.set(profile.tenant_id, names);
  }
  const tenantIds = [...tenantCoachCounts.entries()]
    .filter(([, names]) => [...EXPECTED_COACHES].every((name) => names.has(name.toLowerCase())))
    .map(([tenantId]) => tenantId);
  if (tenantIds.length !== 1) {
    throw new Error(`無法唯一判定正式場館（符合數量：${tenantIds.length}）`);
  }
  const tenant = await requireData(
    supabase.from("tenants").select("id").eq("id", tenantIds[0]).maybeSingle(),
    "讀取正式場館",
  );
  if (!tenant?.id) throw new Error("找不到正式場館");
  const branch = await requireData(supabase.from("branches").select("id").eq("tenant_id", tenant.id).limit(1).maybeSingle(), "讀取 branch");
  const profiles = await requireData(
    supabase.from("profiles").select("id, display_name, english_name, employee_number, branch_id, is_active").eq("tenant_id", tenant.id).eq("is_active", true),
    "讀取教練",
  );
  const coachByName = new Map();
  for (const profile of profiles || []) {
    for (const value of [profile.english_name, profile.display_name, profile.employee_number]) {
      if (value) coachByName.set(clean(value).toLowerCase(), profile);
    }
  }
  for (const name of EXPECTED_COACHES) if (!coachByName.has(name.toLowerCase())) throw new Error(`找不到教練帳號：${name}`);

  let batch;
  let retryKeys = null;
  if (args.retryBatch) {
    batch = await requireData(supabase.from("bige_schedule_import_batches").select("*").eq("id", args.retryBatch).maybeSingle(), "讀取匯入批次");
    if (!batch) throw new Error("找不到指定的匯入批次");
    const failed = await requireData(supabase.from("bige_schedule_import_rows").select("source_row_key").eq("batch_id", batch.id).eq("status", "failed"), "讀取失敗列");
    retryKeys = new Set((failed || []).map((row) => row.source_row_key));
  } else {
    const [backupBookings, backupNotes, backupTrials, backupBusinessDays] = await Promise.all([
      requireData(supabase.from("bookings").select("*").eq("tenant_id", tenant.id).eq("is_bige_schedule", true).gte("starts_at", `${PERIOD_START}T00:00:00+08:00`).lt("starts_at", `${PERIOD_END_EXCLUSIVE}T00:00:00+08:00`), "備份排課"),
      requireData(supabase.from("bige_schedule_notes").select("*").eq("tenant_id", tenant.id).gte("starts_at", `${PERIOD_START}T00:00:00+08:00`).lt("starts_at", `${PERIOD_END_EXCLUSIVE}T00:00:00+08:00`), "備份自由文字"),
      requireData(supabase.from("trial_bookings").select("*").eq("source", "legacy_schedule_import").gte("appointment_date", PERIOD_START).lte("appointment_date", PERIOD_END), "備份匯入 FA"),
      requireData(supabase.from("bige_business_day_settings").select("*").eq("tenant_id", tenant.id).gte("business_date", PERIOD_START).lte("business_date", PERIOD_END), "備份營業日"),
    ]);
    batch = await requireData(supabase.from("bige_schedule_import_batches").insert({
      tenant_id: tenant.id, branch_id: branch?.id || null, source_filename: path.basename(sourcePath), source_sha256: sourceSha256,
      source_period_start: PERIOD_START, source_period_end: PERIOD_END, status: "running",
      total_rows: summarizePlan(plan).totalRows,
      backup_snapshot: { bookings: backupBookings, notes: backupNotes, trialBookings: backupTrials, businessDays: backupBusinessDays },
      metadata: { sourcePath, dryRunReport: path.join(outputDir, "august-import-report.xlsx"), rulesVersion: 1 },
    }).select("*").maybeSingle(), "建立匯入批次");
    if (!batch) throw new Error("無法建立匯入批次");
    await Promise.all([
      requireData(supabase.from("bookings").delete().eq("tenant_id", tenant.id).eq("is_bige_schedule", true).gte("starts_at", `${PERIOD_START}T00:00:00+08:00`).lt("starts_at", `${PERIOD_END_EXCLUSIVE}T00:00:00+08:00`), "清除 8 月排課"),
      requireData(supabase.from("bige_schedule_notes").delete().eq("tenant_id", tenant.id).gte("starts_at", `${PERIOD_START}T00:00:00+08:00`).lt("starts_at", `${PERIOD_END_EXCLUSIVE}T00:00:00+08:00`), "清除 8 月自由文字"),
      requireData(supabase.from("trial_bookings").delete().eq("source", "legacy_schedule_import").gte("appointment_date", PERIOD_START).lte("appointment_date", PERIOD_END), "清除舊匯入 FA"),
      requireData(supabase.from("bige_business_day_settings").delete().eq("tenant_id", tenant.id).gte("business_date", PERIOD_START).lte("business_date", PERIOD_END), "清除 8 月營業日設定"),
    ]);
  }

  const allPlanRows = [
    ...plan.members.map((row) => ({ ...row, itemKind: "member" })),
    ...plan.schedules.map((row) => ({ ...row, itemKind: "booking" })),
    ...plan.notes.map((row) => ({ ...row, itemKind: "note" })),
    ...plan.businessDays.map((row) => ({ ...row, itemKind: "business_day" })),
  ];
  const selected = retryKeys ? allPlanRows.filter((row) => retryKeys.has(row.sourceRowKey)) : allPlanRows;
  const auditPayloads = selected.map((row) => ({
    batch_id: batch.id, tenant_id: tenant.id, source_row_key: row.sourceRowKey, source_sheet: "總表",
    source_date: row.date || null, source_time: row.time || null, source_coach: row.coach || null,
    source_value: row.rawContent || row.content || row.fullName || row.frontdeskName || row.closureLabel || null,
    item_kind: row.itemKind, status: row.issues?.length ? "failed" : "validated",
    normalized_payload: row, error_code: row.issues?.[0] || null, error_message: row.issues?.join("；") || null,
  }));
  for (let offset = 0; offset < auditPayloads.length; offset += 200) {
    const result = await supabase.from("bige_schedule_import_rows").upsert(auditPayloads.slice(offset, offset + 200), { onConflict: "batch_id,source_row_key" });
    if (result.error) throw new Error(`建立逐筆稽核: ${result.error.message}`);
  }

  const results = [];
  const memberIdByKey = new Map();
  const createdMemberIds = new Set();
  // A failed booking can depend on a member row that already succeeded in the
  // original batch, so retries still resolve every valid member in the plan.
  const validMembers = plan.members.filter((row) => !row.issues?.length);
  const existingMembers = await requireData(supabase.from("members").select("id, full_name, phone, member_code, is_prospect").eq("tenant_id", tenant.id), "讀取會員");
  const legacyRows = await requireData(supabase.from("bige_member_legacy_numbers").select("member_id, legacy_number").eq("tenant_id", tenant.id), "讀取舊編號");
  const memberByLegacyName = new Map();
  const legacyNumberByMemberId = new Map();
  for (const legacy of legacyRows || []) {
    legacyNumberByMemberId.set(legacy.member_id, legacy.legacy_number);
    const member = (existingMembers || []).find((item) => item.id === legacy.member_id);
    if (member) memberByLegacyName.set(`${member.full_name}|${legacy.legacy_number}`, member);
  }
  for (const memberPlan of validMembers) {
    const shouldMutateMember = !retryKeys || retryKeys.has(memberPlan.sourceRowKey);
    let member = memberPlan.legacyNumber ? memberByLegacyName.get(`${memberPlan.fullName}|${memberPlan.legacyNumber}`) : null;
    if (!member && memberPlan.phone) {
      const normalizedPlanPhone = normalizePhone(memberPlan.phone);
      member = (existingMembers || []).find((item) =>
        item.full_name === memberPlan.fullName && normalizePhone(item.phone) === normalizedPlanPhone,
      );
    }
    if (!member && !memberPlan.legacyNumber) member = (existingMembers || []).find((item) => item.full_name === memberPlan.fullName && Boolean(item.is_prospect) === memberPlan.isProspect);
    if (!member && !memberPlan.isProspect) {
      const sameNameMembers = (existingMembers || []).filter((item) => item.full_name === memberPlan.fullName);
      if (sameNameMembers.length === 1) member = sameNameMembers[0];
    }
    if (!member && shouldMutateMember) {
      // The legacy workbook can contain two different FA prospects sharing one
      // contact phone. Keep their member histories separate: the second member
      // has no primary phone, while the exact contact phone remains on the
      // linked trial booking and in the import audit payload.
      const phoneOwnedByAnotherMember = memberPlan.phone
        ? (existingMembers || []).some((item) => item.phone === memberPlan.phone && item.full_name !== memberPlan.fullName)
        : false;
      const primaryPhone = phoneOwnedByAnotherMember ? null : memberPlan.phone;
      let memberCode = null;
      if (!memberPlan.isProspect) {
        const codeResult = await supabase.rpc("next_bige_member_code");
        if (codeResult.error || !codeResult.data) {
          results.push({ sourceRowKey: memberPlan.sourceRowKey, status: "failed", errorMessage: codeResult.error?.message || "member_code_failed" });
          continue;
        }
        memberCode = codeResult.data;
      }
      const inserted = await supabase.from("members").insert({
        tenant_id: tenant.id, store_id: branch?.id || null, full_name: memberPlan.fullName, phone: primaryPhone,
        phone_normalized: primaryPhone, member_code: memberCode, is_prospect: memberPlan.isProspect,
        email_unavailable: true,
      }).select("id, full_name, phone, member_code, is_prospect").maybeSingle();
      if (inserted.error || !inserted.data) {
        results.push({ sourceRowKey: memberPlan.sourceRowKey, status: "failed", errorMessage: inserted.error?.message || "member_insert_failed" });
        continue;
      }
      member = inserted.data;
      existingMembers.push(member);
      createdMemberIds.add(member.id);
    }
    if (!member) continue;
    if (shouldMutateMember && !memberPlan.isProspect && member.is_prospect) {
      let memberCode = member.member_code;
      if (!memberCode) {
        const codeResult = await supabase.rpc("next_bige_member_code");
        if (codeResult.error || !codeResult.data) {
          results.push({ sourceRowKey: memberPlan.sourceRowKey, status: "failed", errorMessage: codeResult.error?.message || "member_code_failed" });
          continue;
        }
        memberCode = codeResult.data;
      }
      const promoted = await supabase.from("members").update({
        is_prospect: false,
        member_code: memberCode,
        updated_at: new Date().toISOString(),
      }).eq("id", member.id).select("id, full_name, phone, member_code, is_prospect").maybeSingle();
      if (promoted.error || !promoted.data) {
        results.push({ sourceRowKey: memberPlan.sourceRowKey, status: "failed", errorMessage: promoted.error?.message || "member_promotion_failed" });
        continue;
      }
      member = promoted.data;
    }
    memberIdByKey.set(memberPlan.memberKey, member.id);
    if (!shouldMutateMember) continue;
    if (memberPlan.legacyNumber && legacyNumberByMemberId.get(member.id) !== memberPlan.legacyNumber) {
      const legacyResult = await supabase.from("bige_member_legacy_numbers").upsert({
        tenant_id: tenant.id, member_id: member.id, legacy_number: memberPlan.legacyNumber,
        source: "legacy_schedule_import", import_batch_id: batch.id,
      }, { onConflict: "tenant_id,member_id" });
      if (legacyResult.error) {
        results.push({ sourceRowKey: memberPlan.sourceRowKey, status: "failed", errorMessage: legacyResult.error.message });
        continue;
      }
      legacyNumberByMemberId.set(member.id, memberPlan.legacyNumber);
    }
    results.push({ sourceRowKey: memberPlan.sourceRowKey, status: "succeeded", targetType: "member", targetId: member.id });
  }

  const trialIdByBookingKey = new Map();
  const existingTrialRows = await requireData(
    supabase.from("trial_bookings")
      .select("id, name, phone, appointment_date, appointment_time, import_row_key")
      .gte("appointment_date", PERIOD_START)
      .lte("appointment_date", PERIOD_END),
    "讀取既有 FA 預約",
  );
  const existingTrialByImportKey = new Map();
  const existingTrialByIdentity = new Map();
  for (const trial of existingTrialRows || []) {
    if (trial.import_row_key) existingTrialByImportKey.set(trial.import_row_key, trial);
    const identity = `${trial.appointment_date}|${String(trial.appointment_time || "").slice(0, 5)}|${clean(trial.name)}|${clean(trial.phone)}`;
    existingTrialByIdentity.set(identity, trial);
  }

  const trialItems = [];
  for (const row of plan.schedules.filter((item) => item.operationKind === "trial" && !item.issues.length)) {
    if (retryKeys && !retryKeys.has(row.sourceRowKey)) continue;
    const memberId = memberIdByKey.get(row.memberKey);
    if (!memberId) {
      results.push({ sourceRowKey: row.sourceRowKey, status: "failed", errorMessage: "member_not_resolved" });
      continue;
    }
    const importKey = `trial:${row.sourceRowKey}`;
    const identity = `${row.date}|${row.time}|${clean(row.name)}|${clean(row.phone)}`;
    const existingTrial = existingTrialByImportKey.get(importKey) || existingTrialByIdentity.get(identity);
    if (existingTrial) {
      const updated = await supabase.from("trial_bookings").update({
        service: TRIAL_SERVICES[row.courseType], preferred_time: "other",
        schedule_note: "舊預約本匯入", payment_method: "cash_on_site", payment_status: "pending_cash",
        amount: 0, currency: "TWD", source: "legacy_schedule_import", booking_status: "scheduled",
        appointment_date: row.date, appointment_time: row.time, booking_coach: "舊預約本匯入",
        executing_coach: row.coach, line_notification_status: "not_sent", member_id: memberId,
        import_batch_id: batch.id, import_row_key: importKey, exclude_from_marketing_stats: true,
      }).eq("id", existingTrial.id).select("id").maybeSingle();
      if (updated.error || !updated.data) {
        results.push({ sourceRowKey: row.sourceRowKey, status: "failed", errorMessage: updated.error?.message || "trial_booking_update_failed" });
        continue;
      }
      trialIdByBookingKey.set(row.sourceRowKey, updated.data.id);
      continue;
    }
    trialItems.push({ sourceRowKey: row.sourceRowKey, payload: {
      name: row.name, phone: row.phone, service: TRIAL_SERVICES[row.courseType], preferred_time: "other",
      note: null, schedule_note: "舊預約本匯入", payment_method: "cash_on_site", payment_status: "pending_cash",
      amount: 0, currency: "TWD", source: "legacy_schedule_import", booking_status: "scheduled",
      appointment_date: row.date, appointment_time: row.time, booking_coach: "舊預約本匯入",
      executing_coach: row.coach, line_notification_status: "not_sent", member_id: memberId,
      import_batch_id: batch.id, import_row_key: `trial:${row.sourceRowKey}`, exclude_from_marketing_stats: true,
    }});
  }
  const trialInsert = await insertChunks(supabase, "trial_bookings", trialItems, "id, import_row_key", 75);
  for (const inserted of trialInsert.inserted) trialIdByBookingKey.set(String(inserted.import_row_key).replace(/^trial:/, ""), inserted.id);
  const trialFailureByBookingKey = new Map();
  for (const failure of trialInsert.failures) trialFailureByBookingKey.set(failure.sourceRowKey, failure.errorMessage);
  for (const failure of trialInsert.failures) results.push({ ...failure, status: "failed" });

  const bookingItems = [];
  for (const row of plan.schedules.filter((item) => !item.issues.length)) {
    if (retryKeys && !retryKeys.has(row.sourceRowKey)) continue;
    const memberId = memberIdByKey.get(row.memberKey);
    const coach = coachByName.get(row.coach.toLowerCase());
    const trialBookingId = row.operationKind === "trial" ? trialIdByBookingKey.get(row.sourceRowKey) : null;
    if (!memberId || !coach || (row.operationKind === "trial" && !trialBookingId)) {
      results.push({
        sourceRowKey: row.sourceRowKey,
        status: "failed",
        errorMessage: !memberId
          ? "member_not_resolved"
          : !coach
            ? "coach_not_resolved"
            : trialFailureByBookingKey.get(row.sourceRowKey) || "trial_booking_not_resolved",
      });
      continue;
    }
    bookingItems.push({ sourceRowKey: row.sourceRowKey, payload: {
      tenant_id: tenant.id, branch_id: coach.branch_id || branch?.id || null, member_id: memberId, coach_id: coach.id,
      service_name: COURSE_LABELS[row.courseType], starts_at: toIso(row.date, row.time), ends_at: toIso(row.date, row.time, row.durationMinutes),
      status: "booked", note: null, is_bige_schedule: true, operation_kind: row.operationKind,
      course_type: row.courseType, trial_stage: row.trialStage, operation_result: null, trial_booking_id: trialBookingId,
      reminder_status: "pending", operation_idempotency_key: `legacy-august:${row.sourceRowKey}`,
      import_batch_id: batch.id, import_row_key: row.sourceRowKey, requires_contract_followup: row.operationKind === "pt",
    }});
  }
  const bookingInsert = await insertChunks(supabase, "bookings", bookingItems, "id, import_row_key", 75);
  for (const inserted of bookingInsert.inserted) results.push({ sourceRowKey: inserted.import_row_key, status: "succeeded", targetType: "booking", targetId: inserted.id });
  for (const failure of bookingInsert.failures) results.push({ ...failure, status: "failed" });

  const selectedNoteRows = plan.notes.filter((row) => !row.issues.length && (!retryKeys || retryKeys.has(row.sourceRowKey)));
  const existingToRows = selectedNoteRows.some((row) => compact(row.content).toUpperCase() === "TO")
    ? await requireData(
        supabase.from("bige_schedule_notes")
          .select("id, coach_id, starts_at, content")
          .eq("tenant_id", tenant.id)
          .gte("starts_at", `${PERIOD_START}T00:00:00+08:00`)
          .lt("starts_at", `${PERIOD_END_EXCLUSIVE}T00:00:00+08:00`)
          .ilike("content", "TO"),
        "讀取既有 TO",
      )
    : [];
  const existingToByCell = new Map((existingToRows || []).map((row) => [
    `${row.coach_id}|${new Date(row.starts_at).toISOString()}`,
    row,
  ]));
  const noteItems = [];
  for (const row of selectedNoteRows) {
    const coachId = coachByName.get(row.coach.toLowerCase())?.id;
    const startsAt = toIso(row.date, row.time);
    const existingTo = compact(row.content).toUpperCase() === "TO"
      ? existingToByCell.get(`${coachId}|${startsAt}`)
      : null;
    if (existingTo) {
      results.push({ sourceRowKey: row.sourceRowKey, status: "succeeded", targetType: "schedule_note", targetId: existingTo.id });
      continue;
    }
    noteItems.push({
      sourceRowKey: row.sourceRowKey,
      payload: {
        tenant_id: tenant.id, branch_id: branch?.id || null, coach_id: coachId,
        starts_at: startsAt, ends_at: toIso(row.date, row.time, 60), content: row.content,
        import_batch_id: batch.id, import_row_key: row.sourceRowKey, source: "legacy_schedule_import",
      },
    });
  }
  const noteInsert = await insertChunks(supabase, "bige_schedule_notes", noteItems, "id, import_row_key", 75);
  for (const inserted of noteInsert.inserted) results.push({ sourceRowKey: inserted.import_row_key, status: "succeeded", targetType: "schedule_note", targetId: inserted.id });
  for (const failure of noteInsert.failures) results.push({ ...failure, status: "failed" });

  for (const row of plan.businessDays.filter((item) => !retryKeys || retryKeys.has(item.sourceRowKey))) {
    const upsert = await supabase.from("bige_business_day_settings").upsert({
      tenant_id: tenant.id, branch_id: branch?.id || null, business_date: row.date, is_closed: row.isClosed,
      closure_label: row.closureLabel, frontdesk_name: row.frontdeskName, source: "legacy_schedule_import", import_batch_id: batch.id,
    }, { onConflict: "tenant_id,business_date" }).select("id").maybeSingle();
    results.push(upsert.error || !upsert.data
      ? { sourceRowKey: row.sourceRowKey, status: "failed", errorMessage: upsert.error?.message || "business_day_failed" }
      : { sourceRowKey: row.sourceRowKey, status: "succeeded", targetType: "business_day", targetId: upsert.data.id });
  }

  const byKey = new Map(results.map((row) => [row.sourceRowKey, row]));
  for (const row of selected.filter((item) => item.issues?.length)) byKey.set(row.sourceRowKey, { sourceRowKey: row.sourceRowKey, status: "failed", errorMessage: row.issues.join("；") });
  const auditUpdates = [...byKey.values()].map((row) => ({
    batch_id: batch.id, tenant_id: tenant.id, source_row_key: row.sourceRowKey,
    status: row.status, target_type: row.targetType || null, target_id: row.targetId || null,
    error_code: row.status === "failed" ? String(row.errorMessage || "failed").split(":")[0] : null,
    error_message: row.errorMessage || null, attempt_count: 1, processed_at: new Date().toISOString(),
  }));
  for (let offset = 0; offset < auditUpdates.length; offset += 150) {
    const chunk = auditUpdates.slice(offset, offset + 150);
    for (const update of chunk) {
      const result = await supabase.from("bige_schedule_import_rows").update({
        status: update.status, target_type: update.target_type, target_id: update.target_id,
        error_code: update.error_code, error_message: update.error_message, processed_at: update.processed_at,
      }).eq("batch_id", batch.id).eq("source_row_key", update.source_row_key);
      if (result.error) throw new Error(`更新稽核列: ${result.error.message}`);
    }
  }

  for (const memberId of createdMemberIds) {
    const [bookingCount, trialCount] = await Promise.all([
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("member_id", memberId),
      supabase.from("trial_bookings").select("id", { count: "exact", head: true }).eq("member_id", memberId),
    ]);
    if ((bookingCount.count || 0) + (trialCount.count || 0) === 0) {
      await supabase.from("bige_member_legacy_numbers").delete().eq("member_id", memberId);
      await supabase.from("members").delete().eq("id", memberId);
    }
  }

  const auditRows = await requireData(supabase.from("bige_schedule_import_rows").select("status").eq("batch_id", batch.id), "統計匯入結果");
  if (!Array.isArray(auditRows)) throw new Error("audit_rows_missing");
  const countAuditRows = async (status) => {
    const result = await supabase
      .from("bige_schedule_import_rows")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batch.id)
      .eq("status", status);
    if (result.error) throw new Error(`audit_count_${status}: ${result.error.message}`);
    return result.count || 0;
  };
  const [succeeded, failed, skipped] = await Promise.all([
    countAuditRows("succeeded"),
    countAuditRows("failed"),
    countAuditRows("skipped"),
  ]);
  const counts = { succeeded, failed, skipped };
  const finalStatus = counts.failed ? "partial" : "completed";
  await requireData(supabase.from("bige_schedule_import_batches").update({
    status: finalStatus, succeeded_rows: counts.succeeded, failed_rows: counts.failed, skipped_rows: counts.skipped,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", batch.id), "完成匯入批次");
  const report = args.skipReport
    ? { reportPath: null }
    : await writeReport(outputDir, sourcePath, sourceSha256, plan, [...byKey.values()]);
  return { batchId: batch.id, status: finalStatus, counts, reportPath: report.reportPath };
}

export async function buildAugustImportPlan(sourcePath = DEFAULT_SOURCE) {
  const sourceBuffer = await fs.readFile(sourcePath);
  const sourceSha256 = crypto.createHash("sha256").update(sourceBuffer).digest("hex");
  const raw = await readWorkbook(sourcePath);
  const plan = normalizeImport(raw);
  return { sourcePath, sourceSha256, plan };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { sourcePath, sourceSha256, plan } = await buildAugustImportPlan(args.source);
  const dryRunReport = await writeReport(args.output, sourcePath, sourceSha256, plan);
  console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry_run", sourcePath, sourceSha256, ...dryRunReport.summary, reportPath: dryRunReport.reportPath }, null, 2));
  if (!args.apply) return;
  const applied = await runApply({ args, sourcePath, sourceSha256, plan, outputDir: args.output });
  console.log(JSON.stringify(applied, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
