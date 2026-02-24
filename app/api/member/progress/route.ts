import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";
import { computeProgressEventChange, type ProgressEventType } from "../../../../lib/member-progress-events";

type ProgressCategory = "inbody" | "goal" | "task";
type ProgressStatus = "active" | "completed" | "archived";

type ProgressContext = {
  tenantId: string;
  memberId: string;
  userId: string;
  supabase: any;
};

type ProgressPayloadMap = {
  inbody: {
    weightKg: number | null;
    bodyFatPct: number | null;
    muscleKg: number | null;
  };
  goal: {
    targetValue: number | null;
    unit: string | null;
  };
  task: {
    source: "coach" | "member";
  };
};

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

function tableMissing(message: string | undefined, tableName: string) {
  const text = (message || "").toLowerCase();
  return (
    text.includes(`relation "${tableName.toLowerCase()}" does not exist`) ||
    text.includes(`relation '${tableName.toLowerCase()}' does not exist`)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

async function loadProgressContext(request: Request): Promise<{ ok: true; value: ProgressContext } | { ok: false; response: NextResponse }> {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return { ok: false, response: auth.response };
  if (!auth.context.tenantId) {
    return { ok: false, response: NextResponse.json({ error: "Tenant context is required" }, { status: 400 }) };
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return { ok: false, response: NextResponse.json({ error: "Member not found" }, { status: 404 }) };
  }

  return {
    ok: true,
    value: {
      tenantId: auth.context.tenantId,
      memberId: String(memberResult.data.id),
      userId: auth.context.userId,
      supabase: auth.supabase,
    },
  };
}

function mapPayload<T extends ProgressCategory>(category: T, payload: unknown): ProgressPayloadMap[T] {
  if (!isRecord(payload)) {
    if (category === "inbody") return { weightKg: null, bodyFatPct: null, muscleKg: null } as ProgressPayloadMap[T];
    if (category === "goal") return { targetValue: null, unit: null } as ProgressPayloadMap[T];
    return { source: "member" } as ProgressPayloadMap[T];
  }

  if (category === "inbody") {
    return {
      weightKg: toOptionalNumber(payload.weightKg),
      bodyFatPct: toOptionalNumber(payload.bodyFatPct),
      muscleKg: toOptionalNumber(payload.muscleKg),
    } as ProgressPayloadMap[T];
  }
  if (category === "goal") {
    return {
      targetValue: toOptionalNumber(payload.targetValue),
      unit: toOptionalText(payload.unit, 30),
    } as ProgressPayloadMap[T];
  }
  return {
    source: payload.source === "coach" ? "coach" : "member",
  } as ProgressPayloadMap[T];
}

export async function GET(request: Request) {
  const contextResult = await loadProgressContext(request);
  if (!contextResult.ok) return contextResult.response;
  const { tenantId, memberId, supabase } = contextResult.value;

  const url = new URL(request.url);
  const limitParsed = Number(url.searchParams.get("limit") || 100);
  const limit = Number.isInteger(limitParsed) ? Math.min(200, Math.max(10, limitParsed)) : 100;

  const entriesResult = await supabase
    .from("member_progress_entries")
    .select("id, category, title, note, status, measured_at, due_at, payload, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (entriesResult.error) {
    if (tableMissing(entriesResult.error.message, "member_progress_entries")) {
      return NextResponse.json({
        available: false,
        summary: { checkins30d: 0, redemptions30d: 0, latestCheckinAt: null },
        inbody: [],
        goals: [],
        tasks: [],
      });
    }
    return NextResponse.json({ error: entriesResult.error.message }, { status: 500 });
  }

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [checkins30dResult, redemptions30dResult, latestCheckinResult] = await Promise.all([
    supabase
      .from("checkins")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId)
      .eq("result", "allow")
      .gte("checked_at", since30d),
    supabase
      .from("session_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId)
      .gte("created_at", since30d),
    supabase
      .from("checkins")
      .select("checked_at")
      .eq("tenant_id", tenantId)
      .eq("member_id", memberId)
      .eq("result", "allow")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const rows = (entriesResult.data || []) as ProgressRow[];
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
      ...mapPayload("inbody", row.payload),
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
      ...mapPayload("goal", row.payload),
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
      ...mapPayload("task", row.payload),
    }));

  return NextResponse.json({
    available: true,
    summary: {
      checkins30d: checkins30dResult.error ? 0 : checkins30dResult.count || 0,
      redemptions30d: redemptions30dResult.error ? 0 : redemptions30dResult.count || 0,
      latestCheckinAt: latestCheckinResult.error ? null : latestCheckinResult.data?.checked_at || null,
    },
    inbody,
    goals,
    tasks,
  });
}

export async function POST(request: Request) {
  const contextResult = await loadProgressContext(request);
  if (!contextResult.ok) return contextResult.response;
  const { tenantId, memberId, userId, supabase } = contextResult.value;

  const body = await request.json().catch(() => null);
  const action = normalizeText(body?.action, 40);
  const nowIso = new Date().toISOString();

  if (action === "add_inbody") {
    const measuredAt = toOptionalIso(body?.measuredAt) || nowIso;
    const weightKg = toOptionalNumber(body?.weightKg);
    const bodyFatPct = toOptionalNumber(body?.bodyFatPct);
    const muscleKg = toOptionalNumber(body?.muscleKg);
    const note = toOptionalText(body?.note, 1000);
    if (weightKg === null && bodyFatPct === null && muscleKg === null) {
      return NextResponse.json({ error: "At least one metric is required" }, { status: 400 });
    }

    const result = await supabase
      .from("member_progress_entries")
      .insert({
        tenant_id: tenantId,
        member_id: memberId,
        category: "inbody",
        title: "InBody",
        note,
        status: "active",
        measured_at: measuredAt,
        payload: { weightKg, bodyFatPct, muscleKg },
        created_by: userId,
        updated_by: userId,
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

  if (action === "add_goal") {
    const title = normalizeText(body?.title, 120);
    const note = toOptionalText(body?.note, 1000);
    const dueAt = toOptionalIso(body?.dueAt);
    const targetValue = toOptionalNumber(body?.targetValue);
    const unit = toOptionalText(body?.unit, 30);
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const result = await supabase
      .from("member_progress_entries")
      .insert({
        tenant_id: tenantId,
        member_id: memberId,
        category: "goal",
        title,
        note,
        status: "active",
        due_at: dueAt,
        payload: { targetValue, unit },
        created_by: userId,
        updated_by: userId,
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

    const result = await supabase
      .from("member_progress_entries")
      .insert({
        tenant_id: tenantId,
        member_id: memberId,
        category: "task",
        title,
        note,
        status: "active",
        due_at: dueAt,
        payload: { source: "member" },
        created_by: userId,
        updated_by: userId,
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
  const contextResult = await loadProgressContext(request);
  if (!contextResult.ok) return contextResult.response;
  const { tenantId, memberId, userId, supabase } = contextResult.value;

  const body = await request.json().catch(() => null);
  const action = normalizeText(body?.action, 40);

  if (action !== "set_status") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const entryId = normalizeText(body?.entryId, 80);
  const status = normalizeText(body?.status, 40) as ProgressStatus;
  if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
  if (!["active", "completed", "archived"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const hasNote = Object.prototype.hasOwnProperty.call(body || {}, "note");
  const nextNote = hasNote ? toOptionalText(body?.note, 1000) : null;

  const currentResult = await supabase
    .from("member_progress_entries")
    .select("id, category, title, status, note")
    .eq("tenant_id", tenantId)
    .eq("member_id", memberId)
    .eq("id", entryId)
    .maybeSingle();

  if (currentResult.error) {
    if (tableMissing(currentResult.error.message, "member_progress_entries")) {
      return NextResponse.json({ error: "Progress table is not available. Apply latest migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: currentResult.error.message }, { status: 500 });
  }
  if (!currentResult.data) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

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
    updated_by: userId,
    updated_at: nowIso,
  };
  if (hasNote) update.note = eventChange.targetNote;

  const result = await supabase
    .from("member_progress_entries")
    .update(update)
    .eq("tenant_id", tenantId)
    .eq("member_id", memberId)
    .eq("id", entryId)
    .select("id")
    .maybeSingle();

  if (result.error) {
    if (tableMissing(result.error.message, "member_progress_entries")) {
      return NextResponse.json({ error: "Progress table is not available. Apply latest migrations first." }, { status: 501 });
    }
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  if (!result.data) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const eventResult = await supabase
    .from("member_progress_events")
    .insert({
      tenant_id: tenantId,
      member_id: memberId,
      entry_id: current.id,
      entry_category: current.category,
      entry_title: current.title,
      event_type: eventChange.eventType as ProgressEventType,
      from_status: current.status,
      to_status: status,
      from_note: current.note,
      to_note: eventChange.targetNote,
      actor_id: userId,
      actor_role: "member",
      created_at: nowIso,
    });

  const eventLogFailed = Boolean(eventResult.error && !tableMissing(eventResult.error.message, "member_progress_events"));

  return NextResponse.json({ ok: true, entryId, status, eventLogged: !eventLogFailed });
}
