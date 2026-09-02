import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const PERIOD_START = "2026-09-01";
export const PERIOD_END = "2026-09-30";
export const IMPORT_SOURCE = "september_2026_frontdesk_schedule";

export const FRONTDESK_WORK_DAYS = Object.freeze({
  Annie: Object.freeze([1, 2, 3, 4, 5, 7, 8, 9, 10, 11]),
  Miffy: Object.freeze([1, 6, 8, 12, 15, 26, 27, 29]),
});

const TENANT_LOCATOR_COACHES = Object.freeze([
  "Becky",
  "Wade",
  "Wiwi",
  "Una",
  "Hailey",
  "Lily",
  "Bae",
  "Owen",
]);

const clean = (value) => String(value ?? "").trim();
const monthDate = (day) => `2026-09-${String(day).padStart(2, "0")}`;

export function expectedFrontdeskPlan() {
  const namesByDate = new Map();
  for (const [name, days] of Object.entries(FRONTDESK_WORK_DAYS)) {
    for (const day of days) {
      const businessDate = monthDate(day);
      const names = namesByDate.get(businessDate) || [];
      names.push(name);
      namesByDate.set(businessDate, names);
    }
  }
  return [...namesByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([businessDate, names]) => ({
      businessDate,
      frontdeskName: names.join("/"),
    }));
}

export function buildFrontdeskChanges(currentRows) {
  const currentByDate = new Map(
    currentRows.map((row) => [String(row.business_date), row]),
  );
  return expectedFrontdeskPlan().flatMap((desired) => {
    const current = currentByDate.get(desired.businessDate);
    if (clean(current?.frontdesk_name) === desired.frontdeskName) return [];
    return [{
      kind: current ? "update" : "insert",
      businessDate: desired.businessDate,
      frontdeskName: desired.frontdeskName,
      previousFrontdeskName: current?.frontdesk_name ?? null,
      existingId: current?.id ?? null,
      preservedBusinessDay: current
        ? {
            isClosed: Boolean(current.is_closed),
            closureLabel: current.closure_label ?? null,
            source: current.source,
          }
        : null,
    }];
  });
}

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
    verifyOnly: argv.includes("--verify-only"),
  };
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
      .eq("is_active", true),
    "讀取正式場館教練",
  );
  const profilesByTenant = new Map();
  for (const profile of profiles || []) {
    const matchedName = TENANT_LOCATOR_COACHES.find(
      (name) => clean(profile.english_name).toLowerCase() === name.toLowerCase(),
    );
    if (!matchedName) continue;
    const tenantProfiles = profilesByTenant.get(profile.tenant_id) || [];
    tenantProfiles.push({ ...profile, matchedName });
    profilesByTenant.set(profile.tenant_id, tenantProfiles);
  }
  const matchingTenants = [...profilesByTenant.entries()].filter(([, tenantProfiles]) => {
    const names = new Set(tenantProfiles.map((profile) => profile.matchedName));
    return TENANT_LOCATOR_COACHES.every((name) => names.has(name));
  });
  if (matchingTenants.length !== 1) {
    throw new Error(`無法唯一判定 9 月日排課表所屬場館（符合數量：${matchingTenants.length}）`);
  }
  const [tenantId, matchingProfiles] = matchingTenants[0];
  const branchIds = [...new Set(matchingProfiles.map((profile) => profile.branch_id).filter(Boolean))];
  if (branchIds.length !== 1) {
    throw new Error(`無法唯一判定 9 月日排課表所屬分館（符合數量：${branchIds.length}）`);
  }
  return {
    tenantId,
    branchId: branchIds[0],
    matchedCoachCount: matchingProfiles.length,
  };
}

async function readBusinessDays(supabase, context) {
  return (await requireData(
    supabase
      .from("bige_business_day_settings")
      .select("id, business_date, frontdesk_name, is_closed, closure_label, source")
      .eq("tenant_id", context.tenantId)
      .gte("business_date", PERIOD_START)
      .lte("business_date", PERIOD_END)
      .order("business_date"),
    "讀取 9 月營業日設定",
  )) || [];
}

