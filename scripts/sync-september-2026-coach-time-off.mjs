import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const IMPORT_SOURCE = "temporary_coach_leave_import";
export const IMPORT_PREFIX = "temporary-coach-off:2026-09";
export const PERIOD_START = "2026-09-01";
export const PERIOD_END = "2026-10-01";
export const BUSINESS_CLOSURE_DATE = "2026-09-05";

export const TIME_OFF_DAYS_BY_COACH = Object.freeze({
  Wade: Object.freeze([1, 4, 6, 7, 14, 15, 21, 22, 27, 28]),
  Wiwi: Object.freeze([6, 10, 15, 20, 23, 24, 29]),
  Una: Object.freeze([2, 11, 12, 18, 19, 25, 26]),
  Hailey: Object.freeze([6, 13, 14, 19, 20, 24, 29]),
  Lily: Object.freeze([1, 2, 4, 9, 14, 16, 26, 27, 28]),
  Bae: Object.freeze([1, 4, 8, 11, 15, 18, 22, 25, 26, 27, 28]),
});

const EXPECTED_COACHES = Object.freeze(Object.keys(TIME_OFF_DAYS_BY_COACH));

const clean = (value) => String(value ?? "").trim();
const monthDate = (day) => `2026-09-${String(day).padStart(2, "0")}`;

export function expectedTimeOffPlan() {
  return EXPECTED_COACHES.flatMap((coach) =>
    TIME_OFF_DAYS_BY_COACH[coach].map((day) => ({
      coach,
      date: monthDate(day),
      importRowKey: `${IMPORT_PREFIX}:${monthDate(day)}:${coach.toLowerCase()}`,
    })),
  );
}

export function buildTimeOffRows(context) {
  return expectedTimeOffPlan().map((item) => {
    const coach = context.coaches.get(item.coach.toLowerCase());
    if (!coach) throw new Error(`找不到教練帳號：${item.coach}`);
    return {
      tenant_id: context.tenantId,
      branch_id: coach.branch_id || context.branchId,
      coach_id: coach.id,
      starts_at: `${item.date}T00:00:00+08:00`,
      ends_at: `${item.date}T00:01:00+08:00`,
      content: "休",
      source: IMPORT_SOURCE,
      import_row_key: item.importRowKey,
      metadata: {
        temporary: true,
        purpose: "pre_staff_schedule_integration_operational_display",
        sourceMonth: "2026-09",
        removalKey: IMPORT_PREFIX,
      },
    };
  });
}

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const rollback = argv.includes("--rollback");
  if (apply && rollback) throw new Error("--apply 與 --rollback 不能同時使用");
  return { apply, rollback };
}

