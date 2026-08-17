[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$failureCount = 0

function Ok([string]$Message) {
  Write-Host ("[OK]   " + $Message) -ForegroundColor Green
}

function Fail([string]$Message) {
  $script:failureCount += 1
  Write-Host ("[FAIL] " + $Message) -ForegroundColor Red
}

Push-Location $repoRoot
try {
  $insideWorkTree = git rev-parse --is-inside-work-tree 2>$null
  if ($LASTEXITCODE -ne 0 -or $insideWorkTree -ne "true") {
    throw "Repository hygiene check must run inside a Git work tree."
  }

  $statusLines = @(git status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) {
    throw "git status failed."
  }

  if ($statusLines.Count -gt 0) {
    Fail "Working tree is not clean. Every changed and untracked file must be classified before handoff."
    $statusLines | ForEach-Object { Write-Host ("       " + $_) }
  } else {
    Ok "Working tree is clean."
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $workingDiffIssues = @(git diff --check 2>$null)
  $workingDiffExitCode = $LASTEXITCODE
  $stagedDiffIssues = @(git diff --cached --check 2>$null)
  $stagedDiffExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference

  if ($workingDiffExitCode -ne 0) {
    Fail "Unstaged changes contain whitespace errors."
    $workingDiffIssues | ForEach-Object { Write-Host ("       " + $_) }
  } else {
    Ok "Unstaged diff has no whitespace errors."
  }

  if ($stagedDiffExitCode -ne 0) {
    Fail "Staged changes contain whitespace errors."
    $stagedDiffIssues | ForEach-Object { Write-Host ("       " + $_) }
  } else {
    Ok "Staged diff has no whitespace errors."
  }

  $forbiddenRoots = @(
    "output",
    "tmp",
    ".tmp",
    ".next",
    ".vercel",
    "supabase/.temp"
  )
  $forbiddenNames = @("({value", "r.text())")
  $trackedFiles = @(git ls-files)
  if ($LASTEXITCODE -ne 0) {
    throw "git ls-files failed."
  }

  $forbiddenTracked = @(
    $trackedFiles | Where-Object {
      $path = $_.Replace("\", "/")
      if ($forbiddenNames -contains $path) { return $true }
      foreach ($root in $forbiddenRoots) {
        if ($path -eq $root -or $path.StartsWith($root + "/", [StringComparison]::Ordinal)) {
          return $true
        }
      }
      return $false
    }
  )

  if ($forbiddenTracked.Count -gt 0) {
    Fail "Generated or local-only artifacts are tracked by Git."
    $forbiddenTracked | Sort-Object | ForEach-Object { Write-Host ("       " + $_) }
  } else {
    Ok "No generated or local-only artifact paths are tracked."
  }

  if ($failureCount -gt 0) {
    Write-Host ("Repository hygiene failed with " + $failureCount + " problem(s).") -ForegroundColor Red
    exit 1
  }

  $branchLine = git status --branch --short | Select-Object -First 1
  Ok ("Repository hygiene passed: " + $branchLine)
} finally {
  Pop-Location
}
