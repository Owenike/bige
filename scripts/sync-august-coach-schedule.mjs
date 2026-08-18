import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { buildAugustImportPlan } from "./import-august-coach-schedule.mjs";

const PERIOD_START = "2026-08-01";
const PERIOD_END = "2026-08-31";
const PERIOD_END_EXCLUSIVE = "2026-09-01";
const DEFAULT_SOURCE = "C:\\Users\\User\\Downloads\\8月教練預約本.xlsx- (2).xlsx";
const APPLY_CONFIRMATION = "SYNC_2026_08";
const EXPECTED_COACHES = ["Becky", "Wiwi", "Lily", "Wade", "Una", "Bae", "Owen"];
const ACTIVE_STATUSES = new Set(["pending", "confirmed", "booked", "checked_in"]);
const PRESERVED_OPERATIONAL_STATUSES = new Set(["completed", "no_show"]);
const COURSE_LABELS = {
  weight_training: "重訓",
  reformer_pilates: "器械皮拉提斯",
  relaxation: "筋膜放鬆",
  sports_cupping: "運動拔罐",
  fascia_knife: "筋膜刀",
  onsite_assessment: "現場評估",
};
const TRIAL_SERVICES = {
  weight_training: "weight_training",
  reformer_pilates: "pilates",
  relaxation: "sports_massage",
  onsite_assessment: "onsite_assessment",
};

const clean = (value) => String(value ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
const compact = (value) => clean(value).replace(/\s+/g, "");
const normalizePhone = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const toIso = (date, time, durationMinutes = 0) => {
  const value = new Date(`${date}T${time}:00+08:00`);
  value.setMinutes(value.getMinutes() + durationMinutes);
  return value.toISOString();
};
const cellKey = (date, time, coach) => `${date}|${String(time).slice(0, 5)}|${coach}`;
const noteKey = (date, time, coach, content) => `${cellKey(date, time, coach)}|${clean(content)}`;

function taipeiParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return { date: `${pick("year")}-${pick("month")}-${pick("day")}`, time: `${pick("hour")}:${pick("minute")}` };
}

function parseArgs(argv) {
  const args = { apply: false, verifyOnly: false, source: DEFAULT_SOURCE, confirm: null };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--verify-only") args.verifyOnly = true;
    else if (arg.startsWith("--source=")) args.source = path.resolve(arg.slice("--source=".length));
    else if (arg.startsWith("--confirm-sync-august=")) args.confirm = arg.slice("--confirm-sync-august=".length);
  }
  return args;
}

function loadDotEnv(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

async function createAdminClient() {
  try { loadDotEnv(await fs.readFile(path.resolve(".env.local"), "utf8")); } catch {}
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireData(query, label) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data || [];
}

async function mutateIds(rows, mutate, chunkSize = 100) {
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    await mutate(rows.slice(offset, offset + chunkSize).map((row) => row.id));
  }
}

async function insertWithFallback(supabase, table, items, selectColumns, chunkSize = 75) {
  const inserted = [];
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    const chunk = items.slice(offset, offset + chunkSize);
    const result = await supabase.from(table).insert(chunk.map((item) => item.payload)).select(selectColumns);
    if (!result.error) {
      inserted.push(...(result.data || []));
      continue;
    }
    for (const item of chunk) {
      const single = await supabase.from(table).insert(item.payload).select(selectColumns).maybeSingle();
      if (single.error || !single.data) throw new Error(`${table}:${item.sourceRowKey}:${single.error?.message || "insert_failed"}`);
      inserted.push(single.data);
    }
  }
  return inserted;
}

