import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

const INCIDENT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

type IncidentEvent = {
  id: string;
  action: string;
  note: string;
  createdAt: string;
};

type IncidentItem = {
  id: string;
  incidentNo: string;
  incidentType: string;
  priority: string;
  status: string;
  source: string;
  title: string;
  detail: string;
  updatedAt: string;
  createdAt: string;
  resolutionNote: string;
  events: IncidentEvent[];
};

type IncidentAuditPayload = {
  incidentNo?: string;
  incidentType?: string;
  priority?: string;
  status?: string;
  source?: string;
  memberId?: string | null;
  title?: string;
  detail?: string;
  resolutionNote?: string | null;
  note?: string | null;
  [key: string]: unknown;
};

function normalizeText(input: unknown) {
  if (typeof input !== "string") return "";
  return input.trim();
}

function issueNo() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `MCS${stamp}-${rand}`;
}

function eventActionLabel(action: string) {
  if (action === "incident_created") return "created";
  if (action === "incident_status_updated") return "status_changed";
  if (action === "incident_resolved") return "resolved";
  if (action === "incident_reopened") return "reopened";
  return "followup";
}

function toIncidentItems(rows: Array<{
  id: string;
  action: string;
  target_id: string | null;
  reason: string | null;
  payload: IncidentAuditPayload | null;
  created_at: string;
}>) {
  const incidentMap = new Map<string, IncidentItem>();

  for (const row of rows) {
    const incidentId = row.target_id ? String(row.target_id) : "";
    if (!incidentId) continue;
    const payload = row.payload || {};

    if (!incidentMap.has(incidentId)) {
      incidentMap.set(incidentId, {
        id: incidentId,
        incidentNo: payload.incidentNo ? String(payload.incidentNo) : incidentId.slice(0, 8),
        incidentType: payload.incidentType ? String(payload.incidentType) : "member",
        priority: payload.priority ? String(payload.priority) : "normal",
        status: payload.status ? String(payload.status) : "open",
        source: payload.source ? String(payload.source) : "member_portal",
        title: payload.title ? String(payload.title) : "",
        detail: payload.detail ? String(payload.detail) : "",
        updatedAt: row.created_at,
        createdAt: row.created_at,
        resolutionNote: payload.resolutionNote ? String(payload.resolutionNote) : "",
        events: [],
      });
    }

    const item = incidentMap.get(incidentId)!;
    item.updatedAt = row.created_at;
    if (payload.incidentNo) item.incidentNo = String(payload.incidentNo);
    if (payload.incidentType) item.incidentType = String(payload.incidentType);
    if (payload.priority) item.priority = String(payload.priority);
    if (payload.status) item.status = String(payload.status);
    if (payload.source) item.source = String(payload.source);
    if (payload.title) item.title = String(payload.title);
    if (payload.detail) item.detail = String(payload.detail);
    if (payload.resolutionNote) item.resolutionNote = String(payload.resolutionNote);

    item.events.push({
      id: row.id,
      action: eventActionLabel(row.action),
      note: payload.note ? String(payload.note) : (row.reason ? String(row.reason) : ""),
      createdAt: row.created_at,
    });
  }

  return Array.from(incidentMap.values())
    .map((item) => ({
      ...item,
      events: item.events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function GET(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();
  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const memberId = String(memberResult.data.id);

  const limit = Math.min(2000, Math.max(50, Number(new URL(request.url).searchParams.get("limit") || 500)));
  const rowsResult = await auth.supabase
    .from("audit_logs")
    .select("id, action, target_id, reason, payload, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("target_type", "frontdesk_incident")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (rowsResult.error) return NextResponse.json({ error: rowsResult.error.message }, { status: 500 });

  const rows = (rowsResult.data || []) as Array<{
    id: string;
    action: string;
    target_id: string | null;
    reason: string | null;
    payload: IncidentAuditPayload | null;
    created_at: string;
  }>;

  const ownRows = rows.filter((row) => {
    const payloadMemberId = row.payload?.memberId ? String(row.payload.memberId) : "";
    return payloadMemberId === memberId;
  });

  const incidents = toIncidentItems(ownRows);
  return NextResponse.json({ memberId, items: incidents.slice(0, 100) });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const memberResult = await auth.supabase
    .from("members")
    .select("id, full_name, phone")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();
  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const action = normalizeText(body?.action || "create");

  if (action === "followup") {
    const incidentId = normalizeText(body?.incidentId);
    const note = normalizeText(body?.note);
    if (!incidentId) return NextResponse.json({ error: "incidentId is required" }, { status: 400 });
    if (!note) return NextResponse.json({ error: "note is required" }, { status: 400 });

    const existingResult = await auth.supabase
      .from("audit_logs")
      .select("id, payload")
      .eq("tenant_id", auth.context.tenantId)
      .eq("target_type", "frontdesk_incident")
      .eq("target_id", incidentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingResult.error || !existingResult.data) {
      return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    }
    const ownerMemberId = existingResult.data.payload?.memberId ? String(existingResult.data.payload.memberId) : "";
    if (ownerMemberId !== String(memberResult.data.id)) {
      return NextResponse.json({ error: "Forbidden incident access" }, { status: 403 });
    }

    const followupInsert = await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "incident_followup",
      target_type: "frontdesk_incident",
      target_id: incidentId,
      reason: note,
      payload: {
        memberId: String(memberResult.data.id),
        note,
        source: "member_portal",
      },
    });
    if (followupInsert.error) return NextResponse.json({ error: followupInsert.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const title = normalizeText(body?.title);
  const detail = normalizeText(body?.detail);
  const incidentType = normalizeText(body?.incidentType) || "member";
  const priority = normalizeText(body?.priority) || "normal";
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!detail) return NextResponse.json({ error: "detail is required" }, { status: 400 });

  const allowedType = ["complaint", "facility", "safety", "billing", "member", "other"].includes(incidentType);
  if (!allowedType) return NextResponse.json({ error: "Invalid incidentType" }, { status: 400 });
  const allowedPriority = ["low", "normal", "high", "urgent"].includes(priority);
  if (!allowedPriority) return NextResponse.json({ error: "Invalid priority" }, { status: 400 });

  const incidentId = randomUUID();
  const payload = {
    incidentNo: issueNo(),
    incidentType,
    priority,
    status: INCIDENT_STATUSES[0],
    source: "member_portal",
    memberId: String(memberResult.data.id),
    memberName: memberResult.data.full_name || "",
    contactPhone: memberResult.data.phone || "",
    title,
    detail,
    note: "submitted_from_member_portal",
  };

  const createResult = await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "incident_created",
    target_type: "frontdesk_incident",
    target_id: incidentId,
    reason: "member_support_create",
    payload,
  });
  if (createResult.error) return NextResponse.json({ error: createResult.error.message }, { status: 500 });

  return NextResponse.json({ incident: { id: incidentId, incidentNo: payload.incidentNo } }, { status: 201 });
}
