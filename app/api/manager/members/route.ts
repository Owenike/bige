import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { requirePermission } from "../../../../lib/permissions";
import { evaluateContractStatus, remainingDays } from "../../../../lib/member-plan-lifecycle";

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function resolveScope(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth;
  if (!auth.context.tenantId) {
    return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant context") };
  }
  return { ok: true as const, auth };
}

function contractStateFromRows(rows: Array<{ status: string | null; ends_at: string | null; remaining_uses: number | null; remaining_sessions: number | null }>) {
  if (!rows.length) return { status: "none", nearestEndsAt: null as string | null, remainingDays: null as number | null };
  const sorted = rows
    .map((row) => ({
      status: evaluateContractStatus({
        status: row.status,
        endsAt: row.ends_at,
        remainingUses: row.remaining_uses,
        remainingSessions: row.remaining_sessions,
      }),
      endsAt: row.ends_at,
    }))
    .sort((a, b) => {
      const aTs = a.endsAt ? new Date(a.endsAt).getTime() : Number.POSITIVE_INFINITY;
      const bTs = b.endsAt ? new Date(b.endsAt).getTime() : Number.POSITIVE_INFINITY;
      return aTs - bTs;
    });
  const first = sorted[0];
  return {
    status: first.status,
    nearestEndsAt: first.endsAt || null,
    remainingDays: remainingDays(first.endsAt),
  };
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

export async function GET(request: Request) {
  const scoped = await resolveScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "members.read");
  if (!permission.ok) return permission.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const lifecycle = (searchParams.get("lifecycle") || "").trim().toLowerCase();

  let query = scoped.auth.supabase
    .from("members")
    .select("id, full_name, phone, photo_url, notes, store_id, created_at, updated_at")
    .eq("tenant_id", scoped.auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
  if (scoped.auth.context.branchId) query = query.eq("store_id", scoped.auth.context.branchId);

  const memberResult = await query;
  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);

  const members = (memberResult.data || []) as Array<{
    id: string;
    full_name: string;
    phone: string | null;
    photo_url: string | null;
    notes: string | null;
    store_id: string | null;
    created_at: string;
    updated_at: string;
  }>;

  const memberIds = members.map((member) => member.id);
  const contractsByMember = new Map<
    string,
    Array<{ status: string | null; ends_at: string | null; remaining_uses: number | null; remaining_sessions: number | null }>
  >();
  if (memberIds.length > 0) {
    const contractsResult = await scoped.auth.supabase
      .from("member_plan_contracts")
      .select("member_id, status, ends_at, remaining_uses, remaining_sessions")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .in("member_id", memberIds)
      .limit(5000);
    if (contractsResult.error) {
      if (!isMissingTableError(contractsResult.error.message, "member_plan_contracts")) {
        return apiError(500, "INTERNAL_ERROR", contractsResult.error.message);
      }
    } else {
      for (const row of (contractsResult.data || []) as Array<{
        member_id: string;
        status: string | null;
        ends_at: string | null;
        remaining_uses: number | null;
        remaining_sessions: number | null;
      }>) {
        const list = contractsByMember.get(row.member_id) || [];
        list.push({
          status: row.status,
          ends_at: row.ends_at,
          remaining_uses: row.remaining_uses,
          remaining_sessions: row.remaining_sessions,
        });
        contractsByMember.set(row.member_id, list);
      }
    }
  }

  const items = members
    .map((member) => {
      const state = contractStateFromRows(contractsByMember.get(member.id) || []);
      const eligibility =
        state.status === "active"
          ? { eligible: true, reasonCode: "OK", message: "Eligible" }
          : state.status === "expired"
            ? { eligible: false, reasonCode: "ENTITLEMENT_EXPIRED", message: "Entitlement expired" }
            : state.status === "exhausted"
              ? { eligible: false, reasonCode: "ENTITLEMENT_EXHAUSTED", message: "Entitlement exhausted" }
              : state.status === "none"
                ? { eligible: false, reasonCode: "ENTITLEMENT_NOT_FOUND", message: "No entitlement contract" }
                : { eligible: false, reasonCode: "CONTRACT_STATE_INVALID", message: "Contract not active" };
      return {
        id: member.id,
        fullName: member.full_name,
        phone: member.phone,
        notes: member.notes,
        photoUrl: member.photo_url,
        storeId: member.store_id,
        createdAt: member.created_at,
        updatedAt: member.updated_at,
        contractStatus: state.status,
        nearestEndsAt: state.nearestEndsAt,
        remainingDays: state.remainingDays,
        eligibility,
      };
    })
    .filter((member) => {
      if (!lifecycle) return true;
      if (lifecycle === "expiring") return typeof member.remainingDays === "number" && member.remainingDays >= 0 && member.remainingDays <= 14;
      if (lifecycle === "expired") return member.contractStatus === "expired";
      if (lifecycle === "exhausted") return member.contractStatus === "exhausted";
      return true;
    });

  return apiSuccess({ items });
}

export async function POST(request: Request) {
  const scoped = await resolveScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "members.update");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const fullName = normalizeOptionalText(body?.fullName) ?? "";
  const phone = normalizeOptionalText(body?.phone);
  const notes = normalizeOptionalText(body?.notes);
  const storeId = normalizeOptionalText(body?.storeId);

  if (!fullName) return apiError(400, "FORBIDDEN", "fullName is required");

  if (storeId) {
    const branchResult = await scoped.auth.supabase
      .from("branches")
      .select("id")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .eq("id", storeId)
      .maybeSingle();
    if (branchResult.error) return apiError(500, "INTERNAL_ERROR", branchResult.error.message);
    if (!branchResult.data) return apiError(403, "BRANCH_SCOPE_DENIED", "branch not found for storeId");
  }

  if (scoped.auth.context.branchId && storeId && scoped.auth.context.branchId !== storeId) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Cannot create member outside your branch scope");
  }

  const now = new Date().toISOString();
  const insertResult = await scoped.auth.supabase
    .from("members")
    .insert({
      tenant_id: scoped.auth.context.tenantId,
      full_name: fullName,
      phone,
      notes,
      store_id: storeId || scoped.auth.context.branchId || null,
      created_at: now,
      updated_at: now,
    })
    .select("id, full_name, phone, notes, store_id, created_at, updated_at")
    .maybeSingle();
  if (insertResult.error || !insertResult.data) {
    return apiError(500, "INTERNAL_ERROR", insertResult.error?.message || "Create member failed");
  }

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.auth.context.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "member_create",
    target_type: "member",
    target_id: String(insertResult.data.id),
    reason: "manager_create",
    payload: { fullName, phone, notes, storeId: storeId || null },
  });

  return apiSuccess({
    member: {
      id: insertResult.data.id,
      fullName: insertResult.data.full_name,
      phone: insertResult.data.phone,
      notes: insertResult.data.notes,
      storeId: insertResult.data.store_id,
      createdAt: insertResult.data.created_at,
      updatedAt: insertResult.data.updated_at,
    },
  });
}
