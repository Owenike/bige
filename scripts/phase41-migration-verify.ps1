$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param([string]$Path)
  if (!(Test-Path -LiteralPath $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "Env:$name" -Value $value
  }
}

function Invoke-SqlScalar {
  param(
    [Parameter(Mandatory = $true)][string]$DbUrl,
    [Parameter(Mandatory = $true)][string]$Sql
  )
  $output = & psql $DbUrl -v ON_ERROR_STOP=1 -t -A -c $Sql
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed for SQL: $Sql"
  }
  return ($output | Out-String).Trim()
}

function Is-TrueValue {
  param([string]$Value)
  $normalized = ($Value | Out-String).Trim().ToLowerInvariant()
  return $normalized -eq "t" -or $normalized -eq "true" -or $normalized -eq "1"
}

$envFile = if ($env:PHASE41_ENV_FILE) { $env:PHASE41_ENV_FILE } elseif (Test-Path ".env.production.current") { ".env.production.current" } elseif (Test-Path ".env.preview.current") { ".env.preview.current" } else { ".env.preview" }
Write-Host "Using env file: $envFile"
Import-DotEnv $envFile
Import-DotEnv ".env.local"

$dbUrl = if ($env:SUPABASE_DB_URL) { $env:SUPABASE_DB_URL } elseif ($env:DATABASE_URL) { $env:DATABASE_URL } else { "" }
if (-not $dbUrl) {
  throw "Missing DB URL. Set SUPABASE_DB_URL or DATABASE_URL."
}

$columnsExpected = @("retry_count", "last_error", "provider_response", "next_retry_at", "sent_at", "delivered_at")
$columnSql = "select array_to_string(array_agg(column_name order by column_name), ',') from information_schema.columns where table_schema='public' and table_name='notification_deliveries' and column_name in ('retry_count','last_error','provider_response','next_retry_at','sent_at','delivered_at');"
$columnsRaw = Invoke-SqlScalar -DbUrl $dbUrl -Sql $columnSql
$columnsFound = @()
if ($columnsRaw) {
  $columnsFound = $columnsRaw.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$tableExists = (Invoke-SqlScalar -DbUrl $dbUrl -Sql "select (to_regclass('public.notification_delivery_events') is not null)::text;")
$rlsEnabled = (Invoke-SqlScalar -DbUrl $dbUrl -Sql "select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relname='notification_delivery_events';")
$policyExists = (Invoke-SqlScalar -DbUrl $dbUrl -Sql "select (count(*) > 0)::text from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relname='notification_delivery_events' and p.polname='notification_delivery_events_access';")
$providerUniqueIndex = (Invoke-SqlScalar -DbUrl $dbUrl -Sql "select (count(*) > 0)::text from pg_indexes where schemaname='public' and tablename='notification_delivery_events' and indexname='notification_delivery_events_provider_event_uidx';")
$deliveryStatusConstraint = (Invoke-SqlScalar -DbUrl $dbUrl -Sql "select coalesce(pg_get_constraintdef(oid), '') from pg_constraint where conname='notification_deliveries_status_check' and conrelid='public.notification_deliveries'::regclass limit 1;")
$deliveryStateIndex = (Invoke-SqlScalar -DbUrl $dbUrl -Sql "select (count(*) > 0)::text from pg_indexes where schemaname='public' and tablename='notification_deliveries' and indexname='notification_deliveries_tenant_channel_status_idx';")
$deliveryDeadLetterIndex = (Invoke-SqlScalar -DbUrl $dbUrl -Sql "select (count(*) > 0)::text from pg_indexes where schemaname='public' and tablename='notification_deliveries' and indexname='notification_deliveries_dead_letter_idx';")

$missingColumns = @()
foreach ($column in $columnsExpected) {
  if (-not ($columnsFound -contains $column)) {
    $missingColumns += $column
  }
}

$result = [pscustomobject]@{
  ok = $true
  checks = [pscustomobject]@{
    deliveryColumnsPresent = ($missingColumns.Count -eq 0)
    notificationDeliveryEventsTable = (Is-TrueValue $tableExists)
    notificationDeliveryEventsRls = (Is-TrueValue $rlsEnabled)
    notificationDeliveryEventsPolicy = (Is-TrueValue $policyExists)
    providerEventUniqueIndex = (Is-TrueValue $providerUniqueIndex)
    deliveryTenantChannelStatusIndex = (Is-TrueValue $deliveryStateIndex)
    deliveryDeadLetterIndex = (Is-TrueValue $deliveryDeadLetterIndex)
    deliveryStatusCheckIncludesDeadLetter = ($deliveryStatusConstraint -like "*dead_letter*")
  }
  details = [pscustomobject]@{
    missingColumns = $missingColumns
    statusConstraint = $deliveryStatusConstraint
  }
}

if (
  -not $result.checks.deliveryColumnsPresent -or
  -not $result.checks.notificationDeliveryEventsTable -or
  -not $result.checks.notificationDeliveryEventsRls -or
  -not $result.checks.notificationDeliveryEventsPolicy -or
  -not $result.checks.providerEventUniqueIndex -or
  -not $result.checks.deliveryTenantChannelStatusIndex -or
  -not $result.checks.deliveryDeadLetterIndex -or
  -not $result.checks.deliveryStatusCheckIncludesDeadLetter
) {
  $result.ok = $false
}

$json = $result | ConvertTo-Json -Depth 6
Write-Output $json

if (-not $result.ok) {
  throw "Phase41 migration verification failed."
}
