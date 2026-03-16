import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  applyPlatformCapabilitiesToSettings,
  createCapabilityFlagMap,
  listTenantBookingCapabilityFlags,
} from "./platform-booking-capabilities";
import type {
  BookingCommercialSnapshot,
  BookingCommercialPaymentStatus,
  BookingPackageLogItem,
  BookingPaymentMode,
  ManagerMemberPackageItem,
  ManagerPackageTemplateItem,
  MemberPackageOption,
} from "../types/booking-commerce";

type ServiceRow = {
  id: string;
  branch_id: string | null;
  code: string;
  name: string;
  price_amount: number | string | null;
  requires_deposit: boolean | null;
  deposit_calculation_type: "fixed" | "percent" | null;
  deposit_value: number | string | null;
};

type BookingSettingsRow = {
  id: string;
  branch_id: string | null;
  deposits_enabled: boolean | null;
  packages_enabled: boolean | null;
  deposit_required_mode: "optional" | "required" | null;
  deposit_calculation_type: "fixed" | "percent" | null;
  deposit_value: number | string | null;
};

type EntryPassRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  member_id: string;
  member_plan_contract_id: string | null;
  plan_catalog_id: string | null;
  remaining: number | string | null;
  reserved_sessions: number | string | null;
  total_sessions: number | string | null;
  expires_at: string | null;
  status: string | null;
  created_at?: string | null;
};

type ContractRow = {
  id: string;
  plan_catalog_id: string | null;
  branch_id: string | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

type PackagePlanRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  description: string | null;
  plan_type: "entry_pass" | "coach_pack" | "subscription" | "trial";
  fulfillment_kind: "subscription" | "entry_pass" | "none";
  default_duration_days: number | null;
  default_quantity: number | null;
  price_amount: number | string | null;
  service_scope: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type PackageLogRow = {
  id: string;
  action: "reserve" | "consume" | "release" | "adjust";
  sessions_delta: number;
  reason: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
  entry_pass_id: string;
};

type BookingPackageRpcRow = {
  log_id: string;
  action: "reserve" | "consume" | "release" | "adjust";
  entry_pass_id: string;
  member_plan_contract_id: string | null;
  remaining: number;
  reserved_sessions: number;
  redemption_id: string | null;
};

export type ResolvedServiceCommercials = {
  id: string;
  code: string;
  name: string;
  priceAmount: number;
  requiresDeposit: boolean;
  depositCalculationType: "fixed" | "percent";
  depositValue: number;
};

export type ResolvedBookingSettings = {
  id: string | null;
  branchId: string | null;
  depositsEnabled: boolean;
  packagesEnabled: boolean;
  depositRequiredMode: "optional" | "required";
  depositCalculationType: "fixed" | "percent";
  depositValue: number;
};

export type PrepareBookingCommercialInput = {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  memberId: string;
  serviceName: string;
  paymentMode?: string | null;
  entryPassId?: string | null;
};

export type PreparedBookingCommercials = {
  paymentMode: BookingPaymentMode;
  service: ResolvedServiceCommercials;
  bookingSettings: ResolvedBookingSettings;
  packageSelection: MemberPackageOption | null;
  bookingInsertPatch: {
    booking_payment_mode: BookingPaymentMode;
    entry_pass_id: string | null;
    member_plan_contract_id: string | null;
    package_sessions_reserved: number;
    package_sessions_consumed: number;
    payment_status: BookingCommercialPaymentStatus;
    deposit_required_amount: number;
    deposit_paid_amount: number;
    final_amount: number;
    outstanding_amount: number;
    payment_method: string | null;
    payment_reference: string | null;
    payment_updated_at: string | null;
  };
};

export class BookingCommercialError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isMissingSchemaObject(message: string | undefined, targets: string[]) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return targets.some((target) => lower.includes(target.toLowerCase()));
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePaymentMode(value: string | null | undefined): BookingPaymentMode {
  return value === "package" ? "package" : "single";
}

function parseServiceScope(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);
}

