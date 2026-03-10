import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_LIMIT = 20;

function parseArgs(argv) {
  const parsed = {
    limit: DEFAULT_LIMIT,
    from: null,
    to: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "").trim();
    if (!arg) continue;
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
  for (const line of source.split(/\r?\n/)) {
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
        `source=${row.source || "-"}`,
        `request_method=${row.request_method || "-"}`,
        `host=${row.host || "-"}`,
        `vercel_env=${row.vercel_env || "-"}`,
        `vercel_url=${row.vercel_url || "-"}`,
        `x_vercel_id=${row.x_vercel_id || "-"}`,
        `is_cron_like=${row.is_cron_like === true ? "true" : "false"}`,
        `id=${row.id || "-"}`,
      ].join(" | "),
    );
  }
}

async function main() {
  loadProjectEnv();
  const args = parseArgs(process.argv.slice(2));
  const fromIso = args.from ? toIsoStringSafe(args.from) : null;
  const toIso = args.to ? toIsoStringSafe(args.to) : null;
  if (args.from && !fromIso) throw new Error(`Invalid --from datetime: ${args.from}`);
  if (args.to && !toIso) throw new Error(`Invalid --to datetime: ${args.to}`);

  const env = requireEnv();
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("=== Cron Probe Check ===");
  console.log(`limit: ${args.limit}`);
  if (fromIso || toIso) {
    console.log(`utc_from: ${fromIso || "-"}`);
    console.log(`utc_to: ${toIso || "-"}`);
  }

  let query = client
    .from("cron_probe_runs")
    .select("id, created_at, source, request_method, host, vercel_env, vercel_url, x_vercel_id, is_cron_like")
    .order("created_at", { ascending: false })
    .limit(args.limit);

  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lte("created_at", toIso);

  const result = await query;
  if (result.error) {
    throw new Error(`Supabase query failed: ${result.error.message}`);
  }

  printRows(result.data || []);
}

main().catch((error) => {
  console.error(`[check-cron-probe] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

