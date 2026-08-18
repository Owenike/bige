$ErrorActionPreference = "Stop"

$outDir = ".tmp/unit-tests"
if (Test-Path $outDir) {
  Remove-Item -Path $outDir -Recurse -Force
}

npx tsc `
  --pretty false `
  --module commonjs `
  --target es2020 `
  --moduleResolution node `
  --esModuleInterop `
  --skipLibCheck `
  --outDir $outDir `
  tests/auth-capabilities.test.ts `
  tests/bige-member-search.test.ts `
  tests/bige-fitness-schedule.test.ts `
  tests/bige-course-status-window.test.ts `
  tests/bige-coach-order.test.ts `
  tests/bige-schedule-drag.test.ts `
  tests/bige-schedule-permissions.test.ts `
  tests/giveme-invoice.test.ts `
  tests/line-push.test.ts `
  tests/member-progress-events.test.ts `
  tests/member-progress-feedback.test.ts `
  tests/notification-productization.test.ts `
  tests/notify-integration.test.ts `
  tests/resend-delivery-diagnostics.test.ts `
  tests/permission-model.test.ts `
  tests/staff-activation.test.ts `
  tests/staff-credentials.test.ts `
  tests/staff-organization.test.ts `
  tests/staff-scheduling.test.ts `
  tests/staff-attendance.test.ts `
  tests/staff-payroll.test.ts `
  tests/staff-performance-settlement.test.ts `
  tests/staff-performance-workflow.test.ts `
  tests/student-membership-period.test.ts `
  tests/student-password-recovery-url.test.ts `
  tests/student-checkin-entry.test.ts `
  tests/student-entry-access.test.ts `
  tests/student-drop-in-plan.test.ts `
  tests/student-drop-in-registration.test.ts `
  tests/system-audit.test.ts `
  tests/user-facing-error.test.ts `
  tests/student-phone.test.ts `
  tests/trial-booking-contact.test.ts `
  tests/trial-booking-fa-history.test.ts `
  tests/trial-booking-coaches.test.ts `
  tests/trial-booking-filters.test.ts `
  tests/trial-booking-schedule-note.test.ts `
  tests/trial-booking-staff-note.test.ts `
  tests/trial-booking-sources.test.ts `
  lib/member-progress-events.ts `
  lib/bige-member-search.ts `
  lib/bige-fitness.ts `
  lib/bige-course-status-window.ts `
  lib/bige-coach-order.ts `
  lib/bige-schedule-drag.ts `
  lib/bige-schedule-permissions.ts `
  lib/integrations/giveme-invoice.ts `
  lib/auth-capabilities.ts `
  lib/member-progress-feedback.ts `
  lib/notification-productization.ts `
  lib/notification-retry-policy.ts `
  lib/notification-alert-workflow.ts `
  lib/integrations/notify.ts `
  lib/line-push.ts `
  lib/permissions.ts `
  lib/role-permissions.ts `
  lib/staff-activation.ts `
  lib/staff-credentials.ts `
  lib/staff-organization.ts `
  lib/staff-operation-permissions.ts `
  lib/staff-scheduling.ts `
  lib/staff-attendance.ts `
  lib/staff-payroll.ts `
  lib/staff-performance.ts `
  lib/staff-performance-settlement.ts `
  lib/student-membership-period.ts `
  lib/recovery-url.ts `
  lib/student-checkin-entry.ts `
  lib/student-entry-access.ts `
  lib/student-drop-in-plan.ts `
  lib/student-drop-in-registration.ts `
  lib/system-audit.ts `
  lib/user-facing-error.ts `
  lib/student-phone.ts `
  lib/trial-booking-contact.ts `
  lib/trial-booking-fa-history.ts `
  lib/trial-booking-coaches.ts `
  lib/trial-booking-filters.ts `
  lib/trial-booking-schedule-note.ts `
  lib/trial-booking-staff-note.ts `
  lib/trial-booking-sources.ts

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$testFiles = Get-ChildItem -LiteralPath "$outDir/tests" -Filter "*.test.js" |
  Sort-Object FullName

foreach ($testFile in $testFiles) {
  node $testFile.FullName
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

exit 0
