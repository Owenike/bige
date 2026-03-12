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
  lib/member-progress-events.ts `
  lib/member-progress-feedback.ts `
  lib/notification-productization.ts `
  lib/notification-retry-policy.ts `
  lib/notification-alert-workflow.ts

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

node --test `
  "$outDir/tests/member-progress-events.test.js" `
  "$outDir/tests/member-progress-feedback.test.js" `
  "$outDir/tests/notification-productization.test.js"

exit $LASTEXITCODE
