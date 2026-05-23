$ErrorActionPreference = "Stop"

$root = (Resolve-Path .).Path
$pages = Get-ChildItem -Path "app" -Recurse -Filter "page.tsx" | ForEach-Object { $_.FullName }

$noCard = New-Object System.Collections.Generic.List[string]
$skippedProxy = New-Object System.Collections.Generic.List[string]

function Test-HasCardMarkup {
  param([string]$Text)

  return (
    ($Text -match 'className="[^"]*(card|fdGlassSubPanel|fdActionCard|formCard|kv)') -or
    ($Text -match 'className=\{[^\}]*"[^"]*(card|fdGlassSubPanel|fdActionCard|formCard|kv)') -or
    ($Text -match 'className=\{[^\}]*styles\.[A-Za-z0-9_]*(card|Card|fdGlassSubPanel|fdActionCard|formCard|kv)') -or
    ($Text -match '<[A-Z][A-Za-z0-9_]*(Card|Drawer|Table|Hero|Header|StickyBar|Summary|Calendar|Grid|FilterBar|Preview)\b')
  )
}

function Resolve-ImportSource {
  param(
    [string]$FromFile,
    [string]$ImportPath
  )

  if ($ImportPath.StartsWith("@/")) {
    $candidateBase = Join-Path $root $ImportPath.Substring(2)
  } elseif ($ImportPath.StartsWith(".")) {
    $candidateBase = Join-Path (Split-Path $FromFile -Parent) $ImportPath
  } else {
    return $null
  }

  $candidates = @(
    $candidateBase,
    ($candidateBase + ".tsx"),
    ($candidateBase + ".ts"),
    ($candidateBase + ".jsx"),
    ($candidateBase + ".js"),
    (Join-Path $candidateBase "index.tsx"),
    (Join-Path $candidateBase "index.ts"),
    (Join-Path $candidateBase "index.jsx"),
    (Join-Path $candidateBase "index.js")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate -PathType Leaf) {
      return (Resolve-Path $candidate).Path
    }
  }

  return $null
}

function Get-ImportedComponentSources {
  param(
    [string]$Text,
    [string]$FromFile
  )

  $sources = @{}

  foreach ($match in [regex]::Matches($Text, 'import\s+([A-Z][A-Za-z0-9_]*)\s+from\s+"([^"]+)"')) {
    $sourcePath = Resolve-ImportSource -FromFile $FromFile -ImportPath $match.Groups[2].Value
    if ($sourcePath) {
      $sources[$match.Groups[1].Value] = $sourcePath
    }
  }

  foreach ($match in [regex]::Matches($Text, 'import\s+\{([^}]+)\}\s+from\s+"([^"]+)"')) {
    $sourcePath = Resolve-ImportSource -FromFile $FromFile -ImportPath $match.Groups[2].Value
    if (-not $sourcePath) { continue }

    foreach ($rawName in $match.Groups[1].Value.Split(",")) {
      $name = ($rawName -replace '\s+as\s+.*$', '').Trim()
      if ($name -match '^[A-Z][A-Za-z0-9_]*$') {
        $sources[$name] = $sourcePath
      }
    }
  }

  return $sources
}

foreach ($full in $pages) {
  $rel = $full.Substring($root.Length + 1).Replace("\", "/")
  $txt = [System.IO.File]::ReadAllText($full)

  if (Test-HasCardMarkup -Text $txt) { continue }

  $importedComponentSources = Get-ImportedComponentSources -Text $txt -FromFile $full
  $hasImportedCardComponent = $false

  foreach ($component in $importedComponentSources.Keys) {
    $componentPattern = "<" + [regex]::Escape($component) + "\b"
    if ($txt -notmatch $componentPattern) { continue }

    $componentText = [System.IO.File]::ReadAllText($importedComponentSources[$component])
    if (Test-HasCardMarkup -Text $componentText) {
      $hasImportedCardComponent = $true
      break
    }
  }

  if ($hasImportedCardComponent) { continue }

  $hasUiMarkup =
    ($txt -match '<main\b') -or
    ($txt -match '<section\b') -or
    ($txt -match '<article\b') -or
    ($txt -match '<div\b') -or
    ($txt -match '<form\b')

  $importedComponents = [regex]::Matches($txt, 'import\s+([A-Z][A-Za-z0-9_]*)\s+from\s+"[^"]+"') |
    ForEach-Object { $_.Groups[1].Value }
  $returnedComponentMatch = [regex]::Match($txt, 'return\s*<([A-Z][A-Za-z0-9_]*)[^>]*\/>;')
  $returnedComponent = if ($returnedComponentMatch.Success) { $returnedComponentMatch.Groups[1].Value } else { $null }

  $isProxyPage =
    (
      ($txt -match 'import\s+\w+\s+from\s+"\.\/ClientPage"') -or
      ($returnedComponent -and ($importedComponents -contains $returnedComponent))
    ) -and
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
