import { NextResponse } from "next/server";
import { errors as joseErrors } from "jose";
import type {
  EntryDenyReason,
  MembershipKind,
  VerifyEntryRequest,
  VerifyEntryResponse,
} from "../../../../types/entry";
import { verifyEntryToken } from "../../../../lib/entry-token";
import { ENTRY_SCHEMA } from "../../../../lib/entry-schema";
import { openGate } from "../../../../lib/integrations/gate";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";
import { httpLogBase, logEvent } from "../../../../lib/observability";
import { rateLimitFixedWindow } from "../../../../lib/rate-limit";

const ANTI_PASSBACK_MINUTES = 10;

type MemberRow = {
  id: string;
  tenant_id: string;
  store_id: string;
  name: string;
  photo_url: string | null;
  phone: string | null;
};

type EntitlementRow = {
  kind: MembershipKind;
  monthly_expires_at: string | null;
  remaining_sessions: number | null;
};

type VerifyEntryScanRow = {
  decision: "allow" | "deny";
  reason: EntryDenyReason | null;
  checked_at: string;
  membership_kind: MembershipKind;
  monthly_expires_at: string | null;
  remaining_sessions: number;
  latest_allow_at: string | null;
  today_allow_count: number;
};

function phoneLast4(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4) || null;
}

function deriveMembershipKind(entitlement: EntitlementRow | null): MembershipKind {
  if (!entitlement) return "none";
  return entitlement.kind;
}

function parseJwtError(error: unknown): EntryDenyReason {
  if (error instanceof joseErrors.JWTExpired) return "token_expired";
  return "token_invalid";
}

function denyResponse(reason: EntryDenyReason): VerifyEntryResponse {
  return {
    decision: "deny",
    reason,
    member: null,
    membership: {
      kind: "none",
      monthlyExpiresAt: null,
      remainingSessions: null,
    },
    latestCheckinAt: null,
    todayCheckinCount: 0,
    checkedAt: new Date().toISOString(),
    gate: {
      attempted: false,
      opened: false,
      message: "Check-in denied",
    },
  };
}

function buildResponse(input: {
  member: MemberRow;
  entitlement: EntitlementRow | null;
  latestAllowAt: string | null;
  todayCheckinCount: number;
  decision: "allow" | "deny";
  reason: EntryDenyReason | null;
  checkedAt: string;
  gate?: VerifyEntryResponse["gate"];
}): VerifyEntryResponse {
  return {
    decision: input.decision,
    reason: input.reason,
    member: {
      id: input.member.id,
      name: input.member.name,
      photoUrl: input.member.photo_url,
      phoneLast4: phoneLast4(input.member.phone),
    },
    membership: {
      kind: deriveMembershipKind(input.entitlement),
      monthlyExpiresAt: input.entitlement?.monthly_expires_at ?? null,
      remainingSessions: input.entitlement?.remaining_sessions ?? null,
    },
    latestCheckinAt: input.latestAllowAt,
    todayCheckinCount: input.todayCheckinCount,
    checkedAt: input.checkedAt,
    gate:
      input.gate ?? {
        attempted: false,
        opened: false,
        message: "Gate not requested",
      },
  };
}

function buildEntitlement(input: {
  membershipKind: MembershipKind;
  monthlyExpiresAt: string | null;
  remainingSessions: number;
}): EntitlementRow {
  return {
    kind: input.membershipKind,
    monthly_expires_at: input.monthlyExpiresAt,
    remaining_sessions: input.remainingSessions,
  };
}

