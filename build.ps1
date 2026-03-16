#Requires -Version 5.1
<#
.SYNOPSIS
  Build packages that have changed since the last commit.
.DESCRIPTION
  Ordered by dependency: types first, then packages that depend on it.
.PARAMETER All
  Build all packages regardless of changes.
.EXAMPLE
  .\build.ps1          # build only changed packages
  .\build.ps1 -All     # build all packages
#>
[CmdletBinding()]
param(
    [switch]$All,
    [Parameter(ValueFromRemainingArguments)]
    [string[]]$Remaining
)

# Support --all for consistency with build.sh
if ($Remaining -contains '--all') {
    $All = [switch]::new($true)
}

$ErrorActionPreference = 'Stop'

$Packages = @(
    'types'
    'provider-core'
    'tepa'
    'tools'
    'provider-anthropic'
    'provider-openai'
    'provider-gemini'
)

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Verify workspace symlinks exist so builds don't fail with cryptic DTS errors.
function Assert-WorkspaceLinks {
    $missing = @()
    foreach ($pkg in $Packages) {
        $pkgJsonPath = Join-Path $RootDir "packages/$pkg/package.json"
        if (Test-Path $pkgJsonPath) {
            $pkgName = (Get-Content $pkgJsonPath -Raw | ConvertFrom-Json).name
            $linkPath = Join-Path $RootDir "node_modules/$pkgName"
            if (-not (Test-Path $linkPath)) {
                $missing += $pkgName
            }
        }
    }

    if ($missing.Count -gt 0) {
        Write-Host "ERROR: Missing workspace symlinks: $($missing -join ', ')" -ForegroundColor Red
        Write-Host "Run 'npm install' to set up workspace links, then try again."
        exit 1
    }
}

Assert-WorkspaceLinks

function Get-ChangedPackages {
    $changedFiles = @()
    try { $changedFiles += git diff --name-only HEAD 2>$null } catch {}
    try { $changedFiles += git diff --name-only --cached 2>$null } catch {}
    try { $changedFiles += git ls-files --others --exclude-standard 2>$null } catch {}

    $pkgs = @()
    foreach ($pkg in $Packages) {
        foreach ($file in $changedFiles) {
            if ($file -like "packages/$pkg/*") {
                $pkgs += $pkg
                break
            }
        }
    }

    # If types changed, rebuild everything that depends on it
    if ($pkgs -contains 'types') {
        return $Packages
    }

    # If provider-core changed, rebuild all providers
    if ($pkgs -contains 'provider-core') {
        foreach ($provider in @('provider-anthropic', 'provider-openai', 'provider-gemini')) {
            if ($pkgs -notcontains $provider) {
                $pkgs += $provider
            }
        }
    }

    return $pkgs
}

if ($All) {
    $toBuild = $Packages
} else {
    $toBuild = Get-ChangedPackages
}

if (-not $toBuild -or $toBuild.Count -eq 0) {
    Write-Host 'No packages to build.'
    exit 0
}

Write-Host "Building: $($toBuild -join ', ')"
Write-Host ''

foreach ($pkg in $toBuild) {
    Write-Host "--- Building packages/$pkg ---"
    npm run build --workspace="packages/$pkg"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed for packages/$pkg"
        exit $LASTEXITCODE
    }
    Write-Host ''
}

Write-Host 'Done.'
