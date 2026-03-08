import { apiError, apiSuccess, requireProfile, type AppRole, type ProfileContext } from "../../../../lib/auth-context";
import { claimIdempotency, finalizeIdempotency } from "../../../../lib/idempotency";
import { requirePermission } from "../../../../lib/permissions";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const STAFF_FILTER_ROLES = ["manager", "supervisor", "branch_manager", "frontdesk", "coach", "sales"] as const;
type StaffRole = (typeof STAFF_FILTER_ROLES)[number];

type StaffRow = {
  id: string;
  role: StaffRole;
  tenant_id: string | null;
  branch_id: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  invited_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  last_login_at: string | null;
};

type StaffItem = {
  id: string;
  role: StaffRole;
  tenant_id: string | null;
  branch_id: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  invited_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  last_login_at: string | null;
  email: string | null;
};

function parseRole(value: string | null): StaffRole | null {
  if (!value) return null;
  return STAFF_FILTER_ROLES.includes(value as StaffRole) ? (value as StaffRole) : null;
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function canAssignRole(actorRole: AppRole, targetRole: StaffRole) {
  if (actorRole === "platform_admin") return true;
  if (actorRole === "manager") {
    return targetRole === "frontdesk" || targetRole === "coach" || targetRole === "sales" || targetRole === "supervisor";
  }
  return false;
}

function formatStaffItem(row: StaffRow, email?: string | null): StaffItem {
  return {
    id: row.id,
    role: row.role,
    tenant_id: row.tenant_id,
    branch_id: row.branch_id,
    display_name: row.display_name,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    invited_by: row.invited_by ?? null,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    last_login_at: row.last_login_at ?? null,
    email: email ?? null,
  };
}

async function resolveTenantScope(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth;

  const requestedTenantId = new URL(request.url).searchParams.get("tenantId");
  const scopedTenantId = auth.context.role === "platform_admin" ? requestedTenantId : auth.context.tenantId;

  if (!scopedTenantId) {
    return {
      ok: false as const,
      response: apiError(400, "FORBIDDEN", "tenantId is required for platform admin or missing in profile context"),
    };
  }

  return {
    ok: true as const,
    auth,
    scopedTenantId,
  };
}

async function validateBranchScope(params: {
  auth: { context: ProfileContext };
  supabase: any;
  tenantId: string;
  branchId: string | null;
}) {
  const { auth, supabase, tenantId, branchId } = params;
  if (!branchId) return { ok: true as const };

  const branchCheck = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", branchId)
    .maybeSingle();
  if (branchCheck.error) {
    return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", branchCheck.error.message) };
  }
  if (!branchCheck.data) {
    return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "branchId is outside tenant scope") };
  }

  if (
    auth.context.role !== "platform_admin" &&
    auth.context.branchId &&
    auth.context.branchId !== branchId
  ) {
    return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "Cannot assign staff to another branch outside your scope") };
  }

  return { ok: true as const };
}

async function loadEmailsByIds(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return new Map<string, string>();
  }
  const wanted = new Set(userIds);
  const emailById = new Map<string, string>();
  let page = 1;
  const perPage = 200;

  while (page <= 8 && wanted.size > 0) {
    const usersResult = await admin.auth.admin.listUsers({ page, perPage });
    if (usersResult.error) break;
    const users = usersResult.data.users || [];
    if (users.length === 0) break;
    for (const user of users) {
      if (!wanted.has(user.id)) continue;
      emailById.set(user.id, user.email || "");
      wanted.delete(user.id);
    }
    if (users.length < perPage) break;
    page += 1;
  }

  return emailById;
}

