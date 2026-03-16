$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$OutDir = Join-Path $Root ".tmp\deposit-payment-fixtures"
$Tsc = Join-Path $Root "node_modules\typescript\lib\tsc.js"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

node $Tsc `
  --target ES2020 `
  --module commonjs `
  --esModuleInterop `
  --skipLibCheck `
  --outDir $OutDir `
  (Join-Path $Root "scripts\check-deposit-payment-fixtures.ts") `
  (Join-Path $Root "lib\newebpay-deposit-provider.ts")

if ($LASTEXITCODE -ne 0) {
  throw "TypeScript compile failed for deposit payment fixtures."
}

node (Join-Path $OutDir "scripts\check-deposit-payment-fixtures.js")

if ($LASTEXITCODE -ne 0) {
  throw "Deposit payment fixture replay failed."
}
