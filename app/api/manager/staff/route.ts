import {
  apiError,
  apiSuccess,
  requireProfile,
  type AppRole,
  type ProfileContext,
} from "../../../../lib/auth-context";
import {
  claimIdempotency,
  finalizeIdempotency,
} from "../../../../lib/idempotency";
import { requirePermission } from "../../../../lib/permissions";
import {
  verifySensitiveOperator,
  type SensitiveCredentials,
} from "../../../../lib/sensitive-reauth";
import {
  hasStaffPermission,
  type StaffPermissionKey,
} from "../../../../lib/staff-operation-permissions";
import {
  canCreatePosition,
  canManagePosition,
  legacyRoleForPosition,
  normalizeStaffDepartment,
  normalizeStaffPosition,
  positionBelongsToDepartment,
  roleForOrganizationAssignment,
  type StaffDepartment,
  type StaffPosition,
} from "../../../../lib/staff-organization";
import {
  CUSTOM_EMPLOYEE_NUMBER_MANAGER,
  canChooseStaffEmployeeNumber,
  isEmployeeNumber,
  isStaffPlaceholderEmail,
  normalizeEmployeeNumber,
  staffPlaceholderEmail,
} from "../../../../lib/staff-credentials";
import {
  generateInternalStaffPassword,
  generateStaffActivationCode,
  staffActivationCodeHash,
  staffActivationExpiresAt,
  staffActivationSecret,
  type StaffActivationStatus,
} from "../../../../lib/staff-activation";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

const STAFF_FILTER_ROLES = [
  "manager",
  "supervisor",
  "branch_manager",
  "frontdesk",
  "coach",
  "sales",
] as const;
type StaffRole = (typeof STAFF_FILTER_ROLES)[number];

type StaffRow = {
  id: string;
  role: AppRole;
  department: StaffDepartment | null;
  position: StaffPosition | null;
  tenant_id: string | null;
  branch_id: string | null;
  display_name: string | null;
  english_name: string | null;
  employee_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  invited_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  last_login_at: string | null;
  staff_deleted_at: string | null;
  staff_deleted_by: string | null;
  staff_delete_reason: string | null;
  staff_activation_status: StaffActivationStatus;
};

type StaffItem = {
  id: string;
  role: AppRole;
  department: StaffDepartment | null;
  position: StaffPosition | null;
  tenant_id: string | null;
  branch_id: string | null;
  display_name: string | null;
  english_name: string | null;
  employee_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  invited_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  last_login_at: string | null;
  staff_deleted_at: string | null;
  staff_deleted_by: string | null;
  staff_delete_reason: string | null;
  staff_activation_status: StaffActivationStatus;
  email: string | null;
};

function parseRole(value: string | null): StaffRole | null {
  if (!value) return null;
  return STAFF_FILTER_ROLES.includes(value as StaffRole)
    ? (value as StaffRole)
    : null;
}

function managedStaffRoles(actorRole: AppRole): AppRole[] {
  return actorRole === "platform_admin"
    ? [...STAFF_FILTER_ROLES, "platform_admin"]
    : [...STAFF_FILTER_ROLES];
}

function canAssignLegacyRole(actorRole: AppRole, targetRole: StaffRole) {
  if (actorRole === "platform_admin") return true;
  if (actorRole === "manager") {
    return targetRole === "frontdesk" || targetRole === "coach";
  }
  return false;
}

function formatStaffItem(row: StaffRow, email?: string | null): StaffItem {
  return {
    id: row.id,
    role: row.role,
    department: row.department,
    position: row.position,
    tenant_id: row.tenant_id,
    branch_id: row.branch_id,
    display_name: row.display_name,
    english_name: row.english_name,
    employee_number: row.employee_number,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    invited_by: row.invited_by ?? null,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    last_login_at: row.last_login_at ?? null,
    staff_deleted_at: row.staff_deleted_at ?? null,
    staff_deleted_by: row.staff_deleted_by ?? null,
    staff_delete_reason: row.staff_delete_reason ?? null,
    staff_activation_status: row.staff_activation_status,
    email: email ?? null,
  };
}

function organizationActor(
  context: Pick<
    ProfileContext,
    "role" | "department" | "position" | "branchId"
  >,
) {
  return {
    role: context.role,
    department: context.department || null,
    position: context.position || null,
    branchId: context.branchId,
  };
}

const STAFF_SELECT =
  "id, role, department, position, tenant_id, branch_id, display_name, english_name, employee_number, is_active, created_at, updated_at, invited_by, created_by, updated_by, last_login_at, staff_deleted_at, staff_deleted_by, staff_delete_reason, staff_activation_status";

