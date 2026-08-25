import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("app/api/staff-performance/route.ts", "utf8");
const dashboard = readFileSync("components/staff-performance-dashboard.tsx", "utf8");
const managerPage = readFileSync("app/manager/staff-performance/page.tsx", "utf8");
const performanceRead = readFileSync("lib/staff-performance-read.ts", "utf8");
const performanceSync = readFileSync("lib/staff-performance-sync.ts", "utf8");
const dashboardStyles = readFileSync("app/staff/performance/page.module.css", "utf8");
const payrollRoute = readFileSync("app/api/staff-payroll/route.ts", "utf8");
const contractRoute = readFileSync("app/api/bige-fitness/route.ts", "utf8");
const trialBookingRoute = readFileSync("app/api/admin/trial-bookings/route.ts", "utf8");
const trialScheduleRoute = readFileSync("app/api/admin/trial-bookings/[id]/schedule/route.ts", "utf8");
const trialTenantMigration = readFileSync(
  "supabase/migrations/20260821123000_add_trial_booking_tenant_attribution.sql",
  "utf8",
);
const originDateMigration = readFileSync(
  "supabase/migrations/20260822092929_align_fa_bb_sales_with_origin_booking_date.sql",
  "utf8",
);
const staleDailyTopMigration = readFileSync(
  "supabase/migrations/20260822093355_clear_stale_daily_top_after_sales_date_alignment.sql",
  "utf8",
);
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

test("manager settlement workbench keeps the daily flow visible and moves sales work into one large dialog", () => {
  assert.match(dashboard, /今日工作台/);
  assert.match(dashboard, /查看其他日期/);
  assert.match(dashboard, /openMonthOverview/);
  assert.match(dashboard, /setActiveModal\("dates"\)/);
  assert.match(dashboard, /setActiveModal\("epo"\)/);
  assert.match(dashboard, /openSalesWorkspace/);
  assert.match(dashboard, /role="dialog"/);
  assert.match(dashboard, /aria-modal="true"/);
  assert.match(dashboard, /mobileSettlementBar/);
  assert.match(dashboard, /儲存分配/);
  assert.match(dashboard, /taskList/);
  assert.match(dashboard, /salesWorkspace/);
  assert.match(dashboard, /salesQueueTabs/);
  assert.match(dashboardStyles, /\.modalFooter[\s\S]*border-top/);
  assert.match(dashboardStyles, /\.salesModal \{[^}]*1380px[^}]*90vh/);
  assert.match(dashboardStyles, /\.mobileSettlementBar[\s\S]*position:\s*fixed/);
  assert.doesNotMatch(dashboard, /id="sales-tasks"/);
  assert.doesNotMatch(dashboard, /className=\{`\$\{styles\.panel\} \$\{styles\.salesPanel\}`\}/);
  assert.doesNotMatch(dashboard, /completedGroup/);
  assert.doesNotMatch(dashboard, /className=\{styles\.readinessCard\}/);
  assert.doesNotMatch(dashboard, /className=\{styles\.coachGrid\}/);
  assert.doesNotMatch(dashboard, /className=\{styles\.tableWrap\}/);
});