async function verifyPlan(supabase, context) {
  const rows = await readBusinessDays(supabase, context);
  const currentByDate = new Map(rows.map((row) => [String(row.business_date), row]));
  const mismatches = expectedFrontdeskPlan().flatMap((desired) => {
    const current = currentByDate.get(desired.businessDate);
    return clean(current?.frontdesk_name) === desired.frontdeskName
      ? []
      : [{
          businessDate: desired.businessDate,
          expected: desired.frontdeskName,
          actual: current?.frontdesk_name ?? null,
        }];
  });
  if (mismatches.length > 0) {
    throw new Error(`9 月櫃台班表驗證失敗：${JSON.stringify(mismatches)}`);
  }
  return {
    ok: true,
    assignedDateCount: expectedFrontdeskPlan().length,
    combinedDateCount: expectedFrontdeskPlan().filter((item) => item.frontdeskName.includes("/"))
      .length,
  };
}

async function applyPlan(supabase, context, currentRows) {
  const changes = buildFrontdeskChanges(currentRows);
  const inserted = [];
  const updated = [];
  for (const change of changes) {
    if (change.kind === "insert") {
      const result = await supabase
        .from("bige_business_day_settings")
        .insert({
          tenant_id: context.tenantId,
          branch_id: context.branchId,
          business_date: change.businessDate,
          is_closed: false,
          closure_label: null,
          frontdesk_name: change.frontdeskName,
          source: IMPORT_SOURCE,
        })
        .select("id, business_date, frontdesk_name")
        .single();
      if (result.error) throw new Error(`新增 ${change.businessDate} 櫃台班表：${result.error.message}`);
      inserted.push(result.data);
      continue;
    }
    const result = await supabase
      .from("bige_business_day_settings")
      .update({
        frontdesk_name: change.frontdeskName,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", context.tenantId)
      .eq("business_date", change.businessDate)
      .select("id, business_date, frontdesk_name, is_closed, closure_label, source")
      .single();
    if (result.error) throw new Error(`更新 ${change.businessDate} 櫃台班表：${result.error.message}`);
    const preserved = change.preservedBusinessDay;
    if (
      Boolean(result.data.is_closed) !== preserved.isClosed ||
      (result.data.closure_label ?? null) !== preserved.closureLabel ||
      result.data.source !== preserved.source
    ) {
      throw new Error(`${change.businessDate} 的館休或來源設定未被完整保留`);
    }
    updated.push(result.data);
  }
  if (changes.length > 0) {
    const auditResult = await supabase.from("audit_logs").insert({
      tenant_id: context.tenantId,
      actor_id: null,
      action: "september_2026_frontdesk_schedule_imported",
      target_type: "bige_schedule_month",
      target_id: "2026-09",
      reason: "使用者提供 Annie 與 Miffy 的 2026 年 9 月櫃台上班日",
      payload: {
        source: IMPORT_SOURCE,
        changes,
      },
    });
    if (auditResult.error) throw new Error(`寫入櫃台班表稽核紀錄：${auditResult.error.message}`);
  }
  return { inserted: inserted.length, updated: updated.length, unchanged: expectedFrontdeskPlan().length - changes.length };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.apply && args.verifyOnly) throw new Error("--apply 與 --verify-only 不能同時使用");
  const supabase = await createAdminClient();
  const context = await resolveContext(supabase);
  const currentRows = await readBusinessDays(supabase, context);
  const changes = buildFrontdeskChanges(currentRows);
  console.log(JSON.stringify({
    mode: args.apply ? "apply" : args.verifyOnly ? "verify-only" : "dry-run",
    month: "2026-09",
    matchedCoachCount: context.matchedCoachCount,
    plan: expectedFrontdeskPlan(),
    changes,
  }, null, 2));
  if (args.verifyOnly) {
    console.log(JSON.stringify({ verification: await verifyPlan(supabase, context) }, null, 2));
    return;
  }
  if (!args.apply) return;
  const result = await applyPlan(supabase, context, currentRows);
  const verification = await verifyPlan(supabase, context);
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
