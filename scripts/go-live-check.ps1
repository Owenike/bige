$ErrorActionPreference = "Stop"

function Header([string]$t) { Write-Host ""; Write-Host ("=== " + $t + " ===") }
function Ok([string]$t) { Write-Host ("[OK]   " + $t) -ForegroundColor Green }
function Warn([string]$t) { Write-Host ("[WARN] " + $t) -ForegroundColor Yellow }
function Fail([string]$t) { Write-Host ("[FAIL] " + $t) -ForegroundColor Red }

Header "Git"
$st = git status -sb 2>$null
if (-not $st) { Fail "git status failed (not a git repo?)"; exit 1 }
$st | ForEach-Object { Write-Host $_ }

if ($st -match "^\#\# .+\[ahead " ) { Warn "You have commits not pushed to origin yet." } else { Ok "No ahead commits (or origin not configured)." }
if ($st -match "^\s*[MADRCU\?]{1,2}\s") { Fail "Working tree not clean (has M/??/etc)." } else { Ok "Working tree clean." }

Header "Node Gate (typecheck/lint/build)"
try { npm run typecheck | Out-Host; Ok "typecheck passed" } catch { Fail "typecheck failed"; throw }
try { npm run lint | Out-Host; Ok "lint passed" } catch { Fail "lint failed"; throw }
try { npm run build | Out-Host; Ok "build passed" } catch { Fail "build failed"; throw }
try { npm run ui:check-cards | Out-Host; Ok "ui:check-cards passed" } catch { Fail "ui:check-cards failed"; throw }
try { npm run test:smoke | Out-Host; Ok "test:smoke passed" } catch { Fail "test:smoke failed"; throw }

Header "Testing and CI Presence"
$testFiles = rg --files | rg "(test|spec|__tests__|playwright|cypress|jest|vitest)" 2>$null
if ($testFiles) { Ok "Test-related files found." } else { Warn "No test-related files found in repo scan." }

if (Test-Path ".github/workflows") {
  $workflowFiles = Get-ChildItem ".github/workflows" -File -ErrorAction SilentlyContinue
  if ($workflowFiles.Count -gt 0) { Ok ("CI workflow files found: " + $workflowFiles.Count) } else { Warn "No CI workflow files found in .github/workflows." }
} else {
  Warn "No .github/workflows directory found."
}

Header "API Auth Guard (routes missing requireProfile)"
$apiRoutes = Get-ChildItem -Recurse -Force -File app/api -Filter route.ts | Select-Object -ExpandProperty FullName
$allowNoRequire = @(
  "app\api\health\route.ts",
  "app\api\payments\newebpay\webhook\route.ts",
  "app\api\auth\login\route.ts",
  "app\api\auth\logout\route.ts",
  "app\api\cron\daily-settlement\route.ts",
  "app\api\cron\expiry-reminders\route.ts"
)

