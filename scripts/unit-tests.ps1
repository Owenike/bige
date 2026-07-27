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
  tests/member-progress-events.test.ts `
  tests/member-progress-feedback.test.ts `
  tests/notification-productization.test.ts `
  tests/staff-credentials.test.ts `
  tests/staff-organization.test.ts `
  tests/student-membership-period.test.ts `
  tests/student-phone.test.ts `
  lib/member-progress-events.ts `
  lib/member-progress-feedback.ts `
  lib/notification-productization.ts `
  lib/notification-retry-policy.ts `
  lib/notification-alert-workflow.ts `
  lib/staff-credentials.ts `
  lib/staff-organization.ts `
  lib/student-membership-period.ts `
  lib/student-phone.ts

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

node --test `
  "$outDir/tests/member-progress-events.test.js" `
  "$outDir/tests/member-progress-feedback.test.js" `
  "$outDir/tests/notification-productization.test.js" `
  "$outDir/tests/staff-credentials.test.js" `
  "$outDir/tests/staff-organization.test.js" `
  "$outDir/tests/student-membership-period.test.js" `
  "$outDir/tests/student-phone.test.js"

exit $LASTEXITCODE
