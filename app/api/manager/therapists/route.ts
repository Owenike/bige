import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";
import { resolveBranchTherapists } from "../../../../lib/therapist-scheduling";
import { mapBranchSummary, mapStorefrontServiceRow } from "../../../../lib/storefront";
import type { TherapistBlockItem, TherapistManagementPayload, TherapistRecurringSchedule } from "../../../../types/therapist-scheduling";

type BranchRow = {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
};

type ServiceRow = {
  id: string;
  branch_id: string | null;
  code: string;
  name: string;
  description: string | null;
  duration_minutes: number | null;
  pre_buffer_minutes: number | null;
  post_buffer_minutes: number | null;
  price_amount: number | string | null;
  requires_deposit: boolean | null;
  deposit_calculation_type: "fixed" | "percent" | null;
  deposit_value: number | string | null;
};

function isMissingSchemaObject(message: string | undefined, objectName: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = objectName.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target)) ||
    (lower.includes("column") && lower.includes(target) && lower.includes("does not exist"))
  );
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const branchFilter = new URL(request.url).searchParams.get("branchId");

  try {
    const [therapists, branchResult, servicesResult, scheduleResult, blockResult] = await Promise.all([
      resolveBranchTherapists({
        supabase: auth.supabase,
        tenantId: auth.context.tenantId,
        branchId: branchFilter || auth.context.branchId,
      }),
      auth.supabase
        .from("branches")
        .select("id, tenant_id, name, code, address, is_active")
        .eq("tenant_id", auth.context.tenantId)
        .order("created_at", { ascending: true }),
      auth.supabase
        .from("services")
        .select(
          "id, branch_id, code, name, description, duration_minutes, pre_buffer_minutes, post_buffer_minutes, price_amount, requires_deposit, deposit_calculation_type, deposit_value",
        )
        .eq("tenant_id", auth.context.tenantId)
        .eq("is_active", true)
        .is("deleted_at", null),
      auth.supabase
        .from("coach_recurring_schedules")
        .select("id, coach_id, branch_id, day_of_week, start_time, end_time, timezone, effective_from, effective_until, is_active, note, created_at, updated_at")
        .eq("tenant_id", auth.context.tenantId)
        .order("day_of_week", { ascending: true }),
      auth.supabase
        .from("coach_blocks")
        .select("id, coach_id, branch_id, starts_at, ends_at, reason, note, status, block_type, created_at, updated_at")
        .eq("tenant_id", auth.context.tenantId)
        .order("starts_at", { ascending: true })
        .limit(200),
    ]);

    if (branchResult.error) return NextResponse.json({ error: branchResult.error.message }, { status: 500 });

    let services: ServiceRow[] = [];
    if (servicesResult.error) {
      if (!isMissingSchemaObject(servicesResult.error.message, "pre_buffer_minutes")) {
        return NextResponse.json({ error: servicesResult.error.message }, { status: 500 });
      }
      const fallback = await auth.supabase
        .from("services")
        .select("id, branch_id, code, name, duration_minutes")
        .eq("tenant_id", auth.context.tenantId)
        .eq("is_active", true);
      if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 });
      services = ((fallback.data || []) as ServiceRow[]).map((item) => ({
        ...item,
        description: "",
        pre_buffer_minutes: 0,
        post_buffer_minutes: 0,
        price_amount: 0,
        requires_deposit: false,
        deposit_calculation_type: "fixed",
        deposit_value: 0,
      }));
    } else {
      services = (servicesResult.data || []) as ServiceRow[];
    }

    let schedules: TherapistRecurringSchedule[] = [];
    if (scheduleResult.error && !isMissingSchemaObject(scheduleResult.error.message, "coach_recurring_schedules")) {
      return NextResponse.json({ error: scheduleResult.error.message }, { status: 500 });
    }
    if (!scheduleResult.error) {
      schedules = ((scheduleResult.data || []) as any[]).map((row) => ({
        id: row.id,
        coachId: row.coach_id,
        branchId: row.branch_id,
        dayOfWeek: row.day_of_week,
        startTime: row.start_time,
        endTime: row.end_time,
        timezone: row.timezone,
        effectiveFrom: row.effective_from,
        effectiveUntil: row.effective_until,
        isActive: row.is_active,
        note: row.note,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    }

    let blocks: TherapistBlockItem[] = [];
    if (blockResult.error && !isMissingSchemaObject(blockResult.error.message, "block_type")) {
      return NextResponse.json({ error: blockResult.error.message }, { status: 500 });
    }
    if (!blockResult.error) {
      blocks = ((blockResult.data || []) as any[]).map((row) => ({
        id: row.id,
        coachId: row.coach_id,
        branchId: row.branch_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        reason: row.reason,
        note: row.note,
        status: row.status,
        blockType: row.block_type || "blocked",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    }

    const serviceSummaries = services.map((row) =>
      mapStorefrontServiceRow({
        ...row,
        description: row.description ?? "",
        pre_buffer_minutes: row.pre_buffer_minutes ?? 0,
        post_buffer_minutes: row.post_buffer_minutes ?? 0,
        price_amount: row.price_amount ?? 0,
        requires_deposit: row.requires_deposit ?? false,
        deposit_calculation_type: row.deposit_calculation_type ?? "fixed",
        deposit_value: row.deposit_value ?? 0,
      }),
    );
    const globalServiceNames = serviceSummaries.filter((item) => !services.find((row) => row.id === item.id)?.branch_id).map((item) => item.name);
    const enrichedTherapists = therapists.map((item) => ({
      ...item,
      serviceNames: Array.from(
        new Set(
          serviceSummaries
            .filter((service) => {
              const source = services.find((row) => row.id === service.id);
              return !source?.branch_id || item.branchIds.includes(source.branch_id);
            })
            .map((service) => service.name)
            .concat(globalServiceNames),
        ),
      ),
    }));

    const payload: TherapistManagementPayload = {
      therapists: enrichedTherapists,
      branches: ((branchResult.data || []) as BranchRow[]).map((row) => mapBranchSummary(row)),
      services: serviceSummaries,
      schedules,
      blocks,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load therapists" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const therapistId = typeof body?.therapistId === "string" ? body.therapistId.trim() : "";
  const primaryBranchId = typeof body?.primaryBranchId === "string" && body.primaryBranchId.trim() ? body.primaryBranchId.trim() : null;
  const branchIds = Array.isArray(body?.branchIds) ? body.branchIds.filter((item: unknown) => typeof item === "string" && item.trim()) : [];
  const isActive = typeof body?.isActive === "boolean" ? body.isActive : null;

  if (!therapistId) return NextResponse.json({ error: "therapistId is required" }, { status: 400 });

  const therapistResult = await auth.supabase
    .from("profiles")
    .select("id, role")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", therapistId)
    .in("role", ["coach", "therapist"])
    .maybeSingle();
  if (therapistResult.error) return NextResponse.json({ error: therapistResult.error.message }, { status: 500 });
  if (!therapistResult.data) return NextResponse.json({ error: "Therapist not found" }, { status: 404 });

  const uniqueBranchIds = Array.from(new Set((primaryBranchId ? [primaryBranchId] : []).concat(branchIds)));
  if (uniqueBranchIds.length > 0) {
    const branchResult = await auth.supabase
      .from("branches")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .in("id", uniqueBranchIds);
    if (branchResult.error) return NextResponse.json({ error: branchResult.error.message }, { status: 500 });
    const validIds = new Set((branchResult.data || []).map((item: { id: string }) => item.id));
    if (uniqueBranchIds.some((id) => !validIds.has(id))) {
      return NextResponse.json({ error: "Invalid branch assignment" }, { status: 400 });
    }
  }

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (primaryBranchId !== undefined) updatePayload.branch_id = primaryBranchId;
  if (typeof isActive === "boolean") updatePayload.is_active = isActive;

  const profileUpdate = await auth.supabase
    .from("profiles")
    .update(updatePayload)
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", therapistId)
    .select("id")
    .maybeSingle();
  if (profileUpdate.error) return NextResponse.json({ error: profileUpdate.error.message }, { status: 500 });

  const existingLinks = await auth.supabase
    .from("coach_branch_links")
    .select("branch_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("coach_id", therapistId);
  if (existingLinks.error && !isMissingSchemaObject(existingLinks.error.message, "coach_branch_links")) {
    return NextResponse.json({ error: existingLinks.error.message }, { status: 500 });
  }

  if (!existingLinks.error) {
    const currentIds = new Set((existingLinks.data || []).map((item: { branch_id: string }) => item.branch_id));
    const desiredIds = new Set(uniqueBranchIds);
    const deactivateIds = Array.from(currentIds).filter((id) => !desiredIds.has(id));
    const upserts = uniqueBranchIds.map((branchId) => ({
      tenant_id: auth.context.tenantId,
      coach_id: therapistId,
      branch_id: branchId,
      is_primary: branchId === primaryBranchId,
      is_active: true,
      created_by: auth.context.userId,
    }));

    if (upserts.length > 0) {
      const upsertResult = await auth.supabase.from("coach_branch_links").upsert(upserts, { onConflict: "tenant_id,coach_id,branch_id" });
      if (upsertResult.error) return NextResponse.json({ error: upsertResult.error.message }, { status: 500 });
    }
    if (deactivateIds.length > 0) {
      const deactivateResult = await auth.supabase
        .from("coach_branch_links")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("tenant_id", auth.context.tenantId)
        .eq("coach_id", therapistId)
        .in("branch_id", deactivateIds);
      if (deactivateResult.error) return NextResponse.json({ error: deactivateResult.error.message }, { status: 500 });
    }
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "therapist_update",
    target_type: "profile",
    target_id: therapistId,
    reason: "manager_update",
    payload: {
      primaryBranchId,
      branchIds: uniqueBranchIds,
      isActive,
    },
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
