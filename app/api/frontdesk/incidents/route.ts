import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";

const MEMBER_CODE_RE = /^\d{1,4}$/;
const INCIDENT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

type IncidentAuditPayload = {
  incidentNo?: string;
  incidentType?: string;
  priority?: string;
  status?: IncidentStatus | string;
  source?: string;
  memberId?: string | null;
  memberCode?: string | null;
  memberName?: string | null;
  contactPhone?: string | null;
  title?: string;
  detail?: string;
  happenedAt?: string | null;
  dueAt?: string | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  note?: string | null;
  branchId?: string | null;
  [key: string]: unknown;
};

type IncidentAuditRow = {
  id: string;
  action: string;
  target_id: string | null;
  reason: string | null;
  payload: IncidentAuditPayload | null;
  actor_id: string | null;
  created_at: string;
};

type IncidentViewItem = {
  id: string;
  incidentNo: string;
  incidentType: string;
  priority: string;
  status: string;
  source: string;
  memberId: string | null;
  memberCode: string;
  memberName: string;
  contactPhone: string;
  title: string;
  detail: string;
  happenedAt: string | null;
  dueAt: string | null;
  resolutionNote: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: Array<{
    id: string;
    action: string;
    note: string;
    actorId: string | null;
    actorName: string | null;
    createdAt: string;
  }>;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function optionalText(value: unknown) {
  const text = normalizeText(value);
  return text || null;
}

function optionalIso(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseStatus(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if ((INCIDENT_STATUSES as readonly string[]).includes(trimmed)) return trimmed as IncidentStatus;
  return null;
}

function incidentNo() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `INC${stamp}-${rand}`;
}

function eventAction(action: string) {
  if (action === "incident_created") return "created";
  if (action === "incident_status_updated") return "status_changed";
  if (action === "incident_resolved") return "resolved";
  if (action === "incident_reopened") return "reopened";
  return "followup";
}

function buildIncidentItems(rows: IncidentAuditRow[], actorNameById: Map<string, string>) {
  const incidents = new Map<string, IncidentViewItem>();
  for (const row of rows) {
    const incidentId = row.target_id ? String(row.target_id) : "";
    if (!incidentId) continue;
    const payload = row.payload || {};

    if (!incidents.has(incidentId)) {
      incidents.set(incidentId, {
        id: incidentId,
        incidentNo: payload.incidentNo ? String(payload.incidentNo) : incidentId.slice(0, 8),
        incidentType: payload.incidentType ? String(payload.incidentType) : "other",
        priority: payload.priority ? String(payload.priority) : "normal",
        status: payload.status ? String(payload.status) : "open",
        source: payload.source ? String(payload.source) : "frontdesk",
        memberId: payload.memberId ? String(payload.memberId) : null,
        memberCode: payload.memberCode ? String(payload.memberCode) : "",
        memberName: payload.memberName ? String(payload.memberName) : "",
        contactPhone: payload.contactPhone ? String(payload.contactPhone) : "",
        title: payload.title ? String(payload.title) : "",
        detail: payload.detail ? String(payload.detail) : "",
        happenedAt: payload.happenedAt ? String(payload.happenedAt) : null,
        dueAt: payload.dueAt ? String(payload.dueAt) : null,
        resolutionNote: payload.resolutionNote ? String(payload.resolutionNote) : "",
        resolvedAt: payload.resolvedAt ? String(payload.resolvedAt) : null,
        createdAt: row.created_at,
        updatedAt: row.created_at,
        events: [],
      });
    }

    const item = incidents.get(incidentId)!;
    item.updatedAt = row.created_at;
    if (payload.incidentNo) item.incidentNo = String(payload.incidentNo);
    if (payload.incidentType) item.incidentType = String(payload.incidentType);
    if (payload.priority) item.priority = String(payload.priority);
    if (payload.status) item.status = String(payload.status);
    if (payload.source) item.source = String(payload.source);
    if ("memberId" in payload) item.memberId = payload.memberId ? String(payload.memberId) : null;
    if ("memberCode" in payload) item.memberCode = payload.memberCode ? String(payload.memberCode) : "";
    if ("memberName" in payload) item.memberName = payload.memberName ? String(payload.memberName) : "";
    if ("contactPhone" in payload) item.contactPhone = payload.contactPhone ? String(payload.contactPhone) : "";
    if (payload.title) item.title = String(payload.title);
    if (payload.detail) item.detail = String(payload.detail);
    if ("happenedAt" in payload) item.happenedAt = payload.happenedAt ? String(payload.happenedAt) : null;
    if ("dueAt" in payload) item.dueAt = payload.dueAt ? String(payload.dueAt) : null;
    if ("resolutionNote" in payload) item.resolutionNote = payload.resolutionNote ? String(payload.resolutionNote) : "";
    if ("resolvedAt" in payload) item.resolvedAt = payload.resolvedAt ? String(payload.resolvedAt) : null;

    item.events.push({
      id: row.id,
      action: eventAction(row.action),
      note: payload.note ? String(payload.note) : (row.reason ? String(row.reason) : ""),
      actorId: row.actor_id ? String(row.actor_id) : null,
      actorName: row.actor_id ? (actorNameById.get(String(row.actor_id)) || String(row.actor_id)) : null,
      createdAt: row.created_at,
    });
  }

  return Array.from(incidents.values()).map((item) => ({
    ...item,
    events: item.events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 12),
  }));
}

