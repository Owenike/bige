import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBER_CODE_RE = /^\d{1,4}$/;

const INCIDENT_TYPES = ["complaint", "facility", "safety", "billing", "member", "other"] as const;
type IncidentType = (typeof INCIDENT_TYPES)[number];

const INCIDENT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
type IncidentPriority = (typeof INCIDENT_PRIORITIES)[number];

const INCIDENT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

const INCIDENT_SOURCES = ["frontdesk", "phone", "line", "email", "walkin", "other"] as const;
type IncidentSource = (typeof INCIDENT_SOURCES)[number];

type IncidentLogAction = "created" | "status_changed" | "followup" | "resolved" | "reopened" | "assigned";

type IncidentRow = {
  id: string;
  incident_no: string;
  incident_type: IncidentType | string;
  priority: IncidentPriority | string;
  status: IncidentStatus | string;
  source: IncidentSource | string;
  member_id: string | null;
  member_code: string | null;
  member_name: string | null;
  contact_phone: string | null;
  title: string;
  detail: string;
  happened_at: string | null;
  due_at: string | null;
  assigned_to: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type IncidentLogRow = {
  id: string;
  incident_id: string;
  action: IncidentLogAction | string;
  note: string | null;
  payload: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
};

const INCIDENT_SELECT = [
  "id",
  "incident_no",
  "incident_type",
  "priority",
  "status",
  "source",
  "member_id",
  "member_code",
  "member_name",
  "contact_phone",
  "title",
  "detail",
  "happened_at",
  "due_at",
  "assigned_to",
  "resolution_note",
  "resolved_at",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
].join(", ");

function parseIso(input: unknown) {
  if (typeof input !== "string" || !input.trim()) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function asIncidentType(input: unknown): IncidentType {
  if (typeof input !== "string") return "complaint";
  const value = input.trim();
  if ((INCIDENT_TYPES as readonly string[]).includes(value)) return value as IncidentType;
  return "complaint";
}

function asIncidentPriority(input: unknown): IncidentPriority {
  if (typeof input !== "string") return "normal";
  const value = input.trim();
  if ((INCIDENT_PRIORITIES as readonly string[]).includes(value)) return value as IncidentPriority;
  return "normal";
}

function asIncidentStatus(input: unknown): IncidentStatus | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if ((INCIDENT_STATUSES as readonly string[]).includes(value)) return value as IncidentStatus;
  return null;
}

function asIncidentSource(input: unknown): IncidentSource {
  if (typeof input !== "string") return "frontdesk";
  const value = input.trim();
  if ((INCIDENT_SOURCES as readonly string[]).includes(value)) return value as IncidentSource;
  return "frontdesk";
}

function normalizeString(input: unknown) {
  if (typeof input !== "string") return "";
  return input.trim();
}

function isIncidentTableMissing(message: string) {
  return message.includes('relation "frontdesk_incidents" does not exist')
    || message.includes('relation "frontdesk_incident_logs" does not exist')
    || message.includes("Could not find the table 'public.frontdesk_incidents' in the schema cache")
    || message.includes("Could not find the table 'public.frontdesk_incident_logs' in the schema cache");
}

function generateIncidentNo() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `INC${stamp}-${rand}`;
}

function toIncidentEvent(row: IncidentLogRow, actorNameById: Map<string, string>) {
  return {
    id: String(row.id),
    action: String(row.action || "followup"),
    note: row.note ? String(row.note) : "",
    payload: row.payload ?? {},
    actorId: row.actor_id ? String(row.actor_id) : null,
    actorName: row.actor_id ? (actorNameById.get(String(row.actor_id)) ?? String(row.actor_id)) : null,
    createdAt: row.created_at,
  };
}

function toIncidentItem(row: IncidentRow, namesById: Map<string, string>, events: ReturnType<typeof toIncidentEvent>[]) {
  return {
    id: String(row.id),
    incidentNo: String(row.incident_no || ""),
    incidentType: String(row.incident_type || "other"),
    priority: String(row.priority || "normal"),
    status: String(row.status || "open"),
    source: String(row.source || "frontdesk"),
    memberId: row.member_id ? String(row.member_id) : null,
    memberCode: row.member_code ? String(row.member_code) : "",
    memberName: row.member_name ? String(row.member_name) : "",
    contactPhone: row.contact_phone ? String(row.contact_phone) : "",
    title: String(row.title || ""),
    detail: String(row.detail || ""),
    happenedAt: row.happened_at,
    dueAt: row.due_at,
    assignedTo: row.assigned_to ? String(row.assigned_to) : null,
    assigneeName: row.assigned_to ? (namesById.get(String(row.assigned_to)) ?? String(row.assigned_to)) : null,
    resolutionNote: row.resolution_note ? String(row.resolution_note) : "",
    resolvedAt: row.resolved_at,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdByName: row.created_by ? (namesById.get(String(row.created_by)) ?? String(row.created_by)) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedByName: row.updated_by ? (namesById.get(String(row.updated_by)) ?? String(row.updated_by)) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events,
  };
}