function matchesServiceScope(params: {
  service: ResolvedServiceCommercials;
  serviceScope: string[];
}) {
  if (params.serviceScope.length === 0) return true;
  const candidates = [
    params.service.id.toLowerCase(),
    params.service.code.toLowerCase(),
    params.service.name.toLowerCase(),
  ];
  return params.serviceScope.some((scope) => candidates.includes(scope));
}

export function mapPackageActionError(error: PostgrestError | Error | null | undefined) {
  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (error) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string") message = candidate;
  }
  if (!message) return null;
  if (message.includes("entry_pass_not_found")) {
    return new BookingCommercialError(404, "ENTITLEMENT_NOT_FOUND", "Selected package could not be found.");
  }
  if (message.includes("entry_pass_expired")) {
    return new BookingCommercialError(409, "ENTITLEMENT_EXPIRED", "Selected package has expired.");
  }
  if (message.includes("entry_pass_inactive")) {
    return new BookingCommercialError(409, "CONTRACT_STATE_INVALID", "Selected package is not active.");
  }
  if (message.includes("insufficient_available_sessions")) {
    return new BookingCommercialError(409, "ENTITLEMENT_EXHAUSTED", "No available sessions remain on the selected package.");
  }
  if (message.includes("insufficient_remaining_sessions")) {
    return new BookingCommercialError(409, "ENTITLEMENT_EXHAUSTED", "No remaining sessions remain on the selected package.");
  }
  if (message.includes("booking_package_already_reserved")) {
    return new BookingCommercialError(409, "CONTRACT_STATE_INVALID", "This booking already reserved a package session.");
  }
  if (message.includes("booking_package_already_consumed")) {
    return new BookingCommercialError(409, "CONTRACT_STATE_INVALID", "This booking already consumed a package session.");
  }
  if (message.includes("booking_package_already_released")) {
    return new BookingCommercialError(409, "CONTRACT_STATE_INVALID", "This booking already released its package reservation.");
  }
  if (message.includes("insufficient_reserved_sessions")) {
    return new BookingCommercialError(409, "CONTRACT_STATE_INVALID", "No reserved package sessions are available to release.");
  }
  return null;
}

export async function resolveServiceCommercials(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
  serviceName: string;
}) {
  let query = params.supabase
    .from("services")
    .select("id, branch_id, code, name, price_amount, requires_deposit, deposit_calculation_type, deposit_value")
    .eq("tenant_id", params.tenantId)
    .eq("name", params.serviceName)
    .limit(10);

  if (params.branchId) {
    query = query.or(`branch_id.eq.${params.branchId},branch_id.is.null`);
  }

  const result = await query;
  if (result.error) {
    throw new BookingCommercialError(500, "INTERNAL_ERROR", result.error.message);
  }

  const rows = (result.data || []) as ServiceRow[];
  const row = rows.find((item) => item.branch_id === params.branchId) || rows.find((item) => item.branch_id === null) || rows[0];
  if (!row) {
    throw new BookingCommercialError(404, "FORBIDDEN", "Service not found for booking payment calculation.");
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    priceAmount: toNumber(row.price_amount),
    requiresDeposit: row.requires_deposit ?? false,
    depositCalculationType: row.deposit_calculation_type || "fixed",
    depositValue: toNumber(row.deposit_value),
  } satisfies ResolvedServiceCommercials;
}

