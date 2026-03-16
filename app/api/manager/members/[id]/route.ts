import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { requirePermission } from "../../../../../lib/permissions";
import { evaluateContractStatus } from "../../../../../lib/member-plan-lifecycle";
import { checkMemberEligibility } from "../../../../../lib/entitlement-eligibility";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function isMissingTableError(message: string | undefined, table: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = table.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target))
  );
}

async function loadMember(params: { request: Request; memberId: string }) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], params.request);
  if (!auth.ok) return auth;
  if (!auth.context.tenantId) {
    return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant context") };
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id, full_name, phone, email, auth_user_id, notes, photo_url, store_id, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", params.memberId)
    .maybeSingle();
  if (memberResult.error) return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", memberResult.error.message) };
  if (!memberResult.data) return { ok: false as const, response: apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found") };

  if (auth.context.branchId) {
    if (!memberResult.data.store_id || auth.context.branchId !== memberResult.data.store_id) {
      return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "Member is outside branch scope") };
    }
  }

  return {
    ok: true as const,
    auth,
    member: memberResult.data,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scoped = await loadMember({ request, memberId: id });
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "members.read");
  if (!permission.ok) return permission.response;

  const [contractsResult, bookingsResult, ordersResult, paymentsResult, ledgerResult, passesResult] = await Promise.all([
    scoped.auth.supabase
      .from("member_plan_contracts")
      .select(
        "id, plan_catalog_id, status, starts_at, ends_at, remaining_uses, remaining_sessions, auto_renew, source_order_id, source_payment_id, note, created_at, updated_at",
      )
      .eq("tenant_id", scoped.auth.context.tenantId)
      .eq("member_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    scoped.auth.supabase
      .from("bookings")
      .select("id, service_name, starts_at, ends_at, status, coach_id")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .eq("member_id", id)
      .order("starts_at", { ascending: false })
      .limit(10),
    scoped.auth.supabase
      .from("orders")
      .select("id, amount, status, channel, created_at, updated_at")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .eq("member_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    scoped.auth.supabase
      .from("payments")
      .select("id, order_id, amount, status, method, paid_at, created_at")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .order("created_at", { ascending: false })
      .limit(50),
    scoped.auth.supabase
      .from("member_plan_ledger")
      .select("id, contract_id, source_type, delta_uses, delta_sessions, balance_uses, balance_sessions, reason, reference_type, reference_id, created_at")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .eq("member_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    scoped.auth.supabase
      .from("entry_passes")
      .select("id, member_plan_contract_id, remaining, total_sessions, expires_at, status")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .eq("member_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (contractsResult.error && !isMissingTableError(contractsResult.error.message, "member_plan_contracts")) {
    return apiError(500, "INTERNAL_ERROR", contractsResult.error.message);
  }
  if (bookingsResult.error) return apiError(500, "INTERNAL_ERROR", bookingsResult.error.message);
  if (ordersResult.error) return apiError(500, "INTERNAL_ERROR", ordersResult.error.message);
  if (paymentsResult.error) return apiError(500, "INTERNAL_ERROR", paymentsResult.error.message);
  if (ledgerResult.error && !isMissingTableError(ledgerResult.error.message, "member_plan_ledger")) {
    return apiError(500, "INTERNAL_ERROR", ledgerResult.error.message);
  }
  if (passesResult.error) return apiError(500, "INTERNAL_ERROR", passesResult.error.message);

  const planIds = Array.from(
    new Set(
      (((contractsResult.data || []) as Array<{ plan_catalog_id: string | null }>) || [])
        .map((row) => row.plan_catalog_id || "")
        .filter((value) => value.length > 0),
    ),
  );
  const plansById = new Map<string, { code: string | null; name: string | null; planType: string | null }>();
  if (planIds.length > 0) {
    const plansResult = await scoped.auth.supabase
      .from("member_plan_catalog")
      .select("id, code, name, plan_type")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .in("id", planIds);
    if (plansResult.error) {
      if (!isMissingTableError(plansResult.error.message, "member_plan_catalog")) {
        return apiError(500, "INTERNAL_ERROR", plansResult.error.message);
      }
    } else {
      for (const row of (plansResult.data || []) as Array<{ id: string; code: string | null; name: string | null; plan_type: string | null }>) {
        plansById.set(row.id, {
          code: row.code ?? null,
          name: row.name ?? null,
          planType: row.plan_type ?? null,
        });
      }
    }
  }

  const orderIds = new Set(((ordersResult.data || []) as Array<{ id: string }>).map((row) => row.id));
  const passByContractId = new Map<
    string,
    { id: string; remaining: number | null; totalSessions: number | null; expiresAt: string | null; status: string | null }
  >();
  for (const pass of (passesResult.data || []) as Array<{
    id: string;
    member_plan_contract_id: string | null;
    remaining: number | null;
    total_sessions: number | null;
    expires_at: string | null;
    status: string | null;
  }>) {
    if (!pass.member_plan_contract_id || passByContractId.has(pass.member_plan_contract_id)) continue;
    passByContractId.set(pass.member_plan_contract_id, {
      id: pass.id,
      remaining: pass.remaining,
      totalSessions: pass.total_sessions,
      expiresAt: pass.expires_at,
      status: pass.status,
    });
  }

  const recentPayments = ((paymentsResult.data || []) as Array<{ id: string; order_id: string | null; amount: number; status: string; method: string; paid_at: string | null; created_at: string }>)
    .filter((row) => row.order_id && orderIds.has(row.order_id))
    .slice(0, 10);

  const contracts = ((contractsResult.data || []) as Array<Record<string, unknown>>).map((row) => {
    const planId = typeof row.plan_catalog_id === "string" ? row.plan_catalog_id : "";
    const plan = plansById.get(planId);
    const remainingUses = typeof row.remaining_uses === "number" ? row.remaining_uses : null;
    const remainingSessions = typeof row.remaining_sessions === "number" ? row.remaining_sessions : null;
    const endsAt = typeof row.ends_at === "string" ? row.ends_at : null;
    const pass = passByContractId.get(String(row.id || ""));
    return {
      id: String(row.id || ""),
      planCatalogId: planId || null,
      planCode: plan?.code ?? null,
      planName: plan?.name ?? null,
      planType: plan?.planType ?? null,
      status: evaluateContractStatus({
        status: typeof row.status === "string" ? row.status : null,
        endsAt,
        remainingUses,
        remainingSessions,
      }),
      startsAt: typeof row.starts_at === "string" ? row.starts_at : null,
      endsAt,
      remainingUses,
      remainingSessions,
      autoRenew: row.auto_renew === true,
      sourceOrderId: typeof row.source_order_id === "string" ? row.source_order_id : null,
      sourcePaymentId: typeof row.source_payment_id === "string" ? row.source_payment_id : null,
      note: typeof row.note === "string" ? row.note : null,
      passId: pass?.id ?? null,
      passRemaining: pass?.remaining ?? null,
      passTotalSessions: pass?.totalSessions ?? null,
      passExpiresAt: pass?.expiresAt ?? null,
      passStatus: pass?.status ?? null,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    };
  });

  const [entryEligibility, bookingEligibility, redemptionEligibility] = await Promise.all([
    checkMemberEligibility({
      supabase: scoped.auth.supabase,
      tenantId: scoped.auth.context.tenantId!,
      memberId: id,
      branchId:
        scoped.auth.context.branchId ??
        (typeof scoped.member.store_id === "string" ? scoped.member.store_id : null),
      scenario: "entry",
    }),
    checkMemberEligibility({
      supabase: scoped.auth.supabase,
      tenantId: scoped.auth.context.tenantId!,
      memberId: id,
      branchId:
        scoped.auth.context.branchId ??
        (typeof scoped.member.store_id === "string" ? scoped.member.store_id : null),
      scenario: "booking",
      serviceName: "coach_session",
      coachId: "coach",
    }),
    checkMemberEligibility({
      supabase: scoped.auth.supabase,
      tenantId: scoped.auth.context.tenantId!,
      memberId: id,
      branchId:
        scoped.auth.context.branchId ??
        (typeof scoped.member.store_id === "string" ? scoped.member.store_id : null),
      scenario: "redemption",
      serviceName: "coach_session",
      coachId: "coach",
    }),
  ]);

  return apiSuccess({
    member: {
      id: scoped.member.id,
      fullName: scoped.member.full_name,
      phone: scoped.member.phone,
      email: "email" in scoped.member ? (scoped.member.email as string | null) : null,
      notes: scoped.member.notes,
      photoUrl: scoped.member.photo_url,
      storeId: scoped.member.store_id,
      createdAt: scoped.member.created_at,
      updatedAt: scoped.member.updated_at,
    },
    contracts,
    recentBookings: bookingsResult.data || [],
    recentOrders: ordersResult.data || [],
    recentPayments,
    adjustments: ledgerResult.data || [],
    eligibility: {
      entry: entryEligibility,
      booking: bookingEligibility,
      redemption: redemptionEligibility,
      suggested: bookingEligibility.candidate ?? entryEligibility.candidate ?? null,
    },
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scoped = await loadMember({ request, memberId: id });
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "members.update");
  if (!permission.ok) return permission.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const fullName = normalizeText(body?.fullName);
  const phone = normalizeText(body?.phone);
  const email = normalizeEmail(body?.email);
  const notes = normalizeText(body?.notes);
  const storeId = normalizeText(body?.storeId);

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("fullName" in (body || {})) {
    if (!fullName) return apiError(400, "FORBIDDEN", "fullName cannot be empty");
    updatePayload.full_name = fullName;
  }
  if ("phone" in (body || {})) updatePayload.phone = phone;
  if ("email" in (body || {})) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError(400, "FORBIDDEN", "email is invalid");
    }
    if (email && email !== String(scoped.member.email || "").trim().toLowerCase()) {
      const duplicateEmailResult = await scoped.auth.supabase
        .from("members")
        .select("id")
        .eq("tenant_id", scoped.auth.context.tenantId)
        .eq("email", email)
        .neq("id", id)
        .limit(1)
        .maybeSingle();
      if (duplicateEmailResult.error) return apiError(500, "INTERNAL_ERROR", duplicateEmailResult.error.message);
      if (duplicateEmailResult.data) return apiError(409, "FORBIDDEN", "Duplicate email");

      if (scoped.member.auth_user_id) {
        const admin = createSupabaseAdminClient();
        const authUpdate = await admin.auth.admin.updateUserById(String(scoped.member.auth_user_id), {
          email,
          email_confirm: true,
        });
        if (authUpdate.error) return apiError(500, "INTERNAL_ERROR", authUpdate.error.message);
      }
    }
    updatePayload.email = email;
  }
  if ("notes" in (body || {})) updatePayload.notes = notes;
  if ("storeId" in (body || {})) {
    if (storeId) {
      const branchResult = await scoped.auth.supabase
        .from("branches")
        .select("id")
        .eq("tenant_id", scoped.auth.context.tenantId)
        .eq("id", storeId)
        .maybeSingle();
      if (branchResult.error) return apiError(500, "INTERNAL_ERROR", branchResult.error.message);
      if (!branchResult.data) return apiError(403, "BRANCH_SCOPE_DENIED", "branch not found for storeId");
      if (scoped.auth.context.branchId && scoped.auth.context.branchId !== storeId) {
        return apiError(403, "BRANCH_SCOPE_DENIED", "Cannot assign member to another branch");
      }
      updatePayload.store_id = storeId;
    } else {
      updatePayload.store_id = null;
    }
  }

  const result = await scoped.auth.supabase
    .from("members")
    .update(updatePayload)
    .eq("tenant_id", scoped.auth.context.tenantId)
    .eq("id", id)
    .select("id, full_name, phone, email, notes, store_id, updated_at")
    .maybeSingle();
  if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);
  if (!result.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.auth.context.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "member_update",
    target_type: "member",
    target_id: id,
    reason: "manager_update",
    payload: updatePayload,
  });

  return apiSuccess({
    member: {
      id: result.data.id,
      fullName: result.data.full_name,
      phone: result.data.phone,
      email: "email" in result.data ? (result.data.email as string | null) : null,
      notes: result.data.notes,
      storeId: result.data.store_id,
      updatedAt: result.data.updated_at,
    },
  });
}