async function checkOperationPermission(params: {
  context: Pick<ProfileContext, "userId" | "role" | "position">;
  tenantId: string;
  permission: StaffPermissionKey;
  message: string;
}) {
  try {
    const allowed = await hasStaffPermission({
      supabase: createSupabaseAdminClient(),
      tenantId: params.tenantId,
      employeeId: params.context.userId,
      context: params.context,
      permission: params.permission,
    });
    return allowed ? null : apiError(403, "FORBIDDEN", params.message);
  } catch (error) {
    return apiError(
      500,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "權限檢查失敗",
    );
  }
}

async function resolveTenantScope(request: Request) {
  const auth = await requireProfile(
    ["platform_admin", "manager", "supervisor", "branch_manager"],
    request,
  );
  if (!auth.ok) return auth;

  const requestedTenantId = new URL(request.url).searchParams.get("tenantId");
  const scopedTenantId =
    auth.context.role === "platform_admin"
      ? requestedTenantId || auth.context.tenantId
      : auth.context.tenantId;

  if (!scopedTenantId) {
    return {
      ok: false as const,
      response: apiError(
        400,
        "FORBIDDEN",
        "tenantId is required for platform admin or missing in profile context",
      ),
    };
  }

  return {
    ok: true as const,
    auth,
    scopedTenantId,
  };
}

async function validateBranchScope(params: {
  context: Pick<ProfileContext, "role" | "branchId">;
  supabase: any;
  tenantId: string;
  branchId: string | null;
}) {
  const { context, supabase, tenantId, branchId } = params;
  if (!branchId) return { ok: true as const };

  const branchCheck = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", branchId)
    .maybeSingle();
  if (branchCheck.error) {
    return {
      ok: false as const,
      response: apiError(500, "INTERNAL_ERROR", branchCheck.error.message),
    };
  }
  if (!branchCheck.data) {
    return {
      ok: false as const,
      response: apiError(
        403,
        "BRANCH_SCOPE_DENIED",
        "branchId is outside tenant scope",
      ),
    };
  }

  if (
    context.role !== "platform_admin" &&
    context.branchId &&
    context.branchId !== branchId
  ) {
    return {
      ok: false as const,
      response: apiError(
        403,
        "BRANCH_SCOPE_DENIED",
        "Cannot assign staff to another branch outside your scope",
      ),
    };
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
      const email = user.email || "";
      emailById.set(user.id, isStaffPlaceholderEmail(email) ? "" : email);
      wanted.delete(user.id);
    }
    if (users.length < perPage) break;
    page += 1;
  }

  return emailById;
}

async function nextAvailableEmployeeNumber(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<{ data: string | null; error: { message: string } | null }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const generated = await admin.rpc("next_staff_employee_number");
    if (generated.error) return { data: null, error: generated.error };

    const candidate = typeof generated.data === "string" ? generated.data : "";
    if (!isEmployeeNumber(candidate)) {
      return {
        data: null,
        error: { message: "Create employee number failed" },
      };
    }

    const existing = await admin
      .from("profiles")
      .select("id")
      .eq("employee_number", candidate)
      .maybeSingle();
    if (existing.error) return { data: null, error: existing.error };
    if (!existing.data) return { data: candidate, error: null };
  }

  return { data: null, error: { message: "No available employee number" } };
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
  const deletedOnly = searchParams.get("deletedOnly") === "1";

  let query = scoped.auth.supabase
    .from("profiles")
    .select(STAFF_SELECT)
    .eq("tenant_id", scoped.scopedTenantId)
    .in("role", managedStaffRoles(scoped.auth.context.role))
    .order("created_at", { ascending: false })
    .limit(200);

  if (role) query = query.eq("role", role);
  query = deletedOnly
    ? query.not("staff_deleted_at", "is", null)
    : query.is("staff_deleted_at", null);
  if (activeOnly && !deletedOnly) query = query.eq("is_active", true);
  if (q) {
    query = query.or(
      `display_name.ilike.%${q}%,english_name.ilike.%${q}%,employee_number.ilike.%${q}%,id.ilike.%${q}%`,
    );
  }
  if (
    scoped.auth.context.role !== "platform_admin" &&
    scoped.auth.context.branchId
  ) {
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
      const englishName = (item.english_name || "").toLowerCase();
      const employeeNumber = (item.employee_number || "").toLowerCase();
      const id = item.id.toLowerCase();
      const email = (item.email || "").toLowerCase();
      return (
        displayName.includes(q) ||
        englishName.includes(q) ||
        employeeNumber.includes(q) ||
        id.includes(q) ||
        email.includes(q)
      );
    });
  return apiSuccess({ items });
}

