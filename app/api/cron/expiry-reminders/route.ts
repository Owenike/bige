import { NextResponse } from "next/server";
import { sendNotificationWithFallback } from "../../../../lib/integrations/notify";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const token = request.headers.get("x-cron-secret") || "";
  return Boolean(secret && token && secret === token);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const { data: expiring, error } = await supabase
    .from("subscriptions")
    .select("id, tenant_id, member_id, valid_to, status")
    .eq("status", "active")
    .gte("valid_to", now.toISOString())
    .lte("valid_to", in3Days.toISOString())
    .order("valid_to", { ascending: true })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const subscriptions = expiring ?? [];
  const memberIds = Array.from(new Set(subscriptions.map((item) => String(item.member_id))));
  if (!memberIds.length) return NextResponse.json({ processed: 0, sent: 0, failed: 0 });

  const { data: members } = await supabase
    .from("members")
    .select("id, tenant_id, full_name, phone")
    .in("id", memberIds);

  const { data: identities } = await supabase
    .from("member_identities")
    .select("member_id, type, value")
    .in("member_id", memberIds);

  const membersById = new Map((members || []).map((m) => [String(m.id), m]));
  const identitiesByMember = new Map<string, Array<{ type: string; value: string }>>();
  (identities || []).forEach((row) => {
    const key = String(row.member_id);
    if (!identitiesByMember.has(key)) identitiesByMember.set(key, []);
    identitiesByMember.get(key)?.push({ type: String(row.type), value: String(row.value) });
  });

  let sent = 0;
  let failed = 0;
  for (const sub of subscriptions) {
    const memberId = String(sub.member_id);
    const member = membersById.get(memberId);
    const targets = identitiesByMember.get(memberId) || [];
    const smsTarget = targets.find((t) => t.type === "phone")?.value || member?.phone || "";
    const emailTarget = targets.find((t) => t.type === "email")?.value || "";
    const lineTarget = targets.find((t) => t.type === "line_user_id")?.value || "";
    const validTo = new Date(String(sub.valid_to)).toLocaleString();
    const msg = `Your membership will expire at ${validTo}. Please renew to keep access.`;

    const result = await sendNotificationWithFallback({
      channels: ["line", "email", "sms"],
      targets: {
        line: lineTarget,
        email: emailTarget,
        sms: smsTarget,
      },
      message: msg,
      templateKey: "membership_expiry_3d",
    });

    if (!result.attempts.length) continue;

    await supabase.from("notification_logs").insert(
      result.attempts.map((attempt) => ({
        tenant_id: member?.tenant_id || sub.tenant_id,
        member_id: memberId,
        channel: attempt.channel,
        target: attempt.target,
        template_key: "membership_expiry_3d",
        message: msg,
        status: attempt.ok ? "sent" : "failed",
        provider_ref: attempt.providerRef,
        error_message: attempt.error,
        sent_at: attempt.ok ? new Date().toISOString() : null,
      })),
    );

    if (result.ok) sent += 1;
    else failed += 1;
  }

  return NextResponse.json({
    processed: subscriptions.length,
    sent,
    failed,
  });
}
