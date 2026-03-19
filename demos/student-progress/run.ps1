$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "Cleaning previous output..."
Remove-Item -Force -ErrorAction SilentlyContinue "class-5b/progress_report.md", "class-5b/progress-report.md"
Remove-Item -Force -ErrorAction SilentlyContinue "class-5b/flagged_students.csv", "class-5b/flagged-students.csv"

Write-Host "Running demo..."
npm start