export async function GET(request: Request) {
  const scoped = await resolveTenantScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "staff.read");
  if (!permission.ok) return permission.response;

  const { searchParams } = new URL(request.url);
  const role = parseRole(searchParams.get("role"));
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  const activeOnly = searchParams.get("activeOnly") === "1";

  let query = scoped.auth.supabase
    .from("profiles")
    .select("id, role, tenant_id, branch_id, display_name, is_active, created_at, updated_at, invited_by, created_by, updated_by, last_login_at")
    .eq("tenant_id", scoped.scopedTenantId)
    .in("role", [...STAFF_FILTER_ROLES])
    .order("created_at", { ascending: false })
    .limit(200);

  if (role) query = query.eq("role", role);
  if (activeOnly) query = query.eq("is_active", true);
  if (q) query = query.or(`display_name.ilike.%${q}%,id.ilike.%${q}%`);
  if (scoped.auth.context.role !== "platform_admin" && scoped.auth.context.branchId) {
    query = query.eq("branch_id", scoped.auth.context.branchId);
  }

  const { data, error } = await query;
  if (error) return apiError(500, "INTERNAL_ERROR", error.message);

  const rows = (data || []) as StaffRow[];
  const emailsById = await loadEmailsByIds(rows.map((item) => item.id));
  const items = rows
    .map((row) => formatStaffItem(row, emailsById.get(row.id) || null))
    .filter((item) => {
      if (!q) return true;
      const displayName = (item.display_name || "").toLowerCase();
      const id = item.id.toLowerCase();
      const email = (item.email || "").toLowerCase();
      return displayName.includes(q) || id.includes(q) || email.includes(q);
    });
  return apiSuccess({ items });
}

export async function POST(request: Request) {
  const scoped = await resolveTenantScope(request);
  if (!scoped.ok) return scoped.response;

  const permission = requirePermission(scoped.auth.context, "staff.create");
  if (!permission.ok) return permission.response;

  const body = (await request.json().catch(() => null)) as
    | {
        email?: string;
        password?: string;
        role?: string;
        displayName?: string | null;
        branchId?: string | null;
        isActive?: boolean;
        tenantId?: string;
        idempotencyKey?: string;
      }
    | null;

  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const role = parseRole(typeof body?.role === "string" ? body.role : null);
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() || null : null;
  const isActive = body?.isActive === false ? false : true;
  const nextBranchId = typeof body?.branchId === "string" ? body.branchId.trim() || null : null;
  const idempotencyKeyInput = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const tenantId = scoped.auth.context.role === "platform_admin"
    ? (typeof body?.tenantId === "string" ? body.tenantId.trim() : "")
    : scoped.scopedTenantId;

  if (!tenantId) return apiError(400, "FORBIDDEN", "tenantId is required");
  if (!email || !password) return apiError(400, "FORBIDDEN", "email and password are required");
  if (password.length < 8) return apiError(400, "FORBIDDEN", "password must be at least 8 characters");
  if (!role) return apiError(400, "INVALID_ROLE", "role is invalid");
  if (!canAssignRole(scoped.auth.context.role, role)) {
    return apiError(403, "ROLE_ASSIGNMENT_DENIED", "You cannot assign this role");
  }

  const branchScope = await validateBranchScope({
    auth: scoped.auth,
    supabase: scoped.auth.supabase,
    tenantId,
    branchId: nextBranchId,
  });
  if (!branchScope.ok) return branchScope.response;

  const operationKey =
    idempotencyKeyInput || ["staff_create", tenantId, email, role, nextBranchId || "na", String(isActive)].join(":");
  const operationClaim = await claimIdempotency({
    supabase: scoped.auth.supabase,
    tenantId,
    operationKey,
    actorId: scoped.auth.context.userId,
    ttlMinutes: 60,
  });
  if (!operationClaim.ok) return apiError(500, "INTERNAL_ERROR", operationClaim.error);
  if (!operationClaim.claimed) {
    if (operationClaim.existing?.status === "succeeded" && operationClaim.existing.response) {
      return apiSuccess({ replayed: true, ...operationClaim.existing.response });
    }
    return apiError(409, "EMAIL_ALREADY_EXISTS", "Duplicate staff create request in progress");
  }

  const admin = createSupabaseAdminClient();
  const userResult = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userResult.error || !userResult.data.user) {
    await finalizeIdempotency({
      supabase: scoped.auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "AUTH_USER_CREATE_FAILED",
    });
    const message = userResult.error?.message || "Create user failed";
    if (message.toLowerCase().includes("already") || message.toLowerCase().includes("registered")) {
      return apiError(409, "EMAIL_ALREADY_EXISTS", "Email already exists");
    }
    return apiError(500, "INTERNAL_ERROR", message);
  }

  const now = new Date().toISOString();
  const userId = userResult.data.user.id;
  const profileResult = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        tenant_id: tenantId,
        branch_id: nextBranchId,
        role,
        display_name: displayName,
        is_active: isActive,
        invited_by: scoped.auth.context.userId,
        created_by: scoped.auth.context.userId,
        updated_by: scoped.auth.context.userId,
        updated_at: now,
      },
      { onConflict: "id" },
    )
    .select("id, role, tenant_id, branch_id, display_name, is_active, created_at, updated_at, invited_by, created_by, updated_by, last_login_at")
    .maybeSingle();

  if (profileResult.error || !profileResult.data) {
    await finalizeIdempotency({
      supabase: scoped.auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "PROFILE_UPSERT_FAILED",
    });
    return apiError(500, "INTERNAL_ERROR", profileResult.error?.message || "Create profile failed");
  }

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: scoped.auth.context.userId,
    action: "staff_account_created",
    target_type: "profile",
    target_id: userId,
    reason: null,
    payload: {
      email,
      role,
      branchId: nextBranchId,
      isActive,
      displayName,
    },
  });

  const successPayload = {
    item: formatStaffItem(profileResult.data as StaffRow, email),
  };
  await finalizeIdempotency({
    supabase: scoped.auth.supabase,
    tenantId,
    operationKey,
    status: "succeeded",
    response: successPayload as Record<string, unknown>,
  });

  return apiSuccess(successPayload);
}