function loadDotEnv(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireData(query, label) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function resolveContext(supabase) {
  const profiles = await requireData(
    supabase
      .from("profiles")
      .select("id, tenant_id, branch_id, english_name, is_active")
      .eq("is_active", true)
      .in("english_name", EXPECTED_COACHES),
    "讀取 9 月教練",
  );
  const byTenant = new Map();
  for (const profile of profiles || []) {
    const items = byTenant.get(profile.tenant_id) || [];
    items.push(profile);
    byTenant.set(profile.tenant_id, items);
  }
  const matchingTenants = [...byTenant.entries()].filter(([, items]) => {
    const names = new Set(items.map((item) => clean(item.english_name).toLowerCase()));
    return EXPECTED_COACHES.every((name) => names.has(name.toLowerCase()));
  });
  if (matchingTenants.length !== 1) {
    throw new Error(`無法唯一判定正式場館（符合數量：${matchingTenants.length}）`);
  }
  const [tenantId, matchingProfiles] = matchingTenants[0];
  const coachMap = new Map(
    matchingProfiles.map((profile) => [clean(profile.english_name).toLowerCase(), profile]),
  );
  if (coachMap.size !== EXPECTED_COACHES.length) {
    throw new Error(`教練對應不完整（找到 ${coachMap.size}/${EXPECTED_COACHES.length}）`);
  }
  const branchIds = [...new Set(matchingProfiles.map((item) => item.branch_id).filter(Boolean))];
  if (branchIds.length !== 1) {
    throw new Error(`教練分館無法唯一判定（符合數量：${branchIds.length}）`);
  }
  return { tenantId, branchId: branchIds[0], coaches: coachMap };
}

async function readExistingState(supabase, context) {
  const [notes, businessDay, bookings] = await Promise.all([
    requireData(
      supabase
        .from("bige_schedule_notes")
        .select("id, coach_id, starts_at, ends_at, content, source, import_row_key, metadata")
        .eq("tenant_id", context.tenantId)
        .eq("source", IMPORT_SOURCE)
        .gte("starts_at", `${PERIOD_START}T00:00:00+08:00`)
        .lt("starts_at", `${PERIOD_END}T00:00:00+08:00`)
        .like("import_row_key", `${IMPORT_PREFIX}:%`),
      "讀取既有臨時休假",
    ),
    requireData(
      supabase
        .from("bige_business_day_settings")
        .select("id, branch_id, business_date, is_closed, closure_label, source")
        .eq("tenant_id", context.tenantId)
        .eq("business_date", BUSINESS_CLOSURE_DATE)
        .maybeSingle(),
      "讀取既有館休",
    ),
    requireData(
      supabase
        .from("bookings")
        .select("id, starts_at, ends_at, status, operation_kind, coach_id")
        .eq("tenant_id", context.tenantId)
        .eq("is_bige_schedule", true)
        .in("status", ["pending", "confirmed", "booked", "checked_in"])
        .gte("starts_at", `${BUSINESS_CLOSURE_DATE}T00:00:00+08:00`)
        .lt("starts_at", "2026-09-06T00:00:00+08:00"),
      "讀取館休日既有課程",
    ),
  ]);
  return { notes: notes || [], businessDay: businessDay || null, bookings: bookings || [] };
}

async function writeAudit(supabase, context, action, payload) {
  const result = await supabase.from("audit_logs").insert({
    tenant_id: context.tenantId,
    actor_id: null,
    action,
    target_type: "bige_schedule_month",
    target_id: "2026-09",
    reason: "使用者授權：教練帳號測試前的現場休假與館休顯示",
    payload,
  });
  if (result.error) throw new Error(`寫入匯入稽核：${result.error.message}`);
}

async function applyPlan(supabase, context, state) {
  const rows = buildTimeOffRows(context);
  const existingBusinessDay = state.businessDay;
  if (
    existingBusinessDay &&
    existingBusinessDay.source !== IMPORT_SOURCE &&
    !(existingBusinessDay.is_closed && existingBusinessDay.closure_label === "館休")
  ) {
    throw new Error("9 月 5 日已有其他營業日設定，停止覆蓋");
  }
  const existingByKey = new Map(state.notes.map((item) => [item.import_row_key, item]));
  const desiredKeys = new Set(rows.map((row) => row.import_row_key));
  const inserts = rows.filter((row) => !existingByKey.has(row.import_row_key));
  const updates = rows.filter((row) => existingByKey.has(row.import_row_key));
  const obsolete = state.notes.filter((row) => !desiredKeys.has(row.import_row_key));

  if (inserts.length > 0) {
    const result = await supabase.from("bige_schedule_notes").insert(inserts).select("id");
    if (result.error) throw new Error(`新增臨時休假：${result.error.message}`);
  }
  for (const row of updates) {
    const existing = existingByKey.get(row.import_row_key);
    const result = await supabase
      .from("bige_schedule_notes")
      .update({
        branch_id: row.branch_id,
        coach_id: row.coach_id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        content: row.content,
        source: row.source,
        metadata: row.metadata,
      })
      .eq("id", existing.id);
    if (result.error) throw new Error(`更新臨時休假：${result.error.message}`);
  }
  if (obsolete.length > 0) {
    const result = await supabase
      .from("bige_schedule_notes")
      .delete()
      .in("id", obsolete.map((item) => item.id));
    if (result.error) throw new Error(`清除過時臨時休假：${result.error.message}`);
  }

  let closureOwnership = existingBusinessDay?.source === IMPORT_SOURCE ? "updated" : "preserved";
  if (!existingBusinessDay) {
    const result = await supabase.from("bige_business_day_settings").insert({
      tenant_id: context.tenantId,
      branch_id: context.branchId,
      business_date: BUSINESS_CLOSURE_DATE,
      is_closed: true,
      closure_label: "館休",
      frontdesk_name: null,
      source: IMPORT_SOURCE,
    });
    if (result.error) throw new Error(`建立館休：${result.error.message}`);
    closureOwnership = "created";
  } else if (existingBusinessDay.source === IMPORT_SOURCE) {
    const result = await supabase
      .from("bige_business_day_settings")
      .update({
        branch_id: context.branchId,
        is_closed: true,
        closure_label: "館休",
        source: IMPORT_SOURCE,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingBusinessDay.id);
    if (result.error) throw new Error(`更新館休：${result.error.message}`);
  }

  await writeAudit(supabase, context, "temporary_september_2026_coach_leave_import", {
    importSource: IMPORT_SOURCE,
    timeOffCount: rows.length,
    inserted: inserts.length,
    updated: updates.length,
    removed: obsolete.length,
    closureDate: BUSINESS_CLOSURE_DATE,
    closureOwnership,
    preservedBookingCount: state.bookings.length,
  });
  return {
    expected: rows.length,
    inserted: inserts.length,
    updated: updates.length,
    removed: obsolete.length,
    closureOwnership,
    preservedBookingCount: state.bookings.length,
  };
}

async function rollbackPlan(supabase, context, state) {
  if (state.notes.length > 0) {
    const result = await supabase
      .from("bige_schedule_notes")
      .delete()
      .in("id", state.notes.map((item) => item.id));
    if (result.error) throw new Error(`移除臨時休假：${result.error.message}`);
  }
  let closureRemoved = false;
  if (state.businessDay?.source === IMPORT_SOURCE) {
    const result = await supabase
      .from("bige_business_day_settings")
      .delete()
      .eq("id", state.businessDay.id);
    if (result.error) throw new Error(`移除臨時館休：${result.error.message}`);
    closureRemoved = true;
  }
  await writeAudit(supabase, context, "temporary_september_2026_coach_leave_removed", {
    importSource: IMPORT_SOURCE,
    removedTimeOffCount: state.notes.length,
    closureDate: BUSINESS_CLOSURE_DATE,
    closureRemoved,
  });
  return { removedTimeOffCount: state.notes.length, closureRemoved };
}

async function verifyAppliedPlan(supabase, context) {
  const state = await readExistingState(supabase, context);
  const desiredRows = buildTimeOffRows(context);
  const desiredByKey = new Map(desiredRows.map((row) => [row.import_row_key, row]));
  const errors = state.notes.filter((row) => {
    const desired = desiredByKey.get(row.import_row_key);
    return (
      !desired ||
      row.coach_id !== desired.coach_id ||
      row.content !== "休" ||
      row.source !== IMPORT_SOURCE ||
      new Date(row.starts_at).toISOString() !== new Date(desired.starts_at).toISOString() ||
      new Date(row.ends_at).toISOString() !== new Date(desired.ends_at).toISOString()
    );
  });
  const closureOk = Boolean(
    state.businessDay?.is_closed && state.businessDay?.closure_label === "館休",
  );
  if (state.notes.length !== desiredRows.length || errors.length > 0 || !closureOk) {
    throw new Error(
      `正式資料驗證失敗：live=${state.notes.length}, desired=${desiredRows.length}, errors=${errors.length}, closure=${closureOk}`,
    );
  }
  return {
    ok: true,
    timeOffCount: state.notes.length,
    closureDate: BUSINESS_CLOSURE_DATE,
    closureOk,
    preservedBookingCount: state.bookings.length,
  };
}

async function verifyRolledBackPlan(supabase, context) {
  const state = await readExistingState(supabase, context);
  if (state.notes.length > 0 || state.businessDay?.source === IMPORT_SOURCE) {
    throw new Error(
      `臨時資料移除驗證失敗：notes=${state.notes.length}, closureOwned=${state.businessDay?.source === IMPORT_SOURCE}`,
    );
  }
  return { ok: true, timeOffCount: 0, closureOwned: false };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const plan = expectedTimeOffPlan();
  const summary = Object.fromEntries(
    EXPECTED_COACHES.map((coach) => [coach, TIME_OFF_DAYS_BY_COACH[coach].length]),
  );
  console.log(
    JSON.stringify(
      {
        mode: args.rollback ? "rollback" : args.apply ? "apply" : "dry-run",
        month: "2026-09",
        timeOffCount: plan.length,
        countsByCoach: summary,
        closureDate: BUSINESS_CLOSURE_DATE,
      },
      null,
      2,
    ),
  );
  if (!args.apply && !args.rollback) return;

  const supabase = await createAdminClient();
  const context = await resolveContext(supabase);
  const state = await readExistingState(supabase, context);
  console.log(
    JSON.stringify(
      {
        preflight: {
          matchedCoaches: context.coaches.size,
          existingTemporaryNotes: state.notes.length,
          existingBusinessDay: state.businessDay,
          preservedBookingCount: state.bookings.length,
        },
      },
      null,
      2,
    ),
  );

  if (args.rollback) {
    const result = await rollbackPlan(supabase, context, state);
    const verification = await verifyRolledBackPlan(supabase, context);
    console.log(JSON.stringify({ result, verification }, null, 2));
    return;
  }

  const result = await applyPlan(supabase, context, state);
  const verification = await verifyAppliedPlan(supabase, context);
  console.log(JSON.stringify({ result, verification }, null, 2));
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