async function loadContext(supabase) {
  const profileMatches = await requireData(
    supabase.from("profiles").select("id, tenant_id, english_name, display_name, employee_number, branch_id, is_active").eq("is_active", true),
    "讀取教練",
  );
  const namesByTenant = new Map();
  for (const profile of profileMatches) {
    const names = namesByTenant.get(profile.tenant_id) || new Set();
    if (profile.english_name) names.add(clean(profile.english_name).toLowerCase());
    namesByTenant.set(profile.tenant_id, names);
  }
  const tenantIds = [...namesByTenant.entries()]
    .filter(([, names]) => EXPECTED_COACHES.every((name) => names.has(name.toLowerCase())))
    .map(([tenantId]) => tenantId);
  if (tenantIds.length !== 1) throw new Error(`無法唯一判定正式場館（符合數量：${tenantIds.length}）`);
  const tenantId = tenantIds[0];
  const profiles = profileMatches.filter((profile) => profile.tenant_id === tenantId);
  const coachByName = new Map();
  const coachNameById = new Map();
  for (const profile of profiles) {
    if (profile.english_name) coachNameById.set(profile.id, profile.english_name);
    for (const value of [profile.english_name, profile.display_name, profile.employee_number]) {
      if (value) coachByName.set(clean(value).toLowerCase(), profile);
    }
  }
  for (const name of EXPECTED_COACHES) if (!coachByName.has(name.toLowerCase())) throw new Error(`找不到教練帳號：${name}`);
  const branchId = EXPECTED_COACHES.map((name) => coachByName.get(name.toLowerCase())?.branch_id).find(Boolean) || null;

  const [bookings, notes, trials, businessDays, members, legacyNumbers] = await Promise.all([
    requireData(supabase.from("bookings").select("*").eq("tenant_id", tenantId).eq("is_bige_schedule", true).gte("starts_at", `${PERIOD_START}T00:00:00+08:00`).lt("starts_at", `${PERIOD_END_EXCLUSIVE}T00:00:00+08:00`), "讀取 8 月排課"),
    requireData(supabase.from("bige_schedule_notes").select("*").eq("tenant_id", tenantId).gte("starts_at", `${PERIOD_START}T00:00:00+08:00`).lt("starts_at", `${PERIOD_END_EXCLUSIVE}T00:00:00+08:00`), "讀取 8 月自由文字"),
    requireData(supabase.from("trial_bookings").select("*").gte("appointment_date", PERIOD_START).lte("appointment_date", PERIOD_END), "讀取 8 月體驗預約"),
    requireData(supabase.from("bige_business_day_settings").select("*").eq("tenant_id", tenantId).gte("business_date", PERIOD_START).lte("business_date", PERIOD_END), "讀取 8 月營業日"),
    requireData(supabase.from("members").select("id, full_name, phone, member_code, is_prospect").eq("tenant_id", tenantId), "讀取會員"),
    requireData(supabase.from("bige_member_legacy_numbers").select("*").eq("tenant_id", tenantId), "讀取會員舊編號"),
  ]);
  return { tenantId, branchId, profiles, coachByName, coachNameById, bookings, notes, trials, businessDays, members, legacyNumbers };
}

function ordinaryNotes(notes) {
  return notes.filter((row) => row.system_kind !== "fa_assistant_to")
    .filter((row) => !String(row.import_row_key || "").startsWith("coach-day-status:"));
}

