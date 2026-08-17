import assert from "node:assert/strict";
import test from "node:test";
import {
  BIGE_SCHEDULE_TRASH_DELETE_REASON,
  applyOptimisticFaAssistantToNotes,
  applyScheduleMoveResult,
  analyzeScheduleDrop,
  buildOptimisticFaAssistantToState,
  buildOptimisticScheduleMoveResult,
  findScheduleEditConflict,
  isScheduleBookingDraggable,
  isScheduleTrashDeletedBooking,
  isScheduleDragBlockingNote,
  runOptimisticScheduleMutation,
  type ScheduleDragBooking,
} from "../lib/bige-schedule-drag";
import { buildBigeClassroomConflicts } from "../lib/bige-classroom-conflicts";

const booking = (
  id: string,
  coachId: string,
  startsAt: string,
  minutes = 60,
  status = "booked",
  courseType = "weight_training",
): ScheduleDragBooking & { course_type: string } => ({
  id,
  coach_id: coachId,
  starts_at: startsAt,
  ends_at: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
  status,
  course_type: courseType,
});

test("only trash-deleted cancelled bookings are hidden from schedule views", () => {
  assert.equal(
    isScheduleTrashDeletedBooking({
      status: "cancelled",
      status_reason: BIGE_SCHEDULE_TRASH_DELETE_REASON,
    }),
    true,
  );
  assert.equal(
    isScheduleTrashDeletedBooking({ status: "cancelled", status_reason: null }),
    false,
  );
  assert.equal(
    isScheduleTrashDeletedBooking({
      status: "booked",
      status_reason: BIGE_SCHEDULE_TRASH_DELETE_REASON,
    }),
    false,
  );
});

