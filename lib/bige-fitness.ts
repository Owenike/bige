import { z } from "zod";
import { isValidTaiwanMobile, normalizeStudentPhone } from "./student-phone";

export const BIGE_TIME_ZONE = "Asia/Taipei";
export const BIGE_OPEN_HOUR = 9;
export const BIGE_CLOSE_HOUR = 24;
export const BIGE_SLOT_MINUTES = 30;
export const BIGE_OPERATION_WINDOW_MINUTES = 30;
export const BIGE_SCHEDULE_NOTE_UNDO_WINDOW_MS = 30_000;
export const BIGE_SCHEDULE_MOVE_UNDO_WINDOW_MS = 10_000;
export const BIGE_VALIDITY_BONUS_DAYS = 30;

export const BIGE_COURSE_TYPES = [
  "weight_training",
  "relaxation",
  "reformer_pilates",
  "sports_cupping",
  "fascia_knife",
  "onsite_assessment",
] as const;
export type BigeCourseType = (typeof BIGE_COURSE_TYPES)[number];

export const BIGE_CONTRACT_COURSE_TYPES = [
  "weight_training",
  "relaxation",
  "reformer_pilates",
  "sports_cupping",
  "fascia_knife",
] as const;
export type BigeContractCourseType = (typeof BIGE_CONTRACT_COURSE_TYPES)[number];

export const BIGE_TRIAL_COURSE_TYPES = [
  "weight_training",
  "relaxation",
  "reformer_pilates",
  "onsite_assessment",
] as const;
export type BigeTrialCourseType = (typeof BIGE_TRIAL_COURSE_TYPES)[number];

export const BIGE_COURSE_LABELS: Record<BigeCourseType, string> = {
  weight_training: "重訓",
  relaxation: "放鬆",
  reformer_pilates: "器械皮拉提斯",
  sports_cupping: "運動拔罐",
  fascia_knife: "筋膜刀",
  onsite_assessment: "現場評估",
};

export const BIGE_OPERATION_KINDS = ["pt", "trial"] as const;
export const BIGE_TRIAL_REMINDER_PENDING_STATUS = "pending" as const;
export const BIGE_TRIAL_REMINDER_CONFIRMED_STATUS = "reached" as const;
export const BIGE_FA_DEFAULT_FEE_AMOUNT = 880 as const;
export const BIGE_FA_SPORTS_MASSAGE_FEE_AMOUNT = 1500 as const;
export const BIGE_COMPLETED_BOOKING_EDIT_MESSAGE =
  "本堂已完成並扣課，請先到「課程狀態操作」復原為未扣課，再修改時間、時長、教練或課別。";

export function getBigeFaFeeAmount(service: unknown) {
  return service === "sports_massage"
    ? BIGE_FA_SPORTS_MASSAGE_FEE_AMOUNT
    : BIGE_FA_DEFAULT_FEE_AMOUNT;
}

export function canEditBigeScheduleBooking(status: string | null | undefined) {
  return status !== "completed";
}

