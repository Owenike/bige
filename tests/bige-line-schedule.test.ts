import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createContractSchema,
  recordWalkInPaymentSchema,
  retryLineScheduleNotificationSchema,
  setMemberLineGroupBindingSchema,
} from "../lib/bige-fitness";
import {
  bigeLineRetryDelayMinutes,
  buildBigeLineScheduleMessage,
  verifyBigeLineWebhookSignature,
} from "../lib/bige-line-schedule";

test("formal schedule message consolidates future courses without coach identity", () => {
  const message = buildBigeLineScheduleMessage({
    memberName: "王小明",
    eventKind: "updated",
    schedules: [
      {
        id: "booking-1",
        starts_at: "2026-08-08T10:00:00+08:00",
        ends_at: "2026-08-08T11:00:00+08:00",
        course_type: "weight_training",
        service_name: "重量訓練",
      },
      {
        id: "booking-2",
        starts_at: "2026-08-15T14:30:00+08:00",
        ends_at: "2026-08-15T15:30:00+08:00",
        course_type: "relaxation",
        service_name: "放鬆",
      },
    ],
  });

  assert.match(message, /王小明 您好/);
  assert.match(message, /8\/8/);
  assert.match(message, /8\/15/);
  assert.match(message, /重訓/);
  assert.match(message, /放鬆/);
  assert.doesNotMatch(message, /教練/);
});

test("cancellation message clearly reports when no future PT remains", () => {
  const message = buildBigeLineScheduleMessage({
    memberName: "王小明",
    eventKind: "cancelled",
    schedules: [],
  });
  assert.match(message, /課程取消／更新通知/);
  assert.match(message, /目前沒有尚未開始的正式課程/);
  assert.doesNotMatch(message, /教練/);
});

test("LINE webhook rejects unsigned payloads and accepts the configured HMAC", () => {
  const previous = process.env.LINE_STUDENT_SCHEDULE_CHANNEL_SECRET;
  process.env.LINE_STUDENT_SCHEDULE_CHANNEL_SECRET = "unit-test-secret";
  const body = JSON.stringify({ events: [] });
  const signature = createHmac("sha256", "unit-test-secret").update(body).digest("base64");
  assert.equal(verifyBigeLineWebhookSignature(body, signature), true);
  assert.equal(verifyBigeLineWebhookSignature(body, null), false);
  assert.equal(verifyBigeLineWebhookSignature(`${body}x`, signature), false);
  if (previous == null) delete process.env.LINE_STUDENT_SCHEDULE_CHANNEL_SECRET;
  else process.env.LINE_STUDENT_SCHEDULE_CHANNEL_SECRET = previous;
});

test("contract creation requires an explicit LINE group binding", () => {
  const validContract = {
    action: "create_contract" as const,
    lineGroupBindingId: "00000000-0000-4000-8000-000000000099",
    fullName: "王小明",
    phone: "0912345678",
    birthDate: "1990-01-01",
    email: null,
    emailUnavailable: true,
    planMode: "builtin" as const,
    planId: "00000000-0000-4000-8000-000000000098",
    signedOn: "2026-08-24",
    initialPayment: 0,
    paymentSchedule: [],
  };
  assert.equal(createContractSchema.safeParse(validContract).success, true);
  const withoutBinding = { ...validContract } as Partial<typeof validContract>;
  delete withoutBinding.lineGroupBindingId;
  assert.equal(createContractSchema.safeParse(withoutBinding).success, false);
});

test("walk-in payment requires an auditable operation and positive tender entries", () => {
  assert.equal(
    recordWalkInPaymentSchema.safeParse({
      action: "record_walk_in_payment",
      memberId: "00000000-0000-4000-8000-000000000091",
      contractId: "00000000-0000-4000-8000-000000000092",
      paymentKind: "balance",
      payments: [{ amount: 3000, method: "cash", installmentCount: null }],
      idempotencyKey: "walk-in-test-0001",
    }).success,
    true,
  );
  assert.equal(
    recordWalkInPaymentSchema.safeParse({
      action: "record_walk_in_payment",
      memberId: "00000000-0000-4000-8000-000000000091",
      contractId: "00000000-0000-4000-8000-000000000092",
      paymentKind: "balance",
      payments: [],
      idempotencyKey: "short",
    }).success,
    false,
  );
});

test("existing member LINE group binding requires explicit member and group ids", () => {
  assert.equal(
    setMemberLineGroupBindingSchema.safeParse({
      action: "set_member_line_group_binding",
      memberId: "00000000-0000-4000-8000-000000000091",
      lineGroupBindingId: "00000000-0000-4000-8000-000000000092",
    }).success,
    true,
  );
  assert.equal(
    setMemberLineGroupBindingSchema.safeParse({
      action: "set_member_line_group_binding",
      memberId: "not-a-member-id",
      lineGroupBindingId: "00000000-0000-4000-8000-000000000092",
    }).success,
    false,
  );
});

