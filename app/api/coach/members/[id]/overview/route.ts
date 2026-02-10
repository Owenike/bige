import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireProfile } from "../../../../../../lib/auth-context";

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

function pickFirstString(row: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!row) return null;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function pickFirstNumber(row: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!row) return null;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function isMissingColumnError(message: string, col: string) {
  return message.toLowerCase().includes("does not exist") && message.toLowerCase().includes(col.toLowerCase());
}

async function fetchMaybeSingleWithBranchFilter(args: {
  supabase: SupabaseClient<any, any, any, any, any>;
  table: string;
  select: string;
  baseEq: Array<[string, string]>;
  orderBy?: { column: string; ascending: boolean };
  branchId: string | null;
  branchColumns: string[];
}) {
  const { supabase, table, select, baseEq, orderBy, branchId, branchColumns } = args;

  if (!branchId) {
    let q = supabase.from(table).select(select);
    for (const [col, val] of baseEq) q = q.eq(col, val);
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending });
    q = q.limit(1);
    return await q.maybeSingle();
  }

  let lastMissingColMessage: string | null = null;
  for (const branchCol of branchColumns) {
    let q = supabase.from(table).select(select);
    for (const [col, val] of baseEq) q = q.eq(col, val);
    q = q.eq(branchCol, branchId);
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending });
    q = q.limit(1);
    const result = await q.maybeSingle();
    if (!result.error) return result;
    if (isMissingColumnError(result.error.message, branchCol)) {
      lastMissingColMessage = result.error.message;
      continue;
    }
    return result;
  }

  return { data: null, error: new Error(lastMissingColMessage || "branch_scope_unenforceable") as any };
}