test("manager daily close shares the schedule black-and-gold visual language without changing the staff view", () => {
  assert.match(dashboard, /const pageClassName = `\$\{styles\.page\} \$\{managerMode \? styles\.managerPage : ""\}`\.trim\(\)/);
  assert.match(dashboardStyles, /\.managerPage \{[\s\S]*--settlement-gold: #d8b669/);
  assert.match(dashboardStyles, /\.managerPage \{[\s\S]*linear-gradient\(145deg, #04070c 0%, #0a101a 48%, #05080f 100%\)/);
  assert.match(dashboardStyles, /\.managerPage \.primary,[\s\S]*linear-gradient\(135deg, #f6e4af 0%, #d9b45e 55%, #b98432 100%\)/);
  assert.match(dashboardStyles, /\.managerPage \.modal \{[\s\S]*rgba\(8, 13, 21, \.98\)/);
  assert.match(dashboardStyles, /\.managerPage \.mobileSettlementBar \{[\s\S]*rgba\(7, 13, 22, \.96\)/);
});

test("manager daily close refines action hierarchy, workflow focus, summaries, and coach scanning", () => {
  assert.match(dashboard, /const activeTaskStep = reportConfirmed/);
  assert.match(dashboard, /aria-current=\{activeTaskStep === 2 \? "step" : undefined\}/);
  assert.match(dashboard, /salesTaskCount \? styles\.taskPrimaryAction : styles\.taskSecondaryAction/);
  assert.match(dashboard, /epoTaskCount \? styles\.taskPrimaryAction : styles\.taskSecondaryAction/);
  assert.match(dashboard, /coach\.salesAmount > 0 \? styles\.salesPositive : coach\.salesAmount === 0 \? styles\.zeroMetric/);
  assert.match(dashboardStyles, /\.managerPage \.summaryGrid article::before/);
  assert.match(dashboardStyles, /\.managerPage \.taskList \.taskCurrent \{[\s\S]*0 0 28px rgba\(213, 169, 72, \.11\)/);
  assert.match(dashboardStyles, /\.managerPage \.taskList article > \.taskPrimaryAction \{[\s\S]*linear-gradient\(135deg, #f6e4af 0%, #d9b45e 55%, #b98432 100%\)/);
  assert.match(dashboardStyles, /\.managerPage \.zeroMetric > strong/);
  assert.match(dashboardStyles, /\.managerPage \.salesPositive > strong/);
});

test("manager workbench presents EPO rules inside the EPO decision dialog", () => {
  assert.match(dashboard, /showEpoRules \? "收起規則" : "EPO 規則"/);
  assert.match(dashboard, /activeModal === "epo" \? <div className=\{styles\.epoModalHeaderActions\}>/);
  assert.match(dashboard, /aria-controls="epo-rules-panel"/);
  assert.match(dashboard, /showEpoRules \? <div id="epo-rules-panel"/);
  assert.doesNotMatch(dashboard, /setActiveModal\("epoRules"\)/);
  assert.match(dashboard, /每日數字最高/);
  assert.match(dashboard, /上班時間內滿 <b>6 堂<\/b>，且上班時間外再滿 <b>2 堂<\/b>/);
  assert.match(dashboard, /上班時間內滿 <b>3 堂<\/b>，且上班時間外再滿 <b>1 堂<\/b>/);
  assert.match(dashboard, /自第 <b>6 張證照<\/b>起/);
  assert.match(dashboard, /成交 <b>72 堂以上<\/b>/);
  assert.match(dashboard, /成交 <b>48 堂以上<\/b>/);
  assert.match(dashboard, /須有明確的主管級 To 紀錄才列入計算/);
  assert.match(dashboardStyles, /\.epoRuleGrid \{[^}]*repeat\(2/);
  assert.match(dashboardStyles, /@media \(max-width: 780px\)[\s\S]*\.epoRuleGrid \{ grid-template-columns: 1fr; \}/);
});

test("manager dashboard does not expose manual performance entry controls", () => {
  assert.match(route, /body\.action === "create_manual_event"/);
  assert.match(route, /z\.coerce\.number\(\)\.positive\(\)/);
  assert.match(route, /permission: "approve_sales_performance"/);
  assert.doesNotMatch(dashboard, /補登業績/);
  assert.doesNotMatch(dashboard, /manual-event-form/);
  assert.doesNotMatch(dashboard, /setActiveModal\("manual"\)/);
  assert.doesNotMatch(dashboardStyles, /\.manualModal/);
});

test("coach overview explicitly labels its figures as selected-month totals", () => {
  assert.match(dashboard, /monthLabel\(overviewMonth\)/);
  assert.match(dashboard, /id="overview-month" type="month"/);
  assert.match(dashboard, /monthOverview\.coaches\.map/);
  assert.match(dashboard, /本月業績/);
  assert.match(dashboard, /本月 EPO/);
  assert.match(dashboard, /本月已完課/);
  assert.match(dashboard, /本月堂費級距/);
  assert.match(dashboardStyles, /\.monthOverviewToolbar/);
  assert.doesNotMatch(dashboard, /<dt>目前業績<\/dt>/);
  assert.doesNotMatch(dashboard, /<dt>目前 EPO<\/dt>/);
});

test("manager daily view defaults to the requested day and keeps history browsing separate", () => {
  assert.match(dashboard, /requestedDate/);
  assert.match(dashboard, /openDateBrowser/);
  assert.match(dashboard, /setHistoryDate\(date\)/);
  assert.match(dashboard, /historyData\?\.selectedDate === historyDate/);
  assert.match(dashboard, /進入該日日結/);
  assert.match(dashboard, /回到今天/);
  assert.match(dashboardStyles, /\.page \.historyReturn \{[^}]*color: #fff;[^}]*background: rgba\(255,255,255,\.08\)/);
  assert.match(dashboardStyles, /\.page \.historyReturn:hover:not\(:disabled\) \{[^}]*color: #fff;[^}]*background: rgba\(255,255,255,\.16\)/);
  assert.match(dashboard, /window\.history\.replaceState/);
  assert.doesNotMatch(dashboard, /副理可完成初審並送出/);
});

test("daily workbench withholds stale payment and EPO figures until source reconciliation finishes", () => {
  assert.match(route, /body\.action === "refresh_sources"/);
  assert.match(route, /if \(!actorPermissions\.canManage\) throw new Error\("您沒有同步業績與 EPO 的權限"\)/);
  assert.match(route, /\[staff-performance\] sources refreshed/);
  assert.match(route, /sourceSyncMs/);
  assert.match(performanceRead, /const \[actor, coaches\] = await Promise\.all/);
  assert.match(performanceRead, /resolveStaffPermissions/);
  assert.match(performanceRead, /scope === "daily" \? selectedDate : range\.start/);
  assert.match(managerPage, /getStaffPerformanceState\([\s\S]*"daily"/);
  assert.match(managerPage, /initialData=\{initialData\}/);
  assert.match(dashboard, /initialData\?\.month === month && initialData\.selectedDate === date/);
  assert.match(dashboard, /scope=\$\{managerMode \? "daily" : "month"\}/);
  assert.match(dashboard, /scope=daily/);
  assert.match(dashboard, /scope=month/);
  assert.match(dashboard, /action: "refresh_sources"/);
  assert.match(dashboard, /setLoading\(false\);[\s\S]*void refreshSources\(initialData, viewKey\)/);
  assert.match(dashboard, /今日工作台讀取超過 8 秒，請重試/);
  assert.match(dashboard, /const \[refreshing, setRefreshing\] = useState\(Boolean\(initialData\?\.actor\.canManage\)\)/);
  assert.match(dashboard, /const sourceDataReady = viewDataReady && !refreshing && !refreshError/);
  assert.match(dashboard, /完成前不顯示業績與 EPO 數字/);
  assert.match(dashboard, /暫不顯示舊數字/);
  assert.match(dashboard, /請重試後再處理業績或結算/);
  assert.match(dashboard, /disabled=\{busy \|\| Boolean\(blockReason\)\}/);
  assert.match(route, /body\.action === "prepare_day"[\s\S]*syncBigePaymentPerformanceSources[\s\S]*syncAutomaticEpoForDate/);
  assert.match(route, /body\.action === "confirm_day"[\s\S]*syncBigePaymentPerformanceSources[\s\S]*syncAutomaticEpoForDate/);
  assert.match(dashboard, /重新讀取/);
});

test("FA and BB sales follow their originating appointment date without moving confirmed settlements", () => {
  assert.match(performanceSync, /resolveSalesPerformanceOccurrence/);
  assert.match(performanceSync, /\.in\("operation_kind", \["trial", "bb"\]\)/);
  assert.match(performanceSync, /\.gte\("starts_at", range\.startIso\)/);
  assert.match(performanceSync, /originBookingStartsAt: originBooking\?\.starts_at \|\| null/);
  assert.match(performanceSync, /params\.sourceType === "fa" \|\| params\.sourceType === "bb"/);
  assert.match(performanceSync, /row\.status === "daily_confirmed"/);
  assert.match(performanceSync, /business_date: confirmed\.business_date/);
  assert.match(originDateMigration, /event\.source_type in \('fa', 'bb'\)/);
  assert.match(originDateMigration, /event\.status <> 'daily_confirmed'/);
  assert.match(originDateMigration, /origin_booking\.starts_at at time zone 'Asia\/Taipei'/);
  assert.match(staleDailyTopMigration, /award\.status <> 'daily_confirmed'/);
  assert.match(staleDailyTopMigration, /current_event\.origin_employee_id is not null/);
  assert.match(staleDailyTopMigration, /active_award_id = null/);
});

test("daily workbench presents one four-step flow and a consolidated allocation summary", () => {
  assert.match(dashboard, /<p className=\{styles\.eyebrow\}>本日流程<\/p>/);
  assert.match(dashboard, />課程狀態</);
  assert.match(dashboard, />業績分配</);
  assert.match(dashboard, />EPO 判定</);
  assert.match(dashboard, /data\.actor\.canConfirm \? "正式結算" : "送交覆核"/);
  assert.match(dashboard, /完成剩餘 \$\{settlementAttentionCount\} 項後/);
  assert.match(dashboard, /課程 \$\{pendingCourseCount\} · 業績 \$\{salesTaskCount\} · EPO \$\{epoTaskCount\}/);
  assert.match(dashboard, /實收淨額/);
  assert.match(dashboard, />已分配</);
  assert.match(dashboard, />尚未分配</);
  assert.match(dashboard, />待分配 \{money\(remaining\)\}</);
  assert.match(dashboard, /`尚有 \$\{money\(selectedRemaining\)\} 待分配`/);
  assert.doesNotMatch(dashboard, />尚差 \{money\(remaining\)\}</);
  assert.match(dashboard, /<progress max="100" value=\{allocationProgress\}/);
  assert.match(dashboardStyles, /\.taskList \{[^}]*repeat\(4/);
  assert.match(dashboardStyles, /\.salesProgressSummary/);
  assert.match(dashboardStyles, /@media \(max-width: 780px\)[\s\S]*\.taskList \{ grid-template-columns: 1fr; \}/);
});

test("sales workspace supports queue navigation, in-place allocation, manager review, and responsive full-screen use", () => {
  assert.match(dashboard, /const \[salesListMode, setSalesListMode\] = useState<SalesListMode>\("pending"\)/);
  assert.match(dashboard, /待處理 <b>\{actionableSalesEvents\.length\}<\/b>/);
  assert.match(dashboard, /已完成／待覆核 <b>\{completedSalesEvents\.length\}<\/b>/);
  assert.match(dashboard, /selectSalesEvent\(firstEvent, hasPending\)/);
  assert.match(dashboard, /儲存並處理下一筆/);
  assert.match(dashboard, /advanceSalesWorkspace\(event\.id\)/);
  assert.match(dashboard, /reviewEvent\(selectedEvent\.id, "approve"\)/);
  assert.match(dashboard, /目前分配內容尚未儲存，確定切換到其他業績/);
  assert.match(dashboard, /退款分配已鎖定/);
  assert.match(dashboardStyles, /\.salesWorkspaceGrid \{[^}]*grid-template-columns/);
  assert.match(dashboardStyles, /@media \(max-width: 780px\)[\s\S]*\.salesModal \{[^}]*100dvh/);
  assert.match(dashboardStyles, /@media \(max-width: 780px\)[\s\S]*\.salesWorkspaceGrid \{[^}]*grid-template-columns: 1fr/);
});

test("monthly overview labels unsettled projections in operational language", () => {
  assert.match(dashboard, /含未結算業績／EPO/);
  assert.match(dashboard, /已正式結算/);
  assert.doesNotMatch(dashboard, /含待確認資料/);
});

test("daily settlement follows daily-board duty markers and lists each working coach's lessons and sales", () => {
  assert.match(performanceRead, /collectCoachDayStatuses/);
  assert.match(performanceRead, /from\("bige_schedule_notes"\)[\s\S]*select\("coach_id, content"\)/);
  assert.match(performanceRead, /status !== "off"/);
  assert.match(performanceRead, /select\("id, coach_id, operation_kind, status, operation_result, course_type, trial_stage, trial_conversion_outcome, bb_conversion_outcome, converted_at, trial_booking_id, starts_at"\)/);
  assert.match(performanceRead, /dailyCoachSummaries/);
  assert.match(performanceRead, /\["pt", "trial"\]\.includes/);
  assert.match(performanceRead, /salesNeedsConfirmation/);
  assert.match(dashboard, /今日上班教練/);
  assert.doesNotMatch(dashboard, /休假不列入/);
  assert.match(dashboard, /完成／排課（堂）/);
  assert.match(dashboard, /當日業績/);
  assert.match(dashboard, /沒有教練上班/);
  assert.doesNotMatch(dashboard, /日排課表上班/);
  assert.doesNotMatch(dashboard, /本日沒有分配業績/);
  assert.doesNotMatch(dashboard, /完成：正式 PT/);
  assert.match(dashboardStyles, /\.dailyCoachList/);
  assert.match(dashboardStyles, /\.dailyCoachTableHeader/);
});

test("daily and monthly summaries show exact PT, FA, appointment, and BB figures without an invented other course", () => {
  assert.match(performanceRead, /formalCourseCounts/);
  assert.match(performanceRead, /faExecutionCounts/);
  assert.match(performanceRead, /successfulFaAppointmentCredits/);
  assert.match(performanceRead, /scheduled_at/);
  assert.match(performanceRead, /from\("trial_bookings"\)[\s\S]*\.eq\("tenant_id", params\.tenantId\)/);
  assert.match(trialBookingRoute, /tenant_id: tenantId[\s\S]*scheduled_at: new Date\(\)\.toISOString\(\)/);
  assert.match(trialScheduleRoute, /tenant_id: tenantId[\s\S]*scheduled_at: existingResult\.data\.scheduled_at \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(trialTenantMigration, /ambiguous rows remain null instead of being guessed/);
  assert.match(performanceRead, /bbVisits/);
  assert.match(performanceRead, /bbConversions/);
  assert.match(dashboard, /正式課完成/);
  assert.match(dashboard, /FA 完成/);
  assert.match(dashboard, /FA 預約成功/);
  assert.match(dashboard, /BB 回訪／成交/);
  assert.match(dashboard, /FA1／FA2 成交率/);
  assert.match(dashboard, /待判定/);
  assert.doesNotMatch(dashboard, /<span>其他<\/span>/);
  assert.match(route, /filter\(\(row\) => \["pt", "trial"\]\.includes\(String\(row\.operation_kind\)\)\)/);
});

test("daily, history, and monthly coach identities show Chinese, English, and configured position", () => {
  const component = readFileSync("components/staff-performance-dashboard.tsx", "utf8");
  const styles = readFileSync("app/staff/performance/page.module.css", "utf8");
  assert.match(component, /\[coach\.display_name, coach\.english_name\]/);
  assert.match(component, /normalizeStaffPosition\(coach\.position\)/);
  assert.match(component, /function CoachIdentityPresentation/);
  assert.match(component, /aria-label=\{coachIdentityLabel\(coach\)\}/);
  assert.match(component, /dailyCoachIdentity[\s\S]*<CoachIdentityPresentation coach=\{coachMap\.get\(coach\.employeeId\)\}/);
  assert.match(component, /coachOverviewTopline[\s\S]*<CoachIdentityPresentation coach=\{coach\}/);
  assert.match(component, /historyCoachList[\s\S]*<CoachIdentityPresentation compact coach=\{historyData\.coaches\.find/);
  assert.match(component, /positionBadgeExecutive/);
  assert.match(component, /positionBadgeSupervisor/);
  assert.match(component, /positionBadgeLead/);
  assert.match(styles, /\.positionBadge, \.shiftBadge \{[^}]*cursor: default;[^}]*user-select: none/);
  assert.match(styles, /\.managerPage \.positionBadgeExecutive \{[\s\S]*linear-gradient\(135deg, #f2dda1, #bd8732\)/);
  assert.match(styles, /\.dailyCoachIdentity strong \{[^}]*overflow-wrap: anywhere/);
  assert.match(styles, /\.coachIdentity strong \{[^}]*overflow-wrap: anywhere/);
});

test("new contracts snapshot the original coach for default allocation and EPO evidence", () => {
  assert.match(contractRoute, /bige_create_member_contract_v8/);
  assert.match(contractRoute, /p_sales_origin_coach_id: trustedSalesOriginCoachId/);
  assert.match(migration, /sales_origin_coach_id uuid references public\.profiles/);
  assert.match(migration, /Immutable source coach snapshot/);
});
