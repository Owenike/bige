import { z } from "zod";

export const BIGE_TIME_ZONE = "Asia/Taipei";
export const BIGE_OPEN_HOUR = 9;
export const BIGE_CLOSE_HOUR = 24;
export const BIGE_SLOT_MINUTES = 30;
export const BIGE_OPERATION_WINDOW_MINUTES = 30;
export const BIGE_VALIDITY_BONUS_DAYS = 30;

export const BIGE_COURSE_TYPES = ["weight_training", "relaxation", "reformer_pilates"] as const;
export type BigeCourseType = (typeof BIGE_COURSE_TYPES)[number];

export const BIGE_COURSE_LABELS: Record<BigeCourseType, string> = {
  weight_training: "重訓",
  relaxation: "放鬆",
  reformer_pilates: "器械皮拉提斯",
};

export const BIGE_OPERATION_KINDS = ["pt", "trial"] as const;
export type BigeOperationKind = (typeof BIGE_OPERATION_KINDS)[number];

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

export const createScheduleNoteSchema = z.object({
  action: z.literal("create_note"),
  branchId: z.string().uuid().nullable().optional(),
  coachId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  content: z.string().trim().min(1).max(300),
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
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/i),
  totalSessions: z.coerce.number().int().positive(),
  totalAmount: z.coerce.number().int().positive(),
  allocations: courseAllocationsSchema,
  isCustom: z.boolean().optional().default(false),
  description: z.string().trim().max(500).nullable().optional(),
});

export const createContractSchema = z.object({
  action: z.literal("create_contract"),
  branchId: z.string().uuid().nullable().optional(),
  memberId: z.string().uuid().nullable().optional(),
  sourceBookingId: z.string().uuid().nullable().optional(),
  fullName: z.string().trim().min(1).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^09\d{8}$/, "電話必須是 10 位台灣手機號碼"),
  birthDate: z.string().date(),
  email: z.string().trim().email().nullable().optional(),
  emailUnavailable: z.boolean().default(false),
  planId: z.string().uuid(),
  signedOn: z.string().date(),
  pin: z.string().regex(/^\d{6}$/, "上課密碼必須為 6 位數字"),
  initialPayment: z.coerce.number().int().min(0).default(0),
  paymentMethod: z
    .enum(["cash", "bank_transfer", "card_terminal", "acpay", "other"])
    .nullable()
    .optional(),
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
});

export const recordPaymentSchema = z.object({
  action: z.literal("record_payment"),
  contractId: z.string().uuid(),
  scheduleItemId: z.string().uuid().nullable().optional(),
  paymentKind: z.enum(["deposit", "balance", "installment"]),
  amount: z.coerce.number().int().positive(),
  method: z.enum(["cash", "bank_transfer", "card_terminal", "acpay", "other"]),
  paidAt: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().trim().min(8).max(180),
  note: z.string().trim().max(300).nullable().optional(),
});

export const completeBookingSchema = z.object({
  action: z.literal("complete_booking"),
  bookingId: z.string().uuid(),
  pin: z.string().regex(/^\d{6}$/),
});

export const setPinSchema = z.object({
  action: z.literal("set_pin"),
  memberId: z.string().uuid(),
  pin: z.string().regex(/^\d{6}$/),
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

export const closeDaySchema = z.object({
  action: z.enum(["confirm_day", "reopen_day"]),
  businessDate: z.string().date(),
  branchId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const reversePaymentSchema = z.object({
  action: z.literal("reverse_payment"),
  paymentId: z.string().uuid(),
  reversal: z.enum(["void", "refund"]),
  reason: z.string().trim().min(3).max(500),
});

export const bigeFitnessActionSchema = z.discriminatedUnion("action", [
  createScheduleSchema,
  createScheduleNoteSchema,
  updateScheduleSchema,
  updateReminderSchema,
  createPlanSchema,
  createContractSchema,
  recordPaymentSchema,
  completeBookingSchema,
  setPinSchema,
  extendContractSchema,
  reversePaymentSchema,
  closeDaySchema,
]);

export function calculateContractTerms(totalSessions: number) {
  const baseDays = Math.ceil(totalSessions * 3.5);
  return {
    baseDays,
    validityDays: baseDays + BIGE_VALIDITY_BONUS_DAYS,
    extensionLimitDays: Math.ceil(baseDays / 2),
  };
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
  allocations: Record<BigeCourseType, number>,
  totalSessions: number,
) {
  return BIGE_COURSE_TYPES.reduce((sum, key) => sum + allocations[key], 0) === totalSessions;
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
