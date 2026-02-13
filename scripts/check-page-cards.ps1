$ErrorActionPreference = "Stop"

$root = (Resolve-Path .).Path
$pages = Get-ChildItem -Path "app" -Recurse -Filter "page.tsx" | ForEach-Object { $_.FullName }

$noCard = New-Object System.Collections.Generic.List[string]
$skippedProxy = New-Object System.Collections.Generic.List[string]

foreach ($full in $pages) {
  $rel = $full.Substring($root.Length + 1).Replace("\", "/")
  $txt = [System.IO.File]::ReadAllText($full)

  $hasCard =
    ($txt -match 'className="[^"]*(card|fdGlassSubPanel|fdActionCard|formCard|kv)') -or
    ($txt -match 'className=\{[^\}]*"[^"]*(card|fdGlassSubPanel|fdActionCard|formCard|kv)')

  if ($hasCard) { continue }

  $hasUiMarkup =
    ($txt -match '<main\b') -or
    ($txt -match '<section\b') -or
    ($txt -match '<article\b') -or
    ($txt -match '<div\b') -or
    ($txt -match '<form\b')

  $isProxyPage =
    ($txt -match 'import\s+\w+\s+from\s+"\.\/ClientPage"') -and
    ($txt -match 'return\s*<\w+[^>]*\/>;')

  if ($isProxyPage -and -not $hasUiMarkup) {
    $skippedProxy.Add($rel)
    continue
  }

  $noCard.Add($rel)
}

foreach ($path in $noCard) {
  Write-Output ("NOCARD " + $path)
}

Write-Output ("Checked pages: " + $pages.Count)
Write-Output ("Proxy pages skipped: " + $skippedProxy.Count)
Write-Output ("Pages missing card classes: " + $noCard.Count)

if ($noCard.Count -gt 0) {
  exit 1
}

