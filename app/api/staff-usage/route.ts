import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth-context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type UsagePayload =
  | { action: "start"; path: string }
  | { action: "heartbeat" | "end"; sessionId: string };

function isMissingTable(message: string | undefined) {
  return Boolean(message && (message.includes("staff_page_sessions") || message.includes("schema cache")));
}

export async function POST(request: Request) {
  const auth = await requireProfile(
    ["platform_admin", "manager", "frontdesk", "coach", "therapist", "sales"],
    request,
  );
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return new NextResponse(null, { status: 204 });

  const payload = (await request.json().catch(() => null)) as UsagePayload | null;
  if (!payload || typeof payload.action !== "string") {
    return NextResponse.json({ message: "invalid_payload" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();

  if (payload.action === "start") {
    const path = typeof payload.path === "string" ? payload.path.slice(0, 500) : "";
    if (!path.startsWith("/")) {
      return NextResponse.json({ message: "invalid_path" }, { status: 400 });
    }
    const result = await admin
      .from("staff_page_sessions")
      .insert({
        tenant_id: auth.context.tenantId,
        profile_id: auth.context.userId,
        path,
        started_at: now.toISOString(),
        last_seen_at: now.toISOString(),
        user_agent: request.headers.get("user-agent")?.slice(0, 1000) || null,
      })
      .select("id")
      .single();
    if (result.error) {
      if (isMissingTable(result.error.message)) return new NextResponse(null, { status: 204 });
      return NextResponse.json({ message: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, data: { sessionId: result.data.id } });
  }

  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
  if (!sessionId) return NextResponse.json({ message: "invalid_session" }, { status: 400 });

  const current = await admin
    .from("staff_page_sessions")
    .select("id, started_at")
    .eq("id", sessionId)
    .eq("tenant_id", auth.context.tenantId)
    .eq("profile_id", auth.context.userId)
    .maybeSingle();
  if (current.error) {
    if (isMissingTable(current.error.message)) return new NextResponse(null, { status: 204 });
    return NextResponse.json({ message: current.error.message }, { status: 500 });
  }
  if (!current.data) return new NextResponse(null, { status: 204 });

  const startedAt = new Date(current.data.started_at).getTime();
  const durationSeconds = Number.isFinite(startedAt)
    ? Math.max(0, Math.round((now.getTime() - startedAt) / 1000))
    : 0;
  const update = await admin
    .from("staff_page_sessions")
    .update({
      last_seen_at: now.toISOString(),
      duration_seconds: durationSeconds,
      ...(payload.action === "end" ? { ended_at: now.toISOString() } : {}),
    })
    .eq("id", sessionId)
    .eq("tenant_id", auth.context.tenantId)
    .eq("profile_id", auth.context.userId);
  if (update.error) return NextResponse.json({ message: update.error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