function buildReconciliation(plan, context) {
  const issues = [...plan.members, ...plan.schedules, ...plan.notes, ...plan.businessDays].filter((row) => row.issues?.length);
  if (issues.length) throw new Error(`Excel 驗證仍有 ${issues.length} 筆異常`);
  const memberById = new Map(context.members.map((row) => [row.id, row]));
  const currentByCell = new Map();
  for (const booking of context.bookings.filter((row) => row.status !== "cancelled")) {
    const local = taipeiParts(booking.starts_at);
    const key = cellKey(local.date, local.time, context.coachNameById.get(booking.coach_id));
    const rows = currentByCell.get(key) || [];
    rows.push(booking);
    currentByCell.set(key, rows);
  }
  const desiredByCell = new Map(plan.schedules.map((row) => [cellKey(row.date, row.time, row.coach), row]));
  const selectedBookings = new Map();
  const insertBookings = [];
  const protectedMismatches = [];
  const duplicateVisibleCells = [];
  for (const row of plan.schedules) {
    const key = cellKey(row.date, row.time, row.coach);
    const candidates = currentByCell.get(key) || [];
    if (candidates.length > 1) duplicateVisibleCells.push({ key, ids: candidates.map((item) => item.id) });
    const exact = candidates.find((booking) => {
      const member = memberById.get(booking.member_id);
      return member?.full_name === row.name
        && booking.operation_kind === row.operationKind
        && booking.course_type === row.courseType;
    });
    if (exact) selectedBookings.set(row.sourceRowKey, exact);
    else {
      const operational = candidates.filter((booking) => PRESERVED_OPERATIONAL_STATUSES.has(booking.status));
      if (operational.length) protectedMismatches.push({ key, desired: row.sourceRowKey, ids: operational.map((item) => item.id) });
      insertBookings.push(row);
    }
  }
  const selectedIds = new Set([...selectedBookings.values()].map((row) => row.id));
  const cancelBookings = context.bookings.filter((row) => ACTIVE_STATUSES.has(row.status) && !selectedIds.has(row.id));
  const desiredKeys = new Set(plan.schedules.map((row) => row.sourceRowKey));
  const releaseHistoricalKeys = context.bookings.filter((row) =>
    row.status === "cancelled" && row.import_row_key && desiredKeys.has(row.import_row_key) && !selectedIds.has(row.id),
  );
  const bookingByImportKey = new Map(context.bookings.filter((row) => row.import_row_key).map((row) => [row.import_row_key, row]));
  const cancellableIds = new Set([...cancelBookings, ...releaseHistoricalKeys].map((row) => row.id));
  const importKeyConflicts = [];
  for (const row of plan.schedules) {
    const owner = bookingByImportKey.get(row.sourceRowKey);
    const selected = selectedBookings.get(row.sourceRowKey);
    if (owner && owner.id !== selected?.id && !cancellableIds.has(owner.id)) {
      importKeyConflicts.push({ sourceRowKey: row.sourceRowKey, ownerId: owner.id, selectedId: selected?.id || null });
    }
  }

  const currentNotesBySignature = new Map();
  for (const note of ordinaryNotes(context.notes)) {
    const local = taipeiParts(note.starts_at);
    const key = noteKey(local.date, local.time, context.coachNameById.get(note.coach_id), note.content);
    const rows = currentNotesBySignature.get(key) || [];
    rows.push(note);
    currentNotesBySignature.set(key, rows);
  }
  const generatedToBySignature = new Map();
  for (const note of context.notes.filter((row) => row.system_kind === "fa_assistant_to")) {
    const local = taipeiParts(note.starts_at);
    const key = noteKey(local.date, local.time, context.coachNameById.get(note.coach_id), note.content);
    const rows = generatedToBySignature.get(key) || [];
    rows.push(note);
    generatedToBySignature.set(key, rows);
  }
  const selectedNotes = new Map();
  const insertNotes = [];
  for (const row of plan.notes) {
    const signature = noteKey(row.date, row.time, row.coach, row.content);
    const ordinaryCandidates = currentNotesBySignature.get(signature) || [];
    const generatedCandidates = compact(row.content).toUpperCase() === "TO"
      ? generatedToBySignature.get(signature) || []
      : [];
    const candidates = [...ordinaryCandidates, ...generatedCandidates];
    const exact = candidates.find((note) => ![...selectedNotes.values()].some((selected) => selected.id === note.id));
    if (exact) selectedNotes.set(row.sourceRowKey, exact);
    else insertNotes.push(row);
  }
  const selectedNoteIds = new Set([...selectedNotes.values()].map((row) => row.id));
  const deleteNotes = ordinaryNotes(context.notes).filter((row) => !selectedNoteIds.has(row.id));

  return {
    selectedBookings,
    insertBookings,
    cancelBookings,
    releaseHistoricalKeys,
    selectedNotes,
    insertNotes,
    deleteNotes,
    protectedMismatches,
    duplicateVisibleCells,
    importKeyConflicts,
    desiredByCell,
    summary: {
      desiredBookings: plan.schedules.length,
      preserveBookings: selectedBookings.size,
      insertBookings: insertBookings.length,
      cancelBookings: cancelBookings.length,
      releaseHistoricalKeys: releaseHistoricalKeys.length,
      desiredNotes: plan.notes.length,
      preserveNotes: selectedNotes.size,
      insertNotes: insertNotes.length,
      deleteNotes: deleteNotes.length,
      preservedCompleted: [...selectedBookings.values()].filter((row) => row.status === "completed").length,
      preservedNoShow: [...selectedBookings.values()].filter((row) => row.status === "no_show").length,
      protectedMismatches: protectedMismatches.length,
      duplicateVisibleCells: duplicateVisibleCells.length,
      importKeyConflicts: importKeyConflicts.length,
    },
  };
}

function previewMemberResolution(plan, context) {
  const legacyByMemberId = new Map(context.legacyNumbers.map((row) => [row.member_id, row.legacy_number]));
  const byLegacyName = new Map();
  for (const member of context.members) {
    const legacy = legacyByMemberId.get(member.id);
    if (legacy) byLegacyName.set(`${member.full_name}|${legacy}`, member);
  }
  let create = 0;
  let promote = 0;
  for (const memberPlan of plan.members) {
    let member = memberPlan.legacyNumber ? byLegacyName.get(`${memberPlan.fullName}|${memberPlan.legacyNumber}`) : null;
    if (!member && memberPlan.phone) member = context.members.find((item) => item.full_name === memberPlan.fullName && normalizePhone(item.phone) === normalizePhone(memberPlan.phone));
    if (!member && !memberPlan.legacyNumber) member = context.members.find((item) => item.full_name === memberPlan.fullName && Boolean(item.is_prospect) === memberPlan.isProspect);
    if (!member && !memberPlan.isProspect) {
      const sameName = context.members.filter((item) => item.full_name === memberPlan.fullName);
      if (sameName.length === 1) member = sameName[0];
    }
    if (!member) create += 1;
    else if (!memberPlan.isProspect && member.is_prospect) promote += 1;
  }
  return { create, promote };
}

