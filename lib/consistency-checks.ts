import type { SupabaseClient } from "@supabase/supabase-js";
import path from "path";
import { promises as fs } from "fs";

const REQUIRED_MIGRATIONS = [
  "20260305123000_tenant_subscription_lifecycle.sql",
  "20260305143000_staff_account_permissions.sql",
  "20260306103000_member_plan_contract_lifecycle.sql",
  "20260306203000_phase55_stability_hardening.sql",
  "20260307110000_phase6_shift_reconciliation.sql",
  "20260307143000_phase6b_unreconciled_cash_adjustment.sql",
  "20260307193000_phase7_in_app_notifications.sql",
  "20260308103000_phase8_crm_funnel.sql",
  "20260308133000_phase9_opportunities.sql",
  "20260308170000_phase10_scheduled_dispatch.sql",
  "20260309100000_phase12_external_notification_channels.sql",
] as const;

const REQUIRED_TABLES = [
  "tenants",
  "saas_plans",
  "tenant_subscriptions",
  "profiles",
  "members",
  "orders",
  "payments",
  "subscriptions",
  "entry_passes",
  "member_plan_catalog",
  "member_plan_contracts",
  "member_plan_ledger",
  "session_redemptions",
  "operation_idempotency_keys",
  "in_app_notifications",
  "crm_leads",
  "crm_lead_followups",
  "crm_opportunities",
  "crm_opportunity_logs",
  "notification_job_runs",
  "notification_deliveries",
] as const;

const REQUIRED_COLUMNS: Record<string, string[]> = {
  tenant_subscriptions: ["tenant_id", "status", "starts_at", "ends_at", "grace_ends_at", "is_current"],
  profiles: ["role", "is_active", "tenant_id", "branch_id", "invited_by", "last_login_at"],
  member_plan_contracts: ["member_id", "plan_catalog_id", "status", "remaining_sessions", "source_order_id"],
  member_plan_ledger: ["member_id", "contract_id", "source_type", "delta_sessions", "reference_type"],
  session_redemptions: ["member_id", "pass_id", "member_plan_contract_id", "redeemed_kind"],
  operation_idempotency_keys: ["tenant_id", "operation_key", "status", "response"],
  in_app_notifications: ["recipient_user_id", "recipient_role", "status", "severity", "event_type", "title", "message"],
  crm_leads: ["tenant_id", "branch_id", "owner_staff_id", "status", "trial_status", "updated_at"],
  crm_lead_followups: ["tenant_id", "lead_id", "follow_up_type", "created_by", "created_at"],
  crm_opportunities: ["tenant_id", "type", "status", "owner_staff_id", "priority", "dedupe_key", "source_ref_type", "source_ref_id"],
  crm_opportunity_logs: ["tenant_id", "opportunity_id", "action", "created_by", "created_at"],
  notification_job_runs: ["job_type", "trigger_mode", "status", "started_at", "finished_at", "affected_count", "error_count"],
  notification_deliveries: [
    "channel",
    "status",
    "attempts",
    "last_attempt_at",
    "next_retry_at",
    "error_code",
    "error_message",
    "provider_message_id",
    "provider_response",
  ],
};

const REQUIRED_INDEXES = [
  "notification_deliveries_dedupe_idx",
  "notification_deliveries_status_retry_idx",
  "notification_deliveries_tenant_status_idx",
  "notification_deliveries_channel_status_idx",
  "notification_job_runs_created_idx",
  "notification_job_runs_tenant_type_created_idx",
] as const;

const API_CONTRACT_SCAN_FILES = [
  "app/api/platform/billing/route.ts",
  "app/api/platform/subscriptions/route.ts",
  "app/api/platform/subscriptions/[tenantId]/route.ts",
  "app/api/manager/staff/route.ts",
  "app/api/manager/members/route.ts",
  "app/api/member/entitlements/route.ts",
  "app/api/member/bookings/route.ts",
  "app/api/bookings/route.ts",
  "app/api/orders/route.ts",
  "app/api/payments/route.ts",
  "app/api/approvals/route.ts",
  "app/api/approvals/[id]/decision/route.ts",
  "app/api/orders/[id]/void/route.ts",
  "app/api/payments/[id]/refund/route.ts",
  "app/api/session-redemptions/route.ts",
  "app/api/entry/verify/route.ts",
  "app/api/frontdesk/invoices/route.ts",
  "app/api/notifications/route.ts",
  "app/api/notifications/sweep/route.ts",
  "app/api/jobs/run/route.ts",
  "app/api/platform/notifications/ops/route.ts",
  "app/api/platform/notifications/dispatch/route.ts",
  "app/api/manager/notifications/ops/route.ts",
] as const;

