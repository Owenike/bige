import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

type NotificationItem = {
  id: string;
  type: "booking_reminder" | "membership_expiry" | "pass_expiry" | "system_log";
  level: "info" | "warning";
  title: string;
  message: string;
  at: string;
  isRead: boolean;
  readAt: string | null;
};

type MemberContext = {
  memberId: string;
  memberName: string | null;
  tenantId: string;
  supabase: any;
};

function daysUntil(input: string) {
  const ms = new Date(input).getTime() - Date.now();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function tableMissing(message: string | undefined, tableName: string) {
  const text = (message || "").toLowerCase();
  return text.includes(`relation "${tableName.toLowerCase()}" does not exist`) || text.includes(`relation '${tableName.toLowerCase()}' does not exist`);
}

function parseNotificationIds(input: unknown) {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

async function loadMemberContext(request: Request): Promise<{ ok: true; value: MemberContext } | { ok: false; response: NextResponse }> {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return { ok: false, response: auth.response };
  if (!auth.context.tenantId) {
    return { ok: false, response: NextResponse.json({ error: "Tenant context is required" }, { status: 400 }) };
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id, full_name")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();
  if (memberResult.error || !memberResult.data) {
    return { ok: false, response: NextResponse.json({ error: "Member not found" }, { status: 404 }) };
  }

  return {
    ok: true,
    value: {
      memberId: String(memberResult.data.id),
      memberName: memberResult.data.full_name ? String(memberResult.data.full_name) : null,
      tenantId: auth.context.tenantId,
      supabase: auth.supabase,
    },
  };
}

export async function GET(request: Request) {
  const memberContext = await loadMemberContext(request);
  if (!memberContext.ok) return memberContext.response;
  const { memberId, memberName, tenantId, supabase } = memberContext.value;

  const nowIso = new Date().toISOString();
  const in24hIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const [bookingRes, subRes, passRes, notifyLogRes, notificationReadRes] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, service_name, starts_at, status")
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId)
      .in("status", ["booked", "checked_in"])
      .gte("starts_at", nowIso)
      .lte("starts_at", in24hIso)
      .order("starts_at", { ascending: true })
      .limit(5),
    supabase
      .from("subscriptions")
      .select("id, valid_to, status")
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId)
      .in("status", ["active", "paused"])
      .order("valid_to", { ascending: true })
      .limit(5),
    supabase
      .from("entry_passes")
      .select("id, pass_type, remaining, expires_at, status")
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId)
      .eq("status", "active")
      .order("expires_at", { ascending: true })
      .limit(10),
    supabase
      .from("notification_logs")
      .select("id, channel, template_key, status, error_message, created_at, sent_at")
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("member_notification_reads")
      .select("notification_id, read_at")
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId)
      .order("read_at", { ascending: false })
      .limit(1000),
  ]);

  if (bookingRes.error || subRes.error || passRes.error || notifyLogRes.error) {
    return NextResponse.json(
      {
        error: "Failed to load notifications",
        details: {
          bookings: bookingRes.error?.message || null,
          subscriptions: subRes.error?.message || null,
          passes: passRes.error?.message || null,
          notificationLogs: notifyLogRes.error?.message || null,
        },
      },
      { status: 500 },
    );
  }

  const readMap = new Map<string, string>();
  if (notificationReadRes.error) {
    if (!tableMissing(notificationReadRes.error.message, "member_notification_reads")) {
      return NextResponse.json({ error: notificationReadRes.error.message }, { status: 500 });
    }
  } else {
    for (const row of (notificationReadRes.data || []) as Array<{ notification_id: string; read_at: string }>) {
      if (!row.notification_id) continue;
      readMap.set(String(row.notification_id), String(row.read_at));
    }
  }

  const items: NotificationItem[] = [];

  for (const booking of bookingRes.data || []) {
    const startsAt = parseDate(booking.starts_at);
    if (!startsAt) continue;
    const hours = Math.max(0, Math.ceil((startsAt.getTime() - Date.now()) / (60 * 60 * 1000)));
    items.push({
      id: `booking:${booking.id}`,
      type: "booking_reminder",
      level: "info",
      title: "Class Reminder",
      message: `${booking.service_name || "Class"} starts in about ${hours} hour(s).`,
      at: booking.starts_at,
      isRead: false,
      readAt: null,
    });
  }

  for (const subscription of subRes.data || []) {
    if (!subscription.valid_to) continue;
    const days = daysUntil(subscription.valid_to);
    if (days > 7) continue;
    items.push({
      id: `sub:${subscription.id}`,
      type: "membership_expiry",
      level: days <= 3 ? "warning" : "info",
      title: "Membership Expiry",
      message: days < 0 ? "Membership has expired." : `Membership expires in ${days} day(s).`,
      at: subscription.valid_to,
      isRead: false,
      readAt: null,
    });
  }

  for (const pass of passRes.data || []) {
    if (!pass.expires_at) continue;
    const days = daysUntil(pass.expires_at);
    if (days > 7) continue;
    items.push({
      id: `pass:${pass.id}`,
      type: "pass_expiry",
      level: days <= 3 ? "warning" : "info",
      title: "Session Pass Expiry",
      message:
        days < 0
          ? `Your ${pass.pass_type || "pass"} has expired.`
          : `${pass.pass_type || "Pass"} expires in ${days} day(s). Remaining: ${Number(pass.remaining || 0)}.`,
      at: pass.expires_at,
      isRead: false,
      readAt: null,
    });
  }

  for (const log of notifyLogRes.data || []) {
    items.push({
      id: `log:${log.id}`,
      type: "system_log",
      level: log.status === "failed" ? "warning" : "info",
      title: log.status === "failed" ? "Notification Failed" : "Notification Sent",
      message:
        log.status === "failed"
          ? `${log.channel} failed: ${log.error_message || "unknown error"}`
          : `${log.channel} (${log.template_key || "general"})`,
      at: log.sent_at || log.created_at,
      isRead: false,
      readAt: null,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  for (const item of items) {
    const readAt = readMap.get(item.id) || null;
    item.isRead = Boolean(readAt);
    item.readAt = readAt;
  }

  return NextResponse.json({
    memberId,
    memberName,
    items: items.slice(0, 30),
  });
}

export async function PATCH(request: Request) {
  const memberContext = await loadMemberContext(request);
  if (!memberContext.ok) return memberContext.response;
  const { memberId, tenantId, supabase } = memberContext.value;

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim() : "";

  if (action !== "mark_read" && action !== "mark_unread" && action !== "mark_all_read") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (action === "mark_read") {
    const notificationId = typeof body?.notificationId === "string" ? body.notificationId.trim() : "";
    if (!notificationId) return NextResponse.json({ error: "notificationId is required" }, { status: 400 });
    const result = await supabase.from("member_notification_reads").upsert(
      {
        tenant_id: tenantId,
        member_id: memberId,
        notification_id: notificationId,
        read_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,member_id,notification_id" },
    );
    if (result.error) {
      if (tableMissing(result.error.message, "member_notification_reads")) {
        return NextResponse.json({ error: "Read-state table is not available. Apply latest migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "mark_unread") {
    const notificationId = typeof body?.notificationId === "string" ? body.notificationId.trim() : "";
    if (!notificationId) return NextResponse.json({ error: "notificationId is required" }, { status: 400 });
    const result = await supabase
      .from("member_notification_reads")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId)
      .eq("notification_id", notificationId);
    if (result.error) {
      if (tableMissing(result.error.message, "member_notification_reads")) {
        return NextResponse.json({ error: "Read-state table is not available. Apply latest migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const notificationIds = parseNotificationIds(body?.notificationIds);
  if (notificationIds.length === 0) {
    return NextResponse.json({ error: "notificationIds are required" }, { status: 400 });
  }
  if (notificationIds.length > 300) {
    return NextResponse.json({ error: "Too many notificationIds" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const rows = notificationIds.map((notificationId) => ({
    tenant_id: tenantId,
    member_id: memberId,
    notification_id: notificationId,
    read_at: now,
  }));
  const result = await supabase.from("member_notification_reads").upsert(rows, {
    onConflict: "tenant_id,member_id,notification_id",
  });
  if (result.error) {
    if (tableMissing(result.error.message, "member_notification_reads")) {
      return NextResponse.json({ error: "Read-state table is not available. Apply latest migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
