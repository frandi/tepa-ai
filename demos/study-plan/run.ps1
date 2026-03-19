$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "Cleaning previous output..."
Remove-Item -Force -ErrorAction SilentlyContinue "study-plan.md"

Write-Host "Running demo..."
npm start
