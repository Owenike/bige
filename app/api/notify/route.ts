import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";
import { sendNotification } from "../../../lib/integrations/notify";

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "platform_admin"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const channel = body?.channel === "line" || body?.channel === "sms" || body?.channel === "email"
    ? body.channel
    : null;
  const target = typeof body?.target === "string" ? body.target.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const memberId = typeof body?.memberId === "string" ? body.memberId : null;
  const templateKey = typeof body?.templateKey === "string" ? body.templateKey : null;
  const tenantId = auth.context.tenantId;

  if (!channel || !target || !message) {
    return NextResponse.json({ error: "channel, target, message are required" }, { status: 400 });
  }

  if (!tenantId && auth.context.role !== "platform_admin") {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }
  if (auth.context.role === "frontdesk" && auth.context.branchId) {
    if (!memberId) {
      return NextResponse.json({ error: "memberId is required for frontdesk notifications" }, { status: 400 });
    }
    const memberResult = await auth.supabase
      .from("members")
      .select("id, store_id")
      .eq("id", memberId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (memberResult.error || !memberResult.data) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    if (String(memberResult.data.store_id || "") !== auth.context.branchId) {
      return NextResponse.json({ error: "Forbidden member access for current branch" }, { status: 403 });
    }
  }

  const notifyResult = await sendNotification({ channel, target, message, templateKey });

  const { data: log } = await auth.supabase
    .from("notification_logs")
    .insert({
      tenant_id: tenantId,
      member_id: memberId,
      channel,
      target,
      template_key: templateKey,
      message,
      status: notifyResult.ok ? "sent" : "failed",
      provider_ref: notifyResult.providerRef,
      error_message: notifyResult.error,
      sent_at: notifyResult.ok ? new Date().toISOString() : null,
    })
    .select("id, status, provider_ref, error_message, sent_at")
    .maybeSingle();

  if (!notifyResult.ok) {
    return NextResponse.json(
      {
        accepted: false,
        error: notifyResult.error,
        log,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    accepted: true,
    log,
  });
}
