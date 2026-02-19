import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

type LeadStatus = "new" | "tour_scheduled" | "converted" | "lost";
type LeadAction =
  | "lead_created"
  | "lead_tour_scheduled"
  | "lead_followup"
  | "lead_converted"
  | "lead_lost";

type LeadPayload = {
  name?: string;
  phone?: string | null;
  source?: string | null;
  interest?: string | null;
  note?: string | null;
  tourAt?: string | null;
  status?: LeadStatus;
  memberId?: string | null;
  [key: string]: unknown;
};

type LeadAggregate = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  interest: string | null;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  tourAt: string | null;
  memberId: string | null;
  note: string | null;
  lastReason: string | null;
  events: Array<{
    id: string;
    action: LeadAction | string;
    reason: string | null;
    createdAt: string;
  }>;
};

function parseIsoOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toLeadStatus(value: unknown): LeadStatus {
  if (value === "tour_scheduled" || value === "converted" || value === "lost") return value;
  return "new";
}

function mapActionToStatus(action: string, fallback: LeadStatus) {
  if (action === "lead_tour_scheduled") return "tour_scheduled" as const;
  if (action === "lead_converted") return "converted" as const;
  if (action === "lead_lost") return "lost" as const;
  if (action === "lead_created") return fallback;
  return fallback;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const params = new URL(request.url).searchParams;
  const statusFilter = (params.get("status") || "all").trim();
  const limit = Math.min(200, Math.max(10, Number(params.get("limit") || 80)));
  const maxRows = Math.min(4000, Math.max(200, limit * 20));

  const { data, error } = await auth.supabase
    .from("audit_logs")
    .select("id, action, target_id, reason, payload, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("target_type", "lead")
    .order("created_at", { ascending: true })
    .limit(maxRows);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const map = new Map<string, LeadAggregate>();
  for (const row of (data || []) as Array<{
    id: string;
    action: string;
    target_id: string | null;
    reason: string | null;
    payload: LeadPayload | null;
    created_at: string;
  }>) {
    const leadId = row.target_id || "";
    if (!leadId) continue;
    const payload = row.payload || {};
    if (!map.has(leadId)) {
      map.set(leadId, {
        id: leadId,
        name: payload.name || "Lead",
        phone: payload.phone || null,
        source: payload.source || null,
        interest: payload.interest || null,
        status: toLeadStatus(payload.status),
        createdAt: row.created_at,
        updatedAt: row.created_at,
        tourAt: payload.tourAt || null,
        memberId: payload.memberId || null,
        note: payload.note || null,
        lastReason: row.reason || null,
        events: [],
      });
    }

    const lead = map.get(leadId)!;
    lead.updatedAt = row.created_at;
    lead.lastReason = row.reason || lead.lastReason;

    if (payload.name) lead.name = String(payload.name);
    if ("phone" in payload) lead.phone = payload.phone ? String(payload.phone) : null;
    if ("source" in payload) lead.source = payload.source ? String(payload.source) : null;
    if ("interest" in payload) lead.interest = payload.interest ? String(payload.interest) : null;
    if ("note" in payload) lead.note = payload.note ? String(payload.note) : null;
    if ("tourAt" in payload) lead.tourAt = payload.tourAt ? String(payload.tourAt) : null;
    if ("memberId" in payload) lead.memberId = payload.memberId ? String(payload.memberId) : null;
    lead.status = mapActionToStatus(row.action, toLeadStatus(payload.status || lead.status));

    lead.events.push({
      id: row.id,
      action: row.action,
      reason: row.reason,
      createdAt: row.created_at,
    });
  }

  const items = Array.from(map.values())
    .filter((item) => (statusFilter === "all" ? true : item.status === statusFilter))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);

  return NextResponse.json({
    items,
    summary: {
      total: items.length,
      new: items.filter((item) => item.status === "new").length,
      tourScheduled: items.filter((item) => item.status === "tour_scheduled").length,
      converted: items.filter((item) => item.status === "converted").length,
      lost: items.filter((item) => item.status === "lost").length,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim() : "";

  let auditAction: LeadAction;
  let leadId = typeof body?.leadId === "string" ? body.leadId.trim() : "";
  let reason = normalizeOptionalText(body?.reason);
  let payload: LeadPayload = {};

  if (action === "create") {
    const name = normalizeOptionalText(body?.name);
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    leadId = crypto.randomUUID();
    const tourAt = parseIsoOrNull(body?.tourAt);
    auditAction = "lead_created";
    payload = {
      name,
      phone: normalizeOptionalText(body?.phone),
      source: normalizeOptionalText(body?.source),
      interest: normalizeOptionalText(body?.interest),
      note: normalizeOptionalText(body?.note),
      tourAt,
      status: tourAt ? "tour_scheduled" : "new",
    };
  } else {
    if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

    if (action === "schedule_tour") {
      const tourAt = parseIsoOrNull(body?.tourAt);
      if (!tourAt) return NextResponse.json({ error: "valid tourAt is required" }, { status: 400 });
      auditAction = "lead_tour_scheduled";
      payload = { tourAt, note: normalizeOptionalText(body?.note), status: "tour_scheduled" };
    } else if (action === "followup") {
      const note = normalizeOptionalText(body?.note);
      if (!note) return NextResponse.json({ error: "note is required" }, { status: 400 });
      auditAction = "lead_followup";
      payload = { note };
    } else if (action === "convert") {
      auditAction = "lead_converted";
      payload = { memberId: normalizeOptionalText(body?.memberId), note: normalizeOptionalText(body?.note), status: "converted" };
    } else if (action === "mark_lost") {
      auditAction = "lead_lost";
      reason = reason || "mark_lost";
      payload = { note: normalizeOptionalText(body?.note), status: "lost" };
    } else {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }
  }

  const { error } = await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: auditAction,
    target_type: "lead",
    target_id: leadId,
    reason,
    payload,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, leadId, action: auditAction });
}
