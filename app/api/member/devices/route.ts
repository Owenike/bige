import { NextResponse } from "next/server";
import { getClientIp } from "../../../../lib/observability";
import { requireProfile } from "../../../../lib/auth-context";

type DeviceItem = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  platform: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  isCurrent: boolean;
};

function tableMissing(message: string | undefined, tableName: string) {
  const text = (message || "").toLowerCase();
  return (
    text.includes(`relation "${tableName.toLowerCase()}" does not exist`) ||
    text.includes(`relation '${tableName.toLowerCase()}' does not exist`)
  );
}

function columnMissing(message: string | undefined, columnName: string) {
  const text = (message || "").toLowerCase();
  return (
    text.includes(`column "${columnName.toLowerCase()}" does not exist`) ||
    text.includes(`column ${columnName.toLowerCase()} does not exist`) ||
    text.includes(`column '${columnName.toLowerCase()}' does not exist`)
  );
}

function parseDisplayName(input: unknown) {
  if (typeof input !== "string") return "";
  return input.trim();
}

async function loadMemberId(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return { ok: false as const, response: auth.response };
  if (!auth.context.tenantId) {
    return { ok: false as const, response: NextResponse.json({ error: "Tenant context is required" }, { status: 400 }) };
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();
  if (memberResult.error || !memberResult.data) {
    return { ok: false as const, response: NextResponse.json({ error: "Member not found" }, { status: 404 }) };
  }

  return {
    ok: true as const,
    auth,
    memberId: String(memberResult.data.id),
    tenantId: auth.context.tenantId,
  };
}

export async function GET(request: Request) {
  const member = await loadMemberId(request);
  if (!member.ok) return member.response;

  let deviceResult = await member.auth.supabase
    .from("member_device_sessions")
    .select("id, user_agent, ip_address, platform, display_name, created_at, updated_at, last_seen_at, revoked_at")
    .eq("tenant_id", member.tenantId)
    .eq("member_id", member.memberId)
    .order("last_seen_at", { ascending: false })
    .limit(30);

  if (deviceResult.error && columnMissing(deviceResult.error.message, "display_name")) {
    deviceResult = await member.auth.supabase
      .from("member_device_sessions")
      .select("id, user_agent, ip_address, platform, created_at, updated_at, last_seen_at, revoked_at")
      .eq("tenant_id", member.tenantId)
      .eq("member_id", member.memberId)
      .order("last_seen_at", { ascending: false })
      .limit(30);
  }

  if (deviceResult.error) {
    if (tableMissing(deviceResult.error.message, "member_device_sessions")) {
      return NextResponse.json({ available: false, items: [] });
    }
    return NextResponse.json({ error: deviceResult.error.message }, { status: 500 });
  }

  const requestUa = request.headers.get("user-agent") || null;
  const requestIp = getClientIp(request) || null;
  let currentAssigned = false;

  const items: DeviceItem[] = ((deviceResult.data || []) as Array<{
    id: string;
    user_agent: string | null;
    ip_address: string | null;
    platform: string | null;
    display_name?: string | null;
    created_at: string;
    updated_at: string;
    last_seen_at: string;
    revoked_at: string | null;
  }>).map((row) => {
    const candidateCurrent = Boolean(
      !currentAssigned &&
      !row.revoked_at &&
      ((requestUa && row.user_agent && requestUa === row.user_agent) ||
        (requestIp && row.ip_address && requestIp === row.ip_address)),
    );
    if (candidateCurrent) currentAssigned = true;
    return {
      id: String(row.id),
      userAgent: row.user_agent ? String(row.user_agent) : null,
      ipAddress: row.ip_address ? String(row.ip_address) : null,
      platform: row.platform ? String(row.platform) : null,
      displayName: row.display_name ? String(row.display_name) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastSeenAt: String(row.last_seen_at),
      revokedAt: row.revoked_at ? String(row.revoked_at) : null,
      isCurrent: candidateCurrent,
    };
  });

  if (!currentAssigned) {
    const firstActive = items.find((item) => !item.revokedAt);
    if (firstActive) firstActive.isCurrent = true;
  }

  return NextResponse.json({ available: true, items });
}

export async function PATCH(request: Request) {
  const member = await loadMemberId(request);
  if (!member.ok) return member.response;

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
  if (!deviceId) return NextResponse.json({ error: "deviceId is required" }, { status: 400 });

  if (action === "revoke") {
    const now = new Date().toISOString();
    const revokeResult = await member.auth.supabase
      .from("member_device_sessions")
      .update({ revoked_at: now, updated_at: now })
      .eq("tenant_id", member.tenantId)
      .eq("member_id", member.memberId)
      .eq("id", deviceId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();

    if (revokeResult.error) {
      if (tableMissing(revokeResult.error.message, "member_device_sessions")) {
        return NextResponse.json({ error: "Device session table is not available. Apply latest migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: revokeResult.error.message }, { status: 500 });
    }
    if (!revokeResult.data) return NextResponse.json({ error: "Device not found or already revoked" }, { status: 404 });
    return NextResponse.json({ ok: true, deviceId });
  }

  if (action === "rename") {
    const displayName = parseDisplayName(body?.displayName);
    if (displayName.length > 40) {
      return NextResponse.json({ error: "displayName is too long (max 40)" }, { status: 400 });
    }

    const now = new Date().toISOString();
    let renameResult = await member.auth.supabase
      .from("member_device_sessions")
      .update({ display_name: displayName || null, updated_at: now })
      .eq("tenant_id", member.tenantId)
      .eq("member_id", member.memberId)
      .eq("id", deviceId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();

    if (renameResult.error && columnMissing(renameResult.error.message, "display_name")) {
      return NextResponse.json({ error: "Device naming is unavailable. Apply latest migrations first." }, { status: 501 });
    }
    if (renameResult.error) {
      if (tableMissing(renameResult.error.message, "member_device_sessions")) {
        return NextResponse.json({ error: "Device session table is not available. Apply latest migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: renameResult.error.message }, { status: 500 });
    }
    if (!renameResult.data) return NextResponse.json({ error: "Device not found or already revoked" }, { status: 404 });
    return NextResponse.json({ ok: true, deviceId, displayName: displayName || null });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
