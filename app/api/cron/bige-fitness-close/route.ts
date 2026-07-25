import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const header = request.headers.get("authorization") || "";
  return Boolean(secret && header === `Bearer ${secret}`);
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nextDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const businessDate = taipeiDate();
  const start = `${businessDate}T00:00:00+08:00`;
  const end = `${nextDate(businessDate)}T00:00:00+08:00`;
  const branchesResult = await admin
    .from("branches")
    .select("id, tenant_id")
    .eq("is_active", true)
    .limit(1000);
  if (branchesResult.error) {
    return NextResponse.json({ error: branchesResult.error.message }, { status: 500 });
  }

  let created = 0;
  const errors: string[] = [];
  for (const branch of branchesResult.data || []) {
    const bookingsResult = await admin
      .from("bookings")
      .select("id, operation_kind, status")
      .eq("tenant_id", branch.tenant_id)
      .eq("branch_id", branch.id)
      .eq("is_bige_schedule", true)
      .gte("starts_at", start)
      .lt("starts_at", end);
    if (bookingsResult.error) {
      errors.push(`${branch.id}:${bookingsResult.error.message}`);
      continue;
    }
    const rows = bookingsResult.data || [];
    const snapshot = {
      businessDate,
      generatedAt: new Date().toISOString(),
      total: rows.length,
      completed: rows.filter((row) => row.status === "completed").length,
      cancelled: rows.filter((row) => row.status === "cancelled").length,
      noShow: rows.filter((row) => row.status === "no_show").length,
      pending: rows.filter((row) => ["pending", "confirmed", "booked", "checked_in"].includes(row.status)).length,
      trialCompleted: rows.filter(
        (row) => row.operation_kind === "trial" && row.status === "completed",
      ).length,
      ptCompleted: rows.filter(
        (row) => row.operation_kind === "pt" && row.status === "completed",
      ).length,
    };
    const closureResult = await admin
      .from("bige_daily_closures")
      .upsert(
        {
          tenant_id: branch.tenant_id,
          branch_id: branch.id,
          business_date: businessDate,
          status: "pending",
          snapshot,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,branch_id,business_date" },
      )
      .select("id")
      .single();
    if (closureResult.error) {
      errors.push(`${branch.id}:${closureResult.error.message}`);
      continue;
    }
    await admin.from("bige_daily_closure_history").insert({
      tenant_id: branch.tenant_id,
      closure_id: closureResult.data.id,
      action: "created",
      reason: "scheduled_23_00_generation",
      snapshot,
      actor_id: null,
    });
    created += 1;
  }

  return NextResponse.json({ ok: errors.length === 0, businessDate, created, errors });
}