async function readExistingSource(filePath: string) {
  const abs = path.join(process.cwd(), filePath);
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

function countBy<T extends string>(rows: Array<{ key: T }>) {
  const map = new Map<T, number>();
  for (const row of rows) {
    map.set(row.key, (map.get(row.key) || 0) + 1);
  }
  return map;
}

type MigrationHistoryLoad = {
  rows: Array<{ version?: string; name?: string }>;
  error: string | null;
  unavailable: boolean;
};

async function loadMigrationHistory(supabase: SupabaseClient): Promise<MigrationHistoryLoad> {
  const direct = await supabase.schema("supabase_migrations").from("schema_migrations").select("version, name");
  if (!direct.error) {
    return {
      rows: (direct.data || []) as Array<{ version?: string; name?: string }>,
      error: null,
      unavailable: false,
    };
  }
  const message = direct.error.message || "migration_history_unavailable";
  const unavailable = direct.error.code === "PGRST106" || message.toLowerCase().includes("invalid schema");
  return {
    rows: [],
    error: message,
    unavailable,
  };
}

function migrationVersionFromName(name: string) {
  const match = /^(\d{14,})/.exec(name);
  return match?.[1] || null;
}

async function tableAndColumnReadiness(supabase: SupabaseClient) {
  const missingTables: string[] = [];
  const missingColumns: Record<string, string[]> = {};
  const probeErrors: string[] = [];

  const relationMissing = (message: string) => {
    const text = message.toLowerCase();
    return text.includes("does not exist") || text.includes("relation") || text.includes("undefined table");
  };
  const columnMissing = (message: string, column: string) => {
    const text = message.toLowerCase();
    return (
      text.includes(`'${column.toLowerCase()}'`) ||
      text.includes(`"${column.toLowerCase()}"`) ||
      text.includes("column") ||
      text.includes("schema cache")
    );
  };

  for (const table of REQUIRED_TABLES) {
    const required = REQUIRED_COLUMNS[table] || [];
    const tableProbe = await supabase.from(table).select("id").limit(1);
    if (tableProbe.error) {
      const message = tableProbe.error.message || "";
      if (relationMissing(message)) {
        missingTables.push(table);
        if (required.length > 0) missingColumns[table] = [...required];
        continue;
      }
      const fallbackProbe = await supabase.from(table).select("*").limit(1);
      if (fallbackProbe.error) {
        const fallbackMessage = fallbackProbe.error.message || "";
        if (relationMissing(fallbackMessage)) {
          missingTables.push(table);
          if (required.length > 0) missingColumns[table] = [...required];
          continue;
        }
        probeErrors.push(`table:${table}:${fallbackMessage}`);
        continue;
      }
    }

    if (required.length === 0) continue;
    const missingForTable: string[] = [];
    for (const column of required) {
      const colProbe = await supabase.from(table).select(column).limit(1);
      if (!colProbe.error) continue;
      const message = colProbe.error.message || "";
      if (relationMissing(message)) {
        missingTables.push(table);
        missingForTable.push(...required);
        break;
      }
      if (columnMissing(message, column)) {
        missingForTable.push(column);
      } else {
        probeErrors.push(`column:${table}.${column}:${message}`);
      }
    }
    if (missingForTable.length > 0) {
      missingColumns[table] = Array.from(new Set(missingForTable));
    }
  }

  return {
    ok: missingTables.length === 0 && Object.keys(missingColumns).length === 0 && probeErrors.length === 0,
    error: probeErrors.length > 0 ? probeErrors[0] : null,
    missingTables,
    missingColumns,
  };
}

async function indexReadiness(supabase: SupabaseClient) {
  const probe = await supabase
    .schema("pg_catalog")
    .from("pg_indexes")
    .select("schemaname, indexname")
    .eq("schemaname", "public");

  if (probe.error) {
    return {
      ok: true,
      status: "unknown" as const,
      error: probe.error.message,
      missingIndexes: [] as string[],
      notes: ["pg_catalog.pg_indexes not accessible via PostgREST in current environment."],
    };
  }

  const indexNames = new Set(
    (probe.data || [])
      .map((row) => String((row as { indexname?: string }).indexname || ""))
      .filter((name) => name.length > 0),
  );
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexNames.has(name));
  return {
    ok: missingIndexes.length === 0,
    status: "checked" as const,
    error: null as string | null,
    missingIndexes: [...missingIndexes],
    notes: [] as string[],
  };
}

