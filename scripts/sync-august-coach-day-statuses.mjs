import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const DEFAULT_SOURCE = "C:\\Users\\User\\Downloads\\8月教練預約本.xlsx-.xlsx";
const COACH_PAIRS = [
  [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17],
];
const EXPECTED_COACHES = new Set(["Becky", "Wiwi", "Lily", "Wade", "Una", "Bae", "Owen"]);
const STATUS_BY_MARKER = new Map([
  ["早", "early"],
  ["晚", "late"],
  ["休", "off"],
]);

const clean = (value) => String(value ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
const normalizeCoach = (value) => clean(value).replace(/^ST\s+/i, "");
const SHIFT_RANGE_PATTERN = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/;

function shiftRangeStatus(value) {
  const match = clean(value).match(SHIFT_RANGE_PATTERN);
  if (!match) return null;
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const endMinutes = Number(match[3]) * 60 + Number(match[4]);
  if (startMinutes >= endMinutes) return null;
  return startMinutes < 13 * 60 ? "early" : "late";
}

function resolveCoachDayStatus(values) {
  const explicitWorkMarker = values.find((value) => value === "早" || value === "晚");
  if (explicitWorkMarker) {
    return {
      marker: explicitWorkMarker,
      status: STATUS_BY_MARKER.get(explicitWorkMarker),
    };
  }

  const shiftStatus = values.map(shiftRangeStatus).find(Boolean);
  if (shiftStatus) {
    return { marker: shiftStatus === "early" ? "早" : "晚", status: shiftStatus };
  }

  if (values.length > 0 && values.every((value) => value === "休")) {
    return { marker: "休", status: "off" };
  }
  return null;
}

function parseArgs(argv) {
  const result = { apply: false, source: DEFAULT_SOURCE };
  for (const arg of argv) {
    if (arg === "--apply") result.apply = true;
    else if (arg.startsWith("--source=")) result.source = path.resolve(arg.slice("--source=".length));
  }
  return result;
}

function loadDotEnv(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function createAdminClient() {
  try {
    loadDotEnv(await fs.readFile(path.resolve(".env.local"), "utf8"));
  } catch {}
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("缺少 Supabase 管理連線設定");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireData(query, label) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function readStatuses(source) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(source);
  const sheet = workbook.getWorksheet("總表");
  if (!sheet) throw new Error("找不到 Excel 工作表：總表");

  const statuses = new Map();
  for (let day = 1; day <= 31; day += 1) {
    const headerRow = 1 + (day - 1) * 24;
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    for (const [, contentColumn] of COACH_PAIRS) {
      const coach = normalizeCoach(sheet.getRow(headerRow).getCell(contentColumn).text);
      if (!coach) continue;
      const values = [];
      for (let hour = 6; hour <= 23; hour += 1) {
        const excelRow = headerRow + 1 + (hour - 6);
        const marker = clean(sheet.getRow(excelRow).getCell(contentColumn).text);
        if (marker) values.push(marker);
      }
      const resolved = resolveCoachDayStatus(values);
      if (resolved) statuses.set(`${date}|${coach}`, { date, coach, ...resolved });
    }
  }
  return [...statuses.values()];
}

async function resolveTenantAndCoaches(supabase) {
  const matches = await requireData(
    supabase
      .from("profiles")
      .select("tenant_id, english_name")
      .eq("is_active", true)
      .in("english_name", [...EXPECTED_COACHES]),
    "尋找正式場館",
  );
  const namesByTenant = new Map();
  for (const profile of matches || []) {
    const names = namesByTenant.get(profile.tenant_id) || new Set();
    names.add(clean(profile.english_name).toLowerCase());
    namesByTenant.set(profile.tenant_id, names);
  }
  const tenantIds = [...namesByTenant.entries()]
    .filter(([, names]) => [...EXPECTED_COACHES].every((name) => names.has(name.toLowerCase())))
    .map(([tenantId]) => tenantId);
  if (tenantIds.length !== 1) throw new Error(`無法唯一判定正式場館（符合數量：${tenantIds.length}）`);

  const tenantId = tenantIds[0];
  const [branches, profiles] = await Promise.all([
    requireData(supabase.from("branches").select("id").eq("tenant_id", tenantId).limit(1), "讀取 branch"),
    requireData(
      supabase
        .from("profiles")
        .select("id, branch_id, english_name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .in("english_name", [...EXPECTED_COACHES]),
      "讀取教練",
    ),
  ]);
  return {
    tenantId,
    branchId: branches?.[0]?.id || null,
    coaches: new Map((profiles || []).map((profile) => [clean(profile.english_name).toLowerCase(), profile])),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const parsed = await readStatuses(args.source);
  const statusCounts = parsed.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});
  const recognized = parsed.filter((row) => EXPECTED_COACHES.has(row.coach));
  const skipped = [...new Set(parsed.filter((row) => !EXPECTED_COACHES.has(row.coach)).map((row) => row.coach))];

  console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry-run", parsed: parsed.length, recognized: recognized.length, skipped, statusCounts }, null, 2));
  if (!args.apply) return;

  const supabase = await createAdminClient();
  const context = await resolveTenantAndCoaches(supabase);
  const rows = recognized.map((row) => {
    const coach = context.coaches.get(row.coach.toLowerCase());
    if (!coach) throw new Error(`找不到教練帳號：${row.coach}`);
    return {
      tenant_id: context.tenantId,
      branch_id: coach.branch_id || context.branchId,
      coach_id: coach.id,
      starts_at: `${row.date}T00:00:00+08:00`,
      ends_at: `${row.date}T00:01:00+08:00`,
      content: row.marker,
      source: "legacy_schedule_import",
      import_row_key: `coach-day-status:${row.date}:${row.coach}:${row.status}`,
    };
  });
  const existing = await requireData(
    supabase
      .from("bige_schedule_notes")
      .select("id, import_row_key")
      .eq("tenant_id", context.tenantId)
      .eq("source", "legacy_schedule_import")
      .gte("starts_at", "2026-08-01T00:00:00+08:00")
      .lt("starts_at", "2026-09-01T00:00:00+08:00")
      .not("import_row_key", "is", null),
    "讀取既有每日班別",
  );
  const existingByKey = new Map((existing || []).map((item) => [item.import_row_key, item.id]));
  const desiredKeys = new Set(rows.map((row) => row.import_row_key));
  const obsolete = (existing || []).filter(
    (item) =>
      String(item.import_row_key || "").startsWith("coach-day-status:") &&
      !desiredKeys.has(item.import_row_key),
  );
  const inserts = rows.filter((row) => !existingByKey.has(row.import_row_key));
  const updates = rows.filter((row) => existingByKey.has(row.import_row_key));

  if (inserts.length > 0) {
    const inserted = await supabase.from("bige_schedule_notes").insert(inserts).select("id");
    if (inserted.error) throw new Error(`新增每日班別：${inserted.error.message}`);
  }
  for (const row of updates) {
    const updated = await supabase
      .from("bige_schedule_notes")
      .update({
        branch_id: row.branch_id,
        coach_id: row.coach_id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        content: row.content,
        source: row.source,
      })
      .eq("id", existingByKey.get(row.import_row_key));
    if (updated.error) throw new Error(`更新每日班別：${updated.error.message}`);
  }
  for (let offset = 0; offset < obsolete.length; offset += 100) {
    const removed = await supabase
      .from("bige_schedule_notes")
      .delete()
      .in("id", obsolete.slice(offset, offset + 100).map((item) => item.id));
    if (removed.error) throw new Error(`清除過時每日班別：${removed.error.message}`);
  }
  console.log(JSON.stringify({ applied: rows.length, inserted: inserts.length, updated: updates.length, removed: obsolete.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