export async function POST(request: Request) {
  const t0 = Date.now();
  const base = httpLogBase(request);

  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) {
    logEvent("info", {
      type: "http",
      action: "entry_verify",
      ...base,
      status: auth.response.status,
      durationMs: Date.now() - t0,
    });
    return auth.response;
  }

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) {
    logEvent("info", {
      type: "http",
      action: "entry_verify",
      ...base,
      userId: auth.context.userId,
      tenantId: auth.context.tenantId,
      status: shiftGuard.response.status,
      durationMs: Date.now() - t0,
      decision: "deny",
      reason: "shift_not_open",
    });
    return shiftGuard.response;
  }

  // Generous limit: scanning should be fast, but still guarded against abuse.
  const ip = base.ip || "unknown";
  const rlUser = rateLimitFixedWindow({
    key: `entry_verify:user:${auth.context.userId}`,
    limit: 300,
    windowMs: 60 * 1000,
  });
  const rlIp = rateLimitFixedWindow({
    key: `entry_verify:ip:${ip}`,
    limit: 600,
    windowMs: 60 * 1000,
  });

  if (!rlUser.ok || !rlIp.ok) {
    const retryAfterSec = Math.max(rlUser.retryAfterSec, rlIp.retryAfterSec);
    logEvent("warn", {
      type: "rate_limit",
      action: "entry_verify",
      ...base,
      userId: auth.context.userId,
      tenantId: auth.context.tenantId,
      status: 200,
      durationMs: Date.now() - t0,
      retryAfterSec,
    });

    const resp: VerifyEntryResponse = {
      ...denyResponse("rate_limited"),
      gate: {
        attempted: false,
        opened: false,
        message: "Rate limited",
      },
    };

    return NextResponse.json(resp, {
      status: 200,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(Math.min(rlUser.limit, rlIp.limit)),
        "X-RateLimit-Remaining": String(Math.min(rlUser.remaining, rlIp.remaining)),
      },
    });
  }

  const body = (await request.json().catch(() => null)) as VerifyEntryRequest | null;
  if (!body?.token) {
    logEvent("info", { type: "http", action: "entry_verify", ...base, userId: auth.context.userId, status: 200, durationMs: Date.now() - t0, decision: "deny", reason: "token_invalid" });
    return NextResponse.json(
      {
        ...denyResponse("token_invalid"),
        gate: { attempted: false, opened: false, message: "token is required" },
      },
      { status: 200 },
    );
  }

  let payload: Awaited<ReturnType<typeof verifyEntryToken>>;
  try {
    payload = await verifyEntryToken(body.token);
  } catch (error) {
    logEvent("info", { type: "http", action: "entry_verify", ...base, userId: auth.context.userId, status: 200, durationMs: Date.now() - t0, decision: "deny", reason: parseJwtError(error) });
    return NextResponse.json(denyResponse(parseJwtError(error)), { status: 200 });
  }

  if (auth.context.tenantId !== payload.tenantId) {
    logEvent("info", { type: "http", action: "entry_verify", ...base, userId: auth.context.userId, status: 200, durationMs: Date.now() - t0, decision: "deny", reason: "token_invalid" });
    return NextResponse.json(denyResponse("token_invalid"), { status: 200 });
  }
  if (auth.context.branchId && auth.context.branchId !== payload.storeId) {
    logEvent("info", { type: "http", action: "entry_verify", ...base, userId: auth.context.userId, status: 200, durationMs: Date.now() - t0, decision: "deny", reason: "token_invalid" });
    return NextResponse.json(denyResponse("token_invalid"), { status: 200 });
  }

  const supabase = createSupabaseAdminClient();

  const memberSelect = [
    "id",
    "tenant_id",
    "store_id",
    `${ENTRY_SCHEMA.memberNameColumn}:name`,
    `${ENTRY_SCHEMA.memberPhotoColumn}:photo_url`,
    `${ENTRY_SCHEMA.memberPhoneColumn}:phone`,
  ].join(", ");

  const memberQuery = await supabase
    .from(ENTRY_SCHEMA.membersTable)
    .select(memberSelect)
    .eq("id", payload.memberId)
    .eq("tenant_id", payload.tenantId)
    .eq("store_id", payload.storeId)
    .maybeSingle<MemberRow>();

  if (memberQuery.error || !memberQuery.data) {
    logEvent("info", { type: "http", action: "entry_verify", ...base, userId: auth.context.userId, status: 200, durationMs: Date.now() - t0, decision: "deny", reason: "member_not_found" });
    return NextResponse.json(denyResponse("member_not_found"), { status: 200 });
  }

  const member = memberQuery.data;
  const scanResult = await supabase.rpc("verify_entry_scan", {
    p_tenant_id: payload.tenantId,
    p_store_id: payload.storeId,
    p_member_id: payload.memberId,
    p_jti: payload.jti,
    p_checked_at: new Date().toISOString(),
    p_anti_passback_minutes: ANTI_PASSBACK_MINUTES,
  });

  if (scanResult.error) {
    logEvent("warn", { type: "http", action: "entry_verify", ...base, userId: auth.context.userId, status: 200, durationMs: Date.now() - t0, decision: "deny", reason: "token_invalid", rpcError: scanResult.error.message });
    return NextResponse.json(denyResponse("token_invalid"), { status: 200 });
  }

  const scan = (Array.isArray(scanResult.data) ? scanResult.data[0] : null) as VerifyEntryScanRow | null;
  if (!scan) {
    logEvent("warn", { type: "http", action: "entry_verify", ...base, userId: auth.context.userId, status: 200, durationMs: Date.now() - t0, decision: "deny", reason: "token_invalid" });
    return NextResponse.json(denyResponse("token_invalid"), { status: 200 });
  }

  const entitlement: EntitlementRow = buildEntitlement({
    membershipKind: scan.membership_kind || "none",
    monthlyExpiresAt: scan.monthly_expires_at,
    remainingSessions: Number(scan.remaining_sessions ?? 0),
  });
  const decision = scan.decision === "allow" ? "allow" : "deny";
  const reason: EntryDenyReason | null = scan.reason ?? null;
  const checkedAt = scan.checked_at || new Date().toISOString();
  const latestAllowAt = scan.latest_allow_at ?? null;
  const todayCheckinCount = Number(scan.today_allow_count ?? 0);

  let gate: VerifyEntryResponse["gate"] = {
    attempted: false,
    opened: false,
    message: decision === "allow" ? "Gate not requested" : "Check-in denied",
  };

  if (decision === "allow") {
    gate = await openGate({
      tenantId: payload.tenantId,
      storeId: payload.storeId,
      memberId: payload.memberId,
      checkinAt: checkedAt,
    });
  }

  const response = buildResponse({
    member,
    entitlement,
    latestAllowAt,
    todayCheckinCount,
    decision,
    reason,
    checkedAt,
    gate,
  });

  logEvent("info", {
    type: "http",
    action: "entry_verify",
    ...base,
    userId: auth.context.userId,
    tenantId: auth.context.tenantId,
    status: 200,
    durationMs: Date.now() - t0,
    decision,
    reason,
    gateOpened: Boolean(gate?.opened),
  });

  return NextResponse.json(response, { status: 200 });
}
