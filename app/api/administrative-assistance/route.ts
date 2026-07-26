import { apiError, apiSuccess, requireProfile, type ProfileContext } from "../../../lib/auth-context";
import { requirePermission } from "../../../lib/permissions";
import {
  canCreateAdministrativeAssistance,
  canProcessAdministrativeAssistance,
} from "../../../lib/staff-organization";

type AssistanceRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  title: string;
  details: string | null;
  status: "open" | "completed";
  created_by: string;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function actorFromContext(
  context: Pick<ProfileContext, "role" | "department" | "position" | "branchId">,
) {
  return {
    role: context.role,
    department: context.department || null,
    position: context.position || null,
    branchId: context.branchId,
  };
}

async function resolveTenant(request: Request) {
  const auth = await requireProfile(undefined, request);
  if (!auth.ok) return auth;
  const requestedTenantId = new URL(request.url).searchParams.get("tenantId");
  const tenantId =
    auth.context.role === "platform_admin"
      ? requestedTenantId || auth.context.tenantId
      : auth.context.tenantId;
  if (!tenantId) {
    return {
      ok: false as const,
      response: apiError(400, "FORBIDDEN", "tenantId is required"),
    };
  }
  return { ok: true as const, auth, tenantId };
}

export async function GET(request: Request) {
  const scoped = await resolveTenant(request);
  if (!scoped.ok) return scoped.response;
  const permission = requirePermission(scoped.auth.context, "assistance.read");
  if (!permission.ok) return permission.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  let query = scoped.auth.supabase
    .from("administrative_assistance_items")
    .select(
      "id, tenant_id, branch_id, title, details, status, created_by, completed_by, completed_at, created_at, updated_at",
    )
    .eq("tenant_id", scoped.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (status === "open" || status === "completed") query = query.eq("status", status);
  if (scoped.auth.context.branchId) {
    query = query.or(`branch_id.eq.${scoped.auth.context.branchId},branch_id.is.null`);
  }

  const result = await query;
  if (result.error) return apiError(500, "INTERNAL_ERROR", result.error.message);

  const rows = (result.data || []) as AssistanceRow[];
  const profileIds = Array.from(
    new Set(
      rows.flatMap((row) => [row.created_by, row.completed_by]).filter((id): id is string => !!id),
    ),
  );
  const names =
    profileIds.length > 0
      ? await scoped.auth.supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", profileIds)
      : { data: [], error: null };
  if (names.error) return apiError(500, "INTERNAL_ERROR", names.error.message);
  const nameById = new Map(
    ((names.data || []) as Array<{ id: string; display_name: string | null }>).map((row) => [
      row.id,
      row.display_name,
    ]),
  );

  return apiSuccess({
    items: rows.map((row) => ({
      ...row,
      creator_name: nameById.get(row.created_by) || "未命名員工",
      completed_by_name: row.completed_by
        ? nameById.get(row.completed_by) || "未命名員工"
        : null,
    })),
    capabilities: {
      canCreate: canCreateAdministrativeAssistance(actorFromContext(scoped.auth.context)),
      canComplete: canProcessAdministrativeAssistance(actorFromContext(scoped.auth.context)),
    },
  });
}

export async function POST(request: Request) {
  const scoped = await resolveTenant(request);
  if (!scoped.ok) return scoped.response;
  const permission = requirePermission(scoped.auth.context, "assistance.create");
  if (!permission.ok) return permission.response;
  if (!canCreateAdministrativeAssistance(actorFromContext(scoped.auth.context))) {
    return apiError(403, "FORBIDDEN", "Only coaching assistant managers and managers can create assistance items");
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const details = typeof body?.details === "string" ? body.details.trim() || null : null;
  const branchId =
    typeof body?.branchId === "string" ? body.branchId.trim() || null : scoped.auth.context.branchId;
  if (!title || title.length > 120) {
    return apiError(400, "FORBIDDEN", "title must be between 1 and 120 characters");
  }

  const inserted = await scoped.auth.supabase
    .from("administrative_assistance_items")
    .insert({
      tenant_id: scoped.tenantId,
      branch_id: branchId,
      title,
      details,
      created_by: scoped.auth.context.userId,
    })
    .select("id, tenant_id, branch_id, title, details, status, created_by, completed_by, completed_at, created_at, updated_at")
    .single();
  if (inserted.error) return apiError(500, "INTERNAL_ERROR", inserted.error.message);

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "administrative_assistance_created",
    target_type: "administrative_assistance_item",
    target_id: inserted.data.id,
    reason: null,
    payload: { branchId, title },
  });

  return apiSuccess({ item: inserted.data });
}

export async function PATCH(request: Request) {
  const scoped = await resolveTenant(request);
  if (!scoped.ok) return scoped.response;
  const permission = requirePermission(scoped.auth.context, "assistance.complete");
  if (!permission.ok) return permission.response;
  if (!canProcessAdministrativeAssistance(actorFromContext(scoped.auth.context))) {
    return apiError(403, "FORBIDDEN", "Only general affairs employees can complete assistance items");
  }

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return apiError(400, "FORBIDDEN", "id is required");

  const existing = await scoped.auth.supabase
    .from("administrative_assistance_items")
    .select("id, branch_id, status")
    .eq("tenant_id", scoped.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (existing.error) return apiError(500, "INTERNAL_ERROR", existing.error.message);
  if (!existing.data) return apiError(404, "FORBIDDEN", "assistance item not found");
  if (
    scoped.auth.context.role !== "platform_admin" &&
    scoped.auth.context.branchId &&
    existing.data.branch_id &&
    existing.data.branch_id !== scoped.auth.context.branchId
  ) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Cannot complete an item outside your branch");
  }
  if (existing.data.status === "completed") {
    return apiSuccess({ item: existing.data, replayed: true });
  }

  const now = new Date().toISOString();
  const updated = await scoped.auth.supabase
    .from("administrative_assistance_items")
    .update({
      status: "completed",
      completed_by: scoped.auth.context.userId,
      completed_at: now,
      updated_at: now,
    })
    .eq("tenant_id", scoped.tenantId)
    .eq("id", id)
    .eq("status", "open")
    .select("id, tenant_id, branch_id, title, details, status, created_by, completed_by, completed_at, created_at, updated_at")
    .maybeSingle();
  if (updated.error) return apiError(500, "INTERNAL_ERROR", updated.error.message);
  if (!updated.data) return apiError(409, "FORBIDDEN", "This item was already processed");

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "administrative_assistance_completed",
    target_type: "administrative_assistance_item",
    target_id: id,
    reason: null,
    payload: { completedAt: now },
  });

  return apiSuccess({ item: updated.data });
}
