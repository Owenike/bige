import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const JOB_TYPES = ["notification_sweep", "opportunity_sweep", "delivery_dispatch"];
const DEFAULT_LIMIT = 20;
const TAIPEI_OFFSET_HOURS = 8;
const TAIPEI_TIMEZONE = "Asia/Taipei";

function parseArgs(argv) {
  const parsed = {
    limit: DEFAULT_LIMIT,
    from: null,
    to: null,
    tenantId: null,
    todayTwWindow: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "").trim();
    if (!arg) continue;
    if (arg === "--today-tw-10-11") {
      parsed.todayTwWindow = true;
      continue;
    }
    if (arg === "--limit") {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0) {
        parsed.limit = Math.min(200, Math.max(1, Math.floor(next)));
        i += 1;
      }
      continue;
    }
    if (arg === "--from") {
      const next = String(argv[i + 1] || "").trim();
      if (next) {
        parsed.from = next;
        i += 1;
      }
      continue;
    }
    if (arg === "--to") {
      const next = String(argv[i + 1] || "").trim();
      if (next) {
        parsed.to = next;
        i += 1;
      }
      continue;
    }
    if (arg === "--tenant-id") {
      const next = String(argv[i + 1] || "").trim();
      if (next) {
        parsed.tenantId = next;
        i += 1;
      }
      continue;
    }
  }

  return parsed;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const index = trimmed.indexOf("=");
  if (index <= 0) return null;
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const source = fs.readFileSync(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
  }
}

function loadProjectEnv() {
  const cwd = process.cwd();
  const envFiles = [
    ".env.local",
    ".env.staging",
    ".env.preview.local",
    ".env.preview.current",
    ".env",
  ];
  for (const file of envFiles) {
    loadEnvFile(path.join(cwd, file));
  }
}

function requireEnv() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    const missing = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
  return { supabaseUrl, serviceRoleKey };
}

function toIsoStringSafe(input) {
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function getTaipeiTodayWindowUtc() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value || "");
  const month = Number(parts.find((part) => part.type === "month")?.value || "");
  const day = Number(parts.find((part) => part.type === "day")?.value || "");
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error("Unable to resolve Asia/Taipei date.");
  }

  const fromUtc = new Date(Date.UTC(year, month - 1, day, 10 - TAIPEI_OFFSET_HOURS, 0, 0, 0));
  const toUtc = new Date(Date.UTC(year, month - 1, day, 11 - TAIPEI_OFFSET_HOURS, 0, 0, 0));
  return {
    fromUtcIso: fromUtc.toISOString(),
    toUtcIso: toUtc.toISOString(),
    twLabel: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} 10:00~11:00 (${TAIPEI_TIMEZONE})`,
  };
}

function printHeader(args, range) {
  console.log("=== Notification Scheduled Job Check ===");
  console.log("query: notification_job_runs where trigger_mode='scheduled' and job_type in target set");
  console.log(`job_types: ${JOB_TYPES.join(", ")}`);
  console.log("trigger_mode: scheduled");
  console.log(`limit: ${args.limit}`);
  if (args.tenantId) console.log(`tenant_id: ${args.tenantId}`);
  if (range.twLabel) console.log(`taipei_window: ${range.twLabel}`);
  if (range.fromUtcIso || range.toUtcIso) {
    console.log(`utc_from: ${range.fromUtcIso || "-"}`);
    console.log(`utc_to: ${range.toUtcIso || "-"}`);
  }
}

function printRows(rows) {
  if (rows.length === 0) {
    console.log("result: NOT_FOUND");
    return;
  }
  console.log(`result: found ${rows.length} row(s)`);
  for (const row of rows) {
    console.log(
      [
        `created_at=${row.created_at || "-"}`,
        `tenant_id=${row.tenant_id || "-"}`,
        `job_type=${row.job_type || "-"}`,
        `trigger_mode=${row.trigger_mode || "-"}`,
        `status=${row.status || "-"}`,
        `started_at=${row.started_at || "-"}`,
        `finished_at=${row.finished_at || "-"}`,
        `id=${row.id || "-"}`,
      ].join(" | "),
    );
  }
}

async function queryNonScheduledInRange(client, args, range) {
  if (!args.todayTwWindow) return { ok: true, count: 0 };

  let query = client
    .from("notification_job_runs")
    .select("id", { count: "exact", head: true })
    .neq("trigger_mode", "scheduled")
    .in("job_type", JOB_TYPES);

  if (args.tenantId) query = query.eq("tenant_id", args.tenantId);
  if (range.fromUtcIso) query = query.gte("created_at", range.fromUtcIso);
  if (range.toUtcIso) query = query.lte("created_at", range.toUtcIso);

  const result = await query;
  if (result.error) return { ok: false, error: result.error.message, count: 0 };
  return { ok: true, count: result.count || 0 };
}

async function main() {
  loadProjectEnv();
  const args = parseArgs(process.argv.slice(2));
  const env = requireEnv();
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const range = {
    fromUtcIso: null,
    toUtcIso: null,
    twLabel: null,
  };

  if (args.todayTwWindow) {
    const twWindow = getTaipeiTodayWindowUtc();
    range.fromUtcIso = twWindow.fromUtcIso;
    range.toUtcIso = twWindow.toUtcIso;
    range.twLabel = twWindow.twLabel;
  } else {
    if (args.from) range.fromUtcIso = toIsoStringSafe(args.from);
    if (args.to) range.toUtcIso = toIsoStringSafe(args.to);
    if (args.from && !range.fromUtcIso) {
      throw new Error(`Invalid --from datetime: ${args.from}`);
    }
    if (args.to && !range.toUtcIso) {
      throw new Error(`Invalid --to datetime: ${args.to}`);
    }
  }

  printHeader(args, range);

  let query = client
    .from("notification_job_runs")
    .select("id, tenant_id, job_type, trigger_mode, status, started_at, finished_at, created_at")
    .eq("trigger_mode", "scheduled")
    .in("job_type", JOB_TYPES)
    .order("created_at", { ascending: false })
    .limit(args.limit);

  if (args.tenantId) query = query.eq("tenant_id", args.tenantId);
  if (range.fromUtcIso) query = query.gte("created_at", range.fromUtcIso);
  if (range.toUtcIso) query = query.lte("created_at", range.toUtcIso);

  const result = await query;
  if (result.error) {
    throw new Error(`Supabase query failed: ${result.error.message}`);
  }
  const rows = result.data || [];
  printRows(rows);
  const nonScheduled = await queryNonScheduledInRange(client, args, range);
  if (!nonScheduled.ok) {
    throw new Error(`Supabase query failed (non-scheduled check): ${nonScheduled.error}`);
  }
  if (args.todayTwWindow) {
    console.log(rows.length > 0 ? "tw_10_11_check: FOUND" : "tw_10_11_check: NOT_FOUND");
    console.log(`tw_10_11_non_scheduled_count: ${nonScheduled.count}`);
    if (nonScheduled.count > 0) {
      console.log("sample_purity_warning: non-scheduled runs exist in this same window; isolate scheduled evidence first");
    }
    if (rows.length === 0) {
      console.log("next_step: check Vercel route logs for [jobs/run][scheduled] and confirm cron reached /api/jobs/run");
      console.log("next_step: verify notification_job_runs writes via createJobRun/completeJobRun in scheduled flow");
    }
  }
}

main().catch((error) => {
  console.error(`[check-job-runs] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