export async function resolveBookingSettings(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId: string | null;
}) {
  let branchResult = null as { data: BookingSettingsRow | null; error: PostgrestError | null } | null;
  if (params.branchId) {
    branchResult = await params.supabase
      .from("store_booking_settings")
      .select("id, branch_id, deposits_enabled, packages_enabled, deposit_required_mode, deposit_calculation_type, deposit_value")
      .eq("tenant_id", params.tenantId)
      .eq("branch_id", params.branchId)
      .maybeSingle();
    if (branchResult.error && !isMissingSchemaObject(branchResult.error.message, ["store_booking_settings"])) {
      throw new BookingCommercialError(500, "INTERNAL_ERROR", branchResult.error.message);
    }
  }

  if (branchResult?.data) {
    return {
      id: branchResult.data.id,
      branchId: branchResult.data.branch_id,
      depositsEnabled: branchResult.data.deposits_enabled ?? false,
      packagesEnabled: branchResult.data.packages_enabled ?? true,
      depositRequiredMode: branchResult.data.deposit_required_mode || "optional",
      depositCalculationType: branchResult.data.deposit_calculation_type || "fixed",
      depositValue: toNumber(branchResult.data.deposit_value),
    } satisfies ResolvedBookingSettings;
  }

  const tenantResult = await params.supabase
    .from("store_booking_settings")
    .select("id, branch_id, deposits_enabled, packages_enabled, deposit_required_mode, deposit_calculation_type, deposit_value")
    .eq("tenant_id", params.tenantId)
    .is("branch_id", null)
    .maybeSingle();
  if (tenantResult.error && !isMissingSchemaObject(tenantResult.error.message, ["store_booking_settings"])) {
    throw new BookingCommercialError(500, "INTERNAL_ERROR", tenantResult.error.message);
  }

  return {
    id: tenantResult.data?.id || null,
    branchId: tenantResult.data?.branch_id || null,
    depositsEnabled: tenantResult.data?.deposits_enabled ?? false,
    packagesEnabled: tenantResult.data?.packages_enabled ?? true,
    depositRequiredMode: tenantResult.data?.deposit_required_mode || "optional",
    depositCalculationType: tenantResult.data?.deposit_calculation_type || "fixed",
    depositValue: toNumber(tenantResult.data?.deposit_value),
  } satisfies ResolvedBookingSettings;
}

export function calculateDepositRequiredAmount(params: {
  service: ResolvedServiceCommercials;
  bookingSettings: ResolvedBookingSettings;
}) {
  if (!params.bookingSettings.depositsEnabled || !params.service.requiresDeposit) return 0;

  const mode = params.service.depositValue > 0 ? params.service.depositCalculationType : params.bookingSettings.depositCalculationType;
  const rawValue = params.service.depositValue > 0 ? params.service.depositValue : params.bookingSettings.depositValue;
  if (rawValue <= 0) return 0;

  if (mode === "percent") {
    return Math.max(0, Math.round((params.service.priceAmount * rawValue) / 100));
  }

  return Math.max(0, rawValue);
}

export function buildCommercialSnapshot(params: {
  paymentMode: BookingPaymentMode;
  service: ResolvedServiceCommercials;
  bookingSettings: ResolvedBookingSettings;
  packageSelection: MemberPackageOption | null;
}): PreparedBookingCommercials["bookingInsertPatch"] {
  if (params.paymentMode === "package" && params.packageSelection) {
    return {
      booking_payment_mode: "package",
      entry_pass_id: params.packageSelection.entryPassId,
      member_plan_contract_id: params.packageSelection.contractId,
      package_sessions_reserved: 1,
      package_sessions_consumed: 0,
      payment_status: "fully_paid",
      deposit_required_amount: 0,
      deposit_paid_amount: 0,
      final_amount: params.service.priceAmount,
      outstanding_amount: 0,
      payment_method: "package",
      payment_reference: params.packageSelection.entryPassId,
      payment_updated_at: new Date().toISOString(),
    };
  }

  const depositRequiredAmount = calculateDepositRequiredAmount({
    service: params.service,
    bookingSettings: params.bookingSettings,
  });

  return {
    booking_payment_mode: "single",
    entry_pass_id: null,
    member_plan_contract_id: null,
    package_sessions_reserved: 0,
    package_sessions_consumed: 0,
    payment_status: depositRequiredAmount > 0 ? "deposit_pending" : "unpaid",
    deposit_required_amount: depositRequiredAmount,
    deposit_paid_amount: 0,
    final_amount: params.service.priceAmount,
    outstanding_amount: params.service.priceAmount,
    payment_method: null,
    payment_reference: null,
    payment_updated_at: null,
  };
}

