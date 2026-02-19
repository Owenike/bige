import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

type ChainRulePayload = {
  allowCrossBranch?: boolean;
  requireManagerApproval?: boolean;
  suspensionSync?: boolean;
  guestPassEnabled?: boolean;
  maxEntryPerDay?: number | null;
  allowedBranchIds?: string[];
  note?: string | null;
  [key: string]: unknown;
};

type ChainBlacklistPayload = {
  name?: string;
  memberCode?: string | null;
  phone?: string | null;
  reason?: string | null;
  expiresAt?: string | null;
  [key: string]: unknown;
};

function parseOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseOptionalIso(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseAllowedBranchIds(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parseMaxEntryPerDay(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const limit = Math.min(400, Math.max(60, Number(new URL(request.url).searchParams.get("limit") || 180)));
  const maxRows = Math.min(3000, limit * 12);

  const { data, error } = await auth.supabase
    .from("audit_logs")
    .select("id, action, target_type, target_id, payload, reason, actor_id, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .in("target_type", ["chain_rule", "chain_blacklist"])
    .order("created_at", { ascending: true })
    .limit(maxRows);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rule = {
    allowCrossBranch: true,
    requireManagerApproval: true,
    suspensionSync: true,
    guestPassEnabled: false,
    maxEntryPerDay: null as number | null,
    allowedBranchIds: [] as string[],
    note: null as string | null,
    updatedAt: null as string | null,
    updatedBy: null as string | null,
  };

  const blacklistMap = new Map<string, {
    id: string;
    name: string;
    memberCode: string | null;
    phone: string | null;
    reason: string | null;
    createdAt: string;
    updatedAt: string;
    expiresAt: string | null;
  }>();

  for (const row of (data || []) as Array<{
    action: string;
    target_type: string;
    target_id: string | null;
    payload: ChainRulePayload | ChainBlacklistPayload | null;
    reason: string | null;
    actor_id: string | null;
    created_at: string;
  }>) {
    const payload = row.payload || {};
    if (row.target_type === "chain_rule" && row.action === "chain_rule_set") {
      rule = {
        allowCrossBranch: Boolean(payload.allowCrossBranch),
        requireManagerApproval: Boolean(payload.requireManagerApproval),
        suspensionSync: Boolean(payload.suspensionSync),
        guestPassEnabled: Boolean(payload.guestPassEnabled),
        maxEntryPerDay: parseMaxEntryPerDay(payload.maxEntryPerDay),
        allowedBranchIds: parseAllowedBranchIds(payload.allowedBranchIds),
        note: parseOptionalText(payload.note),
        updatedAt: row.created_at,
        updatedBy: row.actor_id ? String(row.actor_id) : null,
      };
      continue;
    }

    if (row.target_type !== "chain_blacklist") continue;
    const itemId = row.target_id ? String(row.target_id) : "";
    if (!itemId) continue;

    if (row.action === "chain_blacklist_added") {
      const blacklistPayload = payload as ChainBlacklistPayload;
      blacklistMap.set(itemId, {
        id: itemId,
        name: parseOptionalText(blacklistPayload.name) || "Unknown",
        memberCode: parseOptionalText(blacklistPayload.memberCode),
        phone: parseOptionalText(blacklistPayload.phone),
        reason: parseOptionalText(blacklistPayload.reason) || parseOptionalText(row.reason),
        createdAt: row.created_at,
        updatedAt: row.created_at,
        expiresAt: parseOptionalIso(blacklistPayload.expiresAt),
      });
      continue;
    }

    if (row.action === "chain_blacklist_removed") {
      blacklistMap.delete(itemId);
    }
  }

  const blacklist = Array.from(blacklistMap.values())
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);

  return NextResponse.json({ rule, blacklist });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim() : "";

  if (action === "update_rule") {
    const maxEntryPerDayRaw = body?.maxEntryPerDay;
    const maxEntryPerDay = maxEntryPerDayRaw === null || maxEntryPerDayRaw === undefined || maxEntryPerDayRaw === ""
      ? null
      : Number(maxEntryPerDayRaw);
    if (maxEntryPerDay !== null && (!Number.isFinite(maxEntryPerDay) || !Number.isInteger(maxEntryPerDay) || maxEntryPerDay <= 0)) {
      return NextResponse.json({ error: "maxEntryPerDay must be a positive integer or null" }, { status: 400 });
    }

    const allowedBranchIds = parseAllowedBranchIds(body?.allowedBranchIds);
    const payload: ChainRulePayload = {
      allowCrossBranch: Boolean(body?.allowCrossBranch),
      requireManagerApproval: Boolean(body?.requireManagerApproval),
      suspensionSync: Boolean(body?.suspensionSync),
      guestPassEnabled: Boolean(body?.guestPassEnabled),
      maxEntryPerDay,
      allowedBranchIds,
      note: parseOptionalText(body?.note),
      branchId: auth.context.branchId || null,
    };

    const { error } = await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "chain_rule_set",
      target_type: "chain_rule",
      target_id: "global",
      reason: "frontdesk_chain_rule_update",
      payload,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  if (action === "add_blacklist") {
    const name = parseOptionalText(body?.name);
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const entryId = crypto.randomUUID();
    const payload: ChainBlacklistPayload = {
      name,
      memberCode: parseOptionalText(body?.memberCode),
      phone: parseOptionalText(body?.phone),
      reason: parseOptionalText(body?.reason),
      expiresAt: parseOptionalIso(body?.expiresAt),
      branchId: auth.context.branchId || null,
    };

    const { error } = await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "chain_blacklist_added",
      target_type: "chain_blacklist",
      target_id: entryId,
      reason: parseOptionalText(body?.reason),
      payload,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, id: entryId }, { status: 201 });
  }

  if (action === "remove_blacklist") {
    const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";
    if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

    const { error } = await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "chain_blacklist_removed",
      target_type: "chain_blacklist",
      target_id: entryId,
      reason: parseOptionalText(body?.reason),
      payload: { branchId: auth.context.branchId || null },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}