export function calculateBigeContractOutstandingBalance(
  totalAmount: number,
  payments: Array<{ amount?: number | null; status?: string | null }>,
) {
  const normalizedTotal = Number.isFinite(Number(totalAmount))
    ? Math.max(0, Number(totalAmount))
    : 0;
  const recordedTotal = payments.reduce((sum, payment) => {
    if (payment.status !== "recorded") return sum;
    const amount = Number(payment.amount);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);

  return Math.max(0, normalizedTotal - recordedTotal);
}

export function isBigeContractVoidedForDisplay(input: {
  contractStatus?: string | null;
  payments?: Array<{ status?: string | null }> | null;
}) {
  const payments = input.payments || [];

  return (
    input.contractStatus === "canceled" ||
    (payments.length > 0 && payments.every((payment) => payment.status === "voided"))
  );
}

export function getBigeStudentPaymentBalanceState(input: {
  contractCount: number;
  outstandingBalance: number;
}) {
  if (input.contractCount <= 0) return "no_contract" as const;
  if (input.outstandingBalance > 0) return "balance_due" as const;
  return "settled" as const;
}

type BigeCourseAllocationContract = {
  status?: string | null;
  total_sessions?: number | null;
  used_sessions?: number | null;
  course_allocations?: Partial<Record<BigeContractCourseType, number>> | null;
  course_used?: Partial<Record<BigeContractCourseType, number>> | null;
  course_allocations_configured_at?: string | null;
};

export function summarizeBigeMemberCourseSessions(
  contracts: BigeCourseAllocationContract[],
) {
  const relevantContracts = contracts.filter(
    (contract) =>
      contract.status !== "canceled" && Number(contract.total_sessions || 0) > 0,
  );
  const allocations = Object.fromEntries(
    BIGE_CONTRACT_COURSE_TYPES.map((course) => [course, 0]),
  ) as Record<BigeContractCourseType, number>;
  const used = { ...allocations };
  let configuredContracts = 0;

  for (const contract of relevantContracts) {
    if (!contract.course_allocations_configured_at) continue;
    configuredContracts += 1;
    for (const course of BIGE_CONTRACT_COURSE_TYPES) {
      allocations[course] += Math.max(
        0,
        Number(contract.course_allocations?.[course] || 0),
      );
      used[course] += Math.max(0, Number(contract.course_used?.[course] || 0));
    }
  }

  return {
    contractCount: relevantContracts.length,
    configuredContracts,
    unconfiguredContracts: relevantContracts.length - configuredContracts,
    totalSessions: relevantContracts.reduce(
      (sum, contract) => sum + Math.max(0, Number(contract.total_sessions || 0)),
      0,
    ),
    usedSessions: relevantContracts.reduce(
      (sum, contract) => sum + Math.max(0, Number(contract.used_sessions || 0)),
      0,
    ),
    allocations,
    used,
    allocatedCourseTypes: BIGE_CONTRACT_COURSE_TYPES.filter(
      (course) => allocations[course] > 0,
    ),
  };
}

type BigeMemberPaymentRelation = Record<string, unknown> & {
  created_at?: string | null;
  payments?: Array<Record<string, unknown> & { paid_at?: string | null }>;
};

export function flattenBigeMemberPaymentRelations(
  record:
    | (Record<string, unknown> & { contracts?: BigeMemberPaymentRelation[] | null })
    | null,
) {
  if (!record) {
    return { member: null, contracts: [], payments: [] };
  }

  const member = { ...record };
  const relatedContracts = [...(record.contracts || [])].sort(
    (left, right) =>
      Date.parse(String(right.created_at || "")) -
      Date.parse(String(left.created_at || "")),
  );
  delete member.contracts;

  const contracts = relatedContracts.map((relation) => {
    const contract = { ...relation };
    delete contract.created_at;
    delete contract.payments;
    return contract;
  });
  const payments = relatedContracts
    .flatMap((relation) => relation.payments || [])
    .sort(
      (left, right) =>
        Date.parse(String(right.paid_at || "")) -
        Date.parse(String(left.paid_at || "")),
    );

  return { member, contracts, payments };
}

export function buildBigeMemberPaymentDetailMap(
  records: Array<
    Record<string, unknown> & { contracts?: BigeMemberPaymentRelation[] | null }
  >,
  permissions: {
    canViewDetailedPaymentDates: boolean;
    canRecordContractPayment: boolean;
    canEditContractPayment?: boolean;
    canManageCourseAllocations: boolean;
  },
) {
  const details: Record<
    string,
    {
      member: Record<string, unknown>;
      contracts: Array<Record<string, unknown>>;
      paymentSchedule: never[];
      payments: Array<Record<string, unknown>>;
      extensions: never[];
      canViewDetailedPaymentDates: boolean;
      canRecordContractPayment: boolean;
      canEditContractPayment: boolean;
      canManageCourseAllocations: boolean;
    }
  > = {};

  for (const record of records) {
    const detail = flattenBigeMemberPaymentRelations(record);
    const memberId = String(detail.member?.id || "");
    if (!memberId || !detail.member) continue;
    details[memberId] = {
      member: detail.member,
      contracts: detail.contracts,
      paymentSchedule: [],
      payments: detail.payments,
      extensions: [],
      ...permissions,
      canEditContractPayment: permissions.canEditContractPayment ?? false,
    };
  }

  return details;
}

export function isBigeContractPaymentAmountAllowed(
  amount: number,
  maximumAmount: number,
  options: { allowZero?: boolean; minimumAmount?: number } = {},
) {
  const normalizedAmount = Number(amount);
  const normalizedMaximum = Number(maximumAmount);
  const minimumAmount = Number(
    options.minimumAmount ?? (options.allowZero ? 0 : 1),
  );

  return (
    Number.isInteger(normalizedAmount) &&
    Number.isInteger(minimumAmount) &&
    Number.isFinite(normalizedMaximum) &&
    minimumAmount >= 0 &&
    normalizedAmount >= minimumAmount &&
    normalizedMaximum >= minimumAmount &&
    normalizedAmount <= normalizedMaximum
  );
}

export function isBigeTrialReminderConfirmed(status: string | null | undefined) {
  return status === BIGE_TRIAL_REMINDER_CONFIRMED_STATUS;
}

export function nextBigeTrialReminderStatus(status: string | null | undefined) {
  return isBigeTrialReminderConfirmed(status)
    ? BIGE_TRIAL_REMINDER_PENDING_STATUS
    : BIGE_TRIAL_REMINDER_CONFIRMED_STATUS;
}

export type BigeTrialConversionOutcome =
  | "pending_conversion"
  | "converted"
  | "not_converted";

export type BigeTrialOutcomeVisualState =
  | "pending_conversion"
  | "converted"
  | "not_converted"
  | null;

export function getBigeTrialOutcomeVisualState(input: {
  convertedAt?: string | null;
  outcome?: BigeTrialConversionOutcome | null;
}): BigeTrialOutcomeVisualState {
  if (input.convertedAt || input.outcome === "converted") return "converted";
  if (input.outcome === "not_converted") return "not_converted";
  if (input.outcome === "pending_conversion") return "pending_conversion";
  return null;
}

export function canReviseBigeTrialOutcome(input: {
  convertedAt?: string | null;
}) {
  return !input.convertedAt;
}

export function getBigeTrialBookingActionVisibility(input: {
  outcomePrompt: boolean;
  status?: string | null;
  convertedAt?: string | null;
}) {
  return {
    showOutcomeChoices: input.outcomePrompt,
    showSecondaryStatusActions:
      !input.outcomePrompt && input.status !== "completed" && !input.convertedAt,
  };
}

type BigeTrialContractIdentityInput = {
  trialBooking?: {
    name?: string | null;
    phone?: string | null;
    birthday?: string | null;
  } | null;
  member?: {
    full_name?: string | null;
    phone?: string | null;
    birth_date?: string | null;
  } | null;
};

export function resolveBigeTrialContractIdentity(
  input: BigeTrialContractIdentityInput,
) {
  const trialPhone = normalizeStudentPhone(input.trialBooking?.phone || "");
  const memberPhone = normalizeStudentPhone(input.member?.phone || "");
  const trialBirthday = input.trialBooking?.birthday || "";
  const memberBirthday = input.member?.birth_date || "";

  return {
    fullName:
      input.trialBooking?.name?.trim() || input.member?.full_name?.trim() || "",
    phone: isValidTaiwanMobile(trialPhone)
      ? trialPhone
      : isValidTaiwanMobile(memberPhone)
        ? memberPhone
        : trialPhone || memberPhone,
    birthDate: /^\d{4}-\d{2}-\d{2}$/.test(trialBirthday)
      ? trialBirthday
      : /^\d{4}-\d{2}-\d{2}$/.test(memberBirthday)
        ? memberBirthday
        : "",
  };
}

export function getBigeTrialContractMissingProfileFields(identity: {
  fullName?: string | null;
  phone?: string | null;
  birthDate?: string | null;
}) {
  return [
    !identity.fullName?.trim() ? "姓名" : null,
    !isValidTaiwanMobile(normalizeStudentPhone(identity.phone || "")) ? "手機" : null,
    !/^\d{4}-\d{2}-\d{2}$/.test(identity.birthDate || "") ? "生日" : null,
  ].filter((field): field is string => Boolean(field));
}
export type BigeOperationKind = (typeof BIGE_OPERATION_KINDS)[number];
export const BIGE_FA_DURATION_MINUTES = 120;

export function normalizeBigeScheduleEndAt(
  operationKind: BigeOperationKind,
  startsAt: string,
  requestedEndsAt: string,
) {
  if (operationKind !== "trial") return requestedEndsAt;
  const startsAtMs = new Date(startsAt).getTime();
  if (!Number.isFinite(startsAtMs)) return requestedEndsAt;
  return new Date(startsAtMs + BIGE_FA_DURATION_MINUTES * 60_000).toISOString();
}

export const BIGE_STAFF_ROLES = [
  "platform_admin",
  "manager",
  "supervisor",
  "branch_manager",
  "store_owner",
  "store_manager",
  "frontdesk",
  "coach",
] as const;

export const BIGE_MANAGER_ROLES = [
  "platform_admin",
  "manager",
  "supervisor",
  "branch_manager",
  "store_owner",
  "store_manager",
] as const;

export const courseAllocationsSchema = z
  .object({
    weight_training: z.coerce.number().int().min(0),
    relaxation: z.coerce.number().int().min(0),
    reformer_pilates: z.coerce.number().int().min(0),
    sports_cupping: z.coerce.number().int().min(0).default(0),
    fascia_knife: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((value, context) => {
    if (Object.values(value).every((count) => count === 0)) {
      context.addIssue({
        code: "custom",
        message: "至少要分配一堂課",
      });
    }
  });

export const createScheduleSchema = z.object({
  action: z.literal("create_schedule"),
  branchId: z.string().uuid().nullable().optional(),
  memberId: z.string().uuid().nullable().optional(),
  trialBookingId: z.string().uuid().nullable().optional(),
  coachId: z.string().uuid(),
  operationKind: z.enum(BIGE_OPERATION_KINDS),
  courseType: z.enum(BIGE_COURSE_TYPES),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(500).nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(180),
});

export const createScheduleBatchSchema = z.object({
  action: z.literal("create_schedule_batch"),
  branchId: z.string().uuid().nullable().optional(),
  memberId: z.string().uuid(),
  coachId: z.string().uuid(),
  operationKind: z.enum(BIGE_OPERATION_KINDS).default("pt"),
  courseType: z.enum(BIGE_COURSE_TYPES),
  startsAt: z.array(z.string().datetime({ offset: true })).min(1).max(62),
  note: z.string().trim().max(500).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const checkScheduleBatchSchema = z.object({
  action: z.literal("check_schedule_batch"),
  branchId: z.string().uuid().nullable().optional(),
  memberId: z.string().uuid(),
  coachId: z.string().uuid(),
  operationKind: z.enum(BIGE_OPERATION_KINDS).default("pt"),
  courseType: z.enum(BIGE_COURSE_TYPES),
  startsAt: z.array(z.string().datetime({ offset: true })).min(1).max(62),
});

export const createScheduleNoteSchema = z.object({
  action: z.literal("create_note"),
  branchId: z.string().uuid().nullable().optional(),
  coachId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  content: z.string().trim().min(1).max(300),
});

export const editScheduleBookingSchema = z.object({
  action: z.literal("edit_schedule_booking"),
  bookingId: z.string().uuid(),
  coachId: z.string().uuid(),
  courseType: z.enum(BIGE_COURSE_TYPES),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(500).nullable().optional(),
});

export const editScheduleNoteSchema = z.object({
  action: z.literal("edit_schedule_note"),
  noteId: z.string().uuid(),
  coachId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  content: z.string().trim().min(1).max(300),
});

export const deleteScheduleNoteSchema = z.object({
  action: z.literal("delete_schedule_note"),
  noteId: z.string().uuid(),
});

export const deleteScheduleBookingSchema = z.object({
  action: z.literal("delete_schedule_booking"),
  bookingId: z.string().uuid(),
});

export const restoreScheduleNoteSchema = z.object({
  action: z.literal("restore_schedule_note"),
  noteId: z.string().uuid(),
});

export const moveScheduleBookingSchema = z.object({
  action: z.literal("move_schedule_booking"),
  bookingId: z.string().uuid(),
  targetCoachId: z.string().uuid(),
  targetStartsAt: z.string().datetime({ offset: true }),
  mode: z.enum(["move", "swap", "overwrite"]),
});

export const undoScheduleBookingMoveSchema = z.object({
  action: z.literal("undo_schedule_booking_move"),
  operationId: z.string().uuid(),
});

export const reorderScheduleCoachesSchema = z.object({
  action: z.literal("reorder_schedule_coaches"),
  coachIds: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .refine((coachIds) => new Set(coachIds).size === coachIds.length, {
      message: "教練順序不能包含重複資料",
    }),
});

export const updateScheduleSchema = z.object({
  action: z.literal("update_schedule"),
  bookingId: z.string().uuid(),
  result: z.enum(["completed", "cancelled", "no_show", "rescheduled"]),
  note: z.string().trim().max(500).nullable().optional(),
});

export const updateReminderSchema = z.object({
  action: z.literal("update_reminder"),
  bookingId: z.string().uuid(),
  status: z.enum(["pending", "reached", "no_answer", "retry"]),
  note: z.string().trim().max(500).nullable().optional(),
});

export const createPlanSchema = z.object({
  action: z.literal("create_plan"),
  name: z.string().trim().min(1).max(100),
  totalSessions: z.coerce.number().int().positive(),
  totalAmount: z.coerce.number().int().positive(),
  allocations: courseAllocationsSchema,
  isCustom: z.boolean().optional().default(false),
  description: z.string().trim().max(500).nullable().optional(),
});

export const updateCourseAllocationsSchema = z.object({
  action: z.literal("update_course_allocations"),
  contractId: z.string().uuid(),
  allocations: courseAllocationsSchema,
});

const bigePaymentMethodSchema = z.enum([
  "cash",
  "bank_transfer",
  "card_terminal",
  "ecpay",
  "ecpay_installment",
  "acpay",
  "other",
]);

export const bigePaymentEntrySchema = z
  .object({
    amount: z.coerce.number().int().positive(),
    method: bigePaymentMethodSchema,
    installmentCount: z.coerce.number().int().min(2).max(60).nullable().optional(),
  })
  .superRefine((input, context) => {
    if (input.method === "ecpay_installment" && input.installmentCount == null) {
      context.addIssue({
        code: "custom",
        path: ["installmentCount"],
        message: "請輸入綠界分期期數",
      });
    }
    if (input.method !== "ecpay_installment" && input.installmentCount != null) {
      context.addIssue({
        code: "custom",
        path: ["installmentCount"],
        message: "只有綠界分期可以填寫分期期數",
      });
    }
  });

export const createContractSchema = z.object({
  action: z.literal("create_contract"),
  branchId: z.string().uuid().nullable().optional(),
  memberId: z.string().uuid().nullable().optional(),
  sourceBookingId: z.string().uuid().nullable().optional(),
  sourceMemberBookingId: z.string().uuid().nullable().optional(),
  fullName: z.string().trim().min(1).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^09\d{8}$/, "電話必須是 10 位台灣手機號碼"),
  birthDate: z.union([z.string().date(), z.literal("")]).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  emailUnavailable: z.boolean().default(false),
  notifyManagerProfileChange: z.boolean().default(false),
  planMode: z.enum(["builtin", "custom"]).default("builtin"),
  planId: z.string().uuid().nullable().optional(),
  customPlan: z
    .object({
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().max(500).nullable().optional(),
      totalSessions: z.coerce.number().int().positive(),
      totalAmount: z.coerce.number().int().positive(),
      allocations: courseAllocationsSchema,
      validityDays: z.coerce.number().int().positive(),
      extensionLimitDays: z.coerce.number().int().min(0),
    })
    .nullable()
    .optional(),
  signedOn: z.string().date(),
  initialPayment: z.coerce.number().int().min(0).default(0),
  paymentMethod: bigePaymentMethodSchema.nullable().optional(),
  installmentCount: z.coerce.number().int().min(2).max(60).nullable().optional(),
  payments: z.array(bigePaymentEntrySchema).max(10).optional(),
  paymentSchedule: z
    .array(
      z.object({
        kind: z.enum(["deposit", "balance", "installment"]),
        dueOn: z.string().date(),
        amount: z.coerce.number().int().positive(),
        note: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .default([]),
  futureTrialAction: z.enum(["convert_to_pt", "cancel"]).nullable().optional(),
  faFeeRecipientProfileId: z.string().uuid().nullable().optional(),
  faFeeRecipientName: z.string().trim().min(1).max(80).nullable().optional(),
}).superRefine((input, context) => {
  if (input.paymentMethod === "ecpay_installment" && input.installmentCount == null) {
    context.addIssue({
      code: "custom",
      path: ["installmentCount"],
      message: "請輸入綠界分期期數",
    });
  }
  if (input.paymentMethod !== "ecpay_installment" && input.installmentCount != null) {
    context.addIssue({
      code: "custom",
      path: ["installmentCount"],
      message: "只有綠界分期可以填寫分期期數",
    });
  }
  if ((input.sourceBookingId || input.sourceMemberBookingId) && input.initialPayment <= 0) {
    context.addIssue({
      code: "custom",
      path: ["initialPayment"],
      message: "課程成交或續約必須輸入符合方案最低限制的付款金額",
    });
  }
  if (input.payments) {
    const paymentTotal = input.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paymentTotal !== input.initialPayment) {
      context.addIssue({
        code: "custom",
        path: ["payments"],
        message: "多筆付款合計必須等於本次付款金額",
      });
    }
    if (input.initialPayment > 0 && input.payments.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["payments"],
        message: "有付款金額時至少要有一筆付款方式",
      });
    }
  }
  if (input.sourceBookingId && !input.faFeeRecipientName) {
    context.addIssue({
      code: "custom",
      path: ["faFeeRecipientName"],
      message: "請先選擇或輸入 FA 收款人",
    });
  }
  if (
    !input.sourceBookingId &&
    (input.faFeeRecipientProfileId != null || input.faFeeRecipientName != null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["faFeeRecipientName"],
      message: "只有 FA 首次付款可以記錄 FA 收款人",
    });
  }
});

export const recordPaymentSchema = z.object({
  action: z.literal("record_payment"),
  contractId: z.string().uuid(),
  sourceBookingId: z.string().uuid().nullable().optional(),
  scheduleItemId: z.string().uuid().nullable().optional(),
  paymentKind: z.enum(["deposit", "balance", "installment"]),
  amount: z.coerce.number().int().positive(),
  method: bigePaymentMethodSchema,
  installmentCount: z.coerce.number().int().min(2).max(60).nullable().optional(),
  paidAt: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().trim().min(8).max(180),
  note: z.string().trim().max(300).nullable().optional(),
}).superRefine((input, context) => {
  if (input.method === "ecpay_installment" && input.installmentCount == null) {
    context.addIssue({
      code: "custom",
      path: ["installmentCount"],
      message: "請輸入綠界分期期數",
    });
  }
  if (input.method !== "ecpay_installment" && input.installmentCount != null) {
    context.addIssue({
      code: "custom",
      path: ["installmentCount"],
      message: "只有綠界分期可以填寫分期期數",
    });
  }
});

export const recordPaymentsSchema = z.object({
  action: z.literal("record_payments"),
  contractId: z.string().uuid(),
  sourceBookingId: z.string().uuid().nullable().optional(),
  scheduleItemId: z.string().uuid().nullable().optional(),
  paymentKind: z.enum(["deposit", "balance", "installment"]),
  payments: z.array(bigePaymentEntrySchema).min(1).max(10),
  paidAt: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
  note: z.string().trim().max(300).nullable().optional(),
});

export const updatePaymentSchema = z.object({
  action: z.literal("update_payment"),
  paymentId: z.string().uuid(),
  paymentKind: z.enum(["deposit", "balance", "installment"]),
  amount: z.coerce.number().int().positive(),
  method: bigePaymentMethodSchema,
  installmentCount: z.coerce.number().int().min(2).max(60).nullable().optional(),
  status: z.enum(["recorded", "voided", "refunded"]),
  note: z.string().trim().max(300).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
}).superRefine((input, context) => {
  if (input.method === "ecpay_installment" && input.installmentCount == null) {
    context.addIssue({
      code: "custom",
      path: ["installmentCount"],
      message: "請輸入綠界分期期數",
    });
  }
  if (input.method !== "ecpay_installment" && input.installmentCount != null) {
    context.addIssue({
      code: "custom",
      path: ["installmentCount"],
      message: "只有綠界分期可以填寫分期期數",
    });
  }
});

export const completeBookingSchema = z.object({
  action: z.literal("complete_booking"),
  bookingId: z.string().uuid(),
});

export const completeTrialOutcomeSchema = z.object({
  action: z.literal("complete_trial_outcome"),
  bookingId: z.string().uuid(),
  outcome: z.enum(["pending_conversion", "not_converted"]),
  faFeeRecipientProfileId: z.string().uuid().nullable().optional(),
  faFeeRecipientName: z.string().trim().min(1).max(80).nullable().optional(),
}).superRefine((input, context) => {
  if (input.outcome === "not_converted" && !input.faFeeRecipientName) {
    context.addIssue({
      code: "custom",
      path: ["faFeeRecipientName"],
      message: "請先選擇或輸入 FA 收款人",
    });
  }
  if (
    input.outcome !== "not_converted" &&
    (input.faFeeRecipientProfileId != null || input.faFeeRecipientName != null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["faFeeRecipientName"],
      message: "此 FA 結果不應包含收款人",
    });
  }
});

export const changeTrialConversionPaymentSchema = z.object({
  action: z.literal("change_trial_conversion_payment"),
  bookingId: z.string().uuid(),
  amount: z.coerce.number().int().positive(),
});

export const changeTrialConversionOutcomeSchema = z.object({
  action: z.literal("change_trial_conversion_outcome"),
  bookingId: z.string().uuid(),
  outcome: z.literal("not_converted"),
});

export const restoreTrialConversionSchema = z.object({
  action: z.literal("restore_trial_conversion"),
  bookingId: z.string().uuid(),
});

export const restoreBookingCompletionSchema = z.object({
  action: z.literal("restore_booking_completion"),
  bookingId: z.string().uuid(),
});

export const restoreCancelledBookingSchema = z.object({
  action: z.literal("restore_cancelled_booking"),
  bookingId: z.string().uuid(),
});

export const restoreNoShowBookingSchema = z.object({
  action: z.literal("restore_no_show_booking"),
  bookingId: z.string().uuid(),
});

export const extendContractSchema = z.object({
  action: z.literal("extend_contract"),
  contractId: z.string().uuid(),
  extensionDays: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  signatureDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg);base64,/)
    .max(1_500_000),
  signedMemberName: z.string().trim().min(1).max(80),
  signedAt: z.string().datetime({ offset: true }),
});