async function tenantSubscriptionConsistency(supabase: SupabaseClient, tenantIds?: string[]) {
  let tenantsQuery = supabase.from("tenants").select("id, status");
  if (tenantIds && tenantIds.length > 0) {
    tenantsQuery = tenantsQuery.in("id", tenantIds);
  }
  const tenantsResult = await tenantsQuery.limit(5000);
  if (tenantsResult.error) {
    return {
      error: tenantsResult.error.message,
      missingCurrent: [] as string[],
      invalidCurrentStatus: [] as Array<{ tenantId: string; status: string | null }>,
    };
  }
  const tenants = (tenantsResult.data || []) as Array<{ id: string; status: string | null }>;
  const ids = tenants.map((item) => item.id);
  if (ids.length === 0) {
    return { error: null as string | null, missingCurrent: [] as string[], invalidCurrentStatus: [] as Array<{ tenantId: string; status: string | null }> };
  }

  const currentResult = await supabase
    .from("tenant_subscriptions")
    .select("tenant_id, status, ends_at, grace_ends_at")
    .in("tenant_id", ids)
    .eq("is_current", true)
    .limit(5000);
  if (currentResult.error) {
    return {
      error: currentResult.error.message,
      missingCurrent: [] as string[],
      invalidCurrentStatus: [] as Array<{ tenantId: string; status: string | null }>,
    };
  }

  const rows = (currentResult.data || []) as Array<{
    tenant_id: string;
    status: string | null;
    ends_at: string | null;
    grace_ends_at: string | null;
  }>;
  const byTenant = new Map<string, { status: string | null; endsAt: string | null; graceEndsAt: string | null }>();
  for (const row of rows) {
    if (!byTenant.has(row.tenant_id)) {
      byTenant.set(row.tenant_id, {
        status: row.status ?? null,
        endsAt: row.ends_at ?? null,
        graceEndsAt: row.grace_ends_at ?? null,
      });
    }
  }

  const nowMs = Date.now();
  const invalidCurrentStatus: Array<{ tenantId: string; status: string | null }> = [];
  const missingCurrent: string[] = [];

  for (const tenant of tenants) {
    const current = byTenant.get(tenant.id);
    if (!current) {
      missingCurrent.push(tenant.id);
      continue;
    }
    if (!current.status) {
      invalidCurrentStatus.push({ tenantId: tenant.id, status: current.status });
      continue;
    }
    if (current.status === "active" || current.status === "trial" || current.status === "grace") {
      const endsMs = current.endsAt ? new Date(current.endsAt).getTime() : null;
      const graceMs = current.graceEndsAt ? new Date(current.graceEndsAt).getTime() : null;
      const expired =
        (graceMs !== null && graceMs < nowMs) ||
        (graceMs === null && endsMs !== null && endsMs < nowMs);
      if (expired) invalidCurrentStatus.push({ tenantId: tenant.id, status: current.status });
    }
  }

  return {
    error: null as string | null,
    missingCurrent,
    invalidCurrentStatus,
  };
}

async function profileScopeConsistency(supabase: SupabaseClient, tenantIds?: string[]) {
  let query = supabase
    .from("profiles")
    .select("id, role, tenant_id, branch_id, is_active")
    .in("role", ["platform_admin", "manager", "supervisor", "branch_manager", "frontdesk", "coach", "sales", "member"])
    .limit(10000);
  if (tenantIds && tenantIds.length > 0) {
    query = query.or(`tenant_id.in.(${tenantIds.join(",")}),role.eq.platform_admin`);
  }
  const result = await query;
  if (result.error) {
    return {
      error: result.error.message,
      missingTenantScope: [] as string[],
      frontdeskMissingBranch: [] as string[],
      inactiveButPrivileged: [] as string[],
    };
  }
  const rows = (result.data || []) as Array<{
    id: string;
    role: string | null;
    tenant_id: string | null;
    branch_id: string | null;
    is_active: boolean | null;
  }>;

  const missingTenantScope: string[] = [];
  const frontdeskMissingBranch: string[] = [];
  const inactiveButPrivileged: string[] = [];

  for (const row of rows) {
    const role = row.role || "";
    if (role !== "platform_admin" && !row.tenant_id) missingTenantScope.push(row.id);
    if (role === "frontdesk" && !row.branch_id) frontdeskMissingBranch.push(row.id);
    if (
      (role === "platform_admin" || role === "manager" || role === "supervisor" || role === "branch_manager") &&
      row.is_active === false
    ) {
      inactiveButPrivileged.push(row.id);
    }
  }

  return {
    error: null as string | null,
    missingTenantScope,
    frontdeskMissingBranch,
    inactiveButPrivileged,
  };
}

