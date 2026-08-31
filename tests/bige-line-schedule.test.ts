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
  bigeLineScheduleAnnouncementTitle,
  bigeLineGroupVerificationCode,
  bigeLineRetryDelayMinutes,
  buildBigeLineGroupVerificationMessage,
  buildBigeLineScheduleMessage,
  formatBigeLineGroupVerificationCode,
  isBigeLineGroupVerificationCodeRequest,
  resolveActiveBigeLineGroupBinding,
  verifyBigeLineWebhookSignature,
} from "../lib/bige-line-schedule";

function fakeLineBindingSupabase(
  responses: Record<string, Array<{ data: Record<string, unknown> | null; error: null }>>,
) {
  return {
    from(table: string) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        maybeSingle() {
          const response = responses[table]?.shift();
          if (!response) throw new Error(`missing fake response for ${table}`);
          return Promise.resolve(response);
        },
      };
      return chain;
    },
  };
}

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

test("LINE schedule events use clear member announcement titles", () => {
  assert.equal(bigeLineScheduleAnnouncementTitle("created"), "課程預約公告");
  assert.equal(bigeLineScheduleAnnouncementTitle("updated"), "課程異動公告");
  assert.equal(bigeLineScheduleAnnouncementTitle("cancelled"), "課程取消／更新公告");
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

test("test-mode contract creation permits a deferred LINE group binding", () => {
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
  assert.equal(createContractSchema.safeParse(withoutBinding).success, true);
  assert.equal(
    createContractSchema.safeParse({ ...validContract, lineGroupBindingId: null }).success,
    true,
  );
});

test("LINE group join greets members while verification codes remain requestable", () => {
  const first = bigeLineGroupVerificationCode("C1234567890");
  assert.equal(first, bigeLineGroupVerificationCode("C1234567890"));
  assert.notEqual(first, bigeLineGroupVerificationCode("C0987654321"));
  assert.match(first, /^[A-F0-9]{8}$/);
  assert.equal(formatBigeLineGroupVerificationCode(first), `BG-${first}`);
  assert.equal(isBigeLineGroupVerificationCodeRequest("驗證碼"), true);
  assert.equal(isBigeLineGroupVerificationCodeRequest("@BIG E小幫手 群組驗證碼"), true);
  assert.equal(isBigeLineGroupVerificationCodeRequest("今天要上課嗎"), false);

  const greeting = buildBigeLineGroupVerificationMessage({
    verificationCode: first,
    joined: true,
  });
  assert.equal(
    greeting,
    "嗨嗨大家好～我是 BIG E 小幫手小薇👋✨\n很開心加入群組！之後會在這裡貼心送上課程通知與提醒，一起開心運動吧 💪",
  );
  assert.doesNotMatch(greeting, /驗證碼|櫃台|BG-/);

  const verificationMessage = buildBigeLineGroupVerificationMessage({
    verificationCode: first,
  });
  assert.match(verificationMessage, new RegExp(`BG-${first}`));
  assert.match(verificationMessage, /櫃台/);
  assert.doesNotMatch(verificationMessage, /教練/);
});

test("walk-in payment requires an auditable operation and positive tender entries", () => {
  assert.equal(
    recordWalkInPaymentSchema.safeParse({
      action: "record_walk_in_payment",
      memberId: "00000000-0000-4000-8000-000000000091",
      contractId: "00000000-0000-4000-8000-000000000092",
      businessDate: "2026-08-03",
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
      businessDate: "2026-08-03",
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
    "supabase/migrations/20260830211002_add_shared_line_group_members.sql",
    "utf8",
  );
  assert.match(route, /input\.action === "set_member_line_group_binding"/);
  assert.match(route, /bige_set_member_line_group_binding_v2/);
  assert.match(component, /aria-label="學員 LINE 群組設定"/);
  assert.match(component, /群組名稱只作提示，不會依學員姓名自動配對/);
  assert.match(component, /同一群組可綁多位會員/);
  assert.match(component, /BG 驗證碼/);
  assert.match(
    component,
    /<select[\s\S]{0,120}className=\{styles\.select\}[\s\S]{0,160}aria-label="選擇這位學員的 LINE 群組"/,
  );
  assert.match(component, /lineGroupVerificationLabel/);
  assert.match(component, /activeMemberLineBinding[\s\S]*inactiveMemberLineBinding/);
  assert.match(migration, /replacement_primary_member_id/);
  assert.match(migration, /bige_member_line_group_bound/);
  assert.match(migration, /'bindingSource', 'member_profile'/);
  assert.match(migration, /revoke all on function public\.bige_set_member_line_group_binding_v2/);
});

test("shared LINE groups route several members while each snapshot remains member-specific", () => {
  const line = readFileSync("lib/bige-line-schedule.ts", "utf8");
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260830211002_add_shared_line_group_members.sql",
    "utf8",
  );
  const indexMigration = readFileSync(
    "supabase/migrations/20260830213831_index_shared_line_group_members_created_by.sql",
    "utf8",
  );
  const deliveryMigration = readFileSync(
    "supabase/migrations/20260831112558_fix_shared_line_group_delivery.sql",
    "utf8",
  );
  const deliveryRegression = readFileSync(
    "tests/bige_shared_line_group_delivery.sql",
    "utf8",
  );
  const memberNameCorrection = readFileSync(
    "supabase/migrations/20260831130904_correct_shared_member_names.sql",
    "utf8",
  );

  assert.match(migration, /create table public\.bige_line_group_binding_members/);
  assert.match(migration, /primary key \(binding_id, member_id\)/);
  assert.match(migration, /unique \(tenant_id, member_id\)/);
  assert.doesNotMatch(migration, /unique \(tenant_id, binding_id\)/);
  assert.match(migration, /where binding\.member_id is not null[\s\S]{0,80}binding\.status = 'active'/);
  assert.match(migration, /bige_sync_line_group_primary_member_trigger/);
  assert.match(migration, /alter table public\.bige_line_group_binding_members enable row level security/);
  assert.match(migration, /revoke all on table public\.bige_line_group_binding_members[\s\S]{0,80}authenticated/);
  assert.match(
    indexMigration,
    /bige_line_group_binding_members_created_by_idx[\s\S]*\(created_by\)/,
  );
  assert.match(deliveryMigration, /join public\.bige_line_group_binding_members link/);
  assert.match(deliveryMigration, /link\.member_id = p_member_id/);
  assert.doesNotMatch(deliveryMigration, /binding\.member_id = p_member_id/);
  assert.match(deliveryRegression, /participant_a_id[\s\S]*participant_b_id/);
  assert.match(deliveryRegression, /count\(distinct notification\.member_id\)/);
  assert.match(deliveryRegression, /line_group_binding_inactive/);
  assert.match(deliveryRegression, /rollback;/);
  assert.match(memberNameCorrection, /'謝筱萱'/);
  assert.match(memberNameCorrection, /'蘇宥溱'/);
  assert.match(memberNameCorrection, /'蔡欣妤'/);
  assert.match(memberNameCorrection, /shared_member_name_correction_precondition_failed/);
  assert.match(memberNameCorrection, /shared_member_name_correction_verification_failed/);

  assert.match(line, /resolveActiveBigeLineGroupBinding/);
  assert.match(line, /\.from\("bige_line_group_binding_members"\)/);
  assert.match(line, /\.eq\("member_id", params\.memberId\)/);
  assert.match(line, /\.eq\("member_id", params\.memberId\)[\s\S]{0,240}\.eq\("is_bige_schedule", true\)/);
  assert.match(route, /resolveActiveBigeLineGroupBinding/);
  assert.match(route, /\.from\("bige_line_group_binding_members"\)[\s\S]{0,120}\.select\("binding_id, member_id"\)/);
  assert.match(route, /member_ids: Array\.from\(memberIds\)/);
  assert.match(component, /lineGroupBindingHasMember/);
  assert.match(component, /每則通知仍只列該會員自己的課表/);
});

test("shared secondary members resolve the physical group before the legacy primary fallback", async () => {
  const shared = fakeLineBindingSupabase({
    bige_line_group_binding_members: [{ data: { binding_id: "shared-binding" }, error: null }],
    bige_line_group_bindings: [
      { data: { id: "shared-binding", line_group_id: "line-group-1" }, error: null },
    ],
  });
  assert.deepEqual(
    await resolveActiveBigeLineGroupBinding({
      supabase: shared as never,
      tenantId: "tenant-1",
      memberId: "secondary-member",
    }),
    {
      data: { id: "shared-binding", line_group_id: "line-group-1" },
      error: null,
    },
  );

  const legacy = fakeLineBindingSupabase({
    bige_line_group_binding_members: [{ data: null, error: null }],
    bige_line_group_bindings: [
      { data: { id: "legacy-binding", line_group_id: "line-group-2" }, error: null },
    ],
  });
  assert.deepEqual(
    await resolveActiveBigeLineGroupBinding({
      supabase: legacy as never,
      tenantId: "tenant-1",
      memberId: "primary-member",
    }),
    {
      data: { id: "legacy-binding", line_group_id: "line-group-2" },
      error: null,
    },
  );
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

test("successfully sent LINE schedule messages also appear as member announcements", () => {
  const route = readFileSync("app/api/member/notifications/route.ts", "utf8");
  const page = readFileSync("app/member/notifications/page.tsx", "utf8");
  assert.match(route, /createSupabaseAdminClient/);
  assert.match(route, /\.from\("bige_line_schedule_notifications"\)/);
  assert.match(route, /\.eq\("tenant_id", tenantId\)[\s\S]{0,160}\.eq\("member_id", memberId\)[\s\S]{0,160}\.eq\("status", "sent"\)/);
  assert.match(route, /id: `announcement:\$\{announcement\.id\}`/);
  assert.match(route, /message: String\(announcement\.message\)/);
  assert.match(page, /type: "announcement"/);
  assert.match(page, /setTypeFilter\("announcement"\)/);
  assert.match(page, /whiteSpace: "pre-wrap"/);
});

test("LINE failures are visible without joining the protected daily-board prefetch", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const line = readFileSync("lib/bige-line-schedule.ts", "utf8");
  assert.match(route, /lineScheduleNotificationIssues/);
  assert.match(route, /input\.action === "retry_line_schedule_notification"/);
  assert.match(route, /status !== "failed"/);
  assert.match(component, /setDialog\("line-notifications"\)/);
  assert.match(component, /重新發送目前課表/);
  assert.match(component, /5 分鐘、15 分鐘、1 小時、6 小時/);
  assert.doesNotMatch(component, /requestBoard[\s\S]{0,1200}lineScheduleNotificationIssues/);
  assert.match(line, /\["coach_assistant_manager", "coach_manager"\]/);
  assert.match(line, /eventType: "bige_line_schedule_delivery_failed"/);
  assert.match(line, /inAppOnly: true/);
  assert.match(line, /bige-line-schedule-failure:\$\{params\.notificationId\}/);
});

test("LINE webhook stores and replies with a same-name-safe group verification code", () => {
  const webhook = readFileSync("app/api/line/student-schedule/webhook/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260824222613_add_bige_line_group_verification_and_optional_contract_binding.sql",
    "utf8",
  );
  assert.match(webhook, /verification_code: verificationCode/);
  assert.match(webhook, /existing\.data[\s\S]{0,180}\.update\(bindingUpdate\)/);
  assert.match(webhook, /\.insert\(\{[\s\S]{0,220}status: "pending"/);
  assert.doesNotMatch(webhook, /\.upsert\(/);
  assert.match(webhook, /\/v2\/bot\/message\/reply/);
  assert.match(webhook, /event\.type === "join" \|\| verificationRequested/);
  assert.match(webhook, /isBigeLineGroupVerificationCodeRequest/);
  assert.match(migration, /verification_code ~ '\^\[A-F0-9\]\{8\}\$'/);
  assert.match(migration, /bige_line_group_bindings_verification_code_idx/);
  assert.match(migration, /bige_line_group_verification_code_trigger/);
  assert.match(migration, /before insert or update of line_group_id, verification_code/);
});

test("contract binding is optional only in the audited test-mode RPCs", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260824222613_add_bige_line_group_verification_and_optional_contract_binding.sql",
    "utf8",
  );
  assert.match(route, /bige_create_member_contract_v8/);
  assert.match(route, /bige_create_bb_member_contract_v3/);
  assert.match(route, /p_line_binding_id: input\.lineGroupBindingId \|\| null/);
  assert.match(component, /lineGroupBindingId: contractDraft\.lineGroupBindingId \|\| null/);
  assert.match(component, /測試期間可稍後綁定/);
  assert.match(component, /建立正式課程前仍必須完成綁定/);
  assert.match(migration, /bige_contract_created_without_line_group/);
  assert.match(migration, /line_binding_test_mode/);
  assert.match(migration, /lineBindingDeferred/);
  assert.match(migration, /return public\.bige_create_member_contract_v7/);
  assert.match(migration, /return public\.bige_create_bb_member_contract_v2/);
});

test("walk-in dashboard follows the selected date outside the protected date prefetch window", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  assert.match(route, /searchParams\.get\("operations"\) === "1"/);
  assert.match(component, /operations=1&date=\$\{encodeURIComponent\(targetDate\)\}/);
  assert.match(route, /loadBigeOperationsDashboard\(tenantId, auth\.context, businessDate\)/);
  assert.match(route, /\.eq\("business_date", businessDate\)/);
  assert.doesNotMatch(component, /requestBoard[\s\S]{0,1200}operations=1/);
  assert.ok(component.indexOf("styles.walkInPaymentButton") < component.indexOf("styles.frontdeskStatus"));
  assert.match(route, /walkInPaymentTotal: walkInPayments\.reduce/);
  assert.match(component, /本日現場收款總額 \$\{formatMoney\(data\.walkInPaymentTotal \|\| 0\)\}/);
  assert.match(component, /formatMoney\(data\.walkInPaymentTotal \|\| 0\)/);
});

test("walk-in payment writes the date selected when the payment dialog opened", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  assert.equal(
    recordWalkInPaymentSchema.safeParse({
      action: "record_walk_in_payment",
      memberId: "00000000-0000-4000-8000-000000000091",
      contractId: "00000000-0000-4000-8000-000000000092",
      paymentKind: "balance",
      payments: [{ amount: 3000, method: "cash", installmentCount: null }],
      idempotencyKey: "walk-in-test-0002",
    }).success,
    false,
  );
  assert.match(component, /const businessDate = boardDateRef\.current/);
  assert.match(component, /businessDate: studentPaymentContext\.businessDate/);
  assert.match(component, /studentPaymentContext\?\.source === "walk_in"[\s\S]{0,120}\? studentPaymentContext\.businessDate/);
  assert.match(route, /p_paid_at: `\$\{input\.businessDate\}T12:00:00\+08:00`/);
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