async function resolveMembers(supabase, plan, context, batchId) {
  const memberIdByKey = new Map();
  const existingMembers = [...context.members];
  const legacyNumberByMemberId = new Map(context.legacyNumbers.map((row) => [row.member_id, row.legacy_number]));
  const rebuildLegacyIndex = () => {
    const result = new Map();
    for (const member of existingMembers) {
      const legacy = legacyNumberByMemberId.get(member.id);
      if (legacy) result.set(`${member.full_name}|${legacy}`, member);
    }
    return result;
  };
  for (const memberPlan of plan.members) {
    let byLegacyName = rebuildLegacyIndex();
    let member = memberPlan.legacyNumber ? byLegacyName.get(`${memberPlan.fullName}|${memberPlan.legacyNumber}`) : null;
    if (!member && memberPlan.phone) member = existingMembers.find((item) => item.full_name === memberPlan.fullName && normalizePhone(item.phone) === normalizePhone(memberPlan.phone));
    if (!member && !memberPlan.legacyNumber) member = existingMembers.find((item) => item.full_name === memberPlan.fullName && Boolean(item.is_prospect) === memberPlan.isProspect);
    if (!member && !memberPlan.isProspect) {
      const sameName = existingMembers.filter((item) => item.full_name === memberPlan.fullName);
      if (sameName.length === 1) member = sameName[0];
    }
    if (!member) {
      const phoneOwned = memberPlan.phone
        ? existingMembers.some((item) => normalizePhone(item.phone) === normalizePhone(memberPlan.phone) && item.full_name !== memberPlan.fullName)
        : false;
      const primaryPhone = phoneOwned ? null : memberPlan.phone;
      let memberCode = null;
      if (!memberPlan.isProspect) {
        const code = await supabase.rpc("next_bige_member_code");
        if (code.error || !code.data) throw new Error(`會員編號建立失敗：${memberPlan.fullName}:${code.error?.message || "no_code"}`);
        memberCode = code.data;
      }
      member = await requireData(supabase.from("members").insert({
        tenant_id: context.tenantId,
        store_id: context.branchId,
        full_name: memberPlan.fullName,
        phone: primaryPhone,
        phone_normalized: primaryPhone,
        member_code: memberCode,
        is_prospect: memberPlan.isProspect,
        email_unavailable: true,
      }).select("id, full_name, phone, member_code, is_prospect").maybeSingle(), `建立會員 ${memberPlan.fullName}`);
      if (!member?.id) throw new Error(`建立會員失敗：${memberPlan.fullName}`);
      existingMembers.push(member);
    }
    if (!memberPlan.isProspect && member.is_prospect) {
      let memberCode = member.member_code;
      if (!memberCode) {
        const code = await supabase.rpc("next_bige_member_code");
        if (code.error || !code.data) throw new Error(`會員升級編號建立失敗：${memberPlan.fullName}:${code.error?.message || "no_code"}`);
        memberCode = code.data;
      }
      const promoted = await requireData(supabase.from("members").update({ is_prospect: false, member_code: memberCode, updated_at: new Date().toISOString() }).eq("id", member.id).select("id, full_name, phone, member_code, is_prospect").maybeSingle(), `升級正式會員 ${memberPlan.fullName}`);
      Object.assign(member, promoted);
    }
    memberIdByKey.set(memberPlan.memberKey, member.id);
    if (memberPlan.legacyNumber && legacyNumberByMemberId.get(member.id) !== memberPlan.legacyNumber) {
      await requireData(supabase.from("bige_member_legacy_numbers").upsert({
        tenant_id: context.tenantId,
        member_id: member.id,
        legacy_number: memberPlan.legacyNumber,
        source: "legacy_schedule_import",
        import_batch_id: batchId,
      }, { onConflict: "tenant_id,member_id" }), `更新會員舊編號 ${memberPlan.fullName}`);
      legacyNumberByMemberId.set(member.id, memberPlan.legacyNumber);
      byLegacyName = rebuildLegacyIndex();
    }
  }
  return memberIdByKey;
}

async function resolveTrials(supabase, plan, context, reconciliation, memberIdByKey, batchId) {
  const trialIdByBookingKey = new Map();
  const trialById = new Map(context.trials.map((row) => [row.id, row]));
  const byImportKey = new Map(context.trials.filter((row) => row.import_row_key).map((row) => [row.import_row_key, row]));
  const byIdentity = new Map(context.trials.map((row) => [
    `${row.appointment_date}|${String(row.appointment_time || "").slice(0, 5)}|${clean(row.name)}|${normalizePhone(row.phone)}`,
    row,
  ]));
  for (const row of plan.schedules.filter((item) => item.operationKind === "trial")) {
    const selectedBooking = reconciliation.selectedBookings.get(row.sourceRowKey);
    const linked = selectedBooking?.trial_booking_id ? trialById.get(selectedBooking.trial_booking_id) : null;
    const importKey = `trial:${row.sourceRowKey}`;
    const identity = `${row.date}|${row.time}|${clean(row.name)}|${normalizePhone(row.phone)}`;
    let trial = linked || byImportKey.get(importKey) || byIdentity.get(identity) || null;
    const memberId = memberIdByKey.get(row.memberKey);
    if (!memberId) throw new Error(`找不到 FA 會員：${row.sourceRowKey}`);
    if (!trial) {
      trial = await requireData(supabase.from("trial_bookings").insert({
        name: row.name,
        phone: row.phone,
        service: TRIAL_SERVICES[row.courseType],
        preferred_time: "other",
        note: null,
        schedule_note: "舊預約本匯入",
        payment_method: "cash_on_site",
        payment_status: "pending_cash",
        amount: 0,
        currency: "TWD",
        source: "legacy_schedule_import",
        booking_status: "scheduled",
        appointment_date: row.date,
        appointment_time: row.time,
        booking_coach: "舊預約本匯入",
        executing_coach: row.coach,
        line_notification_status: "not_sent",
        member_id: memberId,
        import_batch_id: batchId,
        import_row_key: importKey,
        exclude_from_marketing_stats: true,
      }).select("*").maybeSingle(), `建立 FA ${row.sourceRowKey}`);
      if (!trial?.id) throw new Error(`建立 FA 失敗：${row.sourceRowKey}`);
      context.trials.push(trial);
      trialById.set(trial.id, trial);
      byImportKey.set(importKey, trial);
      byIdentity.set(identity, trial);
    } else if (trial.source === "legacy_schedule_import") {
      const updated = await requireData(supabase.from("trial_bookings").update({
        name: row.name,
        phone: row.phone,
        service: TRIAL_SERVICES[row.courseType],
        appointment_date: row.date,
        appointment_time: row.time,
        executing_coach: row.coach,
        member_id: memberId,
        import_batch_id: batchId,
        import_row_key: importKey,
        exclude_from_marketing_stats: true,
        updated_at: new Date().toISOString(),
      }).eq("id", trial.id).select("*").maybeSingle(), `更新 FA ${row.sourceRowKey}`);
      trial = updated;
    }
    trialIdByBookingKey.set(row.sourceRowKey, trial.id);
  }
  return trialIdByBookingKey;
}