test("two one-hour PT bookings are grouped when swapping with a two-hour FA", () => {
  const bookings = [
    booking("a-15", "coach-a", "2026-08-03T15:00:00+08:00"),
    booking("a-16", "coach-a", "2026-08-03T16:00:00+08:00"),
    booking("b-fa", "coach-b", "2026-08-03T19:00:00+08:00", 120),
  ];
  const result = analyzeScheduleDrop({
    bookings,
    notes: [],
    sourceBookingId: "a-15",
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T19:00:00+08:00",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.plan.sourceItems.map((item) => item.id), ["a-15", "a-16"]);
  assert.deepEqual(result.plan.targetItems.map((item) => item.id), ["b-fa"]);
  assert.equal(result.plan.spanMinutes, 120);
});

test("extending a schedule edit cannot cover the next active booking", () => {
  const conflict = findScheduleEditConflict({
    bookings: [
      booking("source", "coach-a", "2026-08-03T15:00:00+08:00"),
      booking("next", "coach-a", "2026-08-03T16:00:00+08:00"),
    ],
    notes: [],
    coachId: "coach-a",
    startsAt: "2026-08-03T15:00:00+08:00",
    endsAt: "2026-08-03T17:00:00+08:00",
    excludeBookingId: "source",
  });

  assert.equal(conflict?.kind, "booking");
  assert.equal(conflict?.item.id, "next");
});

test("another member blocks a schedule edit even when the course type matches", () => {
  const conflict = findScheduleEditConflict({
    bookings: [
      booking("source", "coach-a", "2026-08-03T15:00:00+08:00"),
      booking("group-member", "coach-a", "2026-08-03T15:00:00+08:00"),
    ],
    notes: [],
    coachId: "coach-a",
    startsAt: "2026-08-03T15:00:00+08:00",
    endsAt: "2026-08-03T16:00:00+08:00",
    excludeBookingId: "source",
  });

  assert.equal(conflict?.kind, "booking");
  assert.equal(conflict?.item.id, "group-member");
});

test("a different course type still blocks a schedule edit", () => {
  const conflict = findScheduleEditConflict({
    bookings: [
      booking("source", "coach-a", "2026-08-03T15:00:00+08:00"),
      booking("pilates", "coach-a", "2026-08-03T15:00:00+08:00", 60, "booked", "reformer_pilates"),
    ],
    notes: [],
    coachId: "coach-a",
    startsAt: "2026-08-03T15:00:00+08:00",
    endsAt: "2026-08-03T16:00:00+08:00",
    excludeBookingId: "source",
  });

  assert.equal(conflict?.kind, "booking");
  assert.equal(conflict?.item.id, "pilates");
});

test("a third relaxation or Pilates booking creates non-blocking classroom warnings", () => {
  const conflicts = buildBigeClassroomConflicts([
    booking("relax", "coach-a", "2026-08-03T15:00:00+08:00", 60, "booked", "relaxation"),
    booking("pilates-a", "coach-b", "2026-08-03T15:00:00+08:00", 60, "booked", "reformer_pilates"),
    booking("pilates-b", "coach-c", "2026-08-03T15:30:00+08:00", 60, "booked", "reformer_pilates"),
  ]);

  assert.equal(conflicts.length, 3);
  assert.deepEqual(
    conflicts.map((conflict) => conflict.coach_id).sort(),
    ["coach-a", "coach-b", "coach-c"],
  );
  assert.equal(conflicts[0]?.booking_count, 3);
  assert.match(conflicts[0]?.message || "", /教室調度/);
});

test("pairwise overlaps without three simultaneous classroom bookings do not warn", () => {
  const conflicts = buildBigeClassroomConflicts([
    booking("long", "coach-a", "2026-08-03T15:00:00+08:00", 120, "booked", "relaxation"),
    booking("first", "coach-b", "2026-08-03T15:00:00+08:00", 60, "booked", "reformer_pilates"),
    booking("second", "coach-c", "2026-08-03T16:00:00+08:00", 60, "booked", "reformer_pilates"),
  ]);

  assert.deepEqual(conflicts, []);
});

test("a cancelled booking no longer blocks a longer schedule edit", () => {
  const conflict = findScheduleEditConflict({
    bookings: [
      booking("source", "coach-a", "2026-08-03T15:00:00+08:00"),
      booking("cancelled", "coach-a", "2026-08-03T16:00:00+08:00", 60, "cancelled"),
    ],
    notes: [],
    coachId: "coach-a",
    startsAt: "2026-08-03T15:00:00+08:00",
    endsAt: "2026-08-03T17:00:00+08:00",
    excludeBookingId: "source",
  });

  assert.equal(conflict, null);
});

test("free text also blocks a schedule edit that would cover its time", () => {
  const conflict = findScheduleEditConflict({
    bookings: [booking("source", "coach-a", "2026-08-03T15:00:00+08:00")],
    notes: [
      {
        id: "note-16",
        coach_id: "coach-a",
        starts_at: "2026-08-03T16:00:00+08:00",
        ends_at: "2026-08-03T17:00:00+08:00",
        content: "會議",
      },
    ],
    coachId: "coach-a",
    startsAt: "2026-08-03T15:00:00+08:00",
    endsAt: "2026-08-03T17:00:00+08:00",
    excludeBookingId: "source",
  });

  assert.equal(conflict?.kind, "note");
  assert.equal(conflict?.item.id, "note-16");
});

test("a two-hour FA can move from 11:00 to its own occupied 12:00 second hour", () => {
  const source = booking("source-fa", "coach-a", "2026-08-03T11:00:00+08:00", 120);
  const result = analyzeScheduleDrop({
    bookings: [source],
    notes: [],
    sourceBookingId: source.id,
    targetCoachId: "coach-a",
    targetStartsAt: "2026-08-03T12:00:00+08:00",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    new Date(result.plan.targetStartsAt).getTime(),
    new Date("2026-08-03T12:00:00+08:00").getTime(),
  );
  assert.deepEqual(result.plan.sourceItems.map((item) => item.id), ["source-fa"]);
  assert.deepEqual(result.plan.targetItems, []);
});

test("excluding the source FA still detects a real booking in the target slot", () => {
  const source = booking("source-fa", "coach-a", "2026-08-03T11:00:00+08:00", 120);
  const target = booking("real-target", "coach-b", "2026-08-03T12:00:00+08:00");
  const result = analyzeScheduleDrop({
    bookings: [source, target],
    notes: [],
    sourceBookingId: source.id,
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T12:00:00+08:00",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.plan.targetItems.map((item) => item.id), ["real-target"]);
});

test("an empty matching slot stays empty when a one-hour PT swaps with a two-hour FA", () => {
  const bookings = [
    booking("a-15", "coach-a", "2026-08-03T15:00:00+08:00"),
    booking("b-fa", "coach-b", "2026-08-03T19:00:00+08:00", 120),
  ];
  const result = analyzeScheduleDrop({
    bookings,
    notes: [],
    sourceBookingId: "a-15",
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T19:00:00+08:00",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.plan.sourceItems.map((item) => item.id), ["a-15"]);
  assert.equal(result.plan.spanMinutes, 120);
});

test("whole-hour and half-hour bookings cannot cross alignments", () => {
  const result = analyzeScheduleDrop({
    bookings: [booking("source", "coach-a", "2026-08-03T15:00:00+08:00")],
    notes: [],
    sourceBookingId: "source",
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T19:30:00+08:00",
  });
  assert.deepEqual(result, {
    ok: false,
    code: "alignment_mismatch",
    message: "整點課程只能移到整點，半點課程只能移到半點",
  });
});

test("locked bookings and free-text notes block drag operations", () => {
  assert.equal(isScheduleBookingDraggable({ status: "checked_in" }), false);
  const lockedResult = analyzeScheduleDrop({
    bookings: [
      booking("source", "coach-a", "2026-08-03T15:00:00+08:00"),
      booking("locked", "coach-b", "2026-08-03T19:00:00+08:00", 60, "completed"),
    ],
    notes: [],
    sourceBookingId: "source",
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T19:00:00+08:00",
  });
  assert.equal(lockedResult.ok, false);
  if (!lockedResult.ok) assert.equal(lockedResult.code, "booking_locked");

  const noteResult = analyzeScheduleDrop({
    bookings: [booking("source", "coach-a", "2026-08-03T15:00:00+08:00")],
    notes: [
      {
        id: "note",
        coach_id: "coach-b",
        starts_at: "2026-08-03T19:00:00+08:00",
        ends_at: "2026-08-03T20:00:00+08:00",
      },
    ],
    sourceBookingId: "source",
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T19:00:00+08:00",
  });
  assert.equal(noteResult.ok, false);
  if (!noteResult.ok) assert.equal(noteResult.code, "note_blocked");
});

test("shift markers and generated TO notes do not misclassify an FA as free text", () => {
  const noteBase = {
    id: "note",
    coach_id: "coach-b",
    starts_at: "2026-08-03T19:00:00+08:00",
    ends_at: "2026-08-03T20:00:00+08:00",
  };

  assert.equal(isScheduleDragBlockingNote({ ...noteBase, content: "晚" }), false);
  assert.equal(
    isScheduleDragBlockingNote({ ...noteBase, content: "TO", system_kind: "fa_assistant_to" }),
    false,
  );
  assert.equal(isScheduleDragBlockingNote({ ...noteBase, content: "TO" }), true);

  const result = analyzeScheduleDrop({
    bookings: [booking("source-fa", "coach-a", "2026-08-03T15:00:00+08:00", 120)],
    notes: [{ ...noteBase, content: "晚" }],
    sourceBookingId: "source-fa",
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T19:00:00+08:00",
  });
  assert.equal(result.ok, true);
});

test("dragging remains same-day and inside the 24:00 boundary", () => {
  const crossDay = analyzeScheduleDrop({
    bookings: [booking("source", "coach-a", "2026-08-03T15:00:00+08:00")],
    notes: [],
    sourceBookingId: "source",
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-04T15:00:00+08:00",
  });
  assert.equal(crossDay.ok, false);
  if (!crossDay.ok) assert.equal(crossDay.code, "same_day_only");

  const outsideDay = analyzeScheduleDrop({
    bookings: [booking("source", "coach-a", "2026-08-03T15:00:00+08:00", 120)],
    notes: [],
    sourceBookingId: "source",
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T23:00:00+08:00",
  });
  assert.equal(outsideDay.ok, false);
  if (!outsideDay.ok) assert.equal(outsideDay.code, "outside_day");
});

test("move results update the visible board immediately and remove overwritten rows", () => {
  const bookings = [
    booking("source", "coach-a", "2026-08-03T15:00:00+08:00"),
    booking("overwritten", "coach-b", "2026-08-03T19:00:00+08:00"),
    booking("untouched", "coach-c", "2026-08-03T20:00:00+08:00"),
  ];

  const result = applyScheduleMoveResult(bookings, [
    {
      id: "source",
      coachId: "coach-b",
      startsAt: "2026-08-03T19:00:00+08:00",
      endsAt: "2026-08-03T20:00:00+08:00",
      status: "booked",
    },
    {
      id: "overwritten",
      coachId: "coach-b",
      startsAt: "2026-08-03T19:00:00+08:00",
      endsAt: "2026-08-03T20:00:00+08:00",
      status: "cancelled",
    },
  ]);

  assert.deepEqual(result.map((item) => item.id), ["source", "untouched"]);
  assert.equal(result[0]?.coach_id, "coach-b");
  assert.equal(result[0]?.starts_at, "2026-08-03T19:00:00+08:00");
});

test("an optimistic move immediately relocates the FA while the server request runs", () => {
  const source = booking("source-fa", "coach-a", "2026-08-03T15:00:00+08:00", 120);
  const analysis = analyzeScheduleDrop({
    bookings: [source],
    notes: [],
    sourceBookingId: source.id,
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T19:00:00+08:00",
  });
  assert.equal(analysis.ok, true);
  if (!analysis.ok) return;

  const changedItems = buildOptimisticScheduleMoveResult(analysis.plan, "move");
  const result = applyScheduleMoveResult([source], changedItems);
  assert.equal(result[0]?.coach_id, "coach-b");
  assert.equal(
    new Date(result[0]?.starts_at || "").getTime(),
    new Date("2026-08-03T19:00:00+08:00").getTime(),
  );
  assert.equal(
    new Date(result[0]?.ends_at || "").getTime(),
    new Date("2026-08-03T21:00:00+08:00").getTime(),
  );
});

test("an optimistic FA move immediately relocates the assistant manager TO note", () => {
  const notes = [
    {
      id: "to-note",
      coach_id: "assistant-manager",
      starts_at: "2026-08-03T16:00:00+08:00",
      ends_at: "2026-08-03T17:00:00+08:00",
      content: "TO",
      system_kind: "fa_assistant_to",
      source_booking_ids: ["source-fa"],
      metadata: { sourceCount: 1 },
    },
  ];

  const result = applyOptimisticFaAssistantToNotes(notes, [
    {
      id: "source-fa",
      coachId: "coach-b",
      startsAt: "2026-08-03T19:00:00+08:00",
      endsAt: "2026-08-03T21:00:00+08:00",
      status: "booked",
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(
    new Date(result[0]?.starts_at || "").getTime(),
    new Date("2026-08-03T20:00:00+08:00").getTime(),
  );
  assert.deepEqual(result[0]?.source_booking_ids, ["source-fa"]);
});

test("an assistant-manager TO conflict is warned without blocking the FA move", () => {
  const source = {
    ...booking("source-fa", "coach-a", "2026-08-03T11:00:00+08:00", 120),
    operation_kind: "trial",
    branch_id: "branch-a",
  };
  const assistantBooking = {
    ...booking("assistant-pt", "assistant-manager", "2026-08-03T13:00:00+08:00"),
    operation_kind: "pt",
    branch_id: "branch-a",
  };
  const analysis = analyzeScheduleDrop({
    bookings: [source, assistantBooking],
    notes: [
      {
        id: "old-to-note",
        coach_id: "assistant-manager",
        starts_at: "2026-08-03T12:00:00+08:00",
        ends_at: "2026-08-03T13:00:00+08:00",
        content: "TO",
        system_kind: "fa_assistant_to",
        source_booking_ids: [source.id],
      },
    ],
    sourceBookingId: source.id,
    targetCoachId: "coach-b",
    targetStartsAt: "2026-08-03T12:00:00+08:00",
  });
  assert.equal(analysis.ok, true);
  if (!analysis.ok) return;

  const movedBookings = applyScheduleMoveResult(
    [source, assistantBooking],
    buildOptimisticScheduleMoveResult(analysis.plan, "move"),
  );
  const state = buildOptimisticFaAssistantToState({
    bookings: movedBookings,
    notes: [
      {
        id: "old-to-note",
        coach_id: "assistant-manager",
        starts_at: "2026-08-03T12:00:00+08:00",
        ends_at: "2026-08-03T13:00:00+08:00",
        content: "TO",
        system_kind: "fa_assistant_to",
        source_booking_ids: [source.id],
      },
    ],
    coaches: [
      {
        id: "assistant-manager",
        branch_id: "branch-a",
        department: "coaching",
        position: "coach_assistant_manager",
      },
    ],
  });

  assert.equal(state.notes.some((note) => note.system_kind === "fa_assistant_to"), false);
  assert.equal(state.conflicts.length, 1);
  assert.equal(
    new Date(state.conflicts[0]?.starts_at || "").getTime(),
    new Date("2026-08-03T13:00:00+08:00").getTime(),
  );
  assert.deepEqual(state.conflicts[0]?.source_booking_ids, [source.id]);
});

test("an optimistic schedule request rolls the visible state back when the API fails", async () => {
  let visibleState = "server";
  const events: string[] = [];

  await assert.rejects(
    runOptimisticScheduleMutation({
      apply: () => {
        events.push("apply");
        visibleState = "optimistic";
      },
      request: async () => {
        events.push("request");
        throw new Error("api_failed");
      },
      rollback: () => {
        events.push("rollback");
        visibleState = "server";
      },
    }),
    /api_failed/,
  );

  assert.equal(visibleState, "server");
  assert.deepEqual(events, ["apply", "request", "rollback"]);
});

test("moving one of two FAs splits the shared TO note without delaying the other", () => {
  const notes = [
    {
      id: "shared-to-note",
      coach_id: "assistant-manager",
      starts_at: "2026-08-03T16:00:00+08:00",
      ends_at: "2026-08-03T17:00:00+08:00",
      content: "TO",
      system_kind: "fa_assistant_to",
      source_booking_ids: ["moved-fa", "remaining-fa"],
    },
  ];

  const result = applyOptimisticFaAssistantToNotes(notes, [
    {
      id: "moved-fa",
      coachId: "coach-b",
      startsAt: "2026-08-03T19:00:00+08:00",
      endsAt: "2026-08-03T21:00:00+08:00",
      status: "booked",
    },
  ]);

  assert.equal(result.length, 2);
  const originalSlot = result.find(
    (note) =>
      new Date(note.starts_at).getTime() ===
      new Date("2026-08-03T16:00:00+08:00").getTime(),
  );
  const movedSlot = result.find(
    (note) =>
      new Date(note.starts_at).getTime() ===
      new Date("2026-08-03T20:00:00+08:00").getTime(),
  );
  assert.deepEqual(originalSlot?.source_booking_ids, ["remaining-fa"]);
  assert.deepEqual(movedSlot?.source_booking_ids, ["moved-fa"]);
});

test("moving an FA onto the assistant manager removes its generated TO note", () => {
  const notes = [
    {
      id: "to-note",
      coach_id: "assistant-manager",
      starts_at: "2026-08-03T16:00:00+08:00",
      ends_at: "2026-08-03T17:00:00+08:00",
      content: "TO",
      system_kind: "fa_assistant_to",
      source_booking_ids: ["source-fa"],
    },
  ];

  const result = applyOptimisticFaAssistantToNotes(notes, [
    {
      id: "source-fa",
      coachId: "assistant-manager",
      startsAt: "2026-08-03T19:00:00+08:00",
      endsAt: "2026-08-03T21:00:00+08:00",
      status: "booked",
    },
  ]);

  assert.equal(result.length, 0);
});
