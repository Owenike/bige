import { NextResponse } from "next/server";
import {
  bigeLineWebhookDedupeKey,
  verifyBigeLineWebhookSignature,
} from "../../../../../lib/bige-line-schedule";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type LineEvent = {
  type?: string;
  webhookEventId?: string;
  source?: { type?: string; groupId?: string };
};

async function readGroupName(groupId: string) {
  const token = process.env.LINE_STUDENT_SCHEDULE_CHANNEL_ACCESS_TOKEN || "";
  if (!token) return null;
  const response = await fetch(
    `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as { groupName?: string } | null;
  return payload?.groupName?.trim() || null;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyBigeLineWebhookSignature(rawBody, request.headers.get("x-line-signature"))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const tenantId = process.env.BIGE_LINE_TENANT_ID || "";
  if (!tenantId) return NextResponse.json({ error: "tenant_not_configured" }, { status: 503 });
  const payload = JSON.parse(rawBody) as { events?: LineEvent[] };
  const admin = createSupabaseAdminClient();
  const eventHash = bigeLineWebhookDedupeKey(rawBody);
  for (const event of payload.events || []) {
    const groupId = event.source?.type === "group" ? event.source.groupId : null;
    if (!groupId) continue;
    if (event.type === "leave") {
      await admin
        .from("bige_line_group_bindings")
        .update({
          status: "left",
          left_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: { lastWebhookEventId: event.webhookEventId || eventHash },
        })
        .eq("tenant_id", tenantId)
        .eq("line_group_id", groupId);
      continue;
    }
    if (event.type !== "join" && event.type !== "message") continue;
    const groupName = (await readGroupName(groupId)) || "尚未取得群組名稱";
    const existing = await admin
      .from("bige_line_group_bindings")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("line_group_id", groupId)
      .maybeSingle();
    if (existing.error) {
      console.warn("[bige-line-webhook] binding lookup failed", existing.error.message);
      continue;
    }
    await admin.from("bige_line_group_bindings").upsert(
      {
        tenant_id: tenantId,
        line_group_id: groupId,
        group_name: groupName,
        status: existing.data?.status === "active" ? "active" : "pending",
        joined_at: event.type === "join" ? new Date().toISOString() : undefined,
        left_at: null,
        last_seen_at: new Date().toISOString(),
        metadata: { lastWebhookEventId: event.webhookEventId || eventHash },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,line_group_id" },
    );
  }
  return NextResponse.json({ ok: true });
}
