import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

function buildDiffSummary(before: Record<string, unknown>, after: Record<string, unknown>) {
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changed = Array.from(keys)
    .map((key) => ({
      key,
      before: before[key] === undefined ? null : before[key],
      after: after[key] === undefined ? null : after[key],
    }))
    .filter((item) => JSON.stringify(item.before) !== JSON.stringify(item.after));
  return {
    changedCount: changed.length,
    changedKeys: changed.map((item) => item.key),
    changed: changed.slice(0, 20),
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const tenantId = new URL(request.url).searchParams.get("tenantId");

  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("feature_flags")
    .select("id, tenant_id, key, enabled, updated_at")
    .eq("tenant_id", tenantId)
    .order("key", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const enabled = Boolean(body?.enabled);

  if (!tenantId || !key) {
    return NextResponse.json({ error: "tenantId and key are required" }, { status: 400 });
  }

  const beforeResult = await auth.supabase
    .from("feature_flags")
    .select("id, tenant_id, key, enabled, updated_at")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .maybeSingle();
  if (beforeResult.error) return NextResponse.json({ error: beforeResult.error.message }, { status: 500 });
  const before = beforeResult.data || null;

  const { data, error } = await auth.supabase
    .from("feature_flags")
    .upsert({ tenant_id: tenantId, key, enabled, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,key" })
    .select("id, tenant_id, key, enabled, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const after = data || null;
  const action = enabled ? "feature_flag_enabled" : "feature_flag_disabled";
  const diffSummary = buildDiffSummary(before || {}, after || {});

  await auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: auth.context.userId,
    action,
    target_type: "feature_flag",
    target_id: key,
    reason: null,
    payload: { key, enabled, before, after, diffSummary },
  });

  return NextResponse.json({ flag: data });
}

export async function DELETE(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const tenantId = params.get("tenantId") || "";
  const key = params.get("key") || "";

  if (!tenantId || !key) {
    return NextResponse.json({ error: "tenantId and key are required" }, { status: 400 });
  }

  const beforeResult = await auth.supabase
    .from("feature_flags")
    .select("id, tenant_id, key, enabled, updated_at")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .maybeSingle();
  if (beforeResult.error) return NextResponse.json({ error: beforeResult.error.message }, { status: 500 });
  const before = beforeResult.data || null;

  const { error } = await auth.supabase
    .from("feature_flags")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("key", key);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const diffSummary = buildDiffSummary(before || {}, {});

  await auth.supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: auth.context.userId,
    action: "feature_flag_deleted",
    target_type: "feature_flag",
    target_id: key,
    reason: null,
    payload: { key, before, after: null, diffSummary },
  });

  return NextResponse.json({ ok: true });
}