function bookingPayload(row, context, memberId, trialBookingId, batchId) {
  const coach = context.coachByName.get(row.coach.toLowerCase());
  return {
    tenant_id: context.tenantId,
    branch_id: coach.branch_id || context.branchId,
    member_id: memberId,
    coach_id: coach.id,
    service_name: COURSE_LABELS[row.courseType],
    starts_at: toIso(row.date, row.time),
    ends_at: toIso(row.date, row.time, row.durationMinutes),
    status: "booked",
    note: null,
    is_bige_schedule: true,
    operation_kind: row.operationKind,
    course_type: row.courseType,
    trial_stage: row.trialStage,
    operation_result: null,
    trial_booking_id: trialBookingId,
    reminder_status: "pending",
    operation_idempotency_key: `legacy-august:${row.sourceRowKey}`,
    import_batch_id: batchId,
    import_row_key: row.sourceRowKey,
    requires_contract_followup: row.operationKind === "pt",
  };
}

async function syncBookings(supabase, plan, context, reconciliation, memberIdByKey, trialIdByBookingKey, batchId) {
  const bookingIdByKey = new Map();
  for (const row of plan.schedules) {
    const memberId = memberIdByKey.get(row.memberKey);
    const trialBookingId = row.operationKind === "trial" ? trialIdByBookingKey.get(row.sourceRowKey) : null;
    if (!memberId || (row.operationKind === "trial" && !trialBookingId)) throw new Error(`排課相依資料未解析：${row.sourceRowKey}`);
    const existing = reconciliation.selectedBookings.get(row.sourceRowKey);
    if (!existing) continue;
    const full = bookingPayload(row, context, memberId, trialBookingId, batchId);
    const update = PRESERVED_OPERATIONAL_STATUSES.has(existing.status)
      ? { import_batch_id: batchId, import_row_key: row.sourceRowKey, updated_at: new Date().toISOString() }
      : {
          branch_id: full.branch_id,
          member_id: full.member_id,
          coach_id: full.coach_id,
          service_name: full.service_name,
          starts_at: full.starts_at,
          ends_at: full.ends_at,
          operation_kind: full.operation_kind,
          course_type: full.course_type,
          trial_stage: full.trial_stage,
          trial_booking_id: full.trial_booking_id,
          import_batch_id: batchId,
          import_row_key: row.sourceRowKey,
          requires_contract_followup: full.requires_contract_followup,
          updated_at: new Date().toISOString(),
        };
    const updated = await requireData(supabase.from("bookings").update(update).eq("id", existing.id).select("id").maybeSingle(), `更新排課 ${row.sourceRowKey}`);
    if (!updated?.id) throw new Error(`更新排課失敗：${row.sourceRowKey}`);
    bookingIdByKey.set(row.sourceRowKey, updated.id);
  }
  const insertItems = reconciliation.insertBookings.map((row) => ({
    sourceRowKey: row.sourceRowKey,
    payload: bookingPayload(row, context, memberIdByKey.get(row.memberKey), row.operationKind === "trial" ? trialIdByBookingKey.get(row.sourceRowKey) : null, batchId),
  }));
  const inserted = await insertWithFallback(supabase, "bookings", insertItems, "id, import_row_key");
  for (const row of inserted) bookingIdByKey.set(row.import_row_key, row.id);
  return bookingIdByKey;
}