async function listIncidents(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }
  if (!auth.context.branchId) {
    return NextResponse.json({ error: "Missing branch context" }, { status: 400 });
  }

  const params = new URL(request.url).searchParams;
  const statusInput = params.get("status") || "all";
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 40)));

  let statusFilter: IncidentStatus | "all" = "all";
  if (statusInput !== "all") {
    const parsed = asIncidentStatus(statusInput);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }
    statusFilter = parsed;
  }

  let query = auth.supabase
    .from("frontdesk_incidents")
    .select(INCIDENT_SELECT)
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const incidentsResult = await query;
  if (incidentsResult.error) {
    if (isIncidentTableMissing(incidentsResult.error.message)) {
      return NextResponse.json({ error: "incidents table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: incidentsResult.error.message }, { status: 500 });
  }

  const incidents = (incidentsResult.data || []) as IncidentRow[];
  const incidentIds = incidents.map((row) => String(row.id));

  const profileIds = new Set<string>();
  for (const row of incidents) {
    if (row.created_by) profileIds.add(String(row.created_by));
    if (row.updated_by) profileIds.add(String(row.updated_by));
    if (row.assigned_to) profileIds.add(String(row.assigned_to));
  }

  const eventsByIncident = new Map<string, ReturnType<typeof toIncidentEvent>[]>();
  if (incidentIds.length > 0) {
    const logsResult = await auth.supabase
      .from("frontdesk_incident_logs")
      .select("id, incident_id, action, note, payload, actor_id, created_at")
      .eq("tenant_id", auth.context.tenantId)
      .in("incident_id", incidentIds)
      .order("created_at", { ascending: false })
      .limit(Math.max(80, limit * 8));

    if (logsResult.error) {
      if (isIncidentTableMissing(logsResult.error.message)) {
        return NextResponse.json({ error: "incidents table missing. Apply migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: logsResult.error.message }, { status: 500 });
    }

    const logs = (logsResult.data || []) as IncidentLogRow[];
    for (const row of logs) {
      if (row.actor_id) profileIds.add(String(row.actor_id));
    }

    let namesById = new Map<string, string>();
    if (profileIds.size > 0) {
      const profileResult = await auth.supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", Array.from(profileIds));
      if (profileResult.error) return NextResponse.json({ error: profileResult.error.message }, { status: 500 });
      namesById = new Map(
        (profileResult.data || []).map((row: { id: string; display_name: string | null }) => [row.id, row.display_name || row.id]),
      );
    }

    for (const row of logs) {
      const incidentId = String(row.incident_id || "");
      if (!incidentId) continue;
      const list = eventsByIncident.get(incidentId) || [];
      if (list.length < 8) {
        list.push(toIncidentEvent(row, namesById));
      }
      eventsByIncident.set(incidentId, list);
    }

    const items = incidents.map((row) => toIncidentItem(row, namesById, eventsByIncident.get(String(row.id)) || []));
    return NextResponse.json({ items });
  }

  let namesById = new Map<string, string>();
  if (profileIds.size > 0) {
    const profileResult = await auth.supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", Array.from(profileIds));
    if (profileResult.error) return NextResponse.json({ error: profileResult.error.message }, { status: 500 });
    namesById = new Map(
      (profileResult.data || []).map((row: { id: string; display_name: string | null }) => [row.id, row.display_name || row.id]),
    );
  }

  return NextResponse.json({
    items: incidents.map((row) => toIncidentItem(row, namesById, [])),
  });
}

async function createIncident(auth: {
  context: { tenantId: string | null; branchId: string | null; userId: string };
  supabase: any;
}, body: any) {
  const title = normalizeString(body?.title);
  const detail = normalizeString(body?.detail);
  const incidentType = asIncidentType(body?.incidentType);
  const priority = asIncidentPriority(body?.priority);
  const source = asIncidentSource(body?.source);
  const memberCodeInput = normalizeString(body?.memberCode);
  const memberNameInput = normalizeString(body?.memberName);
  const contactPhoneInput = normalizeString(body?.contactPhone);
  const happenedAt = parseIso(body?.happenedAt);
  const dueAt = parseIso(body?.dueAt);

  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!detail) return NextResponse.json({ error: "detail is required" }, { status: 400 });

  if (typeof body?.happenedAt === "string" && body.happenedAt.trim() && !happenedAt) {
    return NextResponse.json({ error: "Invalid happenedAt" }, { status: 400 });
  }
  if (typeof body?.dueAt === "string" && body.dueAt.trim() && !dueAt) {
    return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
  }

  let memberId: string | null = null;
  let memberCode: string | null = null;
  let memberName = memberNameInput || null;
  let contactPhone = contactPhoneInput || null;

  if (memberCodeInput) {
    if (!MEMBER_CODE_RE.test(memberCodeInput)) {
      return NextResponse.json({ error: "Invalid memberCode format. Use 1-9999." }, { status: 400 });
    }
    const memberCodeNum = Number(memberCodeInput);
    if (!Number.isInteger(memberCodeNum) || memberCodeNum < 1 || memberCodeNum > 9999) {
      return NextResponse.json({ error: "Invalid memberCode format. Use 1-9999." }, { status: 400 });
    }
    const normalizedCode = String(memberCodeNum);
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
  let insertData: IncidentRow | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const incidentNo = generateIncidentNo();
    const insertResult = await auth.supabase
      .from("frontdesk_incidents")
      .insert({
        tenant_id: auth.context.tenantId,
        branch_id: auth.context.branchId,
        incident_no: incidentNo,
        incident_type: incidentType,
        priority,
        status: "open",
        source,
        member_id: memberId,
        member_code: memberCode,
        member_name: memberName,
        contact_phone: contactPhone,
        title,
        detail,
        happened_at: happenedAt,
        due_at: dueAt,
        assigned_to: null,
        created_by: auth.context.userId,
        updated_by: auth.context.userId,
        updated_at: now,
      })
      .select(INCIDENT_SELECT)
      .maybeSingle();

    if (!insertResult.error && insertResult.data) {
      insertData = insertResult.data as IncidentRow;
      break;
    }

    if (insertResult.error) {
      if (isIncidentTableMissing(insertResult.error.message)) {
        return NextResponse.json({ error: "incidents table missing. Apply migrations first." }, { status: 501 });
      }
      if (insertResult.error.code === "23505" && attempt < 4) {
        continue;
      }
      return NextResponse.json({ error: insertResult.error.message }, { status: 500 });
    }
  }

  if (!insertData) {
    return NextResponse.json({ error: "Create incident failed" }, { status: 500 });
  }

  await auth.supabase.from("frontdesk_incident_logs").insert({
    tenant_id: auth.context.tenantId,
    incident_id: insertData.id,
    action: "created",
    note: null,
    payload: {
      incidentNo: insertData.incident_no,
      incidentType,
      priority,
      source,
    },
    actor_id: auth.context.userId,
  });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "incident_created",
    target_type: "frontdesk_incident",
    target_id: insertData.id,
    reason: "frontdesk_cs",
    payload: {
      incidentNo: insertData.incident_no,
      incidentType,
      priority,
      source,
      memberCode,
      title,
    },
  });

  const namesById = new Map<string, string>([[auth.context.userId, auth.context.userId]]);
  return NextResponse.json({
    incident: toIncidentItem(insertData, namesById, []),
  }, { status: 201 });
}

async function handleIncidentAction(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }
  if (!auth.context.branchId) {
    return NextResponse.json({ error: "Missing branch context" }, { status: 400 });
  }

  const shiftGuard = await requireOpenShift({
    supabase: auth.supabase,
    context: auth.context,
    enforceRoles: ["frontdesk"],
  });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const action = body?.action === "resolve"
    ? "resolve"
    : body?.action === "followup"
      ? "followup"
      : body?.action === "update_status"
        ? "update_status"
        : "create";

  if (action === "create") {
    return createIncident(auth, body);
  }

  const incidentId = normalizeString(body?.incidentId);
  if (!UUID_RE.test(incidentId)) {
    return NextResponse.json({ error: "Invalid incidentId" }, { status: 400 });
  }

  const incidentResult = await auth.supabase
    .from("frontdesk_incidents")
    .select(INCIDENT_SELECT)
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .eq("id", incidentId)
    .maybeSingle();

  if (incidentResult.error) {
    if (isIncidentTableMissing(incidentResult.error.message)) {
      return NextResponse.json({ error: "incidents table missing. Apply migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: incidentResult.error.message }, { status: 500 });
  }
  if (!incidentResult.data) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  const current = incidentResult.data as IncidentRow;
  const now = new Date().toISOString();

  if (action === "update_status") {
    const nextStatus = asIncidentStatus(body?.status);
    const note = normalizeString(body?.note);
    if (!nextStatus) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      status: nextStatus,
      updated_at: now,
      updated_by: auth.context.userId,
    };

    if (nextStatus === "resolved") {
      updates.resolved_at = now;
    } else if (current.status === "resolved") {
      updates.resolved_at = null;
      updates.resolution_note = null;
    }

    const updateResult = await auth.supabase
      .from("frontdesk_incidents")
      .update(updates)
      .eq("tenant_id", auth.context.tenantId)
      .eq("branch_id", auth.context.branchId)
      .eq("id", incidentId)
      .select(INCIDENT_SELECT)
      .maybeSingle();

    if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 500 });
    if (!updateResult.data) return NextResponse.json({ error: "Incident update failed" }, { status: 500 });

    const logAction: IncidentLogAction = (current.status === "resolved" || current.status === "closed")
      && (nextStatus === "open" || nextStatus === "in_progress")
      ? "reopened"
      : "status_changed";

    await auth.supabase.from("frontdesk_incident_logs").insert({
      tenant_id: auth.context.tenantId,
      incident_id: incidentId,
      action: logAction,
      note: note || null,
      payload: {
        from: current.status,
        to: nextStatus,
      },
      actor_id: auth.context.userId,
    });

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "incident_status_updated",
      target_type: "frontdesk_incident",
      target_id: incidentId,
      reason: note || "frontdesk_cs",
      payload: {
        incidentNo: current.incident_no,
        from: current.status,
        to: nextStatus,
      },
    });

    const namesById = new Map<string, string>([[auth.context.userId, auth.context.userId]]);
    return NextResponse.json({ incident: toIncidentItem(updateResult.data as IncidentRow, namesById, []) });
  }

  if (action === "followup") {
    const note = normalizeString(body?.note);
    if (!note) {
      return NextResponse.json({ error: "note is required" }, { status: 400 });
    }

    const touchResult = await auth.supabase
      .from("frontdesk_incidents")
      .update({
        updated_at: now,
        updated_by: auth.context.userId,
      })
      .eq("tenant_id", auth.context.tenantId)
      .eq("branch_id", auth.context.branchId)
      .eq("id", incidentId)
      .select(INCIDENT_SELECT)
      .maybeSingle();
    if (touchResult.error) return NextResponse.json({ error: touchResult.error.message }, { status: 500 });
    if (!touchResult.data) return NextResponse.json({ error: "Incident update failed" }, { status: 500 });

    await auth.supabase.from("frontdesk_incident_logs").insert({
      tenant_id: auth.context.tenantId,
      incident_id: incidentId,
      action: "followup",
      note,
      payload: {},
      actor_id: auth.context.userId,
    });

    await auth.supabase.from("audit_logs").insert({
      tenant_id: auth.context.tenantId,
      actor_id: auth.context.userId,
      action: "incident_followup",
      target_type: "frontdesk_incident",
      target_id: incidentId,
      reason: note,
      payload: {
        incidentNo: current.incident_no,
      },
    });

    const namesById = new Map<string, string>([[auth.context.userId, auth.context.userId]]);
    return NextResponse.json({ incident: toIncidentItem(touchResult.data as IncidentRow, namesById, []) });
  }

  const resolutionNote = normalizeString(body?.resolutionNote);
  if (!resolutionNote) {
    return NextResponse.json({ error: "resolutionNote is required" }, { status: 400 });
  }

  const resolveResult = await auth.supabase
    .from("frontdesk_incidents")
    .update({
      status: "resolved",
      resolution_note: resolutionNote,
      resolved_at: now,
      updated_at: now,
      updated_by: auth.context.userId,
    })
    .eq("tenant_id", auth.context.tenantId)
    .eq("branch_id", auth.context.branchId)
    .eq("id", incidentId)
    .select(INCIDENT_SELECT)
    .maybeSingle();
  if (resolveResult.error) return NextResponse.json({ error: resolveResult.error.message }, { status: 500 });
  if (!resolveResult.data) return NextResponse.json({ error: "Resolve incident failed" }, { status: 500 });

  await auth.supabase.from("frontdesk_incident_logs").insert({
    tenant_id: auth.context.tenantId,
    incident_id: incidentId,
    action: "resolved",
    note: resolutionNote,
    payload: {
      from: current.status,
      to: "resolved",
    },
    actor_id: auth.context.userId,
  });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "incident_resolved",
    target_type: "frontdesk_incident",
    target_id: incidentId,
    reason: resolutionNote,
    payload: {
      incidentNo: current.incident_no,
    },
  });

  const namesById = new Map<string, string>([[auth.context.userId, auth.context.userId]]);
  return NextResponse.json({ incident: toIncidentItem(resolveResult.data as IncidentRow, namesById, []) });
}

export async function GET(request: Request) {
  return listIncidents(request);
}

export async function POST(request: Request) {
  return handleIncidentAction(request);
}
