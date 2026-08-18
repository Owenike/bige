import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BIGE_FA_DURATION_MINUTES,
  BIGE_SCHEDULE_MOVE_UNDO_WINDOW_MS,
  BIGE_SCHEDULE_NOTE_UNDO_WINDOW_MS,
  BIGE_TRIAL_REMINDER_CONFIRMED_STATUS,
  BIGE_TRIAL_REMINDER_PENDING_STATUS,
  buildBigeMemberPaymentDetailMap,
  canReviseBigeTrialOutcome,
  canEditBigeScheduleBooking,
  calculateBigeContractOutstandingBalance,
  calculateLegacyContractExpiryDate,
  flattenBigeMemberPaymentRelations,
  getBigeStudentPaymentBalanceState,
  getBigeFaFeeAmount,
  isBigeAssistantToContent,
  isBigeContractPaymentAmountAllowed,
  isBigeScheduleNoteUndoAvailable,
  isBigeTrialReminderConfirmed,
  getBigeTrialOutcomeVisualState,
  getBigeTrialBookingActionVisibility,
  getBigeTrialContractMissingProfileFields,
  nextBigeTrialReminderStatus,
  normalizeBigeScheduleEndAt,
  resolveBigeTrialContractIdentity,
  summarizeBigeMemberCourseSessions,
  deleteScheduleNoteSchema,
  deleteScheduleBookingSchema,
  restoreScheduleNoteSchema,
  undoScheduleBookingMoveSchema,
  restoreCancelledBookingSchema,
  restoreNoShowBookingSchema,
  createContractSchema,
  completeTrialOutcomeSchema,
  changeTrialConversionPaymentSchema,
  changeTrialConversionOutcomeSchema,
  restoreTrialConversionSchema,
  recordPaymentSchema,
  updateLegacyContractPurchaseDateSchema,
  updateCourseAllocationsSchema,
  validateCourseAllocationTotal,
} from "../lib/bige-fitness";
import { canCreateBigeContract } from "../lib/staff-credentials";
import { findBigeScheduleBatchConflict } from "../lib/bige-schedule-batch";
import {
  BIGE_BOARD_PREFETCH_CONCURRENCY,
  BIGE_BOARD_PREFETCH_RADIUS,
  BigeBoardPrefetchQueue,
  buildBigeBoardPrefetchDates,
} from "../lib/bige-board-prefetch";

const batchCoachId = "00000000-0000-4000-8000-000000000011";
const batchMemberId = "00000000-0000-4000-8000-000000000012";

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

test("all valid employee accounts except 06 may create a BIG E contract", () => {
  assert.equal(canCreateBigeContract("01"), true);
  assert.equal(canCreateBigeContract("02"), true);
  assert.equal(canCreateBigeContract("E000006"), false);
  assert.equal(canCreateBigeContract("06"), false);
  assert.equal(canCreateBigeContract("member"), false);
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

test("FA contract creation requires a recipient while ordinary contracts reject one", () => {
  const baseInput = {
    action: "create_contract" as const,
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
    false,
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

test("specialty allocation updates require all five non-negative integer counters", () => {
  const valid = {
    action: "update_course_allocations",
    contractId: "00000000-0000-4000-8000-000000000001",
    allocations: {
      weight_training: 20,
      relaxation: 4,
      reformer_pilates: 24,
      sports_cupping: 0,
      fascia_knife: 0,
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
    weight_training: 4,
    relaxation: 2,
    reformer_pilates: 2,
    sports_cupping: 1,
    fascia_knife: 1,
  };
  assert.equal(validateCourseAllocationTotal(allocations, 10), true);
  assert.equal(
    createContractSchema.safeParse({
      action: "create_contract",
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

test("FA schedule payments are fixed to New while member payments keep renewal and balance", () => {
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
    /sourceBookingId: selectedBooking\?\.operation_kind === "trial" \? selectedBooking\.id : null/,
  );
  assert.match(
    submitContract,
    /sourceMemberBookingId:[\s\S]*studentPaymentContext\?\.paymentType === "renewal"[\s\S]*\? studentPaymentContext\.bookingId[\s\S]*: null/,
  );
  assert.match(route, /select\("id, member_id, operation_kind"\)/);
  assert.match(
    route,
    /sourceBookingResult\.data\.operation_kind === "trial"[\s\S]*FA 付款的款項類型固定為新單 New/,
  );
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
  assert.match(route, /bige_create_member_contract_v4/);
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
  assert.ok(assistanceButtonIndex >= 0);
  assert.ok(addCoachButtonIndex > assistanceButtonIndex);
  assert.ok(addCoachButtonIndex < navigationEndIndex);
  assert.doesNotMatch(component, /className=\{styles\.scheduleActions\}/);
});

test("wide desktop schedule keeps daily controls to the right on one row", () => {
  const styles = readFileSync("components/bige-fitness-operations.module.css", "utf8");

  assert.match(
    styles,
    /@media \(min-width: 1280px\)[\s\S]*data-daily-schedule-active="true"\] \.navigationRow \{[\s\S]*flex-wrap: nowrap;[\s\S]*overflow-x: auto;/,
  );
  assert.match(
    styles,
    /data-daily-schedule-active="true"\] \.businessDayControls \{[\s\S]*flex: 1 1 auto;[\s\S]*flex-wrap: nowrap;[\s\S]*justify-content: flex-end;/,
  );
  assert.match(
    styles,
    /Wide desktop schedule:[\s\S]*Narrower screens keep the[\s\S]*existing wrapping behavior/,
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
    /const optimisticBooking: Booking = \{[\s\S]*optimistic: true,[\s\S]*member_id: scheduleDraft\.operationKind === "pt"[\s\S]*starts_at: new Date\(startsAt\)\.toISOString\(\)/,
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
    /commit: \(result\) => \{[\s\S]*bookingId[\s\S]*setSuccess\("排課已建立"\)[\s\S]*loadBoard\(\{ silent: true, targetDate: operationDate \}\)/,
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

test("FA signing date is locked to today and ECPay installments require a stored count", () => {
  const migration = readFileSync(
    "supabase/migrations/20260815225909_lock_fa_signed_date_and_record_ecpay_installments.sql",
    "utf8",
  );
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(
    migration,
    /when p_source_booking_id is not null[\s\S]*now\(\) at time zone 'Asia\/Taipei'/,
  );
  assert.match(migration, /add column if not exists installment_count integer/);
  assert.match(migration, /p_installment_count not between 2 and 60/);
  assert.match(component, /請輸入綠界分期期數（2 至 60 期）/);
  assert.match(
    component,
    /disabled=\{selectedBooking\?\.operation_kind === "trial"\}/,
  );
  assert.match(
    component,
    /selectedBooking\?\.operation_kind === "trial"[\s\S]*\? localDate\(\)[\s\S]*: contractDraft\.signedOn/,
  );
  assert.match(route, /rpc\("bige_create_member_contract_v4"/);
  assert.match(route, /const trustedSignedOn = input\.sourceBookingId \? toTaipeiDateString\(\) : input\.signedOn/);
  assert.match(route, /rpc\("bige_record_contract_payment_v2"/);
  assert.match(route, /p_installment_count: input\.installmentCount \|\| null/);
});