function changedFields(before: StaffRow, after: StaffRow) {
  return {
    roleChanged: before.role !== after.role,
    branchChanged: (before.branch_id || null) !== (after.branch_id || null),
    activeChanged: before.is_active !== after.is_active,
    profileChanged:
      before.display_name !== after.display_name,
  };
}

export async function PATCH(request: Request) {
  const scoped = await resolveTenantScope(request);
  if (!scoped.ok) return scoped.response;

  const body = (await request.json().catch(() => null)) as
    | {
        id?: string;
        role?: string;
        displayName?: string | null;
        branchId?: string | null;
        isActive?: boolean;
      }
    | null;

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return apiError(400, "FORBIDDEN", "id is required");

  const existingResult = await scoped.auth.supabase
    .from("profiles")
    .select("id, role, tenant_id, branch_id, display_name, is_active, created_at, updated_at, invited_by, created_by, updated_by, last_login_at")
    .eq("tenant_id", scoped.scopedTenantId)
    .eq("id", id)
    .in("role", [...STAFF_FILTER_ROLES])
    .maybeSingle();
  if (existingResult.error) return apiError(500, "INTERNAL_ERROR", existingResult.error.message);
  if (!existingResult.data) return apiError(404, "FORBIDDEN", "staff not found");
  const existing = existingResult.data as StaffRow;

  if (scoped.auth.context.role !== "platform_admin" && scoped.auth.context.branchId && existing.branch_id !== scoped.auth.context.branchId) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Cannot manage staff outside your branch scope");
  }

  const updates: Record<string, unknown> = {};
  let nextRole = existing.role;

  if (typeof body?.role === "string") {
    const parsed = parseRole(body.role);
    if (!parsed) return apiError(400, "INVALID_ROLE", "invalid role");
    if (!canAssignRole(scoped.auth.context.role, parsed)) {
      return apiError(403, "ROLE_ASSIGNMENT_DENIED", "You cannot assign this role");
    }
    updates.role = parsed;
    nextRole = parsed;
  }

  if (body && "displayName" in body) {
    if (body.displayName === null) {
      updates.display_name = null;
    } else if (typeof body.displayName === "string") {
      updates.display_name = body.displayName.trim() || null;
    } else {
      return apiError(400, "FORBIDDEN", "invalid displayName");
    }
  }

  let nextBranchId: string | null = existing.branch_id;
  if (body && "branchId" in body) {
    if (body.branchId === null) {
      updates.branch_id = null;
      nextBranchId = null;
    } else if (typeof body.branchId === "string") {
      nextBranchId = body.branchId.trim() || null;
      updates.branch_id = nextBranchId;
    } else {
      return apiError(400, "FORBIDDEN", "invalid branchId");
    }
  }

  if (typeof body?.isActive === "boolean") {
    updates.is_active = body.isActive;
  }

  if (Object.keys(updates).length === 0) {
    return apiError(400, "FORBIDDEN", "no updates provided");
  }

  if ("is_active" in updates && updates.is_active !== existing.is_active) {
    const disablePermission = requirePermission(scoped.auth.context, "staff.disable");
    if (!disablePermission.ok) return disablePermission.response;
  } else {
    const updatePermission = requirePermission(scoped.auth.context, "staff.update");
    if (!updatePermission.ok) return updatePermission.response;
  }

  if ("role" in updates && nextRole !== existing.role && !canAssignRole(scoped.auth.context.role, nextRole)) {
    return apiError(403, "ROLE_ASSIGNMENT_DENIED", "You cannot assign this role");
  }

  const branchScope = await validateBranchScope({
    auth: scoped.auth,
    supabase: scoped.auth.supabase,
    tenantId: scoped.scopedTenantId,
    branchId: nextBranchId,
  });
  if (!branchScope.ok) return branchScope.response;

  updates.updated_by = scoped.auth.context.userId;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await scoped.auth.supabase
    .from("profiles")
    .update(updates)
    .eq("tenant_id", scoped.scopedTenantId)
    .eq("id", id)
    .in("role", [...STAFF_FILTER_ROLES])
    .select("id, role, tenant_id, branch_id, display_name, is_active, created_at, updated_at, invited_by, created_by, updated_by, last_login_at")
    .maybeSingle();
  if (error) return apiError(500, "INTERNAL_ERROR", error.message);
  if (!data) return apiError(404, "FORBIDDEN", "staff not found");

  const updated = data as StaffRow;
  const changes = changedFields(existing, updated);
  const auditInserts: Array<Record<string, unknown>> = [];

  if (changes.roleChanged) {
    auditInserts.push({
      tenant_id: scoped.scopedTenantId,
      actor_id: scoped.auth.context.userId,
      action: "staff_role_updated",
      target_type: "profile",
      target_id: id,
      reason: null,
      payload: { before: existing.role, after: updated.role },
    });
  }
  if (changes.branchChanged) {
    auditInserts.push({
      tenant_id: scoped.scopedTenantId,
      actor_id: scoped.auth.context.userId,
      action: "staff_branch_updated",
      target_type: "profile",
      target_id: id,
      reason: null,
      payload: { before: existing.branch_id, after: updated.branch_id },
    });
  }
  if (changes.activeChanged) {
    auditInserts.push({
      tenant_id: scoped.scopedTenantId,
      actor_id: scoped.auth.context.userId,
      action: updated.is_active ? "staff_activated" : "staff_deactivated",
      target_type: "profile",
      target_id: id,
      reason: null,
      payload: { before: existing.is_active, after: updated.is_active },
    });
  }
  if (changes.profileChanged && !changes.roleChanged && !changes.branchChanged && !changes.activeChanged) {
    auditInserts.push({
      tenant_id: scoped.scopedTenantId,
      actor_id: scoped.auth.context.userId,
      action: "staff_profile_updated",
      target_type: "profile",
      target_id: id,
      reason: null,
      payload: { before: existing.display_name, after: updated.display_name },
    });
  }

  if (auditInserts.length > 0) {
    await scoped.auth.supabase.from("audit_logs").insert(auditInserts);
  }

  return apiSuccess({ item: formatStaffItem(updated) });
}
