import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function POST(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const passId = typeof body?.passId === "string" ? body.passId : "";
  const delta = Number(body?.delta ?? 0);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!passId || !Number.isFinite(delta) || delta === 0 || !reason || !auth.context.tenantId) {
    return NextResponse.json({ error: "passId, delta, reason are required" }, { status: 400 });
  }

  const { data: pass, error: passError } = await auth.supabase
    .from("entry_passes")
    .select("id, member_id, remaining")
    .eq("id", passId)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();

  if (passError || !pass) return NextResponse.json({ error: "Pass not found" }, { status: 404 });

  const currentRemaining = Number(pass.remaining ?? 0);
  const nextRemaining = Math.max(0, currentRemaining + delta);

  const { data, error } = await auth.supabase
    .from("entry_passes")
    .update({ remaining: nextRemaining, updated_at: new Date().toISOString() })
    .eq("id", passId)
    .eq("tenant_id", auth.context.tenantId)
    .select("id, member_id, remaining, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "pass_adjustment",
    target_type: "entry_pass",
    target_id: passId,
    reason,
    payload: { delta, previousRemaining: currentRemaining, nextRemaining },
  });

  return NextResponse.json({ pass: data });
}
