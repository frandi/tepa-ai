$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "Cleaning previous output..."
if (Test-Path "my-project/src/api") {
    Remove-Item -Recurse -Force "my-project/src/api"
}

Write-Host "Running demo..."
npm start
