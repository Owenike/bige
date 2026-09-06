import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BIGE_CONTRACT_COURSE_TYPES,
  BIGE_COURSE_LABELS,
  BIGE_COURSE_TYPES,
  BIGE_FA_DURATION_MINUTES,
  BIGE_SCHEDULE_MOVE_UNDO_WINDOW_MS,
  BIGE_SCHEDULE_NOTE_UNDO_WINDOW_MS,
  BIGE_TRIAL_REMINDER_CONFIRMED_STATUS,
  BIGE_TRIAL_REMINDER_PENDING_STATUS,
  buildBigeMemberPaymentDetailMap,
  canReviseBigeTrialOutcome,
  canEditBigeScheduleBooking,
  calculateBigeContractOutstandingBalance,
  calculateContractTerms,
  calculateLegacyContractExpiryDate,
  collectBigeLegacyPurchaseDateTargets,
  flattenBigeMemberPaymentRelations,
  getBigeStudentPaymentBalanceState,
  getBigeContractDisplayName,
  getBigeFaFeeAmount,
  isBigeAssistantToContent,
  isBigeContractEligibleForPayment,
  isBigeContractPaymentAmountAllowed,
  isBigeContractVoidedForDisplay,
  isValidBigeInvoiceCarrier,
  isBigeFitnessPlanForSpecialty,
  isBigeScheduleNoteUndoAvailable,
  isBigeTrialReminderConfirmed,
  getBigeTrialOutcomeVisualState,
  getBigeTrialBookingActionVisibility,
  getBigeTrialContractMissingProfileFields,
  nextBigeTrialReminderStatus,
  normalizeBigeInvoiceCarrier,
  normalizeBigeScheduleEndAt,
  resolveBigeTrialContractIdentity,
  shouldShowBigeScheduleBookingOnDailyBoard,
  summarizeBigeMemberCourseSessions,
  deleteScheduleNoteSchema,
  deleteScheduleBookingSchema,
  checkScheduleBatchAssignmentsSchema,
  createScheduleBatchAssignmentsSchema,
  getScheduleCoachOptionsSchema,
  checkScheduleDeleteBatchSchema,
  deleteScheduleBookingsBatchSchema,
  restoreScheduleNoteSchema,
  undoScheduleBookingMoveSchema,
  restoreCancelledBookingSchema,
  restoreNoShowBookingSchema,
  createContractSchema,
  completeTrialOutcomeSchema,
  createScheduleSchema,
  changeTrialConversionPaymentSchema,
  changeTrialConversionOutcomeSchema,
  restoreTrialNoSaleSchema,
  restoreTrialConversionSchema,
  recordPaymentSchema,
  recordPaymentsSchema,
  reorderScheduleCoachesSchema,
  updatePaymentSchema,
  updateLegacyContractPurchaseDateSchema,
  updateCourseAllocationsSchema,
  validateCourseAllocationTotal,
  listBigeFitnessPlanSpecialties,
} from "../lib/bige-fitness";
import { canCreateBigeContract } from "../lib/staff-credentials";
import { findBigeScheduleBatchConflict } from "../lib/bige-schedule-batch";
import {
  BIGE_BOARD_PREFETCH_CONCURRENCY,
  BIGE_BOARD_PREFETCH_RADIUS,
  BigeBoardPrefetchQueue,
  buildBigeBoardPrefetchDates,
} from "../lib/bige-board-prefetch";
import {
  assignBigeMonthlyDateCourseTypes,
  assignBigeMonthlyDateTimes,
  removeBigeMonthlyDateCourseType,
  retainBigeMonthlyDateCourseTypes,
} from "../lib/bige-monthly-selection";
import {
  BIGE_SCHEDULE_HOLO_HOVER_SCALE,
  BIGE_SCHEDULE_HOLO_PILOT_DATES,
  BIGE_SCHEDULE_HOLO_PILOT_EMPLOYEE_NUMBER,
  BIGE_SCHEDULE_HOLO_RESET_DELAY_MS,
  BIGE_SCHEDULE_HOLO_TILT_MAX_X_DEG,
  BIGE_SCHEDULE_HOLO_TILT_MAX_Y_DEG,
  BIGE_SCHEDULE_HOLO_TURN_DEG,
  isBigeScheduleHoloPilotEnabled,
  resolveBigeScheduleHoloTone,
} from "../lib/bige-schedule-holo";

const batchCoachId = "00000000-0000-4000-8000-000000000011";
const batchMemberId = "00000000-0000-4000-8000-000000000012";

test("schedule holo pilot is limited to account 01 on September 6-7 manager daily boards", () => {
  assert.equal(BIGE_SCHEDULE_HOLO_PILOT_EMPLOYEE_NUMBER, "E000001");
  assert.deepEqual(BIGE_SCHEDULE_HOLO_PILOT_DATES, ["2026-09-06", "2026-09-07"]);
  assert.equal(
    isBigeScheduleHoloPilotEnabled({
      employeeNumber: "01",
      businessDate: "2026-09-06",
      view: "manager",
      tab: "schedule",
    }),
    true,
  );
  assert.equal(
    isBigeScheduleHoloPilotEnabled({
      employeeNumber: "E000001",
      businessDate: "2026-09-07",
      view: "manager",
      tab: "schedule",
    }),
    true,
  );
  for (const input of [
    { employeeNumber: "E000002", businessDate: "2026-09-06", view: "manager", tab: "schedule" },
    { employeeNumber: "E000001", businessDate: "2026-09-08", view: "manager", tab: "schedule" },
    { employeeNumber: "E000001", businessDate: "2026-09-06", view: "frontdesk", tab: "schedule" },
    { employeeNumber: "E000001", businessDate: "2026-09-06", view: "manager", tab: "personal-month" },
  ]) {
    assert.equal(isBigeScheduleHoloPilotEnabled(input), false);
  }
});

test("schedule holo tones preserve outcome priority and disable cancelled cards", () => {
  assert.equal(
    resolveBigeScheduleHoloTone({ operationKind: "trial", status: "cancelled", trialOutcome: "converted" }),
    null,
  );
  assert.equal(
    resolveBigeScheduleHoloTone({ operationKind: "trial", status: "no_show", trialOutcome: "converted" }),
    "no-show",
  );
  assert.equal(
    resolveBigeScheduleHoloTone({ operationKind: "trial", status: "completed", trialOutcome: "converted" }),
    "fa-converted",
  );
  assert.equal(
    resolveBigeScheduleHoloTone({ operationKind: "trial", status: "completed", trialOutcome: "not_converted" }),
    "fa-not-converted",
  );
  assert.equal(
    resolveBigeScheduleHoloTone({ operationKind: "trial", status: "completed", trialOutcome: "pending_conversion" }),
    "fa-pending-conversion",
  );
  assert.equal(
    resolveBigeScheduleHoloTone({ operationKind: "trial", status: "booked", reminderStatus: "reached" }),
    "fa-reminded",
  );
  assert.equal(resolveBigeScheduleHoloTone({ operationKind: "trial", status: "booked" }), "fa");
  assert.equal(resolveBigeScheduleHoloTone({ operationKind: "pt", status: "completed" }), "completed");
  assert.equal(resolveBigeScheduleHoloTone({ operationKind: "bb", status: "booked" }), "bb");
  assert.equal(resolveBigeScheduleHoloTone({ operationKind: "pt", status: "booked" }), "pt");
});

test("schedule holo pilot stays hover-only and does not intercept schedule input", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.match(component, /data-schedule-holo-pilot=\{scheduleHoloPilotEnabled \? "true" : undefined\}/);
  assert.match(component, /holoEnabled=\{scheduleHoloPilotEnabled\}/);
  assert.match(component, /sessionIdentity\?\.employeeNumber \|\| previewEmployeeNumber/);
  assert.match(component, /event\.pointerType === "touch" \|\| event\.buttons !== 0/);
  assert.equal(BIGE_SCHEDULE_HOLO_RESET_DELAY_MS, 1_000);
  assert.equal(BIGE_SCHEDULE_HOLO_TILT_MAX_X_DEG, 2.2);
  assert.equal(BIGE_SCHEDULE_HOLO_TILT_MAX_Y_DEG, 3.2);
  assert.equal(BIGE_SCHEDULE_HOLO_TURN_DEG, -1.4);
  assert.equal(BIGE_SCHEDULE_HOLO_HOVER_SCALE, 1.018);
  assert.match(
    component,
    /holoResetTimerRef\.current = setTimeout\([\s\S]*BIGE_SCHEDULE_HOLO_RESET_DELAY_MS\);/,
  );
  assert.match(component, /onPointerEnter=\{updateHoloPointer\}/);
  assert.match(component, /onPointerMove=\{updateHoloPointer\}/);
  assert.match(component, /onPointerLeave=\{scheduleHoloPointerReset\}/);
  assert.match(component, /onPointerCancel=\{resetHoloPointerImmediately\}/);
  assert.match(component, /--schedule-holo-rotate-z/);
  assert.match(component, /--schedule-holo-scale/);
  assert.match(styles, /\.scheduleHoloCard::before,[\s\S]*pointer-events: none;/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.scheduleHoloCard:hover::before/);
  assert.match(styles, /\.scheduleHoloCard\.scheduleDraggingSource::before,[\s\S]*opacity: 0;/);
  assert.match(
    styles,
    /\.scheduleHoloCard\.scheduleDraggingSource,[\s\S]*transform: perspective\(900px\) rotateX\(0deg\) rotateY\(0deg\) rotateZ\(0deg\) scale\(1\);/,
  );
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.scheduleHoloCard \{[\s\S]*transform: none;/);
});

test("daily schedule excludes the explicit E000099 test coach from every visible coach list", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.equal(route.match(/filterDailyScheduleCoaches\(/g)?.length, 3);
  assert.match(route, /select\("id, employee_number"\)/);
});

test("daily board hides every cancellation from August 20 through 31", () => {
  const now = new Date("2026-08-26T03:00:00.000Z");

  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard(
      {
        status: "cancelled",
        starts_at: "2026-08-19T16:00:00.000Z",
        cancelled_at: "2026-08-26T01:00:00.000Z",
      },
      now,
    ),
    false,
  );
  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard(
      {
        status: "cancelled",
        starts_at: "2026-08-31T15:59:59.000Z",
        cancelled_at: "2026-08-26T01:00:00.000Z",
      },
      now,
    ),
    false,
  );
});

test("daily board keeps the same-day cancellation rule outside the August window", () => {
  const now = new Date("2026-08-26T03:00:00.000Z");

  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard(
      {
        status: "cancelled",
        starts_at: "2026-08-19T15:59:59.000Z",
        cancelled_at: "2026-08-26T01:00:00.000Z",
      },
      now,
    ),
    true,
  );
  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard(
      {
        status: "cancelled",
        starts_at: "2026-08-31T16:00:00.000Z",
        cancelled_at: "2026-08-25T16:30:00.000Z",
      },
      now,
    ),
    true,
  );
  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard(
      { status: "cancelled", cancelled_at: "2026-08-25T15:59:59.000Z" },
      now,
    ),
    false,
  );
  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard(
      { status: "cancelled", cancelled_at: null },
      now,
    ),
    false,
  );
  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard(
      { status: "cancelled", cancelled_at: "not-a-date" },
      now,
    ),
    false,
  );
  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard({ status: "booked" }, now),
    true,
  );
  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard({ status: "completed" }, now),
    true,
  );
  assert.equal(
    shouldShowBigeScheduleBookingOnDailyBoard({ status: "no_show" }, now),
    true,
  );
});

test("daily board route reads the cancellation time and applies the visibility rule", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(route, /status_reason, cancelled_at, note/);
  assert.match(route, /shouldShowBigeScheduleBookingOnDailyBoard\(booking\)/);
});

test("walk-in payments hide members until a search starts and omit the introductory notice", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const memberResults = component.slice(
    component.indexOf("const walkInMemberKeyword ="),
    component.indexOf("const selectedConversionBooking ="),
  );
  const walkInDialog = component.slice(
    component.indexOf('{dialog === "walk-in-payment"'),
    component.indexOf('{dialog === "line-notifications"'),
  );

  assert.match(memberResults, /const walkInMemberResults = walkInMemberKeyword[\s\S]*: \[\];/);
  assert.doesNotMatch(memberResults, /if \(!keyword\) return true/);
  assert.match(
    walkInDialog,
    /walkInMemberKeyword && walkInMemberResults\.length === 0/,
  );
  assert.doesNotMatch(
    walkInDialog,
    /此處只建立付款紀錄，不占用課表、不扣堂，也不會發送 LINE 課程通知/,
  );
});

test("contract display names use BIGE and the signed business date", () => {
  assert.equal(getBigeContractDisplayName("2026-08-06"), "BIGE-20260806");
  assert.equal(getBigeContractDisplayName(null), "BIGE-日期待補");
  assert.equal(getBigeContractDisplayName("invalid"), "BIGE-日期待補");
});

test("batch preflight strictly blocks a coach who already has another student", () => {
  const conflict = findBigeScheduleBatchConflict({
    coachId: batchCoachId,
    memberId: batchMemberId,
    startsAt: "2026-08-20T10:00:00+08:00",
    endsAt: "2026-08-20T11:00:00+08:00",
    bookings: [{
      id: "existing-booking",
      coach_id: batchCoachId,
      member_id: "00000000-0000-4000-8000-000000000099",
      starts_at: "2026-08-20T10:30:00+08:00",
      ends_at: "2026-08-20T11:30:00+08:00",
      status: "booked",
      is_bige_schedule: true,
    }],
    notes: [],
  });

  assert.equal(conflict?.kind, "coach_booking");
});

test("batch preflight blocks the selected member from overlapping another coach", () => {
  const conflict = findBigeScheduleBatchConflict({
    coachId: batchCoachId,
    memberId: batchMemberId,
    startsAt: "2026-08-20T10:00:00+08:00",
    endsAt: "2026-08-20T11:00:00+08:00",
    bookings: [{
      id: "member-booking",
      coach_id: "00000000-0000-4000-8000-000000000088",
      member_id: batchMemberId,
      starts_at: "2026-08-20T10:00:00+08:00",
      ends_at: "2026-08-20T11:00:00+08:00",
      status: "confirmed",
      is_bige_schedule: true,
    }],
    notes: [],
  });

  assert.equal(conflict?.kind, "member_booking");
});

test("batch preflight blocks overlapping coach notes but permits adjacent or inactive bookings", () => {
  const base = {
    coachId: batchCoachId,
    memberId: batchMemberId,
    startsAt: "2026-08-20T10:00:00+08:00",
    endsAt: "2026-08-20T11:00:00+08:00",
  };
  const inactiveOrAdjacent = findBigeScheduleBatchConflict({
    ...base,
    bookings: [
      {
        id: "completed-booking",
        coach_id: batchCoachId,
        member_id: "00000000-0000-4000-8000-000000000099",
        starts_at: "2026-08-20T10:00:00+08:00",
        ends_at: "2026-08-20T11:00:00+08:00",
        status: "completed",
        is_bige_schedule: true,
      },
      {
        id: "adjacent-booking",
        coach_id: batchCoachId,
        member_id: "00000000-0000-4000-8000-000000000098",
        starts_at: "2026-08-20T11:00:00+08:00",
        ends_at: "2026-08-20T12:00:00+08:00",
        status: "booked",
        is_bige_schedule: true,
      },
    ],
    notes: [],
  });
  assert.equal(inactiveOrAdjacent, null);

  const noteConflict = findBigeScheduleBatchConflict({
    ...base,
    bookings: [],
    notes: [{
      id: "coach-note",
      coach_id: batchCoachId,
      starts_at: "2026-08-20T10:30:00+08:00",
      ends_at: "2026-08-20T11:00:00+08:00",
      content: "內部會議",
    }],
  });
  assert.equal(noteConflict?.kind, "coach_note");
});

test("batch preflight treats shift and leave markers as warnings instead of conflicts", () => {
  const base = {
    coachId: batchCoachId,
    memberId: batchMemberId,
    startsAt: "2026-08-20T10:00:00+08:00",
    endsAt: "2026-08-20T11:00:00+08:00",
    bookings: [],
  };
  for (const content of ["休", "早", "晚", "10:00-19:00"]) {
    assert.equal(
      findBigeScheduleBatchConflict({
        ...base,
        notes: [{
          id: `status-${content}`,
          coach_id: batchCoachId,
          starts_at: "2026-08-20T09:00:00+08:00",
          ends_at: "2026-08-20T19:00:00+08:00",
          content,
        }],
      }),
      null,
    );
  }
});

test("batch preflight treats imported appointment-book rows and notes as occupied slots", () => {
  const bookingConflict = findBigeScheduleBatchConflict({
    coachId: batchCoachId,
    memberId: batchMemberId,
    startsAt: "2026-08-20T10:00:00+08:00",
    endsAt: "2026-08-20T11:00:00+08:00",
    bookings: [{
      id: "legacy-booking",
      coach_id: batchCoachId,
      member_id: batchMemberId,
      starts_at: "2026-08-20T10:00:00+08:00",
      ends_at: "2026-08-20T11:00:00+08:00",
      status: "booked",
      is_bige_schedule: true,
      operation_idempotency_key: "legacy-august:test-reference",
    }],
    notes: [{
      id: "legacy-note",
      coach_id: batchCoachId,
      starts_at: "2026-08-20T10:00:00+08:00",
      ends_at: "2026-08-20T11:00:00+08:00",
      content: "舊預約本",
      source: "legacy_schedule_import",
    }],
  });

  assert.equal(bookingConflict?.kind, "coach_booking");

  const noteConflict = findBigeScheduleBatchConflict({
    coachId: batchCoachId,
    memberId: batchMemberId,
    startsAt: "2026-08-20T10:00:00+08:00",
    endsAt: "2026-08-20T11:00:00+08:00",
    bookings: [],
    notes: [{
      id: "legacy-note",
      coach_id: batchCoachId,
      starts_at: "2026-08-20T10:00:00+08:00",
      ends_at: "2026-08-20T11:00:00+08:00",
      content: "舊預約本",
      source: "legacy_schedule_import",
    }],
  });

  assert.equal(noteConflict?.kind, "coach_note");
});

test("completed and deducted bookings must be restored before schedule edits", () => {
  assert.equal(canEditBigeScheduleBooking("completed"), false);
  assert.equal(canEditBigeScheduleBooking("booked"), true);
  assert.equal(canEditBigeScheduleBooking("confirmed"), true);
});

