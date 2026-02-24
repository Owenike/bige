import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";
import { computeProgressEventChange, type ProgressEventType } from "../../../../lib/member-progress-events";

type ProgressCategory = "inbody" | "goal" | "task";
type ProgressStatus = "active" | "completed" | "archived";

type ProgressRow = {
  id: string;
  category: ProgressCategory;
  title: string;
  note: string | null;
  status: ProgressStatus;
  measured_at: string | null;
  due_at: string | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
};

type ProgressEventRow = {
  id: string;
  entry_id: string;
  entry_category: ProgressCategory;
  entry_title: string;
  event_type: ProgressEventType;
  from_status: ProgressStatus;
  to_status: ProgressStatus;
  from_note: string | null;
  to_note: string | null;
  actor_role: "platform_admin" | "manager" | "frontdesk" | "coach" | "member";
  created_at: string;
};

function tableMissing(message: string | undefined, tableName: string) {
  const text = (message || "").toLowerCase();
  return (
    text.includes(`relation "${tableName.toLowerCase()}" does not exist`) ||
    text.includes(`relation '${tableName.toLowerCase()}' does not exist`)
  );
}

function normalizeText(input: unknown, maxLen = 200) {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function toOptionalText(input: unknown, maxLen = 1000) {
  const value = normalizeText(input, maxLen);
  return value || null;
}

function toOptionalNumber(input: unknown) {
  if (input === null || input === undefined || input === "") return null;
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toOptionalIso(input: unknown) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function loadMember(
  supabase: any,
  tenantId: string,
  memberId: string,
): Promise<{ ok: true; id: string; name: string } | { ok: false; response: NextResponse }> {
  const memberResult = await supabase
    .from("members")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .eq("id", memberId)
    .maybeSingle();
  if (memberResult.error || !memberResult.data) {
    return { ok: false, response: NextResponse.json({ error: "Member not found" }, { status: 404 }) };
  }
  return {
    ok: true,
    id: String(memberResult.data.id),
    name: memberResult.data.full_name ? String(memberResult.data.full_name) : "",
  };
}

function mapInBodyPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return { weightKg: null, bodyFatPct: null, muscleKg: null };
  }
  return {
    weightKg: toOptionalNumber(payload.weightKg),
    bodyFatPct: toOptionalNumber(payload.bodyFatPct),
    muscleKg: toOptionalNumber(payload.muscleKg),
  };
}

function mapGoalPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return { targetValue: null, unit: null };
  }
  return {
    targetValue: toOptionalNumber(payload.targetValue),
    unit: toOptionalText(payload.unit, 30),
  };
}

function mapTaskPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return { source: "coach" as const };
  }
  return {
    source: payload.source === "member" ? "member" as const : "coach" as const,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const memberId = normalizeText(new URL(request.url).searchParams.get("memberId"), 80);
  if (!memberId) return NextResponse.json({ error: "memberId is required" }, { status: 400 });

  const member = await loadMember(auth.supabase, auth.context.tenantId, memberId);
  if (!member.ok) return member.response;

  const entriesResult = await auth.supabase
    .from("member_progress_entries")
    .select("id, category, title, note, status, measured_at, due_at, payload, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (entriesResult.error) {
    if (tableMissing(entriesResult.error.message, "member_progress_entries")) {
      return NextResponse.json({
        available: false,
        member: { id: member.id, name: member.name },
        inbody: [],
        goals: [],
        tasks: [],
      });
    }
    return NextResponse.json({ error: entriesResult.error.message }, { status: 500 });
  }

  const rows = (entriesResult.data || []) as ProgressRow[];
  const eventsResult = await auth.supabase
    .from("member_progress_events")
    .select("id, entry_id, entry_category, entry_title, event_type, from_status, to_status, from_note, to_note, actor_role, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(300);

  let feedbackEvents: Array<{
    id: string;
    entryId: string;
    category: ProgressCategory;
    title: string;
    eventType: ProgressEventType;
    fromStatus: ProgressStatus;
    toStatus: ProgressStatus;
    fromNote: string | null;
    toNote: string | null;
    actorRole: "platform_admin" | "manager" | "frontdesk" | "coach" | "member";
    createdAt: string;
  }> = [];
  if (!eventsResult.error) {
    feedbackEvents = ((eventsResult.data || []) as ProgressEventRow[])
      .filter((row) => row.entry_category === "goal" || row.entry_category === "task")
      .map((row) => ({
        id: row.id,
        entryId: row.entry_id,
        category: row.entry_category,
        title: row.entry_title,
        eventType: row.event_type,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        fromNote: row.from_note,
        toNote: row.to_note,
        actorRole: row.actor_role,
        createdAt: row.created_at,
      }));
  } else if (!tableMissing(eventsResult.error.message, "member_progress_events")) {
    return NextResponse.json({ error: eventsResult.error.message }, { status: 500 });
  }

  const inbody = rows
    .filter((row) => row.category === "inbody")
    .map((row) => ({
      id: row.id,
      title: row.title,
      note: row.note,
      status: row.status,
      measuredAt: row.measured_at || row.created_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...mapInBodyPayload(row.payload),
    }));
  const goals = rows
    .filter((row) => row.category === "goal")
    .map((row) => ({
      id: row.id,
      title: row.title,
      note: row.note,
      status: row.status,
      dueAt: row.due_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...mapGoalPayload(row.payload),
    }));
  const tasks = rows
    .filter((row) => row.category === "task")
    .map((row) => ({
      id: row.id,
      title: row.title,
      note: row.note,
      status: row.status,
      dueAt: row.due_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...mapTaskPayload(row.payload),
    }));

  return NextResponse.json({
    available: true,
    member: { id: member.id, name: member.name },
    inbody,
    goals,
    tasks,
    feedbackEvents,
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const action = normalizeText(body?.action, 40);
  const memberId = normalizeText(body?.memberId, 80);
  if (!memberId) return NextResponse.json({ error: "memberId is required" }, { status: 400 });

  const member = await loadMember(auth.supabase, auth.context.tenantId, memberId);
  if (!member.ok) return member.response;

  const nowIso = new Date().toISOString();

  if (action === "add_goal") {
    const title = normalizeText(body?.title, 120);
    const note = toOptionalText(body?.note, 1000);
    const dueAt = toOptionalIso(body?.dueAt);
    const targetValue = toOptionalNumber(body?.targetValue);
    const unit = toOptionalText(body?.unit, 30);
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const result = await auth.supabase
      .from("member_progress_entries")
      .insert({
        tenant_id: auth.context.tenantId,
        member_id: member.id,
        category: "goal",
        title,
        note,
        status: "active",
        due_at: dueAt,
        payload: { targetValue, unit },
        created_by: auth.context.userId,
        updated_by: auth.context.userId,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle();

    if (result.error) {
      if (tableMissing(result.error.message, "member_progress_entries")) {
        return NextResponse.json({ error: "Progress table is not available. Apply latest migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: result.data?.id }, { status: 201 });
  }

  if (action === "add_task") {
    const title = normalizeText(body?.title, 120);
    const note = toOptionalText(body?.note, 1000);
    const dueAt = toOptionalIso(body?.dueAt);
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const result = await auth.supabase
      .from("member_progress_entries")
      .insert({
        tenant_id: auth.context.tenantId,
        member_id: member.id,
        category: "task",
        title,
        note,
        status: "active",
        due_at: dueAt,
        payload: { source: "coach" },
        created_by: auth.context.userId,
        updated_by: auth.context.userId,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle();

    if (result.error) {
      if (tableMissing(result.error.message, "member_progress_entries")) {
        return NextResponse.json({ error: "Progress table is not available. Apply latest migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: result.data?.id }, { status: 201 });
  }

  if (action === "add_inbody") {
    const measuredAt = toOptionalIso(body?.measuredAt) || nowIso;
    const note = toOptionalText(body?.note, 1000);
    const weightKg = toOptionalNumber(body?.weightKg);
    const bodyFatPct = toOptionalNumber(body?.bodyFatPct);
    const muscleKg = toOptionalNumber(body?.muscleKg);
    if (weightKg === null && bodyFatPct === null && muscleKg === null) {
      return NextResponse.json({ error: "At least one metric is required" }, { status: 400 });
    }

    const result = await auth.supabase
      .from("member_progress_entries")
      .insert({
        tenant_id: auth.context.tenantId,
        member_id: member.id,
        category: "inbody",
        title: "InBody",
        note,
        status: "active",
        measured_at: measuredAt,
        payload: { weightKg, bodyFatPct, muscleKg },
        created_by: auth.context.userId,
        updated_by: auth.context.userId,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle();

    if (result.error) {
      if (tableMissing(result.error.message, "member_progress_entries")) {
        return NextResponse.json({ error: "Progress table is not available. Apply latest migrations first." }, { status: 501 });
      }
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: result.data?.id }, { status: 201 });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function PATCH(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const action = normalizeText(body?.action, 40);
  if (action !== "set_status") return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const memberId = normalizeText(body?.memberId, 80);
  const entryId = normalizeText(body?.entryId, 80);
  const status = normalizeText(body?.status, 40) as ProgressStatus;
  if (!memberId) return NextResponse.json({ error: "memberId is required" }, { status: 400 });
  if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
  if (!["active", "completed", "archived"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const member = await loadMember(auth.supabase, auth.context.tenantId, memberId);
  if (!member.ok) return member.response;

  const hasNote = Object.prototype.hasOwnProperty.call(body || {}, "note");
  const nextNote = hasNote ? toOptionalText(body?.note, 1000) : null;

  const currentResult = await auth.supabase
    .from("member_progress_entries")
    .select("id, category, title, status, note")
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", member.id)
    .eq("id", entryId)
    .maybeSingle();

  if (currentResult.error) {
    if (tableMissing(currentResult.error.message, "member_progress_entries")) {
      return NextResponse.json({ error: "Progress table is not available. Apply latest migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: currentResult.error.message }, { status: 500 });
  }
  if (!currentResult.data) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  const current = currentResult.data as {
    id: string;
    category: ProgressCategory;
    title: string;
    status: ProgressStatus;
    note: string | null;
  };
  const eventChange = computeProgressEventChange({
    currentStatus: current.status,
    nextStatus: status,
    currentNote: current.note,
    nextNoteInput: nextNote,
    hasNote,
  });
  if (!eventChange.changed) {
    return NextResponse.json({ ok: true, entryId, status, changed: false });
  }

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    status,
    updated_by: auth.context.userId,
    updated_at: nowIso,
  };
  if (hasNote) update.note = eventChange.targetNote;

  const result = await auth.supabase
    .from("member_progress_entries")
    .update(update)
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", member.id)
    .eq("id", entryId)
    .select("id")
    .maybeSingle();

  if (result.error) {
    if (tableMissing(result.error.message, "member_progress_entries")) {
      return NextResponse.json({ error: "Progress table is not available. Apply latest migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  if (!result.data) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  const eventResult = await auth.supabase
    .from("member_progress_events")
    .insert({
      tenant_id: auth.context.tenantId,
      member_id: member.id,
      entry_id: current.id,
      entry_category: current.category,
      entry_title: current.title,
      event_type: eventChange.eventType as ProgressEventType,
      from_status: current.status,
      to_status: status,
      from_note: current.note,
      to_note: eventChange.targetNote,
      actor_id: auth.context.userId,
      actor_role: auth.context.role,
      created_at: nowIso,
    });

  const eventLogFailed = Boolean(eventResult.error && !tableMissing(eventResult.error.message, "member_progress_events"));

  return NextResponse.json({ ok: true, entryId, status, eventLogged: !eventLogFailed });
}
