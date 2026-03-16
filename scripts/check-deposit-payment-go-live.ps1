$ErrorActionPreference = "Stop"

function Header([string]$t) { Write-Host ""; Write-Host ("=== " + $t + " ===") }
function Ok([string]$t) { Write-Host ("[OK]   " + $t) -ForegroundColor Green }
function Warn([string]$t) { Write-Host ("[WARN] " + $t) -ForegroundColor Yellow }

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ChecklistDoc = Join-Path $Root "docs\deposit-payment-go-live-checklist.md"
$EvidenceDoc = Join-Path $Root "docs\deposit-payment-live-smoke-evidence-template.md"
$FixtureScript = Join-Path $Root "scripts\check-deposit-payment-fixtures.ps1"
$SampleScript = Join-Path $Root "scripts\check-deposit-payment-samples.ps1"

Header "Deposit Payment Env"
if ($env:NEWEBPAY_CHECKOUT_URL) { Ok "NEWEBPAY_CHECKOUT_URL present" } else { Warn "NEWEBPAY_CHECKOUT_URL missing" }
if ($env:NEWEBPAY_WEBHOOK_URL) { Ok "NEWEBPAY_WEBHOOK_URL present" } else { Warn "NEWEBPAY_WEBHOOK_URL missing" }
if ($env:NEWEBPAY_WEBHOOK_SECRET) { Ok "NEWEBPAY_WEBHOOK_SECRET present" } else { Warn "NEWEBPAY_WEBHOOK_SECRET missing" }

Header "Routes and Scripts"
foreach ($target in @(
  "app\api\payments\newebpay\initiate\route.ts",
  "app\api\payments\newebpay\webhook\route.ts",
  "app\api\bookings\[id]\route.ts",
  "app\manager\bookings\page.tsx",
  "components\booking-detail-drawer.tsx"
)) {
  $targetPath = Join-Path $Root $target
  if (Test-Path -LiteralPath $targetPath) { Ok "$target found" } else { Warn "$target missing" }
}
if (Test-Path $ChecklistDoc) { Ok "deposit payment go-live checklist doc found" } else { Warn "deposit payment go-live checklist doc missing" }
if (Test-Path $EvidenceDoc) { Ok "deposit payment live smoke evidence template found" } else { Warn "deposit payment live smoke evidence template missing" }
if (Test-Path $FixtureScript) { Ok "fixture replay script found" } else { Warn "fixture replay script missing" }
if (Test-Path $SampleScript) { Ok "sample compare script found" } else { Warn "sample compare script missing" }

Header "Booking Deposit Readiness Markers"
$drawer = Get-Content -Raw -LiteralPath (Join-Path $Root "components\booking-detail-drawer.tsx")
if ($drawer -match "Deposit readiness") { Ok "booking detail readiness block present" } else { Warn "booking detail readiness block missing" }
if ($drawer -match "Reusable Pending" -and $drawer -match "Stale Pending" -and $drawer -match "Paid Payment") {
  Ok "payment readiness markers present"
} else {
  Warn "payment readiness markers incomplete"
}
if ($drawer -match "latest action" -and $drawer -match "Webhook audit") {
  Ok "operation evidence markers present"
} else {
  Warn "operation evidence markers incomplete"
}

Header "Smoke Commands"
Write-Host "Local or pre-deploy checks:"
Write-Host "  npm run check:deposit-payment-fixtures"
Write-Host "  npm run check:deposit-payment-samples"
Write-Host "  npm run check:deposit-payment-go-live"
Write-Host ""
Write-Host "Deployment-only smoke steps:"
Write-Host "  Open /manager/bookings and inspect a deposit_pending booking"
Write-Host "  Confirm /api/payments/newebpay/initiate and /api/payments/newebpay/webhook are reachable"
Write-Host "  Replay fixture success/fail/duplicate/regression before live provider callback"
Write-Host "  Fill docs/deposit-payment-live-smoke-evidence-template.md after one real callback"

Write-Host ""
Write-Host "deposit-payment-go-live:ok"