async function entitlementConsistency(supabase: SupabaseClient, tenantIds?: string[]) {
  let ordersQuery = supabase
    .from("orders")
    .select("id, tenant_id, status, member_id")
    .in("status", ["paid", "refunded", "cancelled"])
    .limit(10000);
  let contractsQuery = supabase
    .from("member_plan_contracts")
    .select("id, tenant_id, member_id, source_order_id, source_payment_id, status, remaining_uses, remaining_sessions")
    .limit(10000);
  let redemptionsQuery = supabase
    .from("session_redemptions")
    .select("id, tenant_id, member_id, pass_id, member_plan_contract_id, redeemed_kind")
    .limit(10000);
  let passesQuery = supabase
    .from("entry_passes")
    .select("id, tenant_id, member_id, member_plan_contract_id, remaining, status")
    .limit(10000);
  let paymentsQuery = supabase
    .from("payments")
    .select("id, tenant_id, order_id, status")
    .limit(10000);
  let auditQuery = supabase
    .from("audit_logs")
    .select("id, tenant_id, action, target_type, target_id, created_at")
    .in("action", ["order_fulfilled", "member_entitlements_reversed", "session_redeemed", "payment_recorded"])
    .limit(15000);

  if (tenantIds && tenantIds.length > 0) {
    ordersQuery = ordersQuery.in("tenant_id", tenantIds);
    contractsQuery = contractsQuery.in("tenant_id", tenantIds);
    redemptionsQuery = redemptionsQuery.in("tenant_id", tenantIds);
    passesQuery = passesQuery.in("tenant_id", tenantIds);
    paymentsQuery = paymentsQuery.in("tenant_id", tenantIds);
    auditQuery = auditQuery.in("tenant_id", tenantIds);
  }

  const [ordersResult, contractsResult, redemptionsResult, passesResult, paymentsResult, auditResult] = await Promise.all([
    ordersQuery,
    contractsQuery,
    redemptionsQuery,
    passesQuery,
    paymentsQuery,
    auditQuery,
  ]);
  if (ordersResult.error || contractsResult.error || redemptionsResult.error || passesResult.error || paymentsResult.error || auditResult.error) {
    return {
      error:
        ordersResult.error?.message ||
        contractsResult.error?.message ||
        redemptionsResult.error?.message ||
        passesResult.error?.message ||
        paymentsResult.error?.message ||
        auditResult.error?.message ||
        "consistency_query_failed",
      paidOrdersWithoutFulfillmentAudit: [] as string[],
      contractsMissingOrderRef: [] as string[],
      passRedemptionsWithoutContract: [] as string[],
      negativeBalances: [] as string[],
      refundedOrdersWithoutReversalAudit: [] as string[],
      paidOrdersWithoutPayment: [] as string[],
    };
  }

  const orders = (ordersResult.data || []) as Array<{ id: string; tenant_id: string; status: string | null; member_id: string | null }>;
  const contracts = (contractsResult.data || []) as Array<{
    id: string;
    tenant_id: string;
    member_id: string;
    source_order_id: string | null;
    source_payment_id: string | null;
    status: string | null;
    remaining_uses: number | null;
    remaining_sessions: number | null;
  }>;
  const redemptions = (redemptionsResult.data || []) as Array<{
    id: string;
    tenant_id: string;
    member_id: string;
    pass_id: string | null;
    member_plan_contract_id: string | null;
    redeemed_kind: string | null;
  }>;
  const passes = (passesResult.data || []) as Array<{ id: string; tenant_id: string; member_id: string; member_plan_contract_id: string | null; remaining: number | null; status: string | null }>;
  const payments = (paymentsResult.data || []) as Array<{ id: string; tenant_id: string; order_id: string | null; status: string | null }>;
  const audits = (auditResult.data || []) as Array<{ id: string; tenant_id: string; action: string; target_type: string; target_id: string | null }>;

  const paidOrders = orders.filter((item) => item.status === "paid");
  const refundedOrCancelledOrders = orders.filter((item) => item.status === "refunded" || item.status === "cancelled");
  const orderIds = new Set(orders.map((item) => item.id));
  const paidOrderIdsWithPayments = new Set(
    payments.filter((p) => p.status === "paid" && p.order_id).map((p) => String(p.order_id)),
  );
  const fulfilledOrderIds = new Set(
    audits.filter((a) => a.action === "order_fulfilled" && a.target_type === "order" && a.target_id).map((a) => String(a.target_id)),
  );
  const reversalOrderIds = new Set(
    audits
      .filter((a) => a.action === "member_entitlements_reversed" && a.target_type === "order" && a.target_id)
      .map((a) => String(a.target_id)),
  );

  const paidOrdersWithoutFulfillmentAudit = paidOrders
    .filter((order) => !fulfilledOrderIds.has(order.id))
    .map((order) => order.id);
  const paidOrdersWithoutPayment = paidOrders
    .filter((order) => !paidOrderIdsWithPayments.has(order.id))
    .map((order) => order.id);
  const refundedOrdersWithoutReversalAudit = refundedOrCancelledOrders
    .filter((order) => !reversalOrderIds.has(order.id))
    .map((order) => order.id);

  const contractsMissingOrderRef = contracts
    .filter((contract) => contract.source_order_id && !orderIds.has(contract.source_order_id))
    .map((contract) => contract.id);

  const passRedemptionsWithoutContract = redemptions
    .filter((row) => row.redeemed_kind === "pass" && !row.member_plan_contract_id)
    .map((row) => row.id);

  const negativeBalances = [
    ...contracts
      .filter(
        (contract) =>
          (typeof contract.remaining_uses === "number" && contract.remaining_uses < 0) ||
          (typeof contract.remaining_sessions === "number" && contract.remaining_sessions < 0),
      )
      .map((contract) => `contract:${contract.id}`),
    ...passes
      .filter((pass) => typeof pass.remaining === "number" && pass.remaining < 0)
      .map((pass) => `entry_pass:${pass.id}`),
  ];

  return {
    error: null as string | null,
    paidOrdersWithoutFulfillmentAudit,
    contractsMissingOrderRef,
    passRedemptionsWithoutContract,
    negativeBalances,
    refundedOrdersWithoutReversalAudit,
    paidOrdersWithoutPayment,
  };
}