async function syncNotes(supabase, plan, context, reconciliation, batchId) {
  const noteIdByKey = new Map();
  for (const row of plan.notes) {
    const existing = reconciliation.selectedNotes.get(row.sourceRowKey);
    if (!existing) continue;
    if (existing.source === "legacy_schedule_import") {
      const updated = await requireData(supabase.from("bige_schedule_notes").update({
        import_batch_id: batchId,
        import_row_key: row.sourceRowKey,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id).select("id").maybeSingle(), `更新自由文字 ${row.sourceRowKey}`);
      noteIdByKey.set(row.sourceRowKey, updated.id);
    } else noteIdByKey.set(row.sourceRowKey, existing.id);
  }
  const insertItems = reconciliation.insertNotes.map((row) => ({
    sourceRowKey: row.sourceRowKey,
    payload: {
      tenant_id: context.tenantId,
      branch_id: context.branchId,
      coach_id: context.coachByName.get(row.coach.toLowerCase()).id,
      starts_at: toIso(row.date, row.time),
      ends_at: toIso(row.date, row.time, 60),
      content: row.content,
      import_batch_id: batchId,
      import_row_key: row.sourceRowKey,
      source: "legacy_schedule_import",
    },
  }));
  const inserted = await insertWithFallback(supabase, "bige_schedule_notes", insertItems, "id, import_row_key");
  for (const row of inserted) noteIdByKey.set(row.import_row_key, row.id);
  return noteIdByKey;
}

async function syncBusinessDays(supabase, plan, context, batchId) {
  const payload = plan.businessDays.map((row) => ({
    tenant_id: context.tenantId,
    branch_id: context.branchId,
    business_date: row.date,
    is_closed: row.isClosed,
    closure_label: row.closureLabel,
    frontdesk_name: row.frontdeskName,
    source: "legacy_schedule_import",
    import_batch_id: batchId,
  }));
  const result = await requireData(supabase.from("bige_business_day_settings").upsert(payload, { onConflict: "tenant_id,business_date" }).select("id, business_date"), "同步營業日");
  return new Map(result.map((row) => [row.business_date, row.id]));
}

async function writeAuditRows(supabase, plan, context, batchId, memberIdByKey, bookingIdByKey, noteIdByKey, businessIdByDate) {
  const rows = [
    ...plan.members.map((row) => ({ row, itemKind: "member", targetType: "member", targetId: memberIdByKey.get(row.memberKey) })),
    ...plan.schedules.map((row) => ({ row, itemKind: "booking", targetType: "booking", targetId: bookingIdByKey.get(row.sourceRowKey) })),
    ...plan.notes.map((row) => ({ row, itemKind: "note", targetType: "schedule_note", targetId: noteIdByKey.get(row.sourceRowKey) })),
    ...plan.businessDays.map((row) => ({ row, itemKind: "business_day", targetType: "business_day", targetId: businessIdByDate.get(row.date) })),
  ];
  if (rows.some((item) => !item.targetId)) throw new Error("稽核目標 ID 不完整");
  const now = new Date().toISOString();
  const payload = rows.map(({ row, itemKind, targetType, targetId }) => ({
    batch_id: batchId,
    tenant_id: context.tenantId,
    source_row_key: row.sourceRowKey,
    source_sheet: "總表",
    source_date: row.date || null,
    source_time: row.time || null,
    source_coach: row.coach || null,
    source_value: row.rawContent || row.content || row.fullName || row.frontdeskName || row.closureLabel || null,
    item_kind: itemKind,
    status: "succeeded",
    normalized_payload: row,
    target_type: targetType,
    target_id: targetId,
    attempt_count: 1,
    processed_at: now,
  }));
  for (let offset = 0; offset < payload.length; offset += 150) {
    await requireData(supabase.from("bige_schedule_import_rows").insert(payload.slice(offset, offset + 150)), "寫入逐格稽核");
  }
  return rows.length;
}

async function verifyLive(supabase, plan, contextBefore = null) {
  const context = await loadContext(supabase);
  const memberById = new Map(context.members.map((row) => [row.id, row]));
  const visible = context.bookings.filter((row) => row.status !== "cancelled");
  const liveByCell = new Map();
  for (const booking of visible) {
    const local = taipeiParts(booking.starts_at);
    const key = cellKey(local.date, local.time, context.coachNameById.get(booking.coach_id));
    const rows = liveByCell.get(key) || [];
    rows.push(booking);
    liveByCell.set(key, rows);
  }
  const bookingErrors = [];
  for (const row of plan.schedules) {
    const key = cellKey(row.date, row.time, row.coach);
    const candidates = liveByCell.get(key) || [];
    const exact = candidates.filter((booking) => {
      const member = memberById.get(booking.member_id);
      return member?.full_name === row.name
        && booking.operation_kind === row.operationKind
        && booking.course_type === row.courseType
        && new Date(booking.ends_at).toISOString() === toIso(row.date, row.time, row.durationMinutes);
    });
    if (candidates.length !== 1 || exact.length !== 1) bookingErrors.push({ key, desired: row.sourceRowKey, live: candidates.map((item) => item.id) });
  }
  const desiredCells = new Set(plan.schedules.map((row) => cellKey(row.date, row.time, row.coach)));
  const extraBookings = visible.filter((booking) => {
    const local = taipeiParts(booking.starts_at);
    return !desiredCells.has(cellKey(local.date, local.time, context.coachNameById.get(booking.coach_id)));
  });

  const liveNotesBySignature = new Map();
  for (const note of context.notes.filter((row) => !String(row.import_row_key || "").startsWith("coach-day-status:"))) {
    const local = taipeiParts(note.starts_at);
    const key = noteKey(local.date, local.time, context.coachNameById.get(note.coach_id), note.content);
    const rows = liveNotesBySignature.get(key) || [];
    rows.push(note);
    liveNotesBySignature.set(key, rows);
  }
  const usedNoteIds = new Set();
  const noteErrors = [];
  for (const row of plan.notes) {
    const key = noteKey(row.date, row.time, row.coach, row.content);
    const candidates = (liveNotesBySignature.get(key) || []).sort((a, b) => Number(a.system_kind === "fa_assistant_to") - Number(b.system_kind === "fa_assistant_to"));
    const exact = candidates.find((note) => !usedNoteIds.has(note.id));
    if (exact) usedNoteIds.add(exact.id);
    else noteErrors.push({ key, desired: 1, live: 0 });
  }
  const extraOrdinaryNotes = ordinaryNotes(context.notes).filter((note) => !usedNoteIds.has(note.id));
  for (const note of extraOrdinaryNotes) {
    const local = taipeiParts(note.starts_at);
    noteErrors.push({ key: noteKey(local.date, local.time, context.coachNameById.get(note.coach_id), note.content), desired: 0, live: 1 });
  }

  const businessByDate = new Map(context.businessDays.map((row) => [row.business_date, row]));
  const businessErrors = plan.businessDays.filter((row) => {
    const current = businessByDate.get(row.date);
    return !current || current.is_closed !== row.isClosed || clean(current.closure_label) !== clean(row.closureLabel) || clean(current.frontdesk_name) !== clean(row.frontdeskName);
  });
  const extraBusinessDays = context.businessDays.filter((row) => !plan.businessDays.some((item) => item.date === row.business_date));

  const target = plan.schedules.find((row) => row.date === "2026-08-22" && row.time === "13:00" && row.coach === "Becky");
  const targetBooking = (liveByCell.get("2026-08-22|13:00|Becky") || [])[0];
  const targetMember = targetBooking ? memberById.get(targetBooking.member_id) : null;
  const targetTrial = targetBooking ? context.trials.find((row) => row.id === targetBooking.trial_booking_id) : null;
  const targetOkay = target?.name === "林建宇"
    && target?.phone === "0980120570"
    && target?.courseType === "weight_training"
    && targetBooking?.trial_stage === "FA1"
    && targetMember?.full_name === "林建宇"
    && normalizePhone(targetTrial?.phone) === "0980120570"
    && targetTrial?.service === "weight_training";

  const preservedErrors = [];
  if (contextBefore) {
    const afterById = new Map(context.bookings.map((row) => [row.id, row]));
    for (const before of contextBefore.bookings.filter((row) => PRESERVED_OPERATIONAL_STATUSES.has(row.status))) {
      const after = afterById.get(before.id);
      const keys = ["status", "payment_status", "payment_method", "final_amount", "outstanding_amount", "package_sessions_reserved", "package_sessions_consumed", "completed_at"];
      if (!after || keys.some((key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]))) preservedErrors.push(before.id);
    }
  }
  const result = {
    ok: bookingErrors.length === 0 && extraBookings.length === 0 && noteErrors.length === 0 && businessErrors.length === 0 && extraBusinessDays.length === 0 && targetOkay && preservedErrors.length === 0,
    bookings: { desired: plan.schedules.length, visible: visible.length, errors: bookingErrors.length, extra: extraBookings.length },
    notes: { desired: plan.notes.length, visibleOrdinary: ordinaryNotes(context.notes).length, errors: noteErrors.length },
    businessDays: { desired: plan.businessDays.length, live: context.businessDays.length, errors: businessErrors.length + extraBusinessDays.length },
    target822Becky1300: targetOkay,
    preservedOperationalErrors: preservedErrors,
    statusCounts: Object.fromEntries([...new Set(context.bookings.map((row) => row.status))].sort().map((status) => [status, context.bookings.filter((row) => row.status === status).length])),
    generatedAssistantTo: context.notes.filter((row) => row.system_kind === "fa_assistant_to").length,
  };
  if (!result.ok) {
    const details = { bookingErrors: bookingErrors.slice(0, 10), extraBookings: extraBookings.slice(0, 10).map((row) => row.id), noteErrors: noteErrors.slice(0, 10), businessErrors: businessErrors.map((row) => row.date), extraBusinessDays: extraBusinessDays.map((row) => row.business_date), targetOkay, preservedErrors };
    throw new Error(`正式資料逐格驗證失敗：${JSON.stringify(details)}`);
  }
  return result;
}