test("manual TO notes satisfy the assistant-manager FA placeholder", () => {
  assert.equal(isBigeAssistantToContent("TO"), true);
  assert.equal(isBigeAssistantToContent(" to "), true);
  assert.equal(isBigeAssistantToContent("TO 訪談"), false);
  assert.equal(isBigeAssistantToContent("休"), false);
  assert.equal(isBigeAssistantToContent(null), false);
});

test("schedule notes can be deleted only with a valid note id", () => {
  assert.equal(
    deleteScheduleNoteSchema.safeParse({
      action: "delete_schedule_note",
      noteId: "00000000-0000-4000-8000-000000000001",
    }).success,
    true,
  );
  assert.equal(
    deleteScheduleNoteSchema.safeParse({
      action: "delete_schedule_note",
      noteId: "not-a-note-id",
    }).success,
    false,
  );
});

test("schedule note restoration requires a valid note id", () => {
  assert.equal(
    restoreScheduleNoteSchema.safeParse({
      action: "restore_schedule_note",
      noteId: "00000000-0000-4000-8000-000000000001",
    }).success,
    true,
  );
  assert.equal(
    restoreScheduleNoteSchema.safeParse({
      action: "restore_schedule_note",
      noteId: "not-a-note-id",
    }).success,
    false,
  );
});

test("schedule note undo is accepted only during the 30 second window", () => {
  const deletedAt = "2026-08-06T01:00:00.000Z";
  const deletedAtMs = Date.parse(deletedAt);

  assert.equal(BIGE_SCHEDULE_NOTE_UNDO_WINDOW_MS, 30_000);
  assert.equal(isBigeScheduleNoteUndoAvailable(deletedAt, deletedAtMs + 29_999), true);
  assert.equal(
    isBigeScheduleNoteUndoAvailable(
      deletedAt,
      deletedAtMs + BIGE_SCHEDULE_NOTE_UNDO_WINDOW_MS,
    ),
    true,
  );
  assert.equal(
    isBigeScheduleNoteUndoAvailable(
      deletedAt,
      deletedAtMs + BIGE_SCHEDULE_NOTE_UNDO_WINDOW_MS + 1,
    ),
    false,
  );
  assert.equal(isBigeScheduleNoteUndoAvailable(deletedAt, deletedAtMs - 1), false);
});

test("schedule move undo uses a 10 second window and requires an operation id", () => {
  assert.equal(BIGE_SCHEDULE_MOVE_UNDO_WINDOW_MS, 10_000);
  assert.equal(
    undoScheduleBookingMoveSchema.safeParse({
      action: "undo_schedule_booking_move",
      operationId: "00000000-0000-4000-8000-000000000001",
    }).success,
    true,
  );
  assert.equal(
    undoScheduleBookingMoveSchema.safeParse({
      action: "undo_schedule_booking_move",
      operationId: "not-an-operation-id",
    }).success,
    false,
  );
});

test("cancelled schedule restoration requires a valid booking id", () => {
  assert.equal(
    restoreCancelledBookingSchema.safeParse({
      action: "restore_cancelled_booking",
      bookingId: "00000000-0000-4000-8000-000000000001",
    }).success,
    true,
  );
  assert.equal(
    restoreCancelledBookingSchema.safeParse({
      action: "restore_cancelled_booking",
      bookingId: "not-a-booking-id",
    }).success,
    false,
  );
});

test("no-show restoration requires a valid booking id", () => {
  assert.equal(
    restoreNoShowBookingSchema.safeParse({
      action: "restore_no_show_booking",
      bookingId: "00000000-0000-4000-8000-000000000001",
    }).success,
    true,
  );
  assert.equal(
    restoreNoShowBookingSchema.safeParse({
      action: "restore_no_show_booking",
      bookingId: "not-a-booking-id",
    }).success,
    false,
  );
});

test("schedule trash deletion requires one valid booking id", () => {
  assert.equal(
    deleteScheduleBookingSchema.safeParse({
      action: "delete_schedule_booking",
      bookingId: "00000000-0000-4000-8000-000000000001",
    }).success,
    true,
  );
  assert.equal(
    deleteScheduleBookingSchema.safeParse({
      action: "delete_schedule_booking",
      bookingId: "not-a-booking-id",
    }).success,
    false,
  );
});

test("monthly per-date coach assignments require one coach for each unique time", () => {
  const assignment = {
    coachId: batchCoachId,
    startsAt: "2026-09-03T10:00:00+08:00",
  };
  assert.equal(
    checkScheduleBatchAssignmentsSchema.safeParse({
      action: "check_schedule_batch_assignments",
      memberId: batchMemberId,
      operationKind: "pt",
      courseType: "weight_training",
      assignments: [assignment],
    }).success,
    true,
  );
  assert.equal(
    createScheduleBatchAssignmentsSchema.safeParse({
      action: "create_schedule_batch_assignments",
      memberId: batchMemberId,
      operationKind: "pt",
      courseType: "weight_training",
      assignments: [assignment, assignment],
      idempotencyKey: "monthly-assignment-test",
    }).success,
    false,
  );
  assert.equal(
    getScheduleCoachOptionsSchema.safeParse({
      action: "get_schedule_coach_options",
      memberId: batchMemberId,
      operationKind: "pt",
      courseType: "weight_training",
      startsAt: assignment.startsAt,
    }).success,
    true,
  );

  const mixedCourseAssignments = [
    { ...assignment, courseType: "relaxation" },
    {
      ...assignment,
      startsAt: "2026-09-10T11:00:00+08:00",
      courseType: "boxing",
    },
  ];
  assert.equal(
    checkScheduleBatchAssignmentsSchema.safeParse({
      action: "check_schedule_batch_assignments",
      memberId: batchMemberId,
      operationKind: "pt",
      courseType: "weight_training",
      assignments: mixedCourseAssignments,
    }).success,
    true,
  );
  assert.equal(
    createScheduleBatchAssignmentsSchema.safeParse({
      action: "create_schedule_batch_assignments",
      memberId: batchMemberId,
      operationKind: "pt",
      courseType: "weight_training",
      assignments: mixedCourseAssignments,
      idempotencyKey: "monthly-mixed-course-test",
    }).success,
    true,
  );
  assert.equal(
    createScheduleBatchAssignmentsSchema.safeParse({
      action: "create_schedule_batch_assignments",
      memberId: batchMemberId,
      operationKind: "pt",
      courseType: "weight_training",
      assignments: [{ ...assignment, courseType: "not-a-course" }],
      idempotencyKey: "monthly-invalid-course-test",
    }).success,
    false,
  );
});

test("monthly date selections retain the time used when each date was selected", () => {
  let dateTimes = assignBigeMonthlyDateTimes(
    {},
    ["2026-09-01", "2026-09-03", "2026-09-05", "2026-09-07"],
    "10:00",
  );
  dateTimes = assignBigeMonthlyDateTimes(
    dateTimes,
    ["2026-09-09", "2026-09-10", "2026-09-15"],
    "11:00",
  );
  dateTimes = assignBigeMonthlyDateTimes(dateTimes, ["2026-09-01"], "12:00");

  assert.deepEqual(dateTimes, {
    "2026-09-01": "10:00",
    "2026-09-03": "10:00",
    "2026-09-05": "10:00",
    "2026-09-07": "10:00",
    "2026-09-09": "11:00",
    "2026-09-10": "11:00",
    "2026-09-15": "11:00",
  });
});

test("monthly date selections retain the specialty used when each date was selected", () => {
  let dateCourseTypes = assignBigeMonthlyDateCourseTypes(
    {},
    ["2026-09-01", "2026-09-03"],
    "weight_training",
  );
  dateCourseTypes = assignBigeMonthlyDateCourseTypes(
    dateCourseTypes,
    ["2026-09-03", "2026-09-10"],
    "relaxation",
  );
  dateCourseTypes = removeBigeMonthlyDateCourseType(
    dateCourseTypes,
    "2026-09-01",
  );
  dateCourseTypes = retainBigeMonthlyDateCourseTypes(dateCourseTypes, [
    "2026-09-03",
    "2026-09-10",
  ]);

  assert.deepEqual(dateCourseTypes, {
    "2026-09-03": "weight_training",
    "2026-09-10": "relaxation",
  });
});

test("monthly assignment creation persists each date specialty through the booking RPC", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const assignmentAction = route.slice(
    route.indexOf('input.action === "create_schedule_batch_assignments"'),
    route.indexOf('input.action === "create_note"'),
  );

  assert.match(
    assignmentAction,
    /courseType: assignment\.courseType \|\| input\.courseType/,
  );
  assert.match(assignmentAction, /p_course_type: assignment\.courseType/);
  assert.match(assignmentAction, /courseTypes: \[\.\.\.new Set/);
});

test("monthly batch delete rejects duplicate ids and requires an idempotency key", () => {
  const bookingId = "00000000-0000-4000-8000-000000000001";
  assert.equal(
    checkScheduleDeleteBatchSchema.safeParse({
      action: "check_schedule_delete_batch",
      memberId: batchMemberId,
      bookingIds: [bookingId],
    }).success,
    true,
  );
  assert.equal(
    deleteScheduleBookingsBatchSchema.safeParse({
      action: "delete_schedule_bookings_batch",
      memberId: batchMemberId,
      bookingIds: [bookingId, bookingId],
      idempotencyKey: "monthly-delete-test",
    }).success,
    false,
  );
  assert.equal(
    deleteScheduleBookingsBatchSchema.safeParse({
      action: "delete_schedule_bookings_batch",
      memberId: batchMemberId,
      bookingIds: [bookingId],
      idempotencyKey: "short",
    }).success,
    false,
  );
});

test("monthly schedule UI exposes per-date coach choice, leave confirmation, and all-or-none deletion", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const monthlyWorkspace = component.slice(
    component.indexOf('{dialog === "monthly-schedule"'),
    component.indexOf('{dialog === "activity"'),
  );

  assert.match(monthlyWorkspace, /<option value=\{MONTHLY_COACH_PER_DATE\}>不指定<\/option>/);
  assert.match(monthlyWorkspace, /不指定模式請逐日點日期並選擇教練/);
  assert.match(monthlyWorkspace, /排休教練仍可選，但會要求再次確認/);
  assert.match(monthlyWorkspace, /這位教練當天休假/);
  assert.match(monthlyWorkspace, /採全部成功或全部不刪除/);
  assert.match(monthlyWorkspace, /正式課程會整合成一則 LINE 取消通知，FA 不會發送 LINE/);
  assert.doesNotMatch(monthlyWorkspace, /此時間只套用到接下來新選的日期；已選日期會保留原時間/);
  assert.match(monthlyWorkspace, /monthlyDateTimes\[day\]/);
  assert.match(monthlyWorkspace, /monthlyDateCourseTypes\[day\]/);
  assert.match(monthlyWorkspace, /selectedCourseLabel/);
  assert.match(monthlyWorkspace, /openMonthlyCoachPicker\(day, time, courseType\)/);
  assert.match(monthlyWorkspace, /className=\{styles\.monthDayTime\}/);
});

