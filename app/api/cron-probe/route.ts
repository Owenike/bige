import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

const LOG_PREFIX = "[cron/probe]";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SafeHeaderSummary = {
  hasAuthorization: boolean;
  hasCookie: boolean;
  hasXCronSecret: boolean;
  hasXVercelCron: boolean;
  xForwardedHost: string | null;
  xForwardedProto: string | null;
  xForwardedForPresent: boolean;
  accept: string | null;
  referer: string | null;
};

function normalizeHeaderValue(value: string | null, maxLength = 220) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function buildSafeHeaderSummary(request: Request): SafeHeaderSummary {
  return {
    hasAuthorization: request.headers.has("authorization") || request.headers.has("Authorization"),
    hasCookie: request.headers.has("cookie") || request.headers.has("Cookie"),
    hasXCronSecret: request.headers.has("x-cron-secret"),
    hasXVercelCron: request.headers.has("x-vercel-cron"),
    xForwardedHost: normalizeHeaderValue(request.headers.get("x-forwarded-host")),
    xForwardedProto: normalizeHeaderValue(request.headers.get("x-forwarded-proto")),
    xForwardedForPresent: request.headers.has("x-forwarded-for"),
    accept: normalizeHeaderValue(request.headers.get("accept")),
    referer: normalizeHeaderValue(request.headers.get("referer")),
  };
}

function resolveSource(params: { isVercelCronHeader: boolean; userAgent: string | null; xVercelId: string | null }) {
  if (params.isVercelCronHeader) return "vercel_cron";
  if ((params.userAgent || "").toLowerCase().includes("vercel")) return "vercel_runtime";
  if (params.xVercelId) return "vercel_edge";
  return "manual_http";
}

export async function GET(request: Request) {
  const headersSummary = buildSafeHeaderSummary(request);
  const userAgent = normalizeHeaderValue(request.headers.get("user-agent"));
  const host = normalizeHeaderValue(request.headers.get("x-forwarded-host")) || normalizeHeaderValue(request.headers.get("host"));
  const xVercelId = normalizeHeaderValue(request.headers.get("x-vercel-id"));
  const isCronLike =
    headersSummary.hasXVercelCron ||
    ((userAgent || "").toLowerCase().includes("vercel") && (!!xVercelId || (host || "").includes(".vercel.app")));
  const source = resolveSource({
    isVercelCronHeader: headersSummary.hasXVercelCron,
    userAgent,
    xVercelId,
  });

  const payload = {
    source,
    request_method: request.method,
    host,
    vercel_env: process.env.VERCEL_ENV || null,
    vercel_url: process.env.VERCEL_URL || null,
    x_vercel_id: xVercelId,
    user_agent: userAgent,
    headers_summary: headersSummary,
    is_cron_like: isCronLike,
  };

  try {
    const supabase = createSupabaseAdminClient();
    const insertResult = await supabase
      .from("cron_probe_runs")
      .insert(payload)
      .select("id, created_at, source, is_cron_like")
      .maybeSingle();

    if (insertResult.error) {
      console.error(`${LOG_PREFIX}[insert:error]`, {
        error: insertResult.error.message,
        source,
        isCronLike,
      });
      return NextResponse.json(
        { ok: false, error: "CRON_PROBE_WRITE_FAILED", message: insertResult.error.message },
        { status: 500 },
      );
    }

    console.info(`${LOG_PREFIX}[hit]`, {
      source,
      isCronLike,
      host,
      xVercelId,
      vercelEnv: process.env.VERCEL_ENV || null,
      requestId: request.headers.get("x-request-id") || null,
      probeId: insertResult.data?.id || null,
    });

    return NextResponse.json({
      ok: true,
      probe: insertResult.data || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX}[fatal]`, { error: message });
    return NextResponse.json(
      { ok: false, error: "CRON_PROBE_FATAL", message },
      { status: 500 },
    );
  }
}
