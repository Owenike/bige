import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireProfile } from "../../../../lib/auth-context";

export const dynamic = "force-dynamic";

function isUuid(input: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}

function safeLast4(phone: unknown) {
  if (typeof phone !== "string" || !phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function startOfUtcDayIso(input: Date) {
  const d = new Date(input);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfUtcDayIso(input: Date) {
  const d = new Date(input);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

function isMissingColumnError(message: string, col: string) {
  return message.toLowerCase().includes("does not exist") && message.toLowerCase().includes(col.toLowerCase());
}

function isMissingRelationError(message: string, relation: string) {
  const lower = message.toLowerCase();
  return lower.includes("does not exist") && lower.includes(`relation "${relation.toLowerCase()}"`);
}

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  const reasonRaw = typeof body?.reason === "string" ? body.reason : "";
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId : null;

  const reason = reasonRaw.trim();
  if (!memberId || !isUuid(memberId)) return jsonError(400, "invalid_member_id");
  if (!reason) return jsonError(400, "reason_required");
  if (!auth.context.tenantId) return jsonError(403, "Forbidden");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return jsonError(500, "server_misconfigured");

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Load member within tenant and enforce branch scope.
  const memberResult = await admin
    .from("members")
    .select("id, tenant_id, store_id, branch_id, full_name, photo_url, phone, note, remarks")
    .eq("id", memberId)
    .eq("tenant_id", auth.context.tenantId)
    .limit(1)
    .maybeSingle();

  if (memberResult.error) return jsonError(500, memberResult.error.message);
  if (!memberResult.data) return jsonError(404, "not_found");

  const member: any = memberResult.data;
  const memberStoreId: string | null = member.store_id || member.branch_id || null;

  // If operator is branch-scoped, member must be in the same branch.
  if (auth.context.branchId && memberStoreId && memberStoreId !== auth.context.branchId) {
    return jsonError(403, "Forbidden");
  }
  if (auth.context.branchId && !memberStoreId) {
    return jsonError(500, "member_branch_missing");
  }

  const storeIdToWrite = auth.context.branchId || memberStoreId;
  if (!storeIdToWrite) return jsonError(500, "store_id_unavailable");

  const checkinId = crypto.randomUUID();
  const jti = `manual:${checkinId}`;

  // Insert checkin first. If audit insert fails, we will compensate by deleting the checkin.
  let checkinInsert = await admin
    .from("checkins")
    .insert({
      id: checkinId,
      tenant_id: auth.context.tenantId,
      store_id: storeIdToWrite,
      member_id: memberId,
      jti,
      method: "manual",
      result: "allow",
      reason,
    })
    .select("id, tenant_id, store_id, member_id, result, reason, checked_at, created_at")
    .maybeSingle();

  if (checkinInsert.error && isMissingColumnError(checkinInsert.error.message, "method")) {
    checkinInsert = await admin
      .from("checkins")
      .insert({
        id: checkinId,
        tenant_id: auth.context.tenantId,
        store_id: storeIdToWrite,
        member_id: memberId,
        jti,
        result: "allow",
        reason,
      })
      .select("id, tenant_id, store_id, member_id, result, reason, checked_at, created_at")
      .maybeSingle();
  }

  if (checkinInsert.error) return jsonError(500, checkinInsert.error.message);

  // Insert audit log.
  const payload = {
    member_id: memberId,
    operator: { id: auth.context.userId, role: auth.context.role },
    tenant_id: auth.context.tenantId,
    branch_id: auth.context.branchId,
    store_id: storeIdToWrite,
    device_id: deviceId,
    user_agent: request.headers.get("user-agent"),
    method: "manual",
    checkin_id: checkinId,
  };

  let auditInsert = await admin.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "entry_manual_allow",
    reason,
    payload,
  });

  if (auditInsert.error && isMissingColumnError(auditInsert.error.message, "actor_id")) {
    auditInsert = await admin.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      user_id: auth.context.userId,
      action: "entry_manual_allow",
      reason,
      payload,
    } as any);
  }

  if (auditInsert.error) {
    if (isMissingRelationError(auditInsert.error.message, "audit_logs")) {
      await admin.from("checkins").delete().eq("id", checkinId).eq("tenant_id", auth.context.tenantId);
      return jsonError(500, "audit_logs_missing");
    }
    await admin.from("checkins").delete().eq("id", checkinId).eq("tenant_id", auth.context.tenantId);
    return jsonError(500, auditInsert.error.message);
  }

  // Recent checkin and today's checkin count for the member.
  const now = new Date();
  const from = startOfUtcDayIso(now);
  const to = endOfUtcDayIso(now);

  const [todayCountResult, recentCheckinResult] = await Promise.all([
    admin
      .from("checkins")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", auth.context.tenantId)
      .eq("store_id", storeIdToWrite)
      .eq("member_id", memberId)
      .gte("checked_at", from)
      .lte("checked_at", to),
    admin
      .from("checkins")
      .select("id, result, reason, checked_at")
      .eq("tenant_id", auth.context.tenantId)
      .eq("store_id", storeIdToWrite)
      .eq("member_id", memberId)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (todayCountResult.error) return jsonError(500, todayCountResult.error.message);
  if (recentCheckinResult.error) return jsonError(500, recentCheckinResult.error.message);

  // Subscription/pass summary, best-effort.
  const [subscriptionResult, entitlementResult, passesResult] = await Promise.all([
    admin
      .from("subscriptions")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("member_entitlements")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("monthly_expires_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("entry_passes")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const monthlyExpiresAt =
    (subscriptionResult.data as any)?.monthly_expires_at ||
    (subscriptionResult.data as any)?.expires_at ||
    (subscriptionResult.data as any)?.current_period_end ||
    (entitlementResult.data as any)?.monthly_expires_at ||
    null;

  const monthlyActive = monthlyExpiresAt ? new Date(monthlyExpiresAt).getTime() > Date.now() : null;

  const passRows = !passesResult.error && Array.isArray(passesResult.data) ? (passesResult.data as any[]) : [];
  const passes = passRows.map((row) => ({
    id: String(row?.id || ""),
    passType: (row?.pass_type as string | null) || (row?.kind as string | null) || null,
    remaining:
      (typeof row?.remaining === "number" ? row.remaining : null) ??
      (typeof row?.remaining_sessions === "number" ? row.remaining_sessions : null),
    expiresAt: (row?.expires_at as string | null) || (row?.ends_at as string | null) || null,
    status: (row?.status as string | null) || null,
  }));

  return NextResponse.json({
    result: {
      method: "manual",
      result: "allow",
      reason,
    },
    member: {
      id: member.id,
      fullName: (member.full_name as string) || "",
      phoneLast4: safeLast4(member.phone),
      photoUrl: (member.photo_url as string | null) || null,
      note: (member.note as string | null) || (member.remarks as string | null) || null,
    },
    membership: {
      monthly: { expiresAt: monthlyExpiresAt, isActive: monthlyActive },
      passes,
    },
    today: {
      from,
      to,
      count: todayCountResult.count ?? 0,
    },
    recentCheckin: recentCheckinResult.data
      ? {
          checkedAt: (recentCheckinResult.data as any).checked_at as string,
          result: (recentCheckinResult.data as any).result as string,
          reason: ((recentCheckinResult.data as any).reason as string | null) || null,
        }
      : null,
    checkin: {
      id: (checkinInsert.data as any)?.id,
      checkedAt: ((checkinInsert.data as any)?.checked_at as string | null) || null,
    },
  });
}

