import { NextResponse } from "next/server";
import { issueEntryToken } from "../../../../lib/entry-token";
import { ENTRY_SCHEMA } from "../../../../lib/entry-schema";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { httpLogBase, logEvent } from "../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";

interface MemberTokenSourceRow {
  id: string;
  tenant_id: string;
  store_id: string;
}

export async function POST(request: Request) {
  const t0 = Date.now();
  const base = httpLogBase(request);

  const supabase = await createSupabaseServerClient(request);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    logEvent("info", { type: "http", action: "entry_issue", ...base, status: 401, durationMs: Date.now() - t0 });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Limit token issuance per user and per IP to reduce abuse.
  const ip = base.ip || "unknown";
  const rlUser = rateLimitFixedWindow({ key: `entry_issue:user:${user.id}`, limit: 30, windowMs: 60 * 1000 });
  const rlIp = rateLimitFixedWindow({ key: `entry_issue:ip:${ip}`, limit: 60, windowMs: 60 * 1000 });
  if (!rlUser.ok || !rlIp.ok) {
    const retryAfterSec = Math.max(rlUser.retryAfterSec, rlIp.retryAfterSec);
    logEvent("warn", {
      type: "rate_limit",
      action: "entry_issue",
      ...base,
      userId: user.id,
      status: 429,
      durationMs: Date.now() - t0,
      retryAfterSec,
    });
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(Math.min(rlUser.limit, rlIp.limit)),
          "X-RateLimit-Remaining": String(Math.min(rlUser.remaining, rlIp.remaining)),
        },
      },
    );
  }

  const body = await request.json().catch(() => ({}));
  const requestedStoreId = typeof (body as any)?.storeId === "string" ? String((body as any).storeId) : null;

  const { data: member, error: memberError } = await supabase
    .from(ENTRY_SCHEMA.membersTable)
    .select("id, tenant_id, store_id")
    .eq(ENTRY_SCHEMA.authUserIdColumn, user.id)
    .maybeSingle();

  const typedMember = (member as MemberTokenSourceRow | null) ?? null;
  if (memberError || !typedMember) {
    logEvent("info", {
      type: "http",
      action: "entry_issue",
      ...base,
      userId: user.id,
      status: 404,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const storeId = requestedStoreId ?? typedMember.store_id;
  if (!storeId) {
    logEvent("info", { type: "http", action: "entry_issue", ...base, userId: user.id, status: 400, durationMs: Date.now() - t0 });
    return NextResponse.json({ error: "Missing store_id" }, { status: 400 });
  }
  if (requestedStoreId && typedMember.store_id && requestedStoreId !== typedMember.store_id) {
    logEvent("info", { type: "http", action: "entry_issue", ...base, userId: user.id, status: 403, durationMs: Date.now() - t0 });
    return NextResponse.json({ error: "Forbidden store_id" }, { status: 403 });
  }

  const token = await issueEntryToken({
    tenantId: typedMember.tenant_id,
    storeId,
    memberId: typedMember.id,
  });

  logEvent("info", {
    type: "http",
    action: "entry_issue",
    ...base,
    userId: user.id,
    tenantId: typedMember.tenant_id,
    status: 200,
    durationMs: Date.now() - t0,
  });

  return NextResponse.json(token);
}