export const updateLegacyContractPurchaseDateSchema = z.object({
  action: z.literal("update_legacy_contract_purchase_date"),
  contractId: z.string().uuid(),
  purchaseDate: z.string().date(),
});

export const closeDaySchema = z.object({
  action: z.enum(["confirm_day", "reopen_day"]),
  businessDate: z.string().date(),
  branchId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const updateBusinessDaySchema = z.object({
  action: z.literal("update_business_day"),
  businessDate: z.string().date(),
  branchId: z.string().uuid().nullable().optional(),
  isClosed: z.boolean().optional(),
  closureLabel: z.string().trim().min(1).max(80).nullable().optional(),
  frontdeskName: z.string().trim().min(1).max(80).nullable().optional(),
});

export const reversePaymentSchema = z.object({
  action: z.literal("reverse_payment"),
  paymentId: z.string().uuid(),
  reversal: z.enum(["void", "refund"]),
  reason: z.string().trim().min(3).max(500),
});

export const bigeFitnessActionSchema = z.discriminatedUnion("action", [
  createScheduleSchema,
  checkScheduleBatchSchema,
  createScheduleBatchSchema,
  createScheduleNoteSchema,
  editScheduleBookingSchema,
  editScheduleNoteSchema,
  deleteScheduleNoteSchema,
  deleteScheduleBookingSchema,
  restoreScheduleNoteSchema,
  moveScheduleBookingSchema,
  undoScheduleBookingMoveSchema,
  reorderScheduleCoachesSchema,
  updateScheduleSchema,
  updateReminderSchema,
  createPlanSchema,
  updateCourseAllocationsSchema,
  createContractSchema,
  recordPaymentSchema,
  recordPaymentsSchema,
  updatePaymentSchema,
  completeBookingSchema,
  completeTrialOutcomeSchema,
  changeTrialConversionPaymentSchema,
  changeTrialConversionOutcomeSchema,
  restoreTrialConversionSchema,
  restoreBookingCompletionSchema,
  restoreCancelledBookingSchema,
  restoreNoShowBookingSchema,
  extendContractSchema,
  updateLegacyContractPurchaseDateSchema,
  reversePaymentSchema,
  closeDaySchema,
  updateBusinessDaySchema,
]);

export function isBigeScheduleNoteUndoAvailable(
  deletedAt: string,
  now = Date.now(),
) {
  const deletedAtMs = Date.parse(deletedAt);
  const ageMs = now - deletedAtMs;
  return (
    Number.isFinite(deletedAtMs) &&
    ageMs >= 0 &&
    ageMs <= BIGE_SCHEDULE_NOTE_UNDO_WINDOW_MS
  );
}

export function isBigeAssistantToContent(content: unknown) {
  return String(content ?? "").trim().toLocaleUpperCase("en-US") === "TO";
}

export function calculateContractTerms(totalSessions: number) {
  const baseDays = Math.ceil(totalSessions * 3.5);
  return {
    baseDays,
    validityDays: baseDays + BIGE_VALIDITY_BONUS_DAYS,
    extensionLimitDays: Math.ceil(baseDays / 2),
  };
}

export function calculateLegacyContractExpiryDate(
  purchaseDate: string,
  totalSessions: number,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    throw new Error("invalid_purchase_date");
  }
  if (!Number.isInteger(totalSessions) || totalSessions <= 0) {
    throw new Error("invalid_total_sessions");
  }

  const [year, month, day] = purchaseDate.split("-").map(Number);
  const { validityDays } = calculateContractTerms(totalSessions);
  return new Date(Date.UTC(year, month - 1, day + validityDays))
    .toISOString()
    .slice(0, 10);
}

export function calculateUnlockedSessions(totalPaid: number, totalAmount: number, totalSessions: number) {
  if (totalPaid <= 0 || totalAmount <= 0 || totalSessions <= 0) return 0;
  return Math.min(totalSessions, Math.floor((totalPaid * totalSessions) / totalAmount));
}

export function calculateMinimumDeposit(totalAmount: number, totalSessions: number) {
  if (totalAmount <= 0 || totalSessions <= 0) return 0;
  return Math.ceil(totalAmount / totalSessions);
}

export function validateCourseAllocationTotal(
  allocations: Record<BigeContractCourseType, number>,
  totalSessions: number,
) {
  return BIGE_CONTRACT_COURSE_TYPES.reduce((sum, key) => sum + allocations[key], 0) === totalSessions;
}

export function toTaipeiDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BIGE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatTaipeiDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: BIGE_TIME_ZONE,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function getZodMessage(error: z.ZodError) {
  return error.issues[0]?.message || "輸入資料格式錯誤";
}