test("manual LINE retry requires an exact failed notification id", () => {
  assert.equal(
    retryLineScheduleNotificationSchema.safeParse({
      action: "retry_line_schedule_notification",
      notificationId: "00000000-0000-4000-8000-000000000091",
    }).success,
    true,
  );
  assert.equal(
    retryLineScheduleNotificationSchema.safeParse({
      action: "retry_line_schedule_notification",
      notificationId: "latest",
    }).success,
    false,
  );
});

test("LINE retry cadence is 5 minutes, 15 minutes, 1 hour, then 6 hours", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(bigeLineRetryDelayMinutes),
    [5, 15, 60, 360, 360],
  );
});

test("member profile exposes manual LINE binding and the audited atomic RPC", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260824205036_bige_member_line_group_profile_binding.sql",
    "utf8",
  );
  assert.match(route, /input\.action === "set_member_line_group_binding"/);
  assert.match(route, /bige_set_member_line_group_binding_v1/);
  assert.match(component, /aria-label="學員 LINE 群組設定"/);
  assert.match(component, /群組名稱只作提示，不會依學員姓名自動配對/);
  assert.match(component, /activeMemberLineBinding[\s\S]*inactiveMemberLineBinding/);
  assert.match(migration, /status = 'disabled'/);
  assert.match(migration, /bige_member_line_group_bound/);
  assert.match(migration, /'bindingSource', 'member_profile'/);
  assert.match(migration, /revoke all on function public\.bige_set_member_line_group_binding_v1/);
});

test("LINE delivery is PT-only, future-only, refreshes latest schedules, and supersedes stale work", () => {
  const line = readFileSync("lib/bige-line-schedule.ts", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260824214522_harden_bige_line_schedule_retries.sql",
    "utf8",
  );
  assert.match(line, /\.eq\("operation_kind", "pt"\)/);
  assert.match(line, /\.gt\("starts_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(line, /bige_queue_line_schedule_notification_v2/);
  assert.match(line, /snapshot_refreshed_at/);
  assert.match(line, /X-Line-Retry-Key/);
  assert.match(line, /bigeLineRetryDelayMinutes/);
  assert.match(vercel, /"path": "\/api\/cron\/bige-line-schedule"[\s\S]*"schedule": "5 0 \* \* \*"/);
  assert.doesNotMatch(vercel, /"schedule": "\*\/5 \* \* \* \*"/);
  assert.match(migration, /bige-line-schedule-retry-every-5-minutes/);
  assert.match(migration, /'\*\/5 \* \* \* \*'/);
  assert.match(migration, /superseded_by_newer_schedule_change/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /revoke all on function public\.bige_invoke_line_schedule_retry_worker_v1/);
  assert.match(route, /if \(params\.operationKind !== "pt" \|\| !params\.memberId\)/);
  assert.match(route, /notifyScheduleMoveMutation/);
  assert.match(route, /bige_schedule_drag_swap/);
  assert.match(route, /bige_schedule_drag_overwrite/);
  assert.match(route, /restore-cancelled:/);
});

test("LINE failures are visible without joining the protected daily-board prefetch", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  assert.match(route, /lineScheduleNotificationIssues/);
  assert.match(route, /input\.action === "retry_line_schedule_notification"/);
  assert.match(route, /status !== "failed"/);
  assert.match(component, /setDialog\("line-notifications"\)/);
  assert.match(component, /重新發送目前課表/);
  assert.match(component, /5 分鐘、15 分鐘、1 小時、6 小時/);
  assert.doesNotMatch(component, /requestBoard[\s\S]{0,1200}lineScheduleNotificationIssues/);
});

test("walk-in dashboard is loaded once outside the protected date prefetch window", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  assert.match(route, /searchParams\.get\("operations"\) === "1"/);
  assert.match(component, /fetch\("\/api\/bige-fitness\?operations=1"/);
  assert.doesNotMatch(component, /requestBoard[\s\S]{0,1200}operations=1/);
  assert.ok(component.indexOf("styles.walkInPaymentButton") < component.indexOf("styles.frontdeskStatus"));
  assert.match(component, /Number\(data\.walkInPaymentCount \|\| 0\) > 99 \? "99\+"/);
});

test("database migration enforces one active group and one counted operation per receipt", () => {
  const migration = readFileSync(
    "supabase/migrations/20260823215949_bige_line_groups_and_walk_in_payments.sql",
    "utf8",
  );
  assert.match(migration, /where status = 'active' and member_id is not null/);
  assert.match(migration, /unique \(tenant_id, line_group_id\)/);
  assert.match(migration, /unique \(tenant_id, idempotency_key\)/);
  assert.match(migration, /payment_ids uuid\[\]/);
  assert.match(migration, /bige_create_member_contract_v7/);
  assert.match(migration, /bige_create_bb_member_contract_v2/);
  assert.match(migration, /bige_record_walk_in_payments_v1/);
  assert.match(migration, /actor_employee_number/);
  assert.match(migration, /bige_walk_in_payment_recorded/);
});