async function fetchListWithBranchFilter(args: {
  supabase: SupabaseClient<any, any, any, any, any>;
  table: string;
  select: string;
  baseEq: Array<[string, string]>;
  orderBy?: { column: string; ascending: boolean };
  limit: number;
  branchId: string | null;
  branchColumns: string[];
}) {
  const { supabase, table, select, baseEq, orderBy, limit, branchId, branchColumns } = args;

  if (!branchId) {
    let q = supabase.from(table).select(select);
    for (const [col, val] of baseEq) q = q.eq(col, val);
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending });
    q = q.limit(limit);
    return await q;
  }

  let lastMissingColMessage: string | null = null;
  for (const branchCol of branchColumns) {
    let q = supabase.from(table).select(select);
    for (const [col, val] of baseEq) q = q.eq(col, val);
    q = q.eq(branchCol, branchId);
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending });
    q = q.limit(limit);
    const result = await q;
    if (!result.error) return result;
    if (isMissingColumnError(result.error.message, branchCol)) {
      lastMissingColMessage = result.error.message;
      continue;
    }
    return result;
  }

  return { data: null, error: new Error(lastMissingColMessage || "branch_scope_unenforceable") as any };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const memberId = (await ctx.params).id;
  if (!memberId || !isUuid(memberId)) {
    return NextResponse.json({ error: "invalid_member_id" }, { status: 400 });
  }

  const auth = await requireProfile(["coach", "manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Coach authorization (service role bypasses RLS; enforce here)
  if (auth.context.role === "coach") {
    let q = admin
      .from("bookings")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .eq("coach_id", auth.context.userId)
      .order("starts_at", { ascending: false })
      .limit(1);

    if (auth.context.branchId) q = q.eq("branch_id", auth.context.branchId);

    const canSeeRes = await q.maybeSingle();
    if (canSeeRes.error) return NextResponse.json({ error: "server_error" }, { status: 500 });
    if (!canSeeRes.data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const memberResult = await fetchMaybeSingleWithBranchFilter({
    supabase: admin,
    table: "members",
    select: "id, full_name, phone, photo_url, note, remarks, store_id, branch_id",
    baseEq: [
      ["id", memberId],
      ["tenant_id", auth.context.tenantId],
    ],
    branchId: auth.context.branchId,
    branchColumns: ["store_id", "branch_id"],
  });

  if (memberResult.error) {
    if (memberResult.error.message === "branch_scope_unenforceable") {
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!memberResult.data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const memberRow: any = memberResult.data;
  const memberNote = (memberRow?.note as string | null) || (memberRow?.remarks as string | null) || null;

  let subscriptionExpiresAt: string | null = null;
  let subscriptionIsActive: boolean | null = null;

  const subscriptionsResult = await fetchMaybeSingleWithBranchFilter({
    supabase: admin,
    table: "subscriptions",
    select: "created_at, status, valid_to, valid_until, expires_at, current_period_end, ends_at",
    baseEq: [
      ["tenant_id", auth.context.tenantId],
      ["member_id", memberId],
    ],
    orderBy: { column: "created_at", ascending: false },
    branchId: auth.context.branchId,
    branchColumns: ["store_id", "branch_id"],
  });

  if (!subscriptionsResult.error && subscriptionsResult.data) {
    subscriptionExpiresAt = pickFirstString(subscriptionsResult.data as any, [
      "expires_at",
      "current_period_end",
      "ends_at",
      "valid_until",
      "valid_to",
    ]);
  } else {
    const entitlementsResult = await fetchMaybeSingleWithBranchFilter({
      supabase: admin,
      table: "member_entitlements",
      select: "created_at, monthly_expires_at, remaining_sessions, remaining",
      baseEq: [
        ["tenant_id", auth.context.tenantId],
        ["member_id", memberId],
      ],
      orderBy: { column: "created_at", ascending: false },
      branchId: auth.context.branchId,
      branchColumns: ["store_id", "branch_id"],
    });

    if (!entitlementsResult.error && entitlementsResult.data) {
      subscriptionExpiresAt = pickFirstString(entitlementsResult.data as any, ["monthly_expires_at"]);
    }
  }

  if (subscriptionExpiresAt) subscriptionIsActive = new Date(subscriptionExpiresAt).getTime() > Date.now();

  const passesResult = await fetchListWithBranchFilter({
    supabase: admin,
    table: "entry_passes",
    select: "id, pass_type, remaining, status, expires_at, created_at",
    baseEq: [
      ["tenant_id", auth.context.tenantId],
      ["member_id", memberId],
    ],
    orderBy: { column: "created_at", ascending: false },
    limit: 25,
    branchId: auth.context.branchId,
    branchColumns: ["store_id", "branch_id"],
  });

  const passesRows = !passesResult.error && Array.isArray(passesResult.data) ? (passesResult.data as any[]) : [];
  const passes = passesRows.map((row: any) => ({
    id: String(row?.id || ""),
    passType: (row?.pass_type as string | null) || null,
    remaining: pickFirstNumber(row, ["remaining"]),
    expiresAt: pickFirstString(row, ["expires_at"]),
    status: (row?.status as string | null) || null,
  }));

  const recentCheckinResult = await fetchMaybeSingleWithBranchFilter({
    supabase: admin,
    table: "checkins",
    select: "checked_at, created_at, result, reason",
    baseEq: [
      ["tenant_id", auth.context.tenantId],
      ["member_id", memberId],
    ],
    orderBy: { column: "checked_at", ascending: false },
    branchId: auth.context.branchId,
    branchColumns: ["store_id", "branch_id"],
  });

  const recentRedemptionResult = await fetchMaybeSingleWithBranchFilter({
    supabase: admin,
    table: "session_redemptions",
    select: "redeemed_at, created_at, redeemed_kind, quantity",
    baseEq: [
      ["tenant_id", auth.context.tenantId],
      ["member_id", memberId],
    ],
    orderBy: { column: "created_at", ascending: false },
    branchId: auth.context.branchId,
    branchColumns: ["store_id", "branch_id"],
  });

  const recentBookingResult = await fetchMaybeSingleWithBranchFilter({
    supabase: admin,
    table: "bookings",
    select: "starts_at, ends_at, service_name, status, note, created_at",
    baseEq: [
      ["tenant_id", auth.context.tenantId],
      ["member_id", memberId],
    ],
    orderBy: { column: "starts_at", ascending: false },
    branchId: auth.context.branchId,
    branchColumns: ["branch_id", "store_id"],
  });

  const checkinRow: any = !recentCheckinResult.error ? (recentCheckinResult.data as any) : null;
  const redemptionRow: any = !recentRedemptionResult.error ? (recentRedemptionResult.data as any) : null;
  const bookingRow: any = !recentBookingResult.error ? (recentBookingResult.data as any) : null;

  return NextResponse.json({
    member: {
      id: memberRow.id,
      fullName: (memberRow?.full_name as string | null) || "",
      phoneLast4: safeLast4(memberRow?.phone),
      photoUrl: (memberRow?.photo_url as string | null) || null,
      note: memberNote,
    },
    subscription: { expiresAt: subscriptionExpiresAt, isActive: subscriptionIsActive },
    passes,
    recentCheckin: checkinRow
      ? {
          checkedAt: pickFirstString(checkinRow, ["checked_at", "created_at"]) || "",
          result: (checkinRow?.result as string | null) || null,
          reason: (checkinRow?.reason as string | null) || null,
        }
      : null,
    recentRedemption: redemptionRow
      ? {
          redeemedAt: pickFirstString(redemptionRow, ["redeemed_at", "created_at"]) || "",
          kind: (redemptionRow?.redeemed_kind as string | null) || null,
          quantity: pickFirstNumber(redemptionRow, ["quantity"]) ?? 1,
        }
      : null,
    recentBooking: bookingRow
      ? {
          startsAt: pickFirstString(bookingRow, ["starts_at"]) || "",
          endsAt: pickFirstString(bookingRow, ["ends_at"]) || "",
          serviceName: (bookingRow?.service_name as string | null) || null,
          status: (bookingRow?.status as string | null) || null,
          note: (bookingRow?.note as string | null) || null,
        }
      : null,
  });
}