async function monitoringSummary(supabase: SupabaseClient, tenantIds?: string[]) {
  let query = supabase
    .from("audit_logs")
    .select("action, created_at")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(30000);
  if (tenantIds && tenantIds.length > 0) query = query.in("tenant_id", tenantIds);
  const result = await query;
  if (result.error) {
    return {
      error: result.error.message,
      actionCounts: {} as Record<string, number>,
      criticalEvents: [] as Array<{ action: string; count: number }>,
    };
  }
  const rows = (result.data || []) as Array<{ action: string }>;
  const counts = countBy(rows.map((row) => ({ key: row.action })));
  const actionCounts = Object.fromEntries(Array.from(counts.entries()).sort((a, b) => b[1] - a[1]));
  const criticalKeys = [
    "entitlement_fulfillment_failed",
    "member_entitlements_reversal_failed",
    "session_redemption_failed",
    "tenant_subscription_invalid_state",
    "cross_tenant_denied",
    "branch_scope_denied",
    "role_denied",
  ];
  const criticalEvents = criticalKeys
    .map((key) => ({ action: key, count: actionCounts[key] || 0 }))
    .filter((item) => item.count > 0);

  return {
    error: null as string | null,
    actionCounts,
    criticalEvents,
  };
}

async function apiContractAudit() {
  const results: Array<{
    path: string;
    compliant: boolean;
    level: "ok" | "warn";
    reason: string;
  }> = [];
  for (const relPath of API_CONTRACT_SCAN_FILES) {
    const source = await readExistingSource(relPath);
    if (!source) {
      results.push({
        path: relPath,
        compliant: false,
        level: "warn",
        reason: "file_not_found",
      });
      continue;
    }
    const usesApiSuccess = source.includes("apiSuccess(");
    const usesApiError = source.includes("apiError(");
    const hasLegacyDirectError = /NextResponse\.json\(\s*\{\s*error\s*:/.test(source);
    if (usesApiSuccess && (usesApiError || !hasLegacyDirectError)) {
      results.push({
        path: relPath,
        compliant: true,
        level: "ok",
        reason: "api_contract_ok",
      });
      continue;
    }
    if (usesApiSuccess && usesApiError && hasLegacyDirectError) {
      results.push({
        path: relPath,
        compliant: false,
        level: "warn",
        reason: "mixed_contract_response",
      });
      continue;
    }
    results.push({
      path: relPath,
      compliant: false,
      level: "warn",
      reason: "legacy_response_shape",
    });
  }
  const nonCompliant = results.filter((item) => !item.compliant).length;
  return {
    scanned: API_CONTRACT_SCAN_FILES.length,
    nonCompliant,
    items: results,
  };
}

export async function runPlatformConsistencyChecks(params: {
  supabase: SupabaseClient;
  tenantId?: string | null;
}) {
  const tenantIds = params.tenantId ? [params.tenantId] : undefined;
  const [migrationHistory, schemaReadiness, indexCheck, tenantChecks, profileChecks, entitlementChecks, monitoring, contractAudit] =
    await Promise.all([
      loadMigrationHistory(params.supabase),
      tableAndColumnReadiness(params.supabase),
      indexReadiness(params.supabase),
      tenantSubscriptionConsistency(params.supabase, tenantIds),
      profileScopeConsistency(params.supabase, tenantIds),
      entitlementConsistency(params.supabase, tenantIds),
      monitoringSummary(params.supabase, tenantIds),
      apiContractAudit(),
    ]);

  const appliedNames = new Set(migrationHistory.rows.map((row) => String(row.name || "")).filter((name) => name.length > 0));
  const appliedVersions = new Set(
    migrationHistory.rows.map((row) => String(row.version || "")).filter((version) => version.length > 0),
  );
  const migrationHistoryAvailable =
    migrationHistory.rows.length > 0 || (!migrationHistory.unavailable && !migrationHistory.error);
  const missingMigrations = migrationHistoryAvailable
    ? REQUIRED_MIGRATIONS.filter((name) => {
        if (appliedNames.has(name)) return false;
        const requiredVersion = migrationVersionFromName(name);
        return !(requiredVersion && appliedVersions.has(requiredVersion));
      })
    : schemaReadiness.ok
      ? []
      : [...REQUIRED_MIGRATIONS];

  return {
    generatedAt: new Date().toISOString(),
    migration: {
      required: [...REQUIRED_MIGRATIONS],
      missing: missingMigrations,
      historyAvailable: migrationHistoryAvailable,
      historyError: migrationHistory.error,
      schemaReadiness: {
        ...schemaReadiness,
        indexReadiness: indexCheck,
      },
      notes: [
        "app_role enum value checks still require SQL-level manual verification on production DB.",
        "Backfill correctness should be validated with tenant_subscriptions current row sampling after migration apply.",
        migrationHistoryAvailable
          ? "Migration history loaded from supabase_migrations.schema_migrations."
          : "Migration history not exposed via PostgREST; migration readiness inferred from schema checks.",
      ],
    },
    consistency: {
      tenant: tenantChecks,
      profile: profileChecks,
      entitlement: entitlementChecks,
    },
    monitoring,
    apiContract: contractAudit,
  };
}

export async function runManagerConsistencyChecks(params: {
  supabase: SupabaseClient;
  tenantId: string;
}) {
  const [tenantChecks, profileChecks, entitlementChecks, monitoring] = await Promise.all([
    tenantSubscriptionConsistency(params.supabase, [params.tenantId]),
    profileScopeConsistency(params.supabase, [params.tenantId]),
    entitlementConsistency(params.supabase, [params.tenantId]),
    monitoringSummary(params.supabase, [params.tenantId]),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    tenantId: params.tenantId,
    consistency: {
      tenant: tenantChecks,
      profile: profileChecks,
      entitlement: entitlementChecks,
    },
    monitoring,
  };
}
