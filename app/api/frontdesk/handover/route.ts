import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { notifyShiftDifference } from "../../../../lib/in-app-notifications";
import { getShiftReconciliation, insertShiftItem } from "../../../../lib/shift-reconciliation";

type ShiftRow = {
  id: string;
  branch_id: string | null;
  opened_by: string | null;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  status: string;
  opening_cash: number | string | null;
  expected_cash: number | string | null;
  counted_cash: number | string | null;
  difference: number | string | null;
  cash_total: number | string | null;
  card_total: number | string | null;
  transfer_total: number | string | null;
  note: string | null;
  difference_reason: string | null;
  closing_confirmed: boolean | null;
};

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : Number.NaN;
}

function resolveScope(params: {
  role: string;
  contextTenantId: string | null;
  contextBranchId: string | null;
  queryTenantId: string | null;
  queryBranchId: string | null;
}) {
  if (params.role === "platform_admin") {
    const tenantId = params.queryTenantId;
    const branchId = params.queryBranchId;
    if (!tenantId) return { ok: false as const, status: 400, code: "FORBIDDEN" as const, message: "tenantId is required" };
    if (!branchId) return { ok: false as const, status: 400, code: "BRANCH_SCOPE_DENIED" as const, message: "branchId is required" };
    return { ok: true as const, tenantId, branchId };
  }

  if (!params.contextTenantId) {
    return { ok: false as const, status: 400, code: "FORBIDDEN" as const, message: "Missing tenant context" };
  }
  if (!params.contextBranchId) {
    return { ok: false as const, status: 400, code: "BRANCH_SCOPE_DENIED" as const, message: "Missing branch context" };
  }
  return { ok: true as const, tenantId: params.contextTenantId, branchId: params.contextBranchId };
}

async function loadProfileNameMap(params: {
  supabase: SupabaseClient;
  ids: string[];
}) {
  const map = new Map<string, string>();
  if (params.ids.length === 0) return map;
  const result = await params.supabase.from("profiles").select("id, display_name").in("id", params.ids);
  if (result.error) throw new Error(result.error.message);
  for (const row of (result.data || []) as Array<{ id: string; display_name: string | null }>) {
    map.set(row.id, row.display_name || row.id);
  }
  return map;
}