export async function listAvailableMemberPackages(params: {
  supabase: SupabaseClient;
  tenantId: string;
  memberId: string;
  branchId: string | null;
  serviceName: string;
}) {
  const service = await resolveServiceCommercials({
    supabase: params.supabase,
    tenantId: params.tenantId,
    branchId: params.branchId,
    serviceName: params.serviceName,
  });

  const passesResult = await params.supabase
    .from("entry_passes")
    .select("id, tenant_id, branch_id, member_id, member_plan_contract_id, plan_catalog_id, remaining, reserved_sessions, total_sessions, expires_at, status, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("member_id", params.memberId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (passesResult.error) {
    throw new BookingCommercialError(500, "INTERNAL_ERROR", passesResult.error.message);
  }

  const passRows = (passesResult.data || []) as EntryPassRow[];
  const contractIds = Array.from(new Set(passRows.map((item) => item.member_plan_contract_id).filter(Boolean))) as string[];
  const planIds = Array.from(new Set(passRows.map((item) => item.plan_catalog_id).filter(Boolean))) as string[];

  const [contractsResult, plansResult] = await Promise.all([
    contractIds.length
      ? params.supabase
          .from("member_plan_contracts")
          .select("id, plan_catalog_id, branch_id, status, starts_at, ends_at")
          .eq("tenant_id", params.tenantId)
          .in("id", contractIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? params.supabase
          .from("member_plan_catalog")
          .select("id, tenant_id, branch_id, code, name, description, plan_type, fulfillment_kind, default_duration_days, default_quantity, price_amount, service_scope, is_active, created_at, updated_at")
          .eq("tenant_id", params.tenantId)
          .in("id", planIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contractsResult.error) {
    throw new BookingCommercialError(500, "INTERNAL_ERROR", contractsResult.error.message);
  }
  if (plansResult.error) {
    throw new BookingCommercialError(500, "INTERNAL_ERROR", plansResult.error.message);
  }

  const contracts = new Map<string, ContractRow>();
  for (const contract of (contractsResult.data || []) as ContractRow[]) {
    contracts.set(contract.id, contract);
  }
  const plans = new Map<string, PackagePlanRow>();
  for (const plan of (plansResult.data || []) as PackagePlanRow[]) {
    plans.set(plan.id, plan);
  }

  return passRows
    .map((pass): MemberPackageOption | null => {
      const contract = pass.member_plan_contract_id ? contracts.get(pass.member_plan_contract_id) || null : null;
      const plan = pass.plan_catalog_id ? plans.get(pass.plan_catalog_id) || null : null;
      const remainingSessions = toNumber(pass.remaining);
      const reservedSessions = toNumber(pass.reserved_sessions);
      const availableSessions = Math.max(0, remainingSessions - reservedSessions);
      const expiresAt = pass.expires_at || contract?.ends_at || null;
      const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
      const serviceScope = parseServiceScope(plan?.service_scope);
      const scopedBranchId = pass.branch_id || contract?.branch_id || plan?.branch_id || null;

      if (plan && !plan.is_active) return null;
      if (contract?.status && !["active", "pending"].includes(contract.status)) return null;
      if (pass.status && pass.status !== "active") return null;
      if (expired) return null;
      if (scopedBranchId && params.branchId && scopedBranchId !== params.branchId) return null;
      if (!matchesServiceScope({ service, serviceScope })) return null;
      if (availableSessions <= 0) return null;

      return {
        entryPassId: pass.id,
        contractId: pass.member_plan_contract_id,
        planCatalogId: pass.plan_catalog_id,
        branchId: scopedBranchId,
        packageName: plan?.name || "Package",
        packageCode: plan?.code || null,
        planType: plan?.plan_type || null,
        remainingSessions,
        reservedSessions,
        availableSessions,
        totalSessions: pass.total_sessions === null || pass.total_sessions === undefined ? null : toNumber(pass.total_sessions),
        expiresAt,
        status: pass.status || contract?.status || "active",
        serviceScope,
      };
    })
    .filter((item): item is MemberPackageOption => Boolean(item))
    .sort((left, right) => {
      const leftExpires = left.expiresAt ? new Date(left.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      const rightExpires = right.expiresAt ? new Date(right.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      return leftExpires - rightExpires;
    });
}

export async function prepareBookingCommercials(input: PrepareBookingCommercialInput): Promise<PreparedBookingCommercials> {
  const paymentMode = normalizePaymentMode(input.paymentMode);
  const [service, rawBookingSettings, capabilityFlags, packages] = await Promise.all([
    resolveServiceCommercials({
      supabase: input.supabase,
      tenantId: input.tenantId,
      branchId: input.branchId,
      serviceName: input.serviceName,
    }),
    resolveBookingSettings({
      supabase: input.supabase,
      tenantId: input.tenantId,
      branchId: input.branchId,
    }),
    listTenantBookingCapabilityFlags({
      supabase: input.supabase,
      tenantId: input.tenantId,
    }),
    paymentMode === "package"
      ? listAvailableMemberPackages({
          supabase: input.supabase,
          tenantId: input.tenantId,
          memberId: input.memberId,
          branchId: input.branchId,
          serviceName: input.serviceName,
        })
      : Promise.resolve([] as MemberPackageOption[]),
  ]);

  if (!capabilityFlags.ok) {
    throw new BookingCommercialError(500, "INTERNAL_ERROR", capabilityFlags.error);
  }

  const bookingSettings = applyPlatformCapabilitiesToSettings({
    settings: {
      id: rawBookingSettings.id,
      tenantId: input.tenantId,
      branchId: rawBookingSettings.branchId,
      branchCode: null,
      branchName: null,
      resolvedFromScope: rawBookingSettings.branchId ? "branch_override" : "tenant_default",
      depositsEnabled: rawBookingSettings.depositsEnabled,
      packagesEnabled: rawBookingSettings.packagesEnabled,
      depositRequiredMode: rawBookingSettings.depositRequiredMode,
      depositCalculationType: rawBookingSettings.depositCalculationType,
      depositValue: rawBookingSettings.depositValue,
      allowCustomerReschedule: true,
      allowCustomerCancel: true,
      latestCancelHours: 24,
      latestRescheduleHours: 24,
      notificationsEnabled: true,
      reminderDayBeforeEnabled: true,
      reminderHourBeforeEnabled: true,
      depositReminderEnabled: true,
      crossStoreTherapistEnabled: false,
      bookingWindowDays: 30,
      minAdvanceMinutes: 120,
      slotIntervalMinutes: 30,
      timezone: "Asia/Taipei",
      notes: "",
      updatedAt: null,
    },
    flagMap: createCapabilityFlagMap(capabilityFlags.items),
  });

  const packageSelection =
    paymentMode === "package"
      ? (input.entryPassId
          ? packages.find((item) => item.entryPassId === input.entryPassId) || null
          : packages[0] || null)
      : null;

  if (paymentMode === "package" && !bookingSettings.packagesEnabled) {
    throw new BookingCommercialError(403, "FORBIDDEN", "Package booking is disabled for this tenant.");
  }

  if (paymentMode === "package" && !packageSelection) {
    throw new BookingCommercialError(409, "ENTITLEMENT_NOT_FOUND", "No active package is available for this service.");
  }

  return {
    paymentMode,
    service,
    bookingSettings: {
      id: bookingSettings.id,
      branchId: bookingSettings.branchId,
      depositsEnabled: bookingSettings.depositsEnabled,
      packagesEnabled: bookingSettings.packagesEnabled,
      depositRequiredMode: bookingSettings.depositRequiredMode,
      depositCalculationType: bookingSettings.depositCalculationType,
      depositValue: bookingSettings.depositValue,
    },
    packageSelection,
    bookingInsertPatch: buildCommercialSnapshot({
      paymentMode,
      service,
      bookingSettings,
      packageSelection,
    }),
  };
}

async function callPackageUsageRpc(params: {
  supabase: SupabaseClient;
  action: "reserve" | "consume" | "release";
  tenantId: string;
  bookingId: string;
  memberId: string;
  entryPassId: string;
  actorId: string | null;
  reason: string;
  note?: string | null;
  idempotencyKey: string;
  sessions?: number;
}) {
  const result = await params.supabase.rpc("manage_booking_package_usage", {
    p_action: params.action,
    p_tenant_id: params.tenantId,
    p_booking_id: params.bookingId,
    p_member_id: params.memberId,
    p_entry_pass_id: params.entryPassId,
    p_actor_id: params.actorId,
    p_reason: params.reason,
    p_note: params.note ?? null,
    p_idempotency_key: params.idempotencyKey,
    p_sessions: params.sessions ?? 1,
  });

  if (result.error) {
    const mapped = mapPackageActionError(result.error);
    if (mapped) throw mapped;
    throw new BookingCommercialError(500, "INTERNAL_ERROR", result.error.message);
  }

  const row = Array.isArray(result.data) ? (result.data[0] as BookingPackageRpcRow | undefined) : undefined;
  if (!row) {
    throw new BookingCommercialError(500, "INTERNAL_ERROR", "Package usage did not return a result.");
  }

  return row;
}

export async function reservePackageForBooking(params: {
  supabase: SupabaseClient;
  tenantId: string;
  bookingId: string;
  memberId: string;
  entryPassId: string;
  actorId: string | null;
  reason: string;
  note?: string | null;
  idempotencyKey: string;
}) {
  return callPackageUsageRpc({
    ...params,
    action: "reserve",
  });
}

export async function consumePackageForBooking(params: {
  supabase: SupabaseClient;
  tenantId: string;
  bookingId: string;
  memberId: string;
  entryPassId: string;
  actorId: string | null;
  reason: string;
  note?: string | null;
  idempotencyKey: string;
}) {
  return callPackageUsageRpc({
    ...params,
    action: "consume",
  });
}

export async function releasePackageForBooking(params: {
  supabase: SupabaseClient;
  tenantId: string;
  bookingId: string;
  memberId: string;
  entryPassId: string;
  actorId: string | null;
  reason: string;
  note?: string | null;
  idempotencyKey: string;
}) {
  return callPackageUsageRpc({
    ...params,
    action: "release",
  });
}

export async function fetchBookingPackageLogs(params: {
  supabase: SupabaseClient;
  tenantId: string;
  bookingId: string;
}) {
  const result = await params.supabase
    .from("booking_package_logs")
    .select("id, action, sessions_delta, reason, note, created_at, created_by, entry_pass_id")
    .eq("tenant_id", params.tenantId)
    .eq("booking_id", params.bookingId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (result.error) {
    if (isMissingSchemaObject(result.error.message, ["booking_package_logs"])) {
      return [] as BookingPackageLogItem[];
    }
    throw new BookingCommercialError(500, "INTERNAL_ERROR", result.error.message);
  }

  const passIds = Array.from(new Set(((result.data || []) as PackageLogRow[]).map((item) => item.entry_pass_id)));
  const passNameMap = new Map<string, string>();
  if (passIds.length > 0) {
    const passesResult = await params.supabase
      .from("entry_passes")
      .select("id, plan_catalog_id")
      .eq("tenant_id", params.tenantId)
      .in("id", passIds);
    if (passesResult.error && !isMissingSchemaObject(passesResult.error.message, ["plan_catalog_id"])) {
      throw new BookingCommercialError(500, "INTERNAL_ERROR", passesResult.error.message);
    }

    const planIds = Array.from(
      new Set(((passesResult.data || []) as Array<{ id: string; plan_catalog_id: string | null }>).map((item) => item.plan_catalog_id).filter(Boolean)),
    ) as string[];
    const passPlanIds = new Map<string, string>();
    for (const pass of (passesResult.data || []) as Array<{ id: string; plan_catalog_id: string | null }>) {
      if (pass.plan_catalog_id) passPlanIds.set(pass.id, pass.plan_catalog_id);
    }
    if (planIds.length > 0) {
      const plansResult = await params.supabase
        .from("member_plan_catalog")
        .select("id, name")
        .eq("tenant_id", params.tenantId)
        .in("id", planIds);
      if (plansResult.error) throw new BookingCommercialError(500, "INTERNAL_ERROR", plansResult.error.message);
      const planNameById = new Map<string, string>();
      for (const plan of (plansResult.data || []) as Array<{ id: string; name: string }>) {
        planNameById.set(plan.id, plan.name);
      }
      for (const [passId, planId] of passPlanIds.entries()) {
        passNameMap.set(passId, planNameById.get(planId) || "Package");
      }
    }
  }

  return ((result.data || []) as PackageLogRow[]).map(
    (item): BookingPackageLogItem => ({
      id: item.id,
      action: item.action,
      sessionsDelta: item.sessions_delta,
      reason: item.reason,
      note: item.note,
      packageName: passNameMap.get(item.entry_pass_id) || null,
      createdAt: item.created_at,
      createdBy: item.created_by,
    }),
  );
}

export async function listManagerPackageTemplates(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
}) {
  let query = params.supabase
    .from("member_plan_catalog")
    .select("id, tenant_id, branch_id, code, name, description, plan_type, fulfillment_kind, default_duration_days, default_quantity, price_amount, service_scope, is_active, created_at, updated_at")
    .eq("tenant_id", params.tenantId)
    .in("plan_type", ["entry_pass", "coach_pack"])
    .order("updated_at", { ascending: false })
    .limit(300);
  if (params.branchId) query = query.or(`branch_id.eq.${params.branchId},branch_id.is.null`);

  const result = await query;
  if (result.error) throw new BookingCommercialError(500, "INTERNAL_ERROR", result.error.message);

  return ((result.data || []) as PackagePlanRow[]).map(
    (row): ManagerPackageTemplateItem => ({
      id: row.id,
      tenantId: row.tenant_id,
      branchId: row.branch_id,
      code: row.code,
      name: row.name,
      description: row.description,
      planType: row.plan_type === "coach_pack" ? "coach_pack" : "entry_pass",
      fulfillmentKind: "entry_pass",
      totalSessions: Math.max(1, Number(row.default_quantity ?? 1)),
      validDays: row.default_duration_days,
      priceAmount: toNumber(row.price_amount),
      serviceScope: parseServiceScope(row.service_scope),
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );
}

export async function listManagerMemberPackages(params: {
  supabase: SupabaseClient;
  tenantId: string;
  branchId?: string | null;
}) {
  let passesQuery = params.supabase
    .from("entry_passes")
    .select("id, tenant_id, branch_id, member_id, member_plan_contract_id, plan_catalog_id, remaining, reserved_sessions, total_sessions, expires_at, status, created_at")
    .eq("tenant_id", params.tenantId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (params.branchId) {
    passesQuery = passesQuery.or(`branch_id.eq.${params.branchId},branch_id.is.null`);
  }
  const passesResult = await passesQuery;
  if (passesResult.error) throw new BookingCommercialError(500, "INTERNAL_ERROR", passesResult.error.message);

  const passRows = (passesResult.data || []) as EntryPassRow[];
  const memberIds = Array.from(new Set(passRows.map((item) => item.member_id)));
  const branchIds = Array.from(new Set(passRows.map((item) => item.branch_id).filter(Boolean))) as string[];
  const planIds = Array.from(new Set(passRows.map((item) => item.plan_catalog_id).filter(Boolean))) as string[];

  const [membersResult, branchesResult, plansResult] = await Promise.all([
    memberIds.length
      ? params.supabase.from("members").select("id, full_name, phone, store_id").eq("tenant_id", params.tenantId).in("id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length
      ? params.supabase.from("branches").select("id, name").eq("tenant_id", params.tenantId).in("id", branchIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? params.supabase.from("member_plan_catalog").select("id, name, code").eq("tenant_id", params.tenantId).in("id", planIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (membersResult.error) throw new BookingCommercialError(500, "INTERNAL_ERROR", membersResult.error.message);
  if (branchesResult.error) throw new BookingCommercialError(500, "INTERNAL_ERROR", branchesResult.error.message);
  if (plansResult.error) throw new BookingCommercialError(500, "INTERNAL_ERROR", plansResult.error.message);

  const memberMap = new Map<string, { full_name: string; phone: string | null; store_id: string | null }>();
  for (const member of (membersResult.data || []) as Array<{ id: string; full_name: string; phone: string | null; store_id: string | null }>) {
    memberMap.set(member.id, member);
  }
  const branchMap = new Map<string, string>();
  for (const branch of (branchesResult.data || []) as Array<{ id: string; name: string }>) {
    branchMap.set(branch.id, branch.name);
  }
  const planMap = new Map<string, { name: string; code: string | null }>();
  for (const plan of (plansResult.data || []) as Array<{ id: string; name: string; code: string | null }>) {
    planMap.set(plan.id, { name: plan.name, code: plan.code });
  }

  return passRows.map(
    (pass): ManagerMemberPackageItem => ({
      id: pass.id,
      memberId: pass.member_id,
      memberName: memberMap.get(pass.member_id)?.full_name || "Unknown member",
      memberPhone: memberMap.get(pass.member_id)?.phone || null,
      branchId: pass.branch_id || memberMap.get(pass.member_id)?.store_id || null,
      branchName: branchMap.get(pass.branch_id || memberMap.get(pass.member_id)?.store_id || "") || null,
      packageName: planMap.get(pass.plan_catalog_id || "")?.name || "Package",
      packageCode: planMap.get(pass.plan_catalog_id || "")?.code || null,
      remainingSessions: toNumber(pass.remaining),
      reservedSessions: toNumber(pass.reserved_sessions),
      totalSessions: pass.total_sessions === null || pass.total_sessions === undefined ? null : toNumber(pass.total_sessions),
      purchasedAt: pass.created_at || null,
      expiresAt: pass.expires_at,
      status: pass.status || "active",
    }),
  );
}

export function mapBookingCommercialSnapshot(row: {
  booking_payment_mode?: string | null;
  payment_status?: string | null;
  final_amount?: number | string | null;
  outstanding_amount?: number | string | null;
  deposit_required_amount?: number | string | null;
  deposit_paid_amount?: number | string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  payment_updated_at?: string | null;
  entry_pass_id?: string | null;
  member_plan_contract_id?: string | null;
  package_sessions_reserved?: number | string | null;
  package_sessions_consumed?: number | string | null;
  package_name?: string | null;
}): BookingCommercialSnapshot {
  return {
    paymentMode: normalizePaymentMode(row.booking_payment_mode),
    paymentStatus: (row.payment_status || "unpaid") as BookingCommercialPaymentStatus,
    finalAmount: toNumber(row.final_amount),
    outstandingAmount: toNumber(row.outstanding_amount),
    depositRequiredAmount: toNumber(row.deposit_required_amount),
    depositPaidAmount: toNumber(row.deposit_paid_amount),
    paymentMethod: row.payment_method || null,
    paymentReference: row.payment_reference || null,
    paymentUpdatedAt: row.payment_updated_at || null,
    entryPassId: row.entry_pass_id || null,
    contractId: row.member_plan_contract_id || null,
    packageSessionsReserved: toNumber(row.package_sessions_reserved),
    packageSessionsConsumed: toNumber(row.package_sessions_consumed),
    packageName: row.package_name || null,
  };
}