async function loadAuditRows(auth: { supabase: any; context: { tenantId: string | null } }, limit: number) {
  const result = await auth.supabase
    .from("audit_logs")
    .select("id, action, target_id, reason, payload, actor_id, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("target_type", "frontdesk_incident")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (result.data || []) as IncidentAuditRow[];
}

async function loadActorNameMap(auth: { supabase: any }, rows: IncidentAuditRow[]) {
  const actorIds = Array.from(
    new Set(rows.map((row) => (row.actor_id ? String(row.actor_id) : "")).filter(Boolean)),
  );
  const nameMap = new Map<string, string>();
  if (actorIds.length === 0) return nameMap;
  const profileResult = await auth.supabase.from("profiles").select("id, display_name").in("id", actorIds);
  if (profileResult.error) throw new Error(profileResult.error.message);
  for (const row of (profileResult.data || []) as Array<{ id: string; display_name: string | null }>) {
    nameMap.set(String(row.id), row.display_name ? String(row.display_name) : String(row.id));
  }
  return nameMap;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 50)));
  const statusFilterInput = (params.get("status") || "all").trim();
  const statusFilter = statusFilterInput === "all" ? "all" : parseStatus(statusFilterInput);
  if (!statusFilter) return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });

  try {
    const rows = await loadAuditRows(auth, Math.min(4000, limit * 30));
    const actorNameById = await loadActorNameMap(auth, rows);
    let items = buildIncidentItems(rows, actorNameById)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (statusFilter !== "all") {
      items = items.filter((item) => item.status === statusFilter);
    }

    return NextResponse.json({ items: items.slice(0, limit) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Load incidents failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const shiftGuard = await requireOpenShift({
    supabase: auth.supabase,
    context: auth.context,
    enforceRoles: ["frontdesk"],
  });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const action = normalizeText(body?.action);

  if (action === "create") {
    const title = normalizeText(body?.title);
    const detail = normalizeText(body?.detail);
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
    if (!detail) return NextResponse.json({ error: "detail is required" }, { status: 400 });

    const happenedAt = optionalIso(body?.happenedAt);
    if (typeof body?.happenedAt === "string" && body.happenedAt.trim() && !happenedAt) {
      return NextResponse.json({ error: "Invalid happenedAt" }, { status: 400 });
    }
    const dueAt = optionalIso(body?.dueAt);
    if (typeof body?.dueAt === "string" && body.dueAt.trim() && !dueAt) {
      return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
    }

    let memberId: string | null = null;
    let memberCode: string | null = null;
    let memberName = optionalText(body?.memberName);
    let contactPhone = optionalText(body?.contactPhone);

    const memberCodeInput = normalizeText(body?.memberCode);
    if (memberCodeInput) {
      if (!MEMBER_CODE_RE.test(memberCodeInput)) {
        return NextResponse.json({ error: "Invalid memberCode format. Use 1-9999." }, { status: 400 });
      }
      const normalizedCode = String(Number(memberCodeInput));
      const candidates = Array.from(new Set([memberCodeInput, normalizedCode]));
      const memberResult = await auth.supabase
        .from("members")
        .select("id, member_code, full_name, phone")
        .eq("tenant_id", auth.context.tenantId)
        .in("member_code", candidates)
        .limit(1)
        .maybeSingle();
      if (memberResult.error) return NextResponse.json({ error: memberResult.error.message }, { status: 500 });
      if (!memberResult.data?.id) {
        return NextResponse.json({ error: "Member not found by member code" }, { status: 404 });
      }
      memberId = String(memberResult.data.id);
      memberCode = memberResult.data.member_code ? String(memberResult.data.member_code) : normalizedCode;
      if (!memberName && memberResult.data.full_name) memberName = String(memberResult.data.full_name);
      if (!contactPhone && memberResult.data.phone) contactPhone = String(memberResult.data.phone);
    }

    const now = new Date().toISOString();
    const incidentId = crypto.randomUUID();
    const payload: IncidentAuditPayload = {
      incidentNo: incidentNo(),
      incidentType: normalizeText(body?.incidentType) || "complaint",
      priority: normalizeText(body?.priority) || "normal",
      status: "open",
      source: normalizeText(body?.source) || "frontdesk",
      memberId,
      memberCode,
      memberName,
      contactPhone,
      title,
      detail,
      happenedAt,
      dueAt,
      resolutionNote: null,
      resolvedAt: null,
      branchId: auth.context.branchId || null,
      note: optionalText(body?.note),
    };

    const insert = await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "incident_created",
      target_type: "frontdesk_incident",
      target_id: incidentId,
      reason: "frontdesk_incident_create",
      payload,
      created_at: now,
    });
    if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 500 });

    return NextResponse.json({
      incident: {
        id: incidentId,
        incidentNo: payload.incidentNo,
      },
    }, { status: 201 });
  }

  const incidentId = normalizeText(body?.incidentId);
  if (!incidentId) return NextResponse.json({ error: "incidentId is required" }, { status: 400 });

  const incidentExistsResult = await auth.supabase
    .from("audit_logs")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("target_type", "frontdesk_incident")
    .eq("target_id", incidentId)
    .limit(1)
    .maybeSingle();
  if (incidentExistsResult.error) return NextResponse.json({ error: incidentExistsResult.error.message }, { status: 500 });
  if (!incidentExistsResult.data) return NextResponse.json({ error: "Incident not found" }, { status: 404 });

  if (action === "update_status") {
    const status = parseStatus(body?.status);
    if (!status) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    const note = optionalText(body?.note);
    const isResolved = status === "resolved";
    const payload: IncidentAuditPayload = {
      status,
      note,
      resolutionNote: isResolved ? note : null,
      resolvedAt: isResolved ? new Date().toISOString() : null,
      branchId: auth.context.branchId || null,
    };

    const insert = await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: isResolved ? "incident_resolved" : "incident_status_updated",
      target_type: "frontdesk_incident",
      target_id: incidentId,
      reason: note,
      payload,
    });
    if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "followup") {
    const note = normalizeText(body?.note);
    if (!note) return NextResponse.json({ error: "note is required" }, { status: 400 });
    const insert = await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "incident_followup",
      target_type: "frontdesk_incident",
      target_id: incidentId,
      reason: note,
      payload: { note, branchId: auth.context.branchId || null },
    });
    if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "resolve") {
    const resolutionNote = normalizeText(body?.resolutionNote);
    if (!resolutionNote) return NextResponse.json({ error: "resolutionNote is required" }, { status: 400 });
    const insert = await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "incident_resolved",
      target_type: "frontdesk_incident",
      target_id: incidentId,
      reason: resolutionNote,
      payload: {
        status: "resolved",
        resolutionNote,
        resolvedAt: new Date().toISOString(),
        note: resolutionNote,
        branchId: auth.context.branchId || null,
      },
    });
    if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
