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
  lib/member-progress-events.ts `
  lib/member-progress-feedback.ts

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

node --test `
  "$outDir/tests/member-progress-events.test.js" `
  "$outDir/tests/member-progress-feedback.test.js"

exit $LASTEXITCODE
