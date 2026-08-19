import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("app/api/staff-performance/route.ts", "utf8");
const dashboard = readFileSync("components/staff-performance-dashboard.tsx", "utf8");
const dashboardStyles = readFileSync("app/staff/performance/page.module.css", "utf8");
const payrollRoute = readFileSync("app/api/staff-payroll/route.ts", "utf8");
const contractRoute = readFileSync("app/api/bige-fitness/route.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260818225608_staff_sales_allocation_epo_settlement.sql",
  "utf8",
);

test("daily settlement uses versioned allocations and one transactional course/performance close", () => {
  assert.match(migration, /create table if not exists public\.staff_sales_allocations/);
  assert.match(migration, /source_allocation_id uuid references public\.staff_sales_allocations/);
  assert.match(migration, /create or replace function public\.staff_save_sales_allocations_v1/);
  assert.match(migration, /create or replace function public\.staff_confirm_daily_settlement_v1/);
  assert.match(migration, /update public\.staff_sales_allocations allocation[\s\S]*status = 'daily_confirmed'/);
  assert.match(migration, /update public\.bige_daily_closures[\s\S]*status = 'confirmed'/);
  assert.match(migration, /revoke all on function public\.staff_confirm_daily_settlement_v1[\s\S]*authenticated/);
  assert.match(route, /admin\.rpc\("staff_confirm_daily_settlement_v1"/);
  assert.match(route, /countLegacyPurchaseDateReminders/);
});

test("refunds remain locked to exact original finalized allocation recipients", () => {
  assert.match(route, /退款只能依原正式分配自動扣回，不可自由改配/);
  assert.match(migration, /target_event\.source_type = 'refund'[\s\S]*refund_allocation_locked/);
  assert.match(migration, /allocation_kind in \('origin_default', 'manual', 'refund_reversal', 'legacy'\)/);
  assert.match(payrollRoute, /from\("staff_sales_allocations"\)[\s\S]*eq\("status", "daily_confirmed"\)/);
});

test("manager and assistant flows expose split allocation, tie choice, preparation, and final settlement", () => {
  assert.match(dashboard, /儲存分配/);
  assert.match(dashboard, /select_daily_top/);
  assert.match(dashboard, /完成初審並送經理/);
  assert.match(dashboard, /正式結算今日課程與業績/);
  assert.match(route, /body\.action === "prepare_day"/);
  assert.match(route, /body\.action === "select_daily_top"/);
});

test("manager settlement workbench keeps primary actions visible and moves secondary detail into dialogs", () => {
  assert.match(dashboard, /今日待處理/);
  assert.match(dashboard, /setActiveModal\("coaches"\)/);
  assert.match(dashboard, /setActiveModal\("epo"\)/);
  assert.match(dashboard, /setActiveModal\("rules"\)/);
  assert.match(dashboard, /role="dialog"/);
  assert.match(dashboard, /aria-modal="true"/);
  assert.match(dashboard, /mobileSettlementBar/);
  assert.match(dashboard, /儲存分配/);
  assert.match(dashboardStyles, /\.modalFooter[\s\S]*border-top/);
  assert.match(dashboardStyles, /\.mobileSettlementBar[\s\S]*position:\s*fixed/);
  assert.doesNotMatch(dashboard, /className=\{styles\.coachGrid\}/);
  assert.doesNotMatch(dashboard, /className=\{styles\.tableWrap\}/);
});

test("coach overview explicitly labels its figures as selected-month totals", () => {
  assert.match(dashboard, /月結數字 · \$\{monthLabel\(month\)\}/);
  assert.match(dashboard, /以下是所選月份的累計數字，不是 \{date\} 單日數字/);
  assert.match(dashboard, /本月業績/);
  assert.match(dashboard, /本月 EPO/);
  assert.match(dashboard, /本月已完課/);
  assert.match(dashboard, /本月堂費級距/);
  assert.match(dashboardStyles, /\.monthScopeNote/);
  assert.doesNotMatch(dashboard, /<dt>目前業績<\/dt>/);
  assert.doesNotMatch(dashboard, /<dt>目前 EPO<\/dt>/);
});

test("daily settlement follows daily-board duty markers and lists each working coach's lessons and sales", () => {
  assert.match(route, /collectCoachDayStatuses/);
  assert.match(route, /from\("bige_schedule_notes"\)[\s\S]*select\("coach_id, content"\)/);
  assert.match(route, /status !== "off"/);
  assert.match(route, /select\("id, coach_id, operation_kind, status, operation_result"\)/);
  assert.match(route, /dailyCoachSummaries/);
  assert.match(route, /\["pt", "trial"\]\.includes/);
  assert.match(route, /salesNeedsConfirmation/);
  assert.match(dashboard, /今日上班教練/);
  assert.match(dashboard, /完成／排課（堂）/);
  assert.match(dashboard, /當日業績/);
  assert.match(dashboard, /沒有教練上班/);
  assert.doesNotMatch(dashboard, /日排課表上班/);
  assert.doesNotMatch(dashboard, /本日沒有分配業績/);
  assert.doesNotMatch(dashboard, /完成：正式 PT/);
  assert.match(dashboardStyles, /\.dailyCoachList/);
  assert.match(dashboardStyles, /\.dailyCoachTableHeader/);
});

test("new contracts snapshot the original coach for default allocation and EPO evidence", () => {
  assert.match(contractRoute, /bige_create_member_contract_v5/);
  assert.match(contractRoute, /p_sales_origin_coach_id: trustedSalesOriginCoachId/);
  assert.match(migration, /sales_origin_coach_id uuid references public\.profiles/);
  assert.match(migration, /Immutable source coach snapshot/);
});