test("monthly schedule confirmation emphasizes every date and closes after a successful batch", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const confirmation = component.slice(
    component.indexOf('{dialog === "monthly-schedule-confirm"'),
    component.indexOf('{dialog === "activity"'),
  );

  assert.match(confirmation, /title=\{monthlyPreflight\.available\.length \? "確認預約日期"/);
  assert.match(confirmation, /請逐筆確認日期、星期、時間、專項與教練/);
  assert.match(confirmation, /monthlyPreflight\.available\.map\(\(slot, index\) =>/);
  assert.doesNotMatch(confirmation, /monthlyPerDateMode && monthlyPreflight\.available\.length/);
  assert.match(confirmation, /formatDate\(slot\.startsAt\)/);
  assert.match(confirmation, /weekdayLabel\(dateKey\)/);
  assert.match(confirmation, /slotKey\(slot\.startsAt\)/);
  assert.match(confirmation, /BIGE_COURSE_LABELS\[courseType\]/);
  assert.match(styles, /\.monthlyDateReviewCourse/);
  assert.match(component, /assignments: availableAssignments/);
  assert.match(
    component,
    /courseType: monthlyDateCourseTypes\[day\] \|\| monthlyCourseType/,
  );
  assert.match(component, /setDialog\(null\);\s*setSuccess\(/);
  assert.doesNotMatch(component, /monthly-schedule-result|批次排課結果|monthlyBatchResult/);
  assert.match(styles, /\.monthlyDateReviewList\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(
    styles,
    /@media \(max-width: 560px\)[\s\S]*?\.monthlyBookingReviewSummary,\s*\.monthlyDateReviewList,\s*\.monthlyAssignmentReviewList\s*\{\s*grid-template-columns: 1fr;/,
  );
});

test("monthly schedule defaults to per-date coach selection", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.match(
    component,
    /\[monthlyCoachId, setMonthlyCoachId\] = useState\(MONTHLY_COACH_PER_DATE\)/,
  );
  assert.match(
    component,
    /const openMonthlySchedule = \(\) => \{[\s\S]*?setMonthlyCoachId\(MONTHLY_COACH_PER_DATE\)/,
  );
  assert.match(
    component,
    /setMonthlyMember\(member\);[\s\S]*?setMonthlyCoachId\(MONTHLY_COACH_PER_DATE\)/,
  );
  assert.match(
    component,
    /if \(current === MONTHLY_COACH_PER_DATE\) return current;[\s\S]*?return MONTHLY_COACH_PER_DATE;/,
  );
  assert.match(
    component,
    /if \(monthlyPerDateMode\) \{[\s\S]*?setMonthlyDates\(\(current\) =>[\s\S]*?openMonthlyCoachPicker\(day, time, courseType\)/,
  );
  assert.match(component, /monthlyPerDateMode && selected[\s\S]*?"待選教練"/);
  assert.match(component, /monthlyDates\.includes\(monthlyCoachPickerDay\)/);
});

test("monthly batch deletion is atomic, payment-aware, audited, and service-role only", () => {
  const migration = readFileSync(
    "supabase/migrations/20260825143813_bige_monthly_coach_assignment_and_batch_delete.sql",
    "utf8",
  );
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(migration, /order by booking\.id\s+for update/);
  assert.match(migration, /affected_count <> requested_count/);
  assert.match(migration, /paid_schedule_booking_manager_required/);
  assert.match(migration, /bige_schedule_batch_deleted/);
  assert.match(migration, /revoke all on function public\.bige_delete_schedule_bookings_batch_v1[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.bige_delete_schedule_bookings_batch_v1[\s\S]*to service_role/);
  assert.match(route, /input\.action === "delete_schedule_bookings_batch"[\s\S]*preview\.blocked\.length > 0[\s\S]*bige_delete_schedule_bookings_batch_v1/);
  assert.match(route, /formalBooking[\s\S]*operation_kind === "pt"[\s\S]*eventKind: "cancelled"/);
});

test("leave markers are warnings at preflight and are ignored only on the booking side of the database guard", () => {
  const migration = readFileSync(
    "supabase/migrations/20260825143813_bige_monthly_coach_assignment_and_batch_delete.sql",
    "utf8",
  );
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(route, /kind: "coach_off"/);
  assert.match(route, /當天排休，仍可安排/);
  assert.match(migration, /btrim\(coalesce\(note\.content, ''\)\) not in \('早', '晚', '休'\)/);
  assert.match(migration, /tg_table_name = 'bookings'[\s\S]*schedule_time_overlap/);
});

test("FA schedules always occupy two hours", () => {
  assert.equal(BIGE_FA_DURATION_MINUTES, 120);
  assert.equal(
    normalizeBigeScheduleEndAt(
      "trial",
      "2026-08-02T09:00:00+08:00",
      "2026-08-02T10:00:00+08:00",
    ),
    "2026-08-02T03:00:00.000Z",
  );
});

test("FA reminder confirmation uses the persisted reached status", () => {
  assert.equal(BIGE_TRIAL_REMINDER_CONFIRMED_STATUS, "reached");
  assert.equal(BIGE_TRIAL_REMINDER_PENDING_STATUS, "pending");
  assert.equal(isBigeTrialReminderConfirmed("reached"), true);
  assert.equal(isBigeTrialReminderConfirmed("pending"), false);
  assert.equal(isBigeTrialReminderConfirmed(null), false);
  assert.equal(nextBigeTrialReminderStatus("pending"), "reached");
  assert.equal(nextBigeTrialReminderStatus("reached"), "pending");
});

test("PT schedules preserve their selected ending time", () => {
  assert.equal(
    normalizeBigeScheduleEndAt(
      "pt",
      "2026-08-02T09:00:00+08:00",
      "2026-08-02T10:30:00+08:00",
    ),
    "2026-08-02T10:30:00+08:00",
  );
});

test("legacy contract expiry adds 3.5 days per session and the 30 day bonus", () => {
  assert.equal(calculateLegacyContractExpiryDate("2026-08-14", 48), "2027-02-28");
  assert.equal(calculateLegacyContractExpiryDate("2026-08-14", 30), "2026-12-27");
  assert.equal(calculateLegacyContractExpiryDate("2026-08-14", 26), "2026-12-13");
});

test("legacy purchase-date reminders only include the contracts actually consumed that day", () => {
  assert.deepEqual(
    collectBigeLegacyPurchaseDateTargets([
      {
        member_id: "member-display-only",
        starts_at: "2026-08-31T07:00:00.000Z",
        member_plan_contract_id: null,
        package_sessions_consumed: 0,
      },
      {
        member_id: "member-reserved-only",
        starts_at: "2026-08-31T08:00:00.000Z",
        member_plan_contract_id: "contract-reserved-only",
        package_sessions_consumed: 0,
      },
      {
        member_id: "member-shared-later",
        starts_at: "2026-08-31T10:00:00.000Z",
        member_plan_contract_id: "contract-consumed",
        package_sessions_consumed: 1,
      },
      {
        member_id: "member-shared-earlier",
        starts_at: "2026-08-31T09:00:00.000Z",
        member_plan_contract_id: "contract-consumed",
        package_sessions_consumed: 1,
      },
    ]),
    [
      {
        contractId: "contract-consumed",
        memberId: "member-shared-earlier",
        firstClassAt: "2026-08-31T09:00:00.000Z",
      },
    ],
  );
});

test("custom contract terms reuse the same session formula", () => {
  assert.deepEqual(calculateContractTerms(10), {
    baseDays: 35,
    validityDays: 65,
    extensionLimitDays: 18,
  });
  assert.deepEqual(calculateContractTerms(11), {
    baseDays: 39,
    validityDays: 69,
    extensionLimitDays: 20,
  });
});

test("legacy purchase-date updates require a contract id and a real date", () => {
  assert.equal(
    updateLegacyContractPurchaseDateSchema.safeParse({
      action: "update_legacy_contract_purchase_date",
      contractId: "00000000-0000-4000-8000-000000000001",
      purchaseDate: "2026-08-14",
    }).success,
    true,
  );
  assert.equal(
    updateLegacyContractPurchaseDateSchema.safeParse({
      action: "update_legacy_contract_purchase_date",
      contractId: "00000000-0000-4000-8000-000000000001",
      purchaseDate: "2026-14-99",
    }).success,
    false,
  );
});

test("member contracts accept ECPay and ECPay installment payment methods", () => {
  const baseInput = {
    action: "create_contract" as const,
    lineGroupBindingId: "00000000-0000-4000-8000-000000000099",
    fullName: "測試會員",
    phone: "0912345678",
    birthDate: "1990-01-01",
    email: "member@example.com",
    emailUnavailable: false,
    planId: "00000000-0000-4000-8000-000000000001",
    signedOn: "2026-08-05",
    initialPayment: 1788,
    paymentSchedule: [],
  };

  assert.equal(createContractSchema.safeParse({ ...baseInput, paymentMethod: "ecpay" }).success, true);
  assert.equal(
    createContractSchema.safeParse({
      ...baseInput,
      paymentMethod: "ecpay_installment",
      installmentCount: 12,
    }).success,
    true,
  );
  assert.equal(
    createContractSchema.safeParse({ ...baseInput, paymentMethod: "ecpay_installment" }).success,
    false,
  );
  assert.equal(
    createContractSchema.safeParse({
      ...baseInput,
      paymentMethod: "cash",
      installmentCount: 12,
    }).success,
    false,
  );
});

test("FA contracts may be created before a missing birthday is completed", () => {
  const result = createContractSchema.safeParse({
    action: "create_contract",
    lineGroupBindingId: "00000000-0000-4000-8000-000000000099",
    memberId: "00000000-0000-4000-8000-000000000001",
    sourceBookingId: "00000000-0000-4000-8000-000000000002",
    fullName: "林佳琪",
    phone: "0976566820",
    birthDate: "",
    email: null,
    emailUnavailable: true,
    notifyManagerProfileChange: true,
    planId: "00000000-0000-4000-8000-000000000003",
    signedOn: "2026-08-09",
    initialPayment: 1488,
    paymentSchedule: [],
    faFeeRecipientProfileId: "00000000-0000-4000-8000-000000000004",
    faFeeRecipientName: "Miffy｜E000004",
  });

  assert.equal(result.success, true);
});

test("all valid employee accounts including 06 may create a BIG E contract", () => {
  assert.equal(canCreateBigeContract("01"), true);
  assert.equal(canCreateBigeContract("02"), true);
  assert.equal(canCreateBigeContract("E000006"), true);
  assert.equal(canCreateBigeContract("06"), true);
  assert.equal(canCreateBigeContract("member"), false);
});

test("database contract chain does not retain the legacy employee 06 block", () => {
  const migration = readFileSync(
    "supabase/migrations/20260902142421_allow_employee_06_contract_payment.sql",
    "utf8",
  );

  assert.match(
    migration,
    /public\.bige_create_member_contract_v2\(uuid,uuid,uuid,uuid,text,text,date,text,boolean,text,uuid,jsonb,date,text,bigint,text,jsonb,text\)/,
  );
  assert.match(
    migration,
    /forbidden_guard constant text :=[\s\S]*upper\(actor\.employee_number\) = 'E000006' then/,
  );
  assert.match(
    migration,
    /execute replace\(function_definition, forbidden_guard, allowed_guard\)/,
  );
  assert.match(
    migration,
    /upper\(actor\.employee_number\) !~ '\^E\[0-9\]\{6\}\$'/,
  );
  assert.match(migration, /bige_create_member_contract_v2_not_found/);
  assert.match(
    migration,
    /bige_create_member_contract_v2_employee_06_guard_still_present/,
  );
});

test("FA completion requires an explicit converted or not-converted path", () => {
  const bookingId = "00000000-0000-4000-8000-000000000001";
  assert.equal(
    completeTrialOutcomeSchema.safeParse({
      action: "complete_trial_outcome",
      bookingId,
      outcome: "pending_conversion",
    }).success,
    true,
  );
  assert.equal(
    completeTrialOutcomeSchema.safeParse({
      action: "complete_trial_outcome",
      bookingId,
      outcome: "not_converted",
    }).success,
    false,
  );
  assert.equal(
    completeTrialOutcomeSchema.safeParse({
      action: "complete_trial_outcome",
      bookingId,
      outcome: "not_converted",
      faFeeRecipientName: "臨時收款人",
    }).success,
    true,
  );
  assert.equal(
    completeTrialOutcomeSchema.safeParse({
      action: "complete_trial_outcome",
      bookingId,
      outcome: "unknown",
    }).success,
    false,
  );
});

test("FA fee amount follows the original trial service instead of the normalized course type", () => {
  assert.equal(getBigeFaFeeAmount("sports_massage"), 1500);
  assert.equal(getBigeFaFeeAmount("weight_training"), 880);
  assert.equal(getBigeFaFeeAmount("pilates"), 880);
  assert.equal(getBigeFaFeeAmount(null), 880);
});

test("contract schema leaves FA versus BB recipient validation to the trusted booking lookup", () => {
  const baseInput = {
    action: "create_contract" as const,
    lineGroupBindingId: "00000000-0000-4000-8000-000000000099",
    fullName: "測試會員",
    phone: "0912345678",
    birthDate: "1990-01-01",
    email: "member@example.com",
    emailUnavailable: false,
    planId: "00000000-0000-4000-8000-000000000001",
    signedOn: "2026-08-18",
    initialPayment: 1488,
    paymentMethod: "cash" as const,
    paymentSchedule: [],
  };
  const sourceBookingId = "00000000-0000-4000-8000-000000000002";

  assert.equal(
    createContractSchema.safeParse({ ...baseInput, sourceBookingId }).success,
    true,
  );
  assert.equal(
    createContractSchema.safeParse({
      ...baseInput,
      sourceBookingId,
      faFeeRecipientProfileId: "00000000-0000-4000-8000-000000000003",
      faFeeRecipientName: "Annie｜E000003",
    }).success,
    true,
  );
  assert.equal(
    createContractSchema.safeParse({
      ...baseInput,
      faFeeRecipientName: "不應出現在一般合約",
    }).success,
    false,
  );

  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  assert.match(
    route,
    /sourceOperationKind === "trial" && !input\.faFeeRecipientName[\s\S]*請先選擇或輸入 FA 收款人/,
  );
  assert.match(
    route,
    /sourceOperationKind !== "trial"[\s\S]*只有 FA 首次付款可以記錄 FA 收款人/,
  );
});

test("FA conversion corrections require a valid booking and positive integer amount", () => {
  const bookingId = "00000000-0000-4000-8000-000000000001";
  assert.equal(
    changeTrialConversionPaymentSchema.safeParse({
      action: "change_trial_conversion_payment",
      bookingId,
      amount: 10_000,
    }).success,
    true,
  );
  assert.equal(
    changeTrialConversionPaymentSchema.safeParse({
      action: "change_trial_conversion_payment",
      bookingId,
      amount: 0,
    }).success,
    false,
  );
  assert.equal(
    changeTrialConversionPaymentSchema.safeParse({
      action: "change_trial_conversion_payment",
      bookingId,
      amount: 100.5,
    }).success,
    false,
  );
  assert.equal(
    changeTrialConversionOutcomeSchema.safeParse({
      action: "change_trial_conversion_outcome",
      bookingId,
      outcome: "not_converted",
    }).success,
    true,
  );
  assert.equal(
    changeTrialConversionOutcomeSchema.safeParse({
      action: "change_trial_conversion_outcome",
      bookingId,
      outcome: "converted",
    }).success,
    false,
  );
  assert.equal(
    restoreTrialConversionSchema.safeParse({
      action: "restore_trial_conversion",
      bookingId,
    }).success,
    true,
  );
  assert.equal(
    restoreTrialNoSaleSchema.safeParse({
      action: "restore_trial_no_sale",
      bookingId,
    }).success,
    true,
  );
});

test("completed not-converted FA can be restored atomically to untouched", () => {
  const migration = readFileSync(
    "supabase/migrations/20260831150814_restore_fa_outcome_to_untouched.sql",
    "utf8",
  );
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.match(
    migration,
    /status <> 'completed'[\s\S]*trial_conversion_outcome <> 'not_converted'[\s\S]*fa_no_sale_restore_not_available/,
  );
  assert.match(
    migration,
    /set status = 'booked'[\s\S]*operation_result = null[\s\S]*trial_conversion_outcome = null[\s\S]*completed_at = null/,
  );
  assert.match(
    migration,
    /fa_fee_amount = null[\s\S]*fa_fee_recipient_profile_id = null[\s\S]*fa_fee_recipient_name = null[\s\S]*fa_fee_recorded_at = null/,
  );
  assert.match(
    migration,
    /update public\.crm_leads[\s\S]*status = 'trial_booked'[\s\S]*trial_status = 'scheduled'[\s\S]*lost_reason = 'fa_not_converted'/,
  );
  assert.match(
    migration,
    /revoke all on function public\.bige_restore_fa_no_sale_v1\(uuid\)[\s\S]*from public, anon[\s\S]*to authenticated, service_role/,
  );
  assert.match(
    route,
    /input\.action === "restore_trial_no_sale"[\s\S]*canManageBigeSchedule\(auth\.context\)[\s\S]*bige_restore_fa_no_sale_v1/,
  );
  assert.match(
    component,
    /trial_conversion_outcome !== "not_converted"[\s\S]*action: "restore_trial_no_sale"/,
  );
  assert.match(
    component,
    /trial_conversion_outcome === "not_converted"[\s\S]*data\?\.canManageSchedule[\s\S]*復原為未操作/,
  );
});

test("student payment status does not call a student settled before a contract exists", () => {
  assert.equal(
    getBigeStudentPaymentBalanceState({ contractCount: 0, outstandingBalance: 0 }),
    "no_contract",
  );
  assert.equal(
    getBigeStudentPaymentBalanceState({ contractCount: 1, outstandingBalance: 10_000 }),
    "balance_due",
  );
  assert.equal(
    getBigeStudentPaymentBalanceState({ contractCount: 1, outstandingBalance: 0 }),
    "settled",
  );
});

test("schedule payment detail flattens one nested database response", () => {
  const detail = flattenBigeMemberPaymentRelations({
    id: "member-1",
    full_name: "Example Member",
    contracts: [
      {
        id: "contract-old",
        created_at: "2026-01-01T00:00:00.000Z",
        total_amount: 20_000,
        payments: [
          {
            id: "payment-old",
            contract_id: "contract-old",
            amount: 5_000,
            status: "recorded",
            paid_at: "2026-01-02T00:00:00.000Z",
          },
        ],
      },
      {
        id: "contract-new",
        created_at: "2026-02-01T00:00:00.000Z",
        total_amount: 30_000,
        payments: [
          {
            id: "payment-new",
            contract_id: "contract-new",
            amount: 10_000,
            status: "recorded",
            paid_at: "2026-02-02T00:00:00.000Z",
          },
        ],
      },
    ],
  });

  assert.equal(detail.member?.id, "member-1");
  assert.deepEqual(detail.contracts.map((contract) => contract.id), [
    "contract-new",
    "contract-old",
  ]);
  assert.deepEqual(detail.payments.map((payment) => payment.id), [
    "payment-new",
    "payment-old",
  ]);
  assert.equal("payments" in detail.contracts[0], false);
  assert.equal("created_at" in detail.contracts[0], false);
});

test("daily board preloads payment detail for every visible member", () => {
  const details = buildBigeMemberPaymentDetailMap(
    [
      {
        id: "member-1",
        full_name: "First Member",
        contracts: [
          {
            id: "contract-1",
            created_at: "2026-08-01T00:00:00.000Z",
            total_amount: 20_000,
            payments: [
              {
                id: "payment-1",
                contract_id: "contract-1",
                amount: 10_000,
                status: "recorded",
                paid_at: "2026-08-02T00:00:00.000Z",
              },
            ],
          },
        ],
      },
      { id: "member-2", full_name: "Second Member", contracts: [] },
    ],
    {
      canViewDetailedPaymentDates: true,
      canRecordContractPayment: false,
      canManageCourseAllocations: true,
    },
  );

  assert.deepEqual(Object.keys(details), ["member-1", "member-2"]);
  assert.equal(details["member-1"].contracts.length, 1);
  assert.equal(details["member-1"].payments[0].id, "payment-1");
  assert.equal(details["member-1"].canViewDetailedPaymentDates, true);
  assert.equal(details["member-1"].canRecordContractPayment, false);
  assert.equal(details["member-1"].canManageCourseAllocations, true);
  assert.equal(details["member-2"].contracts.length, 0);
});

test("member session summary shows only explicitly allocated specialties", () => {
  const summary = summarizeBigeMemberCourseSessions([
    {
      status: "active",
      total_sessions: 48,
      used_sessions: 18,
      course_allocations_configured_at: "2026-08-17T00:00:00.000Z",
      course_allocations: {
        reformer_pilates: 24,
        weight_training: 20,
        relaxation: 4,
        sports_cupping: 0,
        fascia_knife: 0,
      },
      course_used: {
        reformer_pilates: 8,
        weight_training: 8,
        relaxation: 2,
      },
    },
  ]);

  assert.equal(summary.totalSessions, 48);
  assert.equal(summary.usedSessions, 18);
  assert.equal(summary.unconfiguredContracts, 0);
  assert.deepEqual(summary.allocatedCourseTypes, [
    "weight_training",
    "relaxation",
    "reformer_pilates",
  ]);
  assert.equal(summary.used.reformer_pilates, 8);
  assert.equal(summary.allocations.reformer_pilates, 24);
  assert.equal(summary.allocatedCourseTypes.includes("sports_cupping"), false);
});

test("legacy members keep overall usage while specialties remain unset at zero", () => {
  const summary = summarizeBigeMemberCourseSessions([
    {
      status: "active",
      total_sessions: 48,
      used_sessions: 18,
      course_allocations_configured_at: null,
      course_allocations: {
        weight_training: 48,
        relaxation: 48,
        reformer_pilates: 48,
      },
      course_used: { weight_training: 12 },
    },
  ]);

  assert.equal(summary.totalSessions, 48);
  assert.equal(summary.usedSessions, 18);
  assert.equal(summary.unconfiguredContracts, 1);
  assert.deepEqual(summary.allocatedCourseTypes, []);
  assert.equal(summary.used.weight_training, 0);
});

test("specialty allocation updates accept all six non-negative integer counters", () => {
  const valid = {
    action: "update_course_allocations",
    contractId: "00000000-0000-4000-8000-000000000001",
    allocations: {
      weight_training: 20,
      relaxation: 4,
      reformer_pilates: 24,
      sports_cupping: 0,
      fascia_knife: 0,
      boxing: 0,
    },
  };
  assert.equal(updateCourseAllocationsSchema.safeParse(valid).success, true);
  assert.equal(
    updateCourseAllocationsSchema.safeParse({
      ...valid,
      allocations: { ...valid.allocations, weight_training: -1 },
    }).success,
    false,
  );
  assert.equal(
    updateCourseAllocationsSchema.safeParse({
      ...valid,
      allocations: { ...valid.allocations, reformer_pilates: 1.5 },
    }).success,
    false,
  );
});

test("FA result lighting distinguishes incomplete conversion, converted, and not converted", () => {
  assert.equal(
    getBigeTrialOutcomeVisualState({ outcome: "pending_conversion" }),
    "pending_conversion",
  );
  assert.equal(
    getBigeTrialOutcomeVisualState({ outcome: "not_converted" }),
    "not_converted",
  );
  assert.equal(
    getBigeTrialOutcomeVisualState({ outcome: "converted" }),
    "converted",
  );
  assert.equal(
    getBigeTrialOutcomeVisualState({
      outcome: "not_converted",
      convertedAt: "2026-08-09T00:00:00.000Z",
    }),
    "converted",
  );
});

test("completed FA result remains editable until a formal contract exists", () => {
  assert.equal(canReviseBigeTrialOutcome({ convertedAt: null }), true);
  assert.equal(
    canReviseBigeTrialOutcome({ convertedAt: "2026-08-09T00:00:00.000Z" }),
    false,
  );
});

test("FA outcome selection mode hides every secondary status action", () => {
  assert.deepEqual(
    getBigeTrialBookingActionVisibility({
      outcomePrompt: true,
      status: "booked",
      convertedAt: null,
    }),
    {
      showOutcomeChoices: true,
      showSecondaryStatusActions: false,
    },
  );
  assert.equal(
    getBigeTrialBookingActionVisibility({
      outcomePrompt: false,
      status: "booked",
      convertedAt: null,
    }).showSecondaryStatusActions,
    true,
  );
});

test("active FA exposes not-converted directly instead of an FA-completed chooser", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const actionSection = component.slice(
    component.lastIndexOf("canReviseBigeTrialOutcome({ convertedAt: selectedBooking.converted_at })"),
    component.indexOf("selectedTrialActionVisibility.showSecondaryStatusActions"),
  );

  assert.doesNotMatch(actionSection, /FA 已完成/);
  assert.match(
    actionSection,
    /selectedBooking\.status !== "completed"[\s\S]*openFaFeeRecipientPrompt\("not_converted"\)[\s\S]*"未成交"/,
  );
  assert.match(
    actionSection,
    /selectedBooking\.trial_conversion_outcome === "pending_conversion"[\s\S]*"繼續成交／修改結果"/,
  );
});

test("FA contract identity prefers the original trial booking and fills member gaps", () => {
  assert.deepEqual(
    resolveBigeTrialContractIdentity({
      trialBooking: {
        name: " 體驗學員 ",
        phone: "+886 912-345-678",
        birthday: "1995-03-12",
      },
      member: {
        full_name: "暫存會員",
        phone: null,
        birth_date: null,
      },
    }),
    {
      fullName: "體驗學員",
      phone: "0912345678",
      birthDate: "1995-03-12",
    },
  );
});

test("FA contract identity falls back to member data when imported trial data is incomplete", () => {
  assert.deepEqual(
    resolveBigeTrialContractIdentity({
      trialBooking: {
        name: "",
        phone: "",
        birthday: null,
      },
      member: {
        full_name: "正式姓名",
        phone: "0911222333",
        birth_date: "1990-08-09",
      },
    }),
    {
      fullName: "正式姓名",
      phone: "0911222333",
      birthDate: "1990-08-09",
    },
  );
});

test("missing original FA profile data forces a locked manager-change notification", () => {
  const identity = resolveBigeTrialContractIdentity({
    trialBooking: {
      name: "待補生日學員",
      phone: "0912345678",
      birthday: null,
    },
    member: {
      full_name: "待補生日學員",
      phone: "0912345678",
      birth_date: null,
    },
  });

  assert.deepEqual(getBigeTrialContractMissingProfileFields(identity), ["生日"]);
});

test("custom contract plans support all course allocations and an independent profile-change notice", () => {
  const allocations = {
    weight_training: 3,
    relaxation: 2,
    reformer_pilates: 2,
    sports_cupping: 1,
    fascia_knife: 1,
    boxing: 1,
  };
  assert.equal(validateCourseAllocationTotal(allocations, 10), true);
  assert.equal(
    createContractSchema.safeParse({
      action: "create_contract",
      lineGroupBindingId: "00000000-0000-4000-8000-000000000099",
      fullName: "測試會員",
      phone: "0912345678",
      birthDate: "1990-01-01",
      email: "member@example.com",
      emailUnavailable: false,
      notifyManagerProfileChange: true,
      planMode: "custom",
      planId: null,
      customPlan: {
        name: "自訂十堂",
        description: "一次性合約方案",
        totalSessions: 10,
        totalAmount: 20_000,
        allocations,
        validityDays: 90,
        extensionLimitDays: 30,
      },
      signedOn: "2026-08-09",
      initialPayment: 0,
      paymentSchedule: [],
    }).success,
    true,
  );
});

test("boxing is available across scheduling, allocation, persistence, and existing trial conversion", () => {
  assert.equal(BIGE_COURSE_TYPES.includes("boxing"), true);
  assert.equal(BIGE_CONTRACT_COURSE_TYPES.includes("boxing"), true);
  assert.equal(BIGE_COURSE_LABELS.boxing, "拳擊 Boxing");
  assert.equal(
    createScheduleSchema.safeParse({
      action: "create_schedule",
      memberId: "00000000-0000-4000-8000-000000000012",
      coachId: "00000000-0000-4000-8000-000000000011",
      operationKind: "pt",
      courseType: "boxing",
      startsAt: "2026-08-27T02:00:00.000Z",
      endsAt: "2026-08-27T03:00:00.000Z",
      idempotencyKey: "boxing-schedule-test-20260826",
    }).success,
    true,
  );
  assert.equal(
    validateCourseAllocationTotal(
      {
        weight_training: 0,
        relaxation: 0,
        reformer_pilates: 0,
        sports_cupping: 0,
        fascia_knife: 0,
        boxing: 12,
      },
      12,
    ),
    true,
  );

  const migration = readFileSync(
    "supabase/migrations/20260826142642_add_boxing_course_type.sql",
    "utf8",
  );
  const trialScheduleRoute = readFileSync(
    "app/api/admin/trial-bookings/[id]/schedule/route.ts",
    "utf8",
  );
  const fitnessRoute = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(migration, /bookings_course_type_check[\s\S]*'boxing'/);
  assert.match(migration, /bige_validate_course_allocations[\s\S]*p_allocations->>'boxing'/);
  assert.match(migration, /allowed_courses[\s\S]*'boxing'/);
  assert.match(migration, /bige_create_schedule_booking_v2[\s\S]*when 'boxing' then '拳擊 Boxing'/);
  assert.match(migration, /bige_reschedule_schedule_booking_v2[\s\S]*when 'boxing' then '拳擊 Boxing'/);
  assert.match(trialScheduleRoute, /data\.service === "boxing_fitness"[\s\S]*\? "boxing"/);
  assert.match(fitnessRoute, /completedCourseLabel[\s\S]*BIGE_COURSE_LABELS/);
});

test("contract payment records accept the new ECPay methods and legacy card terminal records", () => {
  const baseInput = {
    action: "record_payment" as const,
    contractId: "00000000-0000-4000-8000-000000000001",
    paymentKind: "balance" as const,
    amount: 5000,
    idempotencyKey: "payment-test-20260805",
  };

  assert.equal(recordPaymentSchema.safeParse({ ...baseInput, method: "ecpay" }).success, true);
  assert.equal(
    recordPaymentSchema.safeParse({
      ...baseInput,
      method: "ecpay_installment",
      installmentCount: 6,
    }).success,
    true,
  );
  assert.equal(
    recordPaymentSchema.safeParse({ ...baseInput, method: "ecpay_installment" }).success,
    false,
  );
  assert.equal(
    recordPaymentSchema.safeParse({ ...baseInput, method: "cash", installmentCount: 6 }).success,
    false,
  );
  assert.equal(recordPaymentSchema.safeParse({ ...baseInput, method: "card_terminal" }).success, true);
});

test("FA payment hides card terminal while preserving legacy payment compatibility", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const contractDialogStart = component.indexOf('{dialog === "contract"');
  const planDialogStart = component.indexOf('{dialog === "plan"', contractDialogStart);
  const contractDialog = component.slice(contractDialogStart, planDialogStart);

  assert.ok(contractDialogStart >= 0);
  assert.ok(planDialogStart > contractDialogStart);
  assert.match(
    contractDialog,
    /studentPaymentContext\?\.paymentType !== "new" \? \(\s*<option value="card_terminal">刷卡機<\/option>\s*\) : null/,
  );
});

test("one receipt can contain multiple validated payment methods", () => {
  const input = {
    action: "record_payments" as const,
    contractId: "00000000-0000-4000-8000-000000000001",
    sourceBookingId: "00000000-0000-4000-8000-000000000002",
    paymentKind: "balance" as const,
    payments: [
      { amount: 3000, method: "cash" as const },
      { amount: 5000, method: "ecpay_installment" as const, installmentCount: 6 },
    ],
    idempotencyKey: "split-payment-test-20260820",
  };

  assert.equal(recordPaymentsSchema.safeParse(input).success, true);
  assert.equal(
    recordPaymentsSchema.safeParse({
      ...input,
      payments: [{ amount: 5000, method: "ecpay_installment" }],
    }).success,
    false,
  );
  assert.equal(
    createContractSchema.safeParse({
      action: "create_contract",
      lineGroupBindingId: "00000000-0000-4000-8000-000000000099",
      fullName: "多元付款會員",
      phone: "0912345678",
      birthDate: "1990-01-01",
      email: "split@example.com",
      emailUnavailable: false,
      planId: "00000000-0000-4000-8000-000000000003",
      signedOn: "2026-08-20",
      initialPayment: 8000,
      paymentMethod: "cash",
      payments: input.payments,
      paymentSchedule: [],
    }).success,
    true,
  );
  assert.equal(
    createContractSchema.safeParse({
      action: "create_contract",
      lineGroupBindingId: "00000000-0000-4000-8000-000000000099",
      fullName: "合計錯誤會員",
      phone: "0912345678",
      birthDate: "1990-01-01",
      email: "mismatch@example.com",
      emailUnavailable: false,
      planId: "00000000-0000-4000-8000-000000000003",
      signedOn: "2026-08-20",
      initialPayment: 9000,
      paymentMethod: "cash",
      payments: input.payments,
      paymentSchedule: [],
    }).success,
    false,
  );
});

test("split payments unlock once and remain linked to their schedule booking", () => {
  const migration = readFileSync(
    "supabase/migrations/20260819163735_add_split_contract_payments_and_booking_badges.sql",
    "utf8",
  );
  const sourceIndexMigration = readFileSync(
    "supabase/migrations/20260819164234_index_split_payment_source_booking_fk.sql",
    "utf8",
  );
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.match(migration, /add column if not exists source_booking_id uuid references public\.bookings/);
  assert.match(migration, /bige_record_contract_payment_v2\([\s\S]*total_amount[\s\S]*'other'/);
  assert.equal((migration.match(/base_result := public\.bige_record_contract_payment_v2/g) || []).length, 1);
  assert.match(migration, /payment_entries_total_mismatch/);
  assert.match(migration, /source_booking_id = p_source_booking_id/);
  assert.match(sourceIndexMigration, /on public\.bige_contract_payments\(source_booking_id\)/);
  assert.match(route, /bige_record_contract_payments_v1/);
  assert.match(route, /p_payment_source_booking_id: input\.sourceBookingId \|\| input\.sourceMemberBookingId \|\| null/);
  assert.match(route, /amountByBookingId[\s\S]*booking_payment_amount: paymentAmount/);
  assert.match(component, /typeof booking\.booking_payment_amount === "number"/);
  assert.match(component, /新增一筆付款方式/);
});

test("schedule payments use a fixed-identity wizard and persist invoice carrier metadata", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260825071500_add_contract_payment_invoice_carrier.sql",
    "utf8",
  );

  assert.equal(normalizeBigeInvoiceCarrier("/ab中c-12.3"), "/ABC-12.3");
  assert.equal(isValidBigeInvoiceCarrier("/ABC1234"), true);
  assert.equal(isValidBigeInvoiceCarrier("中文載具"), false);

  const parsedPayment = recordPaymentsSchema.parse({
    action: "record_payments",
    contractId: "00000000-0000-4000-8000-000000000001",
    sourceBookingId: "00000000-0000-4000-8000-000000000002",
    paymentKind: "balance",
    payments: [{ amount: 1_000, method: "cash" }],
    idempotencyKey: "invoice-carrier-payment-test",
    invoiceCarrier: "/abc1234",
    invoiceCarrierPending: false,
  });
  assert.equal(parsedPayment.invoiceCarrier, "/ABC1234");
  assert.equal(
    recordPaymentsSchema.safeParse({
      action: "record_payments",
      contractId: "00000000-0000-4000-8000-000000000001",
      paymentKind: "balance",
      payments: [{ amount: 1_000, method: "cash" }],
      idempotencyKey: "invoice-carrier-pending-test",
      invoiceCarrier: null,
      invoiceCarrierPending: true,
    }).success,
    true,
  );
  assert.equal(
    recordPaymentsSchema.safeParse({
      action: "record_payments",
      contractId: "00000000-0000-4000-8000-000000000001",
      paymentKind: "balance",
      payments: [{ amount: 1_000, method: "cash" }],
      idempotencyKey: "invoice-carrier-required-test",
      invoiceCarrier: null,
      invoiceCarrierPending: false,
    }).success,
    false,
  );

  assert.match(
    component,
    /\["plan", "payment", "carrier", "recipient", "group", "review"\]/,
  );
  assert.match(component, /className=\{styles\.paymentWizardPinnedHeader\}/);
  assert.match(component, /id=\{contractPaymentWizardActive \? "contract-payment-wizard-form"/);
  assert.match(component, /form="contract-payment-wizard-form"/);
  assert.match(component, /pattern="\[A-Z0-9\+\.\/-\]\{1,80\}"/);
  assert.match(component, /載具候補/);
  assert.match(component, /可直接使用條碼掃描器嗶入/);
  assert.match(
    styles,
    /\.contractPaymentWizardDialog[\s\S]*grid-template-rows: auto auto minmax\(0, 1fr\) auto;[\s\S]*overflow: hidden/,
  );
  assert.match(
    styles,
    /\.contractPaymentWizardForm[\s\S]*min-height: 0;[\s\S]*overflow-y: auto/,
  );
  assert.match(
    styles,
    /\.paymentWizardActions \.button\s*\{[\s\S]*display: inline-flex;[\s\S]*align-items: center;[\s\S]*justify-content: center;[\s\S]*white-space: nowrap;/,
  );
  assert.match(route, /bige_create_member_contract_v9/);
  assert.match(route, /bige_record_contract_payments_v2/);
  assert.match(route, /invoice_carrier_invalid: "發票載具只能包含英文字母/);
  assert.match(migration, /add column if not exists invoice_carrier text/);
  assert.match(migration, /add column if not exists invoice_carrier_pending boolean/);
  assert.match(migration, /bige_apply_payment_invoice_metadata_v1/);
});

test("schedule student payments carry the source booking for server-side identity checks", () => {
  const sourceBookingId = "00000000-0000-4000-8000-000000000009";
  assert.equal(
    recordPaymentSchema.safeParse({
      action: "record_payment",
      contractId: "00000000-0000-4000-8000-000000000001",
      sourceBookingId,
      paymentKind: "balance",
      amount: 10_000,
      method: "cash",
      idempotencyKey: "student-payment-test-20260813",
    }).success,
    true,
  );
  assert.equal(
    createContractSchema.safeParse({
      action: "create_contract",
      lineGroupBindingId: "00000000-0000-4000-8000-000000000099",
      memberId: "00000000-0000-4000-8000-000000000002",
      sourceMemberBookingId: sourceBookingId,
      fullName: "系統將以資料庫姓名覆蓋",
      phone: "0912345678",
      birthDate: "1990-01-01",
      email: "locked@example.com",
      emailUnavailable: false,
      planId: "00000000-0000-4000-8000-000000000003",
      signedOn: "2026-08-13",
      initialPayment: 10_000,
      paymentMethod: "cash",
      paymentSchedule: [],
    }).success,
    true,
  );
});

test("FA and BB conversions use their source booking while member payments keep renewal and balance", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const openStudentPayment = component.slice(
    component.indexOf("const openStudentPayment ="),
    component.indexOf("const submitContract ="),
  );
  const submitContract = component.slice(
    component.indexOf("const submitContract ="),
    component.indexOf("const [planDraft"),
  );
  const paymentTypeField = component.slice(
    component.indexOf('<span className={styles.label}>款項類型</span>'),
    component.indexOf('<span className={styles.label}>金額</span>'),
  );

  assert.match(
    openStudentPayment,
    /booking\.operation_kind === "trial"[\s\S]*\? "new"[\s\S]*\? "balance"[\s\S]*: "renewal"/,
  );
  assert.match(paymentTypeField, /disabled=\{studentPaymentContext\.paymentType === "new"\}/);
  assert.match(paymentTypeField, /<option value="new">新單 New<\/option>/);
  assert.match(paymentTypeField, /<option value="renewal">續約 Re<\/option>/);
  assert.match(paymentTypeField, /<option value="balance">尾款 PTP<\/option>/);
  assert.match(
    submitContract,
    /sourceBookingId: selectedConversionBooking \? selectedBooking\?\.id \|\| null : null/,
  );
  assert.match(
    submitContract,
    /sourceMemberBookingId:[\s\S]*studentPaymentContext\?\.paymentType === "renewal"[\s\S]*\? studentPaymentContext\.bookingId[\s\S]*: null/,
  );
  assert.match(
    route,
    /select\("id, member_id, coach_id, trial_booking_id, operation_kind, starts_at"\)/,
  );
  assert.match(
    route,
    /sourceBookingResult\.data\.operation_kind === "trial"[\s\S]*FA 付款的款項類型固定為新單 New/,
  );
  assert.match(route, /sourceOperationKind === "bb"[\s\S]*bige_create_bb_member_contract_v3/);
});

test("tablet payment and plan number inputs preserve the in-progress text value", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const paymentEntryType = component.slice(
    component.indexOf("type PaymentEntryDraft ="),
    component.indexOf("type CoachDayStatus ="),
  );
  const stableNumberInput = component.slice(
    component.indexOf("function StableNumberInput("),
    component.indexOf("function Dialog("),
  );

  assert.match(paymentEntryType, /amount: string;/);
  assert.match(component, /value=\{entry\.amount\}/);
  assert.match(component, /const amount = event\.target\.value/);
  assert.doesNotMatch(component, /amount: Number\(event\.target\.value\)/);
  assert.match(stableNumberInput, /if \(nextDraft === ""\) return/);
  assert.match(stableNumberInput, /if \(!focusedRef\.current\) setDraft\(String\(value\)\)/);
  assert.match(component, /const terms = calculateContractTerms\(normalizedSessions\)/);
  assert.match(component, /validityDays: terms\.validityDays/);
  assert.match(component, /extensionLimitDays: terms\.extensionLimitDays/);
});

test("paid active FA conversions complete attendance automatically", () => {
  const migration = readFileSync(
    "supabase/migrations/20260815203109_allow_active_fa_conversion_and_auto_complete_paid_fa.sql",
    "utf8",
  );
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const activeStatusPredicate = migration.slice(
    migration.indexOf("and status in"),
    migration.indexOf("and status in") + 180,
  );

  assert.match(migration, /operation_result = ''completed''/);
  assert.match(
    activeStatusPredicate,
    /''pending'', ''confirmed'', ''booked'', ''checked_in'', ''completed''/,
  );
  assert.doesNotMatch(activeStatusPredicate, /cancelled|no_show/);
  assert.match(migration, /'completed_trial_required',[\s\S]*'active_trial_required'/);
  assert.match(
    migration,
    /status = case when p_initial_payment > 0 then ''completed'' else status end/,
  );
  assert.match(
    migration,
    /operation_result = case when p_initial_payment > 0 then ''completed'' else operation_result end/,
  );
  assert.match(
    migration,
    /completed_at = case when p_initial_payment > 0 then coalesce\(completed_at, now\(\)\) else completed_at end/,
  );
  assert.match(route, /active_trial_required: "已取消或未出席的 FA 無法成交"/);
  assert.doesNotMatch(route, /只有實際完成的 FA 才能成交/);
});

test("contract outstanding balance only subtracts active recorded payments", () => {
  const payments = [
    { amount: 2_000, status: "recorded" },
    { amount: 1_000, status: "voided" },
    { amount: 500, status: "refunded" },
  ];

  assert.equal(calculateBigeContractOutstandingBalance(10_000, payments), 8_000);
  assert.equal(
    calculateBigeContractOutstandingBalance(10_000, [
      { amount: 12_000, status: "recorded" },
    ]),
    0,
  );
});

test("contract payments cannot exceed the contract total or outstanding balance", () => {
  assert.equal(isBigeContractPaymentAmountAllowed(118_800, 118_800), true);
  assert.equal(isBigeContractPaymentAmountAllowed(118_801, 118_800), false);
  assert.equal(isBigeContractPaymentAmountAllowed(98_800, 98_800), true);
  assert.equal(isBigeContractPaymentAmountAllowed(98_801, 98_800), false);
  assert.equal(isBigeContractPaymentAmountAllowed(0, 118_800), false);
  assert.equal(
    isBigeContractPaymentAmountAllowed(0, 118_800, { allowZero: true }),
    true,
  );
  assert.equal(
    isBigeContractPaymentAmountAllowed(1_487, 44_640, { minimumAmount: 1_488 }),
    false,
  );
  assert.equal(
    isBigeContractPaymentAmountAllowed(1_488, 44_640, { minimumAmount: 1_488 }),
    true,
  );
});

test("FA conversion cannot create a zero-payment contract while direct contracts remain allowed", () => {
  const baseInput = {
    action: "create_contract" as const,
    lineGroupBindingId: "00000000-0000-4000-8000-000000000099",
    fullName: "測試會員",
    phone: "0912345678",
    birthDate: "1990-01-01",
    email: "member@example.com",
    emailUnavailable: false,
    planId: "00000000-0000-4000-8000-000000000001",
    signedOn: "2026-08-16",
    initialPayment: 0,
    paymentMethod: "cash" as const,
    paymentSchedule: [],
  };

  assert.equal(createContractSchema.safeParse(baseInput).success, true);
  assert.equal(
    createContractSchema.safeParse({
      ...baseInput,
      sourceBookingId: "00000000-0000-4000-8000-000000000002",
    }).success,
    false,
  );
  assert.equal(
    createContractSchema.safeParse({
      ...baseInput,
      sourceMemberBookingId: "00000000-0000-4000-8000-000000000003",
    }).success,
    false,
  );
});

test("every FA result path shares server and database payment barriers", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260815234009_enforce_fa_contract_payment_integrity.sql",
    "utf8",
  );

  assert.match(component, /selectedBooking\?\.operation_kind === "trial"/);
  assert.match(component, /minimumAmount: requiresInitialPayment \? minimumInitialPayment : 0/);
  assert.match(
    component,
    /onClick=\{\(\) => void loadMember\(bookingMember\)\}[\s\S]*?<UserRoundCheck size=\{17\} \/> 付款紀錄/,
  );
  assert.match(route, /const requiresInitialPayment = Boolean\([\s\S]*sourceBookingId[\s\S]*sourceMemberBookingId/);
  assert.match(route, /minimumAmount: minimumInitialPayment/);
  assert.match(migration, /fa_initial_payment_required/);
  assert.match(migration, /payment_amount_exceeds_contract_balance/);
  assert.match(migration, /bige_contract_payment_amount_integrity/);
});

test("FA payment and not-converted actions capture one atomic fee recipient", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260818121947_add_fa_fee_recipient_tracking.sql",
    "utf8",
  );

  assert.match(component, /openFaFeeRecipientPrompt\("confirm_payment"/);
  assert.equal(
    (component.match(/openFaFeeRecipientPrompt\("not_converted"\)/g) || []).length,
    2,
  );
  assert.match(component, /list="fa-fee-recipient-options"/);
  assert.match(component, /選擇員工或自行輸入/);
  assert.match(component, /\/api\/bige-fitness\?faFeeRecipients=1/);
  assert.match(route, /bige_create_member_contract_v8/);
  assert.match(route, /p_sales_origin_coach_id: trustedSalesOriginCoachId/);
  assert.match(
    route,
    /p_sales_origin_kind: sourceOperationKind === "trial" \? "fa" : input\.sourceMemberBookingId \|\| input\.walkIn \? "renewal" : "manual"/,
  );
  assert.match(route, /bige_complete_trial_outcome_v2/);
  assert.match(migration, /trial_service = 'sports_massage' then 1500 else 880/);
  assert.match(migration, /contract_result := public\.bige_create_member_contract_v3/);
  assert.match(migration, /outcome_result := public\.bige_complete_trial_outcome/);
  assert.match(migration, /bige_store_fa_fee_recipient_internal/);
  assert.match(migration, /revoke all on function public\.bige_store_fa_fee_recipient_internal[\s\S]*authenticated/);
});

test("daily schedule dialogs use a sliced macOS-style genie dismissal toward the lower-left dock", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const dialog = component.slice(
    component.indexOf("function Dialog("),
    component.indexOf("function SignaturePad("),
  );

  assert.match(dialog, /const \[isClosing, setIsClosing\] = useState\(false\)/);
  assert.match(dialog, /onMouseDown=\{requestAnimatedClose\}/);
  assert.match(dialog, /onClick=\{requestAnimatedClose\}/);
  assert.match(dialog, /onAnimationEnd=\{completeAnimatedClose\}/);
  assert.match(component, /const DIALOG_CLOSE_ANIMATION_MS = 360/);
  assert.match(component, /const DIALOG_GENIE_SLICE_COUNT = 30/);
  assert.match(dialog, /const dockInset = 16/);
  assert.match(dialog, /cloneNode\(true\)/);
  assert.match(dialog, /styles\.dialogGenieLayer/);
  assert.match(dialog, /styles\.dialogGenieSlice/);
  assert.match(dialog, /Math\.pow\(time, 3\.2\)/);
  assert.match(dialog, /Math\.sin\(Math\.PI \* time\)/);
  assert.match(dialog, /Math\.pow\(verticalProgress, 1\.55\)/);
  assert.match(dialog, /slice\.animate\(keyframes/);
  assert.match(dialog, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(styles, /\.overlayClosing \{[\s\S]*animation: dialogOverlayClose 360ms/);
  assert.match(styles, /\.dialogClosing \{[\s\S]*visibility: hidden/);
  assert.match(styles, /\.dialogGenieLayer \{[\s\S]*position: fixed;[\s\S]*pointer-events: none/);
  assert.match(styles, /\.dialogGenieSlice \{[\s\S]*overflow: hidden;[\s\S]*transform-origin: 0 50%/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.overlayClosing[\s\S]*animation-duration: 0\.01ms !important/,
  );
});

test("existing schedule edits keep payment context and primary actions above the desktop fold", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.match(
    component,
    /editingSchedule\?\.kind === "booking"[\s\S]*?styles\.scheduleEditDialog/,
  );
  assert.match(
    component,
    /styles\.scheduleEditNoteField[\s\S]*?styles\.scheduleEditActions/,
  );
  assert.match(
    styles,
    /\.managerPage \.scheduleEditDialog \.studentPaymentSummary \{[\s\S]*?grid-template-columns:/,
  );
  assert.match(
    styles,
    /\.managerPage \.scheduleEditDialog \.dialogHeader \{[\s\S]*?margin-bottom: 4px;[\s\S]*?padding-bottom: 4px;/,
  );
  assert.doesNotMatch(styles, /\.managerPage \.scheduleEditDialog \.dialogTitle \{/);
  assert.match(component, /lockedTitleLabel\?: string/);
  assert.match(
    component,
    /lockedTitleLabel=\{[\s\S]*?editingSchedule\?\.kind === "booking"[\s\S]*?scheduleOperationKindLabel/,
  );
  assert.match(component, /if \(operationKind === "trial"\) return trialStage \|\| "FA 體驗";/);
  assert.match(component, /return operationKind === "bb" \? "BB 回訪" : "PT 正式課";/);
  assert.match(
    component,
    /editingSchedule\?\.kind === "booking" \? \([\s\S]*?<ScheduleDurationField[\s\S]*?editingSchedule\?\.kind !== "note"/,
  );
  assert.match(
    component,
    /editingSchedule\?\.kind !== "booking" \? \([\s\S]*?<label className=\{styles\.field\}>[\s\S]*?<span className=\{styles\.label\}>類型<\/span>/,
  );
  assert.match(
    styles,
    /\.dialogLockedLabel \{[\s\S]*?display: inline-flex;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(
    styles,
    /\.managerPage \.scheduleEditDialog \.scheduleEditNoteField \{[\s\S]*?grid-column: 1;/,
  );
  assert.match(
    styles,
    /\.managerPage \.scheduleEditDialog \.scheduleEditActions \{[\s\S]*?grid-column: 2;/,
  );
  assert.match(
    styles,
    /\.managerPage \.scheduleEditDialog \.scheduleEditActions \.button \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(
    styles,
    /\.managerPage \.scheduleEditDialog \.studentCourseSessionHeader \.button \{\s*width: 127\.2px;\s*\}/,
  );
  assert.match(
    styles,
    /@media \(max-width: 780px\)[\s\S]*?\.managerPage \.scheduleEditDialog \.scheduleEditActions \{[\s\S]*?grid-column: 1 \/ -1;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 780px\)[\s\S]*?\.managerPage \.scheduleEditDialog \.studentCourseSessionHeader \.button \{\s*width: 100%;\s*\}/,
  );
});

test("existing FA schedule edits show the student's phone and birthday", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.match(
    component,
    /const editingScheduleTrialIdentity =\s*[\s\S]*?editingSchedule\.item\.operation_kind === "trial"[\s\S]*?resolveBigeTrialContractIdentity\(\{[\s\S]*?trialBookings\.get\(editingSchedule\.item\.trial_booking_id\)[\s\S]*?members\.get\(editingSchedule\.item\.member_id\)/,
  );
  assert.match(
    component,
    /editingScheduleTrialIdentity \? \([\s\S]*?aria-label="FA 學員聯絡資料"[\s\S]*?<dt>電話<\/dt>[\s\S]*?editingScheduleTrialIdentity\.phone \|\| "尚未提供"[\s\S]*?<dt>生日<\/dt>[\s\S]*?formatBirthDate\(editingScheduleTrialIdentity\.birthDate\)/,
  );
  assert.match(
    styles,
    /\.managerPage \.scheduleEditDialog \.scheduleStudentIdentity \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
});

test("every save-changes button keeps a centered layout", () => {
  const operations = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const operationsStyles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const staff = readFileSync("app/manager/staff/page.tsx", "utf8");
  const staffStyles = readFileSync("app/manager/staff/page.module.css", "utf8");

  assert.equal((operations.match(/儲存變更/g) ?? []).length, 2);
  assert.equal((staff.match(/儲存變更/g) ?? []).length, 1);
  assert.match(
    operationsStyles,
    /\.managerPage \.scheduleEditDialog \.scheduleEditActions \.button \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(
    operations,
    /trialConversionSubmitting === "change"[\s\S]*?: "儲存變更"/,
  );
  assert.match(
    staff,
    /<Save size=\{17\} \/>[\s\S]*?儲存變更/,
  );
  assert.match(
    staffStyles,
    /\.button \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?gap: 7px;/,
  );
});

test("iPad Pro landscape keeps the desktop schedule overview and fills the viewport vertically", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const assistanceButtonIndex = component.indexOf("行政協助事項");
  const addCoachButtonIndex = component.indexOf("新增教練");
  const navigationEndIndex = component.indexOf("</nav>", assistanceButtonIndex);

  assert.match(component, /ipadScreenLongEdge >= 1190/);
  assert.match(component, /data-ipad-pro-desktop-layout/);
  assert.match(component, /data-daily-schedule-active=\{tab === "schedule"/);
  assert.match(component, /var\(--schedule-row-height, 46px\)/);
  assert.match(styles, /minmax\(180px, 1fr\)/);
  assert.match(
    styles,
    /@media \(orientation: landscape\) and \(min-width: 1024px\)[\s\S]*data-ipad-pro-desktop-layout="true"[\s\S]*min-width: 0;[\s\S]*var\(--ipad-time-column\) minmax\(0, 1fr\)/,
  );
  assert.match(
    styles,
    /data-ipad-pro-desktop-layout="true"\]\[data-daily-schedule-active="true"\][\s\S]*--schedule-row-height: max\(46px, calc\(\(100dvh - 130px\) \/ 15\)\)[\s\S]*min-height: var\(--schedule-row-height\)/,
  );
  assert.match(
    styles,
    /data-ipad-pro-desktop-layout="true"\] \.navigationRow \{[\s\S]*display: grid;[\s\S]*grid-template-columns: max-content minmax\(0, 1fr\);[\s\S]*overflow: visible;/,
  );
  assert.match(
    styles,
    /data-ipad-pro-desktop-layout="true"\] \.tabs \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*flex-wrap: wrap;/,
  );
  assert.match(
    styles,
    /data-ipad-pro-desktop-layout="true"\] \.dateToolbarDock \{[\s\S]*grid-column: 1;[\s\S]*justify-self: start;/,
  );
  assert.match(
    styles,
    /data-ipad-pro-desktop-layout="true"\] \.businessDayControls \{[\s\S]*grid-column: 2;[\s\S]*justify-content: flex-end;[\s\S]*flex-wrap: wrap;/,
  );
  assert.match(
    styles,
    /data-ipad-schedule-overview="true"\] \.bookingTrial\.cellEntryHalf \{[\s\S]*left: calc\(-1 \* var\(--ipad-time-column\) \+ 3px\);/,
  );
  assert.match(
    styles,
    /data-ipad-schedule-overview="true"\] \.bookingPrimaryLine \.bookingStudentCode \{[\s\S]*flex: 1 0 100%;/,
  );
  assert.doesNotMatch(
    styles,
    /data-ipad-schedule-overview="true"\] \.bookingStudentCode \{\s*flex: 1 0 100%;/,
  );
  assert.ok(assistanceButtonIndex >= 0);
  assert.ok(addCoachButtonIndex > assistanceButtonIndex);
  assert.ok(addCoachButtonIndex < navigationEndIndex);
  assert.doesNotMatch(component, /className=\{styles\.scheduleActions\}/);
});

test("wide desktop schedule separates navigation from date and daily controls", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const desktopStart = styles.indexOf("/* Wide desktop schedule:");
  const desktopEnd = styles.indexOf("/*\n * iPad daily schedule overview", desktopStart);

  assert.ok(desktopStart >= 0);
  assert.ok(desktopEnd > desktopStart);

  const desktopLayout = styles.slice(desktopStart, desktopEnd);

  assert.match(
    desktopLayout,
    /@media \(min-width: 1280px\)[\s\S]*data-daily-schedule-active="true"\] \.navigationRow \{[\s\S]*display: grid;[\s\S]*grid-template-columns: max-content minmax\(0, 1fr\);[\s\S]*overflow: visible;/,
  );
  assert.match(
    desktopLayout,
    /data-daily-schedule-active="true"\] \.tabs \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*width: 100%;[\s\S]*flex-wrap: wrap;/,
  );
  assert.match(
    desktopLayout,
    /data-daily-schedule-active="true"\] \.dateToolbarDock \{[\s\S]*grid-column: 1;[\s\S]*justify-self: start;/,
  );
  assert.match(
    desktopLayout,
    /data-daily-schedule-active="true"\] \.businessDayControls \{[\s\S]*grid-column: 2;[\s\S]*width: 100%;[\s\S]*justify-content: flex-end;[\s\S]*flex-wrap: wrap;/,
  );
  assert.doesNotMatch(desktopLayout, /overflow-x: auto|flex-wrap: nowrap/);
  assert.match(
    desktopLayout,
    /Wide desktop schedule:[\s\S]*two deliberate rows[\s\S]*without horizontal scrolling/,
  );
  assert.match(component, /data-role-view=\{view\}/);
  assert.match(
    desktopLayout,
    /@media \(min-width: 1280px\) and \(hover: hover\) and \(pointer: fine\)[\s\S]*data-role-view="manager"\]\[data-daily-schedule-active="true"\]:not\(\[data-ipad-schedule-overview="true"\]\) \.board \{[\s\S]*--schedule-row-height: max\(46px, calc\(\(100dvh - 150px\) \/ 15\)\)[\s\S]*min-height: var\(--schedule-row-height\)/,
  );
});

test("approvals navigation keeps its icon and label centered on one row", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.match(
    component,
    /styles\.navigationIconTab[\s\S]*?href="\/manager\/approvals"[\s\S]*?<ClipboardCheck size=\{16\} \/>[\s\S]*?待覆核事項/,
  );
  assert.match(
    styles,
    /\.navigationIconTab \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?gap: 6px;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(styles, /\.navigationIconTab svg \{\s*flex: 0 0 auto;\s*\}/);
});

test("daily schedule noir-gold palette is color-only and scoped to the active schedule", () => {
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const startMarker = "/* Daily schedule noir-gold palette — color-only overrides. */";
  const endMarker = "/* End daily schedule noir-gold palette. */";
  const paletteStart = styles.indexOf(startMarker);
  const paletteEnd = styles.indexOf(endMarker);

  assert.ok(paletteStart >= 0);
  assert.ok(paletteEnd > paletteStart);

  const palette = styles.slice(paletteStart, paletteEnd + endMarker.length);

  assert.match(palette, /\.frontdeskM2A\[data-daily-schedule-active="true"\]/);
  assert.match(palette, /--schedule-noir: #080a0c/);
  assert.match(palette, /--schedule-charcoal: #0d1114/);
  assert.match(palette, /--schedule-gold: #c9a55c/);
  assert.match(palette, /--schedule-gold-bright: #e4c77a/);
  assert.match(palette, /\.activeTab[\s\S]*0 0 24px rgba\(228, 199, 122, 0\.2\)/);
  assert.match(palette, /\.tabs \.primary:not\(\.activeTab\)[\s\S]*rgba\(38, 34, 25, 0\.9\)/);
  assert.match(palette, /\.navigationRow \.tab:not\(\.activeTab\)[\s\S]*rgba\(201, 165, 92, 0\.38\)/);
  assert.match(palette, /\.navigationRow \.dateToolbar \.input[\s\S]*rgba\(228, 199, 122, 0\.52\)[\s\S]*0 0 18px rgba\(201, 165, 92, 0\.13\)/);
  assert.match(palette, /\.navigationRow \.dateToolbar \.iconButton[\s\S]*rgba\(201, 165, 92, 0\.46\)[\s\S]*0 0 15px rgba\(201, 165, 92, 0\.1\)/);
  assert.match(palette, /\.navigationRow \.dateToolbar \.weekdayBadge[\s\S]*rgba\(228, 199, 122, 0\.58\)[\s\S]*0 0 18px rgba\(228, 199, 122, 0\.15\)/);
  assert.match(palette, /\.navigationRow \.businessDayControls[\s\S]*rgba\(201, 165, 92, 0\.4\)/);
  assert.match(palette, /\.navigationRow \.tab:not\(\.activeTab\):hover[\s\S]*0 0 18px rgba\(228, 199, 122, 0\.16\)/);
  assert.match(palette, /\.glass\.boardWrap[\s\S]*rgba\(6, 8, 9, 0\.96\)/);
  assert.match(palette, /\.bookingCompleted[\s\S]*#68ffad/);
  assert.match(palette, /\.bookingNoShow[\s\S]*#64beff/);
  assert.match(palette, /\.coachStatusBadge\[data-status="off"\][\s\S]*rgba\(105, 45, 38, 0\.28\)/);
  assert.match(palette, /\.coachStatusBadge\[data-status="early"\][\s\S]*rgba\(245, 158, 11, 0\.24\)/);
  assert.match(palette, /\.coachStatusBadge\[data-status="late"\][\s\S]*rgba\(34, 68, 112, 0\.42\)/);
  assert.match(palette, /\.coachHead\[data-coach-status="early"\][\s\S]*rgba\(245, 158, 11, 0\.2\)/);
  assert.match(palette, /\.timeCell\[data-coach-status="early"\][\s\S]*#fcd98a/);
  assert.match(palette, /\.slotCell\[data-coach-status="early"\][\s\S]*rgba\(245, 158, 11, 0\.12\)/);
  assert.doesNotMatch(
    palette,
    /(?:^|[;{]\s*)(?:display|position|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|padding|margin|gap|grid-template(?:-columns|-rows)?|overflow(?:-x|-y)?|transform|border-radius|font-size|line-height|letter-spacing|white-space)\s*:/m,
  );
});

test("iPadOS Safari date inputs stay inside the contract form grid", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.match(
    component,
    /簽約日[\s\S]*className=\{styles\.input\}[\s\S]*type="date"[\s\S]*付款方式/,
  );
  assert.match(
    styles,
    /@supports \(-webkit-touch-callout: none\)[\s\S]*\.managerPage \.dialog \.input\[type="date"\][\s\S]*width: calc\(100% - 32px\);[\s\S]*max-width: calc\(100% - 32px\);/,
  );
});

test("daily schedule trash deletes only the booking and stays at the viewport top center", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(component, /kind: "schedule-delete"/);
  assert.match(component, /只會刪除這筆預約，不會刪除會員資料/);
  assert.match(component, /action: "delete_schedule_booking", bookingId: booking\.id/);
  assert.match(
    styles,
    /\.scheduleDeleteDropZone \{[\s\S]*position: fixed;[\s\S]*top: max\(16px, env\(safe-area-inset-top\)\);[\s\S]*left: 50%;/,
  );
  assert.match(route, /input\.action === "delete_schedule_booking"/);
  assert.match(route, /status_reason: BIGE_SCHEDULE_TRASH_DELETE_REASON/);
  assert.doesNotMatch(route, /input\.action === "delete_schedule_booking"[\s\S]{0,4000}\.delete\(\)/);
});

test("PT booking dialog adds a delete-reservation button beside marking absent", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const noShowLabelIndex = component.lastIndexOf("標記未出席");
  const deleteLabelIndex = component.indexOf("刪除此預約", noShowLabelIndex);
  const ptBookingActions = component.slice(noShowLabelIndex - 500, deleteLabelIndex + 100);

  assert.notEqual(noShowLabelIndex, -1);
  assert.ok(deleteLabelIndex > noShowLabelIndex);
  assert.match(
    ptBookingActions,
    /標記未出席[\s\S]*deleteScheduleBooking\(selectedBooking, \{[\s\S]*closeBookingDialog: true,[\s\S]*刪除此預約/,
  );
  assert.match(
    component,
    /確定刪除「\$\{label\}」[\s\S]*只會刪除這筆預約，不會刪除會員資料/,
  );
  assert.match(
    component,
    /options\.closeBookingDialog[\s\S]*setDialog\(null\);[\s\S]*setSelectedBooking\(null\);/,
  );
});

test("completed and deducted daily schedule entries keep a steady green glow without blinking", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.match(
    component,
    /booking\.status === "completed" \? styles\.bookingCompleted : ""/,
  );
  assert.match(
    styles,
    /\.bookingCompleted,[\s\S]*filter:[\s\S]*drop-shadow\(0 0 6px rgba\(104, 255, 173, 0\.88\)\)/,
  );
  assert.doesNotMatch(styles, /bookingCompletedGreenGlow/);
  assert.doesNotMatch(
    styles,
    /\.bookingCompleted,[\s\S]*?\.frontdeskM2A \.bookingCompleted \{[^}]*animation:/,
  );
});

test("completing a PT booking paints the completed state before slow server follow-up", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const completePt = component.slice(
    component.indexOf("const completePt = async"),
    component.indexOf("const updateBooking = async"),
  );

  assert.match(
    completePt,
    /const optimisticStatus = restoring \? "booked" : "completed";[\s\S]*applyOptimisticBookingUpdate\(data, booking\.id/,
  );
  assert.match(
    completePt,
    /void runOptimisticScheduleMutation\(\{[\s\S]*apply: \(\) => \{[\s\S]*setSelectedBooking\([\s\S]*status: optimisticStatus,[\s\S]*storeBoardCache\([\s\S]*setData\(optimisticData\)/,
  );
  assert.match(
    completePt,
    /request: \(\) =>[\s\S]*restore_booking_completion[\s\S]*complete_booking[\s\S]*preserveFeedback: true/,
  );
  assert.match(
    completePt,
    /commit: \(\) => \{[\s\S]*void loadBoard\(\{ silent: true, targetDate: operationDate \}\)/,
  );
  assert.match(
    completePt,
    /rollback: \(caught\) => \{[\s\S]*setData\(previousData\)[\s\S]*setSelectedBooking\(booking\)[\s\S]*showOperationAlert/,
  );
  assert.doesNotMatch(completePt, /await loadBoard\(/);
});

test("creating a selected schedule member paints the cell before the request finishes", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const optimisticCreate = component.slice(
    component.indexOf("function applyOptimisticBookingCreate"),
    component.indexOf("function applyOptimisticScheduleBookingDelete"),
  );
  const submitSchedule = component.slice(
    component.indexOf("const submitSchedule = async"),
    component.indexOf("const deleteScheduleNote = async"),
  );

  assert.match(
    submitSchedule,
    /const optimisticBooking: Booking = \{[\s\S]*optimistic: true,[\s\S]*member_id:[\s\S]*scheduleDraft\.operationKind === "pt"[\s\S]*scheduleDraft\.operationKind === "bb"[\s\S]*selectedScheduleTrialResult\?\.member_id[\s\S]*starts_at: new Date\(startsAt\)\.toISOString\(\)/,
  );
  assert.match(
    optimisticCreate,
    /selectedTarget\?\.member[\s\S]*members[\s\S]*selectedTarget\?\.trialBooking[\s\S]*trialBookings/,
  );
  assert.match(
    submitSchedule,
    /applyOptimisticBookingCreate\(data, optimisticBooking, \{[\s\S]*selectedScheduleMemberResult[\s\S]*selectedScheduleTrialResult/,
  );
  assert.match(
    component,
    /setSelectedScheduleMemberResult\(item as Member\)[\s\S]*setSelectedScheduleTrialResult\(item as TrialBookingSummary\)/,
  );
  assert.match(
    submitSchedule,
    /void runOptimisticScheduleMutation\(\{[\s\S]*apply: \(\) => \{[\s\S]*setDialog\(null\)[\s\S]*storeBoardCache\([\s\S]*setData\(optimisticData\)/,
  );
  assert.match(
    submitSchedule,
    /request: \(\) =>[\s\S]*post\(requestBody,[\s\S]*preserveFeedback: true,[\s\S]*errorPresentation: "inline"/,
  );
  assert.match(
    submitSchedule,
    /commit: \(result\) => \{[\s\S]*bookingId[\s\S]*const legacyReferenceWarning[\s\S]*setSuccess\([\s\S]*: "排課已建立",[\s\S]*loadBoard\(\{ silent: true, targetDate: operationDate \}\)/,
  );
  assert.match(
    submitSchedule,
    /rollback: \(caught\) => \{[\s\S]*applyOptimisticScheduleBookingDelete\([\s\S]*showOperationAlert/,
  );
  assert.doesNotMatch(
    submitSchedule.slice(submitSchedule.indexOf("const optimisticBookingId")),
    /await post\(/,
  );

  assert.match(
    component,
    /const isOptimisticBooking = Boolean\(booking\?\.optimistic\);[\s\S]*enabled=\{props\.canDrag && !isOptimisticBooking\}/,
  );
  const optimisticBookingRender = component.slice(
    component.indexOf("const isOptimisticBooking = Boolean"),
    component.indexOf("</DraggableScheduleEntry>", component.indexOf("const isOptimisticBooking = Boolean")),
  );
  assert.doesNotMatch(optimisticBookingRender, /建立中…/);
  assert.match(
    optimisticBookingRender,
    /booking\.operation_kind === "trial"[\s\S]*trialName[\s\S]*member\?\.full_name/,
  );
});

test("marking a PT booking absent paints a steady blue glow before the request finishes", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const updateBooking = component.slice(
    component.indexOf("const updateBooking = async"),
    component.indexOf("const openBooking ="),
  );
  const noShowLabelIndex = component.lastIndexOf("標記未出席");
  const ptBookingActions = component.slice(noShowLabelIndex - 400, noShowLabelIndex + 100);

  assert.notEqual(noShowLabelIndex, -1);
  assert.match(ptBookingActions, /onClick=\{\(\) => void updateBooking\("no_show"\)\}[\s\S]*標記未出席/);
  assert.doesNotMatch(ptBookingActions, /updateBooking\("cancelled"\)/);
  assert.match(component, /booking\.status === "no_show" \? styles\.bookingNoShow : ""/);
  assert.match(
    updateBooking,
    /const status = result === "completed" \? "completed" : result === "no_show" \? "no_show" : "cancelled";[\s\S]*apply: \(\) => \{[\s\S]*setData\(optimisticData\)[\s\S]*request: \(\) =>[\s\S]*await post\(/,
  );
  assert.match(
    styles,
    /\.bookingNoShow,[\s\S]*filter:[\s\S]*drop-shadow\(0 0 6px rgba\(100, 190, 255, 0\.88\)\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.bookingNoShow,[\s\S]*?\.frontdeskM2A \.bookingNoShow \{[^}]*animation:/,
  );
});

test("a no-show PT or FA booking can be restored without changing lesson balances", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260815184615_restore_bige_no_show_schedule_booking.sql",
    "utf8",
  );
  const restoreNoShow = component.slice(
    component.indexOf("const restoreNoShowSchedule = async"),
    component.indexOf("const toggleTrialReminder = async"),
  );
  const noShowDialog = component.slice(
    component.indexOf('selectedBooking.status === "no_show" ?'),
    component.indexOf('selectedBooking.operation_kind === "pt" ?'),
  );

  assert.match(
    restoreNoShow,
    /selectedBooking\.status !== "no_show"[\s\S]*status: "booked",[\s\S]*operation_result: null/,
  );
  assert.match(
    restoreNoShow,
    /apply:[\s\S]*storeBoardCache[\s\S]*action: "restore_no_show_booking"[\s\S]*rollback:[\s\S]*setData\(previousData\)/,
  );
  assert.match(noShowDialog, /此課程已標記未出席[\s\S]*復原未出席/);
  assert.match(noShowDialog, /此操作不會扣除堂數/);
  assert.match(route, /input\.action === "restore_no_show_booking"/);
  assert.match(route, /bige_restore_no_show_schedule_booking/);
  assert.match(route, /no_show_restore_not_available: "這堂課目前不是未出席狀態，無法復原"/);
  assert.match(migration, /booking_row\.status <> 'no_show'/);
  assert.match(migration, /raise exception 'member_time_conflict'/);
  assert.match(migration, /set status = 'booked',[\s\S]*operation_result = null/);
  assert.match(migration, /fitness_session_no_show_reversed/);
  assert.doesNotMatch(migration, /member_plan_contracts|session_redemptions|member_plan_ledger/);
  assert.match(
    migration,
    /revoke all on function public\.bige_restore_no_show_schedule_booking\(uuid\)[\s\S]*from public, anon/,
  );
});

test("coach reordering synchronizes cached dates and protects late prefetch responses", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.match(component, /const coachOrderIdsRef = useRef<string\[\] \| null>\(null\)/);
  assert.match(component, /const coachOrderRevisionRef = useRef\(0\)/);
  assert.match(component, /const requestedWhileCoachOrderPending = coachOrderPendingRef\.current/);
  assert.match(
    component,
    /synchronizeCoachOrderAcrossBoards\(boardCacheRef\.current, nextCoachIds\)/,
  );
  assert.match(
    component,
    /requestedCoachOrderRevision !== coachOrderRevisionRef\.current[\s\S]*applyCoachIdOrder\(fetched\.coaches, orderedCoachIds\)/,
  );
});

test("coach reordering requires the schedule to be explicitly unlocked", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const coachIds = ["00000000-0000-4000-8000-000000000011"];

  assert.equal(
    reorderScheduleCoachesSchema.safeParse({
      action: "reorder_schedule_coaches",
      coachIds,
    }).success,
    false,
  );
  assert.equal(
    reorderScheduleCoachesSchema.safeParse({
      action: "reorder_schedule_coaches",
      scheduleUnlocked: true,
      coachIds,
    }).success,
    true,
  );
  assert.match(
    component,
    /persistCoachOrder[\s\S]*!data\?\.canReorderCoaches \|\| !scheduleDragUnlocked \|\| coachOrderSubmitting/,
  );
  assert.match(
    component,
    /enabled=\{[\s\S]*Boolean\(data\.canReorderCoaches\)[\s\S]*scheduleDragUnlocked[\s\S]*!coachOrderSubmitting/,
  );
  assert.match(
    component,
    /action: "reorder_schedule_coaches",[\s\S]*scheduleUnlocked: true/,
  );
});

test("daily schedule preserves the protected ten-day warm window and anti-thrashing headroom", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.equal(BIGE_BOARD_PREFETCH_RADIUS, 10);
  assert.equal(BIGE_BOARD_PREFETCH_CONCURRENCY, 2);
  assert.match(component, /const BOARD_CACHE_LIMIT = BIGE_BOARD_PREFETCH_RADIUS \* 6 \+ 1;/);
  assert.match(component, /buildBigeBoardPrefetchDates\(centerDate\)/);
  assert.match(
    component,
    /const selectBoardDate[\s\S]*boardPrefetchQueueRef\.current\?\.prioritize\(nextDate\)/,
  );
});

test("daily schedule prefetches nearest dates first and never starts more than two background requests", async () => {
  const dates = buildBigeBoardPrefetchDates("2026-08-17");
  assert.equal(dates.length, 20);
  assert.deepEqual(dates.slice(0, 6), [
    "2026-08-16",
    "2026-08-18",
    "2026-08-15",
    "2026-08-19",
    "2026-08-14",
    "2026-08-20",
  ]);

  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const queue = new BigeBoardPrefetchQueue();
  queue.replace(dates.slice(0, 5), {
    run: (targetDate) => {
      started.push(targetDate);
      return new Promise<void>((resolve) => finish.set(targetDate, resolve));
    },
  });

  assert.deepEqual(started, dates.slice(0, 2));
  assert.equal(queue.getState().activeCount, 2);
  assert.deepEqual(queue.getState().pendingDates, dates.slice(2, 5));

  queue.prioritize(dates[2]);
  finish.get(dates[0])?.();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(started, [dates[0], dates[1], dates[3]]);
  assert.equal(queue.getState().activeCount, 2);
  assert.deepEqual(queue.getState().pendingDates, [dates[4]]);
});

test("daily schedule loading keeps the board palette and flips time cells only", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const loadingBoard = component.match(
    /function DailyScheduleLoadingBoard\(\)[\s\S]*?\n}\n\nexport default function BigeFitnessOperations/,
  )?.[0];
  const rowStyle = component.match(
    /function dailyScheduleLoadingRowStyle\([\s\S]*?\n}/,
  )?.[0];
  const upperFlip = styles.match(
    /@keyframes schedule-loading-flip-upper\s*{[\s\S]*?\n}\n\n@keyframes schedule-loading-flip-lower/,
  )?.[0];
  const lowerFlip = styles.match(
    /@keyframes schedule-loading-flip-lower\s*{[\s\S]*?\n}\n\n@keyframes schedule-loading-dot/,
  )?.[0];

  assert.ok(loadingBoard);
  assert.ok(rowStyle);
  assert.ok(upperFlip);
  assert.ok(lowerFlip);
  assert.match(component, /const DAILY_SCHEDULE_LOADING_COACH_COUNT = 7;/);
  assert.match(component, /const DAILY_SCHEDULE_LOADING_ROW_STEP_MS = 65;/);
  assert.match(component, /const DAILY_SCHEDULE_LOADING_SECOND_TURN_MS = 1900;/);
  assert.match(component, /\{ length: 15 \}/);
  assert.match(component, /loading \? <DailyScheduleLoadingBoard \/>/);
  assert.match(loadingBoard, /aria-busy="true"/);
  assert.match(loadingBoard, /const \[loadingPage, setLoadingPage\] = useState\(0\)/);
  assert.match(loadingBoard, /window\.setTimeout/);
  assert.match(loadingBoard, /setLoadingPage\(1\)/);
  assert.match(loadingBoard, /DAILY_SCHEDULE_LOADING_SECOND_TURN_MS/);
  assert.match(loadingBoard, /window\.clearTimeout\(timer\)/);
  assert.doesNotMatch(loadingBoard, /window\.setInterval|current \+ 1/);
  assert.doesNotMatch(loadingBoard, /data-loading-turn|data-loading-coach/);
  assert.match(loadingBoard, /<LoadingFlipMechanism/);
  assert.match(loadingBoard, /data-loading-row=\{rowIndex \+ 1\}/);
  assert.match(loadingBoard, /style=\{dailyScheduleLoadingRowStyle\(rowIndex \+ 1\)\}/);
  assert.equal(loadingBoard.match(/<LoadingFlipMechanism/g)?.length, 1);
  assert.match(loadingBoard, /className=\{`\$\{styles\.timeCell\} \$\{styles\.loadingFlipCell\}`\}/);
  assert.doesNotMatch(
    loadingBoard,
    /className=\{`\$\{styles\.(?:timeHead|coachHead|slotCell)\} \$\{styles\.loadingFlipCell\}`\}/,
  );
  assert.match(rowStyle, /--loading-row-delay/);
  assert.doesNotMatch(rowStyle, /coachIndex/);
  assert.match(component, /styles\.loadingFlipUpperFlap/);
  assert.match(component, /styles\.loadingFlipLowerFlap/);
  assert.match(component, /styles\.loadingFlipHinge/);
  assert.match(component, /function LoadingTimeFace/);
  assert.match(component, /data-loading-half=\{half\}/);
  assert.doesNotMatch(component, /data-loading-page-face|pageFace:/);
  assert.match(
    loadingBoard,
    /oldValue=\{dailyScheduleLoadingHourLabel\(hour \+ loadingPage - 1\)\}/,
  );
  assert.match(
    loadingBoard,
    /newValue=\{dailyScheduleLoadingHourLabel\(hour \+ loadingPage\)\}/,
  );
  assert.match(loadingBoard, /key=\{`time:\$\{loadingPage\}`\}/);
  assert.doesNotMatch(loadingBoard, /key=\{`(?:slot|time-head|coach-head):\$\{loadingPage\}`\}/);
  assert.doesNotMatch(loadingBoard, /fetch\(|requestBoard|loadBoard|setLoading\(|setData|setDate/);
  assert.doesNotMatch(component, /dailyScheduleLoadingCellStyle|--loading-flip-delay|loadingFlipBlade/);
  assert.match(styles, /\.loadingFlipUpperFlap[\s\S]*transform-origin: 50% 100%/);
  assert.match(styles, /\.loadingFlipLowerFlap[\s\S]*transform-origin: 50% 0%/);
  assert.match(styles, /animation: schedule-loading-flip-upper 720ms/);
  assert.match(styles, /animation: schedule-loading-flip-lower 720ms/);
  assert.match(styles, /animation-delay: var\(--loading-row-delay\)/);
  assert.doesNotMatch(styles, /--loading-(?:final|inverse)|data-loading-turn|data-loading-coach/);
  assert.match(styles, /\.timeCell\s*{[\s\S]*--schedule-time-cell-surface: rgba\(241, 246, 252, 0\.9\);[\s\S]*background: var\(--schedule-time-cell-surface\)/);
  assert.match(styles, /\.frontdeskM2A \.timeCell\s*{[\s\S]*--schedule-time-cell-surface:[\s\S]*linear-gradient\(90deg, rgba\(56, 65, 70, 0\.28\), rgba\(14, 29, 41, 0\.34\)\);[\s\S]*background: var\(--schedule-time-cell-surface\)/);
  assert.match(styles, /\.loadingFlipCell\s*{[\s\S]*background: var\(--schedule-time-cell-surface\)/);
  assert.match(styles, /\.loadingFlipUpperFlap\s*{[\s\S]*background: var\(--schedule-time-cell-surface\)/);
  assert.match(styles, /\.loadingFlipLowerFlap\s*{[\s\S]*background: var\(--schedule-time-cell-surface\)/);
  assert.match(styles, /\.frontdeskM2A \.loadingBoard\s*{[^}]*opacity: 1;/);
  assert.doesNotMatch(styles, /schedule-loading-flip-(?:upper|lower) 3500ms/);
  assert.doesNotMatch(styles, /schedule-loading-flip-(?:upper|lower)[^;]*infinite/);
  assert.doesNotMatch(styles, /\.loadingTimeFace\[data-loading-page-face=/);
  assert.match(styles, /\.loadingTimeFace\s*{[\s\S]*color: rgba\(230, 207, 156, 0\.78\)/);
  assert.match(upperFlip, /transform: rotateX\(-92deg\)/);
  assert.match(lowerFlip, /transform: rotateX\(90deg\)/);
  assert.match(upperFlip, /58%/);
  assert.match(lowerFlip, /52%/);
  assert.match(lowerFlip, /92%/);
  assert.doesNotMatch(upperFlip, /filter:|opacity:/);
  assert.doesNotMatch(lowerFlip, /filter:|opacity:/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.loadingFlipUpperFlap,[\s\S]*\.loadingFlipLowerFlap[\s\S]*animation: none[\s\S]*\.loadingFlipUpperFlap\s*{[\s\S]*rotateX\(-92deg\)[\s\S]*\.loadingFlipLowerFlap\s*{[\s\S]*rotateX\(0deg\)/,
  );
});

test("daily schedule overlaps independent reads and exposes server timing without changing prefetch", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(
    route,
    /async function attachScheduleMemberRelationships[\s\S]*Promise\.all\(\[[\s\S]*attachLegacyNumbers[\s\S]*attachSharedContracts/,
  );
  assert.match(
    route,
    /expiringContractsPromise[\s\S]*legacyPurchaseDateRemindersPromise[\s\S]*expiringContractsPromise,[\s\S]*legacyPurchaseDateRemindersPromise/,
  );
  assert.match(
    route,
    /const \[scheduleMembersResult, trialBookingsResult\] = await Promise\.all/,
  );
  assert.match(route, /response\.headers\.set\([\s\S]*"Server-Timing"/);
  assert.match(route, /\[bige-fitness\] daily board timing/);
  assert.doesNotMatch(route, /let expiringContracts: any\[\] = \[\]/);
});

test("daily course dialogs expose manager-controlled specialty session quotas", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260817133052_bige_contract_course_allocation_configuration.sql",
    "utf8",
  );

  assert.match(component, /總堂數 \{scheduleCourseSessionSummary\.usedSessions\}/);
  assert.match(component, /專項堂數尚未設定/);
  assert.match(component, /scheduleCourseSessionSummary\.allocatedCourseTypes\.map/);
  assert.match(
    component,
    /function configuredCourseUsed[\s\S]*if \(!contract\?\.course_allocations_configured_at\) return 0/,
  );
  assert.match(component, /設定專項堂數[\s\S]*調整專項堂數/);
  assert.match(component, /修改分配不會重置各專項已使用堂數/);
  assert.match(route, /canManageBigeCourseAllocations\(operationContext\)/);
  assert.match(route, /rpc\([\s\S]*bige_configure_contract_course_allocations/);
  assert.match(migration, /course_allocation_legacy_snapshot = coalesce/);
  assert.match(migration, /course_used = '\{\}'::jsonb/);
  assert.match(migration, /first_configuration := contract_row\.course_allocations_configured_at is null/);
  assert.match(migration, /allocation_total <> contract_row\.total_sessions/);
  assert.match(migration, /allocation_value < used_value/);
  assert.match(migration, /when course_allocations_configured then jsonb_set/);
  assert.match(migration, /contract_row\.course_allocations_configured_at is null/);
  assert.match(migration, /member_plan_contracts_course_allocation_guard/);
  assert.match(migration, /member_plan_contracts_course_allocation_insert_guard/);
});

test("specialty allocation genie dismissal reveals its parent dialog from the first frame", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const dialogComponent = component.slice(
    component.indexOf("function Dialog("),
    component.indexOf("function SignaturePad("),
  );
  const allocationDialog = component.slice(
    component.indexOf('{dialog === "course-allocations"'),
    component.indexOf('{dialog === "monthly-schedule"'),
  );

  assert.match(dialogComponent, /onCloseStart\?: \(\) => void/);
  assert.match(dialogComponent, /revealBackgroundOnClose\?: boolean/);
  assert.match(dialogComponent, /onCloseStartRef\.current\?\.\(\)/);
  assert.match(dialogComponent, /styles\.overlayRevealBehind/);
  assert.match(dialogComponent, /styles\.overlayBackground/);
  assert.match(component, /const \[courseAllocationReturnVisible, setCourseAllocationReturnVisible\]/);
  assert.match(component, /setCourseAllocationReturnVisible\(true\)/);
  assert.match(component, /showCourseAllocationBookingBehind/);
  assert.match(component, /showCourseAllocationScheduleBehind/);
  assert.match(allocationDialog, /onCloseStart=\{\(\) => setCourseAllocationReturnVisible\(true\)\}/);
  assert.match(allocationDialog, /revealBackgroundOnClose/);
  assert.match(styles, /\.overlayBackground \{[\s\S]*z-index: 99;[\s\S]*pointer-events: none/);
  assert.match(
    styles,
    /\.overlayRevealBehind \{[\s\S]*background: transparent !important;[\s\S]*backdrop-filter: none !important/,
  );
});

test("generated assistant TO markers warn without blocking real schedule mutations", () => {
  const migration = readFileSync(
    "supabase/migrations/20260815211445_allow_generated_to_conflict_warning_only.sql",
    "utf8",
  );

  assert.match(
    migration,
    /delete from public\.bige_schedule_notes note[\s\S]*note\.system_kind = 'fa_assistant_to'[\s\S]*tstzrange\(new\.starts_at, new\.ends_at, '\[\)'\)/,
  );
  assert.match(
    migration,
    /coalesce\(note\.system_kind, ''\) <> 'fa_assistant_to'/,
  );
  assert.match(
    migration,
    /if old\.operation_kind = 'trial'[\s\S]*bige_sync_fa_assistant_to_slot[\s\S]*bige_resync_fa_assistant_to_day/,
  );
  assert.match(
    migration,
    /if new\.operation_kind = 'trial'[\s\S]*bige_sync_fa_assistant_to_slot[\s\S]*bige_resync_fa_assistant_to_day/,
  );
  assert.doesNotMatch(
    migration,
    /upper\(trim\(note\.content\)\)\s*<>?\s*'TO'/,
  );
});

test("schedule swaps can roundtrip without stale occupancy or duplicate error dialogs", () => {
  const migration = readFileSync(
    "supabase/migrations/20260815212928_fix_schedule_drag_roundtrip_occupancy.sql",
    "utf8",
  );
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(migration, /status, is_bige_schedule[\s\S]*set_booking_schedule_fields/);
  assert.match(migration, /where is_bige_schedule = true[\s\S]*occupied_starts_at is not null/);
  assert.match(migration, /deferrable initially immediate/);
  assert.equal(
    (migration.match(/set constraints bookings_coach_occupancy_excl deferred/g) || []).length,
    4,
  );
  assert.match(
    component,
    /action: "move_schedule_booking"[\s\S]*\{ errorPresentation: "inline" \}/,
  );
  assert.match(
    route,
    /key\.includes\("bookings_coach_occupancy_excl"\)[\s\S]*教練在這個時段已有其他預約/,
  );
});

test("schedule drag ignores a booking hidden by the schedule trash action", () => {
  const migration = readFileSync(
    "supabase/migrations/20260819140550_fix_schedule_drag_deleted_slot.sql",
    "utf8",
  );
  const regression = readFileSync("tests/bige_schedule_drag_roundtrip.sql", "utf8");

  assert.match(
    migration,
    /replace\([\s\S]*booking\.is_bige_schedule = true[\s\S]*booking\.status <> 'cancelled'[\s\S]*booking\.status_reason is distinct from 'schedule_trash_deleted'/,
  );
  assert.match(
    migration,
    /replace\([\s\S]*existing\.is_bige_schedule = true[\s\S]*existing\.status <> 'cancelled'[\s\S]*existing\.status_reason is distinct from 'schedule_trash_deleted'/,
  );
  assert.match(
    regression,
    /status_reason = 'schedule_trash_deleted'[\s\S]*bige_drag_schedule_booking\([\s\S]*'move'[\s\S]*booking did not move into the trash-deleted slot/,
  );
  assert.match(
    regression,
    /bige_restore_cancelled_schedule_booking\(booking_b_id\)[\s\S]*restoring into the newly occupied slot should remain blocked/,
  );
});

test("schedule drag ignores all cancelled history while preserving other locked statuses", () => {
  const migration = readFileSync(
    "supabase/migrations/20260830222019_allow_schedule_drag_past_cancelled_bookings.sql",
    "utf8",
  );
  const dragLogic = readFileSync("lib/bige-schedule-drag.ts", "utf8");
  const regression = readFileSync("tests/bige_schedule_drag_roundtrip.sql", "utf8");

  assert.match(
    migration,
    /regexp_replace\([\s\S]*booking\\\.status <> 'cancelled'[\s\S]*and booking\.status <> 'cancelled'/,
  );
  assert.match(
    migration,
    /regexp_replace\([\s\S]*existing\\\.status <> 'cancelled'[\s\S]*and existing\.status <> 'cancelled'/,
  );
  assert.match(
    dragLogic,
    /targetPrimary[\s\S]*booking\.status !== "cancelled"[\s\S]*sourceItems[\s\S]*booking\.status !== "cancelled"[\s\S]*targetItems[\s\S]*booking\.status !== "cancelled"/,
  );
  assert.match(
    regression,
    /cancelled_source_fa_id[\s\S]*cancelled_target_a_id[\s\S]*cancelled_target_b_id[\s\S]*cancelled_history_swap[\s\S]*cancelled history prevented the active FA\/PT swap/,
  );
});

test("FA ECPay conversion and restore remove only conversion-created formal identity", () => {
  const migration = readFileSync(
    "supabase/migrations/20260815221634_fix_fa_payment_and_restore_member.sql",
    "utf8",
  );
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(
    migration,
    /p_payment_method not in \(''cash'', ''bank_transfer'', ''card_terminal'', ''ecpay'', ''ecpay_installment'', ''acpay'', ''other''\)/,
  );
  assert.match(migration, /memberWasProspectBeforeConversion/);
  assert.match(migration, /memberCodeBeforeConversion/);
  assert.match(migration, /member_reverted_to_prospect boolean := false/);
  assert.match(
    migration,
    /set member_code = null,[\s\S]*is_prospect = true,[\s\S]*attendance_pin_hash = null/,
  );
  assert.match(migration, /other_contract\.status <> ''canceled''/);
  assert.match(migration, /other_booking\.operation_kind = ''pt''/);
  assert.match(route, /invalid_payment_method: "付款方式無效，請重新選擇後再試一次"/);
  assert.match(route, /formalMembersOnly[\s\S]*membersQuery\.eq\("is_prospect", false\)/);
  assert.match(component, /memberScope=formal/);
  assert.match(component, /正式會員資料已移除/);
  assert.doesNotMatch(component, /正式會員基本資料會保留/);
});

test("schedule-origin contracts use the source business date and ECPay installments keep their count", () => {
  const installmentMigration = readFileSync(
    "supabase/migrations/20260815225909_lock_fa_signed_date_and_record_ecpay_installments.sql",
    "utf8",
  );
  const sourceDateMigration = readFileSync(
    "supabase/migrations/20260823201753_align_contract_names_and_source_dates.sql",
    "utf8",
  );
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(
    sourceDateMigration,
    /booking\.starts_at at time zone 'Asia\/Taipei'[\s\S]*resolved_signed_on/,
  );
  assert.match(sourceDateMigration, /bige_align_contract_dates_to_source_booking/);
  assert.match(installmentMigration, /add column if not exists installment_count integer/);
  assert.match(sourceDateMigration, /p_installment_count not between 2 and 60/);
  assert.match(component, /請輸入綠界分期期數（2 至 60 期）/);
  assert.match(
    component,
    /selectedConversionBooking \|\| studentPaymentContext\?\.paymentType === "renewal"/,
  );
  assert.match(
    component,
    /toTaipeiDateString\(new Date\(selectedBooking\.starts_at\)\)/,
  );
  assert.match(route, /bige_create_member_contract_v8/);
  assert.match(route, /const trustedSignedOn = trustedSourceBusinessDate \|\| input\.signedOn/);
  assert.match(route, /rpc\("bige_record_contract_payment_v3"/);
  assert.match(route, /p_source_booking_id: input\.sourceBookingId \|\| null/);
  assert.match(route, /p_installment_count: input\.installmentCount \|\| null/);
});

test("BB is bound to a completed non-converted FA and never becomes a lesson, FA, or EPO", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260820212138_add_bb_followup_and_reporting.sql",
    "utf8",
  );
  const settlement = readFileSync("lib/staff-performance-settlement.ts", "utf8");
  const sync = readFileSync("lib/staff-performance-sync.ts", "utf8");

  assert.match(component, /<option value="bb">BB 回訪<\/option>/);
  assert.match(component, /trialScope=bb/);
  assert.match(component, /disabled=\{scheduleDraft\.operationKind === "bb"\}/);
  assert.match(component, /不適用（不計課堂）/);
  assert.match(component, /action: "complete_bb_outcome"/);
  assert.match(component, /BB 成交已完成[\s\S]*本筆不產生 EPO/);
  assert.match(route, /url\.searchParams\.get\("trialScope"\) === "bb"/);
  assert.match(route, /bige_create_bb_member_contract_v3/);
  assert.match(route, /bige_complete_bb_outcome_v1/);
  assert.match(migration, /operation_kind = 'bb'/);
  assert.match(migration, /trial_conversion_outcome = 'not_converted'/);
  assert.match(migration, /course_type[\s\S]*null/);
  assert.match(migration, /extract\(epoch from \(ends_at - starts_at\)\) \/ 60 in \(30, 60, 90, 120\)/);
  assert.match(migration, /source_booking\.coach_id, 'bb', source_booking\.id/);
  assert.match(migration, /'epoEligible', false/);
  assert.match(settlement, /\["fa", "bb", "renewal", "final_payment"\]\.includes/);
  assert.match(sync, /if \(params\.originKind === "bb"\) return "bb"/);
  assert.match(route, /booking\.operation_kind === "bb" && input\.result === "completed"/);
});

test("FA and BB customer search reads tenant-scoped trial bookings on the server under RLS", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const searchStart = route.indexOf('const search = (url.searchParams.get("search")');
  const searchEnd = route.indexOf("const memberScheduleMemberId", searchStart);
  const searchSection = route.slice(searchStart, searchEnd);

  assert.ok(searchStart >= 0 && searchEnd > searchStart);
  assert.match(
    searchSection,
    /const trialSearchClient = createSupabaseAdminClient\(\);[\s\S]*let trialQuery = trialSearchClient[\s\S]*\.from\("trial_bookings"\)[\s\S]*\.eq\("tenant_id", tenantId\)/,
  );
  assert.doesNotMatch(searchSection, /let trialQuery = auth\.supabase/);
});

test("BB lifecycle prevents duplicate followups and supports audited corrections", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const schema = readFileSync("lib/bige-fitness.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260821102855_harden_bb_followup_lifecycle.sql",
    "utf8",
  );
  const regression = readFileSync("tests/bige_bb_followup.sql", "utf8");

  assert.match(migration, /bookings_bb_one_active_per_fa_idx/);
  assert.match(migration, /bookings_bb_one_conversion_per_fa_idx/);
  assert.match(migration, /bb_active_followup_exists/);
  assert.match(migration, /bb_source_already_converted/);
  assert.match(migration, /bige_profile_can_manage_schedule\(actor\)/);
  assert.match(migration, /bige_enforce_bb_completion_window/);
  assert.match(migration, /bige_restore_bb_no_sale_v1/);
  assert.match(migration, /bige_restore_bb_conversion_v1/);
  assert.match(schema, /action: z\.literal\("restore_bb_no_sale"\)/);
  assert.match(schema, /action: z\.literal\("restore_bb_conversion"\)/);
  assert.match(route, /rpc\("bige_restore_bb_no_sale_v1"/);
  assert.match(route, /rpc\("bige_restore_bb_conversion_v1"/);
  assert.match(route, /\.eq\("tenant_id", tenantId\)[\s\S]*\.limit\(bbTrialOnly \? 100 : 20\)/);
  assert.match(component, /const controller = new AbortController\(\)/);
  assert.match(component, /已綁定：\{selectedScheduleTrialResult\.name\}/);
  assert.match(component, /更正為尚未處理/);
  assert.match(component, /復原 BB 成交/);
  assert.match(regression, /a second active BB for the same FA unexpectedly succeeded/);
  assert.match(regression, /BB source did not reopen after an audited conversion correction/);
});

test("FA conversion preserves an imported shared contact without weakening direct member phone uniqueness", () => {
  const migration = readFileSync(
    "supabase/migrations/20260819151501_preserve_shared_fa_contact_on_conversion.sql",
    "utf8",
  );
  const regression = readFileSync("tests/bige_fa_shared_contact_payment.sql", "utf8");

  assert.match(migration, /p_source_booking_id is not null[\s\S]*other_member\.phone_normalized = normalized_phone/);
  assert.match(migration, /then member_row\.phone[\s\S]*then member_row\.phone_normalized/);
  assert.match(regression, /bige_create_member_contract_v5/);
  assert.match(regression, /phone is null[\s\S]*phone_normalized is null/);
  assert.match(regression, /when unique_violation then[\s\S]*unique_phone_blocked := true/);
});

test("authorized schedule users see the daily settlement link immediately after refresh", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");
  const toolbarStart = component.indexOf('title="重新整理"');
  const toolbarEnd = component.indexOf("</div>", toolbarStart);
  const refreshAndSettlement = component.slice(toolbarStart, toolbarEnd);

  assert.ok(toolbarStart >= 0);
  assert.match(
    refreshAndSettlement,
    /重新整理[\s\S]*RefreshCw[\s\S]*tab === "schedule" && data\?\.canManageDailyReports/,
  );
  assert.match(
    refreshAndSettlement,
    /href=\{`\/manager\/staff-performance\?month=\$\{date\.slice\(0, 7\)\}&date=\$\{date\}`\}/,
  );
  assert.match(refreshAndSettlement, /ClipboardCheck[\s\S]*日結/);
  assert.match(
    styles,
    /\.settlementButton \{[\s\S]*display: inline-flex;[\s\S]*white-space: nowrap;/,
  );
  assert.match(
    styles,
    /\.dateToolbar \.settlementButton \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*width: 100%;/,
  );
});

test("manual daily schedule refresh shows a scoped noir-gold clock for at least one second", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.match(component, /const DAILY_SCHEDULE_MANUAL_REFRESH_MINIMUM_MS = 1000;/);
  assert.match(
    component,
    /Promise\.allSettled\(\[[\s\S]*loadBoard\(\{ silent: true, targetDate \}\)[\s\S]*loadOperationsDashboard\(targetDate\)[\s\S]*DAILY_SCHEDULE_MANUAL_REFRESH_MINIMUM_MS/,
  );
  assert.match(component, /data-refreshing=\{manualRefreshing \? "true" : undefined\}/);
  assert.match(component, /aria-busy=\{manualRefreshing\}/);
  assert.match(component, /disabled=\{manualRefreshing\}/);
  assert.match(component, /refreshClockRingOuter[\s\S]*refreshClockRingMiddle[\s\S]*refreshClockRingInner/);
  assert.match(styles, /\.refreshButton \{[\s\S]*--refresh-clock-bright: var\(--schedule-gold-bright, #e4c77a\)/);
  assert.match(styles, /\.refreshClockEffect \{[\s\S]*width: 70px;[\s\S]*height: 70px;/);
  assert.match(styles, /\.refreshButton\[data-refreshing="true"\] \.refreshClockRingOuter \{[\s\S]*refresh-clock-spin/);
  assert.match(styles, /\.refreshButton\[data-refreshing="true"\] \.refreshClockRingMiddle \{[\s\S]*refresh-clock-spin-reverse/);
  assert.match(
    styles,
    /\.frontdeskM2A\[data-daily-schedule-active="true"\] \.navigationRow \.dateToolbar \.refreshButton:disabled \{[\s\S]*opacity: 1;[\s\S]*var\(--schedule-gold-bright\)/,
  );
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.refreshButton\[data-refreshing="true"\]/);
});

test("completed PT mutations reject stale board responses without shrinking the warm cache", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.match(
    component,
    /const requestedRevision = readBigeBoardRevision\(boardRevisionRef\.current, targetDate\)/,
  );
  assert.match(
    component,
    /isBigeBoardRevisionCurrent\(boardRevisionRef\.current, targetDate, requestedRevision\)[\s\S]*storeBoardCache/,
  );
  assert.match(
    component,
    /boardRequestsRef\.current\.get\(targetDate\) === request[\s\S]*boardRequestsRef\.current\.delete\(targetDate\)/,
  );
  assert.match(
    component,
    /const completePt = async[\s\S]*bumpBigeBoardRevision\(boardRevisionRef\.current, operationDate\)[\s\S]*boardRequestsRef\.current\.delete\(operationDate\)/,
  );
  assert.match(component, /const BOARD_CACHE_LIMIT = BIGE_BOARD_PREFETCH_RADIUS \* 6 \+ 1;/);
  assert.equal(BIGE_BOARD_PREFETCH_RADIUS, 10);
});

test("payment edit schema requires a reason and valid ECPay installments", () => {
  const valid = updatePaymentSchema.safeParse({
    action: "update_payment",
    paymentId: "00000000-0000-4000-8000-000000000001",
    paymentKind: "deposit",
    amount: 20000,
    method: "bank_transfer",
    installmentCount: null,
    status: "recorded",
    note: "corrected import",
    reason: "correct legacy amount",
  });
  const invalid = updatePaymentSchema.safeParse({
    action: "update_payment",
    paymentId: "00000000-0000-4000-8000-000000000001",
    paymentKind: "installment",
    amount: 20000,
    method: "ecpay_installment",
    installmentCount: null,
    status: "recorded",
    reason: "ok",
  });

  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});

test("manager and assistant manager payment edits recalculate money and session state", () => {
  const migration = readFileSync(
    "supabase/migrations/20260819153837_add_contract_payment_editing.sql",
    "utf8",
  );
  const regression = readFileSync("tests/bige_contract_payment_edit.sql", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.match(migration, /actor\.position in \([\s\S]*'coach_assistant_manager'[\s\S]*'coach_manager'/);
  assert.match(migration, /total_paid > contract_row\.total_amount[\s\S]*payment_total_exceeds_contract_amount/);
  assert.match(migration, /unlocked_sessions = next_unlocked[\s\S]*remaining_sessions = greatest/);
  assert.match(migration, /fitness_contract_payment_updated/);
  assert.match(regression, /outstandingBalance'\)::bigint <> 46624/);
  assert.match(regression, /frontdesk unexpectedly edited an existing payment/);
  assert.match(
    route,
    /input\.action === "update_payment"[\s\S]*canManageBigePaidScheduleCells\(operationContext\)[\s\S]*rpc\("bige_update_contract_payment"/,
  );
  assert.match(component, /memberDetail\.canEditContractPayment[\s\S]*openPaymentEditor\(payment, contract\)/);
  assert.match(component, /title="修改付款資料"[\s\S]*付款狀態[\s\S]*付款方式[\s\S]*修改原因/);
});

test("source-linked FA, BB, renewal, and final payments use the schedule business date", () => {
  const migration = readFileSync(
    "supabase/migrations/20260823210203_align_contract_payment_source_dates.sql",
    "utf8",
  );
  const splitRegression = readFileSync(
    "tests/bige_split_contract_payments.sql",
    "utf8",
  );
  const bbRegression = readFileSync("tests/bige_bb_followup.sql", "utf8");
  const faRegression = readFileSync(
    "tests/bige_fa_signing_installments.sql",
    "utf8",
  );

  assert.match(
    migration,
    /before insert or update of source_booking_id, paid_at[\s\S]*on public\.bige_contract_payments/,
  );
  assert.match(
    migration,
    /bige_record_contract_payment_v3[\s\S]*payment_source_booking_invalid[\s\S]*source_booking_id = p_source_booking_id/,
  );
  assert.match(
    migration,
    /source_business_date[\s\S]*coalesce\(new\.paid_at, now\(\)\)[\s\S]*at time zone 'Asia\/Taipei'/,
  );
  assert.match(
    migration,
    /new\.idempotency_key like[\s\S]*contract\.converted_from_booking_id[\s\S]*new\.source_booking_id := resolved_source_booking_id/,
  );
  assert.match(
    migration,
    /payment\.source_booking_id[\s\S]*contract\.converted_from_booking_id[\s\S]*'contract-create:' \|\| contract\.id::text/,
  );
  assert.match(
    migration,
    /payment_source_booking[\s\S]*event\.status <> 'daily_confirmed'/,
  );
  assert.match(
    splitRegression,
    /payment\.paid_at at time zone 'Asia\/Taipei'[\s\S]*booking\.starts_at at time zone 'Asia\/Taipei'/,
  );
  assert.match(
    bbRegression,
    /payment\.paid_at at time zone 'Asia\/Taipei'[\s\S]*booking\.starts_at at time zone 'Asia\/Taipei'/,
  );
  assert.match(
    faRegression,
    /payment\.source_booking_id = fa_booking_id[\s\S]*payment\.paid_at at time zone 'Asia\/Taipei'/,
  );
});

test("paid schedule cells require coaching management and keep platform admins unrestricted", () => {
  const migration = readFileSync(
    "supabase/migrations/20260823173204_protect_paid_schedule_cells.sql",
    "utf8",
  );
  const regression = readFileSync("tests/bige_paid_schedule_access.sql", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");

  assert.match(
    migration,
    /bige_profile_can_manage_paid_schedule_cells[\s\S]*p_actor\.role = 'platform_admin'[\s\S]*'coach_assistant_manager'[\s\S]*'coach_manager'/,
  );
  assert.match(migration, /before insert[\s\S]*on public\.bige_contract_payments/);
  assert.match(
    migration,
    /before update of amount, status, source_booking_id[\s\S]*on public\.bige_contract_payments/,
  );
  assert.match(migration, /before delete[\s\S]*on public\.bige_contract_payments/);
  assert.match(
    migration,
    /schedule_trash_deleted'[\s\S]*'schedule_drag_overwrite'[\s\S]*paid_schedule_booking_manager_required/,
  );
  assert.match(regression, /frontdesk unexpectedly deleted a paid schedule cell/);
  assert.match(regression, /frontdesk could not delete an unpaid schedule cell/);
  assert.match(regression, /frontdesk initial split payment was unexpectedly blocked/);
  assert.match(regression, /platform admin paid-cell access failed/);
  assert.match(
    route,
    /input\.action === "delete_schedule_booking"[\s\S]*readPaidScheduleBookingState[\s\S]*只有教練經理、副理或平台管理員能刪除/,
  );
  assert.match(
    route,
    /input\.action === "change_trial_conversion_payment"[\s\S]*canManageBigePaidScheduleCells\(operationContext\)/,
  );
  assert.match(route, /return canManageBigePaidScheduleCells\(context\)/);
  assert.match(component, /canManagePaidScheduleCells[\s\S]*付款紀錄也會保留/);
});

test("voided member contracts render with a strike line and red voided stamp", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.equal(
    isBigeContractVoidedForDisplay({ contractStatus: "canceled", payments: [] }),
    true,
  );
  assert.equal(
    isBigeContractVoidedForDisplay({
      contractStatus: "pending",
      payments: [{ status: "voided" }],
    }),
    true,
  );
  assert.equal(
    isBigeContractVoidedForDisplay({
      contractStatus: "frozen",
      payments: [{ status: "voided" }, { status: "voided" }],
    }),
    true,
  );
  assert.equal(
    isBigeContractVoidedForDisplay({
      contractStatus: "active",
      payments: [{ status: "recorded" }],
    }),
    false,
  );
  assert.equal(
    isBigeContractVoidedForDisplay({
      contractStatus: "active",
      payments: [{ status: "voided" }, { status: "recorded" }],
    }),
    false,
  );

  assert.match(
    component,
    /isBigeContractVoidedForDisplay\(\{[\s\S]*contractStatus: contract\.status,[\s\S]*payments: contractPayments/,
  );
  assert.match(component, /isVoidedContract \? styles\.contractVoided : ""/);
  assert.match(component, /className=\{styles\.contractVoidedStamp\}[\s\S]*已作廢/);
  assert.match(styles, /\.contractVoided > \.contractSummary::after[\s\S]*background: rgba\(196, 39, 39/);
  assert.match(styles, /\.contractVoidedStamp[\s\S]*border: 3px double #d03838/);
});

test("voided contracts are excluded from balance payment and rejected by the payment RPC", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260823170811_prevent_voided_contract_payments.sql",
    "utf8",
  );

  assert.equal(
    isBigeContractEligibleForPayment({ contractStatus: "canceled", payments: [] }),
    false,
  );
  assert.equal(
    isBigeContractEligibleForPayment({
      contractStatus: "pending",
      payments: [{ status: "voided" }],
    }),
    false,
  );
  assert.equal(
    isBigeContractEligibleForPayment({
      contractStatus: "frozen",
      payments: [{ status: "voided" }, { status: "voided" }],
    }),
    false,
  );
  assert.equal(
    isBigeContractEligibleForPayment({
      contractStatus: "active",
      payments: [{ status: "recorded" }],
    }),
    true,
  );
  assert.equal(
    isBigeContractEligibleForPayment({
      contractStatus: "active",
      payments: [{ status: "voided" }, { status: "recorded" }],
    }),
    true,
  );

  assert.equal(
    (component.match(/eligibleForPayment: isBigeContractEligibleForPayment/g) || []).length,
    2,
  );
  assert.equal(
    (component.match(/item\.outstanding > 0 && item\.eligibleForPayment/g) || []).length,
    2,
  );
  assert.match(migration, /contract_row\.status = 'canceled'/);
  assert.match(migration, /payment\.status <> 'voided'/);
  assert.match(migration, /raise exception 'voided_contract_payment_not_allowed'/);
  assert.match(route, /voided_contract_payment_not_allowed: "此合約已作廢，不能再登記付款"/);
});

test("coach mobile header stays compact and employee 06 can see the daily frontdesk status", () => {
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.doesNotMatch(component, /查看課表、確認到店結果與學員密碼扣堂/);
  assert.match(
    component,
    /const canUseScheduleOverviewControls =\s*managerView \|\| data\?\.coachScheduleScope === "all";/,
  );
  assert.match(
    component,
    /const canSeeDailyFrontdesk =\s*canUseScheduleOverviewControls \|\|\s*Boolean\(data\?\.canManageFrontdesk && data\.canManageSchedule\);/,
  );
  assert.match(
    component,
    /canSeeDailyFrontdesk \? \([\s\S]*className=\{styles\.frontdeskStatus\}/,
  );
  assert.match(
    component,
    /tab === "schedule" && canUseScheduleOverviewControls \? \([\s\S]*setHideOffCoaches/,
  );
  assert.match(
    component,
    /canUseScheduleOverviewControls \? \([\s\S]*className=\{styles\.mobileCoach\}/,
  );
  assert.match(styles, /\.businessDayControls:empty \{[\s\S]*display: none;/);
  assert.match(
    styles,
    /\.frontdeskM2A \.dateToolbar \{[\s\S]*grid-template-columns: 40px minmax\(138px, 1fr\) auto 40px 40px;[\s\S]*column-gap: 7px;/,
  );
  assert.match(
    styles,
    /\.frontdeskM2A \.dateToolbar \.input \{[\s\S]*width: calc\(100% - 10px\);[\s\S]*max-width: calc\(100% - 10px\);[\s\S]*justify-self: start;/,
  );
  assert.match(
    styles,
    /data-role-view="coach"\] \.sessionActions \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    styles,
    /data-role-view="coach"\] \.sessionIdentity \{[\s\S]*flex-direction: row;/,
  );
});

test("frontdesk daily schedules expose the all-coach scope instead of defaulting to Becky", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(
    route,
    /const coachScheduleScope = coachScheduleScopeForActor\(scheduleActor\);/,
  );
  assert.equal(
    (route.match(/if \(coachScheduleScope === "assigned"\)/g) || []).length,
    4,
  );
  assert.match(route, /coachScheduleScope,\s*tenantId,/);
  assert.doesNotMatch(
    route,
    /coachScheduleScope: hasAllCoachScheduleAccess \? "all" : "assigned"/,
  );
});

test("fascia plans cover every fixed session tier with matching prices and allocations", () => {
  const migration = readFileSync(
    "supabase/migrations/20260903155325_add_fascia_relaxation_and_knife_plans.sql",
    "utf8",
  );

  const expectedTiers = [
    [12, 21456, 72, 42, 21],
    [24, 38112, 114, 84, 42],
    [30, 44640, 135, 105, 53],
    [36, 53568, 156, 126, 63],
    [48, 66624, 198, 168, 84],
    [72, 92736, 282, 252, 126],
    [100, 118800, 380, 350, 175],
  ];

  for (const tier of expectedTiers) {
    assert.match(
      migration,
      new RegExp(`\\(${tier[0]},\\s+${tier[1]}::numeric,\\s+${tier[2]},\\s+${tier[3]},\\s+${tier[4]}\\)`),
    );
  }

  assert.match(migration, /\('relaxation', 'fascia_relaxation', '筋膜放鬆'\)/);
  assert.match(migration, /\('fascia_knife', 'fascia_knife', '筋膜刀'\)/);
  assert.match(migration, /jsonb_build_array\(plan_courses\.course_key\)/);
  assert.match(
    migration,
    /'relaxation', case when plan_courses\.course_key = 'relaxation' then plan_tiers\.total_sessions else 0 end/,
  );
  assert.match(
    migration,
    /'fascia_knife', case when plan_courses\.course_key = 'fascia_knife' then plan_tiers\.total_sessions else 0 end/,
  );
  assert.match(migration, /on conflict \(tenant_id, code\) do update/);
});

test("built-in payment plans are grouped by specialty before showing their dropdown", () => {
  const plans = [
    { course_allocations: { weight_training: 12 } },
    { course_allocations: { reformer_pilates: 24 } },
    { course_allocations: { relaxation: 12 } },
    { course_allocations: { fascia_knife: 36 } },
    { course_allocations: { boxing: 0 } },
  ];

  assert.deepEqual(listBigeFitnessPlanSpecialties(plans), [
    "weight_training",
    "relaxation",
    "reformer_pilates",
    "fascia_knife",
  ]);
  assert.equal(isBigeFitnessPlanForSpecialty(plans[1], "reformer_pilates"), true);
  assert.equal(isBigeFitnessPlanForSpecialty(plans[1], "weight_training"), false);

  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  assert.match(component, /setContractPlanSpecialty\(""\)/);
  assert.match(component, /planId: ""/);
  assert.match(
    component,
    /contractPlanSpecialties\.map\(\(specialty\) =>[\s\S]*aria-label="內建方案專項"|aria-label="內建方案專項"[\s\S]*contractPlanSpecialties\.map/,
  );
  assert.match(
    component,
    /contractPlanSpecialty \? \([\s\S]*specialtyContractPlans\.map\(\(plan\) =>/,
  );
  assert.match(component, /if \(!contractPlanSpecialty\) \{[\s\S]*請先選擇專項/);
  assert.match(component, /const openStudentPayment =[\s\S]*openContract\(booking, member\)/);
  assert.match(component, /const openWalkInMemberPayment =[\s\S]*openContract\(undefined, member\)/);
});
