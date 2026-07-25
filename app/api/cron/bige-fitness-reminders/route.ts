import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const header = request.headers.get("authorization") || "";
  return Boolean(secret && header === `Bearer ${secret}`);
}

function taipeiDate(days = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const tomorrow = taipeiDate(1);
  const dayAfter = taipeiDate(2);
  const result = await admin
    .from("bookings")
    .select("id, tenant_id, reminder_status")
    .eq("is_bige_schedule", true)
    .eq("operation_kind", "trial")
    .gte("starts_at", `${tomorrow}T00:00:00+08:00`)
    .lt("starts_at", `${dayAfter}T00:00:00+08:00`)
    .in("status", ["pending", "confirmed", "booked", "checked_in"])
    .limit(5000);
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });

  const rows = result.data || [];
  const pendingRows = rows.filter((row) => !row.reminder_status);
  if (pendingRows.length > 0) {
    const update = await admin
      .from("bookings")
      .update({ reminder_status: "pending", updated_at: new Date().toISOString() })
      .in(
        "id",
        pendingRows.map((row) => row.id),
      );
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
  }

  const tenantCounts = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.tenant_id] = (counts[row.tenant_id] || 0) + 1;
    return counts;
  }, {});
  for (const [tenantId, count] of Object.entries(tenantCounts)) {
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: null,
      action: "fitness_trial_call_list_generated",
      target_type: "business_date",
      target_id: tomorrow,
      reason: "scheduled_09_00_generation",
      payload: { count },
    });
  }

  return NextResponse.json({ ok: true, businessDate: tomorrow, count: rows.length });
}