$missing = @()
foreach ($r in $apiRoutes) {
  $rel = $r.Replace((Resolve-Path ".").Path + "\", "")
  $t = Get-Content -Raw -LiteralPath $r
  $hasRequire = ($t -match "requireProfile")
  $isAllowed = $false
  foreach ($a in $allowNoRequire) { if ($rel -ieq $a) { $isAllowed = $true } }
  if (-not $hasRequire -and -not $isAllowed) { $missing += $rel }
}
if ($missing.Count -gt 0) {
  Warn "Routes without requireProfile (review if intended):"
  $missing | Sort-Object | ForEach-Object { Write-Host ("  " + $_) }
} else {
  Ok "All API routes have requireProfile (except allowlist)."
}

Header "Multi-Branch Risk Scan (tenant scoped but no branch/store hint)"
# Heuristic: warn only for routes that appear to serve frontdesk/coach scope
# and mention tenant without branch/store filtering helpers.
$multiBranchWarn = @()
$multiBranchAllow = @(
  "app\api\cron\expiry-reminders\route.ts",
  "app\api\products\route.ts",
  "app\api\services\route.ts"
)
foreach ($r in $apiRoutes) {
  $rel = $r.Replace((Resolve-Path ".").Path + "\", "")
  $t = Get-Content -Raw -LiteralPath $r

  $isAllowListed = $false
  foreach ($a in $multiBranchAllow) { if ($rel -ieq $a) { $isAllowListed = $true } }
  if ($isAllowListed) { continue }

  $isMemberOnly = ($t -match 'requireProfile\(\s*\[\s*"member"\s*\]\s*,')
  if ($isMemberOnly) { continue }

  $isManagerOnly = ($t -match 'requireProfile\(\s*\[\s*"manager"\s*\]\s*,')
  if ($isManagerOnly) { continue }

  $isFrontdeskOrCoachRoute =
    ($t -match '"frontdesk"') -or
    ($t -match '"coach"')
  if (-not $isFrontdeskOrCoachRoute) { continue }

  $mentionsTenant = ($t -match "tenant_id|tenantId|auth\.context\.tenantId")
  $mentionsBranch = ($t -match "branch_id|store_id|branchId|storeId|auth\.context\.branchId")
  $usesHelper = ($t -match "fetchMaybeSingleWithBranchFilter|fetchListWithBranchFilter")

  if ($mentionsTenant -and (-not $mentionsBranch) -and (-not $usesHelper)) {
    $multiBranchWarn += $rel
  }
}
if ($multiBranchWarn.Count -gt 0) {
  Warn "Potential cross-branch leak candidates (needs human review):"
  $multiBranchWarn | Sort-Object | ForEach-Object { Write-Host ("  " + $_) }
} else {
  Ok "No obvious tenant-only API routes found by heuristic."
}

Header "Migrations (RLS / JTI / verify_entry_scan / unique constraints)"
$migDir = "supabase/migrations"
if (-not (Test-Path $migDir)) { Fail "Missing supabase/migrations"; exit 1 }

$migs = Get-ChildItem -Recurse -Force -File $migDir -Filter *.sql | Select-Object -ExpandProperty FullName
Ok ("migrations found: " + $migs.Count)

$rlsHits = rg -n "enable row level security|create policy" -S $migDir 2>$null
if (-not $rlsHits) { Warn "No RLS/policy hits found (unexpected)."; } else { Ok "RLS/policy statements found." }

$jtiUnique = rg -n "create unique index.*checkins.*jti|checkins.*jti.*unique|jti text primary key" -S $migDir 2>$null
if (-not $jtiUnique) { Fail "Missing checkins.jti uniqueness strategy"; } else { Ok "checkins.jti uniqueness strategy found." }

$verifyFn = rg -n "create function.*verify_entry_scan|verify_entry_scan" -S $migDir 2>$null
if (-not $verifyFn) { Fail "Missing verify_entry_scan function in migrations"; } else { Ok "verify_entry_scan found in migrations." }

$redemptionUnique = rg -n "session_redemptions_booking_unique|unique.*booking_id" -S $migDir 2>$null
if (-not $redemptionUnique) { Warn "No booking-level uniqueness detected for redemptions (review)"; } else { Ok "Redemption/booking uniqueness constraint found." }

Header "Entry Verify (anti-passback / RPC / rate limit)"
$verifyRoute = "app/api/entry/verify/route.ts"
if (-not (Test-Path $verifyRoute)) { Fail "Missing $verifyRoute"; exit 1 }

$verifyText = Get-Content -Raw -LiteralPath $verifyRoute
if ($verifyText -match "ANTI_PASSBACK_MINUTES\s*=\s*10") { Ok "ANTI_PASSBACK_MINUTES=10 present" } else { Warn "ANTI_PASSBACK_MINUTES=10 not found (review)" }
if ($verifyText -match 'rpc\("verify_entry_scan"' ) { Ok "verify_entry_scan RPC used" } else { Fail "verify_entry_scan RPC not used (unexpected)" }
if ($verifyText -match "rateLimitFixedWindow") { Ok "rate limiting present in entry/verify" } else { Warn "rate limiting missing in entry/verify (review)" }

Header "Webhook Verify (signature/idempotency hints)"
$webhook = "app/api/payments/newebpay/webhook/route.ts"
if (Test-Path $webhook) {
  $wh = Get-Content -Raw -LiteralPath $webhook
  if ($wh -match "signature|sign|hash|hmac|sha") { Ok "signature verification keywords found" } else { Warn "No signature verification keywords found (review webhook security)" }
  if ($wh -match "idempot|dedup|unique_violation|on conflict|payment_webhooks") { Ok "idempotency/dedup keywords found" } else { Warn "No idempotency/dedup keywords found (review webhook replays)" }
} else {
  Warn "Webhook route not found at expected path (skip)."
}

Header "Proxy/Auth Edge Guard"
$proxyPath = "proxy.ts"
if (-not (Test-Path $proxyPath)) {
  Warn "proxy.ts not found; verify edge auth/role gating strategy manually."
} else {
  $proxyText = Get-Content -Raw -LiteralPath $proxyPath
  if ($proxyText -match "Fail open") {
    Warn "proxy.ts contains fail-open behavior when env is missing. Ensure production env validation blocks startup."
  } else {
    Ok "No explicit fail-open marker found in proxy.ts."
  }
  if ($proxyText -match "getUser\(\)" -and $proxyText -match "profiles" -and $proxyText -match "role") {
    Ok "proxy.ts appears to enforce auth + role checks for protected routes."
  } else {
    Warn "proxy.ts role/auth enforcement markers not fully detected; review manually."
  }
}

Header "Done"
Write-Host "If you see any [FAIL], do not go-live until resolved. For multi-branch, review the WARN lists one-by-one."
