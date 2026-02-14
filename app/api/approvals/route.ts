import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Invalid tenant context" }, { status: 400 });
  }

  const params = new URL(request.url).searchParams;
  const status = params.get("status") || "pending";
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 30)));

  let query = auth.supabase
    .from("high_risk_action_requests")
    .select("id, action, target_type, target_id, reason, status, decision_note, requested_by, resolved_by, created_at, resolved_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") query = query.eq("status", status);
  if (auth.context.role === "frontdesk") query = query.eq("requested_by", auth.context.userId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