async function applySync(supabase, sourcePath, sourceSha256, plan, context, reconciliation) {
  if (reconciliation.protectedMismatches.length || reconciliation.duplicateVisibleCells.length || reconciliation.importKeyConflicts.length) {
    throw new Error("偵測到不可自動取代的已完成/未出席、重複可見格或匯入鍵衝突");
  }
  const totalRows = plan.members.length + plan.schedules.length + plan.notes.length + plan.businessDays.length;
  const batch = await requireData(supabase.from("bige_schedule_import_batches").insert({
    tenant_id: context.tenantId,
    branch_id: context.branchId,
    source_filename: path.basename(sourcePath),
    source_sha256: sourceSha256,
    source_period_start: PERIOD_START,
    source_period_end: PERIOD_END,
    status: "running",
    total_rows: totalRows,
    backup_snapshot: {
      bookings: context.bookings,
      notes: context.notes,
      trialBookings: context.trials,
      businessDays: context.businessDays,
      members: context.members,
      legacyNumbers: context.legacyNumbers,
    },
    metadata: {
      sourcePath,
      mode: "incremental_history_preserving_sync",
      rulesVersion: 2,
      userSuppliedCell: "2026-08-22|13:00|Becky|FA1|林建宇|0980120570|weight_training",
      reconciliation: reconciliation.summary,
    },
  }).select("*").maybeSingle(), "建立同步批次與備份");
  if (!batch?.id) throw new Error("建立同步批次失敗");
  try {
    const now = new Date().toISOString();
    await mutateIds(reconciliation.cancelBookings, async (ids) => {
      await requireData(supabase.from("bookings").update({
        status: "cancelled",
        operation_result: "cancelled",
        status_reason: "新版 8 月教練預約本同步移除",
        status_updated_at: now,
        cancelled_at: now,
        import_row_key: null,
        operation_idempotency_key: null,
        updated_at: now,
      }).in("id", ids), "取消已移除的舊排課");
    });
    await mutateIds(reconciliation.releaseHistoricalKeys, async (ids) => {
      await requireData(supabase.from("bookings").update({ import_row_key: null, operation_idempotency_key: null, updated_at: now }).in("id", ids), "釋放已取消排課稽核鍵");
    });
    await mutateIds(reconciliation.deleteNotes, async (ids) => {
      await requireData(supabase.from("bige_schedule_notes").delete().in("id", ids), "移除新版 Excel 不存在的自由文字");
    });

    const memberIdByKey = await resolveMembers(supabase, plan, context, batch.id);
    const trialIdByBookingKey = await resolveTrials(supabase, plan, context, reconciliation, memberIdByKey, batch.id);
    const bookingIdByKey = await syncBookings(supabase, plan, context, reconciliation, memberIdByKey, trialIdByBookingKey, batch.id);
    const noteIdByKey = await syncNotes(supabase, plan, context, reconciliation, batch.id);
    const businessIdByDate = await syncBusinessDays(supabase, plan, context, batch.id);
    const auditCount = await writeAuditRows(supabase, plan, context, batch.id, memberIdByKey, bookingIdByKey, noteIdByKey, businessIdByDate);
    await requireData(supabase.from("bige_schedule_import_batches").update({
      status: "completed",
      succeeded_rows: auditCount,
      failed_rows: 0,
      skipped_rows: 0,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", batch.id), "完成同步批次");
    return { batchId: batch.id, auditCount };
  } catch (error) {
    await supabase.from("bige_schedule_import_batches").update({
      status: "failed",
      failed_rows: totalRows,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: { ...batch.metadata, failure: error instanceof Error ? error.message : String(error) },
    }).eq("id", batch.id);
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { sourcePath, sourceSha256, plan } = await buildAugustImportPlan(args.source);
  const supabase = await createAdminClient();
  if (args.verifyOnly) {
    console.log(JSON.stringify({ mode: "verify_only", sourcePath, sourceSha256, verification: await verifyLive(supabase, plan) }, null, 2));
    return;
  }
  const context = await loadContext(supabase);
  const reconciliation = buildReconciliation(plan, context);
  const memberChanges = previewMemberResolution(plan, context);
  console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry_run", sourcePath, sourceSha256, ...reconciliation.summary, memberChanges }, null, 2));
  if (!args.apply) return;
  if (args.confirm !== APPLY_CONFIRMATION) throw new Error(`正式同步必須提供 --confirm-sync-august=${APPLY_CONFIRMATION}`);
  const applied = await applySync(supabase, sourcePath, sourceSha256, plan, context, reconciliation);
  const verification = await verifyLive(supabase, plan, context);
  console.log(JSON.stringify({ applied, verification }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