export async function POST(request: Request) {
  const scoped = await resolveTenantScope(request);
  if (!scoped.ok) return scoped.response;

  const body = (await request.json().catch(() => null)) as {
    role?: string;
    department?: string;
    position?: string;
    displayName?: string | null;
    englishName?: string | null;
    employeeNumber?: string | null;
    branchId?: string | null;
    isActive?: boolean;
    tenantId?: string;
    idempotencyKey?: string;
    reauth?: SensitiveCredentials;
  } | null;

  const reauth = await verifySensitiveOperator({
    session: scoped.auth.context,
    credentials: body?.reauth,
  });
  if (!reauth.ok) return apiError(401, "UNAUTHORIZED", reauth.message);

  const department = normalizeStaffDepartment(body?.department);
  const position = normalizeStaffPosition(body?.position);
  const role = position
    ? (legacyRoleForPosition(position) as StaffRole)
    : parseRole(typeof body?.role === "string" ? body.role : null);
  const displayName =
    typeof body?.displayName === "string"
      ? body.displayName.trim() || null
      : null;
  const englishName =
    typeof body?.englishName === "string"
      ? body.englishName.trim() || null
      : null;
  const requestedEmployeeNumber = normalizeEmployeeNumber(body?.employeeNumber);
  const isActive = body?.isActive === false ? false : true;
  const nextBranchId =
    typeof body?.branchId === "string" ? body.branchId.trim() || null : null;
  const idempotencyKeyInput =
    typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const tenantId =
    scoped.auth.context.role === "platform_admin"
      ? (typeof body?.tenantId === "string" ? body.tenantId.trim() : "") ||
        scoped.scopedTenantId
      : scoped.scopedTenantId;

  if (!tenantId) return apiError(400, "FORBIDDEN", "tenantId is required");
  const createPermission = await checkOperationPermission({
    context: reauth.operator,
    tenantId,
    permission: "create_employee",
    message: "您沒有新增員工帳號的權限",
  });
  if (createPermission) return createPermission;
  if (!displayName) return apiError(400, "FORBIDDEN", "真實姓名為必填");
  if (!englishName) return apiError(400, "FORBIDDEN", "英文姓名為必填");
  if (body?.employeeNumber && !isEmployeeNumber(requestedEmployeeNumber)) {
    return apiError(400, "FORBIDDEN", "員工編號格式不正確");
  }
  if (!role) return apiError(400, "INVALID_ROLE", "role is invalid");
  if (
    (department || position) &&
    !positionBelongsToDepartment(department, position)
  ) {
    return apiError(
      400,
      "INVALID_ROLE",
      "department and position do not match",
    );
  }
  const canAssign = position
    ? canCreatePosition(organizationActor(reauth.operator), position)
    : canAssignLegacyRole(reauth.operator.role, role);
  if (!canAssign) {
    return apiError(
      403,
      "ROLE_ASSIGNMENT_DENIED",
      "You cannot assign this role",
    );
  }

  const admin = createSupabaseAdminClient();
  if (requestedEmployeeNumber) {
    const actorIdentity = await admin
      .from("profiles")
      .select("employee_number")
      .eq("id", scoped.auth.context.userId)
      .maybeSingle();
    if (actorIdentity.error) {
      return apiError(500, "INTERNAL_ERROR", actorIdentity.error.message);
    }
    if (!canChooseStaffEmployeeNumber(actorIdentity.data?.employee_number)) {
      return apiError(403, "FORBIDDEN", "只有 01 帳號可以指定員工編號");
    }
  }

  const branchScope = await validateBranchScope({
    context: reauth.operator,
    supabase: scoped.auth.supabase,
    tenantId,
    branchId: nextBranchId,
  });
  if (!branchScope.ok) return branchScope.response;

  const operationKey =
    idempotencyKeyInput ||
    [
      "staff_create",
      tenantId,
      displayName,
      englishName,
      department || "legacy",
      position || role,
      nextBranchId || "na",
      requestedEmployeeNumber || "auto",
      String(isActive),
    ].join(":");
  const operationClaim = await claimIdempotency({
    supabase: scoped.auth.supabase,
    tenantId,
    operationKey,
    actorId: reauth.operator.userId,
    ttlMinutes: 60,
  });
  if (!operationClaim.ok)
    return apiError(500, "INTERNAL_ERROR", operationClaim.error);
  if (!operationClaim.claimed) {
    if (
      operationClaim.existing?.status === "succeeded" &&
      operationClaim.existing.response
    ) {
      return apiSuccess({
        replayed: true,
        ...operationClaim.existing.response,
      });
    }
    return apiError(409, "FORBIDDEN", "相同的員工建立作業正在處理中");
  }

  if (requestedEmployeeNumber === CUSTOM_EMPLOYEE_NUMBER_MANAGER) {
    if (
      reauth.operator.role !== "platform_admin" ||
      department !== "coaching"
    ) {
      await finalizeIdempotency({
        supabase: scoped.auth.supabase,
        tenantId,
        operationKey,
        status: "failed",
        errorCode: "SELF_COACH_LINK_DENIED",
      });
      return apiError(403, "FORBIDDEN", "01 本人帳號只能由本人加入教練部");
    }

    const existingSelfResult = await admin
      .from("profiles")
      .select(STAFF_SELECT)
      .eq("id", reauth.operator.userId)
      .eq("tenant_id", tenantId)
      .eq("employee_number", CUSTOM_EMPLOYEE_NUMBER_MANAGER)
      .maybeSingle();
    if (existingSelfResult.error || !existingSelfResult.data) {
      await finalizeIdempotency({
        supabase: scoped.auth.supabase,
        tenantId,
        operationKey,
        status: "failed",
        errorCode: "SELF_COACH_ACCOUNT_NOT_FOUND",
      });
      return apiError(
        existingSelfResult.error ? 500 : 404,
        existingSelfResult.error ? "INTERNAL_ERROR" : "FORBIDDEN",
        existingSelfResult.error?.message || "找不到目前登入的 01 帳號",
      );
    }

    const now = new Date().toISOString();
    const linkedSelfResult = await admin
      .from("profiles")
      .update({
        display_name: displayName,
        english_name: englishName,
        department,
        position,
        branch_id: nextBranchId,
        is_active: isActive,
        organization_assigned_at: now,
        organization_assigned_by: reauth.operator.userId,
        updated_by: reauth.operator.userId,
        updated_at: now,
      })
      .eq("id", reauth.operator.userId)
      .eq("tenant_id", tenantId)
      .eq("employee_number", CUSTOM_EMPLOYEE_NUMBER_MANAGER)
      .select(STAFF_SELECT)
      .maybeSingle();
    if (linkedSelfResult.error || !linkedSelfResult.data) {
      await finalizeIdempotency({
        supabase: scoped.auth.supabase,
        tenantId,
        operationKey,
        status: "failed",
        errorCode: "SELF_COACH_LINK_FAILED",
      });
      return apiError(
        500,
        "INTERNAL_ERROR",
        linkedSelfResult.error?.message || "01 帳號加入教練名單失敗",
      );
    }

    await scoped.auth.supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: reauth.operator.userId,
      action: "platform_admin_linked_as_schedule_coach",
      target_type: "profile",
      target_id: reauth.operator.userId,
      reason: reauth.reason,
      payload: {
        employeeNumber: CUSTOM_EMPLOYEE_NUMBER_MANAGER,
        department,
        position,
        branchId: nextBranchId,
        displayName,
        englishName,
      },
    });

    const linkedPayload = {
      item: formatStaffItem(linkedSelfResult.data as StaffRow),
      linkedExistingAccount: true,
    };
    await finalizeIdempotency({
      supabase: scoped.auth.supabase,
      tenantId,
      operationKey,
      status: "succeeded",
      response: linkedPayload as Record<string, unknown>,
    });
    return apiSuccess(linkedPayload);
  }

  const employeeNumberResult = requestedEmployeeNumber
    ? { data: requestedEmployeeNumber, error: null }
    : await nextAvailableEmployeeNumber(admin);
  const employeeNumber =
    typeof employeeNumberResult.data === "string"
      ? employeeNumberResult.data
      : "";
  if (employeeNumberResult.error || !isEmployeeNumber(employeeNumber)) {
    await finalizeIdempotency({
      supabase: scoped.auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "EMPLOYEE_NUMBER_CREATE_FAILED",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      employeeNumberResult.error?.message || "Create employee number failed",
    );
  }

  const internalEmail = staffPlaceholderEmail(employeeNumber);
  const activationCode = generateStaffActivationCode();
  const activationExpiresAt = staffActivationExpiresAt();
  let activationHash = "";
  try {
    activationHash = staffActivationCodeHash(
      activationCode,
      staffActivationSecret(),
    );
  } catch (error) {
    await finalizeIdempotency({
      supabase: scoped.auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "STAFF_ACTIVATION_CONFIG_MISSING",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      error instanceof Error
        ? error.message
        : "Staff activation configuration is missing",
    );
  }
  const userResult = await admin.auth.admin.createUser({
    email: internalEmail,
    password: generateInternalStaffPassword(),
    email_confirm: true,
    user_metadata: {
      employee_number: employeeNumber,
      display_name: displayName,
      english_name: englishName,
      role,
    },
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
    if (
      message.toLowerCase().includes("already") ||
      message.toLowerCase().includes("registered")
    ) {
      return apiError(409, "FORBIDDEN", "員工編號已存在，請重新建立");
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
        department,
        position,
        organization_assigned_at: department && position ? now : null,
        organization_assigned_by:
          department && position ? reauth.operator.userId : null,
        display_name: displayName,
        english_name: englishName,
        employee_number: employeeNumber,
        is_active: isActive,
        invited_by: reauth.operator.userId,
        created_by: reauth.operator.userId,
        updated_by: reauth.operator.userId,
        must_change_password: true,
        password_reset_required_at: now,
        staff_email_verified_at: null,
        staff_activation_status: "pending_identity",
        staff_identity_confirmed_at: null,
        staff_identity_denied_at: null,
        staff_activation_completed_at: null,
        updated_at: now,
      },
      { onConflict: "id" },
    )
    .select(STAFF_SELECT)
    .maybeSingle();

  if (profileResult.error || !profileResult.data) {
    await admin.auth.admin.deleteUser(userId);
    await finalizeIdempotency({
      supabase: scoped.auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "PROFILE_UPSERT_FAILED",
    });
    return apiError(
      500,
      "INTERNAL_ERROR",
      profileResult.error?.message || "Create profile failed",
    );
  }

  const activationResult = await admin.from("staff_activation_tokens").insert({
    profile_id: userId,
    tenant_id: tenantId,
    token_hash: activationHash,
    expires_at: activationExpiresAt,
    failed_attempts: 0,
    created_by: reauth.operator.userId,
  });
  if (activationResult.error) {
    await admin.auth.admin.deleteUser(userId);
    await finalizeIdempotency({
      supabase: scoped.auth.supabase,
      tenantId,
      operationKey,
      status: "failed",
      errorCode: "STAFF_ACTIVATION_CREATE_FAILED",
    });
    return apiError(500, "INTERNAL_ERROR", activationResult.error.message);
  }

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: reauth.operator.userId,
    action: "staff_account_created",
    target_type: "profile",
    target_id: userId,
    reason: reauth.reason,
    payload: {
      employeeNumber,
      role,
      department,
      position,
      branchId: nextBranchId,
      isActive,
      displayName,
      englishName,
      activationExpiresAt,
    },
  });

  const successPayload = {
    item: formatStaffItem(profileResult.data as StaffRow, null),
    activation: {
      code: activationCode,
      expiresAt: activationExpiresAt,
      shownOnce: true,
    },
    verification: {
      deliveryStatus: "pending_employee_email",
    },
  };
  const storedSuccessPayload = {
    item: formatStaffItem(profileResult.data as StaffRow, null),
    activation: {
      code: null,
      expiresAt: activationExpiresAt,
      shownOnce: false,
    },
    verification: {
      deliveryStatus: "pending_employee_email",
    },
  };
  await finalizeIdempotency({
    supabase: scoped.auth.supabase,
    tenantId,
    operationKey,
    status: "succeeded",
    response: storedSuccessPayload as Record<string, unknown>,
  });

  return apiSuccess(successPayload);
}

