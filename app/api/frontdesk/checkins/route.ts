import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckinRow = {
  id: string;
  tenant_id: string;
  store_id: string | null;
  member_id: string | null;
  method?: string | null;
  result: string | null;
  reason: string | null;
  checked_at: string | null;
  created_at: string | null;
  jti: string | null;
};

type MemberRow = {
  id: string;
  full_name: string | null;
  member_code: string | null;
  phone: string | null;
};

function parseLimit(input: string | null) {
  const n = Number(input || 20);
  if (!Number.isFinite(n)) return 20;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function safeLast4(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function isCheckinsTableMissing(message: string) {
  return message.includes('relation "checkins" does not exist')
    || message.includes("Could not find the table 'public.checkins' in the schema cache");
}

function isAuditTableMissing(message: string) {
  return message.includes('relation "audit_logs" does not exist')
    || message.includes("Could not find the table 'public.audit_logs' in the schema cache");
}

function isMissingColumnError(message: string, column: string) {
  const lower = message.toLowerCase();
  return lower.includes("does not exist") && lower.includes(column.toLowerCase());
}

function toListItem(row: CheckinRow, member: MemberRow | null) {
  return {
    id: String(row.id),
    memberId: row.member_id ? String(row.member_id) : "",
    memberName: member?.full_name ? String(member.full_name) : "",
    memberCode: member?.member_code ? String(member.member_code) : "",
    phoneLast4: safeLast4(member?.phone || null),
    method: row.method ? String(row.method) : "unknown",
    result: row.result ? String(row.result) : "unknown",
    reason: row.reason ? String(row.reason) : "",
    checkedAt: row.checked_at || row.created_at || null,
    jti: row.jti ? String(row.jti) : "",
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const limit = parseLimit(new URL(request.url).searchParams.get("limit"));
  const admin = createSupabaseAdminClient();

  let baseQuery = admin
    .from("checkins")
    .select("id, tenant_id, store_id, member_id, method, result, reason, checked_at, created_at, jti")
    .eq("tenant_id", auth.context.tenantId)
    .order("checked_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (auth.context.branchId) {
    baseQuery = baseQuery.eq("store_id", auth.context.branchId);
  }

  let checkinsResult: any = await baseQuery;
  let methodMissing = false;

  if (checkinsResult.error && isMissingColumnError(checkinsResult.error.message, "method")) {
    methodMissing = true;
    let fallbackQuery = admin
      .from("checkins")
      .select("id, tenant_id, store_id, member_id, result, reason, checked_at, created_at, jti")
      .eq("tenant_id", auth.context.tenantId)
      .order("checked_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (auth.context.branchId) {
      fallbackQuery = fallbackQuery.eq("store_id", auth.context.branchId);
    }

    checkinsResult = await fallbackQuery;
  }

  if (checkinsResult.error) {
    if (isCheckinsTableMissing(checkinsResult.error.message)) {
      return NextResponse.json({
        items: [],
        warning: "checkins table missing. Running in fallback mode with empty entry list.",
      });
    }
    return NextResponse.json({ error: checkinsResult.error.message }, { status: 500 });
  }

  const checkins = (checkinsResult.data || []) as CheckinRow[];
  const memberIds = Array.from(
    new Set(
      checkins
        .map((row) => (row.member_id ? String(row.member_id) : ""))
        .filter(Boolean),
    ),
  );

  let memberById = new Map<string, MemberRow>();
  if (memberIds.length > 0) {
    const membersResult = await admin
      .from("members")
      .select("id, full_name, member_code, phone")
      .eq("tenant_id", auth.context.tenantId)
      .in("id", memberIds);
    if (!membersResult.error) {
      memberById = new Map(
        ((membersResult.data || []) as MemberRow[]).map((member) => [String(member.id), member]),
      );
    }
  }

  const items = checkins.map((row) => {
    const mapped = toListItem(row, row.member_id ? memberById.get(String(row.member_id)) || null : null);
    if (methodMissing) mapped.method = "manual";
    return mapped;
  });

  return NextResponse.json({
    items,
    warning: methodMissing ? "checkins.method column missing. Fallback mode used for method field." : undefined,
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const action = body?.action === "void" ? "void" : "";
  const checkinId = typeof body?.checkinId === "string" ? body.checkinId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (action !== "void") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
  if (!UUID_RE.test(checkinId)) {
    return NextResponse.json({ error: "Invalid checkinId" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  let rowResult: any = await admin
    .from("checkins")
    .select("id, tenant_id, store_id, member_id, method, result, reason, checked_at, created_at, jti")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", checkinId)
    .maybeSingle();

  if (rowResult.error && isMissingColumnError(rowResult.error.message, "method")) {
    rowResult = await admin
      .from("checkins")
      .select("id, tenant_id, store_id, member_id, result, reason, checked_at, created_at, jti")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", checkinId)
      .maybeSingle();
  }

  if (rowResult.error) {
    if (isCheckinsTableMissing(rowResult.error.message)) {
      return NextResponse.json({
        ok: true,
        warning: "checkins table missing. Fallback mode: cancel skipped.",
      });
    }
    return NextResponse.json({ error: rowResult.error.message }, { status: 500 });
  }
  if (!rowResult.data) {
    return NextResponse.json({ error: "Check-in record not found" }, { status: 404 });
  }

  const row = rowResult.data as CheckinRow;
  if (auth.context.branchId && row.store_id && row.store_id !== auth.context.branchId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if ((row.result || "").toLowerCase() !== "allow") {
    return NextResponse.json({ error: "Only allow records can be canceled" }, { status: 409 });
  }

  const deleteResult = await admin
    .from("checkins")
    .delete()
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", checkinId);

  if (deleteResult.error) {
    if (isCheckinsTableMissing(deleteResult.error.message)) {
      return NextResponse.json({
        ok: true,
        warning: "checkins table missing. Fallback mode: cancel skipped.",
      });
    }
    return NextResponse.json({ error: deleteResult.error.message }, { status: 500 });
  }

  const voidedAt = new Date().toISOString();
  const payload = {
    checkinId,
    voidedAt,
    storeId: row.store_id,
    memberId: row.member_id,
    method: row.method || null,
    previousResult: row.result,
    previousReason: row.reason,
    previousCheckedAt: row.checked_at || row.created_at || null,
  };

  let auditResult = await admin.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "entry_checkin_void",
    target_type: "checkin",
    target_id: checkinId,
    reason,
    payload,
  });

  if (auditResult.error && isMissingColumnError(auditResult.error.message, "actor_id")) {
    auditResult = await admin.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      user_id: auth.context.userId,
      action: "entry_checkin_void",
      target_type: "checkin",
      target_id: checkinId,
      reason,
      payload,
    } as any);
  }

  if (auditResult.error) {
    if (isAuditTableMissing(auditResult.error.message)) {
      return NextResponse.json({
        ok: true,
        item: { id: checkinId, voidedAt },
        warning: "audit_logs table missing. Check-in canceled without audit log.",
      });
    }
    return NextResponse.json({
      ok: true,
      item: { id: checkinId, voidedAt },
      warning: `Audit log write failed: ${auditResult.error.message}`,
    });
  }

  return NextResponse.json({
    ok: true,
    item: { id: checkinId, voidedAt },
  });
}