async function loadShifts(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string;
}) {
  const result = await params.supabase
    .from("frontdesk_shifts")
    .select(
      "id, branch_id, opened_by, closed_by, opened_at, closed_at, status, opening_cash, expected_cash, counted_cash, difference, cash_total, card_total, transfer_total, note, difference_reason, closing_confirmed",
    )
    .eq("tenant_id", params.tenantId)
    .eq("branch_id", params.branchId)
    .order("opened_at", { ascending: false })
    .limit(30);
  if (result.error) {
    return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", result.error.message) };
  }

  const rows = (result.data || []) as ShiftRow[];
  const profileIds = Array.from(
    new Set(rows.flatMap((row) => [row.opened_by || "", row.closed_by || ""]).filter((value) => value.length > 0)),
  );
  const nameMap = await loadProfileNameMap({ supabase: params.supabase, ids: profileIds });

  const items = rows.map((row) => ({
    ...row,
    opening_cash: Number(row.opening_cash ?? 0),
    expected_cash: row.expected_cash === null ? null : Number(row.expected_cash ?? 0),
    counted_cash: row.counted_cash === null ? null : Number(row.counted_cash ?? 0),
    difference: row.difference === null ? null : Number(row.difference ?? 0),
    cash_total: Number(row.cash_total ?? 0),
    card_total: Number(row.card_total ?? 0),
    transfer_total: Number(row.transfer_total ?? 0),
    opened_by_name: row.opened_by ? (nameMap.get(row.opened_by) || row.opened_by) : null,
    closed_by_name: row.closed_by ? (nameMap.get(row.closed_by) || row.closed_by) : null,
  }));

  const openShift = rows.find((row) => row.status === "open") || null;
  if (!openShift) return { ok: true as const, items, activeSummary: null };

  const summary = await getShiftReconciliation({
    supabase: params.supabase,
    tenantId: params.tenantId,
    shiftId: openShift.id,
    openingCash: Number(openShift.opening_cash ?? 0),
  });
  if (!summary.ok) {
    return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", summary.error) };
  }

  return {
    ok: true as const,
    items,
    activeSummary: {
      shiftId: openShift.id,
      openingCash: Number(openShift.opening_cash ?? 0),
      expectedCash: summary.expectedCash,
      ...summary.summary,
    },
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const scope = resolveScope({
    role: auth.context.role,
    contextTenantId: auth.context.tenantId,
    contextBranchId: auth.context.branchId,
    queryTenantId: params.get("tenantId"),
    queryBranchId: params.get("branchId"),
  });
  if (!scope.ok) return apiError(scope.status, scope.code, scope.message);

  try {
    const result = await loadShifts({
      supabase: auth.supabase,
      tenantId: scope.tenantId,
      branchId: scope.branchId,
    });
    if (!result.ok) return result.response;

    return apiSuccess({
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      items: result.items,
      activeSummary: result.activeSummary,
    });
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Load shifts failed");
  }
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");
  if (!auth.context.branchId) return apiError(400, "BRANCH_SCOPE_DENIED", "Missing branch context");

  const body = await request.json().catch(() => null);
  const action = body?.action === "close" ? "close" : "open";

  if (action === "open") {
    const openingCash = toNumber(body?.openingCash ?? 0);
    if (Number.isNaN(openingCash) || openingCash < 0) {
      return apiError(400, "FORBIDDEN", "Invalid openingCash");
    }

    const openShiftQuery = await auth.supabase
      .from("frontdesk_shifts")
      .select("id, branch_id, status, opened_at")
      .eq("tenant_id", auth.context.tenantId)
      .eq("branch_id", auth.context.branchId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openShiftQuery.error) return apiError(500, "INTERNAL_ERROR", openShiftQuery.error.message);
    if (openShiftQuery.data) {
      return apiError(409, "FORBIDDEN", "An open shift already exists");
    }

    const insert = await auth.supabase
      .from("frontdesk_shifts")
      .insert({
        tenant_id: auth.context.tenantId,
        branch_id: auth.context.branchId,
        opened_by: auth.context.userId,
        note: typeof body?.note === "string" ? body.note : null,
        status: "open",
        opening_cash: openingCash,
        expected_cash: null,
        counted_cash: null,
        difference: null,
        difference_reason: null,
        closing_confirmed: false,
      })
      .select(
        "id, branch_id, status, opened_at, opening_cash, expected_cash, counted_cash, difference, difference_reason, closing_confirmed",
      )
      .maybeSingle();

    if (insert.error) {
      if (insert.error.code === "23505") {
        return apiError(409, "FORBIDDEN", "An open shift already exists");
      }
      return apiError(500, "INTERNAL_ERROR", insert.error.message);
    }

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "shift_opened",
      target_type: "frontdesk_shift",
      target_id: insert.data?.id ? String(insert.data.id) : null,
      reason: typeof body?.note === "string" ? body.note.trim() || null : null,
      payload: {
        branchId: auth.context.branchId,
        openingCash,
      },
    }).catch(() => null);

    await insertShiftItem({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      shiftId: insert.data?.id ? String(insert.data.id) : null,
      kind: "note",
      refId: insert.data?.id ? String(insert.data.id) : null,
      summary: "shift:open",
      eventType: "note",
      metadata: {
        openingCash,
      },
    }).catch(() => null);

    return NextResponse.json(
      {
        ok: true,
        data: { shift: insert.data },
        shift: insert.data,
      },
      { status: 201 },
    );
  }

  const shiftId = typeof body?.shiftId === "string" ? body.shiftId : "";
  if (!shiftId) return apiError(400, "FORBIDDEN", "shiftId is required for close");

  const countedCash = toNumber(body?.countedCash ?? body?.cashTotal ?? 0);
  const cardTotal = toNumber(body?.cardTotal ?? 0);
  const transferTotal = toNumber(body?.transferTotal ?? 0);
  if (Number.isNaN(countedCash) || Number.isNaN(cardTotal) || Number.isNaN(transferTotal)) {
    return apiError(400, "FORBIDDEN", "Invalid totals");
  }

  const shiftResult = await auth.supabase
    .from("frontdesk_shifts")
    .select("id, opening_cash, status")
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .eq("id", shiftId)
    .eq("status", "open")
    .maybeSingle();
  if (shiftResult.error) return apiError(500, "INTERNAL_ERROR", shiftResult.error.message);
  if (!shiftResult.data) return apiError(404, "FORBIDDEN", "Shift not found or already closed");

  const reconciliation = await getShiftReconciliation({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    shiftId,
    openingCash: Number(shiftResult.data.opening_cash ?? 0),
  });
  if (!reconciliation.ok) return apiError(500, "INTERNAL_ERROR", reconciliation.error);

  const expectedCash = reconciliation.expectedCash;
  const difference = Math.round((countedCash - expectedCash + Number.EPSILON) * 100) / 100;
  const differenceReason = typeof body?.differenceReason === "string" ? body.differenceReason.trim() : "";
  const closingConfirmed = body?.closingConfirmed === false ? false : true;
  const note = typeof body?.note === "string" ? body.note : null;

  const update = await auth.supabase
    .from("frontdesk_shifts")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: auth.context.userId,
      cash_total: countedCash,
      card_total: cardTotal,
      transfer_total: transferTotal,
      expected_cash: expectedCash,
      counted_cash: countedCash,
      difference,
      difference_reason: differenceReason || null,
      note,
      closing_confirmed: closingConfirmed,
    })
    .eq("id", shiftId)
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .eq("status", "open")
    .select(
      "id, branch_id, status, closed_at, opening_cash, expected_cash, counted_cash, difference, difference_reason, cash_total, card_total, transfer_total, closing_confirmed",
    )
    .maybeSingle();

  if (update.error) return apiError(500, "INTERNAL_ERROR", update.error.message);
  if (!update.data) return apiError(404, "FORBIDDEN", "Shift not found or already closed");

  const auditPayload = {
    expectedCash,
    countedCash,
    difference,
    openingCash: Number(shiftResult.data.opening_cash ?? 0),
    inflow: reconciliation.summary.inflow,
    outflow: reconciliation.summary.outflow,
    counts: reconciliation.summary.counts,
  };

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "shift_closed",
    target_type: "frontdesk_shift",
    target_id: shiftId,
    reason: note,
    payload: auditPayload,
  }).catch(() => null);

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "shift_reconciled",
    target_type: "frontdesk_shift",
    target_id: shiftId,
    reason: differenceReason || note,
    payload: auditPayload,
  }).catch(() => null);

  if (Math.abs(difference) >= 0.01) {
    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "shift_difference_recorded",
      target_type: "frontdesk_shift",
      target_id: shiftId,
      reason: differenceReason || note,
      payload: auditPayload,
    }).catch(() => null);
  }

  await insertShiftItem({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    shiftId,
    kind: "note",
    refId: shiftId,
    summary: "shift:close",
    eventType: "note",
    metadata: {
      expectedCash,
      countedCash,
      difference,
    },
  }).catch(() => null);

  await notifyShiftDifference({
    tenantId: auth.context.tenantId,
    branchId: auth.context.branchId,
    shiftId,
    difference,
    actorId: auth.context.userId,
  }).catch(() => null);

  return apiSuccess({
    shift: update.data,
    reconciliation: {
      ...reconciliation.summary,
      expectedCash,
      countedCash,
      difference,
    },
  });
}