function changedFields(before: StaffRow, after: StaffRow) {
  return {
    roleChanged: before.role !== after.role,
    organizationChanged:
      before.department !== after.department ||
      before.position !== after.position,
    branchChanged: (before.branch_id || null) !== (after.branch_id || null),
    activeChanged: before.is_active !== after.is_active,
    profileChanged:
      before.display_name !== after.display_name ||
      before.english_name !== after.english_name,
  };
}

export async function PATCH(request: Request) {
  const scoped = await resolveTenantScope(request);
  if (!scoped.ok) return scoped.response;

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    role?: string;
    department?: string | null;
    position?: string | null;
    displayName?: string | null;
    englishName?: string | null;
    branchId?: string | null;
    isActive?: boolean;
    restore?: boolean;
    reauth?: SensitiveCredentials;
  } | null;

  const reauth = await verifySensitiveOperator({
    session: scoped.auth.context,
    credentials: body?.reauth,
  });
  if (!reauth.ok) return apiError(401, "UNAUTHORIZED", reauth.message);

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return apiError(400, "FORBIDDEN", "id is required");

  const existingResult = await scoped.auth.supabase
    .from("profiles")
    .select(STAFF_SELECT)
    .eq("tenant_id", scoped.scopedTenantId)
    .eq("id", id)
    .in("role", managedStaffRoles(scoped.auth.context.role))
    .maybeSingle();
  if (existingResult.error)
    return apiError(500, "INTERNAL_ERROR", existingResult.error.message);
  if (!existingResult.data)
    return apiError(404, "FORBIDDEN", "staff not found");
  const existing = existingResult.data as StaffRow;

  if (
    existing.role === "platform_admin" &&
    existing.id !== reauth.operator.userId
  ) {
    return apiError(
      403,
      "ROLE_ASSIGNMENT_DENIED",
      "不能修改其他系統管理員帳號",
    );
  }
  if (existing.role === "platform_admin" && body?.isActive === false) {
    return apiError(409, "FORBIDDEN", "不能停用目前登入的 01 系統管理員帳號");
  }

  if (body?.restore === true) {
    if (reauth.operator.role !== "platform_admin") {
      return apiError(403, "FORBIDDEN", "只有平台管理員可以復原已刪除員工");
    }
    const restorePermission = await checkOperationPermission({
      context: reauth.operator,
      tenantId: scoped.scopedTenantId,
      permission: "suspend_employee",
      message: "您沒有恢復員工帳號的權限",
    });
    if (restorePermission) return restorePermission;
    if (!existing.staff_deleted_at) {
      return apiError(409, "FORBIDDEN", "此員工不在已刪除清單中");
    }

    let restoredEmployeeNumber = existing.employee_number;
    if (!restoredEmployeeNumber) {
      const admin = createSupabaseAdminClient();
      const employeeNumberResult = await admin.rpc(
        "next_staff_employee_number",
      );
      restoredEmployeeNumber =
        typeof employeeNumberResult.data === "string"
          ? employeeNumberResult.data
          : "";
      if (
        employeeNumberResult.error ||
        !isEmployeeNumber(restoredEmployeeNumber)
      ) {
        return apiError(
          500,
          "INTERNAL_ERROR",
          employeeNumberResult.error?.message || "復原員工編號失敗",
        );
      }
    }

    const now = new Date().toISOString();
    const restoreResult = await scoped.auth.supabase
      .from("profiles")
      .update({
        employee_number: restoredEmployeeNumber,
        staff_deleted_at: null,
        staff_deleted_by: null,
        staff_delete_reason: null,
        is_active: true,
        updated_by: reauth.operator.userId,
        updated_at: now,
      })
      .eq("tenant_id", scoped.scopedTenantId)
      .eq("id", id)
      .select(STAFF_SELECT)
      .maybeSingle();
    if (restoreResult.error) {
      return apiError(500, "INTERNAL_ERROR", restoreResult.error.message);
    }
    if (!restoreResult.data)
      return apiError(404, "FORBIDDEN", "staff not found");

    await scoped.auth.supabase.from("audit_logs").insert({
      tenant_id: scoped.scopedTenantId,
      actor_id: reauth.operator.userId,
      action: "staff_account_restored",
      target_type: "profile",
      target_id: id,
      reason: reauth.reason,
      payload: {
        deletedAt: existing.staff_deleted_at,
        previousDeleteReason: existing.staff_delete_reason,
      },
    });

    return apiSuccess({
      item: formatStaffItem(restoreResult.data as StaffRow),
    });
  }

  if (existing.staff_deleted_at) {
    return apiError(409, "FORBIDDEN", "已刪除員工只能先復原，不能直接修改");
  }

  if (
    !canManagePosition(
      organizationActor(reauth.operator),
      existing.department,
      existing.position,
    ) &&
    reauth.operator.role !== "platform_admin"
  ) {
    return apiError(
      403,
      "ROLE_ASSIGNMENT_DENIED",
      "You cannot manage this employee",
    );
  }

  if (
    reauth.operator.role !== "platform_admin" &&
    reauth.operator.branchId &&
    existing.branch_id !== reauth.operator.branchId
  ) {
    return apiError(
      403,
      "BRANCH_SCOPE_DENIED",
      "Cannot manage staff outside your branch scope",
    );
  }

  const updates: Record<string, unknown> = {};
  let nextRole = existing.role;
  let nextDepartment = existing.department;
  let nextPosition = existing.position;

  if (typeof body?.role === "string") {
    if (existing.role === "platform_admin") {
      return apiError(
        403,
        "ROLE_ASSIGNMENT_DENIED",
        "01 系統管理員權限不能在員工頁變更",
      );
    }
    const parsed = parseRole(body.role);
    if (!parsed) return apiError(400, "INVALID_ROLE", "invalid role");
    if (!canAssignLegacyRole(reauth.operator.role, parsed)) {
      return apiError(
        403,
        "ROLE_ASSIGNMENT_DENIED",
        "You cannot assign this role",
      );
    }
    updates.role = parsed;
    nextRole = parsed;
  }

  if (body && ("department" in body || "position" in body)) {
    nextDepartment =
      body.department === null
        ? null
        : normalizeStaffDepartment(body.department ?? existing.department);
    nextPosition =
      body.position === null
        ? null
        : normalizeStaffPosition(body.position ?? existing.position);
    if (!positionBelongsToDepartment(nextDepartment, nextPosition)) {
      return apiError(
        400,
        "INVALID_ROLE",
        "department and position do not match",
      );
    }
    if (
      !nextPosition ||
      !canCreatePosition(organizationActor(reauth.operator), nextPosition)
    ) {
      return apiError(
        403,
        "ROLE_ASSIGNMENT_DENIED",
        "You cannot assign this position",
      );
    }
    nextRole = roleForOrganizationAssignment(existing.role, nextPosition);
    updates.department = nextDepartment;
    updates.position = nextPosition;
    if (existing.role !== "platform_admin") updates.role = nextRole;
    updates.organization_assigned_at = new Date().toISOString();
    updates.organization_assigned_by = reauth.operator.userId;
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

  if (body && "englishName" in body) {
    if (body.englishName === null) {
      return apiError(400, "FORBIDDEN", "英文姓名為必填");
    }
    if (typeof body.englishName === "string" && body.englishName.trim()) {
      updates.english_name = body.englishName.trim();
    } else {
      return apiError(400, "FORBIDDEN", "英文姓名為必填");
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

  const changesActiveState =
    "is_active" in updates && updates.is_active !== existing.is_active;
  const changesAssignment =
    ("role" in updates && nextRole !== existing.role) ||
    "department" in updates ||
    "position" in updates ||
    "branch_id" in updates;
  const changesProfile = Object.keys(updates).some(
    (key) => !["is_active", "updated_by", "updated_at"].includes(key),
  );

  if (changesActiveState) {
    const suspendPermission = await checkOperationPermission({
      context: reauth.operator,
      tenantId: scoped.scopedTenantId,
      permission: "suspend_employee",
      message: "您沒有停用或恢復員工帳號的權限",
    });
    if (suspendPermission) return suspendPermission;
  }
  if (changesProfile) {
    const editPermission = await checkOperationPermission({
      context: reauth.operator,
      tenantId: scoped.scopedTenantId,
      permission: "edit_employee",
      message: "您沒有修改員工資料的權限",
    });
    if (editPermission) return editPermission;
  }
  if (changesAssignment) {
    const assignmentPermission = await checkOperationPermission({
      context: reauth.operator,
      tenantId: scoped.scopedTenantId,
      permission: "assign_supervisor",
      message: "您沒有調整員工職務、角色或分館的權限",
    });
    if (assignmentPermission) return assignmentPermission;
  }

  if (
    "role" in updates &&
    nextRole !== existing.role &&
    !nextPosition &&
    !canAssignLegacyRole(reauth.operator.role, nextRole as StaffRole)
  ) {
    return apiError(
      403,
      "ROLE_ASSIGNMENT_DENIED",
      "You cannot assign this role",
    );
  }

  const branchScope = await validateBranchScope({
    context: reauth.operator,
    supabase: scoped.auth.supabase,
    tenantId: scoped.scopedTenantId,
    branchId: nextBranchId,
  });
  if (!branchScope.ok) return branchScope.response;

  updates.updated_by = reauth.operator.userId;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await scoped.auth.supabase
    .from("profiles")
    .update(updates)
    .eq("tenant_id", scoped.scopedTenantId)
    .eq("id", id)
    .in("role", managedStaffRoles(scoped.auth.context.role))
    .select(STAFF_SELECT)
    .maybeSingle();
  if (error) return apiError(500, "INTERNAL_ERROR", error.message);
  if (!data) return apiError(404, "FORBIDDEN", "staff not found");

  const updated = data as StaffRow;
  const changes = changedFields(existing, updated);
  const auditInserts: Array<Record<string, unknown>> = [];

  if (changes.roleChanged) {
    auditInserts.push({
      tenant_id: scoped.scopedTenantId,
      actor_id: reauth.operator.userId,
      action: "staff_role_updated",
      target_type: "profile",
      target_id: id,
      reason: reauth.reason,
      payload: { before: existing.role, after: updated.role },
    });
  }
  if (changes.organizationChanged) {
    auditInserts.push({
      tenant_id: scoped.scopedTenantId,
      actor_id: reauth.operator.userId,
      action: "staff_organization_updated",
      target_type: "profile",
      target_id: id,
      reason: reauth.reason,
      payload: {
        before: {
          department: existing.department,
          position: existing.position,
        },
        after: { department: updated.department, position: updated.position },
      },
    });
  }
  if (changes.branchChanged) {
    auditInserts.push({
      tenant_id: scoped.scopedTenantId,
      actor_id: reauth.operator.userId,
      action: "staff_branch_updated",
      target_type: "profile",
      target_id: id,
      reason: reauth.reason,
      payload: { before: existing.branch_id, after: updated.branch_id },
    });
  }
  if (changes.activeChanged) {
    auditInserts.push({
      tenant_id: scoped.scopedTenantId,
      actor_id: reauth.operator.userId,
      action: updated.is_active ? "staff_activated" : "staff_deactivated",
      target_type: "profile",
      target_id: id,
      reason: reauth.reason,
      payload: { before: existing.is_active, after: updated.is_active },
    });
  }
  if (
    changes.profileChanged &&
    !changes.roleChanged &&
    !changes.branchChanged &&
    !changes.activeChanged
  ) {
    auditInserts.push({
      tenant_id: scoped.scopedTenantId,
      actor_id: reauth.operator.userId,
      action: "staff_profile_updated",
      target_type: "profile",
      target_id: id,
      reason: reauth.reason,
      payload: {
        before: {
          displayName: existing.display_name,
          englishName: existing.english_name,
        },
        after: {
          displayName: updated.display_name,
          englishName: updated.english_name,
        },
      },
    });
  }

  if (auditInserts.length > 0) {
    await scoped.auth.supabase.from("audit_logs").insert(auditInserts);
  }

  return apiSuccess({ item: formatStaffItem(updated) });
}

export async function DELETE(request: Request) {
  const scoped = await resolveTenantScope(request);
  if (!scoped.ok) return scoped.response;

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    reauth?: SensitiveCredentials;
  } | null;

  const reauth = await verifySensitiveOperator({
    session: scoped.auth.context,
    credentials: body?.reauth,
  });
  if (!reauth.ok) return apiError(401, "UNAUTHORIZED", reauth.message);
  if (reauth.operator.role !== "platform_admin") {
    return apiError(403, "FORBIDDEN", "只有平台管理員可以刪除員工");
  }

  const deletePermission = await checkOperationPermission({
    context: reauth.operator,
    tenantId: scoped.scopedTenantId,
    permission: "suspend_employee",
    message: "您沒有刪除或停用員工帳號的權限",
  });
  if (deletePermission) return deletePermission;

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return apiError(400, "FORBIDDEN", "id is required");
  if (id === reauth.operator.userId) {
    return apiError(409, "FORBIDDEN", "不能刪除目前登入中的平台管理員帳號");
  }

  const admin = createSupabaseAdminClient();
  const existingResult = await admin
    .from("profiles")
    .select(STAFF_SELECT)
    .eq("tenant_id", scoped.scopedTenantId)
    .eq("id", id)
    .in("role", [...STAFF_FILTER_ROLES])
    .maybeSingle();
  if (existingResult.error)
    return apiError(500, "INTERNAL_ERROR", existingResult.error.message);
  if (!existingResult.data)
    return apiError(404, "FORBIDDEN", "找不到要刪除的員工");
  const existing = existingResult.data as StaffRow;
  if (existing.staff_deleted_at) {
    return apiError(409, "FORBIDDEN", "此員工已在已刪除清單中");
  }

  const now = new Date().toISOString();
  const deleteResult = await admin
    .from("profiles")
    .update({
      staff_deleted_at: now,
      staff_deleted_by: reauth.operator.userId,
      staff_delete_reason: reauth.reason,
      is_active: false,
      updated_by: reauth.operator.userId,
      updated_at: now,
    })
    .eq("tenant_id", scoped.scopedTenantId)
    .eq("id", id)
    .is("staff_deleted_at", null)
    .select(STAFF_SELECT)
    .maybeSingle();
  if (deleteResult.error) {
    return apiError(500, "INTERNAL_ERROR", deleteResult.error.message);
  }
  if (!deleteResult.data)
    return apiError(409, "FORBIDDEN", "員工已被刪除或狀態已變更");

  await admin
    .from("staff_activation_tokens")
    .update({ revoked_at: now })
    .eq("profile_id", id)
    .is("revoked_at", null);

  await admin.from("audit_logs").insert({
    tenant_id: scoped.scopedTenantId,
    actor_id: reauth.operator.userId,
    action: "staff_account_deleted",
    target_type: "profile",
    target_id: id,
    reason: reauth.reason,
    payload: {
      displayName: existing.display_name,
      role: existing.role,
      department: existing.department,
      position: existing.position,
      branchId: existing.branch_id,
      recoverable: true,
    },
  });

  return apiSuccess({
    deletedId: id,
    item: formatStaffItem(deleteResult.data as StaffRow),
  });
}
